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

-- name: CreateSongSectionAppend :one
INSERT INTO song_section (song_id, type, position)
VALUES (
  sqlc.arg(song_id),
  sqlc.arg(type),
  COALESCE((SELECT MAX(position) + 1 FROM song_section WHERE song_section.song_id = sqlc.arg(song_id)), 0)
)
RETURNING *;

-- name: UpdateSongSectionType :one
UPDATE song_section
SET type = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetSongSectionPosition :exec
UPDATE song_section
SET position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: DeleteSongSection :exec
DELETE FROM song_section WHERE id = ?;

-- name: DeleteSongSectionsForSong :exec
DELETE FROM song_section WHERE song_id = ?;
