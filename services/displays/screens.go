package displays

import (
	"context"
	"database/sql"
	"encoding/json"

	"neoprojector/database"

	"github.com/charmbracelet/log"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Screen-binding self-healing.
//
// Wails' Windows screen id is the monitor's HMONITOR handle, which the
// OS reassigns whenever monitors are replugged, the PC sleeps or
// reboots. A display bound by id alone then reads as "disconnected"
// and Go Live refuses to open its window, even though the same
// projector is plugged in. So each binding also keeps a fingerprint of
// its monitor (screen_hint), and a stale binding is re-pointed at the
// connected monitor that matches it.

// screenFP is the persisted fingerprint of a monitor. Physical bounds,
// matching what the OS arrangement reports.
type screenFP struct {
	id      string
	Name    string `json:"name"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	W       int    `json:"w"`
	H       int    `json:"h"`
	Primary bool   `json:"primary"`
}

func fingerprint(sc *application.Screen) screenFP {
	return screenFP{
		id:      sc.ID,
		Name:    sc.Name,
		X:       sc.PhysicalBounds.X,
		Y:       sc.PhysicalBounds.Y,
		W:       sc.PhysicalBounds.Width,
		H:       sc.PhysicalBounds.Height,
		Primary: sc.IsPrimary,
	}
}

func (fp screenFP) json() string {
	b, _ := json.Marshal(fp)
	return string(b)
}

func parseHint(s sql.NullString) *screenFP {
	if !s.Valid || s.String == "" {
		return nil
	}
	var fp screenFP
	if json.Unmarshal([]byte(s.String), &fp) != nil {
		return nil
	}
	return &fp
}

// sameMonitor reports whether a connected screen is plausibly the
// monitor a hint describes. Windows REUSES HMONITOR handles, so a stored
// id that still exists may now belong to a different monitor (seen: the
// projector's old id handed to the primary while it was replugged). A
// match needs the same primary/secondary role plus the same device name
// or the same place and size; a nil hint (legacy row) accepts anything.
func sameMonitor(hint *screenFP, f screenFP) bool {
	if hint == nil {
		return true
	}
	if hint.Primary != f.Primary {
		return false
	}
	if hint.Name != "" && hint.Name == f.Name {
		return true
	}
	return hint.W > 0 && hint.X == f.X && hint.Y == f.Y && hint.W == f.W && hint.H == f.H
}

// staleBinding is a display whose stored screen id no longer exists, or
// now belongs to a different monitor (see sameMonitor).
type staleBinding struct {
	displayID int64
	hint      *screenFP
}

// matchStale assigns connected, unclaimed screens to stale bindings,
// most confident first:
//
//  1. same device name (\\.\DISPLAYn) as when it was bound
//  2. same position and size in the desktop arrangement
//  3. exactly one stale display and exactly one free non-primary
//     monitor — the projector was replugged and got renamed/moved
//
// The primary (control) monitor is only ever matched by an explicit
// hint, never by the last-resort rule, so an operator screen is never
// silently taken over by an output window.
func matchStale(stale []staleBinding, free []screenFP) map[int64]string {
	out := map[int64]string{}
	used := map[string]bool{}
	assign := func(pred func(staleBinding, screenFP) bool) {
		for _, b := range stale {
			if _, done := out[b.displayID]; done {
				continue
			}
			for _, f := range free {
				if !used[f.id] && pred(b, f) {
					out[b.displayID] = f.id
					used[f.id] = true
					break
				}
			}
		}
	}
	// Hinted matches never cross the primary/secondary line: a display
	// that lived on a secondary monitor must not land on the operator's
	// control screen just because Windows renamed or reshuffled them.
	assign(func(b staleBinding, f screenFP) bool {
		return b.hint != nil && b.hint.Primary == f.Primary &&
			b.hint.Name != "" && b.hint.Name == f.Name
	})
	assign(func(b staleBinding, f screenFP) bool {
		return b.hint != nil && b.hint.Primary == f.Primary && b.hint.W > 0 &&
			b.hint.X == f.X && b.hint.Y == f.Y && b.hint.W == f.W && b.hint.H == f.H
	})

	var leftStale []staleBinding
	for _, b := range stale {
		if _, done := out[b.displayID]; !done && (b.hint == nil || !b.hint.Primary) {
			leftStale = append(leftStale, b)
		}
	}
	var leftFree []screenFP
	for _, f := range free {
		if !used[f.id] && !f.Primary {
			leftFree = append(leftFree, f)
		}
	}
	if len(leftStale) == 1 && len(leftFree) == 1 {
		out[leftStale[0].displayID] = leftFree[0].id
	}
	return out
}

// healScreenBindings refreshes the fingerprint of every connected
// binding and re-points stale ones at their monitor's new id. Returns
// the displays as they stand afterwards. Writes only when something
// actually changed, so it's cheap to call on every screen poll.
func (s *Service) healScreenBindings(ctx context.Context, screens []*application.Screen) ([]database.Display, error) {
	displays, err := s.q.ListDisplays(ctx)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]*application.Screen, len(screens))
	for _, sc := range screens {
		byID[sc.ID] = sc
	}
	claimed := map[string]bool{}
	var stale []staleBinding
	for _, d := range displays {
		if !d.ScreenID.Valid || d.ScreenID.String == "" {
			continue
		}
		hint := parseHint(d.ScreenHint)
		if sc, ok := byID[d.ScreenID.String]; ok && sameMonitor(hint, fingerprint(sc)) {
			claimed[sc.ID] = true
			// Same monitor: keep the fingerprint current (e.g. the user
			// rearranged screens). Never refreshed from a mismatched
			// screen, so a reused id can't overwrite the real hint.
			if fp := fingerprint(sc).json(); !d.ScreenHint.Valid || d.ScreenHint.String != fp {
				_ = s.q.SetDisplayScreenHint(ctx, database.SetDisplayScreenHintParams{
					ID:         d.ID,
					ScreenHint: sql.NullString{String: fp, Valid: true},
				})
			}
			continue
		}
		stale = append(stale, staleBinding{displayID: d.ID, hint: hint})
	}
	if len(stale) == 0 {
		return displays, nil
	}
	var free []screenFP
	for _, sc := range screens {
		if !claimed[sc.ID] {
			free = append(free, fingerprint(sc))
		}
	}
	matches := matchStale(stale, free)
	if len(matches) == 0 {
		return displays, nil
	}
	for i, d := range displays {
		newID, ok := matches[d.ID]
		if !ok {
			continue
		}
		updated, err := s.q.SetDisplayScreen(ctx, database.SetDisplayScreenParams{
			ID:       d.ID,
			ScreenID: sql.NullString{String: newID, Valid: true},
		})
		if err != nil {
			return nil, err
		}
		hint := fingerprint(byID[newID]).json()
		_ = s.q.SetDisplayScreenHint(ctx, database.SetDisplayScreenHintParams{
			ID:         d.ID,
			ScreenHint: sql.NullString{String: hint, Valid: true},
		})
		updated.ScreenHint = sql.NullString{String: hint, Valid: true}
		displays[i] = updated
		log.Info("re-bound display to its monitor's new screen id",
			"display", d.Name, "old_screen_id", d.ScreenID.String, "new_screen_id", newID)
	}
	emitChanged()
	return displays, nil
}
