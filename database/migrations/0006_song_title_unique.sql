-- +goose Up
-- Defensively rename duplicate titles before installing the unique index so
-- the migration doesn't fail on existing dev data. Lowest id keeps the
-- original name; others get suffixed with their id.
UPDATE song
SET title = title || ' (' || id || ')'
WHERE id NOT IN (
  SELECT MIN(id) FROM song GROUP BY LOWER(title)
);

CREATE UNIQUE INDEX IF NOT EXISTS song_title_unique
  ON song(title COLLATE NOCASE);

-- +goose Down
DROP INDEX IF EXISTS song_title_unique;
