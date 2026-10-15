# P-Stream — Deployment Guide

This guide covers **three** deployment paths:

1. **Vercel** (zero-config, free tier friendly)
2. **VPS with Docker** (recommended for production)
3. **VPS without Docker** (Node.js static server)

---

## 0. Prerequisites — Get a TMDB API key

P-Stream needs a TMDB Read API key to fetch movie/show metadata.

1. Create a free account at <https://www.themoviedb.org/>.
2. Go to **Settings → API** and request an API key.
3. Copy the **API Read Access Token** (a long JWT) — that's your `VITE_TMDB_READ_API_KEY`.

You'll also want a **CORS proxy** for in-browser playback of cross-origin HLS streams. Options:

- Use a public one like `https://corsproxy.io/?url=` (rate-limited, not for production).
- Deploy your own Cloudflare Worker using [`@p-stream/simple-proxy`](https://github.com/p-stream/simple-proxy) — the recommended approach. Free tier is generous.
- Or skip the CORS proxy and use the [P-Stream browser extension](https://p-stream.github.io/docs/extension) which proxies requests in-browser.

---

## 1. Vercel deployment (zero-config)

The repo ships with a `vercel.json` that handles SPA routing and asset caching.

### Option A — Deploy via the Vercel dashboard

1. Push this repo to GitHub/GitLab.
2. Go to <https://vercel.com/new> and import the repo.
3. Vercel auto-detects Vite. Override the build command and output dir if needed:
   - **Build Command:** `pnpm install --frozen-lockfile && pnpm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `pnpm install --frozen-lockfile`
4. Under **Environment Variables**, add at minimum:
   - `VITE_TMDB_READ_API_KEY` — your TMDB key
   - `VITE_CORS_PROXY_URL` — your CORS proxy URL (e.g. `https://your-worker.workers.dev/?url=`)
   - `VITE_APP_DOMAIN` — your Vercel domain (e.g. `https://your-app.vercel.app`)
   - `VITE_NORMAL_ROUTER` — `true`
5. Click **Deploy**.

### Option B — Deploy via the Vercel CLI

```bash
npm i -g vercel
vercel link              # link this folder to a Vercel project
vercel env add VITE_TMDB_READ_API_KEY
vercel env add VITE_CORS_PROXY_URL
vercel env add VITE_APP_DOMAIN
vercel env add VITE_NORMAL_ROUTER
vercel --prod            # deploy to production
```

### Runtime config (no rebuild needed)

Vercel doesn't allow editing files post-build, so runtime config goes through env vars. To change config without redeploying, use the [Vercel dashboard → Settings → Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables), then trigger a redeploy.

---

## 2. VPS deployment with Docker (recommended for production)

The Dockerfile builds the app with `pnpm`, then serves it via nginx with proper SPA routing, gzip, security headers, and asset caching.

### Quick start

```bash
# 1. Build the image
docker build -t p-stream .

# 2. Run on port 80
docker run -d \
  --name p-stream \
  -p 80:80 \
  -v $(pwd)/config.js:/usr/share/nginx/html/config.js \
  --restart unless-stopped \
  p-stream
```

### With `docker-compose`

```bash
# 1. Edit config.js to set your TMDB key + CORS proxy
$EDITOR config.js

# 2. Build and start
docker compose up -d --build
```

The included `docker-compose.yaml` mounts `./config.js` as a volume, so you can edit runtime config (TMDB key, CORS proxy, backend URL) without rebuilding the image — just edit the file and run `docker restart p-stream`.

### Customizing the build

To bake config into the image at build time, edit `docker-compose.yaml` and uncomment the `args:` section, then run `docker compose up -d --build`.

### Reverse proxy (HTTPS)

For HTTPS, put Caddy / Traefik / nginx in front:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Or use Caddy for auto-HTTPS:

```Caddyfile
your-domain.com {
    reverse_proxy 127.0.0.1:80
}
```

---

## 3. VPS deployment without Docker (Node.js static server)

For users who can't or don't want to use Docker.

### Prerequisites

- Node.js 20+
- pnpm 9+ (`npm i -g pnpm`)

### Steps

```bash
# 1. Install dependencies
pnpm install --frozen-lockfile

# 2. Set build-time env vars (optional — runtime config goes in config.js)
cp example.env .env
$EDITOR .env

# 3. Build the production bundle
pnpm run build

# 4. Edit runtime config
$EDITOR config.js   # set VITE_TMDB_READ_API_KEY and VITE_CORS_PROXY_URL

# 5. Start the standalone static server
pnpm run serve
# or: PORT=80 node server.js
```

### Running as a systemd service

Create `/etc/systemd/system/p-stream.service`:

```ini
[Unit]
Description=P-Stream static server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/p-stream
Environment=PORT=8080
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/p-stream/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now p-stream
sudo systemctl status p-stream
```

### Reverse proxy (HTTPS)

Same as the Docker section — put Caddy / nginx in front, proxying to `127.0.0.1:8080`.

---

## 4. Custom API servers

This fork ships with a custom API servers module at `src/backend/customServers/`. Servers are defined in `src/backend/customServers/config.ts` and currently include:

| Name         | responseType       | Upstream API                                   |
|--------------|--------------------|------------------------------------------------|
| Sakura       | `anivexa`          | anivexa-api-sigma.vercel.app (anime, MAL ids)  |
| Kitsune      | `zoko`             | zoko.speedoflight.buzz (anime, MAL ids)        |
| Nebula       | `vidfast`          | vidfast.45.43.92.254.sslip.io (server=1)       |
| Quasar       | `vidfast`          | vidfast.45.43.92.254.sslip.io (server=2)       |
| Pulsar       | `xpass`            | xpass-api.45.43.92.254.sslip.io (server=1)     |
| Comet        | `vidnest`          | upwvbg9nirhd0qn76tid7ces.45.43.92.254.sslip.io |
| Vega         | `sources`          | vidrock.speedoflight.buzz (server=orion)       |
| Astra        | `lordflix`         | lordflix.speedoflight.buzz (server=Scout)      |
| Solara       | `lordflix`         | movy-bz.45.43.92.254.sslip.io (server=miami)   |
| Zenith       | `vidora`           | movies-api.45.43.92.254.sslip.io               |
| Lumen        | `lordflix`         | lordflix.speedoflight.buzz (server=Lisbon)     |
| CinetaroCDN  | `qualities`        | atlantic.speedoflight.buzz                     |

### How it works

- Custom servers are injected into the source picker alongside the bundled `@p-stream/providers` scrapers. They appear at the end of the source list.
- During **auto-scrape**, custom servers are tried FIRST. If any succeeds, the bundled scrapers are skipped. If all custom servers fail, the player falls through to the bundled scrapers.
- During **manual selection**, picking a custom server bypasses the bundled scraper entirely and uses our own fetcher.
- Each server's `responseType` is dispatched to a dedicated adapter in `src/backend/customServers/adapters.ts`. Adapters are defensive — they probe multiple known shapes and fall back to a deep URL scan if the documented shape isn't found.

### Adding / editing servers

Edit `src/backend/customServers/config.ts`:

```ts
{
  name: "My Server",
  base: "https://example.com/api",
  path: "https://example.com/api/movie/{id}",
  tvPath: "https://example.com/api/tv/{id}/{season}/{episode}",
  responseType: "stream_url",   // see adapters.ts for all supported types
  timeout: 12000,
  headers: { "X-Custom": "value" },
  streamProxy: "https://my-cors-proxy.workers.dev/",  // optional
}
```

Supported `responseType` values (defined in `adapters.ts`):

| responseType      | Expected response shape                                          |
|-------------------|------------------------------------------------------------------|
| `stream`          | `{ stream: "url" }` or `{ url: "url" }` or plain URL string      |
| `streams`         | `{ streams: ["url1", "url2"] }` or `[{url:"..."}]`               |
| `stream_url` / `streamUrl` | `{ streamUrl: "url" }` or `{ stream_url: "url" }`       |
| `qualities`       | `{ qualities: { "1080p": "url", "720p": "url" } }` or `{ sources: [{quality, url}] }` |
| `source_string`   | Plain text URL                                                   |
| `source_object`   | `{ source: "url" }` or `{ url: "url" }`                          |
| `sources`         | `{ sources: [{ name, url, type:"hls" }] }`                       |
| `opstream`        | OpStream API v2 (`{ success, streamUrl, captions, kind }`)       |
| `bingr`           | Bingr API (`{ servers: [{ sources: [{url, quality, headers}], subtitles }] }`) |
| `aether_tiki`     | Aether server=4 (`{ ok, data: { streams: [{url, type}] } }`)     |
| `aether_meridian` | Aether server=2 (`{ ok, data: { url, subtitles } }`)             |
| `vidnest`         | Vidnest API (best-effort deep scan)                              |

If `responseType` is omitted, the adapter falls back to a series of heuristics that try each known shape in turn.

### Stream proxying

Each server can specify a `streamProxy` URL that's prepended to the stream URL returned by the API. This is useful when an API returns a direct CDN URL that the browser can't fetch due to CORS.

If no per-server `streamProxy` is configured, the global `VITE_CORS_PROXY_URL` from `config.js` is used as a fallback.

---

## 5. Verification checklist

After deployment, verify each piece:

- [ ] Site loads at your domain
- [ ] Browsing/searching movies works (needs `VITE_TMDB_READ_API_KEY`)
- [ ] Clicking a movie opens the player
- [ ] The source picker shows your custom servers (Nebula, Comet, etc.) at the bottom of the list
- [ ] Clicking a custom server source starts playback (verify in the browser DevTools Network tab — you should see requests to the upstream API, then to the HLS/MP4 stream)
- [ ] If playback fails with a CORS error in the console, set `VITE_CORS_PROXY_URL` in `config.js` and reload

---

## 6. Troubleshooting

### "Failed to fetch" or CORS errors in the browser console

Most upstream streaming APIs return HLS playlists from CDNs that don't send `Access-Control-Allow-Origin`. Fix: deploy a Cloudflare Worker proxy and set `VITE_CORS_PROXY_URL` to its URL.

### Custom server returns 402 / 404 / 500

Some of the upstream APIs (especially Vidnest and CinetaroCDN) are geo-locked, rate-limited, or occasionally down. The player will mark that source as failed and automatically fall through to the next one. Check the browser console for the specific error message — the adapter logs the upstream URL and HTTP status.

### VidRock (Vega) only exposes the "orion" upstream server

VidRock currently only exposes its `orion` backend, and the included config already targets `?server=orion`, so playback works out of the box. If VidRock adds more servers later, edit `src/backend/customServers/config.ts` and change the `server=` query param on the Vega entry.

### CinetaroCDN doesn't resolve

`cdn.cinetaro.tv` / `atlantic.speedoflight.buzz` may not be reachable from all networks. The adapter handles DNS failures gracefully — that source will simply be marked as failed and the player moves on. If you have a different working Cinetaro endpoint, replace it in `config.ts`.

---

## 7. File layout reference

```
p-stream-production/
├── Dockerfile                    ← Multi-stage build (build + nginx)
├── docker-compose.yaml           ← Compose with config.js volume mount
├── nginx.conf                    ← SPA-aware nginx config (used by Dockerfile)
├── server.js                     ← Standalone Node static server (no Docker)
├── config.js                     ← Runtime config (mounted into Docker container)
├── example.env                   ← All env vars documented
├── vercel.json                   ← Vercel SPA rewrite + caching rules
├── public/
│   └── config.js                 ← Default runtime config (shipped with build)
└── src/
    └── backend/
        └── customServers/        ← Custom API servers module
            ├── config.ts         ← ServerConfig type + SERVERS array
            ├── types.ts          ← NormalizedStream + helpers
            ├── adapters.ts       ← Per-responseType adapters
            ├── fetcher.ts        ← URL building + fetch + proxy
            ├── toRunOutput.ts    ← Bridge to @p-stream/providers RunOutput
            └── index.ts          ← Public API
```
