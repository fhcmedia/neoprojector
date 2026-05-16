-- name: ListDisplays :many
SELECT * FROM display ORDER BY position, id;

-- name: DisplayByID :one
SELECT * FROM display WHERE id = ?;

-- name: CreateDisplayAppend :one
-- Appends a new display at the end of the list. Position auto-fills
-- as MAX(position) + 1 so the new row sits below the existing ones.
INSERT INTO display (name, position)
VALUES (
  sqlc.arg(name),
  COALESCE((SELECT MAX(position) + 1 FROM display), 0)
)
RETURNING *;

-- name: RenameDisplay :one
UPDATE display
SET name = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetDisplayEnabled :one
UPDATE display
SET enabled = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetDisplayBibleTemplate :one
UPDATE display
SET bible_template_id = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetDisplaySongTemplate :one
UPDATE display
SET song_template_id = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetDisplayScreen :one
-- Pass NULL to clear the binding. The OS screen id is stored verbatim
-- and only compared for equality against the live ScreenManager list.
UPDATE display
SET screen_id = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetDisplayPosition :exec
UPDATE display
SET position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: DeleteDisplay :exec
DELETE FROM display WHERE id = ?;
