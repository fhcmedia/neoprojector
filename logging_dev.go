//go:build !production

package main

import (
	"os"

	charmlog "github.com/charmbracelet/log"
)

// setupLogging configures the global charmlog used by the app + the
// wails slog adapter. Dev build: debug level, color output to stderr.
// Production build (see logging_prod.go) redirects to a file and
// raises the level so a launched .app / .exe doesn't bleed noise to
// the user-facing terminal (or to nowhere on a double-click launch).
func setupLogging() {
	charmlog.SetLevel(charmlog.DebugLevel)
	charmlog.SetOutput(os.Stderr)
}
