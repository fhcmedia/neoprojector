-- +goose Up
-- Templates are layout-only descriptors. The body lives as JSON in
-- `data_json` (boxes, slot bindings, fonts, positions, optional per-slot
-- defaults). The renderer parses this on-demand; SQL never inspects it.
--
-- `kind` is just a hint for the UI (which seed template to use, where it
-- naturally belongs in the picker). It is NOT a render-time constraint —
-- any template can render any item kind that fills the matching slots.
-- is_default rows are seeded reference templates. They are intentionally
-- read-only: UPDATE and DELETE skip them. To customize one, the user
-- duplicates it (DuplicateTemplate) — the copy has is_default = 0 and is
-- freely editable. This keeps the shipped defaults pristine so the user
-- always has a known-good starting point.
CREATE TABLE IF NOT EXISTS template (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'general',
  viewport_w  INTEGER NOT NULL DEFAULT 1920,
  viewport_h  INTEGER NOT NULL DEFAULT 1080,
  data_json   TEXT NOT NULL DEFAULT '{}',
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS template_name_unique
  ON template(name COLLATE NOCASE);

-- +goose Down
DROP INDEX IF EXISTS template_name_unique;
DROP TABLE IF EXISTS template;
