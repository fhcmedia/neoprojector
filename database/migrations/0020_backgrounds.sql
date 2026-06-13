-- +goose Up
-- Backgrounds are first-class documents (animated shader configs for
-- now; engine field leaves room for other renderers). Negative ids
-- never live here as seeds — frontend seed defaults resolve client-
-- side; a row WITH a negative id is a user-edited shadow of that seed
-- (same convention as templates).
CREATE TABLE background (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  engine      TEXT NOT NULL DEFAULT 'gradflow',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Background assignment, nearest wins: item -> section -> service ->
-- none. No FK: negative ids reference frontend seeds (the template-
-- binding convention), and a deleted row should resolve to "inherit",
-- not block deletion.
ALTER TABLE service         ADD COLUMN background_id INTEGER;
ALTER TABLE service_section ADD COLUMN background_id INTEGER;
ALTER TABLE service_item    ADD COLUMN background_id INTEGER;

-- +goose Down
ALTER TABLE service_item    DROP COLUMN background_id;
ALTER TABLE service_section DROP COLUMN background_id;
ALTER TABLE service         DROP COLUMN background_id;
DROP TABLE background;
