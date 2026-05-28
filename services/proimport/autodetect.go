// Auto-detect candidate ProPresenter library directories on the
// current machine. Returns every path that actually exists so the UI
// can either pick the first or surface the list for the user to
// choose. We don't open the libraries here — the scan call does that.

package proimport

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"neoprojector/services/internal/drivescan"
)

// AutoDetectProPresenter returns directories likely to contain a
// ProPresenter library on this OS. Each entry is a real path that
// passes a stat check. Order: ProPresenter 7 paths first (most
// common today), then 6, then 4/5 fallbacks.
//
// UI usage: take the first entry, drop it into the path input, run
// Scan. If empty, prompt for manual selection.
func (s *Service) AutoDetectProPresenter(_ context.Context) ([]string, error) {
	candidates := proPresenterCandidatePaths()
	out := make([]string, 0, len(candidates))
	for _, p := range candidates {
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			out = append(out, p)
		}
	}
	return out, nil
}

// FullScanProPresenter walks every fixed drive looking for
// directories that contain at least one ProPresenter document file
// (.pro4 / .pro5 / .pro6 / .pro). Each hit is the parent directory,
// matching what the manual scan accepts. Subtree short-circuits on
// hit so we don't enumerate every song file inside a 5000-song
// library.
func (s *Service) FullScanProPresenter(ctx context.Context) ([]string, error) {
	// Marker: ANY pro file lives directly in this directory.
	marker := func(_ string, hasChildExt func(string) bool) bool {
		return hasChildExt(".pro6") || hasChildExt(".pro5") || hasChildExt(".pro4") || hasChildExt(".pro")
	}
	// Adapt: drivescan.MarkerFn passes a name presence-checker, but
	// we want an extension-presence one. Wrap the hasChild closure.
	wrap := func(dir string, hasChild func(name string) bool) bool {
		// Re-read the dir to enumerate by extension. Cheap because
		// drivescan just listed it; the kernel cache is hot.
		entries, err := os.ReadDir(dir)
		if err != nil {
			return false
		}
		exts := map[string]bool{}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			exts[strings.ToLower(filepath.Ext(e.Name()))] = true
		}
		hasExt := func(ext string) bool { return exts[ext] }
		_ = hasChild
		return marker(dir, hasExt)
	}
	extraSkip := map[string]bool{
		"steam":        true,
		"steamapps":    true,
		"steamlibrary": true,
		"epic games":   true,
		"games":        true,
		"downloads":    true,
	}
	hits, err := drivescan.Scan(ctx, wrap, drivescan.Options{
		SkipDirNames: extraSkip,
	})
	if err != nil {
		return nil, err
	}
	return hits, nil
}

// proPresenterCandidatePaths returns the OS-flavoured locations
// where ProPresenter installs / users put libraries. The walker
// expands any wildcard (Libraries/* — Pro7 supports multiple named
// libraries side by side).
func proPresenterCandidatePaths() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	roots := []string{
		// ProPresenter 7 — Windows default
		filepath.Join(home, "Documents", "ProPresenter", "Libraries"),
		filepath.Join(home, "Documents", "ProPresenter"),
		// ProPresenter 6 — Windows default
		filepath.Join(home, "Documents", "ProPresenter6", "Libraries"),
		filepath.Join(home, "Documents", "ProPresenter6"),
		// ProPresenter 5 / 4
		filepath.Join(home, "Documents", "ProPresenter5", "Libraries"),
		filepath.Join(home, "Documents", "ProPresenter5"),
		filepath.Join(home, "Documents", "ProPresenter4"),
		// macOS conventions (NP isn't macOS yet, but cheap to include
		// so the same binary keeps working when we cross-build).
		filepath.Join(home, "Library", "Application Support", "ProPresenter6"),
		filepath.Join(home, "Library", "Application Support", "ProPresenter7"),
	}

	out := make([]string, 0, 16)
	for _, root := range roots {
		out = append(out, root)
		// Expand a Libraries/ folder into each named library it
		// contains — operators often store multiple libraries
		// (English, Spanish, kids, …) and would pick one to import.
		base := filepath.Base(root)
		if base == "Libraries" {
			entries, err := os.ReadDir(root)
			if err == nil {
				for _, e := range entries {
					if e.IsDir() {
						out = append(out, filepath.Join(root, e.Name()))
					}
				}
			}
		}
	}
	return out
}
