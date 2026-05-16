-- +goose Up
-- Defaults now live in the frontend (features/templates/defaults.ts).
-- Any previously seeded default rows in user DBs become orphaned —
-- drop them. Then drop the is_default column.
--
-- User-customized templates (those created via Duplicate, which always
-- wrote is_default = 0) are kept intact.
DELETE FROM template WHERE is_default = 1;
ALTER TABLE template DROP COLUMN is_default;

-- +goose Down
ALTER TABLE template ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
