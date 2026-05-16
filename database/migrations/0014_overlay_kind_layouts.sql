-- +goose Up
-- Reshapes the overlay model:
--  - An overlay is a single widget instance (countdown, clock, …),
--    not a composition. `kind` carries the widget type; `config_json`
--    its function-specific data (e.g. countdown target time).
--  - `layouts_json` is the per-display visual layer:
--      { "default": {x,y,w,h,style}, "displays": { "<id>": {…} } }
--    Output windows fall back to "default" when no per-display
--    override exists. Replaces the old widgets_json composition and
--    target_displays list.
ALTER TABLE overlay ADD COLUMN kind         TEXT NOT NULL DEFAULT '';
ALTER TABLE overlay ADD COLUMN config_json  TEXT NOT NULL DEFAULT '{}';
ALTER TABLE overlay ADD COLUMN layouts_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE overlay DROP COLUMN widgets_json;
ALTER TABLE overlay DROP COLUMN target_displays_json;

-- +goose Down
ALTER TABLE overlay ADD COLUMN widgets_json         TEXT NOT NULL DEFAULT '[]';
ALTER TABLE overlay ADD COLUMN target_displays_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE overlay DROP COLUMN layouts_json;
ALTER TABLE overlay DROP COLUMN config_json;
ALTER TABLE overlay DROP COLUMN kind;
