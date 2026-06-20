const http = require("http");

const port = Number(process.env.PORT || 4173);
http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
}).on("error", () => process.exit(1));
