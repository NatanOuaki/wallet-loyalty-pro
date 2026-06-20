const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const TMP_DIR = path.join(ROOT, "tmp");
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "db.json");
const PORT = Number(process.env.PORT || 4173);
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const COOKIE_NAME = "wallet_loyalty_session";
const JWT_HEADER = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `commerce-${crypto.randomBytes(3).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), check);
}

function defaultDb() {
  const merchantId = id("mer");
  const programId = id("prog");
  const customerId = id("cus");
  return {
    merchants: [
      {
        id: id("adm"),
        role: "super_admin",
        businessName: "Wallet Loyalty HQ",
        ownerName: "Super Admin",
        email: "super@wallet.local",
        passwordHash: hashPassword("admin1234"),
        plan: "owner",
        status: "active",
        slug: "admin",
        createdAt: new Date().toISOString()
      },
      {
        id: merchantId,
        role: "merchant",
        businessName: "Maison Cafe",
        ownerName: "Demo Owner",
        email: "admin@demo.local",
        passwordHash: hashPassword("demo1234"),
        plan: "growth",
        status: "active",
        slug: "maison-cafe",
        createdAt: new Date().toISOString()
      }
    ],
    programs: [
      {
        id: programId,
        merchantId,
        name: "Club Cafe",
        rewardRule: "10 tampons = 1 cafe offert",
        target: 10,
        stampValue: 1,
        brandColor: "#126149",
        accentColor: "#f2c14e",
        logoText: "MC",
        cardHeroText: "Votre cafe offert arrive vite.",
        cardFooterText: "Scannez a chaque passage.",
        cardTextColor: "#ffffff",
        applePassTypeId: process.env.APPLE_PASS_TYPE_ID || "",
        googleIssuerId: process.env.GOOGLE_ISSUER_ID || "",
        createdAt: new Date().toISOString()
      }
    ],
    customers: [
      {
        id: customerId,
        programId,
        memberId: "MEMBER-0001",
        name: "Sarah Cohen",
        phone: "+972 50 000 0000",
        email: "sarah@email.com",
        consentMarketing: true,
        createdAt: new Date().toISOString()
      }
    ],
    transactions: [
      {
        id: id("txn"),
        customerId,
        pointsDelta: 4,
        reason: "earn",
        source: "demo",
        createdAt: new Date().toISOString()
      }
    ],
    rewards: [],
    campaigns: [],
    sessions: []
  };
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const db = defaultDb();
    writeDb(db);
    return db;
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  return migrateDb(db);
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function migrateDb(db) {
  db.merchants ||= [];
  db.programs ||= [];
  db.customers ||= [];
  db.transactions ||= [];
  db.rewards ||= [];
  db.campaigns ||= [];
  db.sessions ||= [];
  if (!db.merchants.some((merchant) => merchant.role === "super_admin")) {
    db.merchants.unshift({
      id: id("adm"),
      role: "super_admin",
      businessName: "Wallet Loyalty HQ",
      ownerName: "Super Admin",
      email: "super@wallet.local",
      passwordHash: hashPassword("admin1234"),
      plan: "owner",
      status: "active",
      slug: "admin",
      createdAt: new Date().toISOString()
    });
  }
  for (const merchant of db.merchants) {
    merchant.role ||= "merchant";
    merchant.status ||= "active";
    merchant.slug ||= slugify(merchant.businessName);
  }
  for (const program of db.programs) {
    program.cardHeroText ||= "Votre recompense vous attend.";
    program.cardFooterText ||= "Presentez cette carte en boutique.";
    program.cardTextColor ||= "#ffffff";
    program.logoText ||= program.name.slice(0, 2).toUpperCase();
  }
  writeDb(db);
  return db;
}

function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const payload = isBuffer ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, {
    "Content-Length": payload.length,
    "Content-Type": isBuffer ? "application/octet-stream" : "application/json; charset=utf-8",
    ...headers
  });
  res.end(payload);
}

function sendError(res, status, message) {
  send(res, status, { error: message });
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((item) => {
    const [key, ...value] = item.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function currentUser(req, db) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const session = db.sessions.find((item) => item.token === token && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  return db.merchants.find((merchant) => merchant.id === session.merchantId) || null;
}

function getMerchantProgram(db, merchantId) {
  return db.programs.find((program) => program.merchantId === merchantId);
}

function requireAdmin(user, res) {
  if (user?.role === "super_admin") return true;
  sendError(res, 403, "Acces super admin requis");
  return false;
}

function requireMerchant(user, res) {
  if (user?.role === "merchant") return true;
  sendError(res, 403, "Acces commerce requis");
  return false;
}

function balanceFor(db, customerId) {
  return db.transactions
    .filter((txn) => txn.customerId === customerId)
    .reduce((sum, txn) => sum + txn.pointsDelta, 0);
}

function hydrateCustomer(db, customer) {
  const program = db.programs.find((item) => item.id === customer.programId);
  const points = balanceFor(db, customer.id);
  return {
    ...customer,
    points,
    cyclePoints: ((points % program.target) + program.target) % program.target,
    rewardsAvailable: Math.floor(points / program.target),
    passUrls: {
      apple: `${BASE_URL}/api/wallet/apple/${customer.id}`,
      google: `${BASE_URL}/api/wallet/google/${customer.id}`
    }
  };
}

function merchantCustomers(db, merchantId) {
  const program = getMerchantProgram(db, merchantId);
  if (!program) return [];
  return db.customers
    .filter((customer) => customer.programId === program.id)
    .map((customer) => hydrateCustomer(db, customer))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function merchantSummary(db, merchant) {
  const program = getMerchantProgram(db, merchant.id);
  const customers = program ? db.customers.filter((customer) => customer.programId === program.id) : [];
  const customerIds = new Set(customers.map((customer) => customer.id));
  return {
    ...publicMerchant(merchant),
    program,
    joinUrl: `${BASE_URL}/join/${merchant.slug}`,
    customersCount: customers.length,
    transactionsCount: db.transactions.filter((txn) => customerIds.has(txn.customerId)).length,
    revenuePlan: merchant.plan,
    status: merchant.status
  };
}

function walletConfigStatus() {
  return {
    apple: {
      ready: Boolean(process.env.APPLE_PASS_TYPE_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_CERT_P12 && process.env.APPLE_WWDR_CERT),
      missing: ["APPLE_PASS_TYPE_ID", "APPLE_TEAM_ID", "APPLE_CERT_P12", "APPLE_WWDR_CERT"].filter((key) => !process.env[key])
    },
    google: {
      ready: Boolean(process.env.GOOGLE_ISSUER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      missing: ["GOOGLE_ISSUER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"].filter((key) => !process.env[key])
    }
  };
}

function rgb(hex) {
  const value = hex.replace("#", "");
  const parts = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((part) => parseInt(part, 16));
  return `rgb(${parts.join(", ")})`;
}

function applePassJson(db, customer) {
  const program = db.programs.find((item) => item.id === customer.programId);
  const merchant = db.merchants.find((item) => item.id === program.merchantId);
  const hydrated = hydrateCustomer(db, customer);
  return {
    formatVersion: 1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID || "pass.com.example.loyalty",
    serialNumber: customer.id,
    teamIdentifier: process.env.APPLE_TEAM_ID || "TEAMID",
    organizationName: merchant.businessName,
    description: `Carte fidelite ${merchant.businessName}`,
    logoText: program.logoText || merchant.businessName,
    foregroundColor: rgb(program.cardTextColor || "#ffffff"),
    backgroundColor: rgb(program.brandColor),
    labelColor: rgb(program.cardTextColor || "#ffffff"),
    webServiceURL: `${BASE_URL}/api/apple/passkit`,
    authenticationToken: crypto.createHash("sha256").update(customer.id).digest("hex"),
    barcode: {
      message: customer.memberId,
      format: "PKBarcodeFormatQR",
      messageEncoding: "iso-8859-1",
      altText: customer.memberId
    },
    storeCard: {
      primaryFields: [{ key: "points", label: "Tampons", value: `${hydrated.cyclePoints} / ${program.target}` }],
      secondaryFields: [{ key: "reward", label: "Recompense", value: program.rewardRule }],
      auxiliaryFields: [
        { key: "member", label: "Membre", value: customer.memberId },
        { key: "footer", label: "Info", value: program.cardFooterText || "Presentez cette carte en boutique." }
      ]
    }
  };
}

function demoPkpass(db, customer) {
  const pass = applePassJson(db, customer);
  return Buffer.from(JSON.stringify({
    mode: "demo",
    note: "Configure Apple certificates to generate a signed .pkpass accepted by Apple Wallet.",
    pass
  }, null, 2));
}

function writeAppleAssets(dir) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
  ["icon.png", "icon@2x.png", "logo.png", "logo@2x.png"].forEach((name) => fs.writeFileSync(path.join(dir, name), png));
}

function signedPkpass(db, customer) {
  const status = walletConfigStatus();
  if (!status.apple.ready) return demoPkpass(db, customer);

  const work = fs.mkdtempSync(path.join(TMP_DIR, "pkpass-"));
  fs.writeFileSync(path.join(work, "pass.json"), JSON.stringify(applePassJson(db, customer), null, 2));
  writeAppleAssets(work);

  const manifest = {};
  for (const file of fs.readdirSync(work)) {
    const bytes = fs.readFileSync(path.join(work, file));
    manifest[file] = crypto.createHash("sha1").update(bytes).digest("hex");
  }
  fs.writeFileSync(path.join(work, "manifest.json"), JSON.stringify(manifest, null, 2));

  const certPem = path.join(work, "cert.pem");
  const keyPem = path.join(work, "key.pem");
  execFileSync("openssl", ["pkcs12", "-in", process.env.APPLE_CERT_P12, "-clcerts", "-nokeys", "-out", certPem, "-password", `pass:${process.env.APPLE_CERT_PASSWORD || ""}`]);
  execFileSync("openssl", ["pkcs12", "-in", process.env.APPLE_CERT_P12, "-nocerts", "-nodes", "-out", keyPem, "-password", `pass:${process.env.APPLE_CERT_PASSWORD || ""}`]);
  execFileSync("openssl", ["smime", "-binary", "-sign", "-certfile", process.env.APPLE_WWDR_CERT, "-signer", certPem, "-inkey", keyPem, "-in", path.join(work, "manifest.json"), "-out", path.join(work, "signature"), "-outform", "DER"]);
  const out = path.join(work, "pass.pkpass");
  execFileSync("zip", ["-q", "-r", out, "."], { cwd: work });
  return fs.readFileSync(out);
}

function googleJwt(db, customer) {
  const status = walletConfigStatus();
  if (!status.google.ready) return null;
  const service = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, "utf8"));
  const program = db.programs.find((item) => item.id === customer.programId);
  const merchant = db.merchants.find((item) => item.id === program.merchantId);
  const hydrated = hydrateCustomer(db, customer);
  const issuer = process.env.GOOGLE_ISSUER_ID;
  const classId = `${issuer}.${program.id}`;
  const objectId = `${issuer}.${customer.memberId}`;
  const claims = {
    iss: service.client_email,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [new URL(BASE_URL).origin],
    payload: {
      loyaltyClasses: [{
        id: classId,
        issuerName: merchant.businessName,
        programName: program.name,
        reviewStatus: "UNDER_REVIEW"
      }],
      loyaltyObjects: [{
        id: objectId,
        classId,
        state: "ACTIVE",
        accountId: customer.memberId,
        accountName: customer.name,
        barcode: { type: "QR_CODE", value: customer.memberId },
        loyaltyPoints: { label: "Tampons", balance: { int: hydrated.cyclePoints } },
        textModulesData: [{ id: "reward_rule", header: "Recompense", body: program.rewardRule }]
      }]
    }
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${JWT_HEADER}.${payload}`), service.private_key).toString("base64url");
  return `${JWT_HEADER}.${payload}.${signature}`;
}

