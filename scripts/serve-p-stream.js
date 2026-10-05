#!/usr/bin/env node
/**
 * Standalone static file server for P-Stream SPA.
 * Use on a VPS as a lightweight alternative to nginx.
 *
 * Usage:
 *   PORT=8080 node scripts/serve-p-stream.js
 *   # or
 *   PORT=8080 node scripts/serve-p-stream.js /path/to/dist
 *
 * Features:
 *   - SPA fallback (any non-asset route -> index.html)
 *   - Long-cache headers for /assets/*
 *   - Real 404 for missing files with extensions
 *   - Security headers
 *   - Zero dependencies (uses only Node.js built-ins)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2] || path.join(__dirname, "..", "dist");
const PORT = parseInt(process.env.PORT || "8080", 10);
const INDEX_HTML = path.join(ROOT, "index.html");

if (!fs.existsSync(INDEX_HTML)) {
  console.error(`[p-stream] index.html not found at ${INDEX_HTML}`);
  console.error(`[p-stream] Did you run "pnpm run build" first?`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

const IMMUTABLE_EXT = new Set([".js", ".mjs", ".css", ".woff", ".woff2", ".wasm"]);

function serve(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath.includes("..")) {
    res.statusCode = 400;
    res.end("Bad Request");
    return;
  }

  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  const filePath = path.join(ROOT, urlPath);

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      if (/\.[a-zA-Z0-9]+$/.test(urlPath) && !urlPath.endsWith(".html")) {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }
      fs.readFile(INDEX_HTML, (e2, data) => {
        if (e2) {
          res.statusCode = 500;
          res.end("Internal Server Error");
          return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(data);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    res.setHeader("Content-Type", mime);

    if (IMMUTABLE_EXT.has(ext) && urlPath.startsWith("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "origin-when-cross-origin");

    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(serve);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[p-stream] static server listening on http://0.0.0.0:${PORT}`);
  console.log(`[p-stream] serving from ${ROOT}`);
});
