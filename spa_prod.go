//go:build production

package main

import (
	"net/http"
	"path"
	"strings"
)

// spaFallback (production): rewrites the incoming request URL to
// /index.html for any extension-less path that isn't a known
// framework route. Wails v3's AssetFileServerFS only serves files
// that exist on disk verbatim — it has no SPA fallback. Without this
// wrapper, opening the splash window with URL "/splash" 404s
// (there's no dist/splash), the WebView shows a blank page, no JS
// runs, and the app hangs forever waiting for an App.Initialize()
// call that never comes.
//
// The rewrite leaves /wails/* (runtime IPC), /media-asset/* (our
// own middleware), and anything with a file extension (CSS, JS,
// images, fonts, …) untouched so they hit the real asset server.
func spaFallback(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.HasPrefix(p, "/wails/") ||
			strings.HasPrefix(p, "/media-asset/") ||
			strings.HasPrefix(p, "/assets/") ||
			path.Ext(p) != "" {
			next.ServeHTTP(w, r)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/index.html"
		next.ServeHTTP(w, r2)
	})
}
