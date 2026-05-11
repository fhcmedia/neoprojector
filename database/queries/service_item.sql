-- name: CreateServiceItem :one
INSERT INTO service_item (section_id, position)
VALUES (?, ?)
RETURNING *;

-- name: ServiceItemByID :one
SELECT * FROM service_item WHERE id = ?;

-- name: ListServiceItems :many
SELECT * FROM service_item
WHERE section_id = ?
ORDER BY position;

-- name: NextServiceItemPosition :one
SELECT COALESCE(MAX(position) + 1, 0) AS next_position
FROM service_item
WHERE section_id = ?;

-- name: UpdateServiceItemPosition :one
UPDATE service_item
SET position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteServiceItem :exec
DELETE FROM service_item WHERE id = ?;
