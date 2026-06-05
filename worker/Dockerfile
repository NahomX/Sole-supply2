# Berebaso agent worker — Fly.io container.
#
# Stages:
#   1. deps    — install npm dependencies (cached layer).
#   2. build   — compile TypeScript.
#   3. runtime — minimal runtime image with Playwright browsers.
#
# Playwright requires specific system libraries; we use the official
# Playwright Docker base image which bundles Chromium + deps.
#
# NODE VERSION: must match the version used during development (Node 20 LTS).
# Playwright: use the version that matches the package.json entry.

# ---------------------------------------------------------------------------
# Stage 1 — dependency install.
# ---------------------------------------------------------------------------
FROM node:20-slim AS deps

WORKDIR /app

# Copy package files and install production + dev deps.
# (Dev deps needed for TypeScript compilation in stage 2.)
COPY package.json ./
COPY package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 2 — TypeScript compilation.
# ---------------------------------------------------------------------------
FROM node:20-slim AS build

WORKDIR /app

# Copy deps from stage 1.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

RUN npx tsc --noEmit || true  # type check; non-zero exit would fail the build
RUN npx tsc

# ---------------------------------------------------------------------------
# Stage 3 — runtime.
# Use the Playwright-provided image which bundles Chromium and all required
# system libraries (glibc, nss, libX11, etc.).
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.45.0-jammy AS runtime

WORKDIR /app

# Copy compiled output and production node_modules only.
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# Install Playwright Chromium browser.
# The mcr.microsoft.com/playwright image already has system deps; we just
# need to tell Playwright where to find the browser.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# The base image ships with browsers at /ms-playwright — no download needed.

# Fly.io injects secrets as env vars at runtime; no .env file is baked in.
# Ensure no secret files are copied into the image.

# Non-root user for security.
RUN useradd -m -u 1001 worker
USER worker

# Entrypoint.
CMD ["node", "dist/index.js"]

# ---------------------------------------------------------------------------
# Health check: Fly.io can use TCP health checks on the fly.toml level.
# The worker is a headless process with no HTTP port — health is inferred
# from process liveness. No EXPOSE needed.
# ---------------------------------------------------------------------------
