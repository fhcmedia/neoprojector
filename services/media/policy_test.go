package media

import (
	"path/filepath"
	"testing"
)

func TestJudge(t *testing.T) {
	ok1080 := mp4Info{Fourcc: "avc1", Width: 1920, Height: 1080, DurationSec: 100, SizeBytes: 100 * 1_000_000, H264Profile: 100}
	tests := []struct {
		name string
		m    mp4Info
		want bool
	}{
		{"1080p H.264 at 8 Mbps is left alone", ok1080, false},
		{"portrait 1080x1920 H.264 is left alone", mp4Info{Fourcc: "avc1", Width: 1080, Height: 1920, DurationSec: 10, SizeBytes: 5_000_000}, false},
		{"the real announcement: 4K HEVC 35 Mbps", mp4Info{Fourcc: "hvc1", Width: 3840, Height: 2160, DurationSec: 197.9, SizeBytes: 873_000_000}, true},
		{"1080p HEVC still converts (codec)", mp4Info{Fourcc: "hvc1", Width: 1920, Height: 1080, DurationSec: 10, SizeBytes: 5_000_000}, true},
		{"ProRes converts", mp4Info{Fourcc: "apcn", Width: 1920, Height: 1080, DurationSec: 10, SizeBytes: 5_000_000}, true},
		{"4K H.264 converts (size)", mp4Info{Fourcc: "avc1", Width: 3840, Height: 2160, DurationSec: 10, SizeBytes: 10_000_000}, true},
		{"1080p H.264 at 40 Mbps converts (bitrate)", mp4Info{Fourcc: "avc1", Width: 1920, Height: 1080, DurationSec: 10, SizeBytes: 50_000_000}, true},
		{"10-bit H.264 converts (profile)", mp4Info{Fourcc: "avc1", Width: 1280, Height: 720, DurationSec: 10, SizeBytes: 2_000_000, H264Profile: 110}, true},
		{"4:2:2 H.264 converts (profile)", mp4Info{Fourcc: "avc1", Width: 1280, Height: 720, DurationSec: 10, SizeBytes: 2_000_000, H264Profile: 122}, true},
		{"unknown duration doesn't trigger the bitrate rule", mp4Info{Fourcc: "avc1", Width: 1280, Height: 720, SizeBytes: 900_000_000}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, reason := judge(tc.m)
			if got != tc.want {
				t.Fatalf("judge = %v (%q), want %v", got, reason, tc.want)
			}
			if got && reason == "" {
				t.Fatal("a conversion must come with a reason")
			}
		})
	}
}

func TestNeedsPlaybackCopyFiles(t *testing.T) {
	td := func(f string) string { return filepath.Join("testdata", f) }
	cases := map[string]bool{
		td("h264.mp4"):           false, // small 8-bit H.264
		td("h264_faststart.mp4"): false,
		td("hevc.mov"):           true,
		td("prores.mov"):         true,
		"clip.avi":               true, // container
		"clip.mkv":               true,
		"clip.webm":              false,
	}
	for path, want := range cases {
		if got, reason := needsPlaybackCopy(path); got != want {
			t.Errorf("%s: got %v (%q), want %v", path, got, reason, want)
		}
	}
}

func TestProbeMP4Facts(t *testing.T) {
	m, err := probeMP4(filepath.Join("testdata", "h264.mp4"))
	if err != nil {
		t.Fatal(err)
	}
	if m.Width != 64 || m.Height != 36 {
		t.Fatalf("size %dx%d, want 64x36", m.Width, m.Height)
	}
	if m.DurationSec < 0.25 || m.DurationSec > 0.4 {
		t.Fatalf("duration %.3f, want ~0.3", m.DurationSec)
	}
	if m.H264Profile == 0 {
		t.Fatal("expected an avcC profile for H.264")
	}
}
