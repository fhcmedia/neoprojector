package media

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProbeVideo(t *testing.T) {
	tests := []struct {
		file    string
		codec   string
		support string
	}{
		{"h264.mp4", "avc1", "yes"},           // moov at the end (camera-style)
		{"h264_faststart.mp4", "avc1", "yes"}, // moov at the front
		{"h264.mov", "avc1", "yes"},
		{"hevc.mov", "hvc1", "maybe"},      // iPhone-style HEVC
		{"hevc_hev1.mp4", "hev1", "maybe"}, // video-only, hev1 tag
		{"prores.mov", "apcn", "no"},       // plays audio, never a picture
	}
	for _, tc := range tests {
		t.Run(tc.file, func(t *testing.T) {
			got := ProbeVideo(filepath.Join("testdata", tc.file))
			if got.Codec != tc.codec || got.Support != tc.support {
				t.Fatalf("got %+v, want codec %q support %q", got, tc.codec, tc.support)
			}
		})
	}
}

func TestProbeVideoFallbacks(t *testing.T) {
	if got := ProbeVideo(filepath.Join("testdata", "audio_only.m4a")); got.Support != "unknown" {
		t.Fatalf("audio-only file: got %+v, want unknown (no video track)", got)
	}
	if got := ProbeVideo("clip.avi"); got.Support != "no" {
		t.Fatalf("avi: got %+v, want no", got)
	}
	if got := ProbeVideo("missing.mp4"); got.Support != "unknown" {
		t.Fatalf("missing file: got %+v, want unknown", got)
	}
	// Garbage must not panic or loop.
	p := filepath.Join(t.TempDir(), "junk.mp4")
	if err := os.WriteFile(p, []byte("this is not an mp4 file at all, just text"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ProbeVideo(p); got.Support != "unknown" {
		t.Fatalf("junk: got %+v, want unknown", got)
	}
}
