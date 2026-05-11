-- name: CreateServiceItemSong :one
INSERT INTO service_item_song (item_id, song_id)
VALUES (?, ?)
RETURNING *;

-- name: ServiceItemSongByItemID :one
SELECT * FROM service_item_song WHERE item_id = ?;

-- name: UpdateServiceItemSong :one
UPDATE service_item_song
SET song_id = ?, updated_at = CURRENT_TIMESTAMP
WHERE item_id = ?
RETURNING *;

-- name: DeleteServiceItemSong :exec
DELETE FROM service_item_song WHERE item_id = ?;
