#!/usr/bin/env bash
# Release build for the TriLog Viewer.
#
# What it does:
#   1. Validates that signing + notarization creds are wired up
#   2. Confirms all four version strings agree
#   3. Runs `tauri build --target universal-apple-darwin`
#        Tauri signs + notarizes + staples the .app inside the build
#   4. Submits the .dmg to Apple's notary service separately so the
#      .dmg gets its own ticket (Tauri only submits the .app)
#   5. Staples the .dmg and verifies with stapler + spctl
#   6. With --release: tags HEAD with vN.N.N, pushes, and creates a
#      GitHub release with the .dmg attached
#
# Usage:
#   scripts/release.sh             — build only (default)
#   scripts/release.sh --release   — build + tag + push + GitHub release
#
# Required env vars (export in your shell or ~/.zshenv):
#   APPLE_ID            — Apple ID email
#   APPLE_PASSWORD      — app-specific password from appleid.apple.com
#   APPLE_TEAM_ID       — your team ID
#
# Or use an App Store Connect API key instead:
#   APPLE_API_KEY       — path to the .p8 file
#   APPLE_API_KEY_ID
#   APPLE_API_ISSUER

set -euo pipefail

# -- Parse args
DO_RELEASE=0
for arg in "$@"; do
  case "$arg" in
    --release|--ship) DO_RELEASE=1 ;;
    -h|--help)
      sed -n '2,/^set/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) printf '%s\n' "Unknown arg: $arg"; exit 2 ;;
  esac
done

# -- Move to the repo root regardless of where the script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Colors
if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; DIM=''; NC=''
fi
say()  { printf '%s\n' "$*"; }
ok()   { say "${GREEN}✓${NC} $*"; }
warn() { say "${YELLOW}!${NC} $*"; }
fail() { say "${RED}✗${NC} $*"; exit 1; }

# -- 1. Codesigning identity is installed
say "${DIM}Checking codesigning identity…${NC}"
IDENTITY="Developer ID Application: Joseph Orr (722BU6KN95)"
if ! security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
  fail "Codesigning identity not found: $IDENTITY
   Run: security find-identity -v -p codesigning
   Then create the cert via Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application"
fi
ok "Codesigning identity present"

# -- 2. Notarization credentials. Sets NOTARYTOOL_ARGS for later use.
say "${DIM}Checking notarization credentials…${NC}"
NOTARYTOOL_ARGS=()
if [[ -n "${APPLE_API_KEY:-}" ]]; then
  [[ -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]] \
    || fail "APPLE_API_KEY is set but APPLE_API_KEY_ID and/or APPLE_API_ISSUER are missing"
  [[ -f "$APPLE_API_KEY" ]] \
    || fail "APPLE_API_KEY file not found at: $APPLE_API_KEY"
  NOTARYTOOL_ARGS=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
  ok "App Store Connect API key configured ($APPLE_API_KEY)"
elif [[ -n "${APPLE_ID:-}" ]]; then
  [[ -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]] \
    || fail "APPLE_ID is set but APPLE_PASSWORD and/or APPLE_TEAM_ID are missing"
  NOTARYTOOL_ARGS=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
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
TAG="v$VERSION"
ok "All four version strings agree: $VERSION"

# -- 4. If shipping, the tag must not exist yet
if [[ "$DO_RELEASE" == 1 ]]; then
  command -v gh >/dev/null 2>&1 || fail "gh CLI not installed. brew install gh && gh auth login"
  gh auth status >/dev/null 2>&1 || fail "gh CLI not authenticated. Run: gh auth login"
  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    fail "Tag $TAG already exists locally. Bump the version first."
  fi
  if git ls-remote --tags origin "$TAG" 2>/dev/null | grep -q "$TAG"; then
    fail "Tag $TAG already exists on origin. Bump the version first."
  fi
  ok "gh CLI ready, tag $TAG is free"
fi

# -- 5. Working tree warning
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  warn "Working tree has uncommitted changes; the release will be based on the committed state at HEAD."
fi

# -- 6. Build
say ""
say "${DIM}Running universal Tauri build (signs the .app + notarizes via Tauri's pipeline)…${NC}"
say ""

bun run tauri build --target universal-apple-darwin

