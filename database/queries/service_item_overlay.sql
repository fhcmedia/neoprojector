-- name: CreateServiceItemOverlay :one
INSERT INTO service_item_overlay (item_id, overlay_kind, overlay_name, config_json, layouts_json, rules_json)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: ServiceItemOverlayByItemID :one
SELECT * FROM service_item_overlay WHERE item_id = ?;

-- name: UpdateServiceItemOverlayConfig :one
UPDATE service_item_overlay
SET config_json = ?, updated_at = CURRENT_TIMESTAMP
WHERE item_id = ?
RETURNING *;

-- name: DeleteServiceItemOverlay :exec
DELETE FROM service_item_overlay WHERE item_id = ?;
