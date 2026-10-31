import { useEffect, useRef, useState } from "react"
import { BackgroundView } from "@/features/backgrounds/background-view"
import type { BackgroundSnapshot } from "@/bindings/neoprojector/services/displays"

// BackgroundCrossfade shows the live background and dissolves between
// changes instead of cutting.
//
// A new background's WebGL engine needs a few frames (shader compile,
// first draw) before it paints anything; mounting it in place of the old
// one flashed black and then popped in. So each background gets its own
// layer: the new layer mounts invisible ON TOP of the old one, and only
// once it has drawn its first frame does it fade in — the old layer
// stays fully visible underneath for the whole fade, then unmounts.
// Clearing the background (null) fades everything out to black.
//
// Same background with edited settings (live editing in the background
// editor) keeps its layer and just updates in place.

export const BACKGROUND_FADE_MS = 800
// A layer whose engine never reports a first frame still gets revealed,
// so a broken background can't freeze the previous one on screen.
export const READY_TIMEOUT_MS = 2000

export type BgLayer = {
  uid: number
  key: string
  bg: BackgroundSnapshot
  ready: boolean
  // Covered by a newer ready layer or faded out; removed after the fade.
  doomed: boolean
  // Fading to black (background cleared) rather than being covered.
  fadingOut: boolean
}

// backgroundKey identifies "the same background": the saved row when it
// has one, else its exact content.
export function backgroundKey(b: BackgroundSnapshot): string {
  return b.background_id > 0
    ? `id:${b.background_id}`
    : `cfg:${b.engine}:${b.config_json}`
}

// nextLayers is the layer list after the live background becomes `bg`.
export function nextLayers(
  layers: BgLayer[],
  bg: BackgroundSnapshot | null,
  uid: number
): BgLayer[] {
  if (!bg) {
    return layers.map((l) => ({ ...l, doomed: true, fadingOut: true }))
  }
  const key = backgroundKey(bg)
  const current = layers.find((l) => l.key === key && !l.doomed)
  if (current) {
    // Same background (maybe edited) — update in place, no fade.
    return layers.map((l) => (l === current ? { ...l, bg } : l))
  }
  return [
    ...layers,
    { uid, key, bg, ready: false, doomed: false, fadingOut: false },
  ]
}

// layerReady marks a layer painted. Everything beneath it is now covered
// and can go once the fade-in completes.
export function layerReady(layers: BgLayer[], uid: number): BgLayer[] {
  const idx = layers.findIndex((l) => l.uid === uid)
  if (idx < 0 || layers[idx].ready) return layers
  return layers.map((l, i) =>
    i === idx ? { ...l, ready: true } : i < idx ? { ...l, doomed: true } : l
  )
}

// layerOpacity: hidden until painted; covered layers stay opaque under
// the incoming one (a true crossfade, no dip); fading-out layers go to 0.
export function layerOpacity(l: BgLayer): number {
  return l.ready && !l.fadingOut ? 1 : 0
}

export function BackgroundCrossfade({
  background,
  durationMs = BACKGROUND_FADE_MS,
}: {
  background: BackgroundSnapshot | null
  durationMs?: number
}) {
  const uidRef = useRef(0)
  const [layers, setLayers] = useState<BgLayer[]>(() =>
    background ? nextLayers([], background, ++uidRef.current) : []
  )
  const contentKey = background
    ? `${backgroundKey(background)}|${background.config_json}`
    : "none"

  useEffect(() => {
    setLayers((prev) => nextLayers(prev, background, ++uidRef.current))
    // contentKey captures every change that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey])

  // Remove doomed layers once their fade has run; force-reveal layers
  // whose engine never reported a first frame.
  const timers = useRef(new Map<string, number>())
  useEffect(() => {
    for (const l of layers) {
      const removeId = `rm:${l.uid}`
      if (l.doomed && !timers.current.has(removeId)) {
        timers.current.set(
          removeId,
          window.setTimeout(() => {
            timers.current.delete(removeId)
            setLayers((prev) => prev.filter((x) => x.uid !== l.uid))
          }, durationMs + 50)
        )
      }
      const readyId = `rd:${l.uid}`
      if (!l.ready && !l.doomed && !timers.current.has(readyId)) {
        timers.current.set(
          readyId,
          window.setTimeout(() => {
            timers.current.delete(readyId)
            setLayers((prev) => layerReady(prev, l.uid))
          }, READY_TIMEOUT_MS)
        )
      }
    }
  }, [layers, durationMs])
  useEffect(() => {
    const t = timers.current
    return () => {
      for (const id of t.values()) window.clearTimeout(id)
      t.clear()
    }
  }, [])

  return (
    <>
      {layers.map((l) => (
        <div
          key={l.uid}
          aria-hidden
          ref={(el) => {
            // Inline !important so the global [data-no-anim] kill-switch
            // can't collapse this content fade (same discipline as
            // LiveTemplateView's crossfade).
            el?.style.setProperty("transition", `opacity ${durationMs}ms ease-in-out`, "important")
          }}
          style={{ position: "absolute", inset: 0, opacity: layerOpacity(l) }}
        >
          <BackgroundView
            background={l.bg}
            onReady={() => setLayers((prev) => layerReady(prev, l.uid))}
          />
        </div>
      ))}
    </>
  )
}
