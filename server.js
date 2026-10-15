#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════════
 *  P-Stream standalone static server
 *  ─────────────────────────────────────────────────────────────────
 *  A zero-dependency Node.js static file server with SPA routing,
 *  for users who want to run P-Stream on a VPS without Docker or
 *  nginx.
 *
 *  Usage:
 *    1) Build the app:  pnpm install && pnpm run build
 *    2) Run this server: node server.js
 *       (or: PORT=8080 node server.js)
 *
 *  Environment variables:
 *    PORT        Port to listen on (default: 8080)
 *    HOST        Host to bind to (default: 0.0.0.0)
 *    DIST_DIR    Path to the built static files (default: ./dist)
 * ══════════════════════════════════════════════════════════════════
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DIST_DIR = path.resolve(process.env.DIST_DIR || "./dist");

const MIME_TYPES = {
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
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

const NEVER_CACHE = new Set(["/index.html", "/config.js", "/manifest.json", "/manifest.webmanifest", "/sw.js"]);

if (!fs.existsSync(DIST_DIR)) {
  console.error(`ERROR: dist directory not found at ${DIST_DIR}`);
  console.error("Run `pnpm install && pnpm run build` first.");
  process.exit(1);
}

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  if (!targetPath.startsWith(base)) return null; // path traversal guard
  return targetPath;
}

// ── Metadata + streaming source reverse proxies ───────────────────
// The frontend NEVER talks to streaming upstreams directly:
//
//   • Anime metadata: fetched DIRECTLY from AniList's public GraphQL
//     API (https://graphql.anilist.co) by the browser — AniList fully
//     supports CORS, so no proxy route is needed. The old Jikan
//     (/api/ext/jikan/*) and official-MAL (/api/ext/mal/*) metadata
//     proxies were REMOVED together with those integrations.
//
//   • Streaming servers: customServers/config.ts defines sources with
//     RELATIVE base URLs like `/api/ext/lordflix/api`. This server
//     reverse-proxies them to the real (hidden) upstream APIs — the
//     browser never learns the real hostnames.
//
// Path mapping:  /api/ext/{provider}/{rest}  →  {upstream}/{rest}
// Override any upstream with env vars to point at your own deployment.
//
// `tunnel: true` routes the request through the rotating proxy first
// (falls back to direct if the proxy fails).
//
// `timeout` (ms) is optional — defaults to 20000.
const STREAMING_PROXY_ROUTES = [
  // Anivexa — anime streaming via MAL id:
  //   /watch/anikoto/{malId}/{sub|dub}/anikoto-{episode}?worker=1
  // (streaming only — anime METADATA always comes from AniList directly)
  { prefix: "/api/ext/anivexa/",    upstream: process.env.ANIVEXA_UPSTREAM    || "https://anivexa-api-sigma.vercel.app" },
  // Zoko — anime streaming via MAL id: /api/mal/{sub|dub}/{id}/{episode}
  // (streaming only — anime METADATA always comes from AniList directly)
  { prefix: "/api/ext/zoko/",        upstream: process.env.ZOKO_UPSTREAM        || "https://zoko.speedoflight.buzz" },
//  { prefix: "/api/ext/hable/",       upstream: process.env.HABLE_UPSTREAM       || "https://w7ooimb6vul9vcus77l7yf68.45.43.92.254.sslip.io" },
  { prefix: "/api/ext/nest/",        upstream: process.env.NEST_UPSTREAM        || "https://upwvbg9nirhd0qn76tid7ces.45.43.92.254.sslip.io" },
  // VidRock — Luna (?server=luna) + Orion (?server=orion)
  { prefix: "/api/ext/vidrock/",     upstream: process.env.VIDROCK_UPSTREAM     || "https://vidrock.speedoflight.buzz" },
  // Lordflix — Light (?server=Lisbon) + Space (?server=Scout)
  { prefix: "/api/ext/lordflix/",    upstream: process.env.LORDFLIX_UPSTREAM    || "https://lordflix.speedoflight.buzz" },
//  { prefix: "/api/ext/bingr/",       upstream: process.env.BINGR_UPSTREAM       || "https://r420jyawtqacmm8bfuychtuv.45.43.92.254.sslip.io" },
  // Aether — Tiki (?server=4) + Meridian (?server=2)
//  { prefix: "/api/ext/aether/",      upstream: process.env.AETHER_UPSTREAM      || "https://aether-api.45.43.92.254.sslip.io" },
// { prefix: "/api/ext/opstream/",    upstream: process.env.OPSTREAM_UPSTREAM    || "https://popcorn.speedoflight.buzz" },
  // CinetaroCDN — embek endpoint now hosted on atlantic.speedoflight.buzz
  { prefix: "/api/ext/cinetarocdn/", upstream: process.env.CINETAROCDN_UPSTREAM || "https://atlantic.speedoflight.buzz" },
];

