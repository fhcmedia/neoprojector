-- name: CreateSong :one
INSERT INTO song (title) VALUES (?)
RETURNING *;

-- name: UpdateSongMetadata :one
UPDATE song
SET author = ?, copyright = ?, publisher = ?, ccli_number = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
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
