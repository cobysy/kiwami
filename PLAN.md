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
| Distribution | Same `vite build` output shared by both shells: Capacitor-based native shell for iPhone; Electron-based native shell for Mac (decided 2026-07-29 — Capacitor has no official macOS platform, see Phase 3). Optional later App Store/TestFlight distribution for iOS. |
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

- [ ] Minimal Vite + Vue 3 project scaffold — just enough to host the engine code and a small
      dev harness (e.g. a bare page or script) for exercising queries without building UI yet.
- [ ] **Shared driver interface, decided 2026-07-29**: define one small interface (e.g.
      `run(sql, params) → rows`, plus open/close) that all query logic is written against.
      This interface, and everything built on top of it, lives in the regular Vue codebase,
      not per-shell code — it must not know or care which driver is active underneath it.
  - [ ] **Native Capacitor SQLite plugin driver** for iOS, decided 2026-07-29 (supersedes the
        earlier wa-sqlite/OPFS plan — see open decision 1): use a native SQLite bridge plugin
        (e.g. `@capacitor-community/sqlite`) instead of an in-page WASM engine. Same shape as
        the Electron driver below — real native SQLite (iOS ships `libsqlite3` as a system
        library) runs on the native/Swift side, and the JS half of the driver calls into it
        through the Capacitor plugin bridge. This sidesteps OPFS entirely, so there's no
        COOP/COEP header or VFS-variant question to resolve on this platform. **Browser dev
        testing**: `@capacitor-community/sqlite` ships a web fallback (`jeep-sqlite`, a WASM
        SQLite web component with its own persistence) specifically so the driver and the
        query layer above it can be developed and tested in a normal `vite dev` browser tab —
        no iPhone install needed until Phase 3/7's real on-device validation.
  - [ ] **`better-sqlite3` driver** for Mac/Electron, decided 2026-07-29: native driver runs in
        the Electron main process; the renderer-side half of the driver forwards `run()` calls
        over IPC and returns the results. Structurally the same pattern as the iOS driver above
        (native SQLite behind a bridge) — Electron's IPC standing in for the Capacitor plugin
        bridge. Only needs a minimal Electron main-process stub to build/test against here —
        the full shell setup is Phase 3.
  - [ ] Swapping the driver behind the interface should be the only platform-specific step;
        confirm this by running the same query-layer test/harness against both drivers.
- [ ] The dictionary DB (~164MB, ~62.7MB gzipped per PLAN-DICTIONARY-BUILD.md) ships inside
      the native app already — bundling `dictionary.sqlite(.gz)` as an app asset and copying
      it into the app's native local data directory (both platforms, via each driver's own
      storage APIs) on first run avoids a redundant network fetch entirely. If a network fetch
      is still wanted (e.g. to let the app ship without the dictionary and let it lag the
      build pipeline), fetch `dictionary.sqlite.gz`, decompress it via
      `DecompressionStream('gzip')`, and store the decompressed bytes via the active driver's
      storage; on every launch after that, open it from local storage via the driver (no
      re-fetch, no full-file memory load — pages are read from the persisted file as needed).
      Either way, if local storage reports the file missing/empty, re-fetch/re-copy it — the
      app should treat this as a normal "first launch" path, not an error state.
- [ ] Query layer: pure logic built against the driver interface, callable and testable
      (e.g. via the dev harness or unit tests) independent of any UI:
  - [ ] **Tiered plain-text match**: exact match on reading/kanji/gloss, then prefix, then
        substring, stopping as soon as a tier returns good hits. Within each tier, sort by
        the commonness score from Phase 0 (priority-tagged entries first, untagged last),
        not by raw match order. **Note (verified against the built DB, 2026-07-29)**:
        `search_fts` only indexes `reading` and `gloss` — the kanji headword
        (`entry_kanji.text`) has a plain b-tree index, not FTS. Exact/prefix kanji lookups
        can use that index, but substring and leading-wildcard kanji queries (e.g. `*る`)
        need a full scan over the ~218K kanji rows via a separate, slower code path than
        reading/gloss tiers use. Either accept that asymmetry or add kanji to the FTS table
        in the build pipeline before relying on it here.
  - [ ] **Wildcards**: if the query contains `?` or `*`, parse as an explicit pattern
        (translated to a `LIKE`/`GLOB` query) and skip fuzzy correction. This also covers
        starts-with (`食*`) and ends-with (`*る`) without separate UI.
  - [ ] **Common vs. archaic/rare tagging**: entries whose senses are only tagged
        `arch`/`obs`/`rare`/`obsc` get pushed lower within their tier and flagged in the
        result data (e.g. an `archaic`/`rare` field) so the UI phase can label them —
        the engine decides the tier and flag, the UI decides how to display it.
  - [ ] **Fuzzy/phonetically-similar kana, opt-in not automatic**: the main case isn't
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
        from direct tiered matches, so the UI can render them separately.
  - [ ] **Verb/adjective deconjugation**: attempt to strip known conjugation endings (past,
        negative, te-form, potential, passive, causative, etc.) against the query and check
        if a plausible dictionary form exists via the driver. Return the base entry (if found)
        separately from direct matches, so the UI phase can render it as a banner
        ("食べた is the past tense of 食べる →") without the engine knowing about banners.
  - [ ] **Kanji-count filter**: expose headword length filtering by the `kanji_count` column
        as a query parameter (1 / 2 / 3 / 4+), a facet on top of the base query rather than
        part of the query string itself — the UI phase adds the chip row that drives it.

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
      full `better-sqlite3`-over-IPC driver from Phase 1 (replacing the Phase 1 stub main
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
3. Whether client-side deconjugation is worth the extra bundle cost, and which library
   or ruleset to use if it is.
4. ~~Mechanism for shipping a Mac build~~ — **decided 2026-07-29: Electron**, sharing the
   same `vite build` output as the Capacitor iOS shell. ~~Follow-on: whether Mac also uses a
   native SQLite driver~~ — **decided 2026-07-29: yes, on both platforms**, via a shared query
   layer sitting behind a small driver interface, with a native Capacitor SQLite plugin on iOS
   and `better-sqlite3`-over-IPC on Mac as the only platform-specific pieces, built and proven
   out on its own before any UI work (see Phase 1).
5. Whether kanji-headword search stays on its current non-FTS code path (simpler, but a
   different performance profile than reading/gloss tiers) or gets added to the FTS index in
   the build pipeline.

## Where to start

Phase 0 is already represented in this repository via the build scripts and generated
SQLite assets. The next priority is Phase 1: build the shared dictionary engine (query layer
+ platform drivers) directly against the built database, with no UI involved yet. Phase 2
wires the Vue app to that engine once it's solid. Cloud storage and sync work in Phases 5-6
should wait until the core dictionary experience is working.
