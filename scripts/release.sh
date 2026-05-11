#!/usr/bin/env bash
# Release build for the TriLog Viewer.
#
# Validates that signing + notarization are wired up, that the four
# version strings agree, then runs a universal `tauri build` which
# signs with Developer ID + notarizes + staples + produces a .dmg.
#
# Usage:
#   scripts/release.sh
#
# Required env vars (export in your shell or ~/.zshenv):
#   APPLE_ID            — Apple ID email
#   APPLE_PASSWORD      — app-specific password from appleid.apple.com
#   APPLE_TEAM_ID       — your team ID (Tauri stamps it on the bundle)
#
# If you'd rather use an App Store Connect API key instead of an
# app-specific password, set APPLE_API_KEY (path to .p8 file),
# APPLE_API_KEY_ID, and APPLE_API_ISSUER instead.

set -euo pipefail

# -- Move to the repo root regardless of where the script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Colors for the human in front of the terminal
if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; DIM=''; NC=''
fi
say() { printf '%s\n' "$*"; }
ok()  { say "${GREEN}✓${NC} $*"; }
warn(){ say "${YELLOW}!${NC} $*"; }
fail(){ say "${RED}✗${NC} $*"; exit 1; }

# -- 1. Codesigning identity is installed
say "${DIM}Checking codesigning identity…${NC}"
IDENTITY="Developer ID Application: Joseph Orr (722BU6KN95)"
if ! security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
  fail "Codesigning identity not found: $IDENTITY
   Run: security find-identity -v -p codesigning
   Then create the cert via Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application"
fi
ok "Codesigning identity present"

# -- 2. Notarization credentials
say "${DIM}Checking notarization credentials…${NC}"
if [[ -n "${APPLE_API_KEY:-}" ]]; then
  [[ -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]] \
    || fail "APPLE_API_KEY is set but APPLE_API_KEY_ID and/or APPLE_API_ISSUER are missing"
  [[ -f "$APPLE_API_KEY" ]] \
    || fail "APPLE_API_KEY file not found at: $APPLE_API_KEY"
  ok "App Store Connect API key configured ($APPLE_API_KEY)"
elif [[ -n "${APPLE_ID:-}" ]]; then
  [[ -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]] \
    || fail "APPLE_ID is set but APPLE_PASSWORD and/or APPLE_TEAM_ID are missing"
  ok "App-specific password configured for $APPLE_ID"
else
  fail "No notarization credentials.
   Either set APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID (app-specific password)
   or set APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER (API key)."
fi

# -- 3. Version strings agree across all four files
say "${DIM}Checking version sync…${NC}"
PKG_VERSION=$(awk -F\" '/^[[:space:]]*"version":/ { print $4; exit }' package.json)
TAURI_VERSION=$(awk -F\" '/^[[:space:]]*"version":/ { print $4; exit }' src-tauri/tauri.conf.json)
CARGO_VERSION=$(awk -F\" '/^version = "/ { print $2; exit }' src-tauri/Cargo.toml)
TS_VERSION=$(awk -F\' "/APP_VERSION/ { print \$2; exit }" src/version.ts)

if [[ "$PKG_VERSION" != "$TAURI_VERSION" || "$PKG_VERSION" != "$CARGO_VERSION" || "$PKG_VERSION" != "$TS_VERSION" ]]; then
  fail "Version mismatch:
   package.json        $PKG_VERSION
   tauri.conf.json     $TAURI_VERSION
   Cargo.toml          $CARGO_VERSION
   src/version.ts      $TS_VERSION
   Bring all four into sync before releasing."
fi
VERSION="$PKG_VERSION"
ok "All four version strings agree: $VERSION"

# -- 4. Working tree clean (warning only — not fatal)
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  warn "Working tree has uncommitted changes; the release will reflect them."
fi

# -- 5. Build
say ""
say "${DIM}Running universal Tauri build (signing + notarizing + stapling)…${NC}"
say "${DIM}First notarize submission takes ~2–5 minutes.${NC}"
say ""

bun run tauri build --target universal-apple-darwin

# -- 6. Locate output and summarize
DMG_DIR="src-tauri/target/universal-apple-darwin/release/bundle/dmg"
DMG_PATH=$(ls -1t "$DMG_DIR"/*.dmg 2>/dev/null | head -1 || true)
APP_DIR="src-tauri/target/universal-apple-darwin/release/bundle/macos"
APP_PATH=$(ls -1d "$APP_DIR"/*.app 2>/dev/null | head -1 || true)

say ""
say "${GREEN}Release build complete.${NC} v$VERSION"
if [[ -n "$APP_PATH" ]]; then
  say "  .app   $APP_PATH"
fi
if [[ -n "$DMG_PATH" ]]; then
  SIZE=$(du -h "$DMG_PATH" | awk '{print $1}')
  say "  .dmg   $DMG_PATH  (${SIZE})"

  # -- 7. Verify the staple succeeded
  say ""
  say "${DIM}Verifying notarization staple…${NC}"
  if xcrun stapler validate "$DMG_PATH" >/dev/null 2>&1; then
    ok "Stapler ticket present — Gatekeeper will accept this on first open."
  else
    warn "Stapler validation did not return OK. The .dmg may still work but won't be offline-verifiable."
  fi

  if command -v spctl >/dev/null 2>&1; then
    if spctl --assess --type open --context context:primary-signature "$DMG_PATH" >/dev/null 2>&1; then
      ok "spctl accepts the bundle."
    else
      warn "spctl rejected the bundle — investigate before distributing."
    fi
  fi
fi
