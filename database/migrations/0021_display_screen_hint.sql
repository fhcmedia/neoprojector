-- +goose Up
-- On Windows a screen id is the monitor's HMONITOR handle, which changes
-- whenever monitors are replugged, the PC sleeps or reboots — so a stored
-- screen_id alone goes stale and the display reads as "disconnected".
-- screen_hint keeps a JSON fingerprint of the bound monitor (device name,
-- position, size, primary) captured while it was connected, so the
-- displays service can re-find the same physical monitor and rewrite
-- screen_id to its new id.
ALTER TABLE display ADD COLUMN screen_hint TEXT;

-- +goose Down
ALTER TABLE display DROP COLUMN screen_hint;
