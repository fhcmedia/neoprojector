package main

import (
	"embed"
	"log"
	"log/slog"

	"neoprojector/bible"
	"neoprojector/media"
	"neoprojector/schedule"
	"neoprojector/songs"

	charmlog "github.com/charmbracelet/log"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:dist
var assets embed.FS

func main() {
	charmlog.SetLevel(charmlog.DebugLevel)

	wailsLog := slog.New(newCharmSlogHandler(charmlog.Default().WithPrefix("wails")))

	app := application.New(application.Options{
		Name:        "neoprojector",
		Description: "Church presentation software",
		Logger:      wailsLog,
		LogLevel:    slog.LevelDebug,
		Services: []application.Service{
			application.NewService(NewApp()),
			application.NewService(songs.New()),
			application.NewService(bible.New()),
			application.NewService(media.New()),
			application.NewService(schedule.New()),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
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
	return application.Get().Window.NewWithOptions(application.WebviewWindowOptions{
		Name:            "main",
		Title:           "neoprojector",
		Width:           1024,
		Height:          768,
		InitialPosition: application.WindowCentered,
		URL:             "/",
	})
}
