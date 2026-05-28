// Package ewimport implements the EasyWorship library importer.
//
// Supported sources in this build:
//   - EasyWorship 6 / 7 / 8 song libraries (SQLite-based):
//       Songs.db   — song metadata
//       SongWords.db — RTF slide text keyed by song id
//     Detected by directory contents; opened read-only so the EW app
//     can keep running while the import is in flight (within reason —
//     SQLite locking still applies during writes).
//
//   - EasyWorship 7+ .ews export bundles (ZIP-wrapped): detected and
//     flagged in scan output, parser pending.
//
//   - EasyWorship 2009 Paradox libraries (Songs.DB + Songs.MB):
//     detected, flagged, parser pending. Paradox is a proprietary
//     binary format from Borland — a minimal Go reader is on the
//     follow-up plan.
//
// Conflict policy + summary semantics mirror the proimport service so
// the UI can share state between the two tabs.
package ewimport

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"neoprojector/database"

	_ "modernc.org/sqlite"
)

// Service is the Wails-bound importer. Stateless — every call opens
// its own SQLite handles + writes to the NP DB.
type Service struct {
	db *sql.DB
	q  *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{db: db, q: database.New(db)}
}

func (*Service) ServiceName() string { return "ewimport" }

// ConflictPolicy mirrors proimport.ConflictPolicy. Kept as a separate
// type so each importer can evolve independently without one's enum
// changing the other's wire signature.
type ConflictPolicy string

const (
	ConflictSkip      ConflictPolicy = "skip"
	ConflictRename    ConflictPolicy = "rename"
	ConflictOverwrite ConflictPolicy = "overwrite"
)

// ScanItem is one entry produced by ScanEasyWorship. For EW the
// "path" identifies the song uniquely within the library: it's the
// absolute path of the Songs.db file with the rowid appended after a
// `#`. The import path treats the encoded handle as opaque.
type ScanItem struct {
	Path        string `json:"path"`
	Format      string `json:"format"` // "ew_sqlite" | "ew_ews_zip" | "ew_paradox"
	Library     string `json:"library"`
	Title       string `json:"title"`
	Author      string `json:"author"`
	Copyright   string `json:"copyright"`
	Administrator string `json:"administrator"`
	CCLINumber  string `json:"ccli_number"`
	SongNumber  string `json:"song_number"`
	ThemeName   string `json:"theme_name"`
	Sections    int    `json:"sections"`
	Slides      int    `json:"slides"`
	Lines       int    `json:"lines"`
	Supported   bool   `json:"supported"`
	Reason      string `json:"reason"`
}

// ImportSummary mirrors proimport's. Same shape for UI reuse.
type ImportSummary struct {
	Requested  int      `json:"requested"`
	Imported   int      `json:"imported"`
	Skipped    int      `json:"skipped"`
	Renamed    int      `json:"renamed"`
	Overwrote  int      `json:"overwrote"`
	Failed     int      `json:"failed"`
	Warnings   []string `json:"warnings"`
	NewSongIDs []int64  `json:"new_song_ids"`
}

// ScanEasyWorship walks dir looking for EasyWorship libraries. A
// library can be:
//   - a folder containing Songs.db + SongWords.db (EW 6/7/8 — most common)
//   - a folder containing Songs.DB + Songs.MB (EW 2009 Paradox — flagged)
//   - one or more .ews ZIP files (export bundles — flagged)
//
// For each library found, every song row turns into one ScanItem.
// Walk depth is capped so a misclick on Documents/ doesn't enumerate
// the whole drive.
func (s *Service) ScanEasyWorship(_ context.Context, dir string) ([]ScanItem, error) {
	if strings.TrimSpace(dir) == "" {
		return nil, errors.New("scan: empty directory")
	}
	info, err := os.Stat(dir)
	if err != nil {
		return nil, fmt.Errorf("scan: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("scan: %s is not a directory", dir)
	}
	root := filepath.Clean(dir)
	const maxDepth = 14

	libraries := make([]string, 0, 4)
	paradox := make([]string, 0, 2)
	ewsZips := make([]string, 0, 8)

	walkErr := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			rel, _ := filepath.Rel(root, path)
			if depth := strings.Count(rel, string(filepath.Separator)); depth >= maxDepth {
				return filepath.SkipDir
			}
			// SQLite library: Songs.db + SongWords.db side by side.
			if hasFile(path, "Songs.db") && hasFile(path, "SongWords.db") {
				libraries = append(libraries, path)
				return nil
			}
			// Paradox library: Songs.DB + Songs.MB side by side.
			if hasFile(path, "Songs.DB") && hasFile(path, "Songs.MB") &&
				!hasFile(path, "SongWords.db") {
				paradox = append(paradox, path)
				return nil
			}
			return nil
		}
		if strings.EqualFold(filepath.Ext(path), ".ews") {
			ewsZips = append(ewsZips, path)
		}
		return nil
	})
	if walkErr != nil {
		return nil, fmt.Errorf("scan: %w", walkErr)
	}

	out := make([]ScanItem, 0, 64)
	for _, lib := range libraries {
		items, err := scanSQLiteLibrary(lib)
		if err != nil {
			out = append(out, ScanItem{
				Path:      lib,
				Format:    "ew_sqlite",
				Library:   lib,
				Title:     filepath.Base(lib),
				Supported: false,
				Reason:    fmt.Sprintf("library open failed: %v", err),
			})
			continue
		}
		out = append(out, items...)
	}
	for _, p := range paradox {
		out = append(out, ScanItem{
			Path:      p,
			Format:    "ew_paradox",
			Library:   p,
			Title:     filepath.Base(p) + " (EasyWorship 2009)",
			Supported: false,
			Reason:    "EW 2009 Paradox parser is queued — open this library in EW 7+ to upgrade, or wait for the next build.",
		})
	}
	for _, z := range ewsZips {
		items, err := scanEwsBundle(z)
		if err != nil {
			out = append(out, ScanItem{
				Path:      z,
				Format:    "ew_ews_zip",
				Library:   z,
				Title:     filepath.Base(z),
				Supported: false,
				Reason:    fmt.Sprintf(".ews extract failed: %v", err),
			})
			continue
		}
		out = append(out, items...)
	}
	return out, nil
}

