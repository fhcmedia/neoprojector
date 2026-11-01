package presentations

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestIsDeckFile(t *testing.T) {
	for p, want := range map[string]bool{
		"a.PPTX": true, "b.ppt": true, "c.pdf": true, "d.odp": true, "e.key": true,
		"f.png": false, "g.mp4": false, "h": false,
	} {
		if IsDeckFile(p) != want {
			t.Errorf("IsDeckFile(%q) = %v", p, !want)
		}
	}
}

// Without PowerPoint the COM path must fail fast (the caller then falls
// back to LibreOffice), never hang.
func TestPowerPointMissingFailsFast(t *testing.T) {
	if runtime.GOOS != "windows" || os.Getenv("NEOPROJECTOR_HAS_POWERPOINT") != "" {
		t.Skip("windows without PowerPoint only")
	}
	start := time.Now()
	err := powerPointToPDF(context.Background(), filepath.Join(t.TempDir(), "x.pptx"), filepath.Join(t.TempDir(), "x.pdf"))
	if err == nil {
		t.Fatal("expected an error without PowerPoint")
	}
	if d := time.Since(start); d > 20*time.Second {
		t.Fatalf("took %v", d)
	}
	t.Logf("err=%v in %v", err, time.Since(start))
}

func TestImageExt(t *testing.T) {
	cases := map[string]string{
		"RIFF\x00\x00\x00\x00WEBPVP8 ": ".webp",
		"\x89PNG\r\n\x1a\nxxxx":        ".png",
		"\xFF\xD8\xFF\xE0":             ".jpg",
	}
	for b, want := range cases {
		if got, err := imageExt([]byte(b)); err != nil || got != want {
			t.Errorf("imageExt(%q) = %q, %v; want %q", b, got, err, want)
		}
	}
	if _, err := imageExt([]byte("<svg onload=x>")); err == nil {
		t.Error("non-image bytes must be refused")
	}
}
