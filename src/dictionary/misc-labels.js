// Maps the restricted set of JMdict misc tags LABELS_SUBQUERY pulls
// (entry_senses.misc, filtered to just arch/obs/rare/obsc - see
// dictionary-entries.js) to display words. Transcribed from the JMdict_e
// DTD's <!ENTITY> declarations:
// https://www.edrdg.org/jmdictdb/cgi-bin/edhelp.py?svc=jmdict&sid=#kw_misc
// obsc isn't in the current DTD (dropped from JMdict at some point) and
// doesn't appear in the built DB, but LABELS_SUBQUERY still allows it, so
// it's mapped here too rather than silently falling back to the raw code.
const MISC_LABELS = {
  arch: 'archaic',
  obs: 'obsolete',
  rare: 'rare',
  obsc: 'obscure',
};

export function miscLabel(tag) {
  return MISC_LABELS[tag] ?? tag;
}
