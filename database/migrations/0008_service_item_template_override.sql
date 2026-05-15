-- +goose Up
ALTER TABLE service_item ADD COLUMN template_override_json TEXT DEFAULT NULL;

-- +goose Down
ALTER TABLE service_item DROP COLUMN template_override_json;
