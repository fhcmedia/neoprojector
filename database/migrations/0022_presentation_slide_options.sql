-- +goose Up
-- Presentation slides gain per-slide playback options:
--   enabled     — excluded slides (0) stay in the list but are skipped by
--                 next/previous and auto-advance;
--   duration_ms — how long this slide stays up while auto-advancing;
--                 0 means "use the presentation's interval";
--   source      — the deck file (PDF/PowerPoint) a slide was imported
--                 from, so a deck's slides can be included/excluded as
--                 a group. Empty for slides added one by one.
ALTER TABLE presentation_slide ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE presentation_slide ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presentation_slide ADD COLUMN source TEXT NOT NULL DEFAULT '';

-- Page images rendered from an imported deck are ordinary image media
-- (so every renderer and the media server handle them unchanged), but
-- hidden from the Media library: a 40-slide deck shouldn't bury the
-- operator's own photos and videos.
ALTER TABLE media ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE media DROP COLUMN hidden;
ALTER TABLE presentation_slide DROP COLUMN source;
ALTER TABLE presentation_slide DROP COLUMN duration_ms;
ALTER TABLE presentation_slide DROP COLUMN enabled;
