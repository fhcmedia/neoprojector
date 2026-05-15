-- name: CreateMedia :one
INSERT INTO media (type, title, path, original_filename)
VALUES (?, ?, ?, ?)
RETURNING *;

-- name: MediaByID :one
SELECT * FROM media WHERE id = ?;

-- name: ListMedia :many
SELECT * FROM media ORDER BY created_at DESC;

-- name: ListMediaByType :many
SELECT * FROM media WHERE type = ? ORDER BY created_at DESC;

-- name: UpdateMedia :one
UPDATE media
SET title = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteMedia :exec
DELETE FROM media WHERE id = ?;
