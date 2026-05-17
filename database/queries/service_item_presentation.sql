-- name: CreateServiceItemPresentation :one
INSERT INTO service_item_presentation (item_id, presentation_id)
VALUES (?, ?)
RETURNING *;

-- name: ServiceItemPresentationByItemID :one
SELECT * FROM service_item_presentation WHERE item_id = ?;

-- name: DeleteServiceItemPresentation :exec
DELETE FROM service_item_presentation WHERE item_id = ?;
