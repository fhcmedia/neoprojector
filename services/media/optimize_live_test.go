package media

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"neoprojector/database"
)

func TestReferencesMedia(t *testing.T) {
	cases := []struct {
		doc  string
		id   int64
		want bool
	}{
		{`{"media":{"ref":{"mediaId":12,"playing":true}}}`, 12, true},
		{`{"media":{"ref":{"mediaId":12}}}`, 1, false},
		{`{"media":{"ref":{"mediaId":120}}}`, 12, false},
		{`{"presentation":{"next_media_id":7}}`, 7, true},
		{`{"background":{"type":"media","mediaId": 5}}`, 5, true},
		// JSON inside a JSON string (overlay config snapshots).
		{`{"config_json":"{\"mediaId\":9}"}`, 9, true},
		{`{"primary":"mediaId 3"}`, 3, false},
		{``, 3, false},
	}
	for _, c := range cases {
		if got := ReferencesMedia(c.doc, c.id); got != c.want {
			t.Errorf("ReferencesMedia(%s, %d) = %v, want %v", c.doc, c.id, got, c.want)
		}
	}
}

// A finished copy of a video that is on screen must wait (no swap, so
// the screens don't reload it mid-play) and swap in once it's gone.
func TestReadyCopyWaitsWhileOnScreen(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(db); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	dir := t.TempDir()
	orig := filepath.Join(dir, "orig.mov")
	if err := os.WriteFile(orig, []byte("orig"), 0o644); err != nil {
		t.Fatal(err)
	}
	q := database.New(db)
	m, err := q.CreateMedia(ctx, database.CreateMediaParams{
		Type: "video", Title: "a", Path: orig, OriginalFilename: "a.mov",
	})
	if err != nil {
		t.Fatal(err)
	}

	var showing atomic.Bool
	showing.Store(true)
	svc := New(db, func() bool { return true }, func(id int64) bool { return showing.Load() && id == m.ID })
	o := svc.opt

	if !o.inUse(ctx, m.ID) {
		t.Fatal("on-screen video not reported in use")
	}
	ready := filepath.Join(dir, "ready-x.mp4")
	if err := os.WriteFile(ready, []byte("copy"), 0o644); err != nil {
		t.Fatal(err)
	}
	o.ready[m.ID] = readyCopy{path: ready, from: orig}

	o.swapReady(ctx)
	if got, _ := q.MediaByID(ctx, m.ID); got.Path != orig {
		t.Fatalf("swapped while on screen: %q", got.Path)
	}

	showing.Store(false)
	o.swapReady(ctx)
	got, _ := q.MediaByID(ctx, m.ID)
	if got.Path == orig || filepath.Dir(got.Path) != dir {
		t.Fatalf("not swapped after leaving the screen: %q", got.Path)
	}
	if b, _ := os.ReadFile(got.Path); string(b) != "copy" {
		t.Fatalf("new path has %q", b)
	}
	if _, err := os.Stat(orig); !os.IsNotExist(err) {
		t.Fatal("original not deleted")
	}
	if st := o.status[m.ID]; st == nil || st.State != "done" {
		t.Fatalf("status = %+v", st)
	}
}

// A template background counts as on screen while live.
func TestTemplateBackgroundInUse(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(db); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	q := database.New(db)
	if _, err := q.CreateTemplate(ctx, database.CreateTemplateParams{
		Name: "t", Kind: "song", ViewportW: 1920, ViewportH: 1080,
		DataJson: `{"background":{"type":"media","mediaId":44,"mode":"cover"}}`,
	}); err != nil {
		t.Fatal(err)
	}
	live := true
	o := New(db, func() bool { return live }, nil).opt
	if !o.inUse(ctx, 44) {
		t.Fatal("template background video not in use while live")
	}
	if o.inUse(ctx, 45) {
		t.Fatal("unrelated video reported in use")
	}
	live = false
	if o.inUse(ctx, 44) {
		t.Fatal("in use while nothing is live")
	}
}
