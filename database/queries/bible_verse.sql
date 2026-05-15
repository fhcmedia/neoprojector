-- name: BibleVerse :one
SELECT * FROM bible_verse
WHERE translation = ? AND book = ? AND chapter = ? AND verse = ?;

-- name: BibleVerseRange :many
SELECT * FROM bible_verse
WHERE translation = ? AND book = ? AND chapter = ?
  AND verse BETWEEN ? AND ?
ORDER BY verse;

-- name: BibleChapter :many
SELECT * FROM bible_verse
WHERE translation = ? AND book = ? AND chapter = ?
ORDER BY verse;

-- name: BibleChaptersForBook :many
SELECT DISTINCT chapter
FROM bible_verse
WHERE translation = ? AND book = ?
ORDER BY chapter;

-- name: BibleChapterVerses :many
SELECT verse, text
FROM bible_verse
WHERE translation = ? AND book = ? AND chapter = ?
ORDER BY verse;
