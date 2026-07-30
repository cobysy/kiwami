<script setup>
// Phase 1 dev harness (PLAN.md): "just enough to host the engine code and a
// small dev harness for exercising queries without building UI yet." Not
// Phase 2's real search UI — no routing, no entry/kanji detail views — and
// not itself how Phase 1 is verified: that's tests/node/dictionary.test.js
// and tests/browser/dictionary.test.js, which run the same query layer
// (src/dictionary) against the same browser driver (jeep-sqlite) and the
// real public/dictionary.db under Playwright (see README-DICTIONARY.md's
// findings on why that's fast enough in-browser). This component is only a
// manual tool for eyeballing search results by hand against that same real
// data — the styling here is a usable dev-harness skin, not Phase 2's design
// system.
import { ref, computed, onMounted } from 'vue';
import { createBrowserDriver, ensureDatabaseFromUrl } from './dictionary/sqlite-drivers/browser-sqlite-driver.js';
import { search, fuzzySearch, deconjugate, fetchSentencesForEntry, fetchKanjiDetails, conjugate, isConjugatableVerb } from './dictionary/index.js';
import { DIALECT_OPTIONS, dialectColor } from './dictionary/dialect-labels.js';
import { priorityLabel, priorityColor } from './dictionary/frequency-labels.js';
import { posLabel, posShortLabel, posColor } from './dictionary/pos-labels.js';
import { miscLabel, miscColor } from './dictionary/misc-labels.js';
import { lsourceLangLabel } from './dictionary/lsource-labels.js';
import { version as appVersion } from '../package.json';

// Tooltip text for a result's raw priority tags (news1, nf12, ...) - the
// tags are meaningless on their own (especially nfXX bands), so the visible
// badge stays terse and the decoded meaning is a hover-away.
function priorityTitle(tags) {
  return tags.map((tag) => `${tag}: ${priorityLabel(tag)}`).join('\n');
}

// Renders a result's loanword source info (JMdict lsource, e.g. アンニョン's
// "hi; hey" glosses sourced from Korean "annyeong") as "from Korean:
// annyeong" - or "partly from X" / just "from X" with no source word when
// JMdict recorded ls_type="part" or left the element empty. '' (not null)
// when there's nothing to show, so templates can just check truthiness.
function lsourceText(lsources) {
  if (!lsources || lsources.length === 0) return '';
  return lsources.map((ls) => {
    const lang = lsourceLangLabel(ls.lang);
    const label = ls.partial ? `partly from ${lang}` : `from ${lang}`;
    return ls.text ? `${label}: ${ls.text}` : label;
  }).join('; ');
}

// Dictionary DB load lifecycle: 'idle' | 'loading' | 'ready' | 'error'. Drives
// statusLabel, the status dot, and disables search/reload while not ready.
const status = ref('idle');
// Human-readable failure detail shown under the status row when status is 'error'.
const errorMessage = ref('');
// Template ref bound to the search <input> - used to autofocus it once the
// dictionary finishes loading (see onMounted).
const searchInput = ref(null);

const statusLabel = computed(() => ({
  idle: 'Idle',
  loading: 'Loading dictionary…',
  ready: 'Ready',
  error: 'Failed to load',
}[status.value] ?? status.value));

const MATCH_MODES = [
  ['auto', 'Auto'],
  ['startsWith', 'Starts with'],
  ['endsWith', 'Ends with'],
  ['contains', 'Contains'],
];
const KANJI_COUNTS = [1, 2, 3, 4];

// Raw text in the search box (v-model'd to the input).
const query = ref('');
// 'auto' | 'startsWith' | 'endsWith' | 'contains'
const matchMode = ref('auto');
// 1 | 2 | 3 | 4 | null
const kanjiCount = ref(null);
// JMdict dial tag (e.g. 'ksb') | null
const dialect = ref(null);
// User toggle for revealing the archaic/obsolete/rare results block (see archaicView above).
const showArchaic = ref(false);
// Match tier the engine reports for the last search (e.g. 'exact', 'partial') | null before any search.
const tier = ref(null);
// How the engine actually interpreted the raw query (e.g. after wildcard/kana normalization) | null.
const interpretedQuery = ref(null);
// Main search results from the last runSearch() call.
const results = ref([]);
// Fuzzy-search results from the last runFuzzy() call, shown in the fuzzy-matches view.
const fuzzyResults = ref([]);
// Mirrors interpretedQuery but for the fuzzy search path.
const fuzzyInterpretedQuery = ref(null);
// Whether the fuzzy-results view is currently shown instead of the main results.
const showFuzzy = ref(false);
// Deconjugation candidates for the current query (e.g. した -> 為る) from deconjugate().
const deconjugated = ref([]);
// Whether a search has actually been run yet - distinguishes "no results" from "haven't searched" for empty-state messaging.
const hasSearched = ref(false);

// The engine returns archaic/obsolete/rare/obscure entries flagged, not
// filtered out (PLAN.md: "the engine decides the tier and flag, the UI
// decides how to display it"). They always live in their own block below
// the main list rather than interleaved by score — an archaic sense of a
// common word (e.g. 母/いろは, an archaic reading meaning "birth mother")
// would otherwise land near the top of the list by commonness/tier order
// despite being a dead usage, which reads as "this is a live result" when
// it isn't. showArchaic reveals that block instead of hiding it outright,
// and if every match for a query is archaic (e.g. なむち), it's shown
// regardless of the toggle — otherwise a query that actually has hits would
// look like "no results".
function archaicView(list) {
  const main = list.filter((r) => !r.archaic);
  const archaic = list.filter((r) => r.archaic);
  const allArchaic = main.length === 0 && archaic.length > 0;
  return { main, archaic, allArchaic };
}
const resultsView = computed(() => archaicView(results.value));
const fuzzyResultsView = computed(() => archaicView(fuzzyResults.value));

// Deconjugation candidates lean on loose suffix-stripping (and, as a
// fallback, kuromoji's basic_form guesses - see deconjugate.js), which
// surfaces obscure same-reading verbs (e.g. した also deconjugates to 為る,
// 擦る, 剃る, 掏る) alongside the one the user actually meant. Priority tags
// (news1/ichi1/spec1/gai1/...) are JMdict's own commonness signal - the same
// one driving the score badge on regular results - so reusing it here hides
// that noise without a separate heuristic.
const commonDeconjugated = computed(() => deconjugated.value.filter((d) => d.priority.length > 0));

