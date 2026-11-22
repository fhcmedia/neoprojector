// Package liveupdate implements instant updates: while the app runs it
// watches for a new release and moves to it without taking the screens
// down.
//
// The handoff, in order:
//  1. the old version downloads and verifies the release;
//  2. it asks the operator window for a snapshot of its state (what's
//     live, overlays, the open service/item) and writes that, with the
//     displays' live payload and the main window's bounds, to a handoff
//     file;
//  3. it swaps the executable in place and starts the new version with
//     --handoff <file>, staying up itself;
//  4. the new version restores everything, opens its output windows
//     over the old ones on the same slide, and once they've painted
//     writes <file>.done;
//  5. the old version sees that and quits.
//
// Any failure before step 5 leaves the old version running and the
// screens untouched; the new version stops and is killed.
package liveupdate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"neoprojector/services/displays"
	"neoprojector/services/updates"

	"github.com/adrg/xdg"
	"github.com/charmbracelet/log"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// pollEvery is how often a running app checks for a new release. The
// check is a conditional request (see updates.Poller), so it's cheap.
const pollEvery = time.Minute

// Status is what Settings shows about instant updates.
type Status struct {
	// idle | downloading | switching | failed
	State   string `json:"state"`
	Version string `json:"version,omitempty"`
	Error   string `json:"error,omitempty"`
}

type settings struct {
	Enabled bool `json:"enabled"`
}

// handoff is the file the old version writes for the new one.
type handoff struct {
	From     string           `json:"from"` // version handing off
	Displays displays.Handoff `json:"displays"`
	// Operator is the operator window's own snapshot, opaque here.
	Operator string `json:"operator"`
	// Main window placement, so the operator window doesn't jump.
	Bounds    application.Rect `json:"bounds"`
	Maximised bool             `json:"maximised"`
}

type Service struct {
	version string
	disp    *displays.Service

	mu     sync.Mutex
	cfg    settings
	status Status
	// snap receives the operator window's reply to a snapshot request.
	snap chan string
	kick chan struct{}

	// In a version started by a handoff: the file and what it held.
	handoffPath string
	restore     *handoff
	taken       chan struct{} // closed once the operator took its snapshot
}

// New makes the service. handoffPath is the --handoff argument ("" for
// a normal launch); its live state is restored into disp right away,
// before any window opens.
func New(version string, disp *displays.Service, handoffPath string) *Service {
	s := &Service{
		version: version,
		disp:    disp,
		cfg:     loadSettings(),
		status:  Status{State: "idle"},
		kick:    make(chan struct{}, 1),
		taken:   make(chan struct{}),
	}
	if handoffPath != "" {
		var h handoff
		b, err := os.ReadFile(handoffPath)
		if err == nil {
			err = json.Unmarshal(b, &h)
		}
		if err != nil {
			log.Error("instant update: can't read handoff", "err", err)
		} else {
			s.handoffPath = handoffPath
			s.restore = &h
			displays.RestoreHandoff(disp, h.Displays)
			log.Info("instant update: resuming", "from", h.From, "live", h.Displays.Live)
		}
	}
	return s
}

func (*Service) ServiceName() string { return "liveupdate" }

// Supported: instant updates need an installed release build on
// Windows or Linux (dev builds don't update; the macOS bundle updates
// at launch only).
func (s *Service) Supported(context.Context) bool {
	return s.version != "0.0.0-dev" && runtime.GOOS != "darwin"
}

func (s *Service) Enabled(context.Context) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.Enabled
}

func (s *Service) SetEnabled(_ context.Context, on bool) error {
	s.mu.Lock()
	s.cfg.Enabled = on
	cfg := s.cfg
	s.mu.Unlock()
	if on {
		select {
		case s.kick <- struct{}{}:
		default:
		}
	}
	return saveSettings(cfg)
}

func (s *Service) Status(context.Context) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// SubmitSnapshot is the operator window's answer to the
// "liveupdate:snapshot-request" event.
func (s *Service) SubmitSnapshot(_ context.Context, snapshot string) {
	s.mu.Lock()
	ch := s.snap
	s.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- snapshot:
	default:
	}
}

// TakeSnapshot returns, once, the operator snapshot an instant update
// carried over ("" otherwise). The operator window calls it before it
// renders anything.
func (s *Service) TakeSnapshot(context.Context) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.restore == nil {
		return ""
	}
	op := s.restore.Operator
	s.restore.Operator = ""
	select {
	case <-s.taken:
	default:
		close(s.taken)
	}
	return op
}

// Resuming reports whether this launch is the new side of a handoff
// (the splash skips its update check and delays).
func Resuming(s *Service) bool { return s.restore != nil }

// PlaceMainWindow puts the new operator window where the old one was.
func PlaceMainWindow(s *Service, win *application.WebviewWindow) {
	h := s.restore
	if h == nil || win == nil {
		return
	}
	if h.Bounds.Width > 0 && h.Bounds.Height > 0 {
		win.SetBounds(h.Bounds)
	}
	if h.Maximised {
		win.Maximise()
	}
}

