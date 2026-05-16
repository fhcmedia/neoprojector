-- +goose Up
-- Overlay schedule items follow the same shape as bible/song/media:
-- a side table keyed by item_id that carries the kind-specific data.
-- Pure snapshot: the row holds the widget kind + config + layouts at
-- the moment the operator added it. Editing the originating library
-- overlay later doesn't reach back into already-scheduled items.
CREATE TABLE IF NOT EXISTS service_item_overlay (
  item_id        INTEGER PRIMARY KEY REFERENCES service_item(id) ON DELETE CASCADE,
  overlay_kind   TEXT NOT NULL,
  overlay_name   TEXT NOT NULL DEFAULT '',
  config_json    TEXT NOT NULL DEFAULT '{}',
  layouts_json   TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- +goose Down
DROP TABLE IF EXISTS service_item_overlay;
