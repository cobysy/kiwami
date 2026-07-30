#!/usr/bin/env bash
# npm run bcp -- "commit message"
#
# Build + commit + push in one step, for the common case of a source change
# that also needs docs/ (the GitHub Pages bundle) rebuilt to match - the
# pattern from the "kirawareru" deconjugation fix (source fix + rebuilt
# docs/ bundle, one commit, pushed straight to the working branch).
#
# `git add -A` stages the whole tree - new files (e.g. a new source module),
# modifications, and deletions alike - same as staging docs/ needs anyway:
# Vite content-hashes docs/assets/* on every build, so a rebuild always turns
# up as an untracked new file plus a deleted old one, never a plain
# modification. .gitignore is still respected, so build output/deps/etc.
# don't get swept in.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${1:-}" ]; then
  echo "Usage: npm run bcp -- \"commit message\"" >&2
  exit 1
fi

npm run build:pages

git add -A

if git diff --cached --quiet; then
  echo "Nothing staged - nothing to commit." >&2
  exit 0
fi

git commit -m "$1"
git push
