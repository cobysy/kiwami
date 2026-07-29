#!/usr/bin/env bash
# npm run build:db -- jmdict
#
# Downloads JMdict_e (the English-only export of JMdict, published by EDRDG) and
# decompresses it. Source of readings/kanji forms/glosses/part-of-speech used to
# build the dictionary entries table in Phase 0.
#
# Output:
#   data/raw/jmdict/JMdict_e.gz   (downloaded archive, kept for re-runs)
#   data/raw/jmdict/JMdict_e      (decompressed XML, used by the Phase 0 parser)
#
# Safe to re-run: skips the download if JMdict_e.gz already exists locally.
# Use --force to re-download even if the file is already present.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../data/raw/jmdict"
URL="http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz"
FORCE=0

for arg in "$@"; do
  [[ "$arg" == "--force" ]] && FORCE=1
done

mkdir -p "$OUT_DIR"

if [[ -f "$OUT_DIR/JMdict_e.gz" && "$FORCE" -eq 0 ]]; then
  echo "JMdict_e.gz already present, skipping download (use --force to re-fetch)."
else
  echo "Downloading JMdict_e.gz from EDRDG..."
  curl -fL --progress-bar "$URL" -o "$OUT_DIR/JMdict_e.gz"
fi

echo "Decompressing..."
gunzip -kf "$OUT_DIR/JMdict_e.gz"

echo "Done: $OUT_DIR/JMdict_e"
