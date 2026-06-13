import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { sampleFor } from "@/features/templates/samples"
import { isDefaultTemplateId } from "@/features/templates/defaults"
import {
  parseTemplateBody,
  type Box,
  type SlotFill,
  type TemplateBody,
} from "@/features/templates/types"
import { TEMPLATE_DEFAULT_FONT } from "@/features/templates/fonts"
import {
  useSaveTemplateWithID,
  useTemplate,
  useTemplates,
  useUpdateTemplate,
} from "@/features/library/templates-api"
import type { Template } from "@/bindings/neoprojector/database"

// The template editor is a Show-page surface split across two panes —
// options/inspector where the schedule normally sits, canvas where the
// show pane sits. TanStack Router has a single Outlet, so the regions
// can't be route children; this provider holds the working state and
// both region components consume it via context.
type TemplateEditorCtx = {
  template: Template | undefined
  isLoading: boolean
  isDefault: boolean
  // A default whose edits have been persisted as a shadow row. Badge
  // state only — editing works the same either way.
  isShadowed: boolean
  name: string
  setName: (v: string) => void
  body: TemplateBody | null
  setBody: (updater: (b: TemplateBody) => TemplateBody) => void
  selectedIndex: number
  setSelectedIndex: (i: number) => void
  selectedBox: Box | undefined
  fill: SlotFill
  updateBox: (i: number, patch: Partial<Box>) => void
  addBox: (slot: Box["slot"]) => void
  deleteBox: (i: number) => void
  duplicateBox: (i: number) => void
  onClose: () => void
}

const Ctx = createContext<TemplateEditorCtx | null>(null)

export function useTemplateEditor(): TemplateEditorCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useTemplateEditor outside provider")
  return ctx
}

