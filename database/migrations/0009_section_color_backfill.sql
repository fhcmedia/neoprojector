-- +goose Up
-- Backfill stable colors for every existing section with an empty color.
-- Position-based at the moment of migration, then frozen — subsequent
-- deletes never shift sibling colors. New sections get a color assigned
-- in CreateServiceSectionAppend, so this only needs to run once.
UPDATE service_section
SET color = 'chart-' || (((
  SELECT COUNT(*) FROM service_section AS s2
  WHERE s2.service_id = service_section.service_id
    AND s2.position < service_section.position
) % 5) + 1)
WHERE color = '';

-- +goose Down
-- No-op: dropping the backfill would just blank out colors that the user
-- may have since explicitly customized.
