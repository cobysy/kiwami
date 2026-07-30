// Whether an entry counts as no-longer-current Japanese - the `archaic` flag
// every query result carries, which the UI uses to split those entries into
// their own collapsed block instead of interleaving them by score (see
// archaicView in App.vue).
//
// Derived here, at query time, from the misc tags already stored on each
// sense - deliberately not precomputed into an entries column. Which tags
// count and how they combine is a judgment call that gets revisited, and as
// a baked-in column every revision costs a full JMdict reparse + SQLite
// reassemble + zstd recompress of a ~40MB tracked binary. As a function it's
// a code change, and the same dictionary.db keeps serving whatever rule this
// file currently states.
//
// Sense-level "this usage is dead" tags. Deliberately narrower than
// misc-labels.js's 'archaic' *color* category, which also covers hist: hist
// marks the referent as historical, not the word as dead (阪神・淡路大震災,
// 幕府, 明治, 帝国議会 are all current Japanese for talking about the past),
// so a hist sense still gets the red pill but stays in the main results.
const ARCHAIC_MISC = new Set(['arch', 'obs', 'rare', 'obsc', 'dated']);

/**
 * @param {string[][]} senseMisc - misc tags per sense, in sense order.
 * @param {string[]} priority - the entry's raw ke_pri/re_pri tags.
 * @returns {boolean}
 */
export function isArchaicEntry(senseMisc, priority) {
  if (senseMisc.length === 0) return false;
  // Never an entry JMdict gave a priority tag: 婦人 (news1/ichi1, "woman;
  // lady") is tagged dated but far too common to push below the main list.
  if (priority.length > 0) return false;
  // A sense counts as archaic when it carries *any* ARCHAIC_MISC tag, not
  // only when every one of its tags is archaic - JMdict routinely pairs an
  // archaic tag with an orthogonal one (熊手婆 "midwife" is arch+derog, 熊蟻
  // is rare+uk, 支那 is sens+dated+uk), and requiring all of them to be
  // archaic let every such entry through as a live result.
  //
  // Every sense, though, not any sense: a live word with one dead sense is
  // still a live word (母/いろは, an archaic reading meaning "birth mother").
  return senseMisc.every((misc) => misc.some((tag) => ARCHAIC_MISC.has(tag)));
}