export function TemplateEditorProvider({
  id,
  registerEscPolicy,
  onClose,
  children,
}: {
  id: number
  // Esc policy: deselect-then-exit. The page's surface-Esc handler
  // consults this before closing — false = handled internally (a box
  // was deselected), keep the surface open.
  registerEscPolicy: (fn: (() => boolean) | null) => void
  onClose: () => void
  children: ReactNode
}) {
  const { data: template, isLoading } = useTemplate(id)
  const { rows } = useTemplates()
  const updateMut = useUpdateTemplate()
  const saveWithIDMut = useSaveTemplateWithID()

  const isDefault = template ? isDefaultTemplateId(template.id) : false
  const isShadowed = isDefault && !!rows?.some((r) => r.id === id)

  // Working copy of the template body. Edits go straight here and an
  // auto-save effect debounces writes back to the DB for user
  // templates. We re-seed on template id change so switching between
  // templates resets working state.
  const [name, setName] = useState("")
  const [body, setBodyState] = useState<TemplateBody | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const lastLoadedIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!template) return
    if (lastLoadedIdRef.current === template.id) return
    lastLoadedIdRef.current = template.id
    setName(template.name)
    setBodyState(parseTemplateBody(template.data_json))
    setSelectedIndex(-1)
  }, [template])

  // Auto-save: any time the working copy diverges from the loaded
  // template, schedule a write. Debounced to 250ms so drag updates
  // (which can fire 30+ times per second) coalesce into a single
  // round-trip when the user pauses. Defaults are editable too: their
  // first save upserts a shadow row reusing the seed's negative id
  // (SaveWithID); user rows update in place.
  useEffect(() => {
    if (!template || !body) return
    if (lastLoadedIdRef.current !== template.id) return
    const live = JSON.stringify(body)
    const saved = JSON.stringify(parseTemplateBody(template.data_json))
    const trimmedName = name.trim()
    if (live === saved && trimmedName === template.name) return
    const handle = window.setTimeout(() => {
      const input = {
        id: template.id,
        name: trimmedName || template.name,
        kind: template.kind,
        viewportW: template.viewport_w,
        viewportH: template.viewport_h,
        dataJSON: live,
      }
      if (isDefault) saveWithIDMut.mutate(input)
      else updateMut.mutate(input)
    }, 250)
    return () => window.clearTimeout(handle)
    // Mutations are stable; intentionally omitted to keep the effect
    // keyed purely off content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, name, template, isDefault])

  const setBody = useCallback(
    (updater: (b: TemplateBody) => TemplateBody) => {
      setBodyState((b) => (b ? updater(b) : b))
    },
    []
  )

  const updateBox = useCallback(
    (i: number, patch: Partial<Box>) => {
      setBodyState((b) => {
        if (!b) return b
        const boxes = b.boxes.map((box, idx) =>
          idx === i ? { ...box, ...patch } : box
        )
        return { ...b, boxes }
      })
    },
    []
  )

  function addBox(slot: Box["slot"]) {
    if (!template || !body) return
    const isMedia = slot === "media"
    const newBox: Box = {
      slot,
      x: isMedia ? 0 : Math.round(template.viewport_w * 0.1),
      y: isMedia ? 0 : Math.round(template.viewport_h * 0.3),
      w: isMedia ? template.viewport_w : Math.round(template.viewport_w * 0.8),
      h: isMedia ? template.viewport_h : Math.round(template.viewport_h * 0.35),
      font: TEMPLATE_DEFAULT_FONT,
      fontSize: isMedia ? 40 : 80,
      fontSizeMin: 20,
      fitToBox: !isMedia,
      color: "#ffffff",
      weight: 700,
      italic: false,
      align: "center",
      vAlign: "middle",
      maxLines: 0,
      lineHeight: 1.2,
      // New text boxes ship with the legibility outline on — the
      // default text treatment over animated backgrounds. Media boxes
      // have no text to outline.
      ...(isMedia ? {} : { outlineWidth: 2, outlineColor: "#000000" }),
    }
    const nextIndex = body.boxes.length
    setBodyState((b) => (b ? { ...b, boxes: [...b.boxes, newBox] } : b))
    setSelectedIndex(nextIndex)
  }

  function deleteBox(i: number) {
    setBodyState((b) => {
      if (!b) return b
      return { ...b, boxes: b.boxes.filter((_, idx) => idx !== i) }
    })
    setSelectedIndex(-1)
  }

  function duplicateBox(i: number) {
    setBodyState((b) => {
      if (!b) return b
      const src = b.boxes[i]
      const copy: Box = { ...src, x: src.x + 20, y: src.y + 20 }
      return { ...b, boxes: [...b.boxes, copy] }
    })
    setSelectedIndex(body ? body.boxes.length : 0)
  }

  // Esc policy for the page-level surface handler: a selected box
  // deselects first; only a second Esc closes the surface. The old
  // route handled Escape inside its own key listener — that branch is
  // gone, Esc is owned by the surface layer now so the two capture
  // listeners can't race.
  const escPolicy = useCallback(() => {
    if (selectedIndex >= 0) {
      setSelectedIndex(-1)
      return false
    }
    return true
  }, [selectedIndex])
  useEffect(() => {
    registerEscPolicy(escPolicy)
    return () => registerEscPolicy(null)
  }, [registerEscPolicy, escPolicy])

  // Keyboard shortcuts: Delete = remove selected box,
  // Arrow keys = nudge 1px (10px with Shift), Ctrl+D = duplicate.
  //
  // Registered in the capture phase + stopImmediatePropagation on the
  // keys we actually handle. The global keybind hook (use-keybinds.ts)
  // also listens on window for arrow keys — without this, nudging a
  // box also fires the navigateNext/Prev handler and the live slide
  // advances in front of the audience.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (selectedIndex < 0 || !body) return
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault(); e.stopImmediatePropagation(); deleteBox(selectedIndex); return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault(); e.stopImmediatePropagation(); duplicateBox(selectedIndex); return
      }
      const step = e.shiftKey ? 10 : 1
      const box = body.boxes[selectedIndex]
      if (e.key === "ArrowLeft")  { e.preventDefault(); e.stopImmediatePropagation(); updateBox(selectedIndex, { x: box.x - step }); return }
      if (e.key === "ArrowRight") { e.preventDefault(); e.stopImmediatePropagation(); updateBox(selectedIndex, { x: box.x + step }); return }
      if (e.key === "ArrowUp")    { e.preventDefault(); e.stopImmediatePropagation(); updateBox(selectedIndex, { y: box.y - step }); return }
      if (e.key === "ArrowDown")  { e.preventDefault(); e.stopImmediatePropagation(); updateBox(selectedIndex, { y: box.y + step }); return }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, body])

  // Sample fill keyed to the template's declared kind — what the
  // canvas renders into the boxes while editing.
  const fill = template ? sampleFor(template.kind) : {}
  const selectedBox =
    body && selectedIndex >= 0 ? body.boxes[selectedIndex] : undefined

  return (
    <Ctx.Provider
      value={{
        template,
        isLoading,
        isDefault,
        isShadowed,
        name,
        setName,
        body,
        setBody,
        selectedIndex,
        setSelectedIndex,
        selectedBox,
        fill,
        updateBox,
        addBox,
        deleteBox,
        duplicateBox,
        onClose,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
