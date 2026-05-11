-- name: CreateServiceItemBible :one
INSERT INTO service_item_bible (item_id, translation, book, chapter, verse_start, verse_end)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: ServiceItemBibleByItemID :one
SELECT * FROM service_item_bible WHERE item_id = ?;

-- name: UpdateServiceItemBible :one
UPDATE service_item_bible
SET translation = ?, book = ?, chapter = ?, verse_start = ?, verse_end = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE item_id = ?
RETURNING *;

-- name: DeleteServiceItemBible :exec
DELETE FROM service_item_bible WHERE item_id = ?;
