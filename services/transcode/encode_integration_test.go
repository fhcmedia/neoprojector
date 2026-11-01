package transcode

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestEncodeReal runs a real conversion of the HEVC fixture. It needs
// ffmpeg: set NEOPROJECTOR_FFMPEG_DIR to a folder with ffmpeg(.exe) and
// ffprobe(.exe) (e.g. %LOCALAPPDATA%\neoprojector\tools\ffmpeg-9.0.2).
func TestEncodeReal(t *testing.T) {
	dir := os.Getenv("NEOPROJECTOR_FFMPEG_DIR")
	if dir == "" {
		t.Skip("NEOPROJECTOR_FFMPEG_DIR not set")
	}
	exe := ""
	if _, err := os.Stat(filepath.Join(dir, "ffmpeg.exe")); err == nil {
		exe = ".exe"
	}
	tools := Tools{FFmpeg: filepath.Join(dir, "ffmpeg"+exe), FFprobe: filepath.Join(dir, "ffprobe"+exe)}
	in := filepath.Join("..", "media", "testdata", "hevc.mov")
	ctx := context.Background()
	d, err := Duration(ctx, tools, in)
	if err != nil || d <= 0 {
		t.Fatalf("duration %v err %v", d, err)
	}
	out := filepath.Join(t.TempDir(), "out.mp4")
	var last int
	if err := Encode(ctx, tools, in, out, d, func(p int) { last = p }); err != nil {
		t.Fatal(err)
	}
	if st, err := os.Stat(out); err != nil || st.Size() == 0 {
		t.Fatalf("no output: %v", err)
	}
	if last < 0 || last > 99 {
		t.Fatalf("progress %d out of range", last)
	}

	// Cancelling stops ffmpeg and reports the cancellation.
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	if err := Encode(cctx, tools, in, filepath.Join(t.TempDir(), "c.mp4"), d, nil); err == nil {
		t.Fatal("expected an error from a cancelled encode")
	}
}
