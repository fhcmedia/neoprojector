package presentations

import (
	"context"
	"errors"
	"os"

	"neoprojector/database"

	"github.com/charmbracelet/log"
)

// --- Per-slide options (0022) ---

// SetSlideEnabled includes (true) or excludes (false) a slide. Excluded
// slides stay in the list but next/previous, a clicker and auto-advance
// skip them.
func (s *Service) SetSlideEnabled(ctx context.Context, slideID int64, enabled bool) error {
	return s.q.SetPresentationSlideEnabled(ctx, database.SetPresentationSlideEnabledParams{
		Enabled: boolInt(enabled),
		ID:      slideID,
	})
}

// SetSourceEnabled includes or excludes every slide imported from one
// deck file (the slide's source) at once.
func (s *Service) SetSourceEnabled(ctx context.Context, presentationID int64, source string, enabled bool) error {
	return s.q.SetPresentationSlidesEnabledBySource(ctx, database.SetPresentationSlidesEnabledBySourceParams{
		Enabled:        boolInt(enabled),
		PresentationID: presentationID,
		Source:         source,
	})
}

// SetAllSlidesEnabled includes or excludes every slide of a presentation.
func (s *Service) SetAllSlidesEnabled(ctx context.Context, presentationID int64, enabled bool) error {
	return s.q.SetAllPresentationSlidesEnabled(ctx, database.SetAllPresentationSlidesEnabledParams{
		Enabled:        boolInt(enabled),
		PresentationID: presentationID,
	})
}

// SetSlideDuration sets how long a slide stays up while auto-advancing.
// 0 means "use the presentation's interval"; anything else is clamped
// to the same bounds as the interval.
func (s *Service) SetSlideDuration(ctx context.Context, slideID int64, durationMs int64) error {
	if durationMs < 0 {
		durationMs = 0
	}
	if durationMs > 0 && durationMs < minIntervalMs {
		durationMs = minIntervalMs
	}
	if durationMs > maxIntervalMs {
		durationMs = maxIntervalMs
	}
	return s.q.SetPresentationSlideDuration(ctx, database.SetPresentationSlideDurationParams{
		DurationMs: durationMs,
		ID:         slideID,
	})
}

func boolInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// --- Deck page cleanup ---

// removeHiddenMediaIfUnused deletes a deck page image (row + file) once
// no slide references it any more. Library media (hidden = 0) is never
// touched: it belongs to the operator, not to the presentation.
func (s *Service) removeHiddenMediaIfUnused(ctx context.Context, mediaID int64, path string) {
	n, err := s.q.CountSlidesUsingMedia(ctx, mediaID)
	if err != nil || n > 0 {
		return
	}
	if err := s.q.DeleteHiddenMedia(ctx, mediaID); err != nil {
		return
	}
	if path != "" {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Warn("deck page remove failed", "media", mediaID, "err", err)
		}
	}
}
