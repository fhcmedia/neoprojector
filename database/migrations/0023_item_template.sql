-- +goose Up
-- A song or Bible schedule item can use its own template instead of the
-- displays' default song/Bible template (drop a template from the
-- library onto the item). NULL = use the display's template. No FK:
-- built-in templates have negative ids that aren't rows.
ALTER TABLE service_item ADD COLUMN template_id INTEGER;

-- +goose Down
ALTER TABLE service_item DROP COLUMN template_id;
