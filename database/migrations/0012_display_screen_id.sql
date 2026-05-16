-- +goose Up
-- screen_id binds a configured display to a physical monitor by the
-- OS-provided stable identifier (CGDirectDisplayID on macOS, EDID-
-- derived id on Linux/Windows via Wails). NULL = unbound: the display
-- exists in settings but Go Live won't open a window for it until the
-- user picks a monitor. The string lives untyped here because the OS
-- representation is opaque and we don't query against it.
ALTER TABLE display ADD COLUMN screen_id TEXT;

-- +goose Down
ALTER TABLE display DROP COLUMN screen_id;
