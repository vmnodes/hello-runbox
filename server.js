// RunBox web template — the smallest possible conforming workload:
// listens on PORT, serves /health, reads RUNBOX_ENVIRONMENT.
const http = require("node:http");

const VERSION = "v1";
const port = Number(process.env.PORT ?? 3000);
const env = process.env.RUNBOX_ENVIRONMENT ?? "unknown";

http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  // Presence check only — a real app would USE the secret, never print it.
  const secret = process.env.SECRET_TEST ? "set" : "unset";
  res.end(`Hello from RunBox! version=${VERSION} environment=${env} secret_test=${secret}\n`);
}).listen(port, () => console.log(`hello-web ${VERSION} listening on :${port}`));