const selectedDialectLabel = computed(
  () => DIALECT_OPTIONS.find(([t]) => t === dialect.value)?.[1] ?? null,
);

// Clicking a result card expands it in place to show its kanji breakdown
// (stroke count + on'yomi/kun'yomi), Tatoeba example sentences (furigana
// pre-baked at build time - see build-furigana.mjs), and, for verbs, a
// conjugation panel. Any number of cards can be expanded at once; kanji and
// sentences are fetched lazily on first expand, then cached by entry id for
// the rest of the session so re-toggling the same card doesn't re-query the
// DB. Conjugation is pure string logic (conjugate.js) - no fetch needed.
// Set of result entry ids currently expanded (detail panel visible).
const expandedIds = ref(new Set());
// entryId -> { status: 'loading'|'ready'|'error', sentences: [] }
const sentenceCache = ref({});
// entryId -> { status: 'loading'|'ready'|'error', kanji: [] }
const kanjiCache = ref({});
// Set of entry ids whose conjugation panel is currently open (subset of expandedIds).
const conjugationOpenIds = ref(new Set());

function sentencesFor(entryId) {
  return sentenceCache.value[entryId] ?? { status: 'idle', sentences: [] };
}

function kanjiFor(entryId) {
  return kanjiCache.value[entryId] ?? { status: 'idle', kanji: [] };
}

function conjugationFor(r) {
  return conjugate(r.kanji[0] ?? null, r.readings[0], r.pos);
}

function toggleConjugation(entryId) {
  if (conjugationOpenIds.value.has(entryId)) {
    conjugationOpenIds.value.delete(entryId);
  } else {
    conjugationOpenIds.value.add(entryId);
  }
}

async function toggleExpand(entryId, headword) {
  if (expandedIds.value.has(entryId)) {
    expandedIds.value.delete(entryId);
    conjugationOpenIds.value.delete(entryId);
    syncUrl();
    return;
  }
  expandedIds.value.add(entryId);
  syncUrl();

  if (!sentenceCache.value[entryId]) {
    sentenceCache.value[entryId] = { status: 'loading', sentences: [] };
    fetchSentencesForEntry(driver, entryId)
      .then((sentences) => { sentenceCache.value[entryId] = { status: 'ready', sentences }; })
      .catch(() => { sentenceCache.value[entryId] = { status: 'error', sentences: [] }; });
  }

  if (!kanjiCache.value[entryId]) {
    kanjiCache.value[entryId] = { status: 'loading', kanji: [] };
    fetchKanjiDetails(driver, headword)
      .then((kanji) => { kanjiCache.value[entryId] = { status: 'ready', kanji }; })
      .catch(() => { kanjiCache.value[entryId] = { status: 'error', kanji: [] }; });
  }
}

let driver = null;

// public/dictionary.db.zst (scripts/zstd-db.sh) - see ensureDatabaseFromUrl's
// jsdoc for how this gets decompressed and imported.
const DICTIONARY_FILE = 'dictionary.db.zst';

async function loadRealDictionary(force = false) {
  status.value = 'loading';
  errorMessage.value = '';
  try {
    await driver?.close();
    driver = null;
    await ensureDatabaseFromUrl('dictionary', `${import.meta.env.BASE_URL}${DICTIONARY_FILE}`, { force });
    driver = createBrowserDriver('dictionary', { readonly: true });
    await driver.open();
    status.value = 'ready';
  } catch (err) {
    driver = null;
    errorMessage.value = `${err} (run "npm run build:db -- db" first if this is a missing-file error)`;
    status.value = 'error';
  }
}

// Reuses the engine's existing wildcard support (PLAN.md: "*"/"?" already
// cover starts-with/ends-with/contains without separate UI) — these modes
// just wrap the raw query in the right wildcard rather than adding new
// query-layer logic.
function effectiveQuery() {
  const q = query.value.trim();
  // Blank query stays blank regardless of matchMode - wrapping it (e.g.
  // "*") would turn a dialect-only browse into a full wildcard table scan.
  if (!q) return q;
  if (matchMode.value === 'startsWith') return `${q}*`;
  if (matchMode.value === 'endsWith') return `*${q}`;
  if (matchMode.value === 'contains') return `*${q}*`;
  return q;
}

// The paste event fires before the browser has actually inserted the
// pasted text, so v-model's query.value is still stale at this point —
// defer to the next tick so runSearch reads the post-paste value.
function onPaste() {
  setTimeout(runSearch, 0);
}

function clearQuery() {
  query.value = '';
  runSearch();
}

// Keeps the address bar in sync with the current search + open entry so a
// copied link reproduces both (replaceState, not pushState - filter/expand
// changes shouldn't spam browser history, just the shareable current view).
function syncUrl() {
  const params = new URLSearchParams();
  const q = query.value.trim();
  if (q) params.set('q', q);
  if (matchMode.value !== 'auto') params.set('mode', matchMode.value);
  if (kanjiCount.value) params.set('kanji', String(kanjiCount.value));
  if (dialect.value) params.set('dialect', dialect.value);
  if (showArchaic.value) params.set('archaic', '1');
  if (expandedIds.value.size) params.set('entry', [...expandedIds.value].join(','));
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  window.history.replaceState(window.history.state, '', url);
}

async function runSearch() {
  const hasQuery = query.value.trim().length > 0;
  if (!driver || (!hasQuery && !dialect.value)) {
    results.value = [];
    tier.value = null;
    interpretedQuery.value = null;
    deconjugated.value = [];
    hasSearched.value = false;
    syncUrl();
    return;
  }
  hasSearched.value = true;
  expandedIds.value.clear();
  const searchOptions = { kanjiCount: kanjiCount.value ?? undefined, dialect: dialect.value ?? undefined };
  const [searchResult, deconjResult] = await Promise.all([
    search(driver, effectiveQuery(), searchOptions),
    hasQuery ? deconjugate(driver, query.value) : Promise.resolve([]),
  ]);
  tier.value = searchResult.tier;
  interpretedQuery.value = searchResult.interpretedQuery ?? null;
  results.value = searchResult.results;
  deconjugated.value = deconjResult;
  showFuzzy.value = false;
  fuzzyResults.value = [];
  fuzzyInterpretedQuery.value = null;
  syncUrl();
}

