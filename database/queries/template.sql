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

-- name: CreateTemplateWithID :one
-- Upsert keyed on id: editing a seed default persists a row reusing
-- the seed's negative id (shadowing it); restore deletes the row and
-- the frontend seed shows through again.
INSERT INTO template (id, name, kind, viewport_w, viewport_h, data_json)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name       = excluded.name,
  kind       = excluded.kind,
  viewport_w = excluded.viewport_w,
  viewport_h = excluded.viewport_h,
  data_json  = excluded.data_json,
  updated_at = CURRENT_TIMESTAMP
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
