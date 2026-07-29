# Kiwami (極)

Offline-first Japanese dictionary PWA. See `PLAN.md` for the full build plan.

## npm scripts

Every data-prep / build step that produces `public/dictionary.sqlite` runs
through one dispatcher, `npm run build:db -- <step>`, so package.json's
scripts block doesn't carry one line per step. Each step is still just a
single underlying script (`scripts/fetch-*.sh`, `scripts/build-*.mjs`,
`scripts/assemble-sqlite.mjs`) — the dispatcher (`scripts/build-db.sh`) only
changes how they're invoked, not what they do. `npm run build:db --` with no
step prints usage.

| `npm run build:db -- <step>` | What it does | Output |
|---|---|---|
| `jmdict` | Downloads JMdict_e (EDRDG, English-only JMdict export) and decompresses it. | `data/raw/jmdict/JMdict_e` |
| `kanjidic` | Downloads KANJIDIC2 (EDRDG) and decompresses it. | `data/raw/kanjidic/kanjidic2.xml` |
| `tatoeba` | Downloads Tatoeba's JMdict-linked Japanese sentence indices, Japanese/English sentence text with contributor usernames (needed for CC BY per-author attribution), and JP↔EN link pairs (per-language exports, ~40MB total vs. ~300MB for the full multi-language dump), and decompresses them. | `data/raw/tatoeba/{jpn_indices.csv,jpn_sentences_detailed.tsv,eng_sentences_detailed.tsv,jpn-eng_links.tsv}` |
| `fetch-all` | Runs `jmdict`, `kanjidic`, `tatoeba` in sequence. | — |
| `entries` | Parses `JMdict_e` into normalized entries/readings/senses/glosses/POS tags, priority markers, a derived commonness score, `is_archaic` flag, and `kanjiCount`. | `data/build/entries.ndjson` |
| `kanji` | Parses `kanjidic2.xml` into a kanji table (on'yomi, kun'yomi, meanings, stroke count, classical radical number). | `data/build/kanji.ndjson` |
| `sentences` | Joins Tatoeba's JMdict-linked sentences to entries (via `jpn_indices.csv`), trims to the 5 shortest example sentences per entry, and carries each sentence's Japanese/English contributor username through for attribution. | `data/build/sentences.ndjson`, `data/build/entry_sentences.ndjson` |
| `furigana` | Tokenizes the kept example sentences with kuromoji/IPADIC (build-time only) and assigns a reading per token, preferring the JMdict reading where the token matches a known headword. | `data/build/furigana.ndjson` |
| `compounds` | For each kanji, finds which entries contain it in their headword, carrying commonness score for common-first ordering. Skips references to characters outside KANJIDIC2's set (e.g. rare variant forms) since there's no kanji detail page for them to link to. | `data/build/kanji_compounds.ndjson` |
| `db` | Assembles every build artifact above into the single SQLite file the app loads at runtime (via `wa-sqlite` + OPFS — see PLAN.md's "Dictionary engine, revisited" note; this was `sql.js` originally, reversed once the actual DB size made that a real problem, not hypothetical). Builds the `search_fts` FTS5 index over readings + glosses, all normalized entry/kanji/sentence tables and join tables, and a `meta` table with license attribution text. Implemented in `scripts/assemble-sqlite.mjs`. | `public/dictionary.sqlite` |
| `gzip` | Gzips `dictionary.sqlite` (measured: ~163.8MB → ~62.7MB, ~62% smaller). This is what the app actually fetches at runtime — decompressed client-side via `DecompressionStream('gzip')` before being written to OPFS (see PLAN.md Phase 1), rather than relying on server/CDN auto-compression, since Phase 6's hosting target isn't decided yet and many static hosts don't auto-compress unusual extensions like `.sqlite` anyway. Not tracked in git (see `.gitignore`) — cheap (~14s) to regenerate locally from the tracked `.sqlite`. | `public/dictionary.sqlite.gz` |
| `build-all` | Runs `entries` through `gzip` in dependency order (does *not* include the fetch steps — run `fetch-all` first, or use `all`). | `public/dictionary.sqlite`, `public/dictionary.sqlite.gz` |
| `all` | `fetch-all` then `build-all` — the whole pipeline from nothing to `dictionary.sqlite.gz`. | `public/dictionary.sqlite`, `public/dictionary.sqlite.gz` |

Separately, `npm run verify:db` sanity-checks `dictionary.sqlite`: prints the
live schema (a quick tour of every table, useful if you weren't around when
it was built), row counts, foreign key integrity, FTS5 search spot checks,
and join checks across entries/kanji/sentences/meta. Exits non-zero if
anything fails. It ends with an "Example queries" section — realistic
query patterns (gloss/reading search, kanji-count filter, archaic labeling,
kanji detail + compounds, sentence + furigana), each printing both the SQL
and its actual result rows — meant as copy-pasteable reference for Phase 1's
UI code, not just a correctness check.

All fetch steps are idempotent — they skip re-downloading an archive that's
already present. Pass `--force` through, e.g. `npm run build:db -- jmdict --force`,
to force a re-download.

Downloaded/generated data lives under `data/raw/` and `data/build/`, both
gitignored — re-run `npm run build:db -- all` to reproduce them rather than
committing them.

**Not implemented**: PLAN.md Phase 0's "similar kanji, visually confusable"
feature. An earlier version of this shipped a small hand-authored seed list
(`data/static/confusable-kanji.json`, compiled into `kanji_confusable_groups`/
`kanji_confusable_members` tables) — both were removed since the list was
unsourced (not from any dataset — just general knowledge) and too sparse (9
groups out of 13,108 kanji) to be worth shipping as-is. Revisit with a real
source before adding it back — PLAN.md flags KanjiVG's (CC BY-SA) stroke/
component decomposition as the likely path: compute structural similarity
programmatically instead of hand-picking pairs. "Similar kanji, same radical"
is unaffected — that one's sourced directly from KANJIDIC2's `kanji.radical_number`.

## Data sources

- **JMdict_e** — EDRDG, CC BY-SA 4.0. http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
- **KANJIDIC2** — EDRDG, same license family. http://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz
- **Tatoeba** sentences/indices — CC BY 2.0 FR. https://downloads.tatoeba.org/exports/

Attribution is required in-app per both licenses (checked against
edrdg.org/edrdg/licence.html and tatoeba.org's terms of use):

- **EDRDG (JMdict/KANJIDIC2)** requires acknowledging usage/source with a
  link back to EDRDG — no exact pre-written text is mandated. General
  attribution text is stored in `dictionary.sqlite`'s `meta` table
  (`jmdict_kanjidic_attribution`).
- **Tatoeba (CC BY 2.0 FR)** requires crediting the *individual* sentence
  author, not just "Tatoeba" — so `sentences.japanese_author` and
  `sentences.english_author` carry each sentence's contributor username
  (`null` where Tatoeba's export itself has no author on file) for
  per-sentence in-app credit, alongside a general project-level mention
  (`meta.tatoeba_attribution`).

None of this is rendered in the UI yet — that's Phase 1/2 (the data is there,
wiring it into a visible credits screen isn't done).
