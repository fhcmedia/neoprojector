-- +goose Up
-- A deck is the rich, editable slideshow primitive — distinct from
-- `presentation` (which is an ordered list of opaque media references).
-- Imported PPTX/DOCX/PDF/ODP/ODT/RTF land here so the operator can
-- tweak text, swap images, restyle, and reorder slides without
-- round-tripping through the source application.
--
-- A deck carries its own canvas size (width × height) because imported
-- documents arrive at varied aspect ratios (16:9 PPTX, 4:3 legacy
-- decks, US-Letter portrait DOCX). The renderer normalises block
-- coordinates against this canvas so a deck stays sharp on the live
-- output regardless of the projector.
--
-- `source` records the original format so the import UI can surface
-- "this came from PowerPoint" badges and so we can attribute parser
-- fidelity issues to the right code path. `source_path` is the raw
-- on-disk path at import time; informational only, not used for
-- re-ingest (we copy bytes into the media store on import).
CREATE TABLE IF NOT EXISTS deck (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'native',
  source_path TEXT NOT NULL DEFAULT '',
  width       INTEGER NOT NULL DEFAULT 1920,
  height      INTEGER NOT NULL DEFAULT 1080,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS deck_name_unique
  ON deck(name COLLATE NOCASE);

-- deck_slide: one row per slide. ON DELETE CASCADE on deck_id wipes
-- slides when the deck is deleted; `position` is a 0-based monotonic
-- index, kept unique-per-deck so reorder is just rewriting positions.
-- background_json is the slide-level fill (solid colour, gradient, or
-- a media reference for image/video backgrounds). The renderer parses
-- it; SQL never inspects.
CREATE TABLE IF NOT EXISTS deck_slide (
  id              INTEGER PRIMARY KEY,
  deck_id         INTEGER NOT NULL REFERENCES deck(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL DEFAULT 0,
  background_json TEXT NOT NULL DEFAULT '{}',
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deck_slide_deck
  ON deck_slide(deck_id, position);

-- deck_block: a positioned, sized element on a slide. Coordinates
-- (x, y, w, h) are normalised against the parent deck's canvas — they
-- are floats in [0, 1] so an imported PPTX renders the same on a 4K
-- output as on a 720p preview. `kind` discriminates the payload
-- column that's populated; the others stay NULL. style_json holds
-- opaque renderer hints (effects, alignment, padding) the SQL layer
-- never inspects.
--
-- image_media_id is a hard FK to media; deleting an underlying media
-- row drops the block (consistent with how presentation_slide treats
-- media_id). This means a deck can become "thin" if media is purged,
-- which is acceptable — the alternative is silently dangling refs.
CREATE TABLE IF NOT EXISTS deck_block (
  id             INTEGER PRIMARY KEY,
  slide_id       INTEGER NOT NULL REFERENCES deck_slide(id) ON DELETE CASCADE,
  z_index        INTEGER NOT NULL DEFAULT 0,
  kind           TEXT NOT NULL,
  x              REAL NOT NULL DEFAULT 0,
  y              REAL NOT NULL DEFAULT 0,
  w              REAL NOT NULL DEFAULT 1,
  h              REAL NOT NULL DEFAULT 1,
  text_json      TEXT,
  image_media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
  shape_json     TEXT,
  table_json     TEXT,
  style_json     TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deck_block_slide
  ON deck_block(slide_id, z_index);

-- A schedule item can point at a deck the same way it points at a
-- presentation. Cascades match the presentation pattern.
CREATE TABLE IF NOT EXISTS service_item_deck (
  item_id     INTEGER PRIMARY KEY REFERENCES service_item(id) ON DELETE CASCADE,
  deck_id     INTEGER NOT NULL REFERENCES deck(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- +goose Down
DROP TABLE IF EXISTS service_item_deck;
DROP INDEX IF EXISTS idx_deck_block_slide;
DROP TABLE IF EXISTS deck_block;
DROP INDEX IF EXISTS idx_deck_slide_deck;
DROP TABLE IF EXISTS deck_slide;
DROP INDEX IF EXISTS deck_name_unique;
DROP TABLE IF EXISTS deck;
