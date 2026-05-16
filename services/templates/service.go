package templates

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"neoprojector/database"
)

type Service struct {
	q *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{q: database.New(db)}
}

func (*Service) ServiceName() string { return "templates" }

// All templates returned by this service are user-owned. Default
// reference templates live in the frontend constants
// (features/templates/defaults.ts) and never touch the DB — opening
// one in the editor reads from those constants, and "Duplicate to
// edit" calls CreateTemplate with the default's body to materialize a
// real editable row.

func (s *Service) ListTemplates(ctx context.Context) ([]database.Template, error) {
	return s.q.ListTemplates(ctx)
}

func (s *Service) TemplateByID(ctx context.Context, id int64) (database.Template, error) {
	return s.q.TemplateByID(ctx, id)
}

func (s *Service) CreateTemplate(ctx context.Context, name, kind string, viewportW, viewportH int64, dataJSON string) (database.Template, error) {
	if name == "" {
		name = "Untitled template"
	}
	return s.q.CreateTemplate(ctx, database.CreateTemplateParams{
		Name:      uniqueName(ctx, s.q, name),
		Kind:      kindOrDefault(kind),
		ViewportW: viewportOrDefault(viewportW, 1920),
		ViewportH: viewportOrDefault(viewportH, 1080),
		DataJson:  jsonOrEmpty(dataJSON),
	})
}

func (s *Service) UpdateTemplate(ctx context.Context, id int64, name, kind string, viewportW, viewportH int64, dataJSON string) (database.Template, error) {
	existing, err := s.q.TemplateByID(ctx, id)
	if err != nil {
		return database.Template{}, err
	}
	if name == "" {
		name = existing.Name
	}
	return s.q.UpdateTemplate(ctx, database.UpdateTemplateParams{
		ID:        id,
		Name:      name,
		Kind:      kindOrDefault(kind),
		ViewportW: viewportOrDefault(viewportW, existing.ViewportW),
		ViewportH: viewportOrDefault(viewportH, existing.ViewportH),
		DataJson:  jsonOrEmpty(dataJSON),
	})
}

func (s *Service) DeleteTemplate(ctx context.Context, id int64) error {
	return s.q.DeleteTemplate(ctx, id)
}

func (s *Service) DuplicateTemplate(ctx context.Context, id int64) (database.Template, error) {
	existing, err := s.q.TemplateByID(ctx, id)
	if err != nil {
		return database.Template{}, err
	}
	base := strings.TrimSuffix(existing.Name, " copy")
	name := uniqueName(ctx, s.q, base+" copy")
	return s.q.DuplicateTemplate(ctx, database.DuplicateTemplateParams{
		Name: name,
		ID:   id,
	})
}

// uniqueName appends " (n)" to the requested name until the unique index
// on template.name accepts it. Bounded loop so a misbehaving DB can't
// spin forever.
func uniqueName(ctx context.Context, q *database.Queries, want string) string {
	if _, err := q.TemplateByName(ctx, want); errors.Is(err, sql.ErrNoRows) {
		return want
	}
	for i := 2; i < 1000; i++ {
		candidate := fmt.Sprintf("%s (%d)", want, i)
		if _, err := q.TemplateByName(ctx, candidate); errors.Is(err, sql.ErrNoRows) {
			return candidate
		}
	}
	return want
}

func kindOrDefault(k string) string {
	if k == "" {
		return "general"
	}
	return k
}

func viewportOrDefault(v, fallback int64) int64 {
	if v <= 0 {
		return fallback
	}
	return v
}

func jsonOrEmpty(s string) string {
	if strings.TrimSpace(s) == "" {
		return "{}"
	}
	return s
}
