-- name: CreateTemplate :one
INSERT INTO template (name, kind, viewport_w, viewport_h, data_json, is_default)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: TemplateByID :one
SELECT * FROM template WHERE id = ?;

-- name: TemplateByName :one
SELECT * FROM template WHERE name = ? COLLATE NOCASE;

-- name: ListTemplates :many
SELECT * FROM template ORDER BY is_default DESC, name COLLATE NOCASE ASC;

-- name: UpdateTemplate :one
-- Defaults are immutable: the WHERE clause silently rejects updates to
-- is_default rows. The service layer also guards against this, so this
-- is belt-and-suspenders.
UPDATE template
SET name = ?,
    kind = ?,
    viewport_w = ?,
    viewport_h = ?,
    data_json = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ? AND is_default = 0
RETURNING *;

-- name: DeleteTemplate :exec
-- Defaults can't be deleted; same belt-and-suspenders policy.
DELETE FROM template WHERE id = ? AND is_default = 0;

-- name: DuplicateTemplate :one
-- Creates an editable copy. The copy keeps the same kind, viewport, and
-- body but gets a fresh name and is_default = 0.
INSERT INTO template (name, kind, viewport_w, viewport_h, data_json, is_default)
SELECT ?, kind, viewport_w, viewport_h, data_json, 0
FROM template
WHERE id = ?
RETURNING *;
