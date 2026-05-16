-- +goose Up
-- rules_json holds behaviour flags that aren't visual (live in
-- layouts) and aren't widget-content (live in config). First flag:
-- {"cover_slide": true} — when active, the output route hides the
-- bound template and shows only the overlay layer over black, used
-- by countdowns / pre-service screens where the overlay IS the
-- presentation, not decoration over a slide. Snapshotted onto
-- service_item_overlay at schedule-time so library edits don't
-- retroactively change scheduled items.
ALTER TABLE overlay ADD COLUMN rules_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE service_item_overlay ADD COLUMN rules_json TEXT NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE overlay DROP COLUMN rules_json;
ALTER TABLE service_item_overlay DROP COLUMN rules_json;