async function runFuzzy() {
  showFuzzy.value = true;
  expandedIds.value.clear();
  syncUrl();
  const fuzzy = await fuzzySearch(driver, query.value);
  fuzzyResults.value = fuzzy;
  fuzzyInterpretedQuery.value = fuzzy.interpretedQuery ?? null;
}

// Mirror image of syncUrl(): applies a shared/copied link's params to the
// search refs before the first search runs, and returns the entry ids to
// re-open afterward (deferred since expandedIds isn't populated by a search
// - it only exists once toggleExpand has fetched sentences/kanji for a row).
function restoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('q')) query.value = params.get('q');
  const mode = params.get('mode');
  if (MATCH_MODES.some(([value]) => value === mode)) matchMode.value = mode;
  const kanji = Number(params.get('kanji'));
  if (KANJI_COUNTS.includes(kanji)) kanjiCount.value = kanji;
  const dial = params.get('dialect');
  if (dial) dialect.value = dial;
  if (params.get('archaic') === '1') showArchaic.value = true;
  return (params.get('entry') ?? '')
    .split(',')
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

onMounted(async () => {
  const pendingEntryIds = restoreFromUrl();
  await loadRealDictionary();
  searchInput.value?.focus();
  if (status.value === 'ready' && (query.value.trim() || dialect.value)) {
    await runSearch();
    for (const entryId of pendingEntryIds) {
      const r = results.value.find((row) => row.id === entryId);
      if (!r) continue;
      if (r.archaic) showArchaic.value = true;
      await toggleExpand(r.id, r.kanji.join(''));
    }
  }
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <img class="brand-mark" src="/favicon.svg" alt="" />
        <div class="brand-text">
          <h1>Kiwami</h1>
          <span class="brand-sub">Japanese dictionary · v{{ appVersion }}</span>
        </div>
      </div>
      <div class="header-actions">
        <a
          class="icon-btn"
          href="https://github.com/cobysy/kiwami"
          target="_blank"
          rel="noopener noreferrer"
          title="View on GitHub"
        >
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.58.11.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.7-1.28-1.7-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.77.12 3.06.74.8 1.19 1.83 1.19 3.09 0 4.43-2.7 5.4-5.27 5.69.42.36.78 1.07.78 2.15 0 1.56-.01 2.81-.01 3.19 0 .31.21.68.8.56A10.51 10.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
          </svg>
        </a>
        <button
          type="button"
          class="icon-btn"
          title="Reload dictionary.db"
          :disabled="status === 'loading'"
          @click="loadRealDictionary(true)"
        >
          <svg
            class="icon"
            :class="{ spin: status === 'loading' }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>
    </header>

    <div class="status-row" :class="status">
      <span class="status-dot"></span>
      <span class="status-text">{{ statusLabel }}</span>
      <span v-if="errorMessage" class="status-error">{{ errorMessage }}</span>
    </div>

    <main class="content">
      <section class="search-card">
        <div class="search-box">
          <svg class="icon search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref="searchInput"
            v-model="query"
            type="text"
            inputmode="search"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Search kanji, reading, or English gloss…"
            @keyup.enter="runSearch"
            @paste="onPaste"
          />
          <button v-if="query" type="button" class="clear-btn" title="Clear" @click="clearQuery">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <button type="button" class="search-btn" :disabled="status !== 'ready'" @click="runSearch">
          Search
        </button>
      </section>

      <p class="hint">
        Tip: use <code>?</code> for a single character and <code>*</code> for any number of
        characters, e.g. <code>食*</code> or <code>*る</code>.
      </p>

      <section class="filters">
        <div class="filter-group">
          <span class="filter-label">Match</span>
          <div class="segmented">
            <button
              v-for="[value, label] in MATCH_MODES"
              :key="value"
              type="button"
              class="segment"
              :class="{ active: matchMode === value }"
              @click="matchMode = value; runSearch()"
            >
              {{ label }}
            </button>
          </div>
        </div>

        <div class="filter-group">
          <span class="filter-label">Kanji count</span>
          <div class="segmented">
            <button
              v-for="n in KANJI_COUNTS"
              :key="n"
              type="button"
              class="segment"
              :class="{ active: kanjiCount === n }"
              @click="kanjiCount = kanjiCount === n ? null : n; runSearch()"
            >
              {{ n === 4 ? '4+' : n }}
            </button>
            <button
              type="button"
              class="segment"
              :class="{ active: kanjiCount === null }"
              @click="kanjiCount = null; runSearch()"
            >
              Any
            </button>
          </div>
        </div>

        <div class="filter-group">
          <span class="filter-label">Dialect</span>
          <select v-model="dialect" class="select" @change="runSearch">
            <option :value="null">Any dialect</option>
            <option v-for="[tag, label] in DIALECT_OPTIONS" :key="tag" :value="tag">{{ label }}</option>
          </select>
          <span v-if="dialect && !query.trim()" class="filter-note">
            Browsing every entry tagged {{ selectedDialectLabel }}
          </span>
        </div>

        <label class="switch-row">
          <span class="switch">
            <input type="checkbox" v-model="showArchaic" />
            <span class="switch-track"><span class="switch-thumb"></span></span>
          </span>
          <span>
            Show archaic / obsolete / rare
            <span v-if="resultsView.archaic.length > 0" class="count-pill">{{ resultsView.archaic.length }}</span>
          </span>
        </label>
      </section>

      <section v-if="commonDeconjugated.length" class="deconj-card">
        <div v-for="d in commonDeconjugated" :key="`${d.id}-${d.relation}`" class="deconj-row">
          <span class="deconj-surface">{{ d.surface }}</span>
          <span class="deconj-arrow">→</span>
          <span class="deconj-relation">{{ d.relation }}</span>
          <span class="deconj-arrow">of</span>
          <span class="deconj-headword">{{ d.kanji[0] ?? d.readings[0] }}</span>
          <span class="deconj-gloss">{{ d.glosses.join('; ') }}</span>
        </div>
      </section>

      <template v-if="!showFuzzy">
        <div v-if="tier" class="results-meta">
          <span class="tier-pill" :class="`tier-${tier}`">{{ tier }}</span>
          <span class="results-count">{{ resultsView.main.length }} result{{ resultsView.main.length === 1 ? '' : 's' }}</span>
          <span v-if="resultsView.archaic.length > 0 && !resultsView.allArchaic" class="archaic-note">
            {{ resultsView.archaic.length }} archaic/obsolete/rare{{ showArchaic ? '' : ' (hidden)' }}
          </span>
          <span v-if="interpretedQuery" class="interpreted-note">interpreted as {{ interpretedQuery }}</span>
          <button v-if="query" type="button" class="fuzzy-link" @click="runFuzzy">Didn't find it? Try fuzzy search →</button>
        </div>

        <p v-else-if="hasSearched" class="empty-state">No matches yet — try a different query.</p>
        <p v-else class="empty-state">Search a kanji, reading, or English gloss to get started.</p>

        <ul v-if="resultsView.main.length" class="result-list">
          <li
            v-for="r in resultsView.main"
            :key="r.id"
            class="result-card"
            :class="{ expanded: expandedIds.has(r.id) }"
            @click="toggleExpand(r.id, r.kanji.join(''))"
          >
            <div class="result-row">
              <span class="result-headword">{{ r.kanji.join('、') || r.readings.join('、') }}</span>
              <span v-if="r.kanji.length" class="result-reading">{{ r.readings.join('、') }}</span>
              <span v-for="p in r.pos" :key="p" class="tag tag-pos" :style="{ '--tag-color': posColor(p) }" :title="posLabel(p)">{{ posShortLabel(p) }}</span>
              <span v-for="l in r.labels" :key="l" class="tag tag-label" :style="{ '--tag-color': miscColor(l) }">{{ miscLabel(l) }}</span>
              <span v-for="d in r.dialect" :key="d" class="tag tag-dialect" :style="{ '--tag-color': dialectColor(d) }">{{ d }}</span>
              <span v-if="r.priority.length" class="score-badge" :style="{ '--tag-color': priorityColor(r.priority) }" :title="priorityTitle(r.priority)">{{ r.commonness_score }}</span>
            </div>
            <p class="result-gloss" :title="[r.glosses.join('; '), lsourceText(r.lsources)].filter(Boolean).join(' — ')">{{ r.glosses.join('; ') }}<span v-if="lsourceText(r.lsources)" class="result-lsource"> ({{ lsourceText(r.lsources) }})</span></p>
            <div v-if="expandedIds.has(r.id)" class="detail-panel" @click.stop>
              <div v-if="r.kanji.length" class="kanji-details">
                <p class="detail-label">Kanji</p>
                <p v-if="kanjiFor(r.id).status === 'loading'" class="detail-status">Loading kanji…</p>
                <p v-else-if="kanjiFor(r.id).status === 'error'" class="detail-status detail-status-error">Couldn't load kanji details.</p>
                <ul v-else-if="kanjiFor(r.id).kanji.length" class="kanji-list">
                  <li v-for="k in kanjiFor(r.id).kanji" :key="k.literal" class="kanji-item">
                    <span class="kanji-literal">{{ k.literal }}</span>
                    <span v-if="k.strokeCount" class="kanji-strokes">{{ k.strokeCount }} strokes</span>
                    <span v-if="k.onyomi.length" class="kanji-yomi"><span class="kanji-yomi-tag">On'yomi</span>{{ k.onyomi.join('、') }}</span>
                    <span v-if="k.kunyomi.length" class="kanji-yomi"><span class="kanji-yomi-tag">Kun'yomi</span>{{ k.kunyomi.join('、') }}</span>
                  </li>
                </ul>
              </div>

              <div v-if="isConjugatableVerb(r.pos)" class="conjugate-section">
                <button type="button" class="conjugate-btn" @click="toggleConjugation(r.id)">
                  {{ conjugationOpenIds.has(r.id) ? 'Hide conjugation' : 'Conjugate ▾' }}
                </button>
                <ul v-if="conjugationOpenIds.has(r.id)" class="conjugation-list">
                  <li v-for="f in conjugationFor(r)" :key="f.label" class="conjugation-row">
                    <span class="conj-label">{{ f.label }}</span>
                    <span class="conj-form"><span class="conj-stem">{{ f.stem }}</span><span class="conj-ending">{{ f.ending }}</span></span>
                  </li>
                </ul>
              </div>

              <p class="detail-label">Examples</p>
              <p v-if="sentencesFor(r.id).status === 'loading'" class="sentence-status">Loading examples…</p>
              <p v-else-if="sentencesFor(r.id).status === 'error'" class="sentence-status sentence-status-error">Couldn't load example sentences.</p>
              <p v-else-if="sentencesFor(r.id).sentences.length === 0" class="sentence-status">No example sentences.</p>
              <ul v-else class="sentence-list">
                <li v-for="s in sentencesFor(r.id).sentences" :key="s.id" class="sentence-item">
                  <p class="sentence-jp">
                    <ruby v-for="(t, i) in s.furigana" :key="i">{{ t.surface }}<rt v-if="t.reading">{{ t.reading }}</rt></ruby>
                  </p>
                  <p class="sentence-en">{{ s.english }}</p>
                </li>
              </ul>
            </div>
          </li>
        </ul>

        <div v-if="resultsView.archaic.length > 0 && (showArchaic || resultsView.allArchaic)" class="archaic-block">
          <h3 class="archaic-heading">
            Archaic / obsolete / rare matches
            <span v-if="resultsView.allArchaic" class="archaic-heading-sub">(no other matches)</span>
          </h3>
          <ul class="result-list">
            <li
              v-for="r in resultsView.archaic"
              :key="r.id"
              class="result-card archaic"
              :class="{ expanded: expandedIds.has(r.id) }"
              @click="toggleExpand(r.id, r.kanji.join(''))"
            >
              <div class="result-row">
                <span class="result-headword">{{ r.kanji.join('、') || r.readings.join('、') }}</span>
                <span v-if="r.kanji.length" class="result-reading">{{ r.readings.join('、') }}</span>
                <span v-for="p in r.pos" :key="p" class="tag tag-pos" :style="{ '--tag-color': posColor(p) }" :title="posLabel(p)">{{ posShortLabel(p) }}</span>
                <span v-for="l in r.labels" :key="l" class="tag tag-label" :style="{ '--tag-color': miscColor(l) }">{{ miscLabel(l) }}</span>
                <span v-for="d in r.dialect" :key="d" class="tag tag-dialect" :style="{ '--tag-color': dialectColor(d) }">{{ d }}</span>
                <span v-if="r.priority.length" class="score-badge" :style="{ '--tag-color': priorityColor(r.priority) }" :title="priorityTitle(r.priority)">{{ r.commonness_score }}</span>
              </div>
              <p class="result-gloss" :title="[r.glosses.join('; '), lsourceText(r.lsources)].filter(Boolean).join(' — ')">{{ r.glosses.join('; ') }}<span v-if="lsourceText(r.lsources)" class="result-lsource"> ({{ lsourceText(r.lsources) }})</span></p>
              <div v-if="expandedIds.has(r.id)" class="detail-panel" @click.stop>
                <div v-if="r.kanji.length" class="kanji-details">
                  <p class="detail-label">Kanji</p>
                  <p v-if="kanjiFor(r.id).status === 'loading'" class="detail-status">Loading kanji…</p>
                  <p v-else-if="kanjiFor(r.id).status === 'error'" class="detail-status detail-status-error">Couldn't load kanji details.</p>
                  <ul v-else-if="kanjiFor(r.id).kanji.length" class="kanji-list">
                    <li v-for="k in kanjiFor(r.id).kanji" :key="k.literal" class="kanji-item">
                      <span class="kanji-literal">{{ k.literal }}</span>
                      <span v-if="k.strokeCount" class="kanji-strokes">{{ k.strokeCount }} strokes</span>
                      <span v-if="k.onyomi.length" class="kanji-yomi"><span class="kanji-yomi-tag">On'yomi</span>{{ k.onyomi.join('、') }}</span>
                      <span v-if="k.kunyomi.length" class="kanji-yomi"><span class="kanji-yomi-tag">Kun'yomi</span>{{ k.kunyomi.join('、') }}</span>
                    </li>
                  </ul>
                </div>

                <div v-if="isConjugatableVerb(r.pos)" class="conjugate-section">
                  <button type="button" class="conjugate-btn" @click="toggleConjugation(r.id)">
                    {{ conjugationOpenIds.has(r.id) ? 'Hide conjugation' : 'Conjugate ▾' }}
                  </button>
                  <ul v-if="conjugationOpenIds.has(r.id)" class="conjugation-list">
                    <li v-for="f in conjugationFor(r)" :key="f.label" class="conjugation-row">
                      <span class="conj-label">{{ f.label }}</span>
                      <span class="conj-form"><span class="conj-stem">{{ f.stem }}</span><span class="conj-ending">{{ f.ending }}</span></span>
                    </li>
                  </ul>
                </div>

                <p class="detail-label">Examples</p>
                <p v-if="sentencesFor(r.id).status === 'loading'" class="sentence-status">Loading examples…</p>
                <p v-else-if="sentencesFor(r.id).status === 'error'" class="sentence-status sentence-status-error">Couldn't load example sentences.</p>
                <p v-else-if="sentencesFor(r.id).sentences.length === 0" class="sentence-status">No example sentences.</p>
                <ul v-else class="sentence-list">
                  <li v-for="s in sentencesFor(r.id).sentences" :key="s.id" class="sentence-item">
                    <p class="sentence-jp">
                      <ruby v-for="(t, i) in s.furigana" :key="i">{{ t.surface }}<rt v-if="t.reading">{{ t.reading }}</rt></ruby>
                    </p>
                    <p class="sentence-en">{{ s.english }}</p>
                  </li>
                </ul>
              </div>
            </li>
          </ul>
        </div>
      </template>

      <section v-if="showFuzzy" class="fuzzy-section">
        <button type="button" class="back-link" @click="showFuzzy = false">← Back to search results</button>
        <h3 class="fuzzy-heading">
          Fuzzy matches
          <span v-if="fuzzyInterpretedQuery" class="interpreted-note">searched as {{ fuzzyInterpretedQuery }}</span>
          <span v-if="fuzzyResultsView.archaic.length > 0 && !fuzzyResultsView.allArchaic" class="archaic-heading-sub">
            {{ fuzzyResultsView.archaic.length }} archaic/obsolete/rare{{ showArchaic ? '' : ', hidden' }}
          </span>
        </h3>
        <ul class="result-list">
          <li
            v-for="r in fuzzyResultsView.main"
            :key="r.id"
            class="result-card"
            :class="{ expanded: expandedIds.has(r.id) }"
            @click="toggleExpand(r.id, r.kanji.join(''))"
          >
            <div class="result-row">
              <span class="result-headword">{{ r.kanji.join('、') || r.readings.join('、') }}</span>
              <span class="result-reading">{{ r.readings.join('、') }}</span>
              <span v-for="p in r.pos" :key="p" class="tag tag-pos" :style="{ '--tag-color': posColor(p) }" :title="posLabel(p)">{{ posShortLabel(p) }}</span>
              <span v-for="l in r.labels" :key="l" class="tag tag-label" :style="{ '--tag-color': miscColor(l) }">{{ miscLabel(l) }}</span>
              <span v-for="d in r.dialect" :key="d" class="tag tag-dialect" :style="{ '--tag-color': dialectColor(d) }">{{ d }}</span>
              <span class="score-badge">Δ{{ r.distance.toFixed(2) }}</span>
            </div>
            <p class="result-gloss" :title="[r.glosses.join('; '), lsourceText(r.lsources)].filter(Boolean).join(' — ')">{{ r.glosses.join('; ') }}<span v-if="lsourceText(r.lsources)" class="result-lsource"> ({{ lsourceText(r.lsources) }})</span></p>
            <div v-if="expandedIds.has(r.id)" class="detail-panel" @click.stop>
              <div v-if="r.kanji.length" class="kanji-details">
                <p class="detail-label">Kanji</p>
                <p v-if="kanjiFor(r.id).status === 'loading'" class="detail-status">Loading kanji…</p>
                <p v-else-if="kanjiFor(r.id).status === 'error'" class="detail-status detail-status-error">Couldn't load kanji details.</p>
                <ul v-else-if="kanjiFor(r.id).kanji.length" class="kanji-list">
                  <li v-for="k in kanjiFor(r.id).kanji" :key="k.literal" class="kanji-item">
                    <span class="kanji-literal">{{ k.literal }}</span>
                    <span v-if="k.strokeCount" class="kanji-strokes">{{ k.strokeCount }} strokes</span>
                    <span v-if="k.onyomi.length" class="kanji-yomi"><span class="kanji-yomi-tag">On'yomi</span>{{ k.onyomi.join('、') }}</span>
                    <span v-if="k.kunyomi.length" class="kanji-yomi"><span class="kanji-yomi-tag">Kun'yomi</span>{{ k.kunyomi.join('、') }}</span>
                  </li>
                </ul>
              </div>

              <div v-if="isConjugatableVerb(r.pos)" class="conjugate-section">
                <button type="button" class="conjugate-btn" @click="toggleConjugation(r.id)">
                  {{ conjugationOpenIds.has(r.id) ? 'Hide conjugation' : 'Conjugate ▾' }}
                </button>
                <ul v-if="conjugationOpenIds.has(r.id)" class="conjugation-list">
                  <li v-for="f in conjugationFor(r)" :key="f.label" class="conjugation-row">
                    <span class="conj-label">{{ f.label }}</span>
                    <span class="conj-form"><span class="conj-stem">{{ f.stem }}</span><span class="conj-ending">{{ f.ending }}</span></span>
                  </li>
                </ul>
              </div>

              <p class="detail-label">Examples</p>
              <p v-if="sentencesFor(r.id).status === 'loading'" class="sentence-status">Loading examples…</p>
              <p v-else-if="sentencesFor(r.id).status === 'error'" class="sentence-status sentence-status-error">Couldn't load example sentences.</p>
              <p v-else-if="sentencesFor(r.id).sentences.length === 0" class="sentence-status">No example sentences.</p>
              <ul v-else class="sentence-list">
                <li v-for="s in sentencesFor(r.id).sentences" :key="s.id" class="sentence-item">
                  <p class="sentence-jp">
                    <ruby v-for="(t, i) in s.furigana" :key="i">{{ t.surface }}<rt v-if="t.reading">{{ t.reading }}</rt></ruby>
                  </p>
                  <p class="sentence-en">{{ s.english }}</p>
                </li>
              </ul>
            </div>
          </li>
        </ul>

        <div v-if="fuzzyResultsView.archaic.length > 0 && (showArchaic || fuzzyResultsView.allArchaic)" class="archaic-block">
          <h4 class="archaic-heading">
            Archaic / obsolete / rare matches
            <span v-if="fuzzyResultsView.allArchaic" class="archaic-heading-sub">(no other matches)</span>
          </h4>
          <ul class="result-list">
            <li
              v-for="r in fuzzyResultsView.archaic"
              :key="r.id"
              class="result-card archaic"
              :class="{ expanded: expandedIds.has(r.id) }"
              @click="toggleExpand(r.id, r.kanji.join(''))"
            >
              <div class="result-row">
                <span class="result-headword">{{ r.kanji.join('、') || r.readings.join('、') }}</span>
                <span class="result-reading">{{ r.readings.join('、') }}</span>
                <span v-for="p in r.pos" :key="p" class="tag tag-pos" :style="{ '--tag-color': posColor(p) }" :title="posLabel(p)">{{ posShortLabel(p) }}</span>
                <span v-for="l in r.labels" :key="l" class="tag tag-label" :style="{ '--tag-color': miscColor(l) }">{{ miscLabel(l) }}</span>
                <span v-for="d in r.dialect" :key="d" class="tag tag-dialect" :style="{ '--tag-color': dialectColor(d) }">{{ d }}</span>
                <span class="score-badge">Δ{{ r.distance.toFixed(2) }}</span>
              </div>
              <p class="result-gloss" :title="[r.glosses.join('; '), lsourceText(r.lsources)].filter(Boolean).join(' — ')">{{ r.glosses.join('; ') }}<span v-if="lsourceText(r.lsources)" class="result-lsource"> ({{ lsourceText(r.lsources) }})</span></p>
              <div v-if="expandedIds.has(r.id)" class="detail-panel" @click.stop>
                <div v-if="r.kanji.length" class="kanji-details">
                  <p class="detail-label">Kanji</p>
                  <p v-if="kanjiFor(r.id).status === 'loading'" class="detail-status">Loading kanji…</p>
                  <p v-else-if="kanjiFor(r.id).status === 'error'" class="detail-status detail-status-error">Couldn't load kanji details.</p>
                  <ul v-else-if="kanjiFor(r.id).kanji.length" class="kanji-list">
                    <li v-for="k in kanjiFor(r.id).kanji" :key="k.literal" class="kanji-item">
                      <span class="kanji-literal">{{ k.literal }}</span>
                      <span v-if="k.strokeCount" class="kanji-strokes">{{ k.strokeCount }} strokes</span>
                      <span v-if="k.onyomi.length" class="kanji-yomi"><span class="kanji-yomi-tag">On'yomi</span>{{ k.onyomi.join('、') }}</span>
                      <span v-if="k.kunyomi.length" class="kanji-yomi"><span class="kanji-yomi-tag">Kun'yomi</span>{{ k.kunyomi.join('、') }}</span>
                    </li>
                  </ul>
                </div>

                <div v-if="isConjugatableVerb(r.pos)" class="conjugate-section">
                  <button type="button" class="conjugate-btn" @click="toggleConjugation(r.id)">
                    {{ conjugationOpenIds.has(r.id) ? 'Hide conjugation' : 'Conjugate ▾' }}
                  </button>
                  <ul v-if="conjugationOpenIds.has(r.id)" class="conjugation-list">
                    <li v-for="f in conjugationFor(r)" :key="f.label" class="conjugation-row">
                      <span class="conj-label">{{ f.label }}</span>
                      <span class="conj-form"><span class="conj-stem">{{ f.stem }}</span><span class="conj-ending">{{ f.ending }}</span></span>
                    </li>
                  </ul>
                </div>

                <p class="detail-label">Examples</p>
                <p v-if="sentencesFor(r.id).status === 'loading'" class="sentence-status">Loading examples…</p>
                <p v-else-if="sentencesFor(r.id).status === 'error'" class="sentence-status sentence-status-error">Couldn't load example sentences.</p>
                <p v-else-if="sentencesFor(r.id).sentences.length === 0" class="sentence-status">No example sentences.</p>
                <ul v-else class="sentence-list">
                  <li v-for="s in sentencesFor(r.id).sentences" :key="s.id" class="sentence-item">
                    <p class="sentence-jp">
                      <ruby v-for="(t, i) in s.furigana" :key="i">{{ t.surface }}<rt v-if="t.reading">{{ t.reading }}</rt></ruby>
                    </p>
                    <p class="sentence-en">{{ s.english }}</p>
                  </li>
                </ul>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </main>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
  --bg: #0b0d12;
  --bg-elevated: #10131a;
  --surface: #151922;
  --surface-hover: #1a1f2b;
  --border: #242938;
  --border-strong: #333a4d;
  --text: #e9ebf2;
  --text-muted: #9aa1b5;
  --text-faint: #6b7284;
  --accent: #7c8cff;
  --accent-strong: #9aa6ff;
  --accent-contrast: #0b0d12;
  --danger: #ff7a7a;
  --warning: #f2b64d;
  --success: #4ade80;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --font-jp: 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', sans-serif;
  /* Hiragino Sans ships W0-W9 as one family, so a CSS weight picks the face:
     400 and 300 both land on ~W3/W4, which is the "fat" look at these small
     sizes; 200 selects W2 and is the first step that visibly thins the kana
     and kanji strokes. Set wherever --font-jp is used. (Noto Sans JP and Yu
     Gothic resolve 200 to their ExtraLight/Light faces.) */
  --font-jp-weight: 200;
}

html, body {
  background: var(--bg);
  margin: 0;
  height: 100%;
  /* Light-on-dark text renders noticeably fatter under WebKit's default
     subpixel antialiasing; grayscale AA keeps the stems at their real width. */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  height: 100%;
}

* {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

.app {
  min-height: 100dvh;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, var(--font-jp), sans-serif;
  /* SF Light rather than Regular: at this UI's small sizes, Regular on the
     near-black background reads heavier than it measures. Explicit weights
     (500/600) on emphasis still stand out against it. */
  font-weight: 300;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  display: flex;
  flex-direction: column;
}

::selection {
  background: var(--accent);
  color: var(--accent-contrast);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  --brand-title-size: 1.05rem;
  --brand-sub-size: 0.72rem;
  --brand-line-height: 1.15;
}

.brand-mark {
  flex-shrink: 0;
  /* Matches brand-text's rendered height (title line + subtitle line) so it
     never needs re-measuring by hand if those font-sizes change. */
  height: calc((var(--brand-title-size) + var(--brand-sub-size)) * var(--brand-line-height));
  width: calc((var(--brand-title-size) + var(--brand-sub-size)) * var(--brand-line-height));
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: var(--brand-line-height);
}

.brand-text h1 {
  margin: 0;
  font-size: var(--brand-title-size);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.brand-sub {
  font-size: var(--brand-sub-size);
  color: var(--text-faint);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}

.icon-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text);
}

.icon-btn:active:not(:disabled) {
  transform: scale(0.94);
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.icon {
  width: 1.1rem;
  height: 1.1rem;
}

.icon.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.status-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  font-size: 0.8rem;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}

.status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--text-faint);
  flex-shrink: 0;
}

