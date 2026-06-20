const app = {
  user: null,
  program: null,
  wallet: null,
  merchants: [],
  adminStats: null,
  customers: [],
  campaigns: [],
  stats: null,
  selectedCustomer: null,
  selectedMerchantId: null,
  cameraStream: null,
  scanTimer: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data.error || "Erreur API");
  return data;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}

function showApp(visible) {
  $("#loginScreen").classList.toggle("hidden", visible);
  $("#appShell").classList.toggle("hidden", !visible);
}

function isAdmin() {
  return app.user?.role === "super_admin";
}

function defaultView() {
  return isAdmin() ? "admin-dashboard" : "merchant-dashboard";
}

function showView(view) {
  $$(".view").forEach((el) => el.classList.remove("active"));
  const target = $(`#view-${view}`) || $(`#view-${defaultView()}`);
  target.classList.add("active");
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === target.id.replace("view-", "")));
  const title = {
    "admin-dashboard": "Super admin",
    "admin-merchants": "Commerces",
    "admin-design": "Design carte",
    "admin-deploy": "Deploiement",
    "merchant-dashboard": "Dashboard commerce",
    "merchant-customers": "Clients",
    "merchant-scan": "Scan boutique",
    "merchant-campaigns": "Campagnes",
    "merchant-settings": "Settings"
  }[target.id.replace("view-", "")];
  $("#pageTitle").textContent = title;
  history.replaceState(null, "", `#${target.id.replace("view-", "")}`);
}