function serveStatic(req, res) {
  const url = new URL(req.url, BASE_URL);
  let file = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (file === "/") file = "/index.html";
  if (file.startsWith("/join/")) file = "/join.html";
  const fullPath = path.join(ROOT, file);
  if (!fullPath.startsWith(ROOT) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    sendError(res, 404, "Not found");
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".sql": "text/plain; charset=utf-8"
  };
  const body = fs.readFileSync(fullPath);
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  res.end(body);
}

async function api(req, res) {
  const db = readDb();
  const url = new URL(req.url, BASE_URL);
  const method = req.method;
  const user = currentUser(req, db);

  if (method === "GET" && url.pathname === "/api/health") {
    send(res, 200, { ok: true, baseUrl: BASE_URL, wallet: walletConfigStatus() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const merchant = db.merchants.find((item) => item.email.toLowerCase() === String(body.email || "").toLowerCase());
    if (!merchant || !verifyPassword(String(body.password || ""), merchant.passwordHash)) {
      sendError(res, 401, "Identifiants invalides");
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    db.sessions.push({ token, merchantId: merchant.id, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString() });
    writeDb(db);
    send(res, 200, { merchant: publicMerchant(merchant), program: getMerchantProgram(db, merchant.id) }, {
      "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600`
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) {
      const next = readDb();
      next.sessions = next.sessions.filter((session) => session.token !== token);
      writeDb(next);
    }
    send(res, 200, { ok: true }, { "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
    return;
  }

  if (!user && !url.pathname.startsWith("/api/public/") && !url.pathname.startsWith("/api/wallet/")) {
    sendError(res, 401, "Connexion requise");
    return;
  }

  if (method === "GET" && url.pathname === "/api/me") {
    send(res, 200, { merchant: publicMerchant(user), program: getMerchantProgram(db, user.id), wallet: walletConfigStatus() });
    return;
  }

  if (method === "GET" && url.pathname === "/api/admin/merchants") {
    if (!requireAdmin(user, res)) return;
    send(res, 200, {
      merchants: db.merchants
        .filter((merchant) => merchant.role === "merchant")
        .map((merchant) => merchantSummary(db, merchant))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/admin/merchants") {
    if (!requireAdmin(user, res)) return;
    const body = await readBody(req);
    const merchant = createMerchant(db, body);
    const program = createProgram(db, merchant.id, body);
    writeDb(db);
    send(res, 201, { merchant: merchantSummary(db, merchant), program });
    return;
  }

  const adminMerchantMatch = url.pathname.match(/^\/api\/admin\/merchants\/([^/]+)$/);
  if (method === "PATCH" && adminMerchantMatch) {
    if (!requireAdmin(user, res)) return;
    const body = await readBody(req);
    const merchant = db.merchants.find((item) => item.id === adminMerchantMatch[1] && item.role === "merchant");
    if (!merchant) return sendError(res, 404, "Commerce introuvable");
    Object.assign(merchant, {
      businessName: clean(body.businessName, merchant.businessName),
      ownerName: clean(body.ownerName, merchant.ownerName),
      email: clean(body.email, merchant.email).toLowerCase(),
      plan: clean(body.plan, merchant.plan),
      status: clean(body.status, merchant.status),
      slug: slugify(clean(body.slug, merchant.slug))
    });
    if (body.password) merchant.passwordHash = hashPassword(String(body.password));
    writeDb(db);
    send(res, 200, { merchant: merchantSummary(db, merchant) });
    return;
  }

  const adminDesignMatch = url.pathname.match(/^\/api\/admin\/merchants\/([^/]+)\/design$/);
  if (method === "PATCH" && adminDesignMatch) {
    if (!requireAdmin(user, res)) return;
    const merchant = db.merchants.find((item) => item.id === adminDesignMatch[1] && item.role === "merchant");
    if (!merchant) return sendError(res, 404, "Commerce introuvable");
    const program = getMerchantProgram(db, merchant.id);
    if (!program) return sendError(res, 404, "Programme introuvable");
    const body = await readBody(req);
    Object.assign(program, {
      name: clean(body.name, program.name),
      rewardRule: clean(body.rewardRule, program.rewardRule),
      target: clamp(Number(body.target), 2, 100, program.target),
      stampValue: clamp(Number(body.stampValue), 1, 25, program.stampValue),
      brandColor: clean(body.brandColor, program.brandColor),
      accentColor: clean(body.accentColor, program.accentColor),
      cardTextColor: clean(body.cardTextColor, program.cardTextColor),
      logoText: clean(body.logoText, program.logoText),
      cardHeroText: clean(body.cardHeroText, program.cardHeroText),
      cardFooterText: clean(body.cardFooterText, program.cardFooterText)
    });
    writeDb(db);
    send(res, 200, { merchant: merchantSummary(db, merchant), program });
    return;
  }

  if (method === "GET" && url.pathname === "/api/admin/stats") {
    if (!requireAdmin(user, res)) return;
    const merchantIds = new Set(db.merchants.filter((merchant) => merchant.role === "merchant").map((merchant) => merchant.id));
    const programIds = new Set(db.programs.filter((program) => merchantIds.has(program.merchantId)).map((program) => program.id));
    const customerIds = new Set(db.customers.filter((customer) => programIds.has(customer.programId)).map((customer) => customer.id));
    send(res, 200, {
      merchants: merchantIds.size,
      activeMerchants: db.merchants.filter((merchant) => merchant.role === "merchant" && merchant.status === "active").length,
      customers: customerIds.size,
      transactions: db.transactions.filter((txn) => customerIds.has(txn.customerId)).length
    });
    return;
  }

  if (method === "PATCH" && url.pathname === "/api/program") {
    if (!requireMerchant(user, res)) return;
    const body = await readBody(req);
    const program = getMerchantProgram(db, user.id);
    Object.assign(program, {
      name: clean(body.name, program.name),
      rewardRule: clean(body.rewardRule, program.rewardRule),
      target: clamp(Number(body.target), 2, 100, program.target),
      stampValue: clamp(Number(body.stampValue), 1, 25, program.stampValue),
      brandColor: clean(body.brandColor, program.brandColor),
      accentColor: clean(body.accentColor, program.accentColor),
      logoText: clean(body.logoText, program.logoText)
    });
    writeDb(db);
    send(res, 200, { program });
    return;
  }

  if (method === "GET" && url.pathname === "/api/customers") {
    if (!requireMerchant(user, res)) return;
    send(res, 200, { customers: merchantCustomers(db, user.id) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/customers") {
    if (!requireMerchant(user, res)) return;
    const body = await readBody(req);
    const program = getMerchantProgram(db, user.id);
    const customer = createCustomer(db, program.id, body);
    writeDb(db);
    send(res, 201, { customer: hydrateCustomer(db, customer) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/scan") {
    if (!requireMerchant(user, res)) return;
    const body = await readBody(req);
    const program = getMerchantProgram(db, user.id);
    const customer = db.customers.find((item) => item.programId === program.id && item.memberId === String(body.memberId || "").trim());
    if (!customer) return sendError(res, 404, "Carte introuvable");
    const points = clamp(Number(body.points), -100, 100, program.stampValue);
    db.transactions.push({ id: id("txn"), customerId: customer.id, pointsDelta: points, reason: points >= 0 ? "earn" : "adjust", source: "scan", createdAt: new Date().toISOString() });
    issueRewards(db, customer.id, program);
    writeDb(db);
    send(res, 200, { customer: hydrateCustomer(db, customer), message: "Points mis a jour" });
    return;
  }

  if (method === "POST" && url.pathname === "/api/redeem") {
    if (!requireMerchant(user, res)) return;
    const body = await readBody(req);
    const program = getMerchantProgram(db, user.id);
    const customer = db.customers.find((item) => item.programId === program.id && item.memberId === String(body.memberId || "").trim());
    if (!customer) return sendError(res, 404, "Carte introuvable");
    const available = Math.floor(balanceFor(db, customer.id) / program.target);
    if (available < 1) return sendError(res, 400, "Aucune recompense disponible");
    db.transactions.push({ id: id("txn"), customerId: customer.id, pointsDelta: -program.target, reason: "redeem", source: "pos", createdAt: new Date().toISOString() });
    db.rewards.push({ id: id("rew"), customerId: customer.id, title: program.rewardRule, status: "redeemed", redeemedAt: new Date().toISOString() });
    writeDb(db);
    send(res, 200, { customer: hydrateCustomer(db, customer), message: "Recompense utilisee" });
    return;
  }

  if (method === "GET" && url.pathname === "/api/stats") {
    if (!requireMerchant(user, res)) return;
    const customers = merchantCustomers(db, user.id);
    send(res, 200, {
      clients: customers.length,
      scans: db.transactions.filter((txn) => customers.some((customer) => customer.id === txn.customerId)).length,
      rewards: db.rewards.length,
      points: customers.reduce((sum, customer) => sum + customer.points, 0)
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/export") {
    if (!requireMerchant(user, res)) return;
    send(res, 200, { merchant: publicMerchant(user), program: getMerchantProgram(db, user.id), customers: merchantCustomers(db, user.id), campaigns: db.campaigns });
    return;
  }

  if (method === "GET" && url.pathname === "/api/campaigns") {
    if (!requireMerchant(user, res)) return;
    send(res, 200, { campaigns: db.campaigns.filter((item) => item.merchantId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/campaigns") {
    if (!requireMerchant(user, res)) return;
    const body = await readBody(req);
    const customers = merchantCustomers(db, user.id);
    const campaign = {
      id: id("camp"),
      merchantId: user.id,
      title: clean(body.title, "Offre speciale"),
      message: clean(body.message, ""),
      channel: clean(body.channel, "manual"),
      recipients: customers.filter((customer) => customer.consentMarketing).length,
      status: "prepared",
      createdAt: new Date().toISOString()
    };
    db.campaigns.push(campaign);
    writeDb(db);
    send(res, 201, { campaign });
    return;
  }

  const publicProgramMatch = url.pathname.match(/^\/api\/public\/program\/([^/]+)$/);
  if (method === "GET" && publicProgramMatch) {
    const merchant = db.merchants.find((item) => item.slug === publicProgramMatch[1] && item.role === "merchant" && item.status === "active");
    if (!merchant) return sendError(res, 404, "Commerce introuvable");
    const program = getMerchantProgram(db, merchant.id);
    send(res, 200, { merchant: publicMerchant(merchant), program });
    return;
  }

  if (method === "POST" && url.pathname === "/api/public/customers") {
    const body = await readBody(req);
    const merchant = db.merchants.find((item) => item.slug === String(body.slug || "").trim() && item.role === "merchant" && item.status === "active");
    if (!merchant) return sendError(res, 404, "Commerce introuvable");
    const program = getMerchantProgram(db, merchant.id);
    const customer = createCustomer(db, program.id, body);
    writeDb(db);
    send(res, 201, { customer: hydrateCustomer(db, customer) });
    return;
  }

  const appleMatch = url.pathname.match(/^\/api\/wallet\/apple\/([^/.]+)(?:\.pkpass)?$/);
  if (method === "GET" && appleMatch) {
    const customer = db.customers.find((item) => item.id === appleMatch[1]);
    if (!customer) return sendError(res, 404, "Carte introuvable");
    const ready = walletConfigStatus().apple.ready;
    if (!ready) {
      res.writeHead(302, { Location: `/wallet-demo.html?platform=apple&member=${encodeURIComponent(customer.memberId)}` });
      res.end();
      return;
    }
    send(res, 200, signedPkpass(db, customer), {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `inline; filename="${customer.memberId}.pkpass"`
    });
    return;
  }

  const googleMatch = url.pathname.match(/^\/api\/wallet\/google\/([^/]+)$/);
  if (method === "GET" && googleMatch) {
    const customer = db.customers.find((item) => item.id === googleMatch[1]);
    if (!customer) return sendError(res, 404, "Carte introuvable");
    const jwt = googleJwt(db, customer);
    const location = jwt ? `https://pay.google.com/gp/v/save/${jwt}` : `/wallet-demo.html?platform=google&member=${encodeURIComponent(customer.memberId)}`;
    res.writeHead(302, { Location: location });
    res.end();
    return;
  }

  sendError(res, 404, "Route introuvable");
}

function clean(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function publicMerchant(merchant) {
  const { passwordHash, ...safe } = merchant;
  return safe;
}

function createMerchant(db, body) {
  const businessName = clean(body.businessName, "Nouveau commerce");
  const baseSlug = slugify(body.slug || businessName);
  let slug = baseSlug;
  let suffix = 2;
  while (db.merchants.some((merchant) => merchant.slug === slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  const merchant = {
    id: id("mer"),
    role: "merchant",
    businessName,
    ownerName: clean(body.ownerName, "Owner"),
    email: clean(body.email, `${slug}@demo.local`).toLowerCase(),
    passwordHash: hashPassword(clean(body.password, "demo1234")),
    plan: clean(body.plan, "starter"),
    status: clean(body.status, "active"),
    slug,
    createdAt: new Date().toISOString()
  };
  db.merchants.push(merchant);
  return merchant;
}

function createProgram(db, merchantId, body) {
  const merchant = db.merchants.find((item) => item.id === merchantId);
  const program = {
    id: id("prog"),
    merchantId,
    name: clean(body.programName || body.name, "Club Fidelite"),
    rewardRule: clean(body.rewardRule, "10 points = 1 recompense"),
    target: clamp(Number(body.target), 2, 100, 10),
    stampValue: clamp(Number(body.stampValue), 1, 25, 1),
    brandColor: clean(body.brandColor, "#126149"),
    accentColor: clean(body.accentColor, "#f2c14e"),
    cardTextColor: clean(body.cardTextColor, "#ffffff"),
    logoText: clean(body.logoText, initialsFor(merchant?.businessName || "WL")),
    cardHeroText: clean(body.cardHeroText, "Votre recompense vous attend."),
    cardFooterText: clean(body.cardFooterText, "Presentez cette carte en boutique."),
    applePassTypeId: process.env.APPLE_PASS_TYPE_ID || "",
    googleIssuerId: process.env.GOOGLE_ISSUER_ID || "",
    createdAt: new Date().toISOString()
  };
  db.programs.push(program);
  return program;
}

function initialsFor(value) {
  return String(value || "WL").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function createCustomer(db, programId, body) {
  const count = db.customers.filter((customer) => customer.programId === programId).length + 1;
  const customer = {
    id: id("cus"),
    programId,
    memberId: `MEMBER-${String(count).padStart(4, "0")}`,
    name: clean(body.name, "Client"),
    phone: clean(body.phone, ""),
    email: clean(body.email, ""),
    consentMarketing: Boolean(body.consentMarketing),
    createdAt: new Date().toISOString()
  };
  db.customers.push(customer);
  return customer;
}

function issueRewards(db, customerId, program) {
  const balance = balanceFor(db, customerId);
  const earned = Math.floor(balance / program.target);
  const existing = db.rewards.filter((reward) => reward.customerId === customerId && reward.status !== "redeemed").length;
  for (let index = existing; index < earned; index += 1) {
    db.rewards.push({ id: id("rew"), customerId, title: program.rewardRule, status: "available", earnedAt: new Date().toISOString() });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await api(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    sendError(res, 500, error.message || "Erreur serveur");
  }
});

server.listen(PORT, () => {
  console.log(`Wallet loyalty server running on ${BASE_URL}`);
  console.log("Demo login: admin@demo.local / demo1234");
});
