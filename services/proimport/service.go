// Package proimport implements the ProPresenter library importer.
//
// Scope of this build:
//   - ProPresenter 4/5/6 documents (.pro4 / .pro5 / .pro6): XML format,
//     parsed natively. Songs become NP songs with sections + lines.
//   - ProPresenter 7 documents (.pro): binary protobuf. Detected and
//     reported as unsupported with a reason — Pro7 support needs a
//     vendored .proto schema (greyshirtguy/ProPresenter7-protoFiles)
//     and a generated decoder, which is a separable add-on.
//
// CCLI metadata, themes, and media references are surfaced in the scan
// preview and import summary as informational fields. Persisting CCLI
// fields onto songs needs a schema migration (songs.author /
// songs.copyright / songs.ccli_number) — once that lands, the import
// path here can fill them in without further UI work.
package proimport

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"neoprojector/database"
)

// Service is bound to the frontend via Wails. Stateless — every call
// scans / imports against the file system and the SQLite DB.
type Service struct {
	db *sql.DB
	q  *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{db: db, q: database.New(db)}
}

func (*Service) ServiceName() string { return "proimport" }

// ConflictPolicy controls what happens when an imported song's title
// already exists in the library (the unique index forbids duplicates).
type ConflictPolicy string

const (
	ConflictSkip      ConflictPolicy = "skip"
	ConflictRename    ConflictPolicy = "rename"
	ConflictOverwrite ConflictPolicy = "overwrite"
)

// ScanItem is one entry produced by ScanProPresenter — what was found
// at a given path, whether it's importable, and a short preview of
// metadata so the UI can show the user what they'll be importing
// before committing.
type ScanItem struct {
	Path         string   `json:"path"`
	Filename     string   `json:"filename"`
	Format       string   `json:"format"`     // "pro4" | "pro5" | "pro6" | "pro7"
	Kind         string   `json:"kind"`       // "song" | "presentation" | "unknown"
	Title        string   `json:"title"`      // best-effort title (CCLISongTitle or filename)
	Author       string   `json:"author"`     // CCLI artist credits (informational)
	Copyright    string   `json:"copyright"`  // CCLI copyright year (informational)
	CCLINumber   string   `json:"ccli_number"`
	Publisher    string   `json:"publisher"`
	Sections     int      `json:"sections"`
	Slides       int      `json:"slides"`
	Lines        int      `json:"lines"`
	MediaRefs    []string `json:"media_refs"` // referenced media filenames (informational v1)
	FontRefs     []string `json:"font_refs"`  // referenced custom font names
	Supported    bool     `json:"supported"`  // false → import will skip this entry
	Reason       string   `json:"reason"`     // why unsupported / what to warn about
	Encrypted    bool     `json:"encrypted"`
	SmartList    bool     `json:"smart_list"` // smart-playlist queries — skipped
}

// ScanProPresenter walks dir recursively and produces a preview list
// of every ProPresenter document it understands. Symlinks are not
// followed (avoids cycles + unintended exfil of files outside the
// chosen tree). Returns an empty list when dir is empty or
// inaccessible — the caller surfaces "nothing found" via the count.
//
// The walk is bounded to depth 8 to keep pathological nested
// directories from stalling the UI; ProPresenter's own libraries
// nest 2–3 deep.
func (s *Service) ScanProPresenter(_ context.Context, dir string) ([]ScanItem, error) {
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

	out := make([]ScanItem, 0, 32)
	walkErr := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // swallow per-file walk errors, keep scanning
		}
		if d.IsDir() {
			rel, _ := filepath.Rel(root, path)
			if depth := strings.Count(rel, string(filepath.Separator)); depth >= maxDepth {
				return filepath.SkipDir
			}
			return nil
		}
		item, ok := classifyAndPreview(path)
		if !ok {
			return nil
		}
		out = append(out, item)
		return nil
	})
	if walkErr != nil {
		return nil, fmt.Errorf("scan: %w", walkErr)
	}
	return out, nil
}

// classifyAndPreview inspects one file path and, if it looks like a
// ProPresenter document, returns a populated ScanItem. Returns
// (zero, false) for anything else so the walker can skip it without
// reading the file.
func classifyAndPreview(path string) (ScanItem, bool) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".pro4", ".pro5", ".pro6":
		item := scanProXML(path, ext)
		return item, true
	case ".pro":
		// Pro7 binary protobuf. Detected, not parsed.
		filename := filepath.Base(path)
		return ScanItem{
			Path:      path,
			Filename:  filename,
			Format:    "pro7",
			Kind:      "unknown",
			Title:     strings.TrimSuffix(filename, ext),
			Supported: false,
			Reason: "ProPresenter 7 (.pro) is binary protobuf — Pro7 import needs " +
				"a vendored .proto schema. Pro4/5/6 (.pro6) imports work in this build.",
		}, true
	default:
		return ScanItem{}, false
	}
}

// ImportSummary is what ImportProPresenter returns after running
// through a batch — the UI uses these counters to render the summary
// report and the warnings list.
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

// ImportProPresenter parses + persists every importable file in paths.
// The conflict policy controls duplicate-title resolution against the
// existing library; the UI is responsible for picking a sensible
// default (skip is safest).
//
// Errors on individual files are recorded in the summary and do not
// abort the batch — partial-success is the friendlier outcome when a
// library has one corrupt file among hundreds.
func (s *Service) ImportProPresenter(
	ctx context.Context,
	paths []string,
	policy ConflictPolicy,
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
		item, ok := classifyAndPreview(p)
		if !ok {
			sum.Skipped++
			sum.Warnings = append(sum.Warnings, fmt.Sprintf("%s: not a ProPresenter document", p))
			continue
		}
		if !item.Supported {
			sum.Skipped++
			sum.Warnings = append(sum.Warnings, fmt.Sprintf("%s: %s", item.Filename, item.Reason))
			continue
		}
		switch item.Format {
		case "pro4", "pro5", "pro6":
			id, action, err := s.importProXML(ctx, p, policy)
			if err != nil {
				sum.Failed++
				sum.Warnings = append(sum.Warnings, fmt.Sprintf("%s: %v", item.Filename, err))
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
		default:
			sum.Skipped++
		}
	}
	return sum, nil
}