APP_PATH="src-tauri/target/universal-apple-darwin/release/bundle/macos/TriLog Viewer.app"
DMG_DIR="src-tauri/target/universal-apple-darwin/release/bundle/dmg"
DMG_PATH=$(ls -1t "$DMG_DIR"/*.dmg 2>/dev/null | head -1 || true)
[[ -d "$APP_PATH" ]] || fail "Build did not produce .app at $APP_PATH"
[[ -n "$DMG_PATH" && -f "$DMG_PATH" ]] || fail "Build did not produce a .dmg under $DMG_DIR"

# -- 7. Verify the .app's staple (Tauri stapled it during the build)
say ""
say "${DIM}Verifying .app staple…${NC}"
if xcrun stapler validate "$APP_PATH" >/dev/null 2>&1; then
  ok ".app ticket is stapled"
else
  fail ".app staple missing or invalid — notarization may have failed during the Tauri build. Run: xcrun notarytool history ${NOTARYTOOL_ARGS[*]}"
fi

# -- 8. Submit the .dmg separately. Tauri only notarizes the .app zip;
#       the .dmg around it doesn't share that ticket, so it needs its
#       own pass to be offline-verifiable.
say ""
say "${DIM}Submitting .dmg for notarization (1–5 min)…${NC}"
DMG_SUBMIT_LOG=$(mktemp -t trilog-notary-XXXXXX)
trap 'rm -f "$DMG_SUBMIT_LOG"' EXIT
if ! xcrun notarytool submit "$DMG_PATH" "${NOTARYTOOL_ARGS[@]}" --wait | tee "$DMG_SUBMIT_LOG"; then
  fail ".dmg notarization submission failed. See output above."
fi
if ! grep -q "status: Accepted" "$DMG_SUBMIT_LOG"; then
  SUBMIT_ID=$(grep "id:" "$DMG_SUBMIT_LOG" | head -1 | awk '{print $2}')
  if [[ -n "$SUBMIT_ID" ]]; then
    say ""
    say "${RED}.dmg was not accepted. Pulling Apple's log:${NC}"
    xcrun notarytool log "$SUBMIT_ID" "${NOTARYTOOL_ARGS[@]}" || true
  fi
  fail ".dmg notarization did not return Accepted."
fi
ok ".dmg notarized"

# -- 9. Staple the .dmg
say "${DIM}Stapling .dmg…${NC}"
xcrun stapler staple "$DMG_PATH" >/dev/null
xcrun stapler validate "$DMG_PATH" >/dev/null \
  || fail "Staple validation failed after stapling — something is off."
ok ".dmg stapled"

# -- 10. spctl belt-and-suspenders — confirms Gatekeeper accepts it
if spctl --assess --type open --context context:primary-signature "$DMG_PATH" >/dev/null 2>&1; then
  ok "spctl accepts the .dmg"
else
  warn "spctl assess didn't return OK on the .dmg. Likely fine (Gatekeeper still accepts a stapled .app inside), but worth a manual look."
fi

# -- 11. Build summary
SIZE=$(du -h "$DMG_PATH" | awk '{print $1}')
say ""
say "${GREEN}Build complete.${NC} v$VERSION"
say "  .app   $APP_PATH"
say "  .dmg   $DMG_PATH  (${SIZE})"

# -- 12. Optional: tag + GitHub release
if [[ "$DO_RELEASE" != 1 ]]; then
  say ""
  say "${DIM}Done. Pass --release to tag, push, and publish a GitHub release.${NC}"
  exit 0
fi

# Confirm HEAD is on a branch (and ideally main) so the tag points
# somewhere sensible. Non-fatal if not on main, just warn.
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || true)
if [[ -z "$BRANCH" ]]; then
  fail "HEAD is detached; can't safely tag. Check out a branch first."
fi
if [[ "$BRANCH" != "main" ]]; then
  warn "On branch '$BRANCH' (not main). Tag will land here."
fi

# Push HEAD first so the tag isn't ahead of the branch on the remote
say ""
say "${DIM}Pushing $BRANCH…${NC}"
git push origin "$BRANCH"

say "${DIM}Tagging $TAG and pushing…${NC}"
git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"

say "${DIM}Creating GitHub release $TAG with .dmg attached…${NC}"
gh release create "$TAG" "$DMG_PATH" \
  --title "$TAG" \
  --generate-notes

REPO_URL=$(gh repo view --json url -q '.url' 2>/dev/null || echo "")
say ""
say "${GREEN}Released $TAG.${NC}"
if [[ -n "$REPO_URL" ]]; then
  say "  $REPO_URL/releases/tag/$TAG"
fi
