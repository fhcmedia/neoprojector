-- name: BibleBookByName :one
SELECT name, position, category, name_kjv, name_rst
FROM bible_book
WHERE name = ?;

-- name: ListBibleBooks :many
SELECT name, position, category, name_kjv, name_rst
FROM bible_book
ORDER BY position;
