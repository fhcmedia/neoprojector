CREATE TABLE IF NOT EXISTS service (
  id          INTEGER PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL DEFAULT (strftime('%m-%d-%y', 'now')),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_section (
  id          INTEGER PRIMARY KEY,
  service_id  INTEGER NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_item (
  id          INTEGER PRIMARY KEY,
  section_id  INTEGER NOT NULL REFERENCES service_section(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bible (
  translation TEXT PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  language    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bible_book (
  name        TEXT PRIMARY KEY,
  position    INTEGER NOT NULL UNIQUE,
  category    TEXT NOT NULL,
  name_kjv    TEXT NOT NULL,
  name_rst    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bible_verse (
  translation TEXT NOT NULL REFERENCES bible(translation),
  book        TEXT NOT NULL REFERENCES bible_book(name),
  chapter     INTEGER NOT NULL,
  verse       INTEGER NOT NULL,
  text        TEXT NOT NULL,
  PRIMARY KEY (translation, book, chapter, verse)
);

CREATE TABLE IF NOT EXISTS bible_translation_map (
  from_translation TEXT NOT NULL REFERENCES bible(translation),
  to_translation   TEXT NOT NULL REFERENCES bible(translation),
  book             TEXT NOT NULL REFERENCES bible_book(name),
  from_chapter     INTEGER NOT NULL,
  from_verse       INTEGER NOT NULL,
  to_chapter       INTEGER NOT NULL,
  to_verse         INTEGER NOT NULL,
  PRIMARY KEY (from_translation, to_translation, book, from_chapter, from_verse)
);

CREATE TABLE IF NOT EXISTS song (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS song_section (
  id          INTEGER PRIMARY KEY,
  song_id     INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS song_line (
  id          INTEGER PRIMARY KEY,
  section_id  INTEGER NOT NULL REFERENCES song_section(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_item_bible (
  item_id     INTEGER PRIMARY KEY REFERENCES service_item(id) ON DELETE CASCADE,
  translation TEXT NOT NULL REFERENCES bible(translation),
  book        TEXT NOT NULL REFERENCES bible_book(name),
  chapter     INTEGER NOT NULL,
  verse_start INTEGER NOT NULL,
  verse_end   INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_item_song (
  item_id     INTEGER PRIMARY KEY REFERENCES service_item(id) ON DELETE CASCADE,
  song_id     INTEGER NOT NULL REFERENCES song(id),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_item_media (
  item_id     INTEGER PRIMARY KEY REFERENCES service_item(id) ON DELETE CASCADE,
  media_id    INTEGER NOT NULL REFERENCES media(id),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
