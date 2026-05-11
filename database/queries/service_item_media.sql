-- name: CreateServiceItemMedia :one
INSERT INTO service_item_media (item_id, media_id)
VALUES (?, ?)
RETURNING *;

-- name: ServiceItemMediaByItemID :one
SELECT * FROM service_item_media WHERE item_id = ?;

-- name: UpdateServiceItemMedia :one
UPDATE service_item_media
SET media_id = ?, updated_at = CURRENT_TIMESTAMP
WHERE item_id = ?
RETURNING *;

-- name: DeleteServiceItemMedia :exec
DELETE FROM service_item_media WHERE item_id = ?;
