// Presentation navigation over included slides.
//
// Excluded slides (Slide.excluded) stay in the list — the operator can
// still click one to show it — but next/previous (arrow keys, a
// presentation clicker) and auto-advance step over them.

type NavSlide = { excluded?: boolean; durationMs?: number }

// nextIndex is the next included slide after cur (-1 = none yet: the
// first included slide), wrapping to the start when loop is on.
// Returns -1 when there is no next slide.
export function nextIndex(slides: readonly NavSlide[], cur: number, loop: boolean): number {
  const n = slides.length
  for (let step = 1; step <= n; step++) {
    const i = cur + step
    if (i >= n && !loop) return -1
    const j = ((i % n) + n) % n
    if (!slides[j]?.excluded) return j === cur ? -1 : j
  }
  return -1
}

// prevIndex is the previous included slide before cur, wrapping to the
// end when loop is on. -1 when there is none.
export function prevIndex(slides: readonly NavSlide[], cur: number, loop: boolean): number {
  const n = slides.length
  if (cur < 0) return -1
  for (let step = 1; step <= n; step++) {
    const i = cur - step
    if (i < 0 && !loop) return -1
    const j = ((i % n) + n) % n
    if (!slides[j]?.excluded) return j === cur ? -1 : j
  }
  return -1
}

// includedCount: slides auto-advance actually cycles through.
export function includedCount(slides: readonly NavSlide[]): number {
  return slides.filter((s) => !s.excluded).length
}

// dwellMs: how long a slide stays up while auto-advancing — its own
// duration, else the presentation interval (never under 250ms).
export function dwellMs(slide: NavSlide | undefined, intervalMs: number): number {
  const d = slide?.durationMs && slide.durationMs > 0 ? slide.durationMs : intervalMs
  return Math.max(250, d)
}
