package main

import (
	"database/sql"
	"embed"
	"log"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"neoprojector/database"
	"neoprojector/services/bible"
	"neoprojector/services/displays"
	"neoprojector/services/media"
	"neoprojector/services/overlays"
	"neoprojector/services/schedule"
	"neoprojector/services/songs"
	"neoprojector/services/templates"

	"github.com/adrg/xdg"
	charmlog "github.com/charmbracelet/log"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// mediaAssetMiddleware intercepts GET /media-asset/{id} and serves the
// corresponding media file from disk. This lets the frontend render real
// thumbnails and play video/audio without any base64 encoding.
func mediaAssetMiddleware(db *sql.DB, next http.Handler) http.Handler {
	q := database.New(db)
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
		http.ServeFile(w, r, m.Path)
	})
}

//go:embed all:dist
var assets embed.FS

func main() {
	charmlog.SetLevel(charmlog.DebugLevel)

	dbPath, err := xdg.DataFile("neoprojector/neoprojector.db")
	if err != nil {
		log.Fatal("get db path: ", err)
	}
	db, err := database.Open(dbPath)
	if err != nil {
		log.Fatal("open db: ", err)
	}

	wailsLog := slog.New(newCharmSlogHandler(charmlog.Default().WithPrefix("wails")))

	app := application.New(application.Options{
		Name:        "neoprojector",
		Description: "Church presentation software",
		Logger:      wailsLog,
		LogLevel:    slog.LevelDebug,
		Services: []application.Service{
			application.NewService(NewApp(db)),
			application.NewService(songs.New(db)),
			application.NewService(bible.New(db)),
			application.NewService(media.New(db)),
			application.NewService(schedule.New(db)),
			application.NewService(templates.New(db)),
			application.NewService(displays.New(db)),
			application.NewService(overlays.New(db)),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
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