// Run is the app's background loop: it finishes a handoff this launch
// came from, then polls for new releases while instant updates are on.
func Run(s *Service) {
	if s.restore != nil {
		s.finishHandoff()
	}
	if !s.Supported(context.Background()) {
		return
	}
	var p updates.Poller
	failed := map[string]bool{}
	t := time.NewTicker(pollEvery)
	defer t.Stop()
	for {
		if s.Enabled(context.Background()) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			info, err := p.Check(ctx, s.version)
			cancel()
			switch {
			case err != nil:
				log.Warn("instant update: check failed", "err", err)
			case info != nil && !failed[info.Version]:
				err := s.switchTo(info)
				var retry retryLater
				if errors.As(err, &retry) {
					log.Warn("instant update: will retry", "err", err)
					s.setStatus(Status{State: "idle"})
				} else if err != nil {
					failed[info.Version] = true
					log.Error("instant update failed", "version", info.Version, "err", err)
					s.setStatus(Status{State: "failed", Version: info.Version, Error: err.Error()})
				}
			}
		}
		select {
		case <-t.C:
		case <-s.kick:
		}
	}
}

// retryLater marks a failure worth trying again at the next poll (the
// install wasn't touched).
type retryLater struct{ error }

func (s *Service) setStatus(st Status) {
	s.mu.Lock()
	s.status = st
	s.mu.Unlock()
	if app := application.Get(); app != nil {
		app.Event.Emit("liveupdate:status", st)
	}
}

// switchTo moves to info's version (see the package doc). It returns
// only on failure; on success the app quits.
func (s *Service) switchTo(info *updates.Info) error {
	log.Info("instant update: downloading", "version", info.Version)
	s.setStatus(Status{State: "downloading", Version: info.Version})
	dlCtx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	archive, err := updates.Download(dlCtx, info, nil)
	cancel()
	if archive != "" {
		defer os.Remove(archive)
	}
	if err != nil {
		return retryLater{fmt.Errorf("download: %w", err)}
	}

	s.setStatus(Status{State: "switching", Version: info.Version})
	op, err := s.requestSnapshot()
	if err != nil {
		return retryLater{err}
	}
	h := handoff{From: s.version, Displays: displays.TakeHandoff(s.disp), Operator: op}
	if app := application.Get(); app != nil {
		if win, ok := app.Window.GetByName("main"); ok {
			if w, ok := win.(*application.WebviewWindow); ok {
				h.Maximised = w.IsMaximised()
				if !h.Maximised {
					h.Bounds = w.Bounds()
				}
			}
		}
	}
	path, err := xdg.DataFile("neoprojector/handoff.json")
	if err != nil {
		return retryLater{err}
	}
	done := path + ".done"
	os.Remove(done)
	b, _ := json.Marshal(h)
	if err := os.WriteFile(path, b, 0o644); err != nil {
		return retryLater{err}
	}
	defer os.Remove(path)
	defer os.Remove(done)

	if err := updates.Swap(archive); err != nil {
		return fmt.Errorf("install: %w", err)
	}
	// From here the new version is installed: even if the handoff
	// fails, the next launch runs it.
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "--handoff", path)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start new version: %w", err)
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	deadline := time.After(2 * time.Minute)
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case err := <-exited:
			return fmt.Errorf("new version stopped during the switch: %v", err)
		case <-deadline:
			_ = cmd.Process.Kill()
			return errors.New("new version didn't take over in time")
		case <-tick.C:
			if _, err := os.Stat(done); err == nil {
				log.Info("instant update: new version took over, quitting", "version", info.Version)
				// Quit doesn't come back to run the defers.
				os.Remove(path)
				os.Remove(done)
				application.Get().Quit()
				return nil
			}
		}
	}
}

// requestSnapshot asks the operator window for its state.
func (s *Service) requestSnapshot() (string, error) {
	ch := make(chan string, 1)
	s.mu.Lock()
	s.snap = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.snap = nil
		s.mu.Unlock()
	}()
	app := application.Get()
	if app == nil {
		return "", errors.New("no app")
	}
	app.Event.Emit("liveupdate:snapshot-request", nil)
	select {
	case op := <-ch:
		return op, nil
	case <-time.After(5 * time.Second):
		return "", errors.New("operator window didn't answer")
	}
}

// finishHandoff is the new version's side: wait for the operator
// window to restore, bring the screens up over the old ones, and once
// they've painted, tell the old version to go.
func (s *Service) finishHandoff() {
	select {
	case <-s.taken:
	case <-time.After(30 * time.Second):
		log.Warn("instant update: operator window never restored")
	}
	if s.restore.Displays.Live {
		if err := s.disp.StartLive(context.Background()); err != nil {
			log.Error("instant update: StartLive", "err", err)
		}
		// Each output window comes up see-through over the old one and
		// turns opaque once it has drawn (displays.unveil).
		for i := 0; i < 60 && displays.OutputsPending(s.disp) > 0; i++ {
			time.Sleep(200 * time.Millisecond)
		}
	}
	// One more beat so the now-opaque windows are composited before the
	// old ones disappear from under them.
	time.Sleep(500 * time.Millisecond)
	if err := os.WriteFile(s.handoffPath+".done", nil, 0o644); err != nil {
		log.Error("instant update: can't signal the old version", "err", err)
	}
	log.Info("instant update: took over", "from", s.restore.From, "version", s.version)
}

func settingsPath() (string, error) {
	return xdg.DataFile("neoprojector/instant-update.json")
}

func loadSettings() settings {
	var c settings
	p, err := settingsPath()
	if err != nil {
		return c
	}
	if b, err := os.ReadFile(p); err == nil {
		_ = json.Unmarshal(b, &c)
	}
	return c
}

func saveSettings(c settings) error {
	p, err := settingsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(p, b, 0o644)
}
