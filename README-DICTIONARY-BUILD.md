# Dictionary build notes

This file documents the current dictionary build workflow in this repository. For the project overview, see [README.md](README.md).

## Build entry points

The main dispatcher is [scripts/build-db.sh](scripts/build-db.sh), which is invoked through:

- npm run build:db -- <step>

The available steps are:

- jmdict, kanjidic, tatoeba: fetch and unpack the upstream data sources
- fetch-all: run the three fetch steps in sequence
- entries, kanji, sentences, furigana, compounds: build the intermediate NDJSON artifacts
- db: assemble the SQLite database from those artifacts
- build-all: run the build stages in dependency order
- all: run fetch-all followed by build-all

## Current build scripts

The implementation is split across these scripts:

- [scripts/fetch-jmdict.sh](scripts/fetch-jmdict.sh)
- [scripts/fetch-kanjidic.sh](scripts/fetch-kanjidic.sh)
- [scripts/fetch-tatoeba.sh](scripts/fetch-tatoeba.sh)
- [scripts/build-entries.mjs](scripts/build-entries.mjs)
- [scripts/build-kanji.mjs](scripts/build-kanji.mjs)
- [scripts/build-sentences.mjs](scripts/build-sentences.mjs)
- [scripts/build-furigana.mjs](scripts/build-furigana.mjs)
- [scripts/build-compounds.mjs](scripts/build-compounds.mjs)
- [scripts/assemble-sqlite.mjs](scripts/assemble-sqlite.mjs)

## Outputs

The build pipeline produces:

- data/raw/...: fetched source files
- data/build/...: intermediate NDJSON artifacts, including entries, kanji, sentences, furigana, and kanji_compounds
- data/build/dictionary.db: the assembled database (scripts/assemble-sqlite.mjs), read
  directly by node:sqlite-backed tooling (tests/node/dictionary.test.js, scripts/verify-db.mjs).
  Kept out of public/ so `vite build` never ships this uncompressed 134MB copy — nothing in
  the browser bundle reads it directly, only its compressed form below
- public/dictionary.db.zip: `dictionary.db` compressed to ~1/3 its size (scripts/zip-db.mjs) —
  tracked in git; jeep-sqlite's HTTP-import path natively unzips a `.zip` URL client-side, so
  no bespoke decompression code is needed. On a fresh clone, `scripts/unzip-db.mjs`'s
  `ensureDictionaryDb()` re-extracts `data/build/dictionary.db` from it on demand, the first
  time Node-side tooling needs it — no separate setup step to remember (also runnable manually
  via `npm run setup:db`)
- public/dictionary.db.zst: `dictionary.db` compressed with zstd instead (scripts/zstd-db.sh) —
  also tracked in git, smaller than the `.zip` above, and the one actually fetched at runtime
  (see `App.vue`'s `DICTIONARY_FILE`); since jeep-sqlite can't unzip zstd itself,
  `ensureDatabaseFromUrl` in `browser-sqlite-driver.js` fetches and decompresses this one
  client-side with `fzstd`

## Verification

Run:

- npm run verify:db

This checks the database schema, row counts, foreign key integrity, substring search behavior, and a few representative joins.

## Notes

This document is intentionally scoped to the scripts and outputs that currently exist in the repository. Older planning notes and experimental features are better tracked in [PLAN.md](PLAN.md).
