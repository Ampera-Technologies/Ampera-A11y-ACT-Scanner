#!/bin/bash
set -e
SERVER_BUNDLE="/app/artifacts/api-server/dist/index.mjs"
if [ ! -s "$SERVER_BUNDLE" ]; then
  echo "=== FATAL: API server bundle is missing: $SERVER_BUNDLE ===" >&2
  exit 1
fi
# ── Install Chrome system dependencies ────────────────────────────────────────
# Puppeteer downloads its own Chrome binary but the Azure/Ubuntu deployment
# container ships without the graphics/sandbox libraries Chrome needs.
# Install the full set recommended by https://pptr.dev/troubleshooting
if command -v apt-get &>/dev/null; then
  echo "[build] Installing Chrome system dependencies..."
  apt-get update -qq 2>/dev/null || true
   package_with_candidate() {
    local candidate
    for candidate in "$@"; do
      if apt-cache policy "$candidate" 2>/dev/null | \
        awk '$1 == "Candidate:" && $2 != "(none)" { found = 1 } END { exit found ? 0 : 1 }'; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done
    printf '%s\n' "$1"
  }

  CHROME_PACKAGES=()
  add_chrome_package() {
    CHROME_PACKAGES+=("$(package_with_candidate "$@")")
  }

  add_chrome_package ca-certificates
  add_chrome_package fonts-liberation
  add_chrome_package libasound2 libasound2t64
  add_chrome_package libatk-bridge2.0-0 libatk-bridge2.0-0t64
  add_chrome_package libatk1.0-0 libatk1.0-0t64
  add_chrome_package libc6
  add_chrome_package libcairo2 libcairo2t64
  add_chrome_package libcups2 libcups2t64
  add_chrome_package libdbus-1-3
  add_chrome_package libexpat1
  add_chrome_package libfontconfig1
  add_chrome_package libgbm1
  add_chrome_package libgcc1 libgcc-s1
  add_chrome_package libglib2.0-0 libglib2.0-0t64
  add_chrome_package libgtk-3-0 libgtk-3-0t64
  add_chrome_package libnspr4
  add_chrome_package libnss3
  add_chrome_package libpango-1.0-0
  add_chrome_package libpangocairo-1.0-0
  add_chrome_package libstdc++6
  add_chrome_package libx11-6
  add_chrome_package libx11-xcb1
  add_chrome_package libxcb1
  add_chrome_package libxcomposite1
  add_chrome_package libxcursor1
  add_chrome_package libxdamage1
  add_chrome_package libxext6
  add_chrome_package libxfixes3
  add_chrome_package libxi6
  add_chrome_package libxrandr2
  add_chrome_package libxrender1
  add_chrome_package libxss1
  add_chrome_package libxtst6
  add_chrome_package lsb-release
  add_chrome_package wget
  add_chrome_package xdg-utils

  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    "${CHROME_PACKAGES[@]}" \
    2>/dev/null || true
  echo "[build] Chrome system dependencies installed"
else
  echo "[build] apt-get not available — skipping Chrome dependency install (Nix env)"
fi

# ── Build the API server ───────────────────────────────────────────────────────
echo "[build] Building API server..."
pnpm --filter @workspace/api-server run build
if [ ! -s "artifacts/api-server/dist/browser-bundle.js" ]; then
  echo "[build] ERROR: required browser rule bundle was not generated at artifacts/api-server/dist/browser-bundle.js" >&2
  exit 1
fi
echo "[build] Browser rule bundle verified"
echo "[build] API server done"

# ── Build the React frontend ──────────────────────────────────────────────────
# Vite outputs to artifacts/accessibility-scanner/dist/public/.
# We copy those files into dist/public/ next to the API server bundle so that
# Express can serve them via the express.static() middleware in app.ts.
# BASE_PATH=/ so Vite generates assets with root-relative paths (default).
echo "[build] Building frontend..."
BASE_PATH=/ pnpm --filter @workspace/accessibility-scanner run build
echo "[build] Frontend done"

echo "[build] Copying frontend into api-server dist/public/..."
mkdir -p artifacts/api-server/dist/public
cp -r artifacts/accessibility-scanner/dist/public/. artifacts/api-server/dist/public/
echo "[build] Done — frontend available at dist/public/"

# ── Install Chrome browser via Puppeteer ──────────────────────────────────────
# IMPORTANT: run this AFTER pnpm build so node_modules are present.
#
# Use the LOCAL puppeteer binary from api-server/node_modules — NOT npx.
# npx cannot find puppeteer in the workspace root (pnpm hoists it only under
# artifacts/api-server/node_modules) and therefore re-downloads the entire
# puppeteer package from npm (~100 packages, ~2 min) before installing Chrome.
# Using the local binary skips that and goes straight to Chrome download.
echo "=== INSTALL CHROME ==="
LOCAL_PUPPETEER="artifacts/api-server/node_modules/.bin/puppeteer"
if [ -f "$LOCAL_PUPPETEER" ]; then
  echo "[build] Using local puppeteer binary to install Chrome..."
  "$LOCAL_PUPPETEER" browsers install chrome 2>&1 || true
else
  # Fallback: cd into api-server so that npx resolves puppeteer from its
  # local node_modules instead of downloading it from scratch.
  echo "[build] Local binary not found — falling back to npx from api-server dir"
  (cd artifacts/api-server && npx --no-install puppeteer browsers install chrome 2>&1) || \
  (cd artifacts/api-server && npx puppeteer browsers install chrome 2>&1) || true
fi
echo "[build] Chrome installation complete"
