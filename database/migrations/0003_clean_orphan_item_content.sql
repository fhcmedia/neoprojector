-- +goose Up
DELETE FROM service_item_bible
WHERE item_id NOT IN (SELECT id FROM service_item);

DELETE FROM service_item_song
WHERE item_id NOT IN (SELECT id FROM service_item);

DELETE FROM service_item_media
WHERE item_id NOT IN (SELECT id FROM service_item);

-- +goose Down
-- noop; orphans are non-recoverable
