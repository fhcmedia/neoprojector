// Package presentations exposes CRUD over the presentation +
// presentation_slide tables. A presentation is the operator's
// "slideshow" primitive — a named, ordered list of media references
// (images, videos, etc.) the operator can advance through like
// bible verses. The slide list is independent of media itself, so
// the same media can appear in multiple presentations (or even
// twice in the same one) without copying bytes.
package presentations

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"neoprojector/database"
)

type Service struct {
	db *sql.DB
	q  *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{db: db, q: database.New(db)}
}

func (*Service) ServiceName() string { return "presentations" }

// inTx runs fn inside a transaction. Rollback fires after commit too
// (no-op once committed), so the connection always returns to the
// pool even if commit panics.
func (s *Service) inTx(ctx context.Context, fn func(*database.Queries) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(s.q.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit()
}

// --- CRUD on presentations themselves ---

func (s *Service) ListPresentations(ctx context.Context) ([]database.Presentation, error) {
	return s.q.ListPresentations(ctx)
}

func (s *Service) PresentationByID(ctx context.Context, id int64) (database.Presentation, error) {
	return s.q.PresentationByID(ctx, id)
}

// CreatePresentation makes an empty presentation. Empty names fall
// back to "Untitled presentation"; the frontend can rename in-place
// once the editor opens.
func (s *Service) CreatePresentation(ctx context.Context, name string) (database.Presentation, error) {
	if strings.TrimSpace(name) == "" {
		name = "Untitled presentation"
	}
	return s.q.CreatePresentation(ctx, name)
}

func (s *Service) RenamePresentation(ctx context.Context, id int64, name string) (database.Presentation, error) {
	if strings.TrimSpace(name) == "" {
		return database.Presentation{}, fmt.Errorf("presentation name cannot be empty")
	}
	return s.q.RenamePresentation(ctx, database.RenamePresentationParams{
		ID:   id,
		Name: name,
	})
}

func (s *Service) DeletePresentation(ctx context.Context, id int64) error {
	return s.q.DeletePresentation(ctx, id)
}

// PlaybackSettings carries the four per-presentation runtime options
// the operator can configure in the editor: auto-advance on/off, the
// dwell time between auto-advances, and the slide-to-slide
// transition + its duration. Clamped to sane bounds in the service
// so a typo in the editor can't paralyse the show pane (e.g. a 0ms
// interval would spin the auto-advance timer forever).
type PlaybackSettings struct {
	Loop                 bool   `json:"loop"`
	IntervalMs           int64  `json:"interval_ms"`
	TransitionKind       string `json:"transition_kind"`
	TransitionDurationMs int64  `json:"transition_duration_ms"`
}

// Min/max guardrails. 250ms interval is the floor — anything faster
// is unreadable on a real display. 1 hour ceiling is more than any
// church announcement loop should ever need. Transition duration
// caps lower so a typo can't stall a slide for half an hour.
const (
	minIntervalMs           = 250
	maxIntervalMs           = 60 * 60 * 1000
	maxTransitionDurationMs = 5_000
)

// validTransitionKinds mirrors the values the renderer understands.
// Anything else falls back to "fade" so a corrupt row never breaks
// the live broadcast.
var validTransitionKinds = map[string]bool{
	"none":        true,
	"fade":        true,
	"slide-up":    true,
	"slide-down":  true,
	"slide-left":  true,
	"slide-right": true,
	"scale":       true,
	"blur":        true,
}

func (s *Service) UpdatePlayback(ctx context.Context, id int64, settings PlaybackSettings) (database.Presentation, error) {
	if settings.IntervalMs < minIntervalMs {
		settings.IntervalMs = minIntervalMs
	}
	if settings.IntervalMs > maxIntervalMs {
		settings.IntervalMs = maxIntervalMs
	}
	if settings.TransitionDurationMs < 0 {
		settings.TransitionDurationMs = 0
	}
	if settings.TransitionDurationMs > maxTransitionDurationMs {
		settings.TransitionDurationMs = maxTransitionDurationMs
	}
	if !validTransitionKinds[settings.TransitionKind] {
		settings.TransitionKind = "fade"
	}
	loop := int64(0)
	if settings.Loop {
		loop = 1
	}
	return s.q.UpdatePresentationPlayback(ctx, database.UpdatePresentationPlaybackParams{
		ID:                   id,
		Loop:                 loop,
		IntervalMs:           settings.IntervalMs,
		TransitionKind:       settings.TransitionKind,
		TransitionDurationMs: settings.TransitionDurationMs,
	})
}

// --- Slides ---

// SlideRow is what the frontend renders: slide metadata plus enough
// media info to draw a thumbnail without a second IPC round-trip per
// slide. media_title/media_type are joined in the SQL query.
type SlideRow = database.ListPresentationSlidesRow

func (s *Service) ListSlides(ctx context.Context, presentationID int64) ([]SlideRow, error) {
	return s.q.ListPresentationSlides(ctx, presentationID)
}

// AddSlide appends a media reference at the end of the presentation.
// Same media id can be appended multiple times — the operator can
// repeat slides intentionally (e.g. a brand image as both intro and
// outro).
func (s *Service) AddSlide(ctx context.Context, presentationID, mediaID int64) (database.PresentationSlide, error) {
	return s.q.CreatePresentationSlideAppend(ctx, database.CreatePresentationSlideAppendParams{
		PresentationID: presentationID,
		MediaID:        mediaID,
	})
}

func (s *Service) DeleteSlide(ctx context.Context, slideID int64) error {
	return s.q.DeletePresentationSlide(ctx, slideID)
}

// ReorderSlides writes positions to match the given id order in one
// transaction so an intermediate read never sees a half-applied
// order. The caller passes ALL slide ids for the presentation; any
// id missing from the list keeps its old position (we don't try to
// be clever about partial reorders).
func (s *Service) ReorderSlides(ctx context.Context, ids []int64) error {
	return s.inTx(ctx, func(q *database.Queries) error {
		for i, id := range ids {
			if err := q.SetPresentationSlidePosition(ctx, database.SetPresentationSlidePositionParams{
				ID:       id,
				Position: int64(i),
			}); err != nil {
				return err
			}
		}
		return nil
	})
}
