-- name: CreateServiceItem :one
INSERT INTO service_item (section_id, position)
VALUES (?, ?)
RETURNING *;

-- name: CreateServiceItemAppend :one
INSERT INTO service_item (section_id, position)
VALUES (
  sqlc.arg(section_id),
  COALESCE((SELECT MAX(position) + 1 FROM service_item WHERE service_item.section_id = sqlc.arg(section_id)), 0)
)
RETURNING *;

-- name: SetServiceItemPosition :exec
UPDATE service_item
SET position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: MoveServiceItem :one
UPDATE service_item
SET section_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: ListServiceItemsWithContent :many
SELECT
  si.id,
  si.section_id,
  si.position,
  CASE
    WHEN sis.item_id IS NOT NULL THEN 'song'
    WHEN sib.item_id IS NOT NULL THEN 'bible'
    WHEN sim.item_id IS NOT NULL THEN 'media'
    ELSE ''
  END AS kind,
  CAST(COALESCE(sis.song_id, 0) AS INTEGER) AS song_id,
  CAST(COALESCE(sib.book, '') AS TEXT) AS book,
  CAST(COALESCE(sib.chapter, 0) AS INTEGER) AS chapter,
  CAST(COALESCE(sib.verse_start, 0) AS INTEGER) AS verse_start,
  CAST(COALESCE(sib.verse_end, 0) AS INTEGER) AS verse_end,
  CAST(COALESCE(sim.media_id, 0) AS INTEGER) AS media_id,
  CAST(COALESCE(s.title, m.title, '') AS TEXT) AS label,
  CAST(COALESCE(bb.name_kjv, '') AS TEXT) AS book_kjv
FROM service_item si
LEFT JOIN service_item_song sis ON sis.item_id = si.id
LEFT JOIN service_item_bible sib ON sib.item_id = si.id
LEFT JOIN service_item_media sim ON sim.item_id = si.id
LEFT JOIN song s ON s.id = sis.song_id
LEFT JOIN media m ON m.id = sim.media_id
LEFT JOIN bible_book bb ON bb.name = sib.book
WHERE si.section_id = ?
ORDER BY si.position;

-- name: ServiceItemByID :one
SELECT * FROM service_item WHERE id = ?;

-- name: ListServiceItems :many
SELECT * FROM service_item
WHERE section_id = ?
ORDER BY position;

-- name: NextServiceItemPosition :one
SELECT COALESCE(MAX(position) + 1, 0) AS next_position
FROM service_item
WHERE section_id = ?;

-- name: UpdateServiceItemPosition :one
UPDATE service_item
SET position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteServiceItem :exec
DELETE FROM service_item WHERE id = ?;
