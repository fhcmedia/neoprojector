import { useEffect, useRef, type RefObject } from "react"

// Shared playhead clock for live video/audio.
//
// Every surface that shows the live media (each output window, each
// operator preview tile, the Show pane) runs its own <video>. Left
// alone they drift apart — they start at different moments (window
// mounts, buffering) and a pause/resume lands at different frames. So
// the live fill carries a clock instead of a bare playing flag:
//
//   at wall-clock `anchorMs` the media was at `anchorPos` seconds,
//   advancing in real time while `playing`.
//
// All windows run on the same machine, so Date.now() agrees across
// them and each surface can compute the same target position and steer
// its element onto it: a hard seek when far off, a tiny playbackRate
// nudge when close (seeking for small errors would stutter).

export type PlayClock = {
  playing: boolean
  loop: boolean
  anchorMs: number
  anchorPos: number
}

// Beyond this much drift (seconds) we seek; below it we nudge the rate.
export const SEEK_THRESHOLD = 0.3
// Drift we tolerate without touching anything (~1 frame at 30fps).
export const IN_SYNC = 0.04
// Rate nudge used to close small gaps: 3% faster/slower is inaudible
// for speech and closes a 0.3s gap in ~10s.
export const NUDGE = 0.03

// rawPosition is where the clock says the playhead is, unwrapped.
export function rawPosition(clock: PlayClock, nowMs: number): number {
  const elapsed = clock.playing ? Math.max(0, nowMs - clock.anchorMs) / 1000 : 0
  return clock.anchorPos + elapsed
}

// targetPosition maps the clock onto a media element of `duration`
// seconds: wrapped when looping, held on the last frame when not.
// Without a known duration the raw position is returned.
export function targetPosition(
  clock: PlayClock,
  nowMs: number,
  duration: number
): number {
  const raw = rawPosition(clock, nowMs)
  if (!Number.isFinite(duration) || duration <= 0) return raw
  if (clock.loop) return ((raw % duration) + duration) % duration
  return Math.min(raw, Math.max(0, duration - 0.05))
}

// hasEnded reports whether a non-looping clock has run past the end.
export function hasEnded(clock: PlayClock, nowMs: number, duration: number): boolean {
  return !clock.loop && Number.isFinite(duration) && duration > 0 &&
    rawPosition(clock, nowMs) >= duration - 0.05
}

// correction decides what a surface should do about its drift.
export function correction(
  current: number,
  target: number,
  playing: boolean
): { seek: number | null; rate: number } {
  const drift = current - target
  if (!playing) {
    // Paused: park exactly on the frame (no rate games).
    return { seek: Math.abs(drift) > IN_SYNC ? target : null, rate: 1 }
  }
  if (Math.abs(drift) > SEEK_THRESHOLD) return { seek: target, rate: 1 }
  if (Math.abs(drift) > IN_SYNC) return { seek: null, rate: drift > 0 ? 1 - NUDGE : 1 + NUDGE }
  return { seek: null, rate: 1 }
}

// Seek pacing. A big video on a modest PC can take longer to seek than
// one sync tick; seeking again before it lands restarts the seek, and the
// element freezes in a seek loop. So: never correct while a seek or a
// buffer stall is in progress, measure how long seeks take here, wait at
// least twice that before the next seek, and aim the seek that much
// ahead so it lands on time instead of already behind.
export const MIN_SEEK_COOLDOWN_MS = 750
export const MAX_SEEK_COOLDOWN_MS = 4000
// Never lead a seek by more than this (a pathological measurement).
export const MAX_SEEK_LEAD = 1.5

export type SeekPacer = {
  // EMA of measured seek durations, ms (0 = nothing measured yet).
  latencyMs: number
  // When the last seek was issued (0 = never) and when it completed.
  issuedAt: number
  pending: boolean
}

export function newSeekPacer(): SeekPacer {
  return { latencyMs: 0, issuedAt: 0, pending: false }
}

// seekCooldownMs: how long after a seek before another may be issued.
export function seekCooldownMs(p: SeekPacer): number {
  return Math.min(
    MAX_SEEK_COOLDOWN_MS,
    Math.max(MIN_SEEK_COOLDOWN_MS, p.latencyMs * 2)
  )
}

