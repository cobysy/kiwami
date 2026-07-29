<script setup>
// Phase 1 dev harness (PLAN.md): "just enough to host the engine code and a
// small dev harness for exercising queries without building UI yet." Not
// Phase 2's real search UI — no routing, no entry/kanji detail views, no
// styling system — and not itself how Phase 1 is verified: that's
// tests/node/dictionary.test.js and tests/browser/dictionary.test.js, which
// run the same query layer (src/db/dictionary) against the same browser
// driver (jeep-sqlite) and the real public/dictionary.db under Playwright
// (see README-DICTIONARY.md's findings on why that's fast enough
// in-browser). This component is only a manual tool for eyeballing search
// results by hand against that same real data.
import { ref, computed, onMounted } from 'vue';
import { createBrowserDriver, ensureDatabaseFromUrl } from './db/drivers/browser-driver.js';
import { search, fuzzySearch, deconjugate } from './db/dictionary/index.js';

const status = ref('idle');
const errorMessage = ref('');

const query = ref('');
const matchMode = ref('auto'); // 'auto' | 'startsWith' | 'endsWith' | 'contains'
const kanjiCount = ref(null); // 1 | 2 | 3 | 4 | null
const showArchaic = ref(false);
const tier = ref(null);
const results = ref([]);
const fuzzyResults = ref([]);
const showFuzzy = ref(false);
const deconjugated = ref([]);

// The engine returns archaic/obsolete/rare/obscure entries flagged, not
// filtered out (PLAN.md: "the engine decides the tier and flag, the UI
// decides how to display it") — they're already sorted to the bottom of
// their tier, so hiding them here by default is a pure client-side filter,
// no re-query needed to toggle. But if every match for a query is archaic
// (e.g. なむち), filtering them all out would show "no results" for a
// query that actually has hits — fall back to showing them rather than
// hiding a query's only matches, and still report the archaic count either
// way (hidden count when some are hidden, shown count when they're all
// that's there).
function archaicView(list) {
  const archaicCount = list.filter((r) => r.archaic).length;
  if (showArchaic.value || archaicCount === 0) return { list, archaicCount: 0, allArchaic: false };
  const nonArchaic = list.filter((r) => !r.archaic);
  if (nonArchaic.length > 0) return { list: nonArchaic, archaicCount, allArchaic: false };
  return { list, archaicCount, allArchaic: true };
}
const resultsView = computed(() => archaicView(results.value));
const fuzzyResultsView = computed(() => archaicView(fuzzyResults.value));
const visibleResults = computed(() => resultsView.value.list);
const visibleFuzzyResults = computed(() => fuzzyResultsView.value.list);
// archaicView zeroes its count once showArchaic is on (nothing's hidden
// anymore), but the toggle's own label needs the count regardless of its
// current state, so this reads straight off the raw results.
const rawArchaicCount = computed(() => results.value.filter((r) => r.archaic).length);

let driver = null;

