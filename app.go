package main

import (
	"log"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// App is the bound service the splash window calls into during startup.
type App struct{}

func NewApp() *App {
	return &App{}
}

// Initialize kicks off all startup work and returns immediately so events
// can stream to the splash window during init. The work runs in a goroutine:
// emit "splash:status" / "splash:progress", then spawn the main window and
// close the splash. If init fails, the splash window stays open and shows
// the error event.
//
// Phases are currently simulated with time.Sleep. Real DB open, migrations,
// seeding, and update checks will replace each phase in place.
func (a *App) Initialize() {
	splash := application.Get().Window.Current()
	go runInit(splash)
}

func runInit(splash application.Window) {
	if splash == nil {
		log.Println("splash: ERROR - splash window is nil")
		return
	}
	emit := func(name string, data any) {
		splash.EmitEvent(name, data)
	}

	log.Println("splash: Opening database...")
	emit("splash:status", "Opening database...")
	emit("splash:progress", 10)
	time.Sleep(400 * time.Millisecond)

	log.Println("splash: Running migrations...")
	emit("splash:status", "Running migrations...")
	emit("splash:progress", 30)
	time.Sleep(700 * time.Millisecond)

	log.Println("splash: Seeding scriptures...")
	emit("splash:status", "Seeding scriptures...")
	emit("splash:progress", 60)
	time.Sleep(1200 * time.Millisecond)

	log.Println("splash: Checking for updates...")
	emit("splash:status", "Checking for updates...")
	emit("splash:progress", 85)
	time.Sleep(400 * time.Millisecond)

	log.Println("splash: Ready")
	emit("splash:status", "Ready")
	emit("splash:progress", 100)
	time.Sleep(150 * time.Millisecond)

	openMainWindow()
	// Small delay ensures the native window is fully registered in the
	// app's window map before we close the splash. Otherwise the app sees
	// zero windows and terminates (ApplicationShouldTerminateAfterLastWindowClosed).
	// Ideally we'd rely solely on WindowRuntimeReady, but for now now this will do.
	time.Sleep(100 * time.Millisecond)
	splash.Close()
}
