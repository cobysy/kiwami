# Kiwami Dictionary Data Build Plan

This document captures the dictionary data-build work that previously lived in the main project plan.

## Phase 0 — Dictionary data prep

- [x] Pull **JMdict_e** (CC BY-SA, EDRDG), the English-only export EDRDG already publishes,
      rather than the full multi-language JMdict.xml. Same data, smaller file, and skips
      needing to filter out French/German/Dutch/etc. glosses yourself.
      → `npm run build:db -- jmdict`.
- [x] Write a one-off Node script to parse it into a normalized schema: entries, readings,
      senses/glosses (English only), part-of-speech tags.
      → `npm run build:db -- entries` (`scripts/build-entries.mjs`); 218,173 entries.
- [x] Load into SQLite, build an FTS5 (or FTS4 if FTS5 unsupported in the WASM build you pick)
      virtual table over readings + glosses for fast lookup.
      → `npm run build:db -- db`; `search_fts` (FTS5) covers readings + glosses, verified with
      both a kana-reading and an English-gloss MATCH query.
- [x] Add a `kanji_count` column on the entries table (count of kanji characters in the
      headword), computed once at build time, used later as a filter facet.
- [x] Capture JMdict's priority markers (`news1/2`, `ichi1/2`, `spec1/2`, `gai1/2`) per
      entry and `misc` tags (`arch`, `obs`, `rare`, `obsc`, etc.) per sense. Derive a simple
      numeric commonness score at build time and store it on the entry, this is what
      ranking and archaic/rare labeling in Phase 1 will use.
      → `entries.commonness_score` + `entries.is_archaic`, plus raw per-sense `misc` tags
      kept on `entry_senses` for finer-grained filtering if ever needed.
- [x] Pull the Tatoeba Japanese-English sentence pairs (`jpn_indices.csv` +
      `sentences.csv`/`sentences_detailed.csv` from tatoeba.org, CC BY 2.0 FR), which come
      pre-linked to JMdict headwords via the indices file, so no separate matching step needed.
      → `npm run build:db -- tatoeba` (uses the *detailed* per-language exports specifically to
      capture each sentence's contributor username, required for CC BY 2.0 FR's per-author
      attribution — plain exports only had id/lang/text).
- [x] Parse into a `sentences` table (Japanese text, English translation) plus a join table
      linking sentence IDs to dictionary entry IDs.
      → `npm run build:db -- sentences`; 148,164/150,075 index rows resolved (98.7%) to 29,357
      distinct entries pre-trim.
- [x] Trim to a reasonable set per entry (e.g. cap at 3-5 example sentences per word) to
      keep the bundle size sane, favouring shorter/simpler sentences if there's a choice.
      → capped at 5, shortest-first; 62,085 sentences / 83,875 entry↔sentence links kept.
- [x] Generate furigana for each bundled sentence as a one-time build step (not shipped to
      the client): tokenize with kuromoji in Node, take a reading per token, preferring the
      JMdict reading where the token matches a known headword, falling back to kuromoji's
      own reading otherwise. Store as token/reading pairs alongside the sentence text.
      → `npm run build:db -- furigana`; stored in `sentences.furigana` (JSON token/reading pairs).
- [x] Export the finished `.sqlite` file (dictionary + sentences together) into the repo's
      public assets.
      → `npm run build:db -- db` (or `-- all`) → `public/dictionary.sqlite` (~164MB), with a
      gzipped companion at `public/dictionary.sqlite.gz`. The app-side integration is still
      pending and belongs to Phase 1.
- [x] Confirm attribution requirements for JMdict/EDRDG and for Tatoeba, and store the
      required attribution text in the database metadata.
      → Verified against edrdg.org/edrdg/licence.html and tatoeba.org's terms. The build
      pipeline populates the `meta` table with attribution values, and the per-sentence
      contributor usernames live on the sentence rows; rendering them in the app is still
      future work.
- [x] Tooling: use **DB Browser for SQLite (DB4S)** to inspect the built `.sqlite` file,
      free, open source, native macOS build, actively maintained (sqlitebrowser.org).
      Good for checking the FTS5 index and the `kanji`/`kanji_compounds` join tables came
      out right before wiring up the app.
      → Verified via `sqlite3` CLI instead (row counts, FK integrity, FTS5 queries, join
      spot-checks all passed); DB4S remains available for interactive browsing if wanted.
- [x] Pull **KANJIDIC2** (EDRDG, same license family) and parse into a `kanji` table keyed
      by character: on'yomi (katakana), kun'yomi (hiragana, with okurigana dot notation),
      English meanings, stroke count, radical number.
      → `npm run build:db -- kanjidic` + `npm run build:db -- kanji`; 13,108 characters.
- [x] Build a `kanji_compounds` join table at build time: for each kanji, precompute which
      JMdict entries contain it, carrying the commonness score along so compounds can be
      shown common-first in the UI, same ranking approach as search results.
      → `npm run build:db -- compounds`; 474,174 rows (2 references to non-KANJIDIC2 variant
      characters, 仝/靑, correctly excluded — no kanji detail page for them to link to).
- [x] **Similar kanji, same radical**: trivial from the `kanji` table's radical field,
      group kanji sharing the same primary radical, no extra data needed.
      → `kanji.radical_number` column is in place; the grouping itself is a query-time
      concern for Phase 1, not a build step.
- [ ] **Similar kanji, visually confusable**: no canonical open dataset for this exists.
      A more automated version is possible using KanjiVG's (CC BY-SA) stroke/component
      decomposition to score structural similarity — that's the path to take.
      → Tried a small hand-maintained list first (per this bullet's original wording), but
      dropped it: it was unsourced (my own general knowledge, not from any dataset — see
      README's "Not implemented" note) and too sparse (9 groups out of 13,108 kanji) to be
      worth shipping. Revisit with the KanjiVG approach instead of another hand-picked list.

**Runtime database strategy, noted 2026-07-29**: this repository currently contains the
prebuilt dictionary database and the build pipeline that generates it, but the app-side
runtime loading strategy is not yet implemented. The plan still needs a concrete choice for
how the UI will open and query the SQLite file at runtime (for example, via a WASM-based
SQLite engine with persistent storage, or another approach that fits the target browsers).

**Transfer compression, added 2026-07-29**: `dictionary.sqlite` gzips well — measured
~163.8MB → ~62.7MB (~62% smaller), since it's full of repeated JSON text (tag arrays,
etc.). The build pipeline can emit `public/dictionary.sqlite.gz` via `npm run build:db -- gzip`.
The app-side decompression step remains part of the future UI work.
