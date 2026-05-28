// Package decks exposes CRUD over the deck / deck_slide / deck_block
// tables. A deck is the editable, rich-slideshow primitive: each
// slide carries a background, speaker notes, and an ordered list of
// positioned blocks (text, image, shape, table). Decks are distinct
// from `presentation` (which is a flat ordered list of media refs);
// they are the destination for File → Import (PPTX/DOCX/PDF/ODP/ODT)
// so the operator can edit imported content in-place.
//
// Coordinate system: block x/y/w/h are floats in [0, 1] normalised
// against the parent deck's canvas (width × height stored on `deck`).
// This keeps the same deck render-sharp on 720p preview and 4K live
// output. All persistence happens through sqlc-generated queries;
// SQL never inspects JSON payload columns.
package decks

import (
	"context"
	"database/sql"
	"encoding/json"
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

func (*Service) ServiceName() string { return "decks" }

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

// --- Deck CRUD ---

func (s *Service) ListDecks(ctx context.Context) ([]database.Deck, error) {
	return s.q.ListDecks(ctx)
}

func (s *Service) DeckByID(ctx context.Context, id int64) (database.Deck, error) {
	return s.q.DeckByID(ctx, id)
}

// CreateDeckOptions carries the optional initial canvas dimensions and
// source attribution. Zero values fall back to 1920x1080 / "native".
// Importers (PPTX, DOCX, …) populate Source + SourcePath; the standard
// "New Deck" UI passes only Name.
type CreateDeckOptions struct {
	Name       string `json:"name"`
	Source     string `json:"source"`
	SourcePath string `json:"source_path"`
	Width      int64  `json:"width"`
	Height     int64  `json:"height"`
}

const (
	defaultCanvasW = 1920
	defaultCanvasH = 1080
	minCanvas      = 64
	maxCanvas      = 16384
)

// CreateDeck makes an empty deck. Empty names fall back to
// "Untitled deck"; the frontend can rename in-place once the editor
// opens. Canvas dimensions are clamped so a typo can't poison the
// renderer (a 0-width canvas would divide-by-zero downstream).
func (s *Service) CreateDeck(ctx context.Context, opts CreateDeckOptions) (database.Deck, error) {
	name := strings.TrimSpace(opts.Name)
	if name == "" {
		name = "Untitled deck"
	}
	source := strings.TrimSpace(opts.Source)
	if source == "" {
		source = "native"
	}
	width := opts.Width
	if width <= 0 {
		width = defaultCanvasW
	}
	height := opts.Height
	if height <= 0 {
		height = defaultCanvasH
	}
	if width < minCanvas {
		width = minCanvas
	}
	if width > maxCanvas {
		width = maxCanvas
	}
	if height < minCanvas {
		height = minCanvas
	}
	if height > maxCanvas {
		height = maxCanvas
	}
	return s.q.CreateDeck(ctx, database.CreateDeckParams{
		Name:       name,
		Source:     source,
		SourcePath: opts.SourcePath,
		Width:      width,
		Height:     height,
	})
}

func (s *Service) RenameDeck(ctx context.Context, id int64, name string) (database.Deck, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return database.Deck{}, fmt.Errorf("deck name cannot be empty")
	}
	return s.q.RenameDeck(ctx, database.RenameDeckParams{
		ID:   id,
		Name: name,
	})
}

// UpdateDeckCanvas resizes the deck. Block coordinates are normalised
// so the resize is purely cosmetic at the data layer — no block rows
// are touched. The renderer reads the new w/h next paint.
func (s *Service) UpdateDeckCanvas(ctx context.Context, id, width, height int64) (database.Deck, error) {
	if width < minCanvas {
		width = minCanvas
	}
	if width > maxCanvas {
		width = maxCanvas
	}
	if height < minCanvas {
		height = minCanvas
	}
	if height > maxCanvas {
		height = maxCanvas
	}
	return s.q.UpdateDeckCanvas(ctx, database.UpdateDeckCanvasParams{
		ID:     id,
		Width:  width,
		Height: height,
	})
}

