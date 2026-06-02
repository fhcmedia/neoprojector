import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Service as Displays } from "@/bindings/neoprojector/services/displays"
import {
  LivePayload,
  LiveFill,
  OverlayActivation,
} from "@/bindings/neoprojector/services/displays"
import type { SlotFill } from "@/features/templates/types"

// LiveSlide is what's currently broadcasting to the displays. Resolved
// once at click time so the preview tiles can fan out the same fill to
// every display's bound template without re-running content lookups.
export type LiveSlide = {
  // kind drives which template binding each display uses (bible_template_id
  // for kind 'bible', song_template_id for kind 'song').
  kind: "bible" | "song" | "media"
  // sourceItemId points back to the schedule item that produced this
  // slide (or null when it came from the bible library ad-hoc search).
  sourceItemId: number | null
  // slideIndex disambiguates which slide within the item is live (verse
  // index for bible, section index for song, 0 for media).
  slideIndex: number
  fill: SlotFill
  // Per-template uniform fontSize override computed by the operator's
  // uniform-fit pass. Keyed by template id; the value is a single
  // fontSize applied to every fitToBox box in that template across
  // every slide. Each template's floor is computed independently
  // against ITS box dimensions, so a lower-thirds template doesn't
  // drag a two-translations template down to its tighter floor.
  // Within a template, the value is the min across all boxes (e.g.
  // primary/secondary/tertiary translations) so every box renders at
  // the same size — verses across all translations stay visually
  // aligned. Stamped onto every slide dispatched via setLive; each
  // audience window looks up its own template's entry.
  fontSizeOverrideByTemplate?: {
    [templateId: number]: number
  }
  // Optional transition override. Set by presentation playback so
  // the audience honors the operator's per-presentation transition
  // choice instead of the template's default fade. Falsy values are
  // treated as "no override, use template default."
  transitionKind?: string
  transitionDurationMs?: number
  // Media id of the NEXT slide (for presentations with a known
  // upcoming slide). Output windows preload this asset behind the
  // scenes so the slide-change crossfade isn't waiting on decode
  // when many outputs hit the asset simultaneously.
  nextMediaId?: number
  // Exact bible reference for kind 'bible' — used in-window only (the
  // library drawer follows it to keep its highlight synced as the
  // operator navigates from the show pane). Not part of the broadcast
  // payload; the audience renders from `fill`.
  bibleRef?: { book: string; chapter: number; verse: number }
}

// ActiveOverlay = an overlay schedule item the operator has toggled
// on. Snapshot fields come from the service_item_overlay row at the
// moment of activation so the output side can render without
// re-fetching. activatedAt anchors time-based widgets (countdown
// duration, sermon timer elapsed) to the click instant.
export type ActiveOverlay = {
  scheduleItemId: number
  overlayKind: string
  name: string
  configJSON: string
  layoutsJSON: string
  rulesJSON: string
  activatedAt: number
}

// Navigators are installed by whoever owns the current slide list
// (today: ShowPane). The keybind hook calls navigateNext/Prev
// without knowing where the slides come from. registerNavigators
// returns nothing — the caller sets the same object on every render
// that depends on the slides, replacing the prior closures.
export type Navigators = {
  next: () => void
  prev: () => void
}

type Ctx = {
  live: LiveSlide | null
  setLive: (s: LiveSlide | null) => void
  isLive: (kind: LiveSlide["kind"], itemId: number | null, idx: number) => boolean
  // clearLive sets live back to null. Esc binding calls this — the
  // last template snaps to its "no fill" state (black for opaque
  // templates, audience-output canvas color for transparent ones).
  clearLive: () => void
  // clearOverlays removes all active overlays without touching the slide.
  clearOverlays: () => void
  // Active overlays toggle independently — multiple can be on at
  // once, layered over whatever slide is live.
  activeOverlays: ActiveOverlay[]
  toggleOverlay: (o: Omit<ActiveOverlay, "activatedAt">) => void
  isOverlayActive: (scheduleItemId: number) => boolean
  // Operator-side media playback controls. Each call updates the
  // current live slide's fill.media and re-pushes the payload so
  // output windows can reflect the new state. No-ops when the
  // current slide doesn't have a media fill.
  setMediaPlayback: (patch: {
    playing?: boolean
    loop?: boolean
    muted?: boolean
  }) => void
  restartMedia: () => void
  // republish re-sends the current snapshot to Go. The button uses
  // this after Go Live so that windows just opened by StartLive see
  // the latest payload — their initial CurrentLive() fetch can race
  // with the previous push, and we'd rather over-push than under-.
  republish: () => void
  // Slide navigation: the show pane registers handlers that know
  // its current slide list and live index. Keybinds invoke
  // navigateNext / navigatePrev without knowing the source.
  registerNavigators: (nav: Navigators) => void
  navigateNext: () => void
  navigatePrev: () => void
}

