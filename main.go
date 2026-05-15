package main

import (
	"embed"
	"log"
	"log/slog"

	"io/fs"
	"net/http"
	"path"
	"strings"
	"neoprojector/database"
	"neoprojector/services/bible"
	"neoprojector/services/media"
	"neoprojector/services/schedule"
	"neoprojector/services/songs"
	"neoprojector/services/templates"

	"github.com/adrg/xdg"
	charmlog "github.com/charmbracelet/log"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

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

	assetsFS, err := fs.Sub(assets, "dist")
	if err != nil {
		log.Fatal(err)
	}

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
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assetsFS),
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					// Don't interfere with Wails or Vite internal requests
					if strings.HasPrefix(r.URL.Path, "/wails/") || strings.HasPrefix(r.URL.Path, "/@") {
						next.ServeHTTP(w, r)
						return
					}

					// Serve local media files
					if strings.HasPrefix(r.URL.Path, "/media/") {
						mediaDir, _ := xdg.DataFile("neoprojector/media/.touch")
						mediaDir = path.Dir(mediaDir)
						filePath := path.Join(mediaDir, strings.TrimPrefix(r.URL.Path, "/media/"))
						http.ServeFile(w, r, filePath)
						return
					}

					// Only rewrite if it's a potential SPA route (no file extension)
					// and it's not already the root.
					ext := path.Ext(r.URL.Path)
					if ext == "" && r.URL.Path != "/" {
						_, err := assetsFS.Open(r.URL.Path[1:])
						if err != nil {
							r.URL.Path = "/"
						}
					}
					next.ServeHTTP(w, r)
				})
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
