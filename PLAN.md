# Kiwami (極) — Japanese Dictionary App Build Plan

## Goal

Kiwami (極): a Vue-based Japanese dictionary packaged as a native-capable app for iPhone
and Mac via Capacitor, free forever, no external service dependency, and no credit card
required anywhere in setup. Dictionary lookup is fully offline. Favourites and history (the
only user-generated data) sync between devices using iCloud containers on Apple devices,
never device to device directly.

## Current status

As of 2026-07-29, the repository contains the dictionary data-build pipeline and the generated database assets. The build scripts, intermediate NDJSON artifacts, and the packaged SQLite files are present in the repo. The app UI and native shell work described in the later phases is still planned rather than implemented.

See [PLAN-DICTIONARY-BUILD.md](PLAN-DICTIONARY-BUILD.md) for the dictionary data-build plan.

## Architecture summary

| Concern | Approach |
|---|---|
| UI framework | Vue 3 + Vite |
| Distribution | Capacitor-based native shell for iPhone and Mac; optional later App Store/TestFlight distribution |
| Dictionary data | JMdict_e + Tatoeba example sentences, converted into a SQLite DB with FTS as part of the build pipeline; runtime loading strategy for the app is still TBD |
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

---

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

## Phase 2 — Native app shell plumbing

- [ ] Capacitor project setup for iOS and macOS.
- [ ] App icons, splash/launch assets, and app metadata for the native shell.
- [ ] Ensure the app can persist the dictionary database and local user data in the native
      environment without relying on browser-only install behavior.
- [ ] Validate the app on iPhone and Mac through the local build/install workflow.

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

## Phase 4 — iCloud sync settings screen

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

## Phase 5 — Sync logic and UI

- [ ] Use the Capacitor/iOS native layer or an iCloud-compatible bridge to read and write a
      small JSON payload in the shared app container for `favourites.json` and
      `history.json`.
- [ ] "Sync" action: prune `history.json` to the retention window, read the remote
      `favourites.json` and `history.json` from the iCloud container, merge each with the local
      copy by unioning entries on their stable id (from Phase 3), then write the merged result
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

## Phase 6 — Install and real-device testing

- [ ] Build and install the Capacitor app on iPhone and Mac, confirm offline dictionary
      search works with Wi-Fi off.
- [ ] Install on iPhone and Mac via the local build flow, confirm the same.
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
   storage, or another approach that fits the native shell).
2. The exact iCloud sync integration path for the native shell on iPhone and Mac.
3. Whether client-side deconjugation is worth the extra bundle cost, and which library
   or ruleset to use if it is.

## Where to start

Phase 0 is already represented in this repository via the build scripts and generated
SQLite assets. The next priority is Phase 1: wire the built database into a real app UI
and decide the runtime loading strategy. Cloud storage and sync work in Phases 4-5 should
wait until the core dictionary experience is working.
