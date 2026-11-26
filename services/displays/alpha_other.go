//go:build !windows && !darwin

package displays

import "github.com/wailsapp/wails/v3/pkg/application"

// setWindowAlpha is a no-op on Linux (no see-through handoff there).
func setWindowAlpha(*application.WebviewWindow, byte) {}
