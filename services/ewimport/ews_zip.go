// EasyWorship 7+ export bundles (.ews) are ZIP archives. Inside, a
// fresh Songs.db + SongWords.db pair holds the exported subset of
// the library; some bundles also pack `Resources/` media. We
// transparently unwrap into a temp dir at scan + import time and
// reuse the SQLite path — exporters that ship the same schema work
// without any new logic.

package ewimport

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// extractEwsBundle unzips bundlePath into a freshly created temp dir
// and returns the dir path. Caller is responsible for cleaning up
// (defer os.RemoveAll on the returned path).
//
// Path traversal is rejected aggressively: any entry whose cleaned
// destination escapes the temp dir is a refusal-to-extract — even
// scanner builds shouldn't be fooled into writing outside the
// sandbox. The .ews format isn't an adversary, but file imports
// often run with the user's full permissions and "zip-slip" CVEs
// have burned every language ecosystem at some point.
func extractEwsBundle(bundlePath string) (string, error) {
	zr, err := zip.OpenReader(bundlePath)
	if err != nil {
		return "", fmt.Errorf("open .ews: %w", err)
	}
	defer zr.Close()

	dir, err := os.MkdirTemp("", "neoprojector-ews-*")
	if err != nil {
		return "", fmt.Errorf("temp dir: %w", err)
	}
	cleaned, err := filepath.Abs(dir)
	if err != nil {
		_ = os.RemoveAll(dir)
		return "", fmt.Errorf("abs: %w", err)
	}

	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		// Containment: filepath.Join can't escape cleanly when the
		// archive entry uses absolute paths or .. segments. Re-clean
		// and verify the resolved path is under cleaned.
		dest := filepath.Join(cleaned, f.Name)
		absDest, err := filepath.Abs(dest)
		if err != nil || !strings.HasPrefix(absDest+string(filepath.Separator), cleaned+string(filepath.Separator)) {
			_ = os.RemoveAll(cleaned)
			return "", fmt.Errorf("rejected entry escaping sandbox: %s", f.Name)
		}
		if err := os.MkdirAll(filepath.Dir(absDest), 0o755); err != nil {
			_ = os.RemoveAll(cleaned)
			return "", fmt.Errorf("mkdir: %w", err)
		}
		if err := copyZipEntry(f, absDest); err != nil {
			_ = os.RemoveAll(cleaned)
			return "", fmt.Errorf("extract %s: %w", f.Name, err)
		}
	}
	return cleaned, nil
}

func copyZipEntry(f *zip.File, dest string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, rc)
	return err
}

// scanEwsBundle wraps extractEwsBundle + scanSQLiteLibrary and
// returns items with paths that encode the *bundle* (not the temp
// dir) so re-import after the temp dir is gone still works. The
// import side re-extracts on demand.
//
// Returned ScanItem paths use a two-segment handle:
//   <bundlePath>!<rowid>
// — the bang separates archive path from rowid, mirroring Java's
// JAR URL convention.
func scanEwsBundle(bundlePath string) ([]ScanItem, error) {
	tmp, err := extractEwsBundle(bundlePath)
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)

	libDir, err := findEwSQLiteLibrary(tmp)
	if err != nil {
		return nil, err
	}
	items, err := scanSQLiteLibrary(libDir)
	if err != nil {
		return nil, err
	}
	// Rewrite handles so the bundle path travels with each item.
	for i := range items {
		_, rowid, ok := decodeSQLiteHandle(items[i].Path)
		if !ok {
			continue
		}
		items[i].Path = encodeEwsHandle(bundlePath, rowid)
		items[i].Library = bundlePath
		items[i].Format = "ew_ews_zip"
	}
	return items, nil
}

func encodeEwsHandle(bundlePath string, rowid int64) string {
	return fmt.Sprintf("%s!%d", bundlePath, rowid)
}

func decodeEwsHandle(handle string) (string, int64, bool) {
	idx := strings.LastIndex(handle, "!")
	if idx <= 0 || idx == len(handle)-1 {
		return "", 0, false
	}
	var rowid int64
	_, err := fmt.Sscanf(handle[idx+1:], "%d", &rowid)
	if err != nil {
		return "", 0, false
	}
	return handle[:idx], rowid, true
}

// findEwSQLiteLibrary walks the extracted bundle root looking for a
// directory containing Songs.db + SongWords.db. Returns the first
// match. EW7's exporter places them at a few different depths
// depending on what was exported (single song vs schedule vs full
// library).
func findEwSQLiteLibrary(root string) (string, error) {
	var found string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		if hasFile(path, "Songs.db") && hasFile(path, "SongWords.db") {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if found == "" {
		return "", errors.New("no Songs.db + SongWords.db inside bundle")
	}
	return found, nil
}
