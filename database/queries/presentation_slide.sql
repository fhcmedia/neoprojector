-- name: ListPresentationSlides :many
SELECT ps.*, m.title AS media_title, m.type AS media_type
FROM presentation_slide ps
LEFT JOIN media m ON m.id = ps.media_id
WHERE ps.presentation_id = ?
ORDER BY ps.position;

-- name: CountPresentationSlides :one
SELECT COUNT(*) AS count
FROM presentation_slide
WHERE presentation_id = ?;

-- name: CreatePresentationSlideAppend :one
INSERT INTO presentation_slide (presentation_id, media_id, position)
VALUES (
  sqlc.arg(presentation_id),
  sqlc.arg(media_id),
  COALESCE((SELECT MAX(position) + 1 FROM presentation_slide WHERE presentation_id = sqlc.arg(presentation_id)), 0)
)
RETURNING *;

-- name: DeletePresentationSlide :exec
DELETE FROM presentation_slide WHERE id = ?;

-- name: SetPresentationSlidePosition :exec
UPDATE presentation_slide
SET position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: CreatePresentationSlideFromSource :one
INSERT INTO presentation_slide (presentation_id, media_id, source, position)
VALUES (
  sqlc.arg(presentation_id),
  sqlc.arg(media_id),
  sqlc.arg(source),
  COALESCE((SELECT MAX(position) + 1 FROM presentation_slide WHERE presentation_id = sqlc.arg(presentation_id)), 0)
)
RETURNING *;

-- name: SetPresentationSlideEnabled :exec
UPDATE presentation_slide
SET enabled = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: SetPresentationSlidesEnabledBySource :exec
UPDATE presentation_slide
SET enabled = ?, updated_at = CURRENT_TIMESTAMP
WHERE presentation_id = ? AND source = ?;

-- name: SetAllPresentationSlidesEnabled :exec
UPDATE presentation_slide
SET enabled = ?, updated_at = CURRENT_TIMESTAMP
WHERE presentation_id = ?;

-- name: SetPresentationSlideDuration :exec
UPDATE presentation_slide
SET duration_ms = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: PresentationSlideByID :one
SELECT * FROM presentation_slide WHERE id = ?;

-- name: ListHiddenSlideMedia :many
-- Deck page images used by a presentation (deleted with it when unused).
SELECT DISTINCT m.id, m.path
FROM presentation_slide ps
JOIN media m ON m.id = ps.media_id
WHERE ps.presentation_id = ? AND m.hidden = 1;

-- name: CountSlidesUsingMedia :one
SELECT COUNT(*) FROM presentation_slide WHERE media_id = ?;