// ── Rotating proxy (generic tunnel for rate-limited upstreams) ───
// Any route marked `tunnel: true` is routed through this rotating HTTP
// proxy (HTTP CONNECT) — the proxy assigns a fresh exit IP per request
// so per-IP rate limits effectively reset every time. (Previously used
// by the removed Jikan/MAL metadata routes; kept for optional use by
// any future rate-limited upstream.) If the proxy is unreachable or
// fails, we automatically fall back to a direct request.
//
// Configure via env var (recommended — no source edit needed):
//   ROTATING_PROXY_URL="http://user:pass@host:port"
//
// Leave empty (the default) to disable the proxy entirely.
const ROTATING_PROXY_URL =
  process.env.ROTATING_PROXY_URL || process.env.JIKAN_PROXY_URL || "";

// ── Redis cache (fast metadata responses, survives restarts) ─────
// Routes with a `cacheTtl` store their 200/JSON responses in redis.
// Same URL → instant reply from redis instead of another upstream
// roundtrip. Streaming routes (zoko etc.) are NEVER cached — their
// stream links can be short-lived. (No current route uses cacheTtl —
// anime metadata is fetched directly from AniList and cached
// client-side — but the mechanism stays available.)
//
// Configure via env (recommended):  REDIS_URL="redis://..."
// If redis is unreachable the app behaves exactly as before (just
// uncached) — every redis call is failure-tolerant.
//
// SECURITY: never hardcode a Redis password here — it lives in git.
// Set REDIS_URL in your hosting dashboard (Coolify/Vercel/PM2 env) instead.
const REDIS_URL = process.env.REDIS_URL || "";

let redis = null;
try {
  if (REDIS_URL) {
    const IORedis = require("ioredis");
    redis = new IORedis(REDIS_URL, {
      lazyConnect: true,       // connect on first use / explicit connect
      maxRetriesPerRequest: 1, // fail fast instead of queueing forever
      connectTimeout: 5000,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 2000, 30000),
    });
    redis.on("error", () => {}); // reconnects are handled by ioredis
    redis.connect().catch(() => {});
  }
} catch (err) {
  console.warn("[redis] init failed — caching disabled:", err.message);
  redis = null;
}

/** Upper bound for redis-cached payloads (metadata JSON is tiny). */
const MAX_CACHE_BODY = 1024 * 1024; // 1 MB

/**
 * Tunnel an HTTPS request through an HTTP proxy using the CONNECT method.
 * Returns a socket that's already connected to the upstream; the caller
 * writes a normal HTTP request through it.
 *
 * Returns null if no proxy is configured. Throws on proxy failure.
 */
