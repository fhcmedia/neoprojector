-- +goose Up
-- Seed a default "Audience" display on first install. Bound to the
-- frontend default templates: Bible — One Translation (id -1) and
-- Song — Audience (id -5). The WHERE NOT EXISTS guard keeps this
-- idempotent and one-shot: if the user already created a display
-- (or deletes the seeded row later), this migration never reseeds.
INSERT INTO display (name, bible_template_id, song_template_id, position)
SELECT 'Audience', -1, -5, 0
WHERE NOT EXISTS (SELECT 1 FROM display);

-- +goose Down
-- no-op: the user may have renamed or edited the seeded display, so
-- deleting it on rollback would lose their work.
