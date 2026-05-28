-- name: CreateServiceItemDeck :one
INSERT INTO service_item_deck (item_id, deck_id)
VALUES (?, ?)
RETURNING *;

-- name: ServiceItemDeckByItemID :one
SELECT * FROM service_item_deck WHERE item_id = ?;

-- name: DeleteServiceItemDeck :exec
DELETE FROM service_item_deck WHERE item_id = ?;
