#!/usr/bin/env bash
# npm run bcp -- "commit message"
#
# Build + commit + push in one step, for the common case of a source change
# that also needs docs/ (the GitHub Pages bundle) rebuilt to match - the
# pattern from the "kirawareru" deconjugation fix (source fix + rebuilt
# docs/ bundle, one commit, pushed straight to the working branch).
#
# Vite content-hashes docs/assets/* on every build, so a rebuild always
# turns up as an untracked new file plus a deleted old one, never a plain
# modification - `git add -A -- docs` is what picks up both sides of that.
# Everything else only stages already-tracked modifications (`git add -u`),
# so a stray untracked file elsewhere in the tree (e.g. a local .env) is
# never swept in.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${1:-}" ]; then
  echo "Usage: npm run bcp -- \"commit message\"" >&2
  exit 1
fi

npm run build:pages

git add -u
git add -A -- docs

if git diff --cached --quiet; then
  echo "Nothing staged - nothing to commit." >&2
  exit 0
fi

git commit -m "$1"
git push
