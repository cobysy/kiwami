// Kuromoji morphological analyzer, used by deconjugate.js as a fallback for
// conjugation patterns the hand-rolled suffix rules don't cover (irregular
// verbs like する/来る, longer auxiliary chains, etc.) — see deconjugate.js
// for why the rules exist at all instead of just always tokenizing.
//
// kuromoji.builder({ dicPath }) wants a filesystem directory in Node and a
// URL prefix in the browser (it swaps its internal loader via package.json's
// "browser" field); both point at the same copy of kuromoji's IPADIC dict
// files placed by `npm run setup:kuromoji` (see scripts/copy-kuromoji-dict.mjs),
// mirroring how public/assets/sql-wasm.wasm is set up for jeep-sqlite.
import kuromoji from 'kuromoji';

const DIC_PATH = typeof window === 'undefined'
  ? new URL('../../../public/assets/kuromoji-dict/', import.meta.url).pathname
  : '/assets/kuromoji-dict/';

let tokenizerPromise = null;

// Building the tokenizer parses ~17MB of trie/cost-matrix data, so it's
// done once per process/session and reused — not per query.
export function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: DIC_PATH }).build((err, tokenizer) => {
        if (err) reject(err);
        else resolve(tokenizer);
      });
    });
  }
  return tokenizerPromise;
}
