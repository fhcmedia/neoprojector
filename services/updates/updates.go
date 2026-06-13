// Package updates implements the splash-screen auto-updater.
//
// GitHub Releases is the update channel: the latest-release API is the
// manifest (it excludes prereleases, so per-commit beta builds are
// never offered to installs), per-asset digests provide integrity, and
// asset URLs are permanent. No credentials are involved anywhere.
//
// This package is used internally by App.Initialize — it is not a
// bound Wails service and generates no frontend bindings.
package updates

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"

	"golang.org/x/mod/semver"
)

const releaseAPI = "https://api.github.com/repos/fhcmedia/neoprojector/releases/latest"

// Info describes an applicable update.
type Info struct {
	Version string // without the leading "v"
	Asset   string
	URL     string
	SHA256  string // hex digest reported by the release API
	Size    int64
}

type ghRelease struct {
	TagName string    `json:"tag_name"`
	Assets  []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name   string `json:"name"`
	Digest string `json:"digest"`
	Size   int64  `json:"size"`
	URL    string `json:"browser_download_url"`
}

// Check returns the newest stable release if it is newer than current,
// nil when already up to date (or when no stable release exists yet).
// The caller owns the timeout via ctx — the splash passes a short one
// so an offline machine never hangs at boot.
func Check(ctx context.Context, current string) (*Info, error) {
	cur := "v" + strings.TrimPrefix(current, "v")
	if !semver.IsValid(cur) {
		return nil, fmt.Errorf("current version %q is not semver", current)
	}

	rel, err := fetchLatest(ctx)
	if err != nil || rel == nil {
		return nil, err
	}
	suffix, err := assetSuffix()
	if err != nil {
		return nil, err
	}
	return evaluate(rel, cur, suffix)
}

// evaluate decides whether rel is an applicable update over the
// current version cur ("v"-prefixed): nil when rel is not newer, an
// Info when it is and carries a digest-bearing asset for this
// platform, an error when the release is malformed for our purposes.
func evaluate(rel *ghRelease, cur, suffix string) (*Info, error) {
	if !semver.IsValid(rel.TagName) || semver.Compare(rel.TagName, cur) <= 0 {
		return nil, nil
	}
	for _, a := range rel.Assets {
		if !strings.HasSuffix(a.Name, suffix) {
			continue
		}
		digest, ok := strings.CutPrefix(a.Digest, "sha256:")
		if !ok || digest == "" {
			return nil, fmt.Errorf("asset %s has no sha256 digest", a.Name)
		}
		return &Info{
			Version: strings.TrimPrefix(rel.TagName, "v"),
			Asset:   a.Name,
			URL:     a.URL,
			SHA256:  digest,
			Size:    a.Size,
		}, nil
	}
	return nil, fmt.Errorf("release %s has no asset matching %q", rel.TagName, suffix)
}

func fetchLatest(ctx context.Context) (*ghRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseAPI, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	// 404 = the repo has prereleases only (or none) — nothing to offer.
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("release API: %s", resp.Status)
	}
	var rel ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, err
	}
	return &rel, nil
}

// assetSuffix must match the artifact names release.yml produces.
func assetSuffix() (string, error) {
	switch runtime.GOOS {
	case "darwin":
		return "-mac.zip", nil
	case "windows":
		return "-windows.zip", nil
	case "linux":
		return "-linux.tar.gz", nil
	}
	return "", fmt.Errorf("no release asset for %s", runtime.GOOS)
}

// Apply downloads the update, verifies its digest, swaps the install,
// and relaunches — it does not return on success. Every error path
// leaves the current install untouched so the caller can boot normally
// on the running version.
func Apply(ctx context.Context, info *Info, progress func(pct int)) error {
	archive, err := download(ctx, info, progress)
	if archive != "" {
		defer os.Remove(archive)
	}
	if err != nil {
		return err
	}
	return swapAndRelaunch(archive)
}

func download(ctx context.Context, info *Info, progress func(pct int)) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, info.URL, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: %s", info.Asset, resp.Status)
	}

	f, err := os.CreateTemp("", "neoprojector-update-*")
	if err != nil {
		return "", err
	}
	name := f.Name()

	h := sha256.New()
	pw := &progressWriter{total: info.Size, fn: progress}
	if _, err := io.Copy(io.MultiWriter(f, h, pw), resp.Body); err != nil {
		f.Close()
		return name, err
	}
	if err := f.Close(); err != nil {
		return name, err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != strings.ToLower(info.SHA256) {
		return name, fmt.Errorf("sha256 mismatch for %s: got %s want %s", info.Asset, got, info.SHA256)
	}
	return name, nil
}

type progressWriter struct {
	total   int64
	written int64
	fn      func(pct int)
}

func (w *progressWriter) Write(p []byte) (int, error) {
	w.written += int64(len(p))
	if w.fn != nil && w.total > 0 {
		w.fn(int(w.written * 100 / w.total))
	}
	return len(p), nil
}
