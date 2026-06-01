-- +goose Up
-- Per-display content routing. Each flag gates one live-content kind on
-- this specific output: a stage monitor can show song lyrics while never
-- showing media backgrounds, a lobby screen can show media while ignoring
-- bible verses, etc. Default 1 (show everything) preserves the prior
-- behavior where every enabled display rendered every kind it had a
-- binding for. Suppression is applied client-side in each output window
-- (and mirrored in the operator's preview), so no live-payload change is
-- needed — the window reads its own row and filters by the live slide's
-- kind. show_overlay gates the overlay layer that stacks on top.
ALTER TABLE display ADD COLUMN show_song    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE display ADD COLUMN show_bible   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE display ADD COLUMN show_media   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE display ADD COLUMN show_overlay INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE display DROP COLUMN show_overlay;
ALTER TABLE display DROP COLUMN show_media;
ALTER TABLE display DROP COLUMN show_bible;
ALTER TABLE display DROP COLUMN show_song;
