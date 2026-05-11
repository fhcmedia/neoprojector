-- name: CreateService :one
INSERT INTO service (name) VALUES (?)
RETURNING *;

-- name: ServiceByID :one
SELECT * FROM service WHERE id = ?;

-- name: ServiceByName :one
SELECT * FROM service WHERE name = ?;

-- name: ListServices :many
SELECT * FROM service ORDER BY created_at DESC;

-- name: RenameService :one
UPDATE service
SET name = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteService :exec
DELETE FROM service WHERE id = ?;
