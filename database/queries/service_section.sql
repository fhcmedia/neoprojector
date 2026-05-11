-- name: CreateServiceSection :one
INSERT INTO service_section (service_id, name, position)
VALUES (?, ?, ?)
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
