-- +goose Up
-- Adds external-library metadata to song. All four columns are nullable and
-- default to NULL — songs created in the NP editor leave them blank; the
-- ProPresenter / EasyWorship / OpenLP importers fill them on the way in.
--
-- Column choice matches what those formats actually expose:
--   author        — CCLI artist credits / songwriter line
--   copyright     — CCLI copyright year, sometimes a full notice
--   publisher     — CCLI publisher / administrator
--   ccli_number   — CCLI song number (stored as TEXT — some libraries store
--                   vendor numbers or leading zeros that we'd lose as INTEGER)
ALTER TABLE song ADD COLUMN author TEXT;
ALTER TABLE song ADD COLUMN copyright TEXT;
ALTER TABLE song ADD COLUMN publisher TEXT;
ALTER TABLE song ADD COLUMN ccli_number TEXT;

-- +goose Down
-- SQLite DROP COLUMN was added in 3.35; if the runtime is older the down
-- migration will fail. That's acceptable — these columns are additive and
-- a roll-forward strategy is fine for production rollbacks.
ALTER TABLE song DROP COLUMN author;
ALTER TABLE song DROP COLUMN copyright;
ALTER TABLE song DROP COLUMN publisher;
ALTER TABLE song DROP COLUMN ccli_number;