func (s *Service) DeleteDeck(ctx context.Context, id int64) error {
	return s.q.DeleteDeck(ctx, id)
}

// DuplicateDeck copies the deck, its slides and blocks under a new
// name. The name is suffixed with " copy" (collision-safe via the
// unique index — caller retries with " copy 2" etc if needed).
func (s *Service) DuplicateDeck(ctx context.Context, id int64) (database.Deck, error) {
	src, err := s.q.DeckByID(ctx, id)
	if err != nil {
		return database.Deck{}, err
	}
	var copyDeck database.Deck
	err = s.inTx(ctx, func(q *database.Queries) error {
		newDeck, err := q.CreateDeck(ctx, database.CreateDeckParams{
			Name:       src.Name + " copy",
			Source:     src.Source,
			SourcePath: src.SourcePath,
			Width:      src.Width,
			Height:     src.Height,
		})
		if err != nil {
			return fmt.Errorf("create deck copy: %w", err)
		}
		slides, err := q.ListDeckSlides(ctx, src.ID)
		if err != nil {
			return fmt.Errorf("list source slides: %w", err)
		}
		for _, sl := range slides {
			newSlide, err := q.CreateDeckSlideAt(ctx, database.CreateDeckSlideAtParams{
				DeckID:         newDeck.ID,
				Position:       sl.Position,
				BackgroundJson: sl.BackgroundJson,
				Notes:          sl.Notes,
			})
			if err != nil {
				return fmt.Errorf("create slide copy: %w", err)
			}
			blocks, err := q.ListDeckBlocks(ctx, sl.ID)
			if err != nil {
				return fmt.Errorf("list source blocks: %w", err)
			}
			for _, b := range blocks {
				if _, err := q.CreateDeckBlock(ctx, database.CreateDeckBlockParams{
					SlideID:      newSlide.ID,
					ZIndex:       b.ZIndex,
					Kind:         b.Kind,
					X:            b.X,
					Y:            b.Y,
					W:            b.W,
					H:            b.H,
					TextJson:     b.TextJson,
					ImageMediaID: b.ImageMediaID,
					ShapeJson:    b.ShapeJson,
					TableJson:    b.TableJson,
					StyleJson:    b.StyleJson,
				}); err != nil {
					return fmt.Errorf("create block copy: %w", err)
				}
			}
		}
		copyDeck = newDeck
		return nil
	})
	if err != nil {
		return database.Deck{}, err
	}
	return copyDeck, nil
}

// --- Slides ---

func (s *Service) ListSlides(ctx context.Context, deckID int64) ([]database.DeckSlide, error) {
	return s.q.ListDeckSlides(ctx, deckID)
}

func (s *Service) SlideByID(ctx context.Context, slideID int64) (database.DeckSlide, error) {
	return s.q.DeckSlideByID(ctx, slideID)
}

// AddSlide appends a fresh, empty slide at the end of the deck. The
// editor is expected to follow up with block creation calls if it
// needs starter content.
func (s *Service) AddSlide(ctx context.Context, deckID int64) (database.DeckSlide, error) {
	slide, err := s.q.CreateDeckSlideAppend(ctx, database.CreateDeckSlideAppendParams{
		DeckID:         deckID,
		BackgroundJson: "{}",
		Notes:          "",
	})
	if err != nil {
		return database.DeckSlide{}, err
	}
	_ = s.q.TouchDeck(ctx, deckID)
	return slide, nil
}

func (s *Service) DeleteSlide(ctx context.Context, slideID int64) error {
	slide, err := s.q.DeckSlideByID(ctx, slideID)
	if err != nil {
		return err
	}
	if err := s.q.DeleteDeckSlide(ctx, slideID); err != nil {
		return err
	}
	_ = s.q.TouchDeck(ctx, slide.DeckID)
	return nil
}

