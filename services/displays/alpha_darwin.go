//go:build darwin

package displays

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

static void npSetWindowAlpha(void *win, double alpha) {
	[(NSWindow *)win setAlphaValue:alpha];
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// setWindowAlpha makes a window see-through (0) or opaque (255). Must
// run on the main thread (callers wrap it in application.InvokeSync).
// A see-through NSWindow is still on screen, so WKWebView keeps
// painting it while the old version's window shows underneath.
func setWindowAlpha(win *application.WebviewWindow, alpha byte) {
	p := win.NativeWindow()
	if p == nil {
		return
	}
	C.npSetWindowAlpha(p, C.double(float64(alpha)/255))
}
