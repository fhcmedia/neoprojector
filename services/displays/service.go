package displays

import (
	"context"
	"database/sql"
	"fmt"
	"sync"

	"neoprojector/database"

	"github.com/charmbracelet/log"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Service struct {
	db *sql.DB
	q  *database.Queries

	// live tracks the open output windows keyed by display id. nil
	// when no broadcast is active. Guarded by mu because Go-side
	// StartLive/StopLive can race with the screen-changed handler.
	mu       sync.Mutex
	live     map[int64]*application.WebviewWindow
	lastSlot LivePayload // cached so output windows can fetch current state on mount

	// bypassDisplayCheck allows StartLive to succeed even when no
	// displays are enabled or bound to a monitor. Useful for testing
	// and development on single-screen machines.
	bypassDisplayCheck bool
}

// LivePayload mirrors the LiveSlide that the main window's
// LiveProvider holds. Kind "none" means "nothing live — go black."
// Persisted only in-memory inside this service; the operator never
// resumes a previous session's live state across app restarts.
type LivePayload struct {
	Kind           string              `json:"kind"`
	Fill           LiveFill            `json:"fill"`
	SourceItemID   int64               `json:"source_item_id"`
	SlideIndex     int64               `json:"slide_index"`
	ActiveOverlays []OverlayActivation `json:"active_overlays"`
}

// OverlayActivation is a schedule-item overlay currently toggled on.
// The snapshot it carries (kind/name/config/layouts/rules) was taken
// at activation time by the operator's main window; output windows
// don't re-fetch — they just render what's here, anchored to
// activated_at_ms for the time-based widgets and consulting rules
// to decide whether to suppress the underlying slide template.
type OverlayActivation struct {
	ScheduleItemID int64  `json:"schedule_item_id"`
	Kind           string `json:"kind"`
	Name           string `json:"name"`
	ConfigJSON     string `json:"config_json"`
	LayoutsJSON    string `json:"layouts_json"`
	RulesJSON      string `json:"rules_json"`
	ActivatedAtMs  int64  `json:"activated_at_ms"`
}

// LiveFill mirrors the frontend SlotFill type. Optional fields stay
// empty rather than nil pointer-wise so the JSON shape is stable.
type LiveFill struct {
	Primary   string        `json:"primary,omitempty"`
	Secondary string        `json:"secondary,omitempty"`
	Tertiary  string        `json:"tertiary,omitempty"`
	Caption   string        `json:"caption,omitempty"`
	Media     *LiveMediaRef `json:"media,omitempty"`
}

type LiveMediaRef struct {
	MediaID int64  `json:"mediaId"`
	Mode    string `json:"mode,omitempty"`
}

func New(db *sql.DB) *Service {
	return &Service{db: db, q: database.New(db)}
}

func (*Service) ServiceName() string { return "displays" }

// emitChanged signals every webview (main + every output window) that
// the display roster has been mutated. Output windows listen for this
// to refetch their own display row — without it, changing a template
// binding while live wouldn't reach the audience because each output
// is a separate webview with its own React Query cache.
func emitChanged() {
	if app := application.Get(); app != nil {
		app.Event.Emit("displays:changed", nil)
	}
}

// ScreenInfo is the subset of the Wails Screen we expose to the
// frontend. The OS-given ID is the stable handle we persist in
// display.screen_id; the rest is for display/labelling.
type ScreenInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	IsPrimary bool   `json:"is_primary"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

// ListScreens reports every physical screen the OS currently exposes.
// The frontend uses it to populate the per-display "Bind to monitor"
// dropdown — stale screen_id values that no longer match any entry
// here are rendered as "(disconnected)".
func (s *Service) ListScreens(_ context.Context) []ScreenInfo {
	app := application.Get()
	if app == nil {
		return nil
	}
	all := app.Screen.GetAll()
	out := make([]ScreenInfo, 0, len(all))
	for _, sc := range all {
		out = append(out, ScreenInfo{
			ID:        sc.ID,
			Name:      sc.Name,
			IsPrimary: sc.IsPrimary,
			Width:     sc.Size.Width,
			Height:    sc.Size.Height,
		})
	}
	return out
}

func (s *Service) ListDisplays(ctx context.Context) ([]database.Display, error) {
	return s.q.ListDisplays(ctx)
}

func (s *Service) DisplayByID(ctx context.Context, id int64) (database.Display, error) {
	return s.q.DisplayByID(ctx, id)
}

func (s *Service) CreateDisplay(ctx context.Context, name string) (database.Display, error) {
	if name == "" {
		name = "Untitled display"
	}
	out, err := s.q.CreateDisplayAppend(ctx, name)
	if err == nil {
		emitChanged()
	}
	return out, err
}

func (s *Service) RenameDisplay(ctx context.Context, id int64, name string) (database.Display, error) {
	out, err := s.q.RenameDisplay(ctx, database.RenameDisplayParams{ID: id, Name: name})
	if err == nil {
		emitChanged()
	}
	return out, err
}

func (s *Service) SetDisplayEnabled(ctx context.Context, id int64, enabled bool) (database.Display, error) {
	v := int64(0)
	if enabled {
		v = 1
	}
	out, err := s.q.SetDisplayEnabled(ctx, database.SetDisplayEnabledParams{ID: id, Enabled: v})
	if err == nil {
		emitChanged()
	}
	return out, err
}

// SetBibleTemplate binds a template to this display's bible content.
// templateID == 0 clears the binding (NULL in DB). Frontend defaults
// use negative IDs, which are stored verbatim and resolved client-side.
func (s *Service) SetBibleTemplate(ctx context.Context, id int64, templateID int64) (database.Display, error) {
	arg := database.SetDisplayBibleTemplateParams{ID: id}
	if templateID != 0 {
		arg.BibleTemplateID = sql.NullInt64{Int64: templateID, Valid: true}
	}
	out, err := s.q.SetDisplayBibleTemplate(ctx, arg)
	if err == nil {
		emitChanged()
	}
	return out, err
}

// SetDisplayScreen binds the display to a physical monitor by its
// stable Wails screen id. Pass empty string to clear the binding;
// the display will no longer open an output window on Go Live until
// it's reassigned.
func (s *Service) SetDisplayScreen(ctx context.Context, id int64, screenID string) (database.Display, error) {
	arg := database.SetDisplayScreenParams{ID: id}
	if screenID != "" {
		arg.ScreenID = sql.NullString{String: screenID, Valid: true}
	}
	out, err := s.q.SetDisplayScreen(ctx, arg)
	if err == nil {
		emitChanged()
	}
	return out, err
}

func (s *Service) SetSongTemplate(ctx context.Context, id int64, templateID int64) (database.Display, error) {
	arg := database.SetDisplaySongTemplateParams{ID: id}
	if templateID != 0 {
		arg.SongTemplateID = sql.NullInt64{Int64: templateID, Valid: true}
	}
	out, err := s.q.SetDisplaySongTemplate(ctx, arg)
	if err == nil {
		emitChanged()
	}
	return out, err
}

// ReorderDisplays writes position values to match the given id order.
// All updates run in a single transaction so the list never has a
// half-applied order visible to other readers.
func (s *Service) ReorderDisplays(ctx context.Context, ids []int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	q := s.q.WithTx(tx)
	for i, id := range ids {
		if err := q.SetDisplayPosition(ctx, database.SetDisplayPositionParams{
			ID:       id,
			Position: int64(i),
		}); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (s *Service) DeleteDisplay(ctx context.Context, id int64) error {
	if err := s.q.DeleteDisplay(ctx, id); err != nil {
		return err
	}
	emitChanged()
	return nil
}

// --- live broadcast ---

// SetBypassDisplayCheck toggles whether StartLive requires at least
// one enabled display bound to a connected monitor.
func (s *Service) SetBypassDisplayCheck(_ context.Context, bypass bool) {
	s.mu.Lock()
	s.bypassDisplayCheck = bypass
	s.mu.Unlock()
}

// GetBypassDisplayCheck reports the current bypass state.
func (s *Service) GetBypassDisplayCheck(_ context.Context) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.bypassDisplayCheck
}

// IsLive reports whether output windows are currently open.
func (s *Service) IsLive(_ context.Context) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.live != nil
}

// StartLive opens an output window for every enabled display whose
// screen_id matches a currently-connected monitor. Disabled displays
// and ones without a binding (or whose bound screen is disconnected)
// are skipped silently — the user sees the result in the previews.
// Idempotent: a second call while live is a no-op.
func (s *Service) StartLive(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.live != nil {
		return nil
	}
	app := application.Get()
	if app == nil {
		return fmt.Errorf("application not initialized")
	}

	displays, err := s.q.ListDisplays(ctx)
	if err != nil {
		return err
	}
	allScreens := app.Screen.GetAll()
	byScreenID := make(map[string]*application.Screen)
	for _, sc := range allScreens {
		byScreenID[sc.ID] = sc
		log.Info("StartLive: connected screen",
			"id", sc.ID,
			"name", sc.Name,
			"primary", sc.IsPrimary,
			"bounds", sc.Bounds,
			"size", sc.Size,
		)
	}

	opened := make(map[int64]*application.WebviewWindow)
	for _, d := range displays {
		if d.Enabled == 0 || !d.ScreenID.Valid || d.ScreenID.String == "" {
			log.Info("StartLive: skipping display (disabled or unbound)",
				"display", d.Name, "id", d.ID, "enabled", d.Enabled,
				"bound", d.ScreenID.Valid, "screen_id", d.ScreenID.String,
			)
			continue
		}
		sc, ok := byScreenID[d.ScreenID.String]
		if !ok {
			log.Warn("StartLive: bound screen no longer connected",
				"display", d.Name, "stored_screen_id", d.ScreenID.String,
			)
			continue
		}
		log.Info("StartLive: opening output window",
			"display", d.Name,
			"target_screen_id", sc.ID,
			"target_screen_name", sc.Name,
			"bounds", sc.Bounds,
		)

		// Cross-screen placement goes through Wails' option-time
		// path because that's the only one that calls the C-level
		// `windowSetPositionOnScreen` — it finds the NSScreen by id
		// and computes the origin in that screen's coordinate space.
		// The post-create `SetBounds` API calls `windowSetPosition`
		// which scales by the CURRENT screen and never moves across
		// screens; that's what was putting the window on the laptop.
		win := app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:                       fmt.Sprintf("output-%d", d.ID),
			Title:                      d.Name,
			URL:                        fmt.Sprintf("/output/%d", d.ID),
			Frameless:                  true,
			DefaultContextMenuDisabled: true,
			Screen:                     sc,
			InitialPosition:            application.WindowXY,
			X:                          0,
			Y:                          0,
			Width:                      sc.Size.Width,
			Height:                     sc.Size.Height,
			BackgroundColour:           application.RGBA{Red: 0, Green: 0, Blue: 0, Alpha: 255},
			// Collection-behavior flags that (a) keep the window pinned
			// to its assigned screen across Space switches, (b) make
			// it look less like a "regular app window" so AeroSpace /
			// yabai and similar tilers are likely to ignore it, and
			// (c) let it sit above other apps' fullscreen state on the
			// audience display without entering OS fullscreen itself
			// (which is what kept yanking it back to the laptop).
			Mac: application.MacWindow{
				CollectionBehavior: application.MacWindowCollectionBehaviorCanJoinAllSpaces |
					application.MacWindowCollectionBehaviorStationary |
					application.MacWindowCollectionBehaviorFullScreenAuxiliary |
					application.MacWindowCollectionBehaviorIgnoresCycle |
					application.MacWindowCollectionBehaviorTransient,
			},
		})
		// Belt-and-suspenders: SetScreen post-create uses the same
		// `windowCenterOnScreen` C helper as the option-time path,
		// so even if the initial NSWindow alloc lands on the wrong
		// screen, this second call snaps it onto the right one
		// before the audience sees a frame.
		win.SetScreen(sc)
		log.Info("StartLive: window placed",
			"display", d.Name,
		)
		opened[d.ID] = win
	}
	if len(opened) == 0 && !s.bypassDisplayCheck {
		return fmt.Errorf("no displays are enabled and bound to a connected monitor")
	}
	// Assign unconditionally so IsLive() (which checks s.live != nil)
	// returns true even in bypass-mode with no external displays.
	// An empty-but-non-nil map is the sentinel for bypass-only live.
	s.live = opened
	return nil
}

// StopLive closes every output window. Safe to call when not live.
func (s *Service) StopLive(_ context.Context) {
	s.mu.Lock()
	live := s.live
	s.live = nil
	s.mu.Unlock()
	for _, w := range live {
		w.Close()
	}
}

// PushLive caches the snapshot from the main window and rebroadcasts
// to all output windows via the "live:slot" event. Output webviews
// subscribe to this event and update their template fill in place.
func (s *Service) PushLive(_ context.Context, payload LivePayload) {
	if payload.Kind == "" {
		payload.Kind = "none"
	}
	s.mu.Lock()
	s.lastSlot = payload
	s.mu.Unlock()
	if app := application.Get(); app != nil {
		app.Event.Emit("live:slot", payload)
	}
}

// CurrentLive returns the last pushed payload so an output window can
// render the right slide on first mount (e.g. after Go Live re-opens
// windows mid-service).
func (s *Service) CurrentLive(_ context.Context) LivePayload {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastSlot.Kind == "" {
		return LivePayload{Kind: "none"}
	}
	return s.lastSlot
}