.status-row.ready .status-dot { background: var(--success); }
.status-row.loading .status-dot { background: var(--warning); animation: pulse 1.2s ease-in-out infinite; }
.status-row.error .status-dot { background: var(--danger); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.status-error {
  color: var(--danger);
  margin-left: 0.25rem;
}

.content {
  flex: 1;
  max-width: 42rem;
  width: 100%;
  margin: 0 auto;
  padding: 1.25rem 1.25rem 3rem;
}

.search-card {
  display: flex;
  gap: 0.6rem;
}

.search-box {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 0 0.75rem;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.search-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
}

.search-icon {
  color: var(--text-faint);
  flex-shrink: 0;
}

.search-box input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 1rem;
  padding: 0.75rem 0.5rem;
  outline: none;
  min-width: 0;
  font-family: inherit;
}

.search-box input::placeholder {
  color: var(--text-faint);
}

.clear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  flex-shrink: 0;
}

.clear-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.clear-btn .icon {
  width: 0.9rem;
  height: 0.9rem;
}

.search-btn {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0 1.4rem;
  font-size: 0.95rem;
  font-weight: 600;
  background: linear-gradient(155deg, var(--accent-strong), var(--accent));
  color: var(--accent-contrast);
  cursor: pointer;
  transition: transform 0.1s ease, opacity 0.15s ease;
}

