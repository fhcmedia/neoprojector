package updates

import (
	"reflect"
	"testing"
)

func TestParseNotes(t *testing.T) {
	body := "## What's new\r\n- Smooth playback copies for heavy videos\r\n- Fill the window at any UI scale\r\n\r\n---\r\nBuilt from `abc`.\r\n\r\n**Artifacts**\r\n- `neoprojector-0.1.25-mac.zip`"
	got := parseNotes(body)
	want := []string{"Smooth playback copies for heavy videos", "Fill the window at any UI scale"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	// Old release bodies (no What's new section) yield nothing — the
	// artifact bullets must not be mistaken for notes.
	if got := parseNotes("Built from `abc`.\n\n**Artifacts**\n- `x.zip`"); got != nil {
		t.Fatalf("got %q, want nil", got)
	}
	// Stops at the next heading.
	if got := parseNotes("## What's new\n- A\n## Other\n- B"); !reflect.DeepEqual(got, []string{"A"}) {
		t.Fatalf("got %q", got)
	}
}
