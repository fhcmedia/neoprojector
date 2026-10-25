package main

import (
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/hex"
	"log"
	"log/slog"
	"net"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"neoprojector/database"
	"neoprojector/services/backgrounds"
	"neoprojector/services/bible"
	"neoprojector/services/displays"
	"neoprojector/services/media"
	"neoprojector/services/overlays"
	"neoprojector/services/presentations"
	"neoprojector/services/schedule"
	"neoprojector/services/songs"
	"neoprojector/services/templates"

	"github.com/adrg/xdg"
	charmlog "github.com/charmbracelet/log"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// spaFallback is build-tag-gated. See spa_prod.go and spa_dev.go for
// the two implementations. Production wraps the asset handler so
// /splash falls back to /index.html (the embedded dist has no
// matching file — see commentary in spa_prod.go). Dev is an identity
// wrapper: the wails3 dev command proxies to the vite dev server,
// which already does SPA routing AND needs the original path for
// HMR to work — rewriting would break hot reload.

// mediaAssetMiddleware intercepts GET /media-asset/{id} and serves the
// corresponding media file from disk. This lets the frontend render real
// thumbnails and play video/audio without any base64 encoding.
//
// Containment: the file path stored in the DB is validated against the
// known media directory before serving. A row whose path escapes the
// media dir (legacy data, tampered DB) is treated as not found —
// otherwise http.ServeFile would happily serve /etc/passwd given the
// right row.
func mediaAssetMiddleware(db *sql.DB, next http.Handler) http.Handler {
	q := database.New(db)
	mediaDir := mediaStorageDir()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/media-asset/") {
			next.ServeHTTP(w, r)
			return
		}
		idStr := strings.TrimPrefix(r.URL.Path, "/media-asset/")
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		m, err := q.MediaByID(r.Context(), id)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		clean := filepath.Clean(m.Path)
		if mediaDir == "" || !strings.HasPrefix(clean, mediaDir+string(filepath.Separator)) {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, clean)
	})
}

// startMediaServer runs media-asset serving on a real loopback TCP
// socket instead of through the wails webview asset bridge. On
// Windows, that bridge buffers an entire HTTP response into memory
// before handing it to WebView2 (see internal/assetserver/webview/
// responsewriter_windows.go in the wails module — Write() appends to
// an unbounded bytes.Buffer, Finish() hands the whole thing off in
// one PutByteContent call), synchronously on the UI thread. A small
// image is a harmless blip; a several-minute video response is large
// enough to freeze or crash the app. macOS/Linux back this with real
// incremental streaming and aren't affected — this is Windows-only,
// but there's no reason to special-case the platform when a plain
// http.Server sidesteps the bug everywhere.
//
// Reuses mediaAssetMiddleware completely unchanged — same DB lookup,
// same path-containment check, same http.ServeFile (which already
// handles Range/seek correctly; the bug was never in that code path).
//
// The token gates the socket: unlike the wails custom-scheme handler
// (only reachable from inside this app's own webview), a loopback
// TCP port is reachable by any process on the machine, including
// another browser tab via DNS rebinding. Requiring a per-launch
// random token keeps media reads scoped to this app instance.
func startMediaServer(db *sql.DB) (port int, token string, err error) {
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		return 0, "", err
	}
	token = hex.EncodeToString(tokenBytes)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, "", err
	}

	assets := mediaAssetMiddleware(db, http.NotFoundHandler())
	mux := http.NewServeMux()
	mux.HandleFunc("/media-asset/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("t") != token {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		assets.ServeHTTP(w, r)
	})

	server := &http.Server{Handler: mux}
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Print("media server stopped: ", err)
		}
	}()

	return listener.Addr().(*net.TCPAddr).Port, token, nil
}

// mediaStorageDir returns the absolute, cleaned path to the app's
// media storage directory. Used by the asset middleware to enforce
// containment. Returns "" on lookup failure so callers can treat any
// request as not-found rather than serving from an unknown root.
func mediaStorageDir() string {
	p, err := xdg.DataFile("neoprojector/media/.touch")
	if err != nil {
		return ""
	}
	return filepath.Clean(filepath.Dir(p))
}

//go:embed all:dist
var assets embed.FS

// version is stamped by release builds via
// `-ldflags "-X main.version=<semver>"` (see the Taskfile build:*
// tasks). The default marks a dev build and disables the auto-updater.
var version = "0.0.0-dev"

func main() {
	setupLogging()

	dbPath, err := xdg.DataFile("neoprojector/neoprojector.db")
	if err != nil {
		log.Fatal("get db path: ", err)
	}
	db, err := database.Open(dbPath)
	if err != nil {
		log.Fatal("open db: ", err)
	}

	mediaServerPort, mediaServerToken, err := startMediaServer(db)
	if err != nil {
		log.Fatal("start media server: ", err)
	}

	wailsLog := slog.New(newCharmSlogHandler(charmlog.Default().WithPrefix("wails")))

	app := application.New(application.Options{
		Name:        "neoprojector",
		Description: "Church presentation software",
		Logger:      wailsLog,
		LogLevel:    slog.LevelDebug,
		Services: []application.Service{
			application.NewService(NewApp(db, mediaServerPort, mediaServerToken)),
			application.NewService(songs.New(db)),
			application.NewService(bible.New(db)),
			application.NewService(media.New(db)),
			application.NewService(schedule.New(db)),
			application.NewService(templates.New(db)),
			application.NewService(displays.New(db)),
			application.NewService(overlays.New(db)),
			application.NewService(presentations.New(db)),
			application.NewService(backgrounds.New(db)),
		},
		Assets: application.AssetOptions{
			Handler: spaFallback(application.AssetFileServerFS(assets)),
			Middleware: func(next http.Handler) http.Handler {
				return mediaAssetMiddleware(db, next)
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	openSplashWindow()

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

func openSplashWindow() *application.WebviewWindow {
	return application.Get().Window.NewWithOptions(application.WebviewWindowOptions{
		Name:            "splash",
		Title:           "neoprojector",
		Width:           512,
		Height:          256,
		Frameless:       true,
		DisableResize:   true,
		DevToolsEnabled: false,
		InitialPosition: application.WindowCentered,
		URL: "/splash",
	})
}

func openMainWindow() *application.WebviewWindow {
	win := application.Get().Window.NewWithOptions(application.WebviewWindowOptions{
		Name:                       "main",
		Title:                      "neoprojector",
		Width:                      1024,
		Height:                     768,
		InitialPosition:            application.WindowCentered,
		URL:                        "/",
		EnableFileDrop:             true,
		DefaultContextMenuDisabled: true,
	})

	// Forward file drops to the frontend. Wails fires the WindowFilesDropped
	// event whenever native code reports a drop on an element marked with
	// `data-file-drop-target`. We re-emit it as a plain frontend event so the
	// React side can react regardless of where the drop landed.
	win.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		ctx := e.Context()
		paths := ctx.DroppedFiles()
		target := ctx.DropTargetDetails()
		payload := map[string]any{
			"paths": paths,
		}
		if target != nil {
			payload["target_id"] = target.ElementID
			payload["target_attrs"] = target.Attributes
		}
		win.EmitEvent("media:files-dropped", payload)
	})

	return win
}