.search-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.search-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.hint {
  margin: 0.75rem 0 0;
  font-size: 0.78rem;
  color: var(--text-faint);
}

.hint code {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.05rem 0.35rem;
  font-size: 0.75rem;
}

.filters {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  margin-top: 1.5rem;
  padding: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.filter-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.filter-label {
  font-size: 0.78rem;
  color: var(--text-faint);
  min-width: 5.5rem;
  flex-shrink: 0;
}

.segmented {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.segment {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  border-radius: 999px;
  padding: 0.4rem 0.85rem;
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  min-height: 2rem;
}

.segment.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}

.segment:hover:not(.active) {
  border-color: var(--border-strong);
  color: var(--text);
}

.select {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--border);
  background-color: var(--bg-elevated);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7284' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.55rem center;
  background-size: 0.85rem;
  color: var(--text);
  border-radius: 999px;
  padding: 0.4rem 1.9rem 0.4rem 0.85rem;
  font-size: 0.82rem;
  min-height: 2rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.select:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
}

.filter-note {
  font-size: 0.75rem;
  color: var(--text-faint);
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  cursor: pointer;
  padding-top: 0.35rem;
  border-top: 1px solid var(--border);
}

.switch {
  position: relative;
  display: inline-flex;
  width: 2.4rem;
  height: 1.4rem;
  flex-shrink: 0;
}

