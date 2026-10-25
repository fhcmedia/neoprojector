package main

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"neoprojector/database"
	"neoprojector/database/seed"
	"neoprojector/services/updates"

	"github.com/charmbracelet/log"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type App struct {
	db *sql.DB
	// mediaServerPort/mediaServerToken address the plain net/http
	// media server (see startMediaServer in main.go). The frontend
	// fetches these once at startup and points <video> media-asset
	// URLs at that loopback origin instead of the wails custom-scheme
	// path — see MediaServer's doc comment for why.
	mediaServerPort  int
	mediaServerToken string
}

func NewApp(db *sql.DB, mediaServerPort int, mediaServerToken string) *App {
	return &App{db: db, mediaServerPort: mediaServerPort, mediaServerToken: mediaServerToken}
}

// MediaServerInfo is how a caller reaches the loopback media server:
// the port it's listening on and the token it requires (see
// startMediaServer in main.go).
type MediaServerInfo struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
}

// MediaServer returns how to reach the loopback media server, which
// serves the same content as the wails-bridged /media-asset/{id}
// path but over a plain OS socket, bypassing Wails' Windows WebView2
// asset bridge. That bridge (as of wails v3 alpha.89) buffers an
// entire HTTP response into memory before handing it to WebView2,
// synchronously on the UI thread — fine for small assets, but a
// several-minute video response is large enough to freeze or crash
// the app on Windows. A real network request streams normally.
func (a *App) MediaServer(_ context.Context) MediaServerInfo {
	return MediaServerInfo{Port: a.mediaServerPort, Token: a.mediaServerToken}
}

func (a *App) Initialize() {
	app := application.Get()
	splash, ok := app.Window.GetByName("splash")
	if !ok {
		splash = app.Window.Current()
	}
	go a.runInit(splash)
}

// The init process is too fast, so the sleep commands
// are present purely for eye candy :D
func (a *App) runInit(splash application.Window) {
	if splash == nil {
		log.Error("splash window is nil")
		return
	}

	emit := func(name string, data any) {
		splash.EmitEvent(name, data)
	}

	// The update gate runs before anything touches the database so the
	// newest build is always the one that runs migrations. Does not
	// return if an update applies — the new build relaunches.
	a.maybeUpdate(emit)

	emit("splash:status", "Opening database...")
	emit("splash:progress", 10)
	log.Info("database ready")
	time.Sleep(300 * time.Millisecond)

	emit("splash:status", "Verifying license...")
	emit("splash:progress", 18)
	log.Info("license verified")
	time.Sleep(400 * time.Millisecond)

	emit("splash:status", "Laying the foundation...")
	emit("splash:progress", 30)

	if err := database.Migrate(a.db); err != nil {
		log.Error("running migrations", "err", err)
		emit("splash:error", err.Error())
		return
	}
	log.Info("migrations complete")
	time.Sleep(400 * time.Millisecond)

	emit("splash:status", "Etching the living Word......")
	emit("splash:progress", 35)

	if err := seed.Seed(a.db, func(_ string, pct int) {
		emit("splash:progress", 35+pct*50/100)
	}); err != nil {
		log.Error("seeding", "err", err)
		emit("splash:error", err.Error())
		return
	}
	log.Info("seeding complete")

	emit("splash:status", "Preparing workspace...")
	emit("splash:progress", 90)
	time.Sleep(300 * time.Millisecond)

	emit("splash:status", "Launching!")
	emit("splash:progress", 100)

	// One final eye candy sleep :D
	time.Sleep(1000 * time.Millisecond)

	openMainWindow()

	// Small delay ensures the native window is fully registered in the
	// app's window map before we close the splash. Otherwise the app sees
	// zero windows and terminates (ApplicationShouldTerminateAfterLastWindowClosed).
	// Ideally we'd rely solely on WindowRuntimeReady, but for now now this will do.
	time.Sleep(100 * time.Millisecond)
	splash.Close()
}

// maybeUpdate is the blocking-splash auto-update flow: check (short
// timeout — an offline machine must never hang at boot), download with
// progress, verify, swap, relaunch. Every failure path logs and
// returns so the splash continues into the currently-installed
// version; an update is never allowed to brick a launch.
func (a *App) maybeUpdate(emit func(string, any)) {
	if version == "0.0.0-dev" {
		log.Info("dev build — skipping update check")
		return
	}

	emit("splash:status", "Checking for updates...")
	emit("splash:progress", 4)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	info, err := updates.Check(ctx, version)
	if err != nil {
		log.Warn("update check failed", "err", err)
		return
	}
	if info == nil {
		log.Info("up to date", "version", version)
		return
	}

	log.Info("update available", "current", version, "latest", info.Version)
	emit("splash:status", fmt.Sprintf("Updating to v%s...", info.Version))

	dlCtx, dlCancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer dlCancel()
	err = updates.Apply(dlCtx, info, func(pct int) {
		emit("splash:progress", 4+pct*92/100)
	})
	// Apply only returns on failure — success relaunches and exits.
	log.Error("update failed", "err", err)
	emit("splash:status", "Update failed — starting current version")
	time.Sleep(1200 * time.Millisecond)
}
