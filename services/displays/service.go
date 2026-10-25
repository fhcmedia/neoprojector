package displays

import (
	"context"
	"database/sql"
	"fmt"
	"runtime"
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

// LivePayload carries the full live state as independent render
// channels, composited bottom-up by every output window:
//
//	z0  Media ?? Background ?? black   (one slot — media wins)
//	z1  ActiveOverlays
//	z2  Slide (templated song/bible text)
//	z3  Presentation
//
// All channels are independently nillable; an all-nil payload means
// "nothing live — go black". The operator window composes channels
// (service defaults + item overrides + manual toggles); this service
// stays a cache-and-relay and never interprets the contents.
// Persisted only in-memory; live state never survives app restarts.
type LivePayload struct {
	// Background is the z0 resting layer — an animated shader (or
	// other engine) snapshot resolved by the operator at push time
	// from the schedule's item -> section -> service config chain.
	// Snapshot, not id: output windows render without re-fetching
	// (same discipline as overlay activations).
	Background *BackgroundSnapshot `json:"background,omitempty"`
	// Media is z0 content from media schedule items. When set it
	// replaces Background for as long as it's live.
	Media *MediaChannel `json:"media,omitempty"`
	// ActiveOverlays render at z1 — above the background, below the
	// slide text. cover_slide rules still suppress z0+z2 client-side.
	ActiveOverlays []OverlayActivation `json:"active_overlays"`
	// Slide is the templated text channel (song lyrics, bible verses).
	Slide *SlideChannel `json:"slide,omitempty"`
	// Presentation is the top channel — opaque slides that cover
	// everything while live; clearing it reveals what never stopped
	// being live beneath.
	Presentation *PresentationChannel `json:"presentation,omitempty"`

	// AudioDisplayID names the single output window that should play
	// audio when a live channel carries video/audio media. Every other
	// output mutes its <video>. Computed in PushLive as the smallest
	// media-capable display id — deterministic across pushes so the
	// audio doesn't hop between screens mid-slide. Zero when no live
	// output windows are open.
	AudioDisplayID int64 `json:"audio_display_id,omitempty"`
}

// BackgroundSnapshot is a resolved background document: which row/seed
// it came from plus everything needed to render it. ConfigJSON is
// opaque to Go — the frontend's engine renderer interprets it.
type BackgroundSnapshot struct {
	BackgroundID int64  `json:"background_id"`
	Engine       string `json:"engine"`
	ConfigJSON   string `json:"config_json"`
}

// MediaChannel is a media schedule item on the z0 slot.
type MediaChannel struct {
	Ref          LiveMediaRef `json:"ref"`
	SourceItemID int64        `json:"source_item_id"`
}

// SlideChannel is the templated text layer (z2). Kind picks each
// display's template binding ("song" -> song_template_id, "bible" ->
// bible_template_id).
type SlideChannel struct {
	Kind         string   `json:"kind"`
	Fill         LiveFill `json:"fill"`
	SourceItemID int64    `json:"source_item_id"`
	SlideIndex   int64    `json:"slide_index"`
	// Per-template uniform fontSize override for the currently-
	// broadcasting item. Keyed by template id (string keys — JSON
	// maps). One fontSize per template, applied to every fitToBox box
	// across every slide of the item, computed by the operator's
	// uniform-fit pass so translations stay aligned and verses never
	// jump size. Empty when no uniform pass has reported.
	FontSizeOverrideByTemplate map[string]int64 `json:"font_size_override_by_template,omitempty"`
}

// PresentationChannel is presentation playback (z3): the current
// slide's media plus the transition the operator configured and the
// upcoming slide's media id for decoder pre-warming across outputs.
type PresentationChannel struct {
	Ref                  LiveMediaRef `json:"ref"`
	SourceItemID         int64        `json:"source_item_id"`
	SlideIndex           int64        `json:"slide_index"`
	TransitionKind       string       `json:"transition_kind,omitempty"`
	TransitionDurationMs int64        `json:"transition_duration_ms,omitempty"`
	NextMediaID          int64        `json:"next_media_id,omitempty"`
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

// LiveMediaRef carries everything the audience-output side needs to
// render a media slot — what to play, how to frame it, and how the
// operator currently wants it behaving.
//
// Playback state is operator-driven: every push of a new payload from
// the main window flows through PushLive and is rebroadcast to every
// output window. Position/seek is NOT tracked here — the output runs
// its own clock and the operator controls coarse state only (play,
// pause, loop, mute, restart). A scrubber is deferred until we need
// it.
//
// RestartToken is a monotonically increasing counter the operator
// bumps to force the output to seek back to 0 and resume playback.
// The output checks for a value change rather than reading absolute
// time — that way a re-broadcast of the same token (e.g. on output
// window reopen) doesn't re-trigger a restart.
type LiveMediaRef struct {
	MediaID      int64  `json:"mediaId"`
	Mode         string `json:"mode,omitempty"`
	Playing      bool   `json:"playing"`
	Loop         bool   `json:"loop"`
	Muted        bool   `json:"muted"`
	RestartToken int64  `json:"restart_token"`
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

// SetDisplayLayer toggles whether this display renders one content
// kind. layer is one of "song" | "bible" | "media" | "overlay"; on
// maps to the row's show_* column. Suppression is enforced client-
// side in each output window (and the operator preview), so flipping a
// flag only needs the displays:changed emit to make every open output
// refetch its row and re-evaluate — no live re-push required.
func (s *Service) SetDisplayLayer(ctx context.Context, id int64, layer string, on bool) (database.Display, error) {
	v := int64(0)
	if on {
		v = 1
	}
	var (
		out database.Display
		err error
	)
	switch layer {
	case "song":
		out, err = s.q.SetDisplayShowSong(ctx, database.SetDisplayShowSongParams{ShowSong: v, ID: id})
	case "bible":
		out, err = s.q.SetDisplayShowBible(ctx, database.SetDisplayShowBibleParams{ShowBible: v, ID: id})
	case "media":
		out, err = s.q.SetDisplayShowMedia(ctx, database.SetDisplayShowMediaParams{ShowMedia: v, ID: id})
	case "overlay":
		out, err = s.q.SetDisplayShowOverlay(ctx, database.SetDisplayShowOverlayParams{ShowOverlay: v, ID: id})
	default:
		return database.Display{}, fmt.Errorf("unknown display layer %q", layer)
	}
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
	return s.inTx(ctx, func(q *database.Queries) error {
		for i, id := range ids {
			if err := q.SetDisplayPosition(ctx, database.SetDisplayPositionParams{
				ID:       id,
				Position: int64(i),
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// inTx runs fn inside a single transaction. defer-Rollback fires after
// Commit too (no-op on a committed tx), so the connection always
// returns to the pool even if Commit panics.
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

// dwmColorNone is DWMWA_COLOR_NONE: tells DWM to draw no window border.
var dwmColorNone uint32 = 0xFFFFFFFE

var noBorderTheme = &application.WindowTheme{BorderColour: &dwmColorNone}

// StartLive opens an output window for every enabled display whose
// screen_id matches a currently-connected monitor. Disabled displays
// and ones without a binding (or whose bound screen is disconnected)
// are skipped silently — the user sees the result in the previews.
// Idempotent: a second call while live is a no-op.
//
// The mutex is intentionally released before opening native windows.
// `app.Window.NewWithOptions` calls into the OS window subsystem
// (NSWindow alloc on macOS takes 100–500ms per window) — holding `mu`
// across those calls blocks IsLive/CurrentLive/PushLive/StopLive on
// every other goroutine for the duration. We re-acquire only to
// flip the live flag and stash the opened set.
func (s *Service) StartLive(ctx context.Context) error {
	s.mu.Lock()
	if s.live != nil {
		s.mu.Unlock()
		return nil
	}
	bypass := s.bypassDisplayCheck
	s.mu.Unlock()

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
			DisableResize:              true,
			// Windows 11's DWM draws a 1px grey border around every
			// top-level window, which shows as a frame on the projector.
			// No decorations drops the Aero shadow/rounded corners, and a
			// border colour of DWMWA_COLOR_NONE in every theme state
			// removes the border (Wails re-applies the theme on every
			// focus change, so all four states need it).
			Windows: application.WindowsWindow{
				DisableFramelessWindowDecorations: true,
				CustomTheme: application.ThemeSettings{
					DarkModeActive:    noBorderTheme,
					DarkModeInactive:  noBorderTheme,
					LightModeActive:   noBorderTheme,
					LightModeInactive: noBorderTheme,
				},
			},
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
		// On Windows a frameless window sized to the monitor still sits
		// under the taskbar, because the shell only auto-hides it for
		// real fullscreen windows. Fullscreen() switches to WS_POPUP over
		// the full monitor rect (MonitorFromWindow — the window is
		// already on its target screen by now) and topmost keeps the
		// taskbar from re-raising over it when the operator clicks back
		// into the main window. macOS is left alone: OS fullscreen there
		// is what yanked the window back onto the laptop.
		if runtime.GOOS == "windows" {
			win.Fullscreen()
			win.SetAlwaysOnTop(true)
		}
		log.Info("StartLive: window placed",
			"display", d.Name,
		)
		opened[d.ID] = win
	}
	// Fullscreen() focuses the window it fullscreens; hand focus back
	// to the operator window so keyboard control keeps working.
	if runtime.GOOS == "windows" && len(opened) > 0 {
		if main, ok := app.Window.GetByName("main"); ok {
			main.Focus()
		}
	}
	if len(opened) == 0 && !bypass {
		return fmt.Errorf("no displays are enabled and bound to a connected monitor")
	}
	// Assign unconditionally so IsLive() (which checks s.live != nil)
	// returns true even in bypass-mode with no external displays.
	// An empty-but-non-nil map is the sentinel for bypass-only live.
	s.mu.Lock()
	// Another goroutine might have raced us to start live (unlikely
	// from the UI but cheap to defend). If so, close what we just
	// opened so we don't strand a second set of NSWindows.
	if s.live != nil {
		s.mu.Unlock()
		for _, w := range opened {
			w.Close()
		}
		return nil
	}
	s.live = opened
	s.mu.Unlock()
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
func (s *Service) PushLive(ctx context.Context, payload LivePayload) {
	// Resolve which displays actually render media before taking the
	// lock (keeps the DB read off the mutex the other live calls
	// contend on). A media-suppressed display (show_media=0) mounts no
	// <video>, so it can't be the audio source.
	mediaCapable, mediaErr := s.mediaCapableDisplays(ctx)
	s.mu.Lock()
	// Pick a single audio output deterministically — the smallest
	// active display id that renders media wins. Output windows mute
	// themselves unless their id matches, so N displays presenting the
	// same video don't pile up N audio streams on the computer's audio
	// device. Skipping media-suppressed displays is what prevents
	// venue-wide silence when the smallest id is routed lyrics-only
	// (its window has no <video> to play, and every other window mutes
	// itself). On a lookup error we fall back to the plain smallest-id
	// pick so audio never regresses to "off". When every live display
	// suppresses media, audioID stays 0 — correct, since media is
	// hidden everywhere and there is genuinely nothing to play.
	var audioID int64
	for id := range s.live {
		if mediaErr == nil && !mediaCapable[id] {
			continue
		}
		if audioID == 0 || id < audioID {
			audioID = id
		}
	}
	payload.AudioDisplayID = audioID
	s.lastSlot = payload
	s.mu.Unlock()
	if app := application.Get(); app != nil {
		app.Event.Emit("live:slot", payload)
	}
}

// mediaCapableDisplays returns the set of display ids whose show_media
// flag is on. PushLive uses it to keep audio on a display that actually
// renders the video; a media-suppressed output produces no <video> and
// thus no sound, so it must never be chosen as the audio source.
func (s *Service) mediaCapableDisplays(ctx context.Context) (map[int64]bool, error) {
	rows, err := s.q.ListDisplays(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]bool, len(rows))
	for _, d := range rows {
		if d.ShowMedia != 0 {
			out[d.ID] = true
		}
	}
	return out, nil
}

// CurrentLive returns the last pushed payload so an output window can
// render the right slide on first mount (e.g. after Go Live re-opens
// windows mid-service).
func (s *Service) CurrentLive(_ context.Context) LivePayload {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Zero value is the valid "nothing live" payload — all channels
	// nil, outputs render black.
	return s.lastSlot
}
