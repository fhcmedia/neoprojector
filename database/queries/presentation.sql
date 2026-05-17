-- name: ListPresentations :many
SELECT * FROM presentation ORDER BY name COLLATE NOCASE;

-- name: PresentationByID :one
SELECT * FROM presentation WHERE id = ?;

-- name: CreatePresentation :one
INSERT INTO presentation (name)
VALUES (?)
RETURNING *;

-- name: RenamePresentation :one
UPDATE presentation
SET name = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeletePresentation :exec
DELETE FROM presentation WHERE id = ?;

-- name: UpdatePresentationPlayback :one
UPDATE presentation
SET loop                   = ?,
    interval_ms            = ?,
    transition_kind        = ?,
    transition_duration_ms = ?,
    updated_at             = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;
