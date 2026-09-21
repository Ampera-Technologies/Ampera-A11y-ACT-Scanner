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
# Ubuntu 24.04 renamed several libraries to their t64 variants. Resolve each
# package against the current image instead of assuming the Debian 12 names.
package_with_candidate() {
  local candidate
  for candidate in "$@"; do
    # apt-cache policy reports a candidate for some virtual packages even
    # though apt-get refuses to install them (Ubuntu 24's libasound2 is one).
    # A simulated install is the authoritative installability check.
    if DEBIAN_FRONTEND=noninteractive apt-get install --simulate \
      --no-install-recommends "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  echo "=== FATAL: no apt candidate found for: $* ===" >&2
  return 1
}

CHROME_PACKAGES=()
add_chrome_package() {
  local resolved
  resolved="$(package_with_candidate "$@")" || exit 1
  CHROME_PACKAGES+=("$resolved")
}

add_chrome_package libglib2.0-0t64 libglib2.0-0
add_chrome_package libnss3
add_chrome_package libatk1.0-0t64 libatk1.0-0
add_chrome_package libatk-bridge2.0-0t64 libatk-bridge2.0-0
add_chrome_package libcups2t64 libcups2
add_chrome_package libdrm2t64 libdrm2
add_chrome_package libxkbcommon0
add_chrome_package libxcomposite1
add_chrome_package libxdamage1
add_chrome_package libxrandr2
add_chrome_package libgbm1
add_chrome_package libasound2t64 libasound2
add_chrome_package libpangocairo-1.0-0
add_chrome_package libpango-1.0-0
add_chrome_package libcairo2t64 libcairo2
add_chrome_package libatspi2.0-0t64 libatspi2.0-0
add_chrome_package libx11-6
add_chrome_package libxcb1
add_chrome_package libxext6
add_chrome_package libxfixes3
add_chrome_package libxi6
add_chrome_package libxtst6

DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  "${CHROME_PACKAGES[@]}"

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
node /home/site/wwwroot/artifacts/api-server/dist/index.mjs
