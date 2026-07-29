# Kiwami (極) — Japanese Dictionary App Build Plan

## Goal

Kiwami (極): a Vue-based Japanese dictionary packaged as a native-capable app for iPhone
and Mac via Capacitor, free forever, no external service dependency, and no credit card
required anywhere in setup. Dictionary lookup is fully offline. Favourites and history (the
only user-generated data) sync between devices using iCloud containers on Apple devices,
never device to device directly.

## Current status

As of 2026-07-29, the repository contains the dictionary data-build pipeline and the generated database assets (Phase 0), plus Phase 1's dictionary engine: the shared driver interface, the Node (node:sqlite) and browser (jeep-sqlite web fallback) drivers, and the full query layer (tiered match, wildcards, kanji-count facet, archaic tagging, fuzzy kana matching, deconjugation) — all covered by one test suite that runs identically against both drivers (`npm run test:node` / `npm run test:browser`), plus a minimal dev harness (`npm run dev`) for exercising it by hand. See [README-DICTIONARY.md](README-DICTIONARY.md) and Phase 1 below for what's done vs. still open (notably: the Electron IPC stub, and native-storage bundling/copy-on-first-run, both deferred to Phase 3). Phase 2's real UI and the native shell work in later phases is still planned rather than implemented.

See [PLAN-DICTIONARY-BUILD.md](PLAN-DICTIONARY-BUILD.md) for the dictionary data-build plan.

## Architecture summary

| Concern | Approach |
|---|---|
| UI framework | Vue 3 + Vite |
| Distribution | Same `vite build` output shared by both shells: Capacitor-based native shell for iPhone; Electron-based native shell for Mac (decided 2026-07-29 — Capacitor has no official macOS platform, see Phase 3). Optional later App Store/TestFlight distribution for iOS. |
| Dictionary data | JMdict_e + Tatoeba example sentences, converted into a SQLite DB via the build pipeline; query layer uses a uniform `LIKE`-scan on every driver; loaded via each platform's driver (node:sqlite on Node/Electron, jeep-sqlite/sql.js in the browser, native SQLite on iOS) |
| Favourites/history storage | Local IndexedDB, synced as plain JSON objects |
| Sync | iCloud container-based sync for Apple devices, no server in between, no device-to-device link |
| Cost | $0 for local development and testing with free tools; no paid Apple Developer account is required for direct device builds and installs, no hosted backend required |

Everything is JS/WASM. The app will be wrapped in a Capacitor-based native shell for iOS and
macOS, and no server you have to keep alive for the app to function (the dictionary works
fully offline; only favourites/history need iCloud sync, and only when you choose to sync).
Local builds and device testing can be done with Xcode and a free Apple ID; the paid Apple
Developer Program is not needed for this workflow because the app will be built, installed,
and shared directly on devices by the developer and any users who opt in. iCloud sync is
wired into Apple’s ecosystem, but it avoids the extra complexity of managing credentials and
bucket permissions for ordinary users.

> **⚠ Unverified risk, flagged 2026-07-29**: Apple's free "Personal Team" code signing has
> historically excluded the iCloud capability/entitlement from an App ID — it's one of the
> capabilities documented as requiring a paid Apple Developer Program membership. If that's
> still true, the "$0 / no paid account" premise above is incompatible with iCloud-based sync
> as designed in Phases 5-6. **Verify this before starting Phase 5**: in Xcode, create a
> throwaway target signed with a free Apple ID (no paid team) and try adding the "iCloud"
> capability. If it's blocked, the sync design needs a different transport (see open decision
> below) before any further Phase 5/6 work is worth doing.
>
> **Possible partial mitigation on the Mac side (Electron, decided 2026-07-29)**: Electron
> apps distributed outside the Mac App Store aren't sandboxed, so the Mac half of sync could
> just write plain files into the user's `~/Library/Mobile Documents/com~apple~CloudDocs/`
> folder — no iCloud entitlement or paid account needed for that. This doesn't fix the iOS
> side: Capacitor/iOS is always sandboxed and very likely still needs the iCloud capability to
> get a ubiquity container URL at all. So the risk narrows to "does the iOS half work without
> a paid account," not "does sync work at all" — still needs the Xcode check above.