func hasFile(dir, name string) bool {
	_, err := os.Stat(filepath.Join(dir, name))
	return err == nil
}

// ImportOptions tweaks the import beyond what conflict policy
// captures. Kept as a struct so future toggles (strip-chord-lines,
// import-as-presentation, …) don't keep bloating the call signature.
type ImportOptions struct {
	// StripFirstLine drops the first non-empty line of every slide
	// before persisting. EW operators commonly put a label / title
	// on the first line of each slide ("Verse 1", song name, slide
	// number, etc.). When that label isn't part of the lyric they
	// want sung, flipping this on cleans every slide in one pass.
	StripFirstLine bool
}

// ImportEasyWorship pulls every selected ScanItem into the NP library.
// Same partial-success contract as proimport: per-row failures land
// in Warnings, the batch keeps going.
func (s *Service) ImportEasyWorship(
	ctx context.Context,
	paths []string,
	policy ConflictPolicy,
	opts ImportOptions,
) (ImportSummary, error) {
	if policy != ConflictSkip && policy != ConflictRename && policy != ConflictOverwrite {
		policy = ConflictSkip
	}
	sum := ImportSummary{
		Requested:  len(paths),
		Warnings:   []string{},
		NewSongIDs: []int64{},
	}
	for _, p := range paths {
		var (
			libPath string
			rowid   int64
			err     error
			cleanup func()
		)
		if strings.Contains(p, "!") {
			// .ews bundle handle: extract once and reuse the temp
			// directory for this single song. Multi-song bundle
			// imports could share the extraction, but the simpler
			// per-song path keeps state straightforward.
			bundle, id, ok := decodeEwsHandle(p)
			if !ok {
				sum.Skipped++
				sum.Warnings = append(sum.Warnings, fmt.Sprintf("%s: bad .ews handle", p))
				continue
			}
			tmp, exErr := extractEwsBundle(bundle)
			if exErr != nil {
				sum.Failed++
				sum.Warnings = append(sum.Warnings, fmt.Sprintf("%s: extract: %v", bundle, exErr))
				continue
			}
			libDir, findErr := findEwSQLiteLibrary(tmp)
			if findErr != nil {
				_ = os.RemoveAll(tmp)
				sum.Failed++
				sum.Warnings = append(sum.Warnings, fmt.Sprintf("%s: %v", bundle, findErr))
				continue
			}
			libPath = libDir
			rowid = id
			cleanup = func() { _ = os.RemoveAll(tmp) }
		} else {
			lib, id, ok := decodeSQLiteHandle(p)
			if !ok {
				sum.Skipped++
				sum.Warnings = append(sum.Warnings, fmt.Sprintf("%s: not a supported handle", p))
				continue
			}
			libPath = lib
			rowid = id
		}

		id, action, err := s.importSQLiteSong(ctx, libPath, rowid, policy, opts)
		if cleanup != nil {
			cleanup()
		}
		if err != nil {
			sum.Failed++
			sum.Warnings = append(sum.Warnings, fmt.Sprintf("%s: %v", p, err))
			continue
		}
		switch action {
		case "imported":
			sum.Imported++
			sum.NewSongIDs = append(sum.NewSongIDs, id)
		case "renamed":
			sum.Renamed++
			sum.NewSongIDs = append(sum.NewSongIDs, id)
		case "overwrote":
			sum.Overwrote++
			sum.NewSongIDs = append(sum.NewSongIDs, id)
		case "skipped":
			sum.Skipped++
		}
	}
	return sum, nil
}
