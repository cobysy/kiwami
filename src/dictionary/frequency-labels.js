// Decodes JMdict's ke_pri/re_pri priority tags (entry_kanji.priority /
// entry_readings.priority, a JSON array per kanji/reading) into a
// human-readable description of what corpus/list flagged the word as
// common, for a tooltip alongside the raw tag. See the JMdict_e DTD's
// comment on ke_pri for the source definitions this is transcribed from:
// https://www.edrdg.org/jmdictdb/cgi-bin/edhelp.py?svc=jmdict&sid=#kw_pri
const PRIORITY_LABELS = {
  news1: 'top 12,000 words in a newspaper word-frequency list',
  news2: 'next 12,000 words in a newspaper word-frequency list',
  ichi1: 'common word (Ichimango goi bunruishuu word list)',
  ichi2: 'ichi1 word demoted for low real-world frequency',
  spec1: 'known to be common, though not in a frequency list',
  spec2: 'known to be somewhat common, though not in a frequency list',
  gai1: 'common loanword',
  gai2: 'less common loanword',
};

export function priorityLabel(tag) {
  const nf = /^nf(\d{2})$/.exec(tag);
  if (nf) {
    const band = Number(nf[1]);
    return `newspaper frequency rank ${(band - 1) * 500 + 1}-${band * 500}`;
  }
  return PRIORITY_LABELS[tag] ?? tag;
}