const LiveContext = createContext<Ctx>({
  live: null,
  setLive: () => {},
  isLive: () => false,
  clearLive: () => {},
  clearOverlays: () => {},
  activeOverlays: [],
  toggleOverlay: () => {},
  isOverlayActive: () => false,
  setMediaPlayback: () => {},
  restartMedia: () => {},
  republish: () => {},
  registerNavigators: () => {},
  navigateNext: () => {},
  navigatePrev: () => {},
})

// LiveProvider does NOT persist — restarting the app should always
// start with nothing live, since the operator has no way to confirm
// what's actually on the screens between sessions.
export function LiveProvider({ children }: { children: ReactNode }) {
  const [live, setLive] = useState<LiveSlide | null>(null)
  const [activeOverlays, setActiveOverlays] = useState<ActiveOverlay[]>([])

  // toggleOverlay flips an overlay schedule item between active /
  // not. Stamps activatedAt at the moment of the on-toggle so
  // time-based widgets get a stable anchor.
  const toggleOverlay = useCallback(
    (o: Omit<ActiveOverlay, "activatedAt">) => {
      setActiveOverlays((prev) => {
        const idx = prev.findIndex((a) => a.scheduleItemId === o.scheduleItemId)
        if (idx >= 0) return prev.filter((_, i) => i !== idx)
        return [...prev, { ...o, activatedAt: Date.now() }]
      })
    },
    []
  )

  const isOverlayActive = useCallback(
    (scheduleItemId: number) =>
      activeOverlays.some((a) => a.scheduleItemId === scheduleItemId),
    [activeOverlays]
  )

  const clearLive = useCallback(() => setLive(null), [])
  const clearOverlays = useCallback(() => setActiveOverlays([]), [])

  // Media playback patcher. Updates fill.media on the current slide
  // in-place (preserving every other field) so the push effect picks
  // it up and rebroadcasts. No-op when nothing is live or the live
  // slide has no media fill — keeps the keybind path safe to call
  // unconditionally.
  const setMediaPlayback = useCallback(
    (patch: { playing?: boolean; loop?: boolean; muted?: boolean }) => {
      setLive((prev) => {
        if (!prev?.fill.media) return prev
        return {
          ...prev,
          fill: {
            ...prev.fill,
            media: {
              ...prev.fill.media,
              ...patch,
            },
          },
        }
      })
    },
    []
  )

  // Restart bumps the token, which the output watches for changes.
  // Date.now() is monotonic enough for human-scale operator clicks
  // and guarantees uniqueness across reopens of an output window.
  const restartMedia = useCallback(() => {
    setLive((prev) => {
      if (!prev?.fill.media) return prev
      return {
        ...prev,
        fill: {
          ...prev.fill,
          media: {
            ...prev.fill.media,
            playing: true,
            restartToken: Date.now(),
          },
        },
      }
    })
  }, [])

  // Navigator handlers live in a ref so we don't trigger re-renders
  // of consumers when the show pane reinstalls them on slide-list
  // changes; the keybind hook just dereferences the ref at click
  // time.
  const navRef = useRef<Navigators>({ next: () => {}, prev: () => {} })
  const registerNavigators = useCallback((nav: Navigators) => {
    navRef.current = nav
  }, [])
  const navigateNext = useCallback(() => navRef.current.next(), [])
  const navigatePrev = useCallback(() => navRef.current.prev(), [])

  // Latest-known payload kept in a ref so republish() can re-send
  // without re-reading the effect's stale closure (and without
  // re-running the effect on a counter).
  const lastPayloadRef = useRef<LivePayload | null>(null)

  function buildPayload(): LivePayload {
    // Convert frontend's per-template single-number map into the
    // string-keyed shape Wails expects. Empty when no uniform-fit
    // pass has reported anything yet.
    const overrideByTemplate: { [k: string]: number } = {}
    if (live?.fontSizeOverrideByTemplate) {
      for (const [tmplId, size] of Object.entries(
        live.fontSizeOverrideByTemplate
      )) {
        if (typeof size === "number" && size > 0) overrideByTemplate[tmplId] = size
      }
    }
    return new LivePayload({
      kind: live?.kind ?? "none",
      source_item_id: live?.sourceItemId ?? 0,
      slide_index: live?.slideIndex ?? 0,
      font_size_override_by_template: overrideByTemplate,
      transition_kind: live?.transitionKind ?? "",
      transition_duration_ms: live?.transitionDurationMs ?? 0,
      next_media_id: live?.nextMediaId ?? 0,
      fill: live
        ? new LiveFill({
            primary: asString(live.fill.primary),
            secondary: asString(live.fill.secondary),
            tertiary: asString(live.fill.tertiary),
            caption: asString(live.fill.caption),
            media: live.fill.media
              ? {
                  mediaId: live.fill.media.mediaId,
                  mode: live.fill.media.mode ?? "",
                  // Default to playing/unmuted/no-loop when the
                  // operator hasn't touched the controls yet —
                  // matches the "send to live and it plays" expectation.
                  playing: live.fill.media.playing ?? true,
                  loop: live.fill.media.loop ?? false,
                  muted: live.fill.media.muted ?? false,
                  restart_token: live.fill.media.restartToken ?? 0,
                }
              : undefined,
          })
        : new LiveFill(),
      active_overlays: activeOverlays.map(
        (a) =>
          new OverlayActivation({
            schedule_item_id: a.scheduleItemId,
            kind: a.overlayKind,
            name: a.name,
            config_json: a.configJSON,
            layouts_json: a.layoutsJSON,
            rules_json: a.rulesJSON,
            activated_at_ms: a.activatedAt,
          })
      ),
    })
  }

  // Mirror to the Go side so every output webview can render the
  // current slide. Pushing on null clears the cache and broadcasts
  // an empty payload — output windows render that as black.
  // Rich-text SlotValue isn't carried across IPC yet; flatten to
  // plain strings (the live preview pipeline only emits strings so
  // far, but be defensive in case a template ships a rich default).
  useEffect(() => {
    const payload = buildPayload()
    lastPayloadRef.current = payload
    Displays.PushLive(payload).catch(() => {
      // Swallow — the output-side renderer can also pull state via
      // CurrentLive if the broadcast missed.
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, activeOverlays])

  // Called by the Go Live button after StartLive resolves. The new
  // output windows query CurrentLive on mount, but their event
  // listeners aren't attached yet at the moment Wails returns from
  // NewWithOptions — re-pushing after a short delay covers the gap
  // either way (the CurrentLive fetch reads the cached payload too).
  //
  // Only re-send the cached payload — never rebuild from outer-closure
  // state here. The empty-deps useCallback captures live/activeOverlays
  // at first render, so buildPayload() would broadcast stale state
  // (e.g. an empty payload) instead of what's actually on the air.
  const republish = useCallback(() => {
    const payload = lastPayloadRef.current
    if (!payload) return
    Displays.PushLive(payload).catch(() => {})
  }, [])

  const isLive = useCallback(
    (kind: LiveSlide["kind"], itemId: number | null, idx: number) => {
      if (!live) return false
      return (
        live.kind === kind &&
        live.sourceItemId === itemId &&
        live.slideIndex === idx
      )
    },
    [live]
  )

  return (
    <LiveContext.Provider
      value={{
        live,
        setLive,
        isLive,
        clearLive,
        clearOverlays,
        activeOverlays,
        toggleOverlay,
        isOverlayActive,
        setMediaPlayback,
        restartMedia,
        republish,
        registerNavigators,
        navigateNext,
        navigatePrev,
      }}
    >
      {children}
    </LiveContext.Provider>
  )
}

export function useLive() {
  return useContext(LiveContext)
}

function asString(v: SlotFill[keyof SlotFill] | undefined): string {
  if (v === undefined || v === null) return ""
  if (typeof v === "string") return v
  if (Array.isArray(v)) return v.map((s) => s.text).join("")
  return ""
}
