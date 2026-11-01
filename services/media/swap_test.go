package media

import (
	"context"
	"path/filepath"
	"testing"

	"neoprojector/database"
)

// SwapMediaPath must re-point a row only while it still points at the
// file the playback copy was made from. (sqlc once truncated this query
// to "path =" because of a multibyte character in its comment.)
func TestSwapMediaPath(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(db); err != nil {
		t.Fatal(err)
	}
	q := database.New(db)
	ctx := context.Background()
	m, err := q.CreateMedia(ctx, database.CreateMediaParams{
		Type: "video", Title: "a", Path: "/m/orig.mp4", OriginalFilename: "a.mp4",
	})
	if err != nil {
		t.Fatal(err)
	}

	n, err := q.SwapMediaPath(ctx, database.SwapMediaPathParams{Path: "/m/copy.mp4", ID: m.ID, Path_2: "/m/orig.mp4"})
	if err != nil || n != 1 {
		t.Fatalf("swap: n=%d err=%v", n, err)
	}
	got, _ := q.MediaByID(ctx, m.ID)
	if got.Path != "/m/copy.mp4" {
		t.Fatalf("path = %q", got.Path)
	}

	// A stale swap (row no longer points at the source) is a no-op.
	n, err = q.SwapMediaPath(ctx, database.SwapMediaPathParams{Path: "/m/other.mp4", ID: m.ID, Path_2: "/m/orig.mp4"})
	if err != nil || n != 0 {
		t.Fatalf("stale swap: n=%d err=%v", n, err)
	}
	got, _ = q.MediaByID(ctx, m.ID)
	if got.Path != "/m/copy.mp4" {
		t.Fatalf("stale swap clobbered path: %q", got.Path)
	}
}
