// Package transcode makes "playback copies" of videos with ffmpeg: H.264,
// at most 1080p/60fps, 8-bit 4:2:0 — formats every PC decodes smoothly.
//
// ffmpeg isn't shipped with the app (it would add ~100 MB to every
// download and update). On Windows the first conversion fetches a pinned
// ffmpeg release from GitHub, verifies its SHA-256, and keeps ffmpeg.exe
// and ffprobe.exe in the app's data folder. Elsewhere ffmpeg is taken
// from PATH.
package transcode

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// Pinned ffmpeg build (gyan.dev "essentials", via GitHub releases).
// Bump all three together; the digest is GitHub's published sha256.
const (
	ffmpegVersion = "9.0.2"
	ffmpegURL     = "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip"
	ffmpegSHA256  = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba"
)

// Tools are the paths of the ffmpeg binaries to run.
type Tools struct {
	FFmpeg  string
	FFprobe string
}

var ensureMu sync.Mutex

// Ensure returns usable ffmpeg/ffprobe, downloading the pinned build into
// dataDir on first use (Windows). progress receives 0–100 while
// downloading. Safe to call concurrently; only one download runs.
func Ensure(ctx context.Context, dataDir string, progress func(pct int)) (Tools, error) {
	ensureMu.Lock()
	defer ensureMu.Unlock()

	if runtime.GOOS != "windows" {
		ff, err1 := exec.LookPath("ffmpeg")
		fp, err2 := exec.LookPath("ffprobe")
		if err1 != nil || err2 != nil {
			return Tools{}, errors.New("ffmpeg is not installed — install it to convert videos")
		}
		return Tools{FFmpeg: ff, FFprobe: fp}, nil
	}

	dir := filepath.Join(dataDir, "ffmpeg-"+ffmpegVersion)
	t := Tools{
		FFmpeg:  filepath.Join(dir, "ffmpeg.exe"),
		FFprobe: filepath.Join(dir, "ffprobe.exe"),
	}
	// Leftovers of an interrupted download/unpack (app closed midway).
	if parts, _ := filepath.Glob(filepath.Join(dir, "*.part")); len(parts) > 0 {
		for _, p := range parts {
			os.Remove(p)
		}
	}
	if fileExists(t.FFmpeg) && fileExists(t.FFprobe) {
		return t, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Tools{}, err
	}
	zipPath, err := DownloadVerified(ctx, ffmpegURL, ffmpegSHA256, dir, progress)
	if zipPath != "" {
		defer os.Remove(zipPath)
	}
	if err != nil {
		return Tools{}, fmt.Errorf("download ffmpeg: %w", err)
	}
	if err := extract(zipPath, map[string]string{
		"/bin/ffmpeg.exe":  t.FFmpeg,
		"/bin/ffprobe.exe": t.FFprobe,
	}); err != nil {
		return Tools{}, fmt.Errorf("unpack ffmpeg: %w", err)
	}
	return t, nil
}

// DownloadVerified fetches url into a temp file in dir, verifying its
// sha256 as it streams; the returned path (also on error, when a file
// was created) is the caller's to remove. progress gets 0–100.
func DownloadVerified(ctx context.Context, url, wantSHA, dir string, progress func(int)) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%s", resp.Status)
	}
	f, err := os.CreateTemp(dir, "download-*.part")
	if err != nil {
		return "", err
	}
	name := f.Name()
	h := sha256.New()
	pw := &progressWriter{total: resp.ContentLength, fn: progress}
	if _, err := io.Copy(io.MultiWriter(f, h, pw), resp.Body); err != nil {
		f.Close()
		return name, err
	}
	if err := f.Close(); err != nil {
		return name, err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != wantSHA {
		return name, fmt.Errorf("sha256 mismatch: got %s", got)
	}
	return name, nil
}

// extract copies zip entries whose name ends with a key of want to the
// mapped destination, via a temp file + rename so a crash never leaves a
// half-written exe that later looks "installed".
func extract(zipPath string, want map[string]string) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer zr.Close()
	found := 0
	for _, f := range zr.File {
		for suffix, dst := range want {
			if !strings.HasSuffix(f.Name, suffix) {
				continue
			}
			if err := extractOne(f, dst); err != nil {
				return err
			}
			found++
		}
	}
	if found != len(want) {
		return fmt.Errorf("archive is missing ffmpeg binaries (%d/%d found)", found, len(want))
	}
	return nil
}

func extractOne(f *zip.File, dst string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, rc); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

type progressWriter struct {
	total, written int64
	fn             func(int)
	last           int
}

func (w *progressWriter) Write(p []byte) (int, error) {
	w.written += int64(len(p))
	if w.fn != nil && w.total > 0 {
		pct := int(w.written * 100 / w.total)
		if pct != w.last {
			w.last = pct
			w.fn(pct)
		}
	}
	return len(p), nil
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir() && st.Size() > 0
}
