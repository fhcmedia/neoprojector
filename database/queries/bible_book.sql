-- name: BibleBookByName :one
SELECT * FROM bible_book WHERE name = ?;

-- name: ListBibleBooks :many
SELECT * FROM bible_book ORDER BY position;
