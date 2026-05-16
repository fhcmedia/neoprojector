package schedule

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"neoprojector/database"
)

type Service struct {
	db *sql.DB
	q  *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{db: db, q: database.New(db)}
}

func (*Service) ServiceName() string { return "schedule" }

// --- services ---

// CreateService creates a service. Empty name falls back to today's date,
// and " (n)" is appended on UNIQUE collisions.
func (s *Service) CreateService(ctx context.Context, name string) (database.Service, error) {
	if name == "" {
		name = time.Now().Format("01-02-06")
	}
	base := name
	for i := 2; i < 100; i++ {
		out, err := s.q.CreateService(ctx, name)
		if err == nil {
			return out, nil
		}
		if !strings.Contains(err.Error(), "UNIQUE") {
			return database.Service{}, err
		}
		name = fmt.Sprintf("%s (%d)", base, i)
	}
	return database.Service{}, fmt.Errorf("create service: name %q exhausted suffixes", base)
}

func (s *Service) ListServices(ctx context.Context) ([]database.Service, error) {
	return s.q.ListServices(ctx)
}

func (s *Service) ServiceByID(ctx context.Context, id int64) (database.Service, error) {
	return s.q.ServiceByID(ctx, id)
}

func (s *Service) RenameService(ctx context.Context, id int64, name string) (database.Service, error) {
	return s.q.RenameService(ctx, database.RenameServiceParams{ID: id, Name: name})
}

func (s *Service) DeleteService(ctx context.Context, id int64) error {
	return s.q.DeleteService(ctx, id)
}

// --- sections ---

func (s *Service) ListSections(ctx context.Context, serviceID int64) ([]database.ServiceSection, error) {
	return s.q.ListServiceSections(ctx, serviceID)
}

func (s *Service) CreateSection(ctx context.Context, serviceID int64, name string) (database.ServiceSection, error) {
	if name == "" {
		name = "Untitled section"
	}
	// Auto-assign a stable palette color based on the current section
	// count. Colors persist with the row so deleting a section in the
	// middle never reshuffles siblings.
	count, err := s.q.CountServiceSections(ctx, serviceID)
	if err != nil {
		return database.ServiceSection{}, err
	}
	color := fmt.Sprintf("chart-%d", (count%5)+1)
	return s.q.CreateServiceSectionAppend(ctx, database.CreateServiceSectionAppendParams{
		ServiceID: serviceID,
		Name:      name,
		Palette:   color,
	})
}

func (s *Service) RenameSection(ctx context.Context, id int64, name string) (database.ServiceSection, error) {
	return s.q.RenameServiceSection(ctx, database.RenameServiceSectionParams{ID: id, Name: name})
}

func (s *Service) DeleteSection(ctx context.Context, id int64) error {
	return s.q.DeleteServiceSection(ctx, id)
}

// SetSectionColor stores a color key (e.g. "red", "blue", or "" for none).
// The frontend maps this key to concrete styling.
func (s *Service) SetSectionColor(ctx context.Context, id int64, color string) (database.ServiceSection, error) {
	return s.q.SetServiceSectionColor(ctx, database.SetServiceSectionColorParams{
		ID:    id,
		Color: color,
	})
}