function pseudoQr(container, seed) {
  container.innerHTML = "";
  let hash = 0;
  for (const char of String(seed || "MEMBER-0001")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  for (let index = 0; index < 81; index += 1) {
    const finder = (index < 21 && index % 9 < 3) || (index < 27 && index % 9 > 5) || (index > 53 && index % 9 < 3);
    const bit = ((hash >> (index % 24)) + index * 7) % 3 !== 0;
    const cell = document.createElement("span");
    cell.className = `qr-cell ${finder || bit ? "" : "off"}`;
    container.appendChild(cell);
  }
}

function stampHtml(target, filled) {
  return Array.from({ length: Number(target || 10) }, (_, index) => `<span class="stamp ${index < filled ? "filled" : ""}"></span>`).join("");
}

function walletStatusHtml(wallet) {
  return `<div class="status-list">${[
    ["Apple Wallet", wallet.apple],
    ["Google Wallet", wallet.google]
  ].map(([name, status]) => `
    <div class="status-row">
      <strong>${name}<span class="${status.ready ? "status-ok" : "status-missing"}">${status.ready ? "Pret" : "A configurer"}</span></strong>
      <p class="muted">${status.ready ? "Emission reelle active." : `Variables manquantes : ${status.missing.join(", ")}`}</p>
    </div>
  `).join("")}</div>`;
}

async function boot() {
  try {
    const me = await api("/api/me");
    app.user = me.merchant;
    app.program = me.program;
    app.wallet = me.wallet;
    $("#accountName").textContent = app.user.businessName;
    $("#accountRole").textContent = app.user.role === "super_admin" ? "Super admin" : `Plan ${app.user.plan}`;
    $("#adminNav").classList.toggle("hidden", !isAdmin());
    $("#merchantNav").classList.toggle("hidden", isAdmin());
    $("#joinLink").classList.toggle("hidden", isAdmin());
    $("#exportButton").classList.toggle("hidden", isAdmin());
    showApp(true);
    if (isAdmin()) await refreshAdmin();
    else await refreshMerchant();
    showView(location.hash.replace("#", "") || defaultView());
  } catch {
    showApp(false);
  }
}

async function refreshAdmin() {
  const [stats, merchants] = await Promise.all([
    api("/api/admin/stats"),
    api("/api/admin/merchants")
  ]);
  app.adminStats = stats;
  app.merchants = merchants.merchants;
  app.selectedMerchantId ||= app.merchants[0]?.id;
  renderAdmin();
}

function selectedMerchant() {
  return app.merchants.find((merchant) => merchant.id === app.selectedMerchantId) || app.merchants[0];
}

function renderAdmin() {
  $("#adminStatMerchants").textContent = app.adminStats.merchants;
  $("#adminStatActive").textContent = app.adminStats.activeMerchants;
  $("#adminStatCustomers").textContent = app.adminStats.customers;
  $("#adminStatTransactions").textContent = app.adminStats.transactions;
  renderMerchantList();
  renderDesignSelect();
  renderDesignForm();
  $("#adminWalletStatus").innerHTML = walletStatusHtml(app.wallet);
  renderAdminPassPreview();
}

function renderMerchantList() {
  const query = ($("#merchantSearch")?.value || "").toLowerCase();
  const merchants = app.merchants.filter((merchant) => [merchant.businessName, merchant.email, merchant.slug, merchant.plan].join(" ").toLowerCase().includes(query));
  $("#merchantList").innerHTML = merchants.map((merchant) => `
    <article class="merchant-item ${merchant.id === app.selectedMerchantId ? "selected" : ""}">
      <div>
        <strong>${escapeHtml(merchant.businessName)}</strong>
        <p>${escapeHtml(merchant.email)} - <span class="tag">${escapeHtml(merchant.plan)}</span> <span class="tag">${escapeHtml(merchant.status)}</span></p>
        <small>${merchant.customersCount} client(s) - ${merchant.transactionsCount} scan(s)</small>
      </div>
      <div class="mini-actions">
        <a class="secondary" href="${merchant.joinUrl}" target="_blank" rel="noreferrer">Lien client</a>
        <button class="secondary select-merchant" data-id="${merchant.id}" type="button">Designer</button>
      </div>
    </article>
  `).join("") || "<p class=\"muted\">Aucun commerce.</p>";
}

function renderDesignSelect() {
  $("#designMerchantSelect").innerHTML = app.merchants.map((merchant) => `<option value="${merchant.id}">${escapeHtml(merchant.businessName)}</option>`).join("");
  $("#designMerchantSelect").value = app.selectedMerchantId || "";
}

function renderDesignForm() {
  const merchant = selectedMerchant();
  if (!merchant?.program) return;
  const p = merchant.program;
  $("#designProgramName").value = p.name;
  $("#designRewardRule").value = p.rewardRule;
  $("#designTarget").value = p.target;
  $("#designStampValue").value = p.stampValue;
  $("#designBrandColor").value = p.brandColor;
  $("#designAccentColor").value = p.accentColor;
  $("#designTextColor").value = p.cardTextColor || "#ffffff";
  $("#designLogoText").value = p.logoText || "";
  $("#designHeroText").value = p.cardHeroText || "";
  $("#designFooterText").value = p.cardFooterText || "";
  renderAdminPassPreview();
}

function renderAdminPassPreview() {
  const merchant = selectedMerchant();
  if (!merchant?.program) return;
  const p = merchant.program;
  const previews = [
    ["adminWalletPreview", "adminPassLogo", "adminPassMerchant", "adminPassProgram", "adminPassRule", "adminStampGrid", "adminQrPreview"],
    ["designPreview", "designPreviewLogo", "designPreviewMerchant", "designPreviewProgram", "designPreviewHero", "designPreviewStamps", "designQrPreview"]
  ];
  for (const [cardId, logoId, merchantId, programId, textId, stampsId, qrId] of previews) {
    const card = $(`#${cardId}`);
    if (!card) continue;
    card.style.background = p.brandColor;
    card.style.color = p.cardTextColor || "#ffffff";
    $(`#${logoId}`).textContent = p.logoText || "WL";
    $(`#${merchantId}`).textContent = merchant.businessName;
    $(`#${programId}`).textContent = p.name;
    $(`#${textId}`).textContent = cardId === "designPreview" ? (p.cardHeroText || p.rewardRule) : p.rewardRule;
    $(`#${stampsId}`).innerHTML = stampHtml(p.target, 4);
    pseudoQr($(`#${qrId}`), merchant.slug);
  }
  $("#designPreviewFooter").textContent = p.cardFooterText || "Presentez cette carte en boutique.";
}

async function refreshMerchant() {
  const [customers, stats, campaigns] = await Promise.all([
    api("/api/customers"),
    api("/api/stats"),
    api("/api/campaigns")
  ]);
  app.customers = customers.customers;
  app.stats = stats;
  app.campaigns = campaigns.campaigns;
  app.selectedCustomer = app.selectedCustomer ? app.customers.find((customer) => customer.id === app.selectedCustomer.id) : app.customers[0];
  renderMerchant();
}

function renderMerchant() {
  const joinUrl = `${location.origin}/join/${app.user.slug}`;
  $("#joinLink").href = joinUrl;
  $("#merchantJoinUrl").value = joinUrl;
  $("#statClients").textContent = app.stats.clients;
  $("#statScans").textContent = app.stats.scans;
  $("#statRewards").textContent = app.stats.rewards;
  $("#statPoints").textContent = app.stats.points;
  $("#programName").value = app.program.name;
  $("#rewardRule").value = app.program.rewardRule;
  $("#target").value = app.program.target;
  $("#stampValue").value = app.program.stampValue;
  $("#walletStatus").innerHTML = walletStatusHtml(app.wallet);
  renderPass();
  renderCustomers();
  renderCampaigns();
}

function renderPass() {
  const customer = app.selectedCustomer || app.customers[0];
  const p = app.program;
  $("#merchantWalletPass").style.background = p.brandColor;
  $("#merchantWalletPass").style.color = p.cardTextColor || "#ffffff";
  $("#passLogo").textContent = p.logoText || "WL";
  $("#passMerchant").textContent = app.user.businessName;
  $("#passProgram").textContent = p.name;
  $("#passRule").textContent = p.cardHeroText || p.rewardRule;
  $("#passPoints").textContent = customer ? `${customer.cyclePoints} / ${p.target}` : `0 / ${p.target}`;
  $("#memberPreview").textContent = customer ? customer.memberId : "AUCUNE CARTE";
  $("#stampGrid").innerHTML = stampHtml(p.target, customer?.cyclePoints || 0);
  pseudoQr($("#qrPreview"), customer?.memberId || app.user.slug);
}

function renderCustomers() {
  const q = ($("#customerSearch")?.value || "").toLowerCase();
  const rows = app.customers.filter((customer) => [customer.name, customer.phone, customer.email, customer.memberId].join(" ").toLowerCase().includes(q));
  $("#customersTable").innerHTML = rows.map((customer) => `
    <tr>
      <td><strong>${escapeHtml(customer.name)}</strong><br><small>${new Date(customer.createdAt).toLocaleDateString("fr-FR")}</small></td>
      <td>${escapeHtml(customer.phone)}<br><small>${escapeHtml(customer.email || "")}</small></td>
      <td><button class="ghost pick-customer" data-id="${customer.id}" type="button">${customer.memberId}</button></td>
      <td><span class="tag">${customer.cyclePoints} / ${app.program.target}</span></td>
      <td><div class="mini-actions"><a class="secondary" href="${customer.passUrls.apple}" target="_blank" rel="noreferrer">Apple</a><a class="secondary" href="${customer.passUrls.google}" target="_blank" rel="noreferrer">Google</a></div></td>
      <td><button class="secondary send-scan" data-member="${customer.memberId}" type="button">Scanner</button></td>
    </tr>
  `).join("") || "<tr><td colspan=\"6\">Aucun client.</td></tr>";
}

function renderCampaigns() {
  $("#campaignList").innerHTML = app.campaigns.length ? app.campaigns.map((campaign) => `
    <article class="campaign-item"><strong>${escapeHtml(campaign.title)} <span class="tag">${campaign.channel}</span></strong><p>${escapeHtml(campaign.message)}</p><small>${campaign.recipients} destinataire(s)</small></article>
  `).join("") : "<p class=\"muted\">Aucune campagne.</p>";
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: $("#loginEmail").value, password: $("#loginPassword").value }) });
    await boot();
    toast("Connecte.");
  } catch (error) {
    toast(error.message);
  }
});

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  showApp(false);
  toast("Deconnecte.");
});