// canSeek: no seek in flight, and the cooldown since the last one is over.
export function canSeek(p: SeekPacer, nowMs: number): boolean {
  if (p.pending) return false
  return p.issuedAt === 0 || nowMs - p.issuedAt >= seekCooldownMs(p)
}

// seekLead: seconds to aim ahead when seeking a playing element.
export function seekLead(p: SeekPacer): number {
  return Math.min(MAX_SEEK_LEAD, p.latencyMs / 1000)
}

// seekLanded records a finished seek's duration into the EMA.
export function seekLanded(p: SeekPacer, nowMs: number) {
  if (!p.pending) return
  p.pending = false
  const took = Math.max(0, nowMs - p.issuedAt)
  p.latencyMs = p.latencyMs === 0 ? took : p.latencyMs * 0.6 + took * 0.4
}

// useSyncedPlayback keeps a media element on the clock. `clock` null
// disables it (legacy fill without anchors, or the surface is hidden).
// Muting is left to the caller.
export function useSyncedPlayback(
  ref: RefObject<HTMLMediaElement | null>,
  clock: PlayClock | null
) {
  // Latest clock in a ref so the interval reads it without re-arming.
  const clockRef = useRef(clock)
  clockRef.current = clock

  useEffect(() => {
    if (!clock) return
    // The element may mount after the clock appears (media list still
    // loading); the interval reads ref.current each tick, so it picks
    // the element up whenever it arrives.
    const el = ref.current
    const pacer = newSeekPacer()
    const step = () => {
      const c = clockRef.current
      const media = ref.current
      if (!c || !media || media.readyState < 1) return
      const now = Date.now()
      const ended = hasEnded(c, now, media.duration)
      const wantPlaying = c.playing && !ended
      if (wantPlaying && media.paused) void media.play().catch(() => {})
      if (!wantPlaying && !media.paused) media.pause()
      // A seek still landing, or a playing element stalled for data:
      // correcting now would only restart the wait. Let it finish.
      if (media.seeking || (wantPlaying && media.readyState < 3)) return
      // seeked is only listened for on the element present at arm time;
      // one that mounted later still lands its seeks here.
      if (pacer.pending) seekLanded(pacer, now)
      const target = targetPosition(c, now, media.duration)
      const fix = correction(media.currentTime, target, wantPlaying)
      if (fix.seek !== null && canSeek(pacer, now)) {
        const lead = wantPlaying ? seekLead(pacer) : 0
        const d = media.duration
        let to = fix.seek + lead
        if (Number.isFinite(d) && d > 0) {
          to = c.loop ? to % d : Math.min(to, Math.max(0, d - 0.05))
        }
        pacer.issuedAt = now
        pacer.pending = true
        media.currentTime = to
        if (media.playbackRate !== 1) media.playbackRate = 1
        return
      }
      // Between seeks, close what drift we can with the rate nudge.
      const rate =
        fix.seek !== null
          ? media.currentTime < target
            ? 1 + NUDGE
            : 1 - NUDGE
          : fix.rate
      if (media.playbackRate !== rate) media.playbackRate = rate
    }
    const onSeeked = () => {
      seekLanded(pacer, Date.now())
      step()
    }
    step()
    const timer = window.setInterval(step, 250)
    // React to the moment data arrives (first frame, after a seek
    // buffers) instead of waiting for the next tick.
    el?.addEventListener("loadedmetadata", step)
    el?.addEventListener("canplay", step)
    el?.addEventListener("seeked", onSeeked)
    return () => {
      window.clearInterval(timer)
      el?.removeEventListener("loadedmetadata", step)
      el?.removeEventListener("canplay", step)
      el?.removeEventListener("seeked", onSeeked)
    }
    // Re-arm when the clock appears/disappears or the element changes;
    // value changes flow through clockRef and the next step().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, !!clock, clock?.anchorMs, clock?.anchorPos, clock?.playing, clock?.loop])
}

// clockFrom builds a PlayClock from a media fill, or null when the fill
// has no anchor (legacy) — callers then fall back to plain play/pause.
export function clockFrom(media: {
  playing?: boolean
  loop?: boolean
  anchorMs?: number
  anchorPos?: number
} | null | undefined): PlayClock | null {
  if (!media || !media.anchorMs) return null
  return {
    playing: media.playing !== false,
    loop: !!media.loop,
    anchorMs: media.anchorMs,
    anchorPos: media.anchorPos ?? 0,
  }
}
