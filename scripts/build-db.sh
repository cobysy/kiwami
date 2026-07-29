#!/usr/bin/env bash
# npm run build:db -- <step> [extra args]
#
# Single entry point for every data-prep/build step that feeds
# public/dictionary.sqlite, so package.json's scripts block doesn't carry one
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
#   db                            assemble everything into dictionary.sqlite
#                                  (scripts/assemble-sqlite.mjs)
#   gzip                          gzip -9 dictionary.sqlite -> dictionary.sqlite.gz
#                                  (~163.8MB -> ~62.7MB measured; this is what the app
#                                  actually fetches at runtime, decompressing client-side
#                                  via DecompressionStream('gzip') before writing to OPFS
#                                  — see PLAN.md Phase 1. Not tracked in git: cheap (~14s)
#                                  to regenerate locally from the tracked .sqlite, unlike
#                                  the network-dependent fetch+build pipeline.)
#   build-all                     all seven build stages above, in dependency order
#   all                           fetch-all then build-all
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
  echo "Steps: jmdict kanjidic tatoeba fetch-all entries kanji sentences furigana compounds db gzip build-all all"
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
  gzip_db
}

gzip_db() {
  local src="$SCRIPT_DIR/../public/dictionary.sqlite"
  local out="$SCRIPT_DIR/../public/dictionary.sqlite.gz"
  echo "Gzipping dictionary.sqlite..."
  gzip -9 -k -c "$src" > "$out"
  echo "Wrote $(du -h "$out" | cut -f1) to $out (from $(du -h "$src" | cut -f1))"
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
  gzip)      gzip_db ;;
  build-all) build_all ;;
  all)       fetch_all; build_all ;;
  *)         echo "Unknown step: $STEP"; usage ;;
esac