function connectViaProxy(targetUrl) {
  const http = require("http");
  const target = new URL(targetUrl);
  const proxyUrl = new URL(ROTATING_PROXY_URL);

  const targetPort = parseInt(target.port, 10) || (target.protocol === "https:" ? 443 : 80);
  const proxyAuth = proxyUrl.username
    ? "Basic " + Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString("base64")
    : "";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Proxy CONNECT timeout")), 12000);

    const connectReq = http.request({
      host: proxyUrl.hostname,
      port: parseInt(proxyUrl.port, 10) || 80,
      method: "CONNECT",
      path: `${target.hostname}:${targetPort}`,
      headers: proxyAuth ? { "Proxy-Authorization": proxyAuth } : {},
    });

    connectReq.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    connectReq.on("connect", (proxyRes, socket) => {
      clearTimeout(timeout);
      if (proxyRes.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT failed: ${proxyRes.statusCode}`));
        return;
      }
      resolve(socket);
    });

    connectReq.end();
  });
}

async function serveStreamingProxy(route, subPath, req, res) {
  // CORS: allow SPA to call us from any origin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, Range");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Reconstruct the upstream URL — preserve the original query string.
  // `req.url` still contains the raw path + query (not yet parsed).
  const rawUrl = req.url || "";
  const qIdx = rawUrl.indexOf("?");
  const queryString = qIdx >= 0 ? rawUrl.slice(qIdx) : "";
  // Encode any spaces / non-ASCII in the path, but keep the slashes.
  const safeSubPath = encodeURI(subPath);
  const targetUrl = route.upstream + safeSubPath + queryString;

  // ── Redis cache fast-path (GET on routes with a cacheTtl) ──
  // Serves the stored upstream answer instantly; on any redis failure
  // we just fall through to the normal uncached flow.
  const cacheKey =
    route.cacheTtl && req.method === "GET" && redis
      ? `cinero:${route.prefix.replace(/\//g, "")}:${safeSubPath}${queryString}`
      : null;
  if (cacheKey) {
    try {
      const hit = await redis.get(cacheKey);
      if (hit) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-Redis-Cache": "HIT",
        });
        res.end(hit);
        return;
      }
    } catch {
      /* redis unavailable — continue uncached */
    }
  }

  // Forward request body (small JSON; safe to buffer)
  const chunks = [];
  let totalLen = 0;
  const MAX_BODY = 256 * 1024; // 256 KB cap
  let aborted = false;

  req.on("data", (chunk) => {
    if (aborted) return;
    totalLen += chunk.length;
    if (totalLen > MAX_BODY) {
      aborted = true;
      req.destroy();
      if (!res.headersSent) {
        res.writeHead(413, { "Content-Type": "text/plain" });
        res.end("Payload Too Large");
      }
      return;
    }
    chunks.push(chunk);
  });
  req.on("error", (err) => {
    console.error(`[streaming-proxy ${route.prefix}] request read error:`, err.message);
    if (!res.headersSent) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request");
    }
  });
  req.on("end", () => {
    if (aborted) return;
    const body = Buffer.concat(chunks);

    // Parse the upstream target so the same options work both through
    // the proxy tunnel and direct.
    const target = new URL(targetUrl);
    const lib = target.protocol === "https:" ? require("https") : require("http");

    // Forward selected headers; drop hop-by-hop ones.
    const inHeaders = req.headers || {};
    const outHeaders = {
      "User-Agent": inHeaders["user-agent"] || "p-stream-streaming-proxy/1.0",
      Accept: inHeaders["accept"] || "application/json, */*",
      "Accept-Language": inHeaders["accept-language"] || "en-US,en;q=0.9",
      Host: target.hostname,
    };
    if (inHeaders["content-type"]) {
      outHeaders["Content-Type"] = inHeaders["content-type"];
    }
    if (inHeaders["x-mal-client-id"]) {
      // Official MAL API v2 auth (X-MAL-CLIENT-ID) must reach upstream.
      outHeaders["X-MAL-CLIENT-ID"] = inHeaders["x-mal-client-id"];
    }
    if (inHeaders["range"]) {
      // Important for HLS byte-range requests on MP4 streams.
      outHeaders["Range"] = inHeaders["range"];
    }
    if (body.length > 0) {
      outHeaders["Content-Length"] = body.length;
    }

    function sendUpstream(socket) {
      const requestOpts = {
        method: req.method,
        hostname: target.hostname,
        port: parseInt(target.port, 10) || (target.protocol === "https:" ? 443 : 80),
        path: target.pathname + target.search,
        headers: outHeaders,
        timeout: route.timeout || 20000, // per-route; default 20s
      };
      if (socket) {
        // Reuse the proxy tunnel socket — no new TCP connection.
        requestOpts.socket = socket;
        requestOpts.agent = false;
        requestOpts.servername = target.hostname; // SNI for TLS
      }
      const upstreamReq = lib.request(requestOpts, (upRes) => {
        // Pass through status + content-type + relevant headers.
        const passHeaders = {
          "Content-Type": upRes.headers["content-type"] || "application/json",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        };
        // Pass through content-length + range-related headers for media.
        for (const h of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
          if (upRes.headers[h]) passHeaders[h] = upRes.headers[h];
        }
        res.writeHead(upRes.statusCode || 502, passHeaders);
        if (cacheKey && (upRes.statusCode || 500) === 200) {
          // Cacheable metadata response — buffer it so we can store a
          // copy in redis while streaming the same bytes to the client.
          const bodyChunks = [];
          let cachedSize = 0;
          let overflow = false;
          upRes.on("data", (c) => {
            cachedSize += c.length;
            if (cachedSize <= MAX_CACHE_BODY) bodyChunks.push(c);
            else overflow = true;
          });
          upRes.on("end", () => {
            res.end();
            if (!overflow) {
              const payload = Buffer.concat(bodyChunks).toString("utf-8");
              redis
                .set(cacheKey, payload, "EX", route.cacheTtl)
                .catch(() => {});
            }
          });
          upRes.on("error", () => res.end());
        } else {
          upRes.pipe(res);
        }
      });
      upstreamReq.on("timeout", () => {
        console.error(`[streaming-proxy ${route.prefix}] upstream timeout: ${targetUrl}`);
        upstreamReq.destroy();
        if (!res.headersSent) {
          res.writeHead(504, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Upstream timeout", upstream: route.upstream }));
        }
      });
      upstreamReq.on("error", (err) => {
        console.error(`[streaming-proxy ${route.prefix}] upstream error${socket ? " (via proxy)" : " (direct)"}:`, err.message);
        if (!res.headersSent) {
          // 502 = bad gateway — player will treat source as failed and fall through.
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Upstream error: ${err.message}`, upstream: route.upstream }));
        } else {
          res.end();
        }
      });
      if (body.length > 0) upstreamReq.write(body);
      upstreamReq.end();
    }

    // Routes marked `tunnel: true` go through the rotating proxy
    // first to bypass per-IP rate limits; on any proxy failure we fall
    // back to a direct request so the app keeps working.
    if (route.tunnel && ROTATING_PROXY_URL) {
      connectViaProxy(targetUrl)
        .then((socket) => sendUpstream(socket))
        .catch((err) => {
          console.warn(`[streaming-proxy ${route.prefix}] proxy failed, falling back to direct:`, err.message);
          sendUpstream(null);
        });
    } else {
      sendUpstream(null);
    }
  });
}

function serve(req, res) {
  const parsed = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsed.pathname || "/");

  // Normalize: strip trailing slash (except root)
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  // Streaming source reverse proxies — must be handled BEFORE the SPA fallback
  for (const route of STREAMING_PROXY_ROUTES) {
    if (pathname.startsWith(route.prefix)) {
      const subPath = pathname.slice(route.prefix.length - 1); // keep leading "/"
      return serveStreamingProxy(route, subPath, req, res);
    }
  }

  // Never-cache routes
  const isNeverCache = NEVER_CACHE.has(pathname);

  // Try the actual file
  let filePath = safeJoin(DIST_DIR, pathname);
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return sendFile(res, filePath, isNeverCache);
  }

  // Try index.html inside the directory
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const idx = path.join(filePath, "index.html");
    if (fs.existsSync(idx)) return sendFile(res, idx, true);
  }

  // SPA fallback: serve /index.html for any unknown route
  const fallback = path.join(DIST_DIR, "index.html");
  if (fs.existsSync(fallback)) return sendFile(res, fallback, true);

  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain");
  res.end("Not Found");
}

function sendFile(res, filePath, neverCache) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const stat = fs.statSync(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", stat.size);

    if (neverCache) {
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=0, must-revalidate");
    } else if (ext === ".js" || ext === ".mjs" || ext === ".css" || ext === ".woff" || ext === ".woff2" || ext === ".wasm") {
      // Fingerprinted assets under /assets/ are safe to cache for a year
      if (filePath.includes("/assets/")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
    } else if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp" || ext === ".svg" || ext === ".ico") {
      res.setHeader("Cache-Control", "public, max-age=604800");
    } else {
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    }

    // Security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      console.error(`Read error for ${filePath}:`, err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain");
        res.end("Internal Server Error");
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error(`Stat error for ${filePath}:`, err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("Internal Server Error");
  }
}

const server = http.createServer((req, res) => {
  // CORS preflight for the optional /proxy endpoint
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }
  serve(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`P-Stream static server listening on http://${HOST}:${PORT}`);
  console.log(`Serving files from: ${DIST_DIR}`);
  console.log(`Press Ctrl+C to stop.`);
});

// Graceful shutdown
function shutdown(sig) {
  console.log(`\n${sig} received, shutting down...`);
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  // Force-close after 5s if connections are stuck
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
