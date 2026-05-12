-- +goose Up
ALTER TABLE service_section ADD COLUMN color TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE service_section DROP COLUMN color;
