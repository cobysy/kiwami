#!/usr/bin/env bash
# npm run build:db -- <step> [extra args]
#
# Single entry point for every data-prep/build step that feeds
# public/dictionary.db, so package.json's scripts block doesn't carry one
# line per step. This is a dispatcher only — each step still just calls the
# one script that always did that step (scripts/fetch-*.sh,
# scripts/build-*.mjs, scripts/assemble-sqlite.mjs); nothing about how those
# work changed, only how they're invoked from npm. Note that "jmdict",
# "kanjidic", "tatoeba", and "fetch-all" are downloads, not builds — they're
# included here anyway since they're upstream of every build step and this
# is the one place that runs the whole thing end to end.
#
# Steps:
#   jmdict, kanjidic, tatoeba     fetch + decompress one source
#   fetch-all                     all three fetch steps in order
#   entries, kanji, sentences,
#   furigana, compounds           one normalized-data build stage each
#   db                            assemble everything into dictionary.db
#                                  (scripts/assemble-sqlite.mjs)
#   zip                           compress dictionary.db to dictionary.db.zip
#                                  (DEFLATE, via JSZip - scripts/zip-db.mjs)
#   zstd                          compress dictionary.db to dictionary.db.zst
#                                  (zstd -19, smaller than zip - scripts/zstd-db.sh)
#   build-all                     all eight build stages above, in dependency order
#   all                           fetch-all then build-all
#
# zip and zstd both ship in public/ - see
# src/dictionary/sqlite-drivers/browser-sqlite-driver.js's ensureDatabaseFromUrl
# for how the app picks between them.
#
# Extra args after the step name are forwarded, e.g.:
#   npm run build:db -- jmdict --force
#
# Usage: npm run build:db -- <step> [args...]
#        bash scripts/build-db.sh <step> [args...]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STEP="${1:-}"
[[ $# -gt 0 ]] && shift

usage() {
  echo "Usage: npm run build:db -- <step> [args...]"
  echo "Steps: jmdict kanjidic tatoeba fetch-all entries kanji sentences furigana compounds db zip zstd build-all all"
  exit 1
}

[[ -z "$STEP" ]] && usage

fetch_all() {
  bash "$SCRIPT_DIR/fetch-jmdict.sh"
  bash "$SCRIPT_DIR/fetch-kanjidic.sh"
  bash "$SCRIPT_DIR/fetch-tatoeba.sh"
}

build_all() {
  node "$SCRIPT_DIR/build-entries.mjs"
  node "$SCRIPT_DIR/build-kanji.mjs"
  node --max-old-space-size=4096 "$SCRIPT_DIR/build-sentences.mjs"
  node "$SCRIPT_DIR/build-furigana.mjs"
  node "$SCRIPT_DIR/build-compounds.mjs"
  node "$SCRIPT_DIR/assemble-sqlite.mjs"
  node "$SCRIPT_DIR/zip-db.mjs"
  bash "$SCRIPT_DIR/zstd-db.sh"
}

case "$STEP" in
  jmdict)    bash "$SCRIPT_DIR/fetch-jmdict.sh" "$@" ;;
  kanjidic)  bash "$SCRIPT_DIR/fetch-kanjidic.sh" "$@" ;;
  tatoeba)   bash "$SCRIPT_DIR/fetch-tatoeba.sh" "$@" ;;
  fetch-all) fetch_all ;;
  entries)   node "$SCRIPT_DIR/build-entries.mjs" ;;
  kanji)     node "$SCRIPT_DIR/build-kanji.mjs" ;;
  sentences) node --max-old-space-size=4096 "$SCRIPT_DIR/build-sentences.mjs" ;;
  furigana)  node "$SCRIPT_DIR/build-furigana.mjs" ;;
  compounds) node "$SCRIPT_DIR/build-compounds.mjs" ;;
  db)        node "$SCRIPT_DIR/assemble-sqlite.mjs" ;;
  zip)       node "$SCRIPT_DIR/zip-db.mjs" ;;
  zstd)      bash "$SCRIPT_DIR/zstd-db.sh" ;;
  build-all) build_all ;;
  all)       fetch_all; build_all ;;
  *)         echo "Unknown step: $STEP"; usage ;;
esac
