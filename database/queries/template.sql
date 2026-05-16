-- name: CreateTemplate :one
INSERT INTO template (name, kind, viewport_w, viewport_h, data_json)
VALUES (?, ?, ?, ?, ?)
RETURNING *;

-- name: TemplateByID :one
SELECT * FROM template WHERE id = ?;

-- name: TemplateByName :one
SELECT * FROM template WHERE name = ? COLLATE NOCASE;

-- name: ListTemplates :many
SELECT * FROM template ORDER BY name COLLATE NOCASE ASC;

-- name: UpdateTemplate :one
UPDATE template
SET name = ?,
    kind = ?,
    viewport_w = ?,
    viewport_h = ?,
    data_json = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteTemplate :exec
DELETE FROM template WHERE id = ?;

-- name: DuplicateTemplate :one
-- Creates a copy of an existing user template, with a fresh name.
INSERT INTO template (name, kind, viewport_w, viewport_h, data_json)
SELECT ?, kind, viewport_w, viewport_h, data_json
FROM template
WHERE template.id = ?
RETURNING *;
