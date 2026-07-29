# Kiwami (極) — Japanese Dictionary App Build Plan

## Goal

Kiwami (極): a Vue-based Japanese dictionary, installable on iPhone and Mac without the App Store,
free forever, no external service dependency, and no credit card required anywhere in
setup. Dictionary lookup is fully offline. Favourites and history (the only
user-generated data) sync between devices via an S3-compatible cloud storage bucket the
user configures themselves, never device to device directly.

## Current status

As of 2026-07-29, the repository contains the dictionary data-build pipeline and the generated database assets. The build scripts, intermediate NDJSON artifacts, and the packaged SQLite files are present in the repo. The app UI / PWA runtime work described in the later phases is still planned rather than implemented.

## Architecture summary

| Concern | Approach |
|---|---|
| UI framework | Vue 3 + Vite |
| Distribution | PWA, "Add to Home Screen" on iOS, "Install" in Safari/Chrome on Mac |
| Dictionary data | JMdict_e + Tatoeba example sentences, converted into a SQLite DB with FTS as part of the build pipeline; runtime loading strategy for the app is still TBD |
| Favourites/history storage | Local IndexedDB, synced as plain JSON objects |
| Sync | Direct HTTP GET/PUT against an S3-compatible bucket (Backblaze B2 by default, no credit card needed; Cloudflare R2 or self-hosted MinIO as alternatives; or any other provider implementing the S3 API), no server in between, no device-to-device link |
| Cost | $0, no Apple Developer Program, no hosted backend beyond a free-tier bucket the user owns |

Everything is JS/WASM. No native code, no Xcode signing, no server you have to keep alive
for the app to function (the dictionary works fully offline; only favourites/history need
the bucket, and only when you choose to sync). The S3 API is implemented identically by
many independent providers, so this isn't tied to any one company, swapping provider is a
config change, not a code change.

**On provider risk**: no free tier from any company is guaranteed forever, but the bucket
is never the source of truth here, it's a relay. Each device keeps its own full copy of
favourites/history in local IndexedDB at all times, sync reads/writes the bucket, it
doesn't depend on it. If a provider's terms ever changed, nothing is lost, just point both
devices at a different S3-compatible bucket (any provider, or self-hosted MinIO) and
resync.

**On distribution, decided 2026-07-29**: PWA has a real downside vs. native — iOS can clear
local storage (dictionary DB, and favourites/history if unsynced) after weeks of disuse, a
risk that doesn't exist for a normally-signed native app. The alternative that avoids it
entirely is the Apple Developer Program ($99/year individual tier), which also removes the
free personal-team signing path's much worse 7-day forced re-signing treadmill. Staying with
PWA for now regardless — it's the only option that's actually free with no card, matching
the Goal above — with TestFlight/native distribution as a planned future migration once the
$99/year is worth paying. Nothing in Phases 0-5 below should be built in a way that makes
that migration harder than it has to be (the dictionary DB, favourites/history schema, and
sync protocol are all just data — portable to a native shell later), but no extra
abstraction is being added now to hedge for it either.

---

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

## Phase 1 — Core dictionary UI

- [ ] Vite + Vue 3 project scaffold.
- [ ] On first launch, fetch `dictionary.sqlite.gz`, decompress it via
      `DecompressionStream('gzip')`, and store the decompressed bytes in OPFS; on every
      launch after that, open it from OPFS via `wa-sqlite` (no re-fetch, no full-file memory
      load — pages are read from the persisted file as needed). If OPFS reports the file
      missing/empty (e.g. iOS cleared storage after weeks of disuse), re-fetch and re-store
      it — the app should treat this as a normal "first launch" path, not an error state.