.switch input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
  z-index: 1;
}

.switch-track {
  position: absolute;
  inset: 0;
  background: var(--border-strong);
  border-radius: 999px;
  transition: background 0.15s ease;
  pointer-events: none;
}

.switch-thumb {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 999px;
  background: var(--text);
  transition: transform 0.15s ease;
}

.switch input:checked + .switch-track {
  background: var(--accent);
}

.switch input:checked + .switch-track .switch-thumb {
  transform: translateX(1rem);
  background: var(--accent-contrast);
}

.count-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.2rem;
  height: 1.2rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--border-strong);
  color: var(--text);
  font-size: 0.68rem;
  margin-left: 0.3rem;
}

.deconj-card {
  margin-top: 1.25rem;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.deconj-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.85rem;
}

.deconj-surface {
  font-weight: var(--font-jp-weight);
  font-family: var(--font-jp);
}

.deconj-arrow {
  color: var(--text-faint);
  font-size: 0.75rem;
}

.deconj-relation {
  color: var(--accent-strong);
  font-weight: 600;
}

.deconj-headword {
  font-weight: var(--font-jp-weight);
  font-family: var(--font-jp);
}

.deconj-gloss {
  color: var(--text-muted);
}

.results-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  margin-top: 1.5rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.tier-pill {
  text-transform: uppercase;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: var(--border-strong);
  color: var(--text);
}

