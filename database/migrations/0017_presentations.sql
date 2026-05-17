-- +goose Up
-- A presentation is a named, ordered sequence of media slides — the
-- operator's "slideshow" primitive. The slide list lives in its own
-- table so we can ON DELETE CASCADE-clean it when a presentation goes
-- away, and so a slide is a real row with a position separate from
-- the media row it points at (one media item can appear many times
-- in a single presentation if the operator wants a repeat).
CREATE TABLE IF NOT EXISTS presentation (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- presentation_slide: one row per slide. ON DELETE CASCADE on
-- presentation_id wipes slides when the presentation is deleted; on
-- media_id, deleting a media row also drops the slide that referenced
-- it (consistent with how service_item_media behaves, so a deleted
-- file never leaves a dangling reference).
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

-- A schedule item can point at a presentation by id, in the same
-- shape every other item-kind binding uses (item_id 1:1 with a
-- per-kind row). The presentation_id FK lets us cascade item rows
-- away when the underlying presentation is deleted.
CREATE TABLE IF NOT EXISTS service_item_presentation (
  item_id         INTEGER PRIMARY KEY REFERENCES service_item(id) ON DELETE CASCADE,
  presentation_id INTEGER NOT NULL REFERENCES presentation(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- +goose Down
DROP TABLE IF EXISTS service_item_presentation;
DROP INDEX IF EXISTS idx_presentation_slide_presentation;
DROP TABLE IF EXISTS presentation_slide;
DROP TABLE IF EXISTS presentation;
