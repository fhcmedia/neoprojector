-- name: ListDeckBlocks :many
SELECT * FROM deck_block
WHERE slide_id = ?
ORDER BY z_index, id;

-- name: DeckBlockByID :one
SELECT * FROM deck_block WHERE id = ?;

-- name: CreateDeckBlock :one
INSERT INTO deck_block (
  slide_id, z_index, kind,
  x, y, w, h,
  text_json, image_media_id, shape_json, table_json,
  style_json
) VALUES (
  ?, ?, ?,
  ?, ?, ?, ?,
  ?, ?, ?, ?,
  ?
)
RETURNING *;

-- name: UpdateDeckBlock :one
UPDATE deck_block
SET z_index        = ?,
    x              = ?,
    y              = ?,
    w              = ?,
    h              = ?,
    text_json      = ?,
    image_media_id = ?,
    shape_json     = ?,
    table_json     = ?,
    style_json     = ?,
    updated_at     = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteDeckBlock :exec
DELETE FROM deck_block WHERE id = ?;

-- name: DeleteDeckBlocksForSlide :exec
DELETE FROM deck_block WHERE slide_id = ?;

-- name: SetDeckBlockZ :exec
UPDATE deck_block
SET z_index = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;
