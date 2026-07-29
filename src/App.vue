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
import { DIALECT_OPTIONS } from './db/dictionary/dialect-labels.js';
import { priorityLabel } from './db/dictionary/frequency-labels.js';

// Tooltip text for a result's raw priority tags (news1, nf12, ...) - the
// tags are meaningless on their own (especially nfXX bands), so the visible
// badge stays terse and the decoded meaning is a hover-away.
function priorityTitle(tags) {
  return tags.map((tag) => `${tag}: ${priorityLabel(tag)}`).join('\n');
}

const status = ref('idle');
const errorMessage = ref('');

const query = ref('');
const matchMode = ref('auto'); // 'auto' | 'startsWith' | 'endsWith' | 'contains'
const kanjiCount = ref(null); // 1 | 2 | 3 | 4 | null
const dialect = ref(null); // JMdict dial tag (e.g. 'ksb') | null
const showArchaic = ref(false);
const tier = ref(null);
const results = ref([]);
const fuzzyResults = ref([]);
const showFuzzy = ref(false);
const deconjugated = ref([]);

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

async function runSearch() {
  const hasQuery = query.value.trim().length > 0;
  if (!driver || (!hasQuery && !dialect.value)) {
    results.value = [];
    tier.value = null;
    deconjugated.value = [];
    return;
  }
  const searchOptions = { kanjiCount: kanjiCount.value ?? undefined, dialect: dialect.value ?? undefined };
  const [searchResult, deconjResult] = await Promise.all([
    search(driver, effectiveQuery(), searchOptions),
    hasQuery ? deconjugate(driver, query.value) : Promise.resolve([]),
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
      Dialect:
      <select v-model="dialect" @change="runSearch">
        <option :value="null">any</option>
        <option v-for="[tag, label] in DIALECT_OPTIONS" :key="tag" :value="tag">{{ label }}</option>
      </select>
      <span v-if="dialect && !query.trim()" style="font-size: 0.85em; color: #555;">
        (browsing every entry tagged {{ DIALECT_OPTIONS.find(([t]) => t === dialect)?.[1] }})
      </span>
    </p>
    <p>
      <label>
        <input type="checkbox" v-model="showArchaic" />
        Show archaic/obsolete/rare matches
        <span v-if="resultsView.archaic.length > 0">({{ resultsView.archaic.length }})</span>
      </label>
    </p>

    <div v-if="deconjugated.length" style="background: #eef; padding: 0.5rem; margin: 1rem 0;">
      <div v-for="d in deconjugated" :key="`${d.id}-${d.relation}`">
        <strong>{{ d.surface }}</strong> is the {{ d.relation }} of
        <strong>{{ d.kanji[0] ?? d.readings[0] }}</strong> ({{ d.glosses.join('; ') }}) →
      </div>
    </div>

    <template v-if="!showFuzzy">
      <p v-if="tier">
        Tier: <strong>{{ tier }}</strong> — {{ resultsView.main.length }} result(s)
        <span v-if="resultsView.archaic.length > 0 && !resultsView.allArchaic" style="color: #888;">
          ({{ resultsView.archaic.length }} archaic/obsolete/rare in a separate block below{{ showArchaic ? '' : ', hidden' }})
        </span>
      </p>
      <ul>
        <li v-for="r in resultsView.main" :key="r.id">
          <strong>{{ r.kanji.join('、') || r.readings.join('、') }}</strong>
          <span v-if="r.kanji.length"> ({{ r.readings.join('、') }})</span>
          <span v-if="r.pos.length"> [{{ r.pos.join(', ') }}]</span>
          — {{ r.glosses.join('; ') }}
          <span v-if="r.dialect.length" style="color: #888;">[{{ r.dialect.join(', ') }}]</span>
          <span style="color: #aaa;" :title="priorityTitle(r.priority)">
            score={{ r.commonness_score }}<template v-if="r.priority.length"> ({{ r.priority.join(', ') }})</template>
          </span>
        </li>
      </ul>

      <div v-if="resultsView.archaic.length > 0 && (showArchaic || resultsView.allArchaic)">
        <h3 style="color: #888;">
          Archaic / obsolete / rare matches
          <span v-if="resultsView.allArchaic" style="font-weight: normal;">(no other matches)</span>
        </h3>
        <ul>
          <li v-for="r in resultsView.archaic" :key="r.id">
            <strong>{{ r.kanji.join('、') || r.readings.join('、') }}</strong>
            <span v-if="r.kanji.length"> ({{ r.readings.join('、') }})</span>
            <span v-if="r.pos.length"> [{{ r.pos.join(', ') }}]</span>
            — {{ r.glosses.join('; ') }}
            <span style="color: #888;">[{{ r.labels.join(', ') }}]</span>
            <span v-if="r.dialect.length" style="color: #888;">[{{ r.dialect.join(', ') }}]</span>
            <span style="color: #aaa;" :title="priorityTitle(r.priority)">
              score={{ r.commonness_score }}<template v-if="r.priority.length"> ({{ r.priority.join(', ') }})</template>
            </span>
          </li>
        </ul>
      </div>

      <p v-if="query">
        <a href="#" @click.prevent="runFuzzy">Didn't find it? Try fuzzy search</a>
      </p>
    </template>

    <div v-if="showFuzzy">
      <p>
        <a href="#" @click.prevent="showFuzzy = false">← Back to search results</a>
      </p>
      <h3>
        Fuzzy matches
        <span v-if="fuzzyResultsView.archaic.length > 0 && !fuzzyResultsView.allArchaic" style="color: #888; font-weight: normal;">
          ({{ fuzzyResultsView.archaic.length }} archaic/obsolete/rare in a separate block below{{ showArchaic ? '' : ', hidden' }})
        </span>
      </h3>
      <ul>
        <li v-for="r in fuzzyResultsView.main" :key="r.id">
          <strong>{{ r.kanji.join('、') || r.readings.join('、') }}</strong>
          ({{ r.readings.join('、') }})
          <span v-if="r.pos.length"> [{{ r.pos.join(', ') }}]</span>
          — {{ r.glosses.join('; ') }}
          <span style="color: #aaa;"> distance={{ r.distance.toFixed(2) }}</span>
        </li>
      </ul>

      <div v-if="fuzzyResultsView.archaic.length > 0 && (showArchaic || fuzzyResultsView.allArchaic)">
        <h4 style="color: #888;">
          Archaic / obsolete / rare matches
          <span v-if="fuzzyResultsView.allArchaic" style="font-weight: normal;">(no other matches)</span>
        </h4>
        <ul>
          <li v-for="r in fuzzyResultsView.archaic" :key="r.id">
            <strong>{{ r.kanji.join('、') || r.readings.join('、') }}</strong>
            ({{ r.readings.join('、') }})
            <span v-if="r.pos.length"> [{{ r.pos.join(', ') }}]</span>
            — {{ r.glosses.join('; ') }}
            <span style="color: #aaa;"> distance={{ r.distance.toFixed(2) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </main>
</template>
