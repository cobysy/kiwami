#!/usr/bin/env bash
# npm run build:db -- tatoeba
#
# Downloads the Tatoeba data needed for Phase 0's example-sentences table:
#   - jpn_indices.tar.bz2            Japanese sentences pre-linked to JMdict
#                                     headwords (the "indices" file — this is
#                                     what lets sentences be joined to
#                                     dictionary entries with no separate
#                                     matching step)
#   - jpn_sentences_detailed.tsv.bz2 Japanese sentence text + contributor
#                                     username, keyed by sentence id
#   - eng_sentences_detailed.tsv.bz2 English sentence text + contributor
#                                     username, keyed by sentence id
#   - jpn-eng_links.tsv.bz2          Japanese-id <-> English-id translation pairs
#
# The "detailed" per-language exports (not the plain ones) are used
# specifically because they include the contributor username: Tatoeba
# sentences are CC BY 2.0 FR, which requires crediting the individual
# sentence author, not just "Tatoeba" generically. Per-language files are
# still used instead of the full multi-language sentences_detailed export
# (~300MB compressed) since only Japanese and English are needed here;
# per-language download is ~40MB total.
#
# Output (all under data/raw/tatoeba/):
#   jpn_indices.tar.bz2, jpn_indices.csv
#   jpn_sentences_detailed.tsv.bz2, jpn_sentences_detailed.tsv
#   eng_sentences_detailed.tsv.bz2, eng_sentences_detailed.tsv
#   jpn-eng_links.tsv.bz2, jpn-eng_links.tsv
#
# Safe to re-run: skips any file whose archive is already present locally.
# Use --force to re-download everything even if already present.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../data/raw/tatoeba"
BASE_URL="https://downloads.tatoeba.org/exports"
FORCE=0

for arg in "$@"; do
  [[ "$arg" == "--force" ]] && FORCE=1
done

mkdir -p "$OUT_DIR"

fetch() {
  local url="$1"
  local file="$2"
  if [[ -f "$OUT_DIR/$file" && "$FORCE" -eq 0 ]]; then
    echo "$file already present, skipping download (use --force to re-fetch)."
  else
    echo "Downloading $file..."
    curl -fL --progress-bar "$url" -o "$OUT_DIR/$file"
  fi
}

fetch "$BASE_URL/jpn_indices.tar.bz2" "jpn_indices.tar.bz2"
fetch "$BASE_URL/per_language/jpn/jpn_sentences_detailed.tsv.bz2" "jpn_sentences_detailed.tsv.bz2"
fetch "$BASE_URL/per_language/eng/eng_sentences_detailed.tsv.bz2" "eng_sentences_detailed.tsv.bz2"
fetch "$BASE_URL/per_language/jpn/jpn-eng_links.tsv.bz2" "jpn-eng_links.tsv.bz2"

echo "Extracting..."
tar -xjf "$OUT_DIR/jpn_indices.tar.bz2" -C "$OUT_DIR"
bunzip2 -kf "$OUT_DIR/jpn_sentences_detailed.tsv.bz2"
bunzip2 -kf "$OUT_DIR/eng_sentences_detailed.tsv.bz2"
bunzip2 -kf "$OUT_DIR/jpn-eng_links.tsv.bz2"

echo "Done: $OUT_DIR/{jpn_indices.csv,jpn_sentences_detailed.tsv,eng_sentences_detailed.tsv,jpn-eng_links.tsv}"
