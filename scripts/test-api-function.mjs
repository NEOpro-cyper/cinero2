/**
 * Local test harness for api/ext/[...path].js — simulates how Vercel's
 * Node runtime invokes the function:
 *   - wraps it in a real http server
 *   - parses /api/ext/<segments> and sets req.query.path (catch-all array)
 *   - leaves req.url / headers untouched (platform behaviour)
 *
 * Usage: node scripts/test-api-function.mjs [port]
 * Then curl e.g.:
 *   curl "http://localhost:8898/api/ext/zoko/api/mal/sub/1535/1?worker=1"
 */
import http from "node:http";
import handler from "../api/ext/[...path].js";

const port = parseInt(process.argv[2] || "8898", 10);

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://localhost:${port}`);
  // Vercel catch-all: everything after /api/ext/ → req.query.path array
  const prefix = "/api/ext/";
  let segments = [];
  if (parsed.pathname.startsWith(prefix)) {
    segments = parsed.pathname
      .slice(prefix.length)
      .split("/")
      .filter(Boolean)
      .map((s) => decodeURIComponent(s));
  }
  req.query = { path: segments };

  Promise.resolve(handler(req, res)).catch((err) => {
    console.error("handler threw:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    } else {
      res.end();
    }
  });
});

server.listen(port, () => {
  console.log(`test harness listening on http://localhost:${port}`);
});