// ReorderSlides writes positions to match the given id order in one
// transaction so an intermediate read never sees a half-applied
// order. The caller passes ALL slide ids for the deck; any id
// missing from the list keeps its old position (we don't try to be
// clever about partial reorders).
func (s *Service) ReorderSlides(ctx context.Context, deckID int64, ids []int64) error {
	if err := s.inTx(ctx, func(q *database.Queries) error {
		for i, id := range ids {
			if err := q.SetDeckSlidePosition(ctx, database.SetDeckSlidePositionParams{
				ID:       id,
				Position: int64(i),
			}); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}
	_ = s.q.TouchDeck(ctx, deckID)
	return nil
}

// SetSlideBackground replaces the background descriptor. The value
// must be JSON (object); empty string is rewritten to "{}" so the
// renderer never has to handle null payloads.
func (s *Service) SetSlideBackground(ctx context.Context, slideID int64, backgroundJSON string) (database.DeckSlide, error) {
	bg := strings.TrimSpace(backgroundJSON)
	if bg == "" {
		bg = "{}"
	}
	if !json.Valid([]byte(bg)) {
		return database.DeckSlide{}, fmt.Errorf("background_json is not valid JSON")
	}
	return s.q.SetDeckSlideBackground(ctx, database.SetDeckSlideBackgroundParams{
		ID:             slideID,
		BackgroundJson: bg,
	})
}

func (s *Service) SetSlideNotes(ctx context.Context, slideID int64, notes string) (database.DeckSlide, error) {
	return s.q.SetDeckSlideNotes(ctx, database.SetDeckSlideNotesParams{
		ID:    slideID,
		Notes: notes,
	})
}

// --- Blocks ---

// BlockSpec is the wire shape the frontend sends for block create /
// update. Nullable payload columns are represented as plain strings
// (empty = NULL) and *int64 for media id so the JSON is symmetric
// regardless of block kind.
type BlockSpec struct {
	ZIndex       int64   `json:"z_index"`
	Kind         string  `json:"kind"`
	X            float64 `json:"x"`
	Y            float64 `json:"y"`
	W            float64 `json:"w"`
	H            float64 `json:"h"`
	TextJson     string  `json:"text_json"`
	ImageMediaID *int64  `json:"image_media_id"`
	ShapeJson    string  `json:"shape_json"`
	TableJson    string  `json:"table_json"`
	StyleJson    string  `json:"style_json"`
}

var validBlockKinds = map[string]bool{
	"text":  true,
	"image": true,
	"shape": true,
	"table": true,
}

// normalize clamps coordinates to [0, 1], normalises JSON columns and
// returns the sqlc params shape. Invalid block kinds are rejected
// outright so a typo can't reach the renderer.
func (b BlockSpec) normalize() (database.CreateDeckBlockParams, error) {
	if !validBlockKinds[b.Kind] {
		return database.CreateDeckBlockParams{}, fmt.Errorf("invalid block kind: %q", b.Kind)
	}
	clamp := func(v float64) float64 {
		if v < 0 {
			return 0
		}
		if v > 1 {
			return 1
		}
		return v
	}
	style := strings.TrimSpace(b.StyleJson)
	if style == "" {
		style = "{}"
	}
	if !json.Valid([]byte(style)) {
		return database.CreateDeckBlockParams{}, fmt.Errorf("style_json is not valid JSON")
	}
	mkNullString := func(raw string) (sql.NullString, error) {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return sql.NullString{}, nil
		}
		if !json.Valid([]byte(raw)) {
			return sql.NullString{}, fmt.Errorf("payload is not valid JSON")
		}
		return sql.NullString{String: raw, Valid: true}, nil
	}
	textCol, err := mkNullString(b.TextJson)
	if err != nil {
		return database.CreateDeckBlockParams{}, fmt.Errorf("text_json: %w", err)
	}
	shapeCol, err := mkNullString(b.ShapeJson)
	if err != nil {
		return database.CreateDeckBlockParams{}, fmt.Errorf("shape_json: %w", err)
	}
	tableCol, err := mkNullString(b.TableJson)
	if err != nil {
		return database.CreateDeckBlockParams{}, fmt.Errorf("table_json: %w", err)
	}
	mediaCol := sql.NullInt64{}
	if b.ImageMediaID != nil {
		mediaCol = sql.NullInt64{Int64: *b.ImageMediaID, Valid: true}
	}
	return database.CreateDeckBlockParams{
		ZIndex:       b.ZIndex,
		Kind:         b.Kind,
		X:            clamp(b.X),
		Y:            clamp(b.Y),
		W:            clamp(b.W),
		H:            clamp(b.H),
		TextJson:     textCol,
		ImageMediaID: mediaCol,
		ShapeJson:    shapeCol,
		TableJson:    tableCol,
		StyleJson:    style,
	}, nil
}

func (s *Service) ListBlocks(ctx context.Context, slideID int64) ([]database.DeckBlock, error) {
	return s.q.ListDeckBlocks(ctx, slideID)
}

func (s *Service) CreateBlock(ctx context.Context, slideID int64, spec BlockSpec) (database.DeckBlock, error) {
	p, err := spec.normalize()
	if err != nil {
		return database.DeckBlock{}, err
	}
	p.SlideID = slideID
	block, err := s.q.CreateDeckBlock(ctx, p)
	if err != nil {
		return database.DeckBlock{}, err
	}
	if slide, err := s.q.DeckSlideByID(ctx, slideID); err == nil {
		_ = s.q.TouchDeck(ctx, slide.DeckID)
	}
	return block, nil
}

func (s *Service) UpdateBlock(ctx context.Context, blockID int64, spec BlockSpec) (database.DeckBlock, error) {
	p, err := spec.normalize()
	if err != nil {
		return database.DeckBlock{}, err
	}
	block, err := s.q.UpdateDeckBlock(ctx, database.UpdateDeckBlockParams{
		ID:           blockID,
		ZIndex:       p.ZIndex,
		X:            p.X,
		Y:            p.Y,
		W:            p.W,
		H:            p.H,
		TextJson:     p.TextJson,
		ImageMediaID: p.ImageMediaID,
		ShapeJson:    p.ShapeJson,
		TableJson:    p.TableJson,
		StyleJson:    p.StyleJson,
	})
	if err != nil {
		return database.DeckBlock{}, err
	}
	if slide, err := s.q.DeckSlideByID(ctx, block.SlideID); err == nil {
		_ = s.q.TouchDeck(ctx, slide.DeckID)
	}
	return block, nil
}

func (s *Service) DeleteBlock(ctx context.Context, blockID int64) error {
	block, err := s.q.DeckBlockByID(ctx, blockID)
	if err != nil {
		return err
	}
	if err := s.q.DeleteDeckBlock(ctx, blockID); err != nil {
		return err
	}
	if slide, err := s.q.DeckSlideByID(ctx, block.SlideID); err == nil {
		_ = s.q.TouchDeck(ctx, slide.DeckID)
	}
	return nil
}

// SetBlockZ updates only the z-index. Faster than UpdateBlock when the
// editor is just changing stacking order (a common drag interaction).
func (s *Service) SetBlockZ(ctx context.Context, blockID, z int64) error {
	if err := s.q.SetDeckBlockZ(ctx, database.SetDeckBlockZParams{
		ID:     blockID,
		ZIndex: z,
	}); err != nil {
		return err
	}
	if block, err := s.q.DeckBlockByID(ctx, blockID); err == nil {
		if slide, err := s.q.DeckSlideByID(ctx, block.SlideID); err == nil {
			_ = s.q.TouchDeck(ctx, slide.DeckID)
		}
	}
	return nil
}
