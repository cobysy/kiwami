#!/usr/bin/env bash
# npm run build:db -- kanjidic
#
# Downloads KANJIDIC2 (EDRDG) and decompresses it. Source of on'yomi/kun'yomi,
# English meanings, stroke count, and radical number used to build the `kanji`
# table in Phase 0.
#
# Output:
#   data/raw/kanjidic/kanjidic2.xml.gz   (downloaded archive, kept for re-runs)
#   data/raw/kanjidic/kanjidic2.xml      (decompressed XML, used by the Phase 0 parser)
#
# Safe to re-run: skips the download if kanjidic2.xml.gz already exists locally.
# Use --force to re-download even if the file is already present.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../data/raw/kanjidic"
URL="http://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz"
FORCE=0

for arg in "$@"; do
  [[ "$arg" == "--force" ]] && FORCE=1
done

mkdir -p "$OUT_DIR"

if [[ -f "$OUT_DIR/kanjidic2.xml.gz" && "$FORCE" -eq 0 ]]; then
  echo "kanjidic2.xml.gz already present, skipping download (use --force to re-fetch)."
else
  echo "Downloading kanjidic2.xml.gz from EDRDG..."
  curl -fL --progress-bar "$URL" -o "$OUT_DIR/kanjidic2.xml.gz"
fi

echo "Decompressing..."
gunzip -kf "$OUT_DIR/kanjidic2.xml.gz"

echo "Done: $OUT_DIR/kanjidic2.xml"
