/**
 * ══════════════════════════════════════════════════════════════
 *  Vercel serverless reverse proxy — /api/ext/{provider}/{rest}
 * ══════════════════════════════════════════════════════════════
 *
 *  WHY THIS EXISTS:
 *    The /api/ext/* streaming-server routes live in server.js for
 *    VPS/Docker deployments. Vercel does NOT run server.js — without
 *    this function, every /api/ext/* request falls through the SPA
 *    rewrite in vercel.json and returns index.html (which is exactly
 *    the "server not fetching" bug: the player receives HTML instead
 *    of JSON). This function mirrors server.js's STREAMING_PROXY_ROUTES
 *    so Vercel deployments behave identically to the VPS.
 *
 *  ROUTING:
 *    /api/ext/{provider}/{rest...}?query  →  {upstream}/{rest...}?query
 *
 *    Vercel filesystem functions are matched BEFORE vercel.json
 *    rewrites, so this catch-all cleanly shadows the SPA fallback.
 *
 *  UPSTREAM OVERRIDES (same env names as server.js):
 *    ANIVEXA_UPSTREAM, ZOKO_UPSTREAM, NEST_UPSTREAM, VIDROCK_UPSTREAM,
 *    LORDFLIX_UPSTREAM, VIDFAST_UPSTREAM, XPASS_UPSTREAM,
 *    XPASSPLAY_UPSTREAM, MIAMI_UPSTREAM, VIDORA_UPSTREAM,
 *    CINETAROCDN_UPSTREAM
 *
 *  NOTES:
 *    - Upstream requests use node:https (NOT global fetch/undici).
 *      This matters for the xpassplay route: play.xpass.top is
 *      Cloudflare-protected, and undici's TLS fingerprint gets a 403
 *      challenge while node:https + the browser's User-Agent passes
 *      (verified: https.request → 200, fetch → 403 regardless of
 *      headers). server.js uses node:https for the same reason.
 *    - The browser's User-Agent is forwarded — REQUIRED for the
 *      play.xpass.top Cloudflare check (curl-ish UA gets challenged).
 *    - Responses are Cache-Control: no-store — stream links are
 *      short-lived and must never be cached by the browser/CDN.
 *    - Only JSON APIs are proxied here (m3u8/mp4 streams are fetched
 *      by the player directly / via CORS workers), so buffering the
 *      response is safe.
 * ══════════════════════════════════════════════════════════════
 */

const https = require("node:https");
const http = require("node:http");

const ROUTES = [
  { prefix: "anivexa",     upstream: process.env.ANIVEXA_UPSTREAM     || "https://anivexa-api-sigma.vercel.app" },
  { prefix: "zoko",        upstream: process.env.ZOKO_UPSTREAM        || "https://zoko.speedoflight.buzz" },
  { prefix: "nest",        upstream: process.env.NEST_UPSTREAM        || "https://upwvbg9nirhd0qn76tid7ces.45.43.92.254.sslip.io" },
  // VidRock — Luna (?server=luna) + Vega (?server=orion)
  { prefix: "vidrock",     upstream: process.env.VIDROCK_UPSTREAM     || "https://vidrock.speedoflight.buzz" },
  // Lordflix — Lumen (?server=Lisbon) + Astra (?server=Scout)
  { prefix: "lordflix",    upstream: process.env.LORDFLIX_UPSTREAM    || "https://lordflix.speedoflight.buzz" },
  // Vidfast — Nebula (?server=1) + Quasar (?server=2)
  { prefix: "vidfast",     upstream: process.env.VIDFAST_UPSTREAM     || "https://vidfast.45.43.92.254.sslip.io" },
  // Xpass — Pulsar server-list API
  { prefix: "xpass",       upstream: process.env.XPASS_UPSTREAM       || "https://xpass-api.45.43.92.254.sslip.io" },
  // Xpass playlist host (Cloudflare-protected — see UA note above)
  { prefix: "xpassplay",   upstream: process.env.XPASSPLAY_UPSTREAM   || "https://play.xpass.top" },
  // Solara — Miami lordflix-family API on its own host (?server=miami)
  { prefix: "miami",       upstream: process.env.MIAMI_UPSTREAM       || "https://movy-bz.45.43.92.254.sslip.io" },
  // Zenith — Vidora API
  { prefix: "vidora",      upstream: process.env.VIDORA_UPSTREAM      || "https://movies-api.45.43.92.254.sslip.io" },
  // CinetaroCDN — embek endpoint
  { prefix: "cinetarocdn", upstream: process.env.CINETAROCDN_UPSTREAM || "https://atlantic.speedoflight.buzz" },
];

const UPSTREAM_TIMEOUT_MS = 15000;
const MAX_BODY = 256 * 1024; // 256 KB cap (JSON APIs only)
const MAX_RESPONSE = 8 * 1024 * 1024; // 8 MB safety cap

/**
 * Perform an upstream request via node:https/node:http.
 * Deliberately NOT global fetch — see the TLS-fingerprint note above.
 * Resolves { status, headers, buffer }.
 */