document.addEventListener("click", async (event) => {
  const nav = event.target.closest(".nav-button");
  if (nav) showView(nav.dataset.view);

  const selected = event.target.closest(".select-merchant");
  if (selected) {
    app.selectedMerchantId = selected.dataset.id;
    renderDesignSelect();
    renderDesignForm();
    showView("admin-design");
  }

  const picker = event.target.closest(".pick-customer");
  if (picker) {
    app.selectedCustomer = app.customers.find((customer) => customer.id === picker.dataset.id);
    $("#scanMemberId").value = app.selectedCustomer.memberId;
    renderPass();
    toast("Carte selectionnee.");
  }

  const scan = event.target.closest(".send-scan");
  if (scan) {
    $("#scanMemberId").value = scan.dataset.member;
    showView("merchant-scan");
  }
});

$("#merchantSearch").addEventListener("input", renderMerchantList);
$("#customerSearch").addEventListener("input", renderCustomers);
$("#designMerchantSelect").addEventListener("change", () => {
  app.selectedMerchantId = $("#designMerchantSelect").value;
  renderDesignForm();
});
["designProgramName", "designRewardRule", "designTarget", "designBrandColor", "designAccentColor", "designTextColor", "designLogoText", "designHeroText", "designFooterText"].forEach((id) => {
  $(`#${id}`).addEventListener("input", () => {
    const merchant = selectedMerchant();
    if (!merchant?.program) return;
    Object.assign(merchant.program, {
      name: $("#designProgramName").value,
      rewardRule: $("#designRewardRule").value,
      target: Number($("#designTarget").value),
      stampValue: Number($("#designStampValue").value),
      brandColor: $("#designBrandColor").value,
      accentColor: $("#designAccentColor").value,
      cardTextColor: $("#designTextColor").value,
      logoText: $("#designLogoText").value,
      cardHeroText: $("#designHeroText").value,
      cardFooterText: $("#designFooterText").value
    });
    renderAdminPassPreview();
  });
});