async function loadRealDictionary() {
  status.value = 'loading';
  errorMessage.value = '';
  try {
    await ensureDatabaseFromUrl('dictionary', '/dictionary.db');
    await driver?.close();
    driver = createBrowserDriver('dictionary', { readonly: true });
    await driver.open();
    status.value = 'ready';
  } catch (err) {
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

async function runSearch() {
  if (!driver || !query.value.trim()) {
    results.value = [];
    tier.value = null;
    deconjugated.value = [];
    return;
  }
  const [searchResult, deconjResult] = await Promise.all([
    search(driver, effectiveQuery(), { kanjiCount: kanjiCount.value ?? undefined }),
    deconjugate(driver, query.value),
  ]);
  tier.value = searchResult.tier;
  results.value = searchResult.results;
  deconjugated.value = deconjResult;
  showFuzzy.value = false;
  fuzzyResults.value = [];
}

async function runFuzzy() {
  showFuzzy.value = true;
  fuzzyResults.value = await fuzzySearch(driver, query.value);
}

onMounted(loadRealDictionary);
</script>

<template>
  <main style="font-family: sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem;">
    <h1>Kiwami (極) — Phase 1 dev harness</h1>

    <p>
      <button type="button" @click="loadRealDictionary">Reload dictionary.db</button>
      <span style="margin-left: 0.5rem;">status: {{ status }}</span>
    </p>
    <p v-if="errorMessage" style="color: crimson;">{{ errorMessage }}</p>

    <p>
      <input
        v-model="query"
        type="text"
        placeholder="Search kanji, reading, or English gloss..."
        style="width: 20rem;"
        @keyup.enter="runSearch"
        @paste="onPaste"
      />
      <button type="button" @click="runSearch" :disabled="status !== 'ready'">Search</button>
      <span v-if="status !== 'ready'" style="margin-left: 0.5rem; color: #b58900;">
        (dictionary still loading — search is disabled until status is "ready")
      </span>
    </p>
    <p style="font-size: 0.85em; color: #555;">
      Tip: use <code>?</code> for a single character and <code>*</code> for any number of
      characters, e.g. <code>食*</code> or <code>*る</code>.
    </p>
    <p>
      Match:
      <label v-for="opt in [
        ['auto', 'auto'],
        ['startsWith', 'starts with'],
        ['endsWith', 'ends with'],
        ['contains', 'contains'],
      ]" :key="opt[0]" style="margin-right: 0.5rem;">
        <input type="radio" :value="opt[0]" v-model="matchMode" @change="runSearch" />
        {{ opt[1] }}
      </label>
    </p>
    <p>
      Kanji count:
      <label v-for="n in [1, 2, 3, 4]" :key="n" style="margin-right: 0.5rem;">
        <input type="radio" :value="n" v-model="kanjiCount" @change="runSearch" />
        {{ n === 4 ? '4+' : n }}
      </label>
      <label>
        <input type="radio" :value="null" v-model="kanjiCount" @change="runSearch" />
        any
      </label>
    </p>
    <p>
      <label>
        <input type="checkbox" v-model="showArchaic" />
        Show archaic/obsolete/rare matches
        <span v-if="rawArchaicCount > 0">({{ rawArchaicCount }})</span>
      </label>
    </p>

    <div v-if="deconjugated.length" style="background: #eef; padding: 0.5rem; margin: 1rem 0;">
      <div v-for="d in deconjugated" :key="`${d.id}-${d.relation}`">
        <strong>{{ d.surface }}</strong> is the {{ d.relation }} of
        <strong>{{ d.kanji[0] ?? d.readings[0] }}</strong> ({{ d.glosses.join('; ') }}) →
      </div>
    </div>

    <p v-if="tier">
      Tier: <strong>{{ tier }}</strong> — {{ visibleResults.length }} result(s)
      <span v-if="resultsView.archaicCount > 0" style="color: #888;">
        ({{ resultsView.archaicCount }} archaic/obsolete/rare{{ resultsView.allArchaic ? ' — no other matches' : ' hidden' }})
      </span>
    </p>
    <ul>
      <li v-for="r in visibleResults" :key="r.id">
        <strong>{{ r.kanji.join('、') || r.readings.join('、') }}</strong>
        <span v-if="r.kanji.length"> ({{ r.readings.join('、') }})</span>
        <span v-if="r.pos.length"> [{{ r.pos.join(', ') }}]</span>
        — {{ r.glosses.join('; ') }}
        <span v-if="r.archaic" style="color: #888;">[{{ r.labels.join(', ') }}]</span>
        <span style="color: #aaa;"> score={{ r.commonness_score }}</span>
      </li>
    </ul>

    <p v-if="query && !showFuzzy">
      <a href="#" @click.prevent="runFuzzy">Didn't find it? Try fuzzy search</a>
    </p>
    <div v-if="showFuzzy">
      <h3>
        Fuzzy matches
        <span v-if="fuzzyResultsView.archaicCount > 0" style="color: #888; font-weight: normal;">
          ({{ fuzzyResultsView.archaicCount }} archaic/obsolete/rare{{ fuzzyResultsView.allArchaic ? ' — no other matches' : ' hidden' }})
        </span>
      </h3>
      <ul>
        <li v-for="r in visibleFuzzyResults" :key="r.id">
          <strong>{{ r.kanji.join('、') || r.readings.join('、') }}</strong>
          ({{ r.readings.join('、') }})
          <span v-if="r.pos.length"> [{{ r.pos.join(', ') }}]</span>
          — {{ r.glosses.join('; ') }}
          <span style="color: #aaa;"> distance={{ r.distance.toFixed(2) }}</span>
        </li>
      </ul>
    </div>
  </main>
</template>
