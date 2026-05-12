-- +goose Up
ALTER TABLE service_item_bible DROP COLUMN translation;

-- +goose Down
ALTER TABLE service_item_bible ADD COLUMN translation TEXT NOT NULL DEFAULT 'KJV' REFERENCES bible(translation);