.archaic-note {
  color: var(--text-faint);
}

.interpreted-note {
  color: var(--text-faint);
  font-style: italic;
}

.fuzzy-link {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--accent-strong);
  font-size: 0.82rem;
  cursor: pointer;
  padding: 0.2rem 0;
}

.fuzzy-link:hover {
  text-decoration: underline;
}

.empty-state {
  margin-top: 2rem;
  text-align: center;
  color: var(--text-faint);
  font-size: 0.9rem;
}

.result-list {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.result-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-top: none;
  padding: 0.4rem 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  transition: background 0.1s ease;
}

.result-card:first-child {
  border-top: 1px solid var(--border);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}

.result-card:last-child {
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
}

.result-card:only-child {
  border-radius: var(--radius-sm);
}

.result-card:hover {
  background: var(--surface-hover);
}

.result-card {
  cursor: pointer;
}

.result-card.expanded {
  background: var(--surface-hover);
}

.result-card.archaic {
  opacity: 0.75;
}

.result-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.result-headword {
  font-family: var(--font-jp);
  font-size: 0.98rem;
  font-weight: var(--font-jp-weight);
  white-space: nowrap;
}

.result-reading {
  font-family: var(--font-jp);
  font-weight: var(--font-jp-weight);
  font-size: 0.8rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.tag {
  font-size: 0.62rem;
  line-height: 1.4;
  padding: 0.03rem 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  background: var(--bg-elevated);
  white-space: nowrap;
}

.tag-dialect {
  color: var(--tag-color, var(--text-muted));
  border-color: color-mix(in srgb, var(--tag-color, var(--border)) 40%, var(--border));
}

.tag-label {
  color: var(--tag-color, var(--text-muted));
  border-color: color-mix(in srgb, var(--tag-color, var(--border)) 40%, var(--border));
}

.tag-pos {
  color: var(--tag-color, var(--text-muted));
  border-color: color-mix(in srgb, var(--tag-color, var(--border)) 40%, var(--border));
}

.result-gloss {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-muted);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.result-lsource {
  font-style: italic;
  opacity: 0.8;
}

.score-badge {
  margin-left: auto;
  padding-left: 0.5rem;
  font-size: 0.68rem;
  color: var(--tag-color, var(--text-faint));
  cursor: default;
  white-space: nowrap;
}

.detail-panel {
  margin-top: 0.6rem;
  padding: 0.6rem 0.7rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: default;
}

.detail-label {
  margin: 0 0 0.5rem;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.detail-status {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-faint);
}

.detail-status-error {
  color: var(--danger);
}

.sentence-status {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-faint);
}

