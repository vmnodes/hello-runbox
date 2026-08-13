// RunBox web template — the smallest possible conforming workload:
// listens on PORT, serves /health, uses DATABASE_URL when the platform
// provides one (spec §12: apps request PostgreSQL, receive a dedicated DB).
const http = require("node:http");

const VERSION = "v1";
const port = Number(process.env.PORT ?? 3000);
const env = process.env.RUNBOX_ENVIRONMENT ?? "unknown";

let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.query("CREATE TABLE IF NOT EXISTS visits (id serial PRIMARY KEY, env text NOT NULL, at timestamptz NOT NULL DEFAULT now())")
    .catch((e) => console.error("migration failed:", e.message));
}

// ---- VMnodes publication contract v1 ----------------------------------------
// With a workload token, this app publishes a CURATED entity (per-environment
// visit statistics) into the organisational data plane — never raw tables.
const publishUrl = process.env.VMNODES_API_URL;
const publishToken = process.env.VMNODES_PUBLISH_TOKEN;
if (pool && publishUrl && publishToken) {
  const call = (path, body) => fetch(publishUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${publishToken}` },
    body: JSON.stringify(body),
  });
  const publish = async () => {
    try {
      await call("/v1/publish/entities", {
        entity: "hello.visit-stats",
        description: "Visit counts for the hello application, per environment.",
        classification: "internal",
        queryableFields: [
          { name: "environment", type: "string" },
          { name: "totalVisits", type: "number" },
          { name: "lastVisitAt", type: "timestamp" },
        ],
      });
      const r = await pool.query("SELECT env, count(*)::int AS n, max(at) AS last FROM visits GROUP BY env");
      await call("/v1/publish/records", {
        entity: "hello.visit-stats",
        mode: "snapshot",
        records: r.rows.map((row) => ({
          recordKey: row.env,
          payload: { environment: row.env, totalVisits: row.n, lastVisitAt: row.last },
          sourceUpdatedAt: new Date().toISOString(),
        })),
      });
    } catch (e) { console.error("publish failed:", e.message); }
  };
  setTimeout(publish, 5000);
  setInterval(publish, 60000);
}

http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  const secret = process.env.SECRET_TEST ? "set" : "unset";
  // Demo-only decode of the gateway identity; real apps verify it with
  // @runbox/identity-sdk against <portal>/auth/jwks.
  let who = "anonymous";
  const idToken = req.headers["x-runbox-identity"];
  if (idToken) {
    try {
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
      who = `${payload.email} roles=[${(payload.roles || []).join(",")}]`;
    } catch { who = "bad-token"; }
  }
  let visits = "no-database";
  if (pool) {
    try {
      await pool.query("INSERT INTO visits (env) VALUES ($1)", [env]);
      const r = await pool.query("SELECT count(*)::int AS n FROM visits");
      visits = String(r.rows[0].n);
    } catch (e) {
      visits = "db-error: " + e.message;
    }
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`Hello from VMnodes! version=${VERSION} environment=${env} secret_test=${secret} visits=${visits} user=${who}\n`);
}).listen(port, () => console.log(`hello-web ${VERSION} listening on :${port}`));
