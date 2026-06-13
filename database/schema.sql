CREATE TABLE IF NOT EXISTS service (
  id            INTEGER PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL DEFAULT (strftime('%m-%d-%y', 'now')),
  -- Background assignment, nearest wins: item -> section -> service ->
  -- none. No FK anywhere background_id appears: negative ids reference
  -- frontend seed presets (template-binding convention), and a deleted
  -- background row resolves to "inherit" instead of blocking deletion.
  background_id INTEGER,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_section (
  id            INTEGER PRIMARY KEY,
  service_id    INTEGER NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL,
  color         TEXT NOT NULL DEFAULT '',
  background_id INTEGER,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_item (
  id            INTEGER PRIMARY KEY,
  section_id    INTEGER NOT NULL REFERENCES service_section(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  background_id INTEGER,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS song_title_unique
  ON song(title COLLATE NOCASE);

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

CREATE TABLE IF NOT EXISTS service_item_overlay (
  item_id        INTEGER PRIMARY KEY REFERENCES service_item(id) ON DELETE CASCADE,
  overlay_kind   TEXT NOT NULL,
  overlay_name   TEXT NOT NULL DEFAULT '',
  config_json    TEXT NOT NULL DEFAULT '{}',
  layouts_json   TEXT NOT NULL DEFAULT '{}',
  rules_json     TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_item_media (
  item_id     INTEGER PRIMARY KEY REFERENCES service_item(id) ON DELETE CASCADE,
  media_id    INTEGER NOT NULL REFERENCES media(id),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS template (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'general',
  viewport_w  INTEGER NOT NULL DEFAULT 1920,
  viewport_h  INTEGER NOT NULL DEFAULT 1080,
  data_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS template_name_unique
  ON template(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS overlay (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT '',
  config_json   TEXT NOT NULL DEFAULT '{}',
  layouts_json  TEXT NOT NULL DEFAULT '{}',
  rules_json    TEXT NOT NULL DEFAULT '{}',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backgrounds are first-class documents (animated shader configs;
-- engine leaves room for other renderers). Seed defaults live in the
-- frontend with negative ids; a row with a negative id is a user-
-- edited shadow of that seed (same convention as templates).
CREATE TABLE IF NOT EXISTS background (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  engine      TEXT NOT NULL DEFAULT 'gradflow',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS display (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  position           INTEGER NOT NULL DEFAULT 0,
  bible_template_id  INTEGER,
  song_template_id   INTEGER,
  screen_id          TEXT,
  -- Per-display content routing. 1 = this output renders the matching
  -- live kind; 0 = it stays black for that kind. Lets one screen show
  -- lyrics while another shows only media, etc. See migration 0019.
  show_song          INTEGER NOT NULL DEFAULT 1,
  show_bible         INTEGER NOT NULL DEFAULT 1,
  show_media         INTEGER NOT NULL DEFAULT 1,
  show_overlay       INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS presentation (
  id                     INTEGER PRIMARY KEY,
  name                   TEXT NOT NULL,
  loop                   INTEGER NOT NULL DEFAULT 0,
  interval_ms            INTEGER NOT NULL DEFAULT 5000,
  transition_kind        TEXT NOT NULL DEFAULT 'fade',
  transition_duration_ms INTEGER NOT NULL DEFAULT 500,
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS presentation_slide (
  id              INTEGER PRIMARY KEY,
  presentation_id INTEGER NOT NULL REFERENCES presentation(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL DEFAULT 0,
  media_id        INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_presentation_slide_presentation
  ON presentation_slide(presentation_id, position);

CREATE TABLE IF NOT EXISTS service_item_presentation (
  item_id         INTEGER PRIMARY KEY REFERENCES service_item(id) ON DELETE CASCADE,
  presentation_id INTEGER NOT NULL REFERENCES presentation(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
