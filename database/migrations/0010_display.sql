-- +goose Up
-- Each row is one configured output. `position` drives the order in
-- the Show pane. Template references store the id of either a DB-
-- backed template (positive integer) or a frontend default (negative
-- integer); resolution happens client-side so we don't need a foreign
-- key here. Null = unbound, render nothing for that content kind.
CREATE TABLE IF NOT EXISTS display (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  position           INTEGER NOT NULL DEFAULT 0,
  bible_template_id  INTEGER,
  song_template_id   INTEGER,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- +goose Down
DROP TABLE IF EXISTS display;
