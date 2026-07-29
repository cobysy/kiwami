// Same shape as scripts/assemble-sqlite.mjs's SCHEMA (the real build
// pipeline, Node-only) — duplicated here rather than imported because tests/
// needs this to run inside a browser (via the Vite/browser test build) where
// scripts/ (a Node CLI tool with `node:fs` imports) can't be pulled in.
//
// Omits `search_fts` (FTS5): the browser driver's sql.js build has no FTS5
// module, and src/db/queries/search.js deliberately doesn't use it for
// exactly that reason (see the comment at the top of that file) — so this
// fixture schema doesn't need to create a table nothing in the query layer
// queries.
export const SCHEMA_SQL = `
CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  kanji_count INTEGER NOT NULL,
  commonness_score REAL NOT NULL,
  is_archaic INTEGER NOT NULL
);

CREATE TABLE entry_kanji (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  info TEXT NOT NULL,
  priority TEXT NOT NULL
);
CREATE INDEX idx_entry_kanji_text ON entry_kanji(text);
CREATE INDEX idx_entry_kanji_entry ON entry_kanji(entry_id);

CREATE TABLE entry_readings (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  no_kanji INTEGER NOT NULL,
  restrict_to TEXT,
  info TEXT NOT NULL,
  priority TEXT NOT NULL
);
CREATE INDEX idx_entry_readings_text ON entry_readings(text);
CREATE INDEX idx_entry_readings_entry ON entry_readings(entry_id);

CREATE TABLE entry_senses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  pos TEXT NOT NULL,
  field TEXT NOT NULL,
  misc TEXT NOT NULL,
  dial TEXT NOT NULL,
  xref TEXT NOT NULL,
  antonym TEXT NOT NULL,
  info TEXT,
  restrict_to_kanji TEXT,
  restrict_to_reading TEXT
);
CREATE INDEX idx_entry_senses_entry ON entry_senses(entry_id);

CREATE TABLE entry_glosses (
  sense_id INTEGER NOT NULL REFERENCES entry_senses(id),
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ord INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX idx_entry_glosses_sense ON entry_glosses(sense_id);
CREATE INDEX idx_entry_glosses_entry ON entry_glosses(entry_id);

CREATE TABLE kanji (
  literal TEXT PRIMARY KEY,
  onyomi TEXT NOT NULL,
  kunyomi TEXT NOT NULL,
  meanings TEXT NOT NULL,
  stroke_count INTEGER,
  grade INTEGER,
  jlpt INTEGER,
  frequency INTEGER,
  radical_number INTEGER
);

CREATE TABLE kanji_compounds (
  kanji TEXT NOT NULL REFERENCES kanji(literal),
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  score REAL NOT NULL
);
CREATE INDEX idx_kanji_compounds_kanji ON kanji_compounds(kanji);

CREATE TABLE sentences (
  id INTEGER PRIMARY KEY,
  japanese TEXT NOT NULL,
  japanese_author TEXT,
  english TEXT NOT NULL,
  english_author TEXT,
  furigana TEXT NOT NULL
);

CREATE TABLE entry_sentences (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  sentence_id INTEGER NOT NULL REFERENCES sentences(id)
);
CREATE INDEX idx_entry_sentences_entry ON entry_sentences(entry_id);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