function requestUpstream(target, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      reject(new Error(`Invalid upstream URL: ${target}`));
      return;
    }
    const lib = targetUrl.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: method === "HEAD" ? "HEAD" : method,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        headers,
        signal,
      },
      (upRes) => {
        const chunks = [];
        let size = 0;
        let overflow = false;
        upRes.on("data", (c) => {
          if (overflow) return;
          size += c.length;
          if (size > MAX_RESPONSE) {
            overflow = true;
            req.destroy(new Error("Response too large"));
            return;
          }
          chunks.push(c);
        });
        upRes.on("end", () => {
          if (!overflow) {
            resolve({
              status: upRes.statusCode || 502,
              headers: upRes.headers,
              buffer: Buffer.concat(chunks),
            });
          }
        });
        upRes.on("error", (e) => {
          if (!overflow) reject(e);
        });
      },
    );
    req.on("error", (e) => reject(e));
    if (body && body.length > 0) req.write(body);
    req.end();
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let overflow = false;
    req.on("data", (c) => {
      if (overflow) return;
      total += c.length;
      if (total > MAX_BODY) {
        overflow = true;
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!overflow) resolve(Buffer.concat(chunks));
    });
    req.on("error", () => {
      if (!overflow) resolve(Buffer.alloc(0));
    });
  });
}

// ── Same-origin guard ─────────────────────────────────────────────
// /api/ext/* must only be usable by OUR frontend. Requests without an
// Origin/Referer matching this deployment (curl, address-bar, other
// sites) get 403 instead of the proxied upstream response.
// Knobs: DISABLE_ORIGIN_GUARD=1, EXTRA_ALLOWED_ORIGINS=a.com,b.org
function proxyRequestAllowed(req) {
  if (process.env.DISABLE_ORIGIN_GUARD === "1") return true;
  const host = String(req.headers.host || "").toLowerCase().split(":")[0];
  const extra = new Set(
    (process.env.EXTRA_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").split(":")[0])
      .filter(Boolean)
  );
  const isLocal = (h) =>
    h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" ||
    h === "[::1]" || h.endsWith(".localhost");
  const matches = (raw) => {
    try {
      const h = new URL(raw).hostname.toLowerCase();
      return (!!host && h === host) || extra.has(h) || isLocal(h);
    } catch {
      return false;
    }
  };
  const origin = req.headers.origin;
  if (origin && origin !== "null") return matches(origin);
  const referer = req.headers.referer;
  if (referer) return matches(referer);
  return false; // curl / address-bar / server-side scripts
}

module.exports = async function handler(req, res) {
  // Protection: don't leak the upstream JSON to non-same-origin visitors.
  if (!proxyRequestAllowed(req)) {
    res.writeHead(403, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(),
    });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  // CORS preflight (requests are same-origin in practice — kept for safety)
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // Catch-all segments from the filesystem route ([...path])
  const rawSegments = req.query && req.query.path;
  const segments = Array.isArray(rawSegments)
    ? rawSegments
    : rawSegments
      ? [rawSegments]
      : [];
  const provider = segments.length > 0 ? String(segments[0]) : "";
  const route = ROUTES.find((r) => r.prefix === provider);

  if (!route) {
    res.writeHead(404, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(),
    });
    res.end(
      JSON.stringify({
        error: `Unknown /api/ext/ provider: ${provider || "(none)"}`,
        known: ROUTES.map((r) => r.prefix),
      }),
    );
    return;
  }

  // Preserve the original query string verbatim (?worker=1&server=...)
  const rawUrl = req.url || "/";
  const qi = rawUrl.indexOf("?");
  const search = qi >= 0 ? rawUrl.slice(qi) : "";
  const target = `${route.upstream}/${segments.slice(1).join("/")}${search}`;

  // Forward selected headers; the browser UA is REQUIRED for
  // play.xpass.top's Cloudflare check (xpassplay route).
  const outHeaders = {
    Accept: req.headers["accept"] || "application/json, */*",
  };
  if (req.headers["user-agent"]) {
    outHeaders["User-Agent"] = req.headers["user-agent"];
  }
  if (req.headers["content-type"]) {
    outHeaders["Content-Type"] = req.headers["content-type"];
  }
  if (req.headers["range"]) {
    outHeaders["Range"] = req.headers["range"];
  }

  // Forward request body for non-GET requests (JSON APIs — small)
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await readBody(req);
    if (body === null) {
      res.writeHead(413, {
        "Content-Type": "application/json",
        ...corsHeaders(),
      });
      res.end(JSON.stringify({ error: "Payload Too Large" }));
      return;
    }
    if (body.length > 0) outHeaders["Content-Length"] = body.length;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const { status, headers: upHeaders, buffer } = await requestUpstream(
      target,
      {
        method: req.method,
        headers: outHeaders,
        body,
        signal: controller.signal,
      },
    );

    const resHeaders = {
      "Content-Type": upHeaders["content-type"] || "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(),
    };
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      if (upHeaders[h]) resHeaders[h] = upHeaders[h];
    }

    res.writeHead(status, resHeaders);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(buffer);
  } catch (err) {
    const msg =
      err && err.name === "AbortError"
        ? "Upstream timeout"
        : `Upstream error: ${(err && err.message) || String(err)}`;
    console.error(`[api/ext ${route.prefix}] ${msg} — ${target}`);
    if (!res.headersSent) {
      res.writeHead(502, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...corsHeaders(),
      });
      res.end(JSON.stringify({ error: msg, upstream: route.upstream }));
    } else {
      res.end();
    }
  } finally {
    clearTimeout(timer);
  }
};
