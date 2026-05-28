// Auto-detect candidate EasyWorship library directories. Same
// contract as the ProPresenter equivalent: return every existing
// path, UI picks the first or shows the list.

package ewimport

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"neoprojector/services/internal/drivescan"
)

// AutoDetectEasyWorship walks well-known EW install paths and
// returns the directories that exist *and* contain a Songs.db /
// SongWords.db pair (so the user sees only paths the importer can
// actually open). Paradox / .ews-bundle locations are also returned
// so the scan can flag them with their unsupported messages.
func (s *Service) AutoDetectEasyWorship(_ context.Context) ([]string, error) {
	candidates := easyWorshipCandidatePaths()
	out := make([]string, 0, len(candidates))
	for _, p := range candidates {
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			out = append(out, p)
		}
	}
	return out, nil
}

// FullScanEasyWorship walks every fixed drive on the machine,
// short-circuits subtrees on first hit, and returns every directory
// that holds a `Songs.db` + `SongWords.db` pair, plus any loose
// `.ews` bundle files. Caller cancels via ctx. Typical runtime:
// 5–30s on a tidy workstation, longer on a hoarder.
func (s *Service) FullScanEasyWorship(ctx context.Context) ([]string, error) {
	marker := func(_ string, hasChild func(string) bool) bool {
		return hasChild("Songs.db") && hasChild("SongWords.db")
	}
	extraSkip := map[string]bool{
		"steam":        true,
		"steamapps":    true,
		"steamlibrary": true,
		"epic games":   true,
		"games":        true,
		"downloads":    true,
	}
	hits, err := drivescan.Scan(ctx, marker, drivescan.Options{
		SkipDirNames:   extraSkip,
		FileExtensions: map[string]bool{".ews": true},
	})
	if err != nil {
		return nil, err
	}
	// Filter: a `.ews` whose name doubles up the Paradox files
	// (Songs.DB / Songs.MB) would already have been emitted as a
	// directory hit; drop dup files.
	seen := map[string]struct{}{}
	out := make([]string, 0, len(hits))
	for _, h := range hits {
		clean := filepath.Clean(h)
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		out = append(out, clean)
	}
	_ = strings.ToLower // import retained for future extras
	return out, nil
}

// easyWorshipCandidatePaths covers EW 6 / 7 / 8 + EW 2009 (Paradox)
// default install paths on Windows. Also includes the Profiles tree
// EW 7.4+ introduced (`Profiles/<name>/Databases/Data`).
func easyWorshipCandidatePaths() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	roots := []string{
		// EW 6/7/8 default
		filepath.Join(home, "Documents", "Softouch", "Easyworship", "Default", "Databases", "Data"),
		filepath.Join(home, "Documents", "Softouch", "Easyworship", "Default", "Databases"),
		// EW 7.4+ profiles
		filepath.Join(home, "Documents", "Softouch", "Easyworship", "Profiles"),
		// EW 2009 default — Paradox-era
		filepath.Join(home, "Documents", "Easyworship 2009", "Default", "Databases"),
		filepath.Join(home, "Documents", "Easyworship 2009"),
		// AppData fallback (some EW 7 installs)
		filepath.Join(os.Getenv("APPDATA"), "Softouch", "Easyworship"),
		filepath.Join(os.Getenv("PROGRAMDATA"), "Softouch", "Easyworship"),
	}
	// Profiles/<name>/Databases/Data expansion — same trick as the
	// ProPresenter Libraries/* expansion.
	out := make([]string, 0, 16)
	for _, root := range roots {
		out = append(out, root)
		base := filepath.Base(root)
		if base == "Profiles" {
			entries, err := os.ReadDir(root)
			if err == nil {
				for _, e := range entries {
					if !e.IsDir() {
						continue
					}
					out = append(out,
						filepath.Join(root, e.Name(), "Databases", "Data"),
						filepath.Join(root, e.Name(), "Databases"),
					)
				}
			}
		}
	}
	return out
}
