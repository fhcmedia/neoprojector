-- name: ListDecks :many
SELECT * FROM deck ORDER BY name COLLATE NOCASE;

-- name: DeckByID :one
SELECT * FROM deck WHERE id = ?;

-- name: CreateDeck :one
INSERT INTO deck (name, source, source_path, width, height)
VALUES (?, ?, ?, ?, ?)
RETURNING *;

-- name: RenameDeck :one
UPDATE deck
SET name = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: UpdateDeckCanvas :one
UPDATE deck
SET width = ?, height = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteDeck :exec
DELETE FROM deck WHERE id = ?;

-- name: TouchDeck :exec
UPDATE deck
SET updated_at = CURRENT_TIMESTAMP
WHERE id = ?;
