#!/usr/bin/env bash
# npm run build:db -- zstd
#
# Compresses data/build/dictionary.db (scripts/assemble-sqlite.mjs's output)
# into public/dictionary.db.zst - a stronger, larger-window codec than the
# DEFLATE `npm run build:db -- zip` step produces, shipped alongside (not
# instead of) dictionary.db.zip so the app can switch between the two by
# changing one URL - see src/dictionary/sqlite-drivers/browser-sqlite-driver.js's
# ensureDatabaseFromUrl for where that switch lives and why DEFLATE's 32KB
# window leaves real bytes on the table in a 100MB+ file that zstd's much
# larger window can reach.
#
# Requires the `zstd` CLI (macOS: `brew install zstd`; Debian/Ubuntu:
# `apt install zstd`) - a system tool, same as fetch-jmdict.sh's curl/gunzip,
# not an npm dependency, since this only runs at build time and never ships
# to the browser.
#
# Level 19 specifically - not --ultra/-22 and no --long=N. Those raise the
# encoder's window past 2^25 bytes (32MB), which is exactly the backreference
# limit fzstd (the pure-JS decoder used client-side - see
# browser-sqlite-driver.js) documents as its ceiling for non-"ultra" archives.
# Verified against this exact database: -19 round-trips byte-for-byte
# through fzstd; --ultra -22 and --long=27 both silently produced corrupted
# output starting around 85% through the file. Don't raise the level without
# re-verifying a full decode round-trip first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/../data/build/dictionary.db"
DEST="$SCRIPT_DIR/../public/dictionary.db.zst"

if ! command -v zstd &> /dev/null; then
  echo "zstd CLI not found. Install it (e.g. \`brew install zstd\`) and retry." >&2
  exit 1
fi

if [[ ! -f "$SRC" ]]; then
  echo "$SRC not found — run \"npm run build:db -- db\" first." >&2
  exit 1
fi

zstd -19 -f -o "$DEST" "$SRC"
echo "Wrote public/$(basename "$DEST") ($(du -h "$DEST" | cut -f1 | tr -d ' '))"
