-- +goose Up
-- Presentations gain per-presentation playback settings: auto-loop
-- toggle, the dwell time per slide while looping, and the slide-to-
-- slide transition. All four fields are NOT NULL with sensible
-- defaults so existing rows backfill cleanly.
ALTER TABLE presentation ADD COLUMN loop INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presentation ADD COLUMN interval_ms INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE presentation ADD COLUMN transition_kind TEXT NOT NULL DEFAULT 'fade';
ALTER TABLE presentation ADD COLUMN transition_duration_ms INTEGER NOT NULL DEFAULT 500;

-- +goose Down
-- SQLite < 3.35 doesn't support DROP COLUMN; we recreate the table
-- from the keep-set so a down-migration restores the original
-- shape. Safe for a feature still in dev; no production rows yet.
CREATE TABLE presentation_new (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO presentation_new (id, name, created_at, updated_at)
  SELECT id, name, created_at, updated_at FROM presentation;
DROP TABLE presentation;
ALTER TABLE presentation_new RENAME TO presentation;
