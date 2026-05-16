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
    return new LivePayload({
      kind: live?.kind ?? "none",
      source_item_id: live?.sourceItemId ?? 0,
      slide_index: live?.slideIndex ?? 0,
      fill: live
        ? new LiveFill({
            primary: asString(live.fill.primary),
            secondary: asString(live.fill.secondary),
            tertiary: asString(live.fill.tertiary),
            caption: asString(live.fill.caption),
            media: live.fill.media
              ? { mediaId: live.fill.media.mediaId, mode: live.fill.media.mode ?? "" }
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
  const republish = useCallback(() => {
    const payload = lastPayloadRef.current ?? buildPayload()
    Displays.PushLive(payload).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
