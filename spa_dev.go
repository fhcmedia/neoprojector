//go:build !production

package main

import "net/http"

// spaFallback (dev): identity wrapper. In dev mode the wails3 dev
// command proxies asset requests to the vite dev server, which
// already handles SPA routing AND relies on receiving the original
// URL path for HMR (Vite tracks requested module URLs by path; a
// /splash → /index.html rewrite makes it think the splash module
// vanished, breaking hot reload). Rewriting also masks 404s vite
// would otherwise surface as overlay errors — useful feedback during
// development.
func spaFallback(next http.Handler) http.Handler {
	return next
}
