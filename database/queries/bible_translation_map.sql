-- name: MapVerse :one
SELECT to_chapter, to_verse
FROM bible_translation_map
WHERE from_translation = ? AND to_translation = ?
  AND book = ? AND from_chapter = ? AND from_verse = ?;

-- name: MapVerseRange :many
SELECT from_chapter, from_verse, to_chapter, to_verse
FROM bible_translation_map
WHERE from_translation = ? AND to_translation = ?
  AND book = ? AND from_chapter = ?
  AND from_verse BETWEEN ? AND ?
ORDER BY from_verse;
