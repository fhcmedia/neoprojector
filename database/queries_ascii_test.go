package database

import (
	"os"
	"path/filepath"
	"testing"
)

// sqlc slices query text by byte offsets that a multibyte character in
// a query file (even in a comment, e.g. an arrow or em dash) throws off,
// silently generating truncated SQL ("type = 'pd"). Keep them ASCII.
func TestQueriesAreASCII(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join("queries", "*.sql"))
	if len(files) == 0 {
		t.Fatal("no query files found")
	}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		line := 1
		for _, c := range string(b) {
			if c == '\n' {
				line++
			}
			if c > 127 {
				t.Errorf("%s:%d: non-ASCII character %q (sqlc miscounts it)", f, line, c)
				break
			}
		}
	}
}
