-- +goose Up
-- An overlay is a named composition of widgets (clock, countdown,
-- preacher_name, …) that layers on top of the bound template on the
-- displays it targets. Widget instances + target displays are stored
-- as opaque JSON because the frontend is the only consumer; SQL never
-- queries inside these blobs. Schedule items can reference an overlay
-- via overlay_id to flip its active state at a point in the service.
CREATE TABLE IF NOT EXISTS overlay (
  id                      INTEGER PRIMARY KEY,
  name                    TEXT NOT NULL,
  widgets_json            TEXT NOT NULL DEFAULT '[]',
  target_displays_json    TEXT NOT NULL DEFAULT '[]',
  position                INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- +goose Down
DROP TABLE IF EXISTS overlay;
