-- name: ListOverlays :many
SELECT * FROM overlay ORDER BY position, id;

-- name: OverlayByID :one
SELECT * FROM overlay WHERE id = ?;

-- name: CreateOverlayAppend :one
-- Appends a new overlay at the end of the list. `kind` and starting
-- config + layouts + rules are supplied by the caller because each
-- widget kind ships its own sensible defaults; SQL stays kind-
-- agnostic.
INSERT INTO overlay (name, kind, config_json, layouts_json, rules_json, position)
VALUES (
  sqlc.arg(name),
  sqlc.arg(kind),
  sqlc.arg(config_json),
  sqlc.arg(layouts_json),
  sqlc.arg(rules_json),
  COALESCE((SELECT MAX(position) + 1 FROM overlay), 0)
)
RETURNING *;

-- name: RenameOverlay :one
UPDATE overlay
SET name = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetOverlayConfig :one
UPDATE overlay
SET config_json = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetOverlayLayouts :one
UPDATE overlay
SET layouts_json = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetOverlayRules :one
UPDATE overlay
SET rules_json = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SaveOverlayWithID :one
-- Upsert keyed on id: editing a seed default persists a row reusing
-- the seed's negative id (shadowing it); restore deletes the row and
-- the frontend seed shows through again.
INSERT INTO overlay (id, name, kind, config_json, layouts_json, rules_json, position)
VALUES (
  sqlc.arg(id),
  sqlc.arg(name),
  sqlc.arg(kind),
  sqlc.arg(config_json),
  sqlc.arg(layouts_json),
  sqlc.arg(rules_json),
  COALESCE((SELECT MAX(position) + 1 FROM overlay), 0)
)
ON CONFLICT(id) DO UPDATE SET
  name         = excluded.name,
  kind         = excluded.kind,
  config_json  = excluded.config_json,
  layouts_json = excluded.layouts_json,
  rules_json   = excluded.rules_json,
  updated_at   = CURRENT_TIMESTAMP
RETURNING *;

-- name: SetOverlayPosition :exec
UPDATE overlay
SET position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: DeleteOverlay :exec
DELETE FROM overlay WHERE id = ?;
