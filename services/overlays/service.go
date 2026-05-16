package overlays

import (
	"context"
	"database/sql"

	"neoprojector/database"
)

// An overlay is a single widget instance (countdown, clock, …) the
// operator can flip on/off at a point in the service. Each overlay
// owns a default layout plus optional per-display layout overrides,
// all stored as opaque JSON managed by the frontend.
type Service struct {
	db *sql.DB
	q  *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{db: db, q: database.New(db)}
}

func (*Service) ServiceName() string { return "overlays" }

func (s *Service) ListOverlays(ctx context.Context) ([]database.Overlay, error) {
	return s.q.ListOverlays(ctx)
}

func (s *Service) OverlayByID(ctx context.Context, id int64) (database.Overlay, error) {
	return s.q.OverlayByID(ctx, id)
}

// CreateOverlay accepts the full spec from the caller because each
// widget kind ships its own sensible defaults; SQL stays kind-
// agnostic. layoutsJSON is the per-display layout map (with
// "default" fallback). rulesJSON is the behavior blob — currently
// just {"cover_slide": bool}, but the column is JSON so we can
// extend without further migrations.
func (s *Service) CreateOverlay(
	ctx context.Context,
	name, kind, configJSON, layoutsJSON, rulesJSON string,
) (database.Overlay, error) {
	if name == "" {
		name = "Untitled overlay"
	}
	if configJSON == "" {
		configJSON = "{}"
	}
	if layoutsJSON == "" {
		layoutsJSON = "{}"
	}
	if rulesJSON == "" {
		rulesJSON = "{}"
	}
	return s.q.CreateOverlayAppend(ctx, database.CreateOverlayAppendParams{
		Name:        name,
		Kind:        kind,
		ConfigJson:  configJSON,
		LayoutsJson: layoutsJSON,
		RulesJson:   rulesJSON,
	})
}

func (s *Service) RenameOverlay(ctx context.Context, id int64, name string) (database.Overlay, error) {
	return s.q.RenameOverlay(ctx, database.RenameOverlayParams{ID: id, Name: name})
}

// SetConfig replaces the function-specific config wholesale.
func (s *Service) SetConfig(ctx context.Context, id int64, configJSON string) (database.Overlay, error) {
	return s.q.SetOverlayConfig(ctx, database.SetOverlayConfigParams{ID: id, ConfigJson: configJSON})
}

// SetLayouts replaces the per-display layouts wholesale.
func (s *Service) SetLayouts(ctx context.Context, id int64, layoutsJSON string) (database.Overlay, error) {
	return s.q.SetOverlayLayouts(ctx, database.SetOverlayLayoutsParams{ID: id, LayoutsJson: layoutsJSON})
}

// SetRules replaces the behavior rules blob.
func (s *Service) SetRules(ctx context.Context, id int64, rulesJSON string) (database.Overlay, error) {
	return s.q.SetOverlayRules(ctx, database.SetOverlayRulesParams{ID: id, RulesJson: rulesJSON})
}

// ReorderOverlays writes position values to match the given id order.
// Single transaction so readers never see a half-applied order.
func (s *Service) ReorderOverlays(ctx context.Context, ids []int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	q := s.q.WithTx(tx)
	for i, id := range ids {
		if err := q.SetOverlayPosition(ctx, database.SetOverlayPositionParams{
			ID:       id,
			Position: int64(i),
		}); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (s *Service) DeleteOverlay(ctx context.Context, id int64) error {
	return s.q.DeleteOverlay(ctx, id)
}
