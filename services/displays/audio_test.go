package displays

import (
	"errors"
	"testing"
)

func TestPickAudioDisplay(t *testing.T) {
	live := map[int64]struct{}{3: {}, 1: {}, 2: {}}
	if got := pickAudioDisplay(live, map[int64]bool{1: true, 2: true, 3: true}, nil); got != 1 {
		t.Fatalf("smallest media display: got %d, want 1", got)
	}
	// Display 1 is lyrics-only: audio moves to the next that shows media.
	if got := pickAudioDisplay(live, map[int64]bool{2: true, 3: true}, nil); got != 2 {
		t.Fatalf("skip media-suppressed: got %d, want 2", got)
	}
	// Nothing open yet (a video sent before Present): no audio output —
	// refreshAudio/CurrentLive re-pick once windows exist.
	if got := pickAudioDisplay(map[int64]struct{}{}, map[int64]bool{1: true}, nil); got != 0 {
		t.Fatalf("no windows: got %d, want 0", got)
	}
	// DB lookup failed: fall back to the smallest id rather than silence.
	if got := pickAudioDisplay(live, nil, errors.New("db")); got != 1 {
		t.Fatalf("lookup error fallback: got %d, want 1", got)
	}
}
