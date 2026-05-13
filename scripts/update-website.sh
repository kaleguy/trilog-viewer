#!/usr/bin/env bash
# Update the trilog-netlify website's TriLog Viewer references to a
# new version. Touches viewer.html and apps.html: the version pill
# in the hero meta line, and the .dmg download URLs that embed the
# version number twice each (once in the path, once in the filename).
#
# Usage:
#   scripts/update-website.sh <new-version>           — modify files only
#   scripts/update-website.sh <new-version> --commit  — also commit
#   scripts/update-website.sh <new-version> --push    — commit + push
#
# Options:
#   --website PATH     Path to the trilog-netlify checkout
#                      (default: ../trilog-netlify relative to this repo)
#
# The script auto-discovers the *current* version in the website by
# grepping viewer.html, so you don't have to pass it separately. If
# the website is already at the new version, the script is a no-op.

set -euo pipefail

# -- Parse args
NEW_VERSION=""
WEBSITE_ROOT=""
DO_COMMIT=0
DO_PUSH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --website)  WEBSITE_ROOT="$2"; shift 2 ;;
    --commit)   DO_COMMIT=1; shift ;;
    --push)     DO_COMMIT=1; DO_PUSH=1; shift ;;
    -h|--help)
      sed -n '2,/^set/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) echo "Unknown flag: $1" >&2; exit 2 ;;
    *)
      if [[ -z "$NEW_VERSION" ]]; then
        NEW_VERSION="$1"; shift
      else
        echo "Unexpected positional arg: $1" >&2; exit 2
      fi
      ;;
  esac
done

# Colors
if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; DIM=''; NC=''
fi
ok()   { printf '%s\n' "${GREEN}✓${NC} $*"; }
warn() { printf '%s\n' "${YELLOW}!${NC} $*"; }
fail() { printf '%s\n' "${RED}✗${NC} $*" >&2; exit 1; }

[[ -n "$NEW_VERSION" ]] \
  || fail "Missing new version. Usage: scripts/update-website.sh <new-version> [--commit | --push] [--website PATH]"
[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "New version doesn't look like X.Y.Z: '$NEW_VERSION'"

# -- Default website path
if [[ -z "$WEBSITE_ROOT" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  WEBSITE_ROOT="$(cd "$SCRIPT_DIR/../../trilog-netlify" 2>/dev/null && pwd || true)"
fi
[[ -n "$WEBSITE_ROOT" && -d "$WEBSITE_ROOT" ]] \
  || fail "Website root not found. Pass with --website PATH (default expects ../trilog-netlify)"
[[ -f "$WEBSITE_ROOT/viewer.html" && -f "$WEBSITE_ROOT/apps.html" ]] \
  || fail "Expected viewer.html and apps.html in $WEBSITE_ROOT"

cd "$WEBSITE_ROOT"

# -- Auto-discover current version from the version pill
OLD_VERSION=$(grep -oE '<span>v[0-9]+\.[0-9]+\.[0-9]+</span>' viewer.html \
  | head -1 \
  | sed -E 's|<span>v([0-9]+\.[0-9]+\.[0-9]+)</span>|\1|')
[[ -n "$OLD_VERSION" ]] \
  || fail "Could not find current version pill <span>v…</span> in viewer.html"
ok "Current website version: v$OLD_VERSION"
ok "Updating to:              v$NEW_VERSION"

if [[ "$OLD_VERSION" == "$NEW_VERSION" ]]; then
  ok "Already at v$NEW_VERSION — nothing to do."
  exit 0
fi

# -- Substitutions (macOS sed needs '' after -i)
#   1a. The .dmg URL path + filename: v1.0.0/TriLog.Viewer_1.0.0_universal.dmg
#       GitHub normalizes spaces in asset names to dots in the download
#       URL, so this is the form that actually resolves (not %20).
sed -i '' \
  "s|v${OLD_VERSION}/TriLog\.Viewer_${OLD_VERSION}_universal.dmg|v${NEW_VERSION}/TriLog.Viewer_${NEW_VERSION}_universal.dmg|g" \
  viewer.html apps.html

#   1b. The Windows .exe URL path + filename: v1.0.0/TriLog.Viewer_1.0.0_x64-setup.exe
sed -i '' \
  "s|v${OLD_VERSION}/TriLog\.Viewer_${OLD_VERSION}_x64-setup\.exe|v${NEW_VERSION}/TriLog.Viewer_${NEW_VERSION}_x64-setup.exe|g" \
  viewer.html apps.html

#   1c. Sample-journal.db release URL (filename is stable across versions,
#       only the v* segment in the path changes).
sed -i '' \
  "s|releases/download/v${OLD_VERSION}/sample-journal\.db|releases/download/v${NEW_VERSION}/sample-journal.db|g" \
  viewer.html

#   2. The version pill in the hero meta line
sed -i '' \
  "s|<span>v${OLD_VERSION}</span>|<span>v${NEW_VERSION}</span>|g" \
  viewer.html

ok "Patched viewer.html and apps.html"

# -- Sanity-check no stale OLD_VERSION refs remain
STALE_VIEWER=$(grep -c "${OLD_VERSION}" viewer.html || true)
STALE_APPS=$(grep -c "${OLD_VERSION}" apps.html || true)
if (( STALE_VIEWER + STALE_APPS > 0 )); then
  warn "Still see references to v$OLD_VERSION ($STALE_VIEWER in viewer.html, $STALE_APPS in apps.html) — review before committing."
  echo "${DIM}Showing remaining lines:${NC}"
  grep -nH "$OLD_VERSION" viewer.html apps.html || true
fi

# -- Show what changed
printf '\n'
git --no-pager diff --stat viewer.html apps.html

if (( DO_COMMIT == 0 )); then
  printf '\n%s\n' "${DIM}Done. Inspect with: git -C \"$WEBSITE_ROOT\" diff${NC}"
  printf '%s\n' "${DIM}Then commit when happy, or re-run with --commit / --push.${NC}"
  exit 0
fi

# -- Commit
git add viewer.html apps.html
git commit -m "Update TriLog Viewer download to v$NEW_VERSION

Bumps the version pill in viewer.html and the .dmg download URLs
in viewer.html + apps.html from v$OLD_VERSION → v$NEW_VERSION.
"
ok "Committed"

if (( DO_PUSH == 1 )); then
  BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || true)
  [[ -n "$BRANCH" ]] || fail "HEAD is detached; refusing to push."
  git push origin "$BRANCH"
  ok "Pushed to origin/$BRANCH — Netlify will auto-deploy."
fi
