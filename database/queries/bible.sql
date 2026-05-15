-- name: BibleByTranslation :one
SELECT * FROM bible WHERE translation = ?;

-- name: ListBibles :many
SELECT * FROM bible ORDER BY name;
