//go:build !windows

package displays

import "github.com/wailsapp/wails/v3/pkg/application"

// setWindowAlpha is Windows-only (instant updates there); a no-op here.
func setWindowAlpha(*application.WebviewWindow, byte) {}
