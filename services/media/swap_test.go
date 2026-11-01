package media

import (
	"context"
	"os"
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

// Deleting media used by a schedule item used to fail with a foreign-key
// error (service_item_media has no cascade). The item goes with it now.
func TestDeleteMediaUsedInService(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(db); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	exec := func(q string, args ...any) int64 {
		r, err := db.ExecContext(ctx, q, args...)
		if err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		id, _ := r.LastInsertId()
		return id
	}
	file := filepath.Join(t.TempDir(), "v.mp4")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	mid := exec(`INSERT INTO media (type,title,path,original_filename) VALUES ('video','v',?,'v.mp4')`, file)
	svc := exec(`INSERT INTO service (name) VALUES ('S')`)
	sec := exec(`INSERT INTO service_section (service_id, name, position) VALUES (?, 'A', 0)`, svc)
	item := exec(`INSERT INTO service_item (section_id, position) VALUES (?, 0)`, sec)
	exec(`INSERT INTO service_item_media (item_id, media_id) VALUES (?, ?)`, item, mid)

	if err := New(db, nil).DeleteMedia(ctx, mid); err != nil {
		t.Fatalf("DeleteMedia: %v", err)
	}
	var n int
	db.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_item WHERE id = ?`, item).Scan(&n)
	if n != 0 {
		t.Fatal("schedule item using the media should be gone")
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("media file should be deleted")
	}
}
