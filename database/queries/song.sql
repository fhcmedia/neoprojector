-- name: CreateSong :one
INSERT INTO song (title) VALUES (?)
RETURNING *;

-- name: SongByID :one
SELECT * FROM song WHERE id = ?;

-- name: ListSongs :many
SELECT * FROM song ORDER BY title;

-- name: SearchSongsByTitle :many
SELECT * FROM song
WHERE title LIKE '%' || ? || '%'
ORDER BY title;

-- name: UpdateSongTitle :one
UPDATE song
SET title = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteSong :exec
DELETE FROM song WHERE id = ?;

-- name: CountSongServiceItems :one
-- How many schedule items (across all services) use this song.
SELECT COUNT(*) FROM service_item_song WHERE song_id = ?;

-- name: DeleteServiceItemsForSong :exec
-- Removes every schedule item that uses the song (service_item_song
-- cascades from service_item). service_item_song.song_id has no ON
-- DELETE, so these must go before the song itself can be deleted.
DELETE FROM service_item
WHERE id IN (SELECT item_id FROM service_item_song WHERE song_id = ?);
