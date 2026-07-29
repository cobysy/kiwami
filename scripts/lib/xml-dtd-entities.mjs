// Shared helper for EDRDG's JMdict/KANJIDIC-style XML files, which declare
// custom entities in an internal DTD subset (e.g. <!ENTITY v5r "Godan verb
// with 'ru' ending">) and then use them as element content (<pos>&v5r;</pos>).
// Standard XML parsers don't resolve DTD entities, so this strips the
// declarations out, builds a name -> description map from them, and replaces
// every &name; reference with the bare code (v5r) so the file becomes plain,
// parseable XML while keeping the machine-readable code as the element text.

export function resolveDtdEntities(rawXml, rootTag) {
  const entityMap = new Map();
  const entityRe = /<!ENTITY\s+(\S+)\s+"([^"]*)">/g;
  let m;
  while ((m = entityRe.exec(rawXml))) {
    entityMap.set(m[1], m[2]);
  }

  const rootStart = rawXml.indexOf(`<${rootTag}>`);
  const closeTag = `</${rootTag}>`;
  const rootEnd = rawXml.indexOf(closeTag);
  if (rootStart === -1 || rootEnd === -1) {
    throw new Error(`Could not find <${rootTag}> root element`);
  }
  const xml = rawXml
    .slice(rootStart, rootEnd + closeTag.length)
    .replace(/&([\w-]+);/g, (full, name) => (entityMap.has(name) ? name : full));

  return { xml, entityMap };
}
