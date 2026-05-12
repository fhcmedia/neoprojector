package main

import (
	"database/sql"
	"time"

	"neoprojector/database"
	"neoprojector/database/seed"

	"github.com/charmbracelet/log"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type App struct {
	db *sql.DB
}

func NewApp(db *sql.DB) *App {
	return &App{db: db}
}

func (a *App) Initialize() {
	splash := application.Get().Window.Current()
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

	emit("splash:status", "Opening database...")
	emit("splash:progress", 10)
	log.Info("database ready")
	time.Sleep(300 * time.Millisecond)

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
	time.Sleep(300 * time.Millisecond)

	emit("splash:status", "Checking for updates...")
	emit("splash:progress", 85)

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
