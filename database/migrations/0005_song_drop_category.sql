-- +goose Up
ALTER TABLE song DROP COLUMN category;

-- +goose Down
ALTER TABLE song ADD COLUMN category TEXT NOT NULL DEFAULT '';
