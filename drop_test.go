package main

import "testing"

func TestDropTargetID(t *testing.T) {
	cases := []struct {
		attrs map[string]string
		id    string
		want  string
	}{
		{map[string]string{"data-file-drop-target": "library-media"}, "", "library-media"},
		{map[string]string{"data-file-drop-target": "schedule-section:4"}, "x", "schedule-section:4"},
		{map[string]string{"data-file-drop-target": ""}, "media-drop-target", "media-drop-target"},
		{nil, "", ""},
	}
	for _, c := range cases {
		if got := dropTargetID(c.attrs, c.id); got != c.want {
			t.Errorf("dropTargetID(%v, %q) = %q, want %q", c.attrs, c.id, got, c.want)
		}
	}
}
