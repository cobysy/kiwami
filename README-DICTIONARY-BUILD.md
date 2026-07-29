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
- gzip: create public/dictionary.sqlite.gz
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
- public/dictionary.sqlite: the assembled database used by the app
- public/dictionary.sqlite.gz: a gzipped copy for distribution

## Verification

Run:

- npm run verify:db

This checks the database schema, row counts, foreign key integrity, FTS search behavior, and a few representative joins.

## Notes

This document is intentionally scoped to the scripts and outputs that currently exist in the repository. Older planning notes and experimental features are better tracked in [PLAN.md](PLAN.md).
