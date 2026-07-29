// Minimal replacement for Node's 'path' module, which Vite externalizes to
// an empty stub for the browser (see
// https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility).
// kuromoji's DictionaryLoader (shared by both the Node and browser dictionary
// loaders — node_modules/kuromoji/src/loader/DictionaryLoader.js) calls
// path.join(dic_path, filename) to build each dictionary file's location; in
// the browser dic_path is a URL prefix (see tokenizer.js), so plain
// '/'-joining is all `join` needs to do here — no drive letters, no '..'
// resolution. Swapped in via the `resolve.alias` in vite.config.js and
// vitest.browser.config.js.
exports.join = function join(...parts) {
  return parts.join('/').replace(/\/{2,}/g, '/');
};