// ReorderSections sets section positions to match the given id order.
func (s *Service) ReorderSections(ctx context.Context, ids []int64) error {
	return s.inTx(ctx, func(q *database.Queries) error {
		for i, id := range ids {
			if err := q.SetServiceSectionPosition(ctx, database.SetServiceSectionPositionParams{
				ID:       id,
				Position: int64(i),
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// --- items ---

func (s *Service) ListItems(ctx context.Context, sectionID int64) ([]database.ListServiceItemsWithContentRow, error) {
	return s.q.ListServiceItemsWithContent(ctx, sectionID)
}

func (s *Service) AddSongItem(ctx context.Context, sectionID, songID int64) (database.ServiceItem, error) {
	var out database.ServiceItem
	err := s.inTx(ctx, func(q *database.Queries) error {
		item, err := q.CreateServiceItemAppend(ctx, sectionID)
		if err != nil {
			return err
		}
		if _, err := q.CreateServiceItemSong(ctx, database.CreateServiceItemSongParams{
			ItemID: item.ID,
			SongID: songID,
		}); err != nil {
			return err
		}
		out = item
		return nil
	})
	return out, err
}

type BibleRef struct {
	Book       string `json:"book"`
	Chapter    int64  `json:"chapter"`
	VerseStart int64  `json:"verse_start"`
	VerseEnd   int64  `json:"verse_end"`
}

func (s *Service) AddBibleItem(ctx context.Context, sectionID int64, ref BibleRef) (database.ServiceItem, error) {
	var out database.ServiceItem
	err := s.inTx(ctx, func(q *database.Queries) error {
		item, err := q.CreateServiceItemAppend(ctx, sectionID)
		if err != nil {
			return err
		}
		if _, err := q.CreateServiceItemBible(ctx, database.CreateServiceItemBibleParams{
			ItemID:     item.ID,
			Book:       ref.Book,
			Chapter:    ref.Chapter,
			VerseStart: ref.VerseStart,
			VerseEnd:   ref.VerseEnd,
		}); err != nil {
			return err
		}
		out = item
		return nil
	})
	return out, err
}

// UpdateBibleItem rewrites the bible reference attached to an existing item.
func (s *Service) UpdateBibleItem(ctx context.Context, itemID int64, ref BibleRef) error {
	_, err := s.q.UpdateServiceItemBible(ctx, database.UpdateServiceItemBibleParams{
		ItemID:     itemID,
		Book:       ref.Book,
		Chapter:    ref.Chapter,
		VerseStart: ref.VerseStart,
		VerseEnd:   ref.VerseEnd,
	})
	return err
}

func (s *Service) AddMediaItem(ctx context.Context, sectionID, mediaID int64) (database.ServiceItem, error) {
	var out database.ServiceItem
	err := s.inTx(ctx, func(q *database.Queries) error {
		item, err := q.CreateServiceItemAppend(ctx, sectionID)
		if err != nil {
			return err
		}
		if _, err := q.CreateServiceItemMedia(ctx, database.CreateServiceItemMediaParams{
			ItemID:  item.ID,
			MediaID: mediaID,
		}); err != nil {
			return err
		}
		out = item
		return nil
	})
	return out, err
}

// OverlayItemSpec carries the snapshot the frontend builds from a
// library overlay (or a fresh registry default) when the operator
// adds the overlay to a service section. config_json/layouts_json/
// rules_json are opaque to Go — the frontend's widget registry +
// rule module are the only things that interpret them.
type OverlayItemSpec struct {
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	ConfigJSON  string `json:"config_json"`
	LayoutsJSON string `json:"layouts_json"`
	RulesJSON   string `json:"rules_json"`
}

func (s *Service) AddOverlayItem(ctx context.Context, sectionID int64, spec OverlayItemSpec) (database.ServiceItem, error) {
	var out database.ServiceItem
	err := s.inTx(ctx, func(q *database.Queries) error {
		item, err := q.CreateServiceItemAppend(ctx, sectionID)
		if err != nil {
			return err
		}
		rules := spec.RulesJSON
		if rules == "" {
			rules = "{}"
		}
		if _, err := q.CreateServiceItemOverlay(ctx, database.CreateServiceItemOverlayParams{
			ItemID:      item.ID,
			OverlayKind: spec.Kind,
			OverlayName: spec.Name,
			ConfigJson:  spec.ConfigJSON,
			LayoutsJson: spec.LayoutsJSON,
			RulesJson:   rules,
		}); err != nil {
			return err
		}
		out = item
		return nil
	})
	return out, err
}

// UpdateOverlayItemConfig replaces just the function-config portion
// of an overlay schedule item (e.g. operator tweaks the countdown
// duration or the name card text in-place). Layouts stay snapshotted
// from add time.
func (s *Service) UpdateOverlayItemConfig(ctx context.Context, itemID int64, configJSON string) error {
	_, err := s.q.UpdateServiceItemOverlayConfig(ctx, database.UpdateServiceItemOverlayConfigParams{
		ItemID:     itemID,
		ConfigJson: configJSON,
	})
	return err
}

func (s *Service) DeleteItem(ctx context.Context, id int64) error {
	return s.q.DeleteServiceItem(ctx, id)
}

// MoveItem moves an item to a different section (or just repositions within
// the same section). Used by cross-section drag-and-drop.
func (s *Service) MoveItem(ctx context.Context, itemID, targetSectionID, position int64) error {
	_, err := s.q.MoveServiceItem(ctx, database.MoveServiceItemParams{
		ID:        itemID,
		SectionID: targetSectionID,
		Position:  position,
	})
	return err
}

func (s *Service) ReorderItems(ctx context.Context, ids []int64) error {
	return s.inTx(ctx, func(q *database.Queries) error {
		for i, id := range ids {
			if err := q.SetServiceItemPosition(ctx, database.SetServiceItemPositionParams{
				ID:       id,
				Position: int64(i),
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// inTx runs fn inside a transaction. Rolls back on error.
func (s *Service) inTx(ctx context.Context, fn func(*database.Queries) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(s.q.WithTx(tx)); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
