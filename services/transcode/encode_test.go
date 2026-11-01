package transcode

import (
	"strings"
	"testing"
)

func TestPlaybackArgs(t *testing.T) {
	a := strings.Join(PlaybackArgs("in.mov", "out.mp4", 4), " ")
	for _, want := range []string{
		"-c:v libx264", "-pix_fmt yuv420p", "-fpsmax 60", "-threads 4",
		"-movflags +faststart", "-map 0:a:0?", "-progress pipe:1",
		"min(1920,iw)", "min(1080,ih)", "force_original_aspect_ratio=decrease",
	} {
		if !strings.Contains(a, want) {
			t.Errorf("args missing %q:\n%s", want, a)
		}
	}
	if !strings.HasSuffix(a, " out.mp4") {
		t.Errorf("output must be last: %s", a)
	}
}

func TestParseProgress(t *testing.T) {
	stream := strings.Join([]string{
		"frame=10", "out_time_us=2500000", "progress=continue",
		"out_time_us=5000000", "out_time_ms=7500000", "progress=continue",
		"out_time_us=10000000", "progress=end",
	}, "\n")
	var got []int
	parseProgress(strings.NewReader(stream), 10, func(p int) { got = append(got, p) })
	want := []int{25, 50, 75, 99}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestParseProgressUnknownDuration(t *testing.T) {
	called := false
	parseProgress(strings.NewReader("out_time_us=1000000\n"), 0, func(int) { called = true })
	if called {
		t.Fatal("no progress without a duration")
	}
}