- [ ] Search view: single search box, no mode switcher. Query parsing and matching behavior:
  - [ ] **Tiered plain-text match**: exact match on reading/kanji/gloss, then prefix, then
        substring, stopping as soon as a tier returns good hits. Within each tier, sort by
        the commonness score from Phase 0 (priority-tagged entries first, untagged last),
        not by raw match order.
  - [ ] **Wildcards**: if the query contains `?` or `*`, parse as an explicit pattern
        (translated to a `LIKE`/`GLOB` query) and skip fuzzy correction. This also covers
        starts-with (`食*`) and ends-with (`*る`) without separate UI, plus a one-time hint
        under the search box explaining the syntax.
  - [ ] **Common vs. archaic/rare labeling**: entries whose senses are only tagged
        `arch`/`obs`/`rare`/`obsc` get pushed lower within their tier and shown with a
        small muted label ("archaic", "rare") right in the result row, don't rely on
        position alone to communicate this, it's too easy to miss while scanning.
  - [ ] **Fuzzy/phonetically-similar kana, opt-in not automatic**: the main case isn't
        typos, it's a learner who heard a word spoken and typed what they *thought* they
        heard, mora by mora. Don't auto-substitute when results are thin. Show whatever the
        tiered match finds (even nothing), with a plain "Didn't find it? Try fuzzy search"
        link below. Only on tapping does it run an edit-distance/phonetic pass over kana
        readings, treating each of these as a low-cost substitution rather than a full
        edit-distance step apart:
        - **Dakuten/handakuten confusion** (voicing is easy to mishear): か↔が, さ↔ざ,
          た↔だ, は↔ば↔ぱ, etc. across each consonant row.
        - **Chōon (long vowel) presence/absence/placement**: vowel length is phonemic and
          hard to hear at natural speed — おばさん (aunt) vs おばあさん (grandmother),
          ゆき (snow) vs ゆうき (courage).
        - **Sokuon (small っ, gemination) presence/absence**: きて (come) vs きって (stamp).
        - **Near-homophone mora pairs**: し/ひ, す/つ, ざ行/じゃ行 — consonants that are
          genuinely close acoustically, not just adjacent on a keyboard.
        - **ん (moraic n) before another consonant**: it assimilates toward m/ng in natural
          speech, so what's spelled ん can get misheard/mistyped as one of those.
        Results from this pass are clearly labeled as fuzzy matches, separate from direct
        tiered matches above them.
  - [ ] **Verb/adjective deconjugation**: attempt to strip known conjugation endings (past,
        negative, te-form, potential, passive, causative, etc.) against the query and check
        if a plausible dictionary form exists. If found, show a banner above the results
        ("食べた is the past tense of 食べる →") linking to the base entry, separate from any
        direct matches shown below it.
  - [ ] **Kanji-count filter**: a small collapsible filter row below the search box (closed
        by default), with chip-style options (1 / 2 / 3 / 4+ kanji) filtering the current
        result set by headword length via the `kanji_count` column. Not part of the query
        string itself, a facet on top of it.
- [ ] Entry detail view: readings, kanji forms, glosses, part of speech, and linked Tatoeba
      example sentences (Japanese + English) pulled from the join table, rendered with
      furigana via native `<ruby>`/`<rt>` tags from the precomputed token/reading data, plus
      a show/hide toggle for the furigana. Individual kanji in the headword are tappable,
      jumping to that character's kanji detail view.
- [ ] Kanji detail view: character, on'yomi, kun'yomi, English meaning(s), stroke count,
      a compounds section (common-first, from the `kanji_compounds` table), and a similar
      kanji section split into two groups, "Same radical" and "Often confused with".
- [ ] Start screen: on launch, show Favourites and Recent (history) as two sections or a
      toggle, each grouped by date header ("Today", "Yesterday", then calendar dates),
      most recent group first, most recent entry within a group first. Dedupe repeat
      lookups of the same word within a short window into one row rather than several.
- [ ] Basic navigation: search → results → entry detail → back.

## Phase 2 — PWA plumbing

- [ ] `vite-plugin-pwa` for manifest + service worker generation.
- [ ] Manifest: name, icons (multiple sizes for iOS home screen), theme colors, standalone
      display mode.
- [ ] Service worker: precache the app shell only. **Not** the dictionary DB — iOS Safari
      caps Cache API storage around 50MB, well under `dictionary.sqlite`'s ~164MB. The DB is
      fetched once and stored via OPFS instead (Phase 1), a separate mechanism with a much
      higher quota (IndexedDB/OPFS: up to 500MB, or half of free disk if less).
- [ ] Test "Add to Home Screen" on iOS Safari and "Install" on macOS Safari/Chrome.
- [ ] Verify storage persists across days of non-use once installed to home screen (not
      just an open tab). iOS's eviction risk here is measured in weeks, not days, so this is
      a smoke test, not proof of long-term persistence — the real safety net is Phase 1's
      "DB missing → re-fetch" fallback, which matters more than trying to prevent eviction.

## Phase 3 — Favourites and history data model

- [ ] Decide the favourites schema: word id, added timestamp, optional note/tag. Stored
      locally as a plain JSON array in IndexedDB.
- [ ] History (recent lookups): word id + timestamp, its own JSON array, separate from
      favourites. **Dedupe at write time**: skip adding a new entry if the same word was
      looked up within the last hour, this keeps the synced payload small, not just the
      on-screen list. **Prune on a rolling window** (30 days as a default) before each sync,
      so it doesn't grow unbounded.
- [ ] Both arrays live in IndexedDB locally at all times, fast, no sync machinery involved
      for normal use, syncing is a separate explicit step (Phase 5).
