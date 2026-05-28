-- name: ListDeckSlides :many
SELECT * FROM deck_slide
WHERE deck_id = ?
ORDER BY position;

-- name: DeckSlideByID :one
SELECT * FROM deck_slide WHERE id = ?;

-- name: CountDeckSlides :one
SELECT COUNT(*) AS count
FROM deck_slide
WHERE deck_id = ?;

-- name: CreateDeckSlideAppend :one
INSERT INTO deck_slide (deck_id, position, background_json, notes)
VALUES (
  sqlc.arg(deck_id),
  COALESCE((SELECT MAX(position) + 1 FROM deck_slide WHERE deck_id = sqlc.arg(deck_id)), 0),
  sqlc.arg(background_json),
  sqlc.arg(notes)
)
RETURNING *;

-- name: CreateDeckSlideAt :one
INSERT INTO deck_slide (deck_id, position, background_json, notes)
VALUES (?, ?, ?, ?)
RETURNING *;

-- name: DeleteDeckSlide :exec
DELETE FROM deck_slide WHERE id = ?;

-- name: SetDeckSlidePosition :exec
UPDATE deck_slide
SET position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: SetDeckSlideBackground :one
UPDATE deck_slide
SET background_json = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetDeckSlideNotes :one
UPDATE deck_slide
SET notes = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;
