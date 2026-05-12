-- name: CreateSongLine :one
INSERT INTO song_line (section_id, position, text)
VALUES (?, ?, ?)
RETURNING *;

-- name: SongLineByID :one
SELECT * FROM song_line WHERE id = ?;

-- name: ListSongLines :many
SELECT * FROM song_line
WHERE section_id = ?
ORDER BY position;

-- name: UpdateSongLine :one
UPDATE song_line
SET position = ?, text = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteSongLine :exec
DELETE FROM song_line WHERE id = ?;

-- name: DeleteSongLinesForSection :exec
DELETE FROM song_line WHERE section_id = ?;
