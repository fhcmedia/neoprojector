//go:build windows

package displays

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

// setWindowAlpha makes a window see-through (0) or opaque (255). A
// see-through window still counts as visible, so WebView2 keeps
// painting it — unlike a window hidden or covered by another.
func setWindowAlpha(win *application.WebviewWindow, alpha byte) {
	hwnd := w32.HWND(uintptr(win.NativeWindow()))
	if hwnd == 0 {
		return
	}
	style := uint32(w32.GetWindowLong(hwnd, w32.GWL_EXSTYLE))
	if alpha == 255 {
		w32.SetLayeredWindowAttributes(hwnd, 0, 255, w32.LWA_ALPHA)
		w32.SetWindowLong(hwnd, w32.GWL_EXSTYLE, style&^w32.WS_EX_LAYERED)
		return
	}
	w32.SetWindowLong(hwnd, w32.GWL_EXSTYLE, style|w32.WS_EX_LAYERED)
	w32.SetLayeredWindowAttributes(hwnd, 0, alpha, w32.LWA_ALPHA)
}