$("#merchantCreateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/admin/merchants", {
      method: "POST",
      body: JSON.stringify({
        businessName: $("#newBusinessName").value,
        ownerName: $("#newOwnerName").value,
        email: $("#newEmail").value,
        password: $("#newPassword").value,
        plan: $("#newPlan").value,
        slug: $("#newSlug").value
      })
    });
    app.selectedMerchantId = result.merchant.id;
    $("#merchantCreateForm").reset();
    $("#newPassword").value = "demo1234";
    await refreshAdmin();
    toast("Commerce cree.");
  } catch (error) {
    toast(error.message);
  }
});

$("#adminDesignForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api(`/api/admin/merchants/${app.selectedMerchantId}/design`, {
      method: "PATCH",
      body: JSON.stringify({
        name: $("#designProgramName").value,
        rewardRule: $("#designRewardRule").value,
        target: Number($("#designTarget").value),
        stampValue: Number($("#designStampValue").value),
        brandColor: $("#designBrandColor").value,
        accentColor: $("#designAccentColor").value,
        cardTextColor: $("#designTextColor").value,
        logoText: $("#designLogoText").value,
        cardHeroText: $("#designHeroText").value,
        cardFooterText: $("#designFooterText").value
      })
    });
    await refreshAdmin();
    toast("Design sauvegarde.");
  } catch (error) {
    toast(error.message);
  }
});

$("#programForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/program", { method: "PATCH", body: JSON.stringify({ name: $("#programName").value, rewardRule: $("#rewardRule").value, target: Number($("#target").value), stampValue: Number($("#stampValue").value) }) });
  const me = await api("/api/me");
  app.program = me.program;
  await refreshMerchant();
  toast("Programme mis a jour.");
});

$("#scanForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/scan", { method: "POST", body: JSON.stringify({ memberId: $("#scanMemberId").value, points: Number($("#scanPoints").value) }) });
    app.selectedCustomer = result.customer;
    $("#scanResult").innerHTML = `<strong>${escapeHtml(result.customer.name)}</strong><span>Solde : ${result.customer.cyclePoints} / ${app.program.target}. Recompenses disponibles : ${result.customer.rewardsAvailable}.</span>`;
    await refreshMerchant();
    toast("Points ajoutes.");
  } catch (error) {
    $("#scanResult").textContent = error.message;
    toast(error.message);
  }
});

$("#redeemButton").addEventListener("click", async () => {
  try {
    const result = await api("/api/redeem", { method: "POST", body: JSON.stringify({ memberId: $("#scanMemberId").value }) });
    app.selectedCustomer = result.customer;
    $("#scanResult").innerHTML = `<strong>${escapeHtml(result.customer.name)}</strong><span>Recompense utilisee. Solde : ${result.customer.cyclePoints} / ${app.program.target}.</span>`;
    await refreshMerchant();
    toast("Recompense utilisee.");
  } catch (error) {
    $("#scanResult").textContent = error.message;
    toast(error.message);
  }
});

$("#campaignForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/campaigns", { method: "POST", body: JSON.stringify({ title: $("#campaignTitle").value, message: $("#campaignMessage").value, channel: $("#campaignChannel").value }) });
  $("#campaignForm").reset();
  await refreshMerchant();
  toast("Campagne preparee.");
});

$("#exportButton").addEventListener("click", async () => {
  const data = await api("/api/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "wallet-loyalty-export.json";
  link.click();
  URL.revokeObjectURL(url);
});

$("#startCamera").addEventListener("click", async () => {
  try {
    if (!("BarcodeDetector" in window)) {
      toast("BarcodeDetector non supporte. Utilise la saisie manuelle.");
      return;
    }
    app.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = $("#cameraPreview");
    video.srcObject = app.cameraStream;
    video.classList.remove("hidden");
    await video.play();
    const detector = new BarcodeDetector({ formats: ["qr_code", "code_128"] });
    app.scanTimer = setInterval(async () => {
      const codes = await detector.detect(video).catch(() => []);
      if (codes[0]?.rawValue) $("#scanMemberId").value = codes[0].rawValue;
    }, 900);
  } catch (error) {
    toast(`Camera indisponible: ${error.message}`);
  }
});

$("#stopCamera").addEventListener("click", () => {
  clearInterval(app.scanTimer);
  app.cameraStream?.getTracks().forEach((track) => track.stop());
  $("#cameraPreview").classList.add("hidden");
});

window.addEventListener("hashchange", () => {
  const view = location.hash.replace("#", "") || defaultView();
  if ($(`#view-${view}`)) showView(view);
});

boot();
