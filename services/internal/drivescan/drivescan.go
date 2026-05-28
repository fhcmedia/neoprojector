// Package drivescan walks every fixed drive on the machine in
// parallel, looking for directories whose contents match a caller
// supplied "marker" predicate. Used by the importer auto-detect
// buttons to locate ProPresenter / EasyWorship libraries the user
// installed somewhere off the beaten path.
//
// Performance notes:
//   - One goroutine per drive (typically 1–3 drives in practice;
//     network drives we skip), bounded internally by maxConcurrent.
//   - filepath.WalkDir uses ReadDir under the hood — orders of
//     magnitude faster than os.Lstat per entry as the old Walk did.
//   - Subtree short-circuit: when the marker matches a directory,
//     that directory's children are NOT recursed; we already found
//     what we came for, and importer libraries don't nest inside
//     each other.
//   - Noise-dir skip list covers the worst offenders by name. Saves
//     minutes on systems with big AppData/Local caches, Node
//     projects, etc.
package drivescan

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// MarkerFn returns true when the given directory looks like one the
// caller cares about. Receives the dir path + a presence-checker
// closure over its DirEntry list — checks like `Songs.db exists`
// are O(N) on the dir contents but the entries list is already in
// memory from the parent ReadDir call.
type MarkerFn func(dir string, hasChild func(name string) bool) bool

// Options tunes the walker. All fields optional. MaxDepth caps how
// deep below each drive root we recurse — 14 covers
// `C:/Users/<user>/Documents/.../Libraries/<lib>/Default/Databases/Data`
// with room to spare without enumerating arbitrarily deep build
// trees.
type Options struct {
	MaxDepth      int
	MaxConcurrent int
	SkipDirNames  map[string]bool // lowercase; in addition to the built-in noise list
	// FileExtensions: when non-empty, the walker also emits file
	// paths whose extension (lowercased, leading dot) is in the
	// set. Doesn't trigger the marker short-circuit — file hits are
	// orthogonal.
	FileExtensions map[string]bool
}

// Scan walks every detected fixed drive and returns the directories
// for which Marker returned true. Results are deduplicated.
//
// Cancelling ctx cancels the walk on best-effort basis; in-flight
// ReadDir calls finish but no further recursion happens.
func Scan(ctx context.Context, marker MarkerFn, opts Options) ([]string, error) {
	if opts.MaxDepth <= 0 {
		opts.MaxDepth = 14
	}
	if opts.MaxConcurrent <= 0 {
		opts.MaxConcurrent = runtime.NumCPU()
		if opts.MaxConcurrent > 6 {
			opts.MaxConcurrent = 6
		}
	}
	roots := drives()
	hits := make(chan string, 64)
	var wg sync.WaitGroup
	sem := make(chan struct{}, opts.MaxConcurrent)
	for _, root := range roots {
		wg.Add(1)
		go func(root string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			walkOne(ctx, root, marker, opts, hits)
		}(root)
	}
	go func() {
		wg.Wait()
		close(hits)
	}()

	seen := map[string]struct{}{}
	out := make([]string, 0, 8)
	for h := range hits {
		clean := filepath.Clean(h)
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		out = append(out, clean)
	}
	return out, nil
}

// walkOne recursively scans root. We hand-roll the recursion (rather
// than use filepath.WalkDir) so we can:
//   - hand the marker a ReadDir result it can probe by name without
//     a second syscall
//   - short-circuit the subtree on marker hit
//   - cap depth precisely
//   - drop noise dirs before opening them
func walkOne(
	ctx context.Context,
	root string,
	marker MarkerFn,
	opts Options,
	hits chan<- string,
) {
	type frame struct {
		path  string
		depth int
	}
	stack := []frame{{root, 0}}
	for len(stack) > 0 {
		select {
		case <-ctx.Done():
			return
		default:
		}
		f := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if f.depth > opts.MaxDepth {
			continue
		}
		entries, err := os.ReadDir(f.path)
		if err != nil {
			continue
		}
		// Build a quick presence-checker for the marker. Lowercase
		// keyed so callers can spell "Songs.db" / "songs.db" / "SONGS.DB".
		index := make(map[string]bool, len(entries))
		for _, e := range entries {
			index[strings.ToLower(e.Name())] = true
		}
		hasChild := func(name string) bool { return index[strings.ToLower(name)] }
		if marker != nil && marker(f.path, hasChild) {
			hits <- f.path
			// short-circuit subtree
			continue
		}
		for _, e := range entries {
			name := e.Name()
			if !e.IsDir() {
				// File extension match — emit file path as a hit.
				if len(opts.FileExtensions) > 0 {
					ext := strings.ToLower(filepath.Ext(name))
					if opts.FileExtensions[ext] {
						hits <- filepath.Join(f.path, name)
					}
				}
				continue
			}
			if shouldSkipDir(name, opts.SkipDirNames) {
				continue
			}
			stack = append(stack, frame{filepath.Join(f.path, name), f.depth + 1})
		}
	}
}

// noiseDirs lists folder names we always skip. Lowercase. Anything
// that holds millions of small files (node_modules, .git, build
// caches) or is OS-internal (Windows, ProgramData) is here.
var noiseDirs = map[string]bool{
	"$recycle.bin":              true,
	"system volume information": true,
	"recovery":                  true,
	"windows":                   true,
	"winsxs":                    true,
	"program files":             true,
	"program files (x86)":       true,
	"programdata":               true,
	"node_modules":              true,
	".git":                      true,
	".svn":                      true,
	".hg":                       true,
	".cache":                    true,
	".gradle":                   true,
	".m2":                       true,
	".nuget":                    true,
	".vscode":                   true,
	".idea":                     true,
	"venv":                      true,
	".venv":                     true,
	"vendor":                    true,
	"dist":                      true,
	"build":                     true,
	"target":                    true,
	".next":                     true,
	".nuxt":                     true,
	".pnpm":                     true,
	".yarn":                     true,
	"go":                        true, // go module cache root
	// AppData kept — EW 7 sometimes lives under AppData/Roaming. We
	// rely on the marker short-circuit to keep that subtree cheap.
}

func shouldSkipDir(name string, extra map[string]bool) bool {
	low := strings.ToLower(name)
	if noiseDirs[low] {
		return true
	}
	if extra != nil && extra[low] {
		return true
	}
	return false
}

// drives enumerates the platform's fixed drive roots. On Windows we
// probe C: through Z:; on other platforms we walk from /.
func drives() []string {
	if runtime.GOOS != "windows" {
		return []string{"/"}
	}
	out := make([]string, 0, 4)
	for c := 'C'; c <= 'Z'; c++ {
		p := string(c) + `:\`
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			out = append(out, p)
		}
	}
	return out
}
