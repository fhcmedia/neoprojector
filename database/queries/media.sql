-- name: CreateMedia :one
INSERT INTO media (type, title, path, original_filename)
VALUES (?, ?, ?, ?)
RETURNING *;

-- name: CreateHiddenMedia :one
-- A deck page image: real media, hidden from the library (see 0022).
INSERT INTO media (type, title, path, original_filename, hidden)
VALUES (?, ?, ?, ?, 1)
RETURNING *;

-- name: MediaByID :one
SELECT * FROM media WHERE id = ?;

-- name: ListMedia :many
SELECT * FROM media ORDER BY created_at DESC;

-- name: ListMediaByType :many
SELECT * FROM media WHERE type = ? ORDER BY created_at DESC;

-- name: UpdateMedia :one
UPDATE media
SET title = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SwapMediaPath :execrows
-- Points a media row at a new file (a playback copy), but only if it
-- still points at the file the copy was made from; a concurrent delete
-- or re-swap makes this a no-op (0 rows) instead of clobbering it.
UPDATE media
SET path = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ? AND path = ?;

-- name: DeleteMedia :exec
DELETE FROM media WHERE id = ?;

-- name: DeleteHiddenMedia :exec
DELETE FROM media WHERE id = ? AND hidden = 1;

-- name: ListHiddenPDFMedia :many
-- Temporary deck PDFs (PrepareDeck → FinishDeck); any left at startup
-- belong to an import the app was closed during.
SELECT id, path FROM media WHERE hidden = 1 AND type = 'pdf';
