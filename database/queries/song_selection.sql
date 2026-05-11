-- name: CreateSongSection :one
INSERT INTO song_section (song_id, type, position)
VALUES (?, ?, ?)
RETURNING *;

-- name: SongSectionByID :one
SELECT * FROM song_section WHERE id = ?;

-- name: ListSongSections :many
SELECT * FROM song_section
WHERE song_id = ?
ORDER BY position;

-- name: UpdateSongSection :one
UPDATE song_section
SET type = ?, position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteSongSection :exec
DELETE FROM song_section WHERE id = ?;
