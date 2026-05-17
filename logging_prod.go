//go:build production

package main

import (
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/adrg/xdg"
	charmlog "github.com/charmbracelet/log"
)

// setupLogging — production variant. Writes to a rolling-ish log file
// inside xdg state dir; falls back to discarding output entirely if
// even the file open fails (we never want a built .app or .exe to
// shout into a terminal the user didn't ask for). Info-level so a
// crash report still has breadcrumbs without the dev-mode flood.
//
// File location:
//   - macOS:  ~/Library/Application Support/neoprojector/logs/app.log
//   - Linux:  $XDG_STATE_HOME/neoprojector/logs/app.log (or ~/.local/state/…)
//   - Windows: %LocalAppData%\neoprojector\logs\app.log
func setupLogging() {
	charmlog.SetLevel(charmlog.InfoLevel)

	logPath, err := xdg.StateFile(filepath.Join("neoprojector", "logs", "app.log"))
	if err != nil {
		charmlog.SetOutput(io.Discard)
		return
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		charmlog.SetOutput(io.Discard)
		return
	}
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		charmlog.SetOutput(io.Discard)
		return
	}
	charmlog.SetOutput(f)
	charmlog.SetReportTimestamp(true)
	charmlog.SetTimeFormat(time.RFC3339)
}
