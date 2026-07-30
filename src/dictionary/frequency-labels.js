// Decodes JMdict's ke_pri/re_pri priority tags (entry_kanji.priority /
// entry_readings.priority, a JSON array per kanji/reading) into a
// human-readable description of what corpus/list flagged the word as
// common, for a tooltip alongside the raw tag. See the JMdict_e DTD's
// comment on ke_pri for the source definitions this is transcribed from:
// https://www.edrdg.org/jmdictdb/cgi-bin/edhelp.py?svc=jmdict&sid=#kw_pri
//
// Color lives here too (see priorityColor below), not in App.vue/CSS, same
// as misc-labels.js and pos-labels.js.
const PRIORITY_CATEGORY_COLORS = {
  // Top tier of a curated commonness list (or JMdict's own spec1/gai1
  // judgment) - the strongest attestation signal.
  common: '#4ade80',
  // Same lists' second, demoted tier.
  demoted: '#f2b64d',
  // nfXX is a numeric newspaper-frequency rank, not curated-list
  // membership, so it gets its own flat color rather than being forced
  // into the common/demoted split (there's no principled band cutoff for
  // that split, unlike the two-tier lists above).
  banded: '#5fd0c0',
};

const PRIORITY_LABELS = {
  news1: { label: 'top 12,000 words in a newspaper word-frequency list', category: 'common' },
  news2: { label: 'next 12,000 words in a newspaper word-frequency list', category: 'demoted' },
  ichi1: { label: 'common word (Ichimango goi bunruishuu word list)', category: 'common' },
  ichi2: { label: 'ichi1 word demoted for low real-world frequency', category: 'demoted' },
  spec1: { label: 'known to be common, though not in a frequency list', category: 'common' },
  spec2: { label: 'known to be somewhat common, though not in a frequency list', category: 'demoted' },
  gai1: { label: 'common loanword', category: 'common' },
  gai2: { label: 'less common loanword', category: 'demoted' },
};

export function priorityLabel(tag) {
  const nf = /^nf(\d{2})$/.exec(tag);
  if (nf) {
    const band = Number(nf[1]);
    return `newspaper frequency rank ${(band - 1) * 500 + 1}-${band * 500}`;
  }
  return PRIORITY_LABELS[tag]?.label ?? tag;
}

function priorityCategory(tag) {
  if (PRIORITY_LABELS[tag]) return PRIORITY_LABELS[tag].category;
  if (/^nf\d{2}$/.test(tag)) return 'banded';
  return null;
}

// An entry's priority tags often combine (e.g. 猫 carries ichi1+news1+nf07),
// so this picks one representative color for the whole array: common >
// demoted > banded, mirroring pos-labels.js's archaic-first posCategory()
// ordering - the strongest signal present wins.
const CATEGORY_RANK = { common: 0, demoted: 1, banded: 2 };
export function priorityColor(tags) {
  let best = null;
  for (const tag of tags) {
    const category = priorityCategory(tag);
    if (category && (best === null || CATEGORY_RANK[category] < CATEGORY_RANK[best])) best = category;
  }
  return best ? PRIORITY_CATEGORY_COLORS[best] : null;
}
