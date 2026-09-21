#!/bin/bash
set -e

export PUPPETEER_CACHE_DIR=/home/site/wwwroot/.cache/puppeteer

# The API bundle and the browser-side rule engine are separate production
# artifacts. Do this check before installing Chrome so a bad Azure package
# fails immediately with an actionable message instead of failing the first
# accessibility scan.
BROWSER_BUNDLE="/home/site/wwwroot/artifacts/api-server/dist/browser-bundle.js"
SERVER_BUNDLE="/home/site/wwwroot/artifacts/api-server/dist/index.mjs"
if [ ! -s "$BROWSER_BUNDLE" ] && ! grep -q "window.__ampera" "$SERVER_BUNDLE" 2>/dev/null; then
  echo "=== FATAL: browser rule bundle is missing from the Azure deployment ===" >&2
  echo "=== Expected standalone bundle: $BROWSER_BUNDLE ===" >&2
  echo "=== Rebuild and redeploy with: pnpm --filter @workspace/api-server run build ===" >&2
  exit 1
fi
if [ -s "$BROWSER_BUNDLE" ]; then
  echo "=== Browser rule bundle verified at $BROWSER_BUNDLE ==="
else
  echo "=== Embedded browser rule bundle verified in $SERVER_BUNDLE ==="
fi

# ── Chrome system dependencies ────────────────────────────────────────────────
# Azure App Service Linux only persists /home between container restarts.
# System packages (installed to /usr/lib etc.) are wiped every time the
# container starts, so apt-get MUST run unconditionally on every startup.
echo "=== INSTALL CHROME DEPENDENCIES ==="
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  libglib2.0-0 \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libasound2t64 \
  libpangocairo-1.0-0 \
  libpango-1.0-0 \
  libcairo2 \
  libatspi2.0-0 \
  libx11-6 \
  libxcb1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxtst6

# ── Chrome browser binary ─────────────────────────────────────────────────────
# $PUPPETEER_CACHE_DIR lives under /home/site/wwwroot which Azure DOES persist
# across container restarts. Only download Chrome when it is not already there.
CHROME_EXE=$(find "$PUPPETEER_CACHE_DIR" -type f -name "chrome" -perm /u+x 2>/dev/null | head -1)
if [ -n "$CHROME_EXE" ] && [ -x "$CHROME_EXE" ]; then
  echo "=== CHROME ALREADY CACHED AT $CHROME_EXE - SKIPPING DOWNLOAD ==="
else
  echo "=== INSTALL CHROME ==="
  # Use the LOCAL puppeteer binary from api-server/node_modules — NOT bare npx.
  # npx run from /home/site/wwwroot cannot find puppeteer (pnpm scopes it to
  # artifacts/api-server/node_modules) so it re-downloads the entire puppeteer
  # package (~100 packages, ~60s) before even starting the Chrome download.
  LOCAL_PUPPETEER="/home/site/wwwroot/artifacts/api-server/node_modules/.bin/puppeteer"
  if [ -f "$LOCAL_PUPPETEER" ]; then
    "$LOCAL_PUPPETEER" browsers install chrome
  else
    echo "(local binary not found — falling back to npx from api-server dir)"
    (cd /home/site/wwwroot/artifacts/api-server && npx --no-install puppeteer browsers install chrome) || \
    (cd /home/site/wwwroot/artifacts/api-server && npx puppeteer browsers install chrome)
  fi
  # Re-scan after install
  CHROME_EXE=$(find "$PUPPETEER_CACHE_DIR" -type f -name "chrome" -perm /u+x 2>/dev/null | head -1)
fi

# ── Fallback: use Azure's pre-installed Playwright Chromium ──────────────────
# If puppeteer Chrome download failed (network/permissions), try the Playwright
# Chromium that Azure App Service pre-installs at /ms-playwright/.
if [ -z "$CHROME_EXE" ] || [ ! -x "$CHROME_EXE" ]; then
  echo "=== PUPPETEER CHROME NOT FOUND — TRYING AZURE PLAYWRIGHT CHROMIUM ==="
  MS_CHROME=$(find /ms-playwright -type f \( -name "chrome" -o -name "chromium" -o -name "chromium-browser" \) -perm /u+x 2>/dev/null | head -1)
  if [ -n "$MS_CHROME" ] && [ -x "$MS_CHROME" ]; then
    echo "=== FOUND AZURE PLAYWRIGHT CHROMIUM AT $MS_CHROME ==="
    CHROME_EXE="$MS_CHROME"
  fi
fi

# ── Export path for puppeteer ─────────────────────────────────────────────────
# Setting PUPPETEER_EXECUTABLE_PATH lets getChromiumPath() in scanner.ts
# resolve the binary via env var (first priority) instead of scanning.
if [ -n "$CHROME_EXE" ] && [ -x "$CHROME_EXE" ]; then
  export PUPPETEER_EXECUTABLE_PATH="$CHROME_EXE"
  echo "=== CHROME BINARY: $PUPPETEER_EXECUTABLE_PATH ==="
else
  echo "=== WARNING: no Chrome binary found — scans will fail ==="
fi

echo "=== START NODE ==="
echo "=== FRONTEND DEPLOYMENT CHECK ==="

PUBLIC_DIR="/home/site/wwwroot/artifacts/api-server/dist/public"

if [ -d "$PUBLIC_DIR" ]; then
  echo "=== PUBLIC DIR EXISTS ==="
  ls -lah "$PUBLIC_DIR"
else
  echo "=== ERROR: PUBLIC DIR MISSING ==="
fi

if [ -f "$PUBLIC_DIR/index.html" ]; then
  echo "=== INDEX.HTML EXISTS ==="
  echo "=== INDEX SIZE ==="
  wc -c "$PUBLIC_DIR/index.html"

  echo "=== INDEX.HTML CONTENT ==="
  cat "$PUBLIC_DIR/index.html"
else
  echo "=== ERROR: INDEX.HTML MISSING ==="
fi

if [ -d "$PUBLIC_DIR/assets" ]; then
  echo "=== ASSETS DIR EXISTS ==="
  find "$PUBLIC_DIR/assets" -maxdepth 1 -type f -printf '%f %s bytes\n'
else
  echo "=== ERROR: ASSETS DIR MISSING ==="
fi

echo "=== END FRONTEND DEPLOYMENT CHECK ==="
node /home/site/wwwroot/artifacts/api-server/dist/index.mjs
