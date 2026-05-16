-- name: CreateServiceSection :one
INSERT INTO service_section (service_id, name, position)
VALUES (?, ?, ?)
RETURNING *;

-- name: CreateServiceSectionAppend :one
INSERT INTO service_section (service_id, name, position, color)
VALUES (
  sqlc.arg(service_id),
  sqlc.arg(name),
  COALESCE((SELECT MAX(position) + 1 FROM service_section WHERE service_section.service_id = sqlc.arg(service_id)), 0),
  sqlc.arg(palette)
)
RETURNING *;

-- name: CountServiceSections :one
SELECT COUNT(*) AS n FROM service_section WHERE service_id = ?;

-- name: RenameServiceSection :one
UPDATE service_section
SET name = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: SetServiceSectionPosition :exec
UPDATE service_section
SET position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: SetServiceSectionColor :one
UPDATE service_section
SET color = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: ServiceSectionByID :one
SELECT * FROM service_section WHERE id = ?;

-- name: ListServiceSections :many
SELECT * FROM service_section
WHERE service_id = ?
ORDER BY position;

-- name: NextServiceSectionPosition :one
SELECT COALESCE(MAX(position) + 1, 0) AS next_position
FROM service_section
WHERE service_id = ?;

-- name: UpdateServiceSection :one
UPDATE service_section
SET name = ?, position = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
RETURNING *;

-- name: DeleteServiceSection :exec
DELETE FROM service_section WHERE id = ?;
