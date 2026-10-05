# ────────────────────────────────────────────────────────────────
#  P-Stream — Dockerfile (VPS-ready, server.js runtime)
#  Multi-stage build:
#    1) build stage   → pnpm + Vite production build
#    2) runtime stage → Node.js + server.js (serves static AND
#                       proxies /api/ext/* — replaces nginx so we
#                       have ONE proxy implementation across all
#                       deployment paths: VPS-PM2, VPS-Docker, bare)
# ────────────────────────────────────────────────────────────────

# ────────────────────────────────────────────────────────────────
#  Stage 1 — Build the Vite SPA
# ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install deps first (better layer caching).
# .npmrc is required for pnpm to hoist deps the way Vite expects.
# We create it inline (instead of COPY) so the build still succeeds
# even if the file was dropped from the uploaded zip (common on
# Windows/Mac where unzip tools sometimes skip dotfiles).
COPY package.json ./
COPY pnpm-lock.yaml ./
RUN echo "shamefully-hoist=true" > .npmrc
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build-time configuration via build ARGs.
ARG PWA_ENABLED="false"
ARG GA_ID=""
ARG APP_DOMAIN=""
ARG OPENSEARCH_ENABLED="false"
ARG TMDB_READ_API_KEY=""
ARG CORS_PROXY_URL=""
ARG M3U8_PROXY_URL=""
ARG DMCA_EMAIL=""
ARG NORMAL_ROUTER="true"
ARG BACKEND_URL=""
ARG HAS_ONBOARDING="false"
ARG ONBOARDING_CHROME_EXTENSION_INSTALL_LINK=""
ARG ONBOARDING_FIREFOX_EXTENSION_INSTALL_LINK=""
ARG ONBOARDING_PROXY_INSTALL_LINK=""
ARG DISALLOWED_IDS=""
ARG CDN_REPLACEMENTS=""
ARG ALLOW_AUTOPLAY="false"
ARG ALLOW_FEBBOX_KEY="false"
ARG ALLOW_DEBRID_KEY="false"
ARG SHOW_AD="false"
ARG AD_CONTENT_URL=""
ARG TRACK_SCRIPT=""
ARG BANNER_MESSAGE=""
ARG BANNER_ID=""
ARG USE_TRAKT="false"
ARG TRAKT_CLIENT_ID=""
ARG TRAKT_CLIENT_SECRET=""
ARG TRAKT_REDIRECT_URI=""
ARG HIDE_PROXY_ONBOARDING="false"
ARG SHOW_SUPPORT_BAR="false"
ARG SUPPORT_BAR_VALUE=""

ENV VITE_PWA_ENABLED=${PWA_ENABLED}
ENV VITE_GA_ID=${GA_ID}
ENV VITE_APP_DOMAIN=${APP_DOMAIN}
ENV VITE_OPENSEARCH_ENABLED=${OPENSEARCH_ENABLED}
ENV VITE_TMDB_READ_API_KEY=${TMDB_READ_API_KEY}
ENV VITE_CORS_PROXY_URL=${CORS_PROXY_URL}
ENV VITE_M3U8_PROXY_URL=${M3U8_PROXY_URL}
ENV VITE_DMCA_EMAIL=${DMCA_EMAIL}
ENV VITE_NORMAL_ROUTER=${NORMAL_ROUTER}
ENV VITE_BACKEND_URL=${BACKEND_URL}
ENV VITE_HAS_ONBOARDING=${HAS_ONBOARDING}
ENV VITE_ONBOARDING_CHROME_EXTENSION_INSTALL_LINK=${ONBOARDING_CHROME_EXTENSION_INSTALL_LINK}
ENV VITE_ONBOARDING_FIREFOX_EXTENSION_INSTALL_LINK=${ONBOARDING_FIREFOX_EXTENSION_INSTALL_LINK}
ENV VITE_ONBOARDING_PROXY_INSTALL_LINK=${ONBOARDING_PROXY_INSTALL_LINK}
ENV VITE_DISALLOWED_IDS=${DISALLOWED_IDS}
ENV VITE_CDN_REPLACEMENTS=${CDN_REPLACEMENTS}
ENV VITE_ALLOW_AUTOPLAY=${ALLOW_AUTOPLAY}
ENV VITE_ALLOW_FEBBOX_KEY=${ALLOW_FEBBOX_KEY}
ENV VITE_ALLOW_DEBRID_KEY=${ALLOW_DEBRID_KEY}
ENV VITE_SHOW_AD=${SHOW_AD}
ENV VITE_AD_CONTENT_URL=${AD_CONTENT_URL}
ENV VITE_TRACK_SCRIPT=${TRACK_SCRIPT}
ENV VITE_BANNER_MESSAGE=${BANNER_MESSAGE}
ENV VITE_BANNER_ID=${BANNER_ID}
ENV VITE_USE_TRAKT=${USE_TRAKT}
ENV VITE_TRAKT_CLIENT_ID=${TRAKT_CLIENT_ID}
ENV VITE_TRAKT_CLIENT_SECRET=${TRAKT_CLIENT_SECRET}
ENV VITE_TRAKT_REDIRECT_URI=${TRAKT_REDIRECT_URI}
ENV VITE_HIDE_PROXY_ONBOARDING=${HIDE_PROXY_ONBOARDING}
ENV VITE_SHOW_SUPPORT_BAR=${SHOW_SUPPORT_BAR}
ENV VITE_SUPPORT_BAR_VALUE=${SUPPORT_BAR_VALUE}

# Copy source and build
COPY . ./
RUN pnpm run build

# ────────────────────────────────────────────────────────────────
#  Stage 2 — Runtime: Node.js + server.js
# ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY server.js ./

RUN chmod 0666 ./dist/config.js 2>/dev/null || true

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DIST_DIR=./dist

EXPOSE 3000

# Healthcheck: must match the port server.js listens on (3000).
# Use 127.0.0.1 (NOT localhost) — Alpine resolves localhost to ::1
# (IPv6), but server.js only listens on IPv4 (0.0.0.0), so the
# healthcheck would fail with "Connection refused" if we used localhost.
# Also use -O /dev/null instead of --spider because some servers don't
# respond properly to HEAD requests.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
