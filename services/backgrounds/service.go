package backgrounds

import (
	"context"
	"database/sql"
	"fmt"

	"neoprojector/database"
)

// Backgrounds are first-class documents: an engine name plus an opaque
// config blob the frontend interprets (gradflow shader settings today).
// Seed defaults live in the frontend with negative ids and never touch
// the DB — except when a user edits one, which SaveWithID persists as
// a row reusing the seed's negative id (shadowing it, same convention
// as templates). Restore = DeleteBackground on the negative id.
type Service struct {
	db *sql.DB
	q  *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{db: db, q: database.New(db)}
}

func (*Service) ServiceName() string { return "backgrounds" }

func (s *Service) ListBackgrounds(ctx context.Context) ([]database.Background, error) {
	return s.q.ListBackgrounds(ctx)
}

func (s *Service) BackgroundByID(ctx context.Context, id int64) (database.Background, error) {
	return s.q.BackgroundByID(ctx, id)
}

func (s *Service) CreateBackground(ctx context.Context, name, engine, configJSON string) (database.Background, error) {
	if name == "" {
		name = "Untitled background"
	}
	return s.q.CreateBackground(ctx, database.CreateBackgroundParams{
		Name:       name,
		Engine:     engineOrDefault(engine),
		ConfigJson: jsonOrEmpty(configJSON),
	})
}

// SaveWithID upserts a row at an explicit id — the shadow-a-seed path.
// Editing a frontend default persists its working copy under the
// seed's negative id so every consumer (schedule assignments included)
// keeps pointing at the same id.
func (s *Service) SaveWithID(ctx context.Context, id int64, name, engine, configJSON string) (database.Background, error) {
	// 0 falls through both id conventions (negative = seed, positive =
	// user row) — a row stored there would be invisible to the
	// frontend's merge. Reject rather than corrupt.
	if id == 0 {
		return database.Background{}, fmt.Errorf("SaveWithID: id 0 is reserved")
	}
	if name == "" {
		name = "Untitled background"
	}
	return s.q.CreateBackgroundWithID(ctx, database.CreateBackgroundWithIDParams{
		ID:         id,
		Name:       name,
		Engine:     engineOrDefault(engine),
		ConfigJson: jsonOrEmpty(configJSON),
	})
}

func (s *Service) UpdateBackground(ctx context.Context, id int64, name, engine, configJSON string) (database.Background, error) {
	return s.q.UpdateBackground(ctx, database.UpdateBackgroundParams{
		Name:       name,
		Engine:     engineOrDefault(engine),
		ConfigJson: jsonOrEmpty(configJSON),
		ID:         id,
	})
}

func (s *Service) DeleteBackground(ctx context.Context, id int64) error {
	return s.q.DeleteBackground(ctx, id)
}

func engineOrDefault(engine string) string {
	if engine == "" {
		return "gradflow"
	}
	return engine
}

func jsonOrEmpty(v string) string {
	if v == "" {
		return "{}"
	}
	return v
}