---

## Phase 1 — Dictionary engine (shared query layer + platform drivers)

Build and prove out the dictionary engine on its own, against the already-built database,
before any UI exists. Everything in this phase is platform-agnostic app code except the two
driver implementations, which are the only pieces allowed to know which platform they're on.

- [x] Minimal Vite + Vue 3 project scaffold — just enough to host the engine code and a small
      dev harness (e.g. a bare page or script) for exercising queries without building UI yet.
      Done 2026-07-29: `index.html` + `vite.config.js` + `src/main.js` + `src/App.vue`, the
      latter being the dev harness (search box, kanji-count chips, fuzzy link, deconjugation
      banner) described below — not Phase 2's real UI. See
      [README-DICTIONARY.md](README-DICTIONARY.md).
- [x] **Shared driver interface, decided 2026-07-29**: define one small interface (e.g.
      `run(sql, params) → rows`, plus open/close) that all query logic is written against.
      This interface, and everything built on top of it, lives in the regular Vue codebase,
      not per-shell code — it must not know or care which driver is active underneath it.
      Implemented 2026-07-29 as `open`/`exec`/`all`/`run`/`close` (`src/db/driver.js`) rather
      than the single `run` in the original example — both real backends already draw this
      same exec-vs-query-vs-mutate line internally (node:sqlite, the Capacitor SQLite
      plugin), so matching it avoids a driver-side heuristic guessing "is this DDL or a
      parameterized statement" from a SQL string.
  - [x] **Native Capacitor SQLite plugin driver** for iOS, decided 2026-07-29 (supersedes the
        earlier wa-sqlite/OPFS plan — see open decision 1): use a native SQLite bridge plugin
        (e.g. `@capacitor-community/sqlite`) instead of an in-page WASM engine. Same shape as
        the Electron driver below — real native SQLite (iOS ships `libsqlite3` as a system
        library) runs on the native/Swift side, and the JS half of the driver calls into it
        through the Capacitor plugin bridge. This sidesteps OPFS entirely, so there's no
        COOP/COEP header or VFS-variant question to resolve on this platform. **Browser dev
        testing**: `@capacitor-community/sqlite` ships a web fallback (`jeep-sqlite`, a WASM
        SQLite web component with its own persistence) specifically so the driver and the
        query layer above it can be developed and tested in a normal `vite dev` browser tab —
        no iPhone install needed until Phase 3/7's real on-device validation. **Browser dev
        fallback done and tested 2026-07-29** (`src/db/drivers/browser-driver.js`, driven by
        `@capacitor-community/sqlite`'s own JS API — the actual native iOS code path is
        untouched, so this should carry over unchanged, but that's unverified until Phase 3
        wires up a real Capacitor project and validates on-device/in-simulator). Real findings
        from getting this working, written up in [README-DICTIONARY.md](README-DICTIONARY.md):
        - `package.json` pins `sql.js` to exactly `1.11.0` (not `^1.11.0`) — see
          `scripts/copy-sql-wasm.mjs`'s header comment for why a semver-compatible newer
          version breaks jeep-sqlite's bundled JS glue's WASM ABI match.
        - The real 134MB `dictionary.db` loads and opens fine through this driver in
          practice — fetch+import well under a second locally, despite `sql.js` holding the
          whole database in WASM memory. Verified both by the dev harness (`src/App.vue`,
          which loads it on mount) and, more rigorously, by
          `tests/browser/dictionary.test.js` running the full cross-driver suite against it
          under Playwright — not a fixture standing in for it.
          The assembled database is named `dictionary.db` (not `.sqlite`) specifically because
          jeep-sqlite's HTTP-import path picks its strategy from the URL's file extension and
          only recognizes `.db`/`.zip` — see `scripts/assemble-sqlite.mjs`.
  - [~] **`node:sqlite` driver** for Mac/Electron, decided 2026-07-29: native driver runs in
        the Electron main process; the renderer-side half of the driver forwards `run()` calls
        over IPC and returns the results. Structurally the same pattern as the iOS driver above
        (native SQLite behind a bridge) — Electron's IPC standing in for the Capacitor plugin
        bridge. Only needs a minimal Electron main-process stub to build/test against here —
        the full shell setup is Phase 3. **The driver itself is done and tested 2026-07-29**
        (`src/db/drivers/node-driver.js`, wrapping node:sqlite directly) — it's what the
        Node half of the cross-driver test suite runs against. **Not done**: the minimal
        Electron main-process/IPC stub this bullet also calls for — the driver has only been
        exercised as a plain in-process Node module (via Vitest), not forwarded over real
        Electron IPC. Left for whoever picks up Phase 3, since it needs an actual `electron`
        dependency and main-process wiring that's otherwise out of scope for the engine/driver
        work this phase is about.
  - [x] Swapping the driver behind the interface should be the only platform-specific step;
        confirm this by running the same query-layer test/harness against both drivers. Done
        2026-07-29: `tests/shared/run-dictionary-suite.js` holds one set of test bodies (21 cases
        covering every bullet below, plus the driver interface itself and the kanji/compounds/
        sentence joins), run verbatim against the Node driver (`npm run test:node`, plain
        Vitest) and the browser driver (`npm run test:browser`, Vitest's browser mode in a
        real headless Chromium via Playwright) — both pass identically. Runs against the real,
        full `public/dictionary.db` (read-only) rather than a hand-picked fixture — every
        assertion is anchored to a real entry looked up directly against the data (same
        approach `verify-db.mjs`'s example queries use), and the real db is small enough to
        open instantly in the Node driver and load in well under a second in the browser
        driver too.
- [ ] The dictionary DB (~134MB) ships inside the native app already — bundling `dictionary.db`
      as an app asset and copying it into the app's native local data directory (both
      platforms, via each driver's own storage APIs) on first run avoids a redundant network
      fetch entirely. If a network fetch is still wanted later (e.g. to let the app ship
      without the dictionary and let it lag the build pipeline), revisit gzipping it for
      transfer and decompressing via `DecompressionStream('gzip')` before storing the bytes via
      the active driver's storage — no such fetch path exists yet, so there's no gzip build
      step today either. Either way, on every launch after first load, open it from local
      storage via the driver (no re-fetch, no full-file memory load — pages are read from the
      persisted file as needed), and if local storage reports the file missing/empty,
      re-fetch/re-copy it — the app should treat this as a normal "first launch" path, not an
      error state. **Not done —
      this is real native-storage plumbing that needs Phase 3's actual iOS/Electron shells to
      implement against.** The browser driver's `ensureDatabaseFromUrl` helper
      (`src/db/drivers/browser-driver.js`) is a related but not equivalent mechanism (fetch
      into `jeep-sqlite`'s IndexedDB-backed store, not "copy a bundled asset into the native
      data directory") built for dev-harness use, not a substitute for this bullet.
- [x] Query layer: pure logic built against the driver interface, callable and testable
      (e.g. via the dev harness or unit tests) independent of any UI. Done 2026-07-29,
      `src/db/dictionary/` — every sub-bullet below is implemented and covered by the
      cross-driver test suite (`tests/shared/run-dictionary-suite.js`).
  - [x] **Tiered plain-text match**: exact match on reading/kanji/gloss, then prefix, then
        substring, stopping as soon as a tier returns good hits. Within each tier, sort by
        the commonness score from Phase 0 (priority-tagged entries first, untagged last),
        not by raw match order. Implemented in `src/db/dictionary/search.js`: kanji, reading, and
        gloss all use the same `LIKE`-scan approach at every tier, uniformly not
        index-accelerated for prefix/substring, beyond exact/prefix benefiting incidentally
        from `entry_kanji`/`entry_readings`' plain b-tree indexes.
  - [x] **Wildcards**: if the query contains `?` or `*`, parse as an explicit pattern
        (translated to a `LIKE`/`GLOB` query) and skip fuzzy correction. This also covers
        starts-with (`食*`) and ends-with (`*る`) without separate UI. Implemented as
        `wildcardToLikePattern` in `src/db/dictionary/search.js`.
  - [x] **Common vs. archaic/rare tagging**: entries whose senses are only tagged
        `arch`/`obs`/`rare`/`obsc` get pushed lower within their tier and flagged in the
        result data (e.g. an `archaic`/`rare` field) so the UI phase can label them —
        the engine decides the tier and flag, the UI decides how to display it. Implemented in
        `src/db/dictionary/entries.js` (`fetchEntriesByIds`), reusing the `is_archaic` column and
        misc-tag subquery pattern `scripts/verify-db.mjs`'s example queries already established.
  - [x] **Fuzzy/phonetically-similar kana, opt-in not automatic**: the main case isn't
        typos, it's a learner who heard a word spoken and typed what they *thought* they
        heard, mora by mora. Expose this as a separate query function the UI calls only on
        explicit request (not auto-triggered when results are thin), running an
        edit-distance/phonetic pass over kana readings, treating each of these as a low-cost
        substitution rather than a full edit-distance step apart:
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
        Results from this pass are flagged as fuzzy matches in the returned data, separate
        from direct tiered matches, so the UI can render them separately. Implemented as a
        weighted-edit-distance function (`weightedKanaDistance`) in `src/db/dictionary/fuzzy.js`,
        exported standalone for unit testing without a database. Cheap-substitution costs cover
        dakuten/handakuten pairs, chōon (both the katakana ー mark and native hiragana
        vowel-repetition spelling, e.g. おばあさん), sokuon, and the near-homophone pairs
        listed above. ん-before-consonant assimilation isn't its own rule: ん only ever matches
        ん literally in typed text (nothing about how it's spoken changes its spelling), so
        there was no extra substitution rule to add — it already gets ordinary equality.
  - [x] **Verb/adjective deconjugation**: attempt to strip known conjugation endings (past,
        negative, te-form, potential, passive, causative, etc.) against the query and check
        if a plausible dictionary form exists via the driver. Return the base entry (if found)
        separately from direct matches, so the UI phase can render it as a banner
        ("食べた is the past tense of 食べる →") without the engine knowing about banners.
        Implemented in `src/db/dictionary/deconjugate.js`: ichidan (v1), godan (v5* with the full
        onbin sound-change table for past/te-form), and i-adjective (adj-i) rules, each
        candidate cross-checked against the entry's actual JMdict pos tag before being accepted
        (not just "does this string exist anywhere") to keep noise down.
  - [x] **Kanji-count filter**: expose headword length filtering by the `kanji_count` column
        as a query parameter (1 / 2 / 3 / 4+), a facet on top of the base query rather than
        part of the query string itself — the UI phase adds the chip row that drives it.
        Implemented as the `kanjiCount` option on `search()` in `src/db/dictionary/search.js`
        (4 means "4 or more", matching the "4+" chip).

## Phase 2 — Core dictionary UI

Wires the Vue app to the query layer built in Phase 1; no engine/driver work happens here.

- [ ] Search view: single search box, no mode switcher, calling Phase 1's tiered match /
      wildcard / fuzzy / deconjugation query functions and rendering their results.
  - [ ] Archaic/rare label: small muted label ("archaic", "rare") right in the result row for
        entries flagged by the engine, don't rely on tier position alone to communicate this,
        it's too easy to miss while scanning.
  - [ ] One-time hint under the search box explaining wildcard (`?`/`*`) syntax.
  - [ ] "Didn't find it? Try fuzzy search" link below plain results, calling the engine's
        fuzzy query function only on tap, with fuzzy results rendered in their own
        clearly-labeled section.
  - [ ] Deconjugation banner above results when the engine returns a base-entry match
        (e.g. "食べた is the past tense of 食べる →"), separate from direct matches below it.
  - [ ] Kanji-count filter: a small collapsible filter row below the search box (closed by
        default), with chip-style options (1 / 2 / 3 / 4+ kanji) driving the engine's
        kanji-count facet.
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

## Phase 3 — Native app shell plumbing

By this point the query layer and both drivers already exist (Phase 1); this phase is about
wiring the two drivers into their real native shells and validating on-device, not designing
the engine split itself.

- [ ] Capacitor project setup for iOS, wiring in the native SQLite plugin driver from Phase 1.
- [ ] **Electron project setup for Mac (decided 2026-07-29)** — Capacitor has no official
      "macOS" platform, only `ios`/`android`/`web`. Both shells point at the same `vite build`
      output (`webDir` for Capacitor, `BrowserWindow.loadFile` for Electron), so the Vue app
      itself is one codebase; only the native bridge layer differs per platform. Wire in the
      full `node:sqlite`-over-IPC driver from Phase 1 (replacing the Phase 1 stub main
      process with the real Electron app).
- [ ] App icons, splash/launch assets, and app metadata for both the Capacitor and Electron
      shells.
- [ ] Ensure the app can persist the dictionary database and local user data in both native
      environments without relying on browser-only install behavior.
- [ ] Validate the app on iPhone (Capacitor) and Mac (Electron) through the local
      build/install workflow.

## Phase 4 — Favourites and history data model

- [ ] Decide the favourites schema: word id, added timestamp, optional note/tag. Stored
      locally as a plain JSON array in IndexedDB.
- [ ] History (recent lookups): word id + timestamp, its own JSON array, separate from
      favourites. **Dedupe at write time**: skip adding a new entry if the same word was
      looked up within the last hour, this keeps the synced payload small, not just the
      on-screen list. **Prune on a rolling window** (30 days as a default) before each sync,
      so it doesn't grow unbounded.
- [ ] Both arrays live in IndexedDB locally at all times, fast, no sync machinery involved
      for normal use, syncing is a separate explicit step (Phase 6).
- [ ] Give each entry a stable id (e.g. word id + timestamp) so merging two copies of the
      same array later is a straightforward union by id, no line-based diffing needed since
      this isn't git anymore, just two JSON arrays to reconcile.
- [ ] **Data-loss risk, distinct from the dictionary DB**: iOS can evict WKWebView-backed
      storage (IndexedDB) under disk pressure. For the dictionary DB this no longer applies —
      since Phase 1 moved iOS storage to a native SQLite plugin instead of OPFS, the DB file
      lives in the app's native data directory, not WKWebView-managed storage; the plan still
      treats a missing/corrupt file as a normal re-fetch, but eviction specifically isn't the
      trigger anymore. Favourites/history in IndexedDB has no such recovery path: eviction is
      real data loss for the one thing in
      this app that's actually user-generated. Worth deciding whether to sync-on-write (or at
      least prompt a sync) rather than relying purely on the manual sync button in Phase 6.

## Phase 5 — iCloud sync settings screen

Not a build-time decision, a settings screen so the app can use the user’s own iCloud
container for sync:

- [ ] Settings fields: iCloud container enablement / status, optional sync-on-open toggle,
      optional manual sync trigger, and a simple status banner showing whether the container
      is available.
- [ ] Guidance text in the settings screen explaining that sync is Apple-device-only and uses
      the user’s iCloud account, not a third-party bucket.
- [ ] "Test connection" action: attempt to read/write a tiny sync marker or metadata file in
      the iCloud container before saving, so a missing/disabled iCloud setup is caught
      immediately, not on the first real sync.
- [ ] Store settings locally per device (IndexedDB, plain config, never synced into
      `favourites.json`/`history.json` or uploaded anywhere itself).
- [ ] Each device is configured once, independently: the same iCloud account can be used on
      both devices, but the sync logic remains device-local and does not depend on any extra
      credentials.

## Phase 6 — Sync logic and UI

- [ ] Use the Capacitor/iOS native layer or an iCloud-compatible bridge to read and write a
      small JSON payload in the shared app container for `favourites.json` and
      `history.json`.
- [ ] "Sync" action: prune `history.json` to the retention window, read the remote
      `favourites.json` and `history.json` from the iCloud container, merge each with the local
      copy by unioning entries on their stable id (from Phase 4), then write the merged result
      back.
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

## Phase 7 — Install and real-device testing

- [ ] Build and install the Capacitor app on iPhone and Mac, confirm offline dictionary
      search works with Wi-Fi off.
- [ ] Install on iPhone and Mac via the local build flow, confirm the same.
- [ ] Add a favourite and look up a few words on one device, sync, confirm both the
      favourite and the recent lookups appear on the other after a sync on that device.
- [ ] Kill/reopen the app on both, confirm favourites and dictionary state survive.

## Phase 8 — Polish / later additions

- [ ] Kanji stroke order or radical lookup, if wanted later.
- [ ] Study/SRS mode built on top of favourites (still just more entries in the same JSON
      array, same sync mechanism).

---

## Open decisions before starting

1. ~~Runtime dictionary engine for the app~~ — **decided 2026-07-29: native SQLite on both
   platforms**, not an in-page WASM engine. iOS uses a native Capacitor SQLite plugin (e.g.
   `@capacitor-community/sqlite`) instead of the earlier `wa-sqlite`/OPFS idea, which avoids
   the OPFS VFS-variant/COOP-COEP question entirely (see Phase 1). This resolves the SQLite
   half of the earlier `wa-sqlite` vs. `sql.js`+`kuromoji.js` ambiguity; whether `kuromoji.js`
   (or another library) is still needed is a separate question, covered by open decision 3
   (deconjugation).
2. The exact iCloud sync integration path for the native shell on iPhone and Mac —
   **blocked on verifying whether the iCloud capability is available under a free Apple ID
   ("Personal Team") at all; historically it has required a paid Developer Program
   membership**, which would contradict the $0/no-paid-account premise in the Architecture
   summary. Test this in Xcode before committing to Phases 5-6 as designed. If it's blocked,
   alternatives to consider: a paid account (breaks the cost goal), or dropping cross-device
   sync down to manual export/import (e.g. share sheet with a JSON file) as a $0 fallback.
3. ~~Whether client-side deconjugation is worth the extra bundle cost, and which library
   or ruleset to use if it is.~~ — **decided/resolved 2026-07-29**: hand-rolled rule set, no
   extra library — see `src/db/dictionary/deconjugate.js` and Phase 1 above. Zero added bundle
   cost since it's pure JS string manipulation plus a DB lookup through the existing driver.
4. ~~Mechanism for shipping a Mac build~~ — **decided 2026-07-29: Electron**, sharing the
   same `vite build` output as the Capacitor iOS shell. ~~Follow-on: whether Mac also uses a
   native SQLite driver~~ — **decided 2026-07-29: yes, on both platforms**, via a shared query
   layer sitting behind a small driver interface, with a native Capacitor SQLite plugin on iOS
   and `node:sqlite`-over-IPC on Mac as the only platform-specific pieces, built and proven
   out on its own before any UI work (see Phase 1).
5. ~~Whether kanji-headword search stays on its current linear-scan code path (simpler, but a
   different performance profile than reading/gloss tiers) or gets index-accelerated in the
   build pipeline.~~ — **superseded 2026-07-29**: moot now that the whole Phase 1 query layer
   uses the same uniform `LIKE`-scan for every field, not just kanji — see Phase 1's Capacitor
   SQLite driver bullet above.

## Where to start

Phase 0 (dictionary data prep) and Phase 1 (dictionary engine: query layer + platform
drivers, proven out with no UI involved) are both represented in this repository now — see
their sections above and [README-DICTIONARY.md](README-DICTIONARY.md) for what's done vs. still open
within Phase 1 (the Electron IPC stub and native-storage bundling are deferred to Phase 3).
The next priority is Phase 2: wire the Vue app's real UI to the query layer built in Phase 1.
Cloud storage and sync work in Phases 5-6 should wait until the core dictionary experience is
working.
