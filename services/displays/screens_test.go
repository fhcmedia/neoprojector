package displays

import "testing"

func TestMatchStale(t *testing.T) {
	main := screenFP{id: "100", Name: `\\.\DISPLAY1`, X: 0, Y: 0, W: 1920, H: 1080, Primary: true}
	proj := screenFP{id: "222", Name: `\\.\DISPLAY5`, X: 1920, Y: 0, W: 1920, H: 1080}
	stage := screenFP{id: "333", Name: `\\.\DISPLAY6`, X: 3840, Y: 0, W: 1280, H: 720}

	t.Run("same device name wins", func(t *testing.T) {
		hint := proj
		got := matchStale([]staleBinding{{displayID: 1, hint: &hint}}, []screenFP{main, stage, proj})
		if got[1] != "222" {
			t.Fatalf("got %v, want display 1 -> 222", got)
		}
	})

	t.Run("renamed but same place and size", func(t *testing.T) {
		hint := proj
		hint.Name = `\\.\DISPLAY2` // Windows renumbered it after a replug
		moved := proj
		moved.id = "999"
		got := matchStale([]staleBinding{{displayID: 1, hint: &hint}}, []screenFP{main, moved})
		if got[1] != "999" {
			t.Fatalf("got %v, want display 1 -> 999", got)
		}
	})

	t.Run("legacy binding without hint takes the only free secondary", func(t *testing.T) {
		got := matchStale([]staleBinding{{displayID: 1}}, []screenFP{main, proj})
		if got[1] != "222" {
			t.Fatalf("got %v, want display 1 -> 222", got)
		}
	})

	t.Run("never falls back onto the primary/control screen", func(t *testing.T) {
		got := matchStale([]staleBinding{{displayID: 1}}, []screenFP{main})
		if len(got) != 0 {
			t.Fatalf("got %v, want no match", got)
		}
	})

	t.Run("ambiguous last resort is left alone", func(t *testing.T) {
		got := matchStale([]staleBinding{{displayID: 1}}, []screenFP{main, proj, stage})
		if len(got) != 0 {
			t.Fatalf("got %v, want no match with two free secondaries", got)
		}
		got = matchStale([]staleBinding{{displayID: 1}, {displayID: 2}}, []screenFP{main, proj})
		if len(got) != 0 {
			t.Fatalf("got %v, want no match with two stale displays", got)
		}
	})

	t.Run("one monitor is never given to two displays", func(t *testing.T) {
		a, b := proj, proj
		got := matchStale(
			[]staleBinding{{displayID: 1, hint: &a}, {displayID: 2, hint: &b}},
			[]screenFP{main, proj},
		)
		if len(got) != 1 || got[1] != "222" {
			t.Fatalf("got %v, want only display 1 -> 222", got)
		}
	})

	t.Run("a binding hinted to the primary can come back to it", func(t *testing.T) {
		hint := main
		moved := main
		moved.id = "101"
		got := matchStale([]staleBinding{{displayID: 1, hint: &hint}}, []screenFP{moved, proj})
		if got[1] != "101" {
			t.Fatalf("got %v, want display 1 -> 101", got)
		}
	})
}
