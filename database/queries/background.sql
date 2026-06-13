-- name: ListBackgrounds :many
SELECT * FROM background ORDER BY name COLLATE NOCASE;

-- name: BackgroundByID :one
SELECT * FROM background WHERE id = ?;

-- name: CreateBackground :one
INSERT INTO background (name, engine, config_json)
VALUES (?, ?, ?)
RETURNING *;

-- name: CreateBackgroundWithID :one
-- Upsert keyed on id: editing a seed default persists a row that
-- reuses the seed's negative id (shadowing it); restore deletes the
-- row and the frontend seed shows through again.
INSERT INTO background (id, name, engine, config_json)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name        = excluded.name,
  engine      = excluded.engine,
  config_json = excluded.config_json,
  updated_at  = CURRENT_TIMESTAMP
RETURNING *;

-- name: UpdateBackground :one
UPDATE background
SET name = ?, engine = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteBackground :exec
DELETE FROM background WHERE id = ?;
