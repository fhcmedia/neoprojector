import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  useBackgrounds,
  useDeleteBackground,
  useSaveBackgroundWithID,
  useUpdateBackground,
} from "@/features/backgrounds/api"
import {
  isDefaultBackgroundId,
  defaultBackgrounds,
} from "@/features/backgrounds/presets"

// Editable gradflow knobs. Colors are hex strings (gradflow accepts
// string | RGB); type is one of its fixed shader set.
export type GradflowConfig = {
  type: string
  color1: string
  color2: string
  color3: string
  speed: number
  scale: number
  noise: number
}

export const GRADFLOW_TYPES = [
  "linear",
  "animated",
  "conic",
  "wave",
  "silk",
  "smoke",
  "stripe",
] as const

const FALLBACK_CONFIG: GradflowConfig = {
  type: "silk",
  color1: "#e0e0e0",
  color2: "#0d0d0d",
  color3: "#8c8c8c",
  speed: 0.4,
  scale: 1.2,
  noise: 0.15,
}

export function parseGradflowConfig(json: string): GradflowConfig {
  try {
    const p = JSON.parse(json || "{}") as Partial<GradflowConfig>
    return {
      type: typeof p.type === "string" ? p.type : FALLBACK_CONFIG.type,
      color1: typeof p.color1 === "string" ? p.color1 : FALLBACK_CONFIG.color1,
      color2: typeof p.color2 === "string" ? p.color2 : FALLBACK_CONFIG.color2,
      color3: typeof p.color3 === "string" ? p.color3 : FALLBACK_CONFIG.color3,
      speed: typeof p.speed === "number" ? p.speed : FALLBACK_CONFIG.speed,
      scale: typeof p.scale === "number" ? p.scale : FALLBACK_CONFIG.scale,
      noise: typeof p.noise === "number" ? p.noise : FALLBACK_CONFIG.noise,
    }
  } catch {
    return FALLBACK_CONFIG
  }
}

// The background editor is a Show-page surface: options where the
// schedule sits, full-bleed live preview where the show pane sits.
// Unlike templates (read-only defaults, duplicate-to-edit), seed
// backgrounds are DIRECTLY editable — the first edit persists a shadow
// row reusing the seed's negative id, and "Restore default" deletes
// that row to reveal the pristine seed again. Schedule assignments
// keep pointing at the same id either way.
type BackgroundEditorCtx = {
  id: number
  isSeed: boolean
  isShadowed: boolean
  isLoading: boolean
  name: string
  setName: (v: string) => void
  config: GradflowConfig
  setConfig: (patch: Partial<GradflowConfig>) => void
  restoreSeed: () => void
  onClose: () => void
}

const Ctx = createContext<BackgroundEditorCtx | null>(null)

export function useBackgroundEditor(): BackgroundEditorCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useBackgroundEditor outside provider")
  return ctx
}

export function BackgroundEditorProvider({
  id,
  onClose,
  children,
}: {
  id: number
  onClose: () => void
  children: ReactNode
}) {
  const { data: backgrounds, rows, isLoading } = useBackgrounds()
  const saveWithIDMut = useSaveBackgroundWithID()
  const updateMut = useUpdateBackground()
  const deleteMut = useDeleteBackground()

  const isSeed = isDefaultBackgroundId(id)
  const isShadowed = isSeed && !!rows?.some((r) => r.id === id)
  const doc = backgrounds?.find((b) => b.id === id)

  // Working copy. Reseeded when the edited id changes; NOT reseeded on
  // every refetch (the autosave round-trip would stomp in-flight
  // edits).
  const [name, setName] = useState("")
  const [config, setConfigState] = useState<GradflowConfig>(FALLBACK_CONFIG)
  const lastLoadedIdRef = useRef<number | null>(null)
  // True for exactly one render after the load effect hydrates state.
  // The autosave effect below runs in the SAME commit as the load
  // effect but still sees the pre-hydration state in its closure —
  // without this skip it could schedule a save of the fallback config
  // over the freshly-loaded document.
  const justLoadedRef = useRef(false)
  useEffect(() => {
    if (!doc) return
    if (lastLoadedIdRef.current === id) return
    lastLoadedIdRef.current = id
    justLoadedRef.current = true
    setName(doc.name)
    setConfigState(parseGradflowConfig(doc.config_json))
  }, [doc, id])

  const setConfig = useCallback((patch: Partial<GradflowConfig>) => {
    setConfigState((c) => ({ ...c, ...patch }))
  }, [])

  // Debounced autosave. Seeds upsert their shadow row (SaveWithID);
  // user rows update in place. Slider drags coalesce into one write.
  useEffect(() => {
    if (!doc || lastLoadedIdRef.current !== id) return
    if (justLoadedRef.current) {
      justLoadedRef.current = false
      return
    }
    const live = JSON.stringify(config)
    const savedConfig = JSON.stringify(parseGradflowConfig(doc.config_json))
    const trimmedName = name.trim()
    if (live === savedConfig && (trimmedName === doc.name || !trimmedName)) {
      return
    }
    const handle = window.setTimeout(() => {
      const input = {
        id,
        name: trimmedName || doc.name,
        engine: "gradflow",
        configJSON: live,
      }
      if (isSeed) saveWithIDMut.mutate(input)
      else updateMut.mutate(input)
    }, 300)
    return () => window.clearTimeout(handle)
    // Mutations are stable; keyed off content only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, name, doc, id, isSeed])

  // Restore: drop the shadow row, reseed the working copy from the
  // pristine seed so the canvas snaps back instantly (the list
  // invalidation follows asynchronously). Nulling lastLoadedIdRef
  // disarms the autosave until the refetched doc re-hydrates state —
  // otherwise a queued save could race the delete and resurrect the
  // shadow row.
  const restoreSeed = useCallback(() => {
    if (!isSeed || !isShadowed) return
    lastLoadedIdRef.current = null
    deleteMut.mutate(id)
    const seed = defaultBackgrounds.find((b) => b.id === id)
    if (seed) {
      setName(seed.name)
      setConfigState(parseGradflowConfig(seed.config_json))
    }
  }, [isSeed, isShadowed, id, deleteMut])

  return (
    <Ctx.Provider
      value={{
        id,
        isSeed,
        isShadowed,
        isLoading,
        name,
        setName,
        config,
        setConfig,
        restoreSeed,
        onClose,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
