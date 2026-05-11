-- name: CreateSong :one
INSERT INTO song (title, category) VALUES (?, ?)
RETURNING *;

-- name: SongByID :one
SELECT * FROM song WHERE id = ?;

-- name: ListSongs :many
SELECT * FROM song ORDER BY title;

-- name: SearchSongsByTitle :many
SELECT * FROM song
WHERE title LIKE '%' || ? || '%'
ORDER BY title;

-- name: UpdateSong :one
UPDATE song
SET title = ?, category = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteSong :exec
DELETE FROM song WHERE id = ?;