- [ ] Give each entry a stable id (e.g. word id + timestamp) so merging two copies of the
      same array later is a straightforward union by id, no line-based diffing needed since
      this isn't git anymore, just two JSON arrays to reconcile.

## Phase 4 — Cloud storage settings screen

Not a build-time decision, a settings screen so any user can point the app at their own
bucket:

- [ ] Settings fields: endpoint URL, bucket name, access key ID, secret access key.
- [ ] Guidance text in the settings screen pointing at providers with real free tiers that
      speak the S3 API, since this is the user's choice, not baked into the app:
      - **Backblaze B2 (default recommendation)**: 10 GB free, no credit card required to
        create an account, matches the "no card, ever" requirement directly. Note:
        backblaze.com's homepage pushes their paid unlimited backup subscription, a
        different product. Sign up at the B2-specific page (backblaze.com/sign-up/s3) to
        land on the actual free S3-compatible storage product, not the backup one.
      - **Cloudflare R2 or Google Cloud Storage (alternatives, require a card)**: both
        speak the S3 API (GCS via its XML API and HMAC keys) and would work as drop-in
        alternatives, but both require a payment method on file before you can use them
        at all, free-tier usage or not. Only relevant for someone who doesn't mind adding
        a card, not the default path.
      - **Self-hosted MinIO**, for anyone who'd rather touch no third party at all.
- [ ] CORS: each provider has a bucket-level CORS setting, part of the S3 spec itself, not
      something that varies by host the way it did with git. Guidance text should link to
      "how to enable CORS on your bucket" for whichever provider, a one-time few-minute
      step during setup.
- [ ] "Test connection" action: attempt a small GET against the bucket before saving, so a
      bad endpoint/bucket/key is caught immediately, not on the first real sync.
- [ ] Store settings locally per device (IndexedDB, plain config, never synced into
      `favourites.json`/`history.json` or uploaded anywhere itself).
- [ ] Recommend a bucket-scoped access key (not a full-account key) in the guidance text,
      every S3-compatible provider supports scoping keys to one bucket.
- [ ] Each device is configured once, independently: same bucket on both, keys can match
      or differ per device, doesn't matter to the sync logic either way.

## Phase 5 — Sync logic and UI

- [ ] Use a small request-signing library like `aws4fetch` (tiny, sits directly on
      `fetch`, no full AWS SDK needed) to sign S3-compatible requests against the bucket
      from Phase 4.
- [ ] "Sync" action: prune `history.json` to the retention window, GET the remote
      `favourites.json` and `history.json` from the bucket, merge each with the local copy
      by unioning entries on their stable id (from Phase 3), PUT the merged result back.
- [ ] Merge conflict handling: since entries are additions identified by a stable id, a
      "conflict" is really just two devices adding different things, the union handles
      that automatically. Decide a fallback only for the rare case of the exact same id
      appearing with different content (e.g. keep the newer timestamp).
- [ ] Read local favourites and history state from the merged arrays after each sync,
      rebuild the UI's start screen from it.
- [ ] Manual sync button only, triggered on request. No background or auto-sync on
      foreground, simpler to build and reason about, and nothing here needs to be
      real-time.
- [ ] Show last-synced time and basic sync status/errors in the UI.

## Phase 6 — Install and real-device testing

- [ ] Deploy the PWA somewhere it can be reached over HTTPS from both devices (needed for
      service worker + "Add to Home Screen" to behave correctly).
- [ ] Install on iPhone via Safari, confirm offline dictionary search works with Wi-Fi off.
- [ ] Install on Mac via Safari or Chrome, confirm the same.
- [ ] Add a favourite and look up a few words on one device, sync, confirm both the
      favourite and the recent lookups appear on the other after a sync on that device.
- [ ] Kill/reopen the app on both, confirm favourites and dictionary state survive.

## Phase 7 — Polish / later additions

- [ ] Kanji stroke order or radical lookup, if wanted later.
- [ ] Study/SRS mode built on top of favourites (still just more entries in the same JSON
      array, same sync mechanism).

---

## Open decisions before starting

1. Runtime dictionary engine for the app (for example, a WASM SQLite engine with persisted
   storage, or another approach that fits the target browsers).
2. Where the PWA itself is hosted (needs stable HTTPS hosting, separate from the
   storage bucket configured in Phase 4). Still open, not needed until Phase 6.
3. Whether client-side deconjugation is worth the extra bundle cost, and which library
   or ruleset to use if it is.

## Where to start

Phase 0 is already represented in this repository via the build scripts and generated
SQLite assets. The next priority is Phase 1: wire the built database into a real app UI
and decide the runtime loading strategy. Cloud storage and sync work in Phases 4-5 should
wait until the core dictionary experience is working.