.sentence-status-error {
  color: var(--danger);
}

.kanji-details {
  margin-bottom: 0.7rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid var(--border);
}

.kanji-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.kanji-item {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.kanji-literal {
  font-family: var(--font-jp);
  font-weight: var(--font-jp-weight);
  font-size: 1.1rem;
  color: var(--text);
}

.kanji-strokes {
  color: var(--text-faint);
  white-space: nowrap;
}

.kanji-yomi {
  white-space: nowrap;
}

.kanji-yomi-tag {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--text-faint);
  margin-right: 0.3rem;
}

.conjugate-section {
  margin-bottom: 0.7rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid var(--border);
}

.conjugate-btn {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--accent-strong);
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  cursor: pointer;
}

.conjugate-btn:hover {
  border-color: var(--border-strong);
}

.conjugation-list {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.conjugation-row {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  font-size: 0.8rem;
}

.conj-label {
  min-width: 5rem;
  flex-shrink: 0;
  color: var(--text-faint);
}

.conj-form {
  font-family: var(--font-jp);
  font-weight: var(--font-jp-weight);
}

.conj-stem {
  color: var(--text-muted);
}

.conj-ending {
  color: var(--accent-strong);
  /* JP text, so 700 would pick Hiragino W7 - far too heavy for 0.8rem kana.
     The accent colour already carries the emphasis. */
  font-weight: 500;
}

.sentence-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.sentence-item + .sentence-item {
  padding-top: 0.6rem;
  border-top: 1px dashed var(--border);
}

.sentence-jp {
  margin: 0;
  font-family: var(--font-jp);
  font-size: 0.85rem;
  /* One step above --font-jp-weight: this text is muted *and* carries 0.62em
     furigana, which disappears at W2. */
  font-weight: 300;
  color: var(--text-muted);
  line-height: 2.1;
}

.sentence-jp ruby {
  ruby-align: center;
}

.sentence-jp rt {
  font-size: 0.62em;
  color: var(--text-faint);
  user-select: none;
}

.sentence-en {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  color: var(--text-faint);
}

.archaic-block {
  margin-top: 1.5rem;
}

.archaic-heading {
  margin: 0 0 0.25rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-faint);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.archaic-heading-sub {
  font-weight: 400;
  font-size: 0.78rem;
}

.fuzzy-section {
  margin-top: 1.5rem;
}

.back-link {
  border: none;
  background: none;
  color: var(--accent-strong);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.3rem 0;
}

.back-link:hover {
  text-decoration: underline;
}

.fuzzy-heading {
  margin: 0.75rem 0 0;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

@media (max-width: 480px) {
  .content {
    padding: 1rem 1rem 3rem;
  }
  .search-card {
    flex-direction: column;
  }
  .search-btn {
    height: 2.75rem;
  }
  .filter-label {
    min-width: auto;
    width: 100%;
  }
}
</style>
