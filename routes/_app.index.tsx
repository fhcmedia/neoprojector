import { useCallback, useEffect, useRef, useState } from "react"
import {
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { useSessionState } from "@/hooks/use-session-state"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/resizable"
import type { PanelImperativeHandle } from "react-resizable-panels"
import { ServiceList } from "@/features/schedule/service-list"
import { ScheduleView } from "@/features/schedule/schedule-view"
import { EditorPanel } from "@/features/schedule/editor-panel"
import { AddFlow } from "@/features/schedule/editor-flow"
import { EditItemDialog } from "@/features/schedule/edit-item-dialog"
import { LibraryView } from "@/features/library/library-view"
import { DisplayPreviewPane } from "@/features/displays/display-preview-pane"
import { ShowPane, type AdHocBibleRef } from "@/features/show/show-pane"
import { BibleEditProvider } from "@/features/schedule/bible-edit-context"
import {
  useAppendPreviousVerse,
  useAppendMediaFromLibrary,
} from "@/features/schedule/api"
import { useLive } from "@/features/live/live-context"
import { useBackgrounds, useServiceRow } from "@/features/backgrounds/api"
import { snapshotFor } from "@/features/backgrounds/resolve"
import { parseSurface, type Surface } from "@/features/surfaces/surface-search"
import { useSurfaceEsc } from "@/features/surfaces/use-surface-esc"
import { SettingsSurface } from "@/features/settings/settings-surface"
import { TemplateEditorProvider } from "@/features/templates/editor/template-editor"
import { TemplateEditorOptions } from "@/features/templates/editor/template-editor-options"
import { TemplateEditorCanvas } from "@/features/templates/editor/template-editor-canvas"
import { OverlayEditorProvider } from "@/features/overlays/editor/overlay-editor"
import { OverlayEditorOptions } from "@/features/overlays/editor/overlay-editor-options"
import { OverlayEditorCanvas } from "@/features/overlays/editor/overlay-editor-canvas"
import { BackgroundEditorProvider } from "@/features/backgrounds/editor/background-editor"
import { BackgroundEditorOptions } from "@/features/backgrounds/editor/background-editor-options"
import { BackgroundEditorCanvas } from "@/features/backgrounds/editor/background-editor-canvas"

type Search = {
  service?: number
  add?: number // section id to add into
  edit?: number // item id to edit
  surface?: Surface
  editId?: number // which row a surface editor edits
}

// AUTO_RESUME_KEY drives the auto-redirect-on-app-load. Cleared when the
// user explicitly backs out so they actually land on the service list,
// rather than being instantly bounced back.
const AUTO_RESUME_KEY = "neoprojector.activeService"
// LAST_ACTIVE_KEY is the persistent breadcrumb — the row to mark with the
// emerald gradient. Never cleared on back-out; outlives the auto-resume so
// the user can still find where they were even after explicit navigation.
const LAST_ACTIVE_KEY = "neoprojector.lastActiveService"

function toOptionalNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v
  if (typeof v === "string" && v !== "") {
    const n = Number(v)
    return Number.isNaN(n) ? undefined : n
  }
  return undefined
}

export const Route = createFileRoute("/_app/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    service: toOptionalNumber(search.service),
    add: toOptionalNumber(search.add),
    edit: toOptionalNumber(search.edit),
    surface: parseSurface(search.surface),
    editId: toOptionalNumber(search.editId),
  }),
  beforeLoad: ({ search }) => {
    if (search.service) return
    if (typeof window === "undefined") return
    const saved = window.sessionStorage.getItem(AUTO_RESUME_KEY)
    if (!saved) return
    const id = Number(saved)
    if (!id) return
    throw redirect({
      to: "/",
      search: { service: id },
      replace: true,
    })
  },
  component: Projector,
})

function PaneLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute left-3 top-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
      {children}
    </div>
  )
}

function Pane({
  label,
  children,
}: {
  label: string
  children?: React.ReactNode
}) {
  return (
    <div className="relative h-full w-full bg-background">
      <PaneLabel>{label}</PaneLabel>
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/40">
        {children}
      </div>
    </div>
  )
}

// ServiceBackgroundBridge feeds the active service's default
// background into the live provider. Lives as a component (not a hook
// in Projector) so its queries don't re-render the whole page on
// every service-row refetch. Pushing null on back-out/no-service keeps
// the resting layer honest — no stale background from a previous
// service. Mid-live default changes re-derive automatically: mutation
// invalidates the service-row query, this effect re-fires, the live
// provider re-pushes.
function ServiceBackgroundBridge({
  serviceId,
}: {
  serviceId: number | undefined
}) {
  const { setServiceBackground } = useLive()
  const { data: backgrounds } = useBackgrounds()
  const { data: serviceRow } = useServiceRow(serviceId)
  // Content guard: snapshotFor mints a fresh object every run, and
  // pushing an identical-but-new object into the provider re-fires
  // the broadcast effect (one PushLive per refetch — or per FRAME
  // when an upstream list isn't memoized). Compare by value and only
  // set when something actually changed.
  const lastKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const id =
      serviceId && serviceRow && serviceRow.background_id?.Valid
        ? serviceRow.background_id.Int64
        : 0
    const snap = serviceId && serviceRow ? snapshotFor(id, backgrounds) : null
    const key = snap ? `${snap.background_id}:${snap.config_json}` : "none"
    if (lastKeyRef.current === key) return
    lastKeyRef.current = key
    setServiceBackground(snap)
  }, [serviceId, serviceRow, backgrounds, setServiceBackground])
  return null
}

function Projector() {
  const navigate = useNavigate({ from: "/" })
  const {
    service: activeServiceId,
    add: addSectionId,
    edit: editItemId,
    surface,
    editId,
  } = Route.useSearch()

  // Surfaces overlay the Show-page panes. Closing always drops both
  // params so a stale editId can't leak into the next open.
  const closeSurface = useCallback(() => {
    navigate({
      search: (prev) => ({ ...prev, surface: undefined, editId: undefined }),
      replace: true,
    })
  }, [navigate])

  // Editors with internal Esc behavior (template: deselect-then-exit)
  // register a policy here; Esc consults it before closing the surface.
  const escPolicyRef = useRef<(() => boolean) | null>(null)
  const registerEscPolicy = useCallback((fn: (() => boolean) | null) => {
    escPolicyRef.current = fn
  }, [])
  const onSurfaceEsc = useCallback(() => {
    if (escPolicyRef.current && !escPolicyRef.current()) return false
    closeSurface()
  }, [closeSurface])
  useSurfaceEsc(surface !== undefined, onSurfaceEsc)

  const templateEditorOpen = surface === "template" && editId !== undefined
  const overlayEditorOpen = surface === "overlay" && editId !== undefined
  const backgroundEditorOpen = surface === "background" && editId !== undefined
  // activeItemId persisted to sessionStorage so leaving for the
  // template editor (or any other route) and coming back lands the
  // user on the same item they were on. Cleared explicitly on
  // back-out via setActiveService(0).
  const [activeItemId, setActiveItemIdState] = useSessionState<number | undefined>(
    "neoprojector.activeItemId",
    undefined
  )
  // Ad-hoc bible source from the library Enter flow. Lives only for
  // the session — closing/reopening the app drops it.
  const [adHocBibleRef, setAdHocBibleRef] = useState<AdHocBibleRef | undefined>(
    undefined
  )

  // Imperative handle for the bottom library panel — LibraryView drives
  // collapse()/expand() on it for the auto-hide-while-presenting feature.
  const libraryPanelRef = useRef<PanelImperativeHandle | null>(null)
  // Bumped whenever the show pane navigates bible (verse click, arrows,
  // preview). LibraryView watches it to auto-collapse the now-redundant
  // bible drawer — drawer clicks don't bump it, so drawer use is safe.
  const [showBibleNavTick, setShowBibleNavTick] = useState(0)

  // Animate the library collapse/expand. react-resizable-panels snaps
  // size changes, so we enable a flex-grow CSS transition (house easing,
  // matching the editor panel) only for the duration of a PROGRAMMATIC
  // collapse/expand — manual handle dragging stays instant/responsive.
  // The global data-no-anim switch zeroes it like every other transition.
  const [libAnimating, setLibAnimating] = useState(false)
  // Reactive collapsed state — drives the chevron's direction. Synced
  // from the panel's own resize events so manual handle-drags update it
  // too, not just our programmatic collapse/expand.
  const [libraryCollapsed, setLibraryCollapsed] = useState(false)
  const animateLibrary = useCallback((fn: () => void) => {
    setLibAnimating(true)
    fn()
    window.setTimeout(() => setLibAnimating(false), 360)
  }, [])
  const collapseLibrary = useCallback(
    () => animateLibrary(() => libraryPanelRef.current?.collapse()),
    [animateLibrary]
  )
  const expandLibrary = useCallback(
    () => animateLibrary(() => libraryPanelRef.current?.expand()),
    [animateLibrary]
  )

  // Selecting a schedule item drops any ad-hoc bible source (they're
  // mutually exclusive as the Show pane's input).
  const setActiveItemId = (id: number | undefined) => {
    setActiveItemIdState(id)
    if (id !== undefined) setAdHocBibleRef(undefined)
  }

  // Auto-append the broadcast reference to the active service's
  // "Scripture from Library" inbox so the operator can re-pick it
  // from the schedule later without retyping. Adjacent verses merge
  // into the last item — Mark 1:5 then 1:6 stays one row as 1:5-6.
  const appendPreviousVerse = useAppendPreviousVerse(activeServiceId)
  // Mirror behaviour for media — appends to "Media from Library" so
  // anything sent from the media tab persists for the rest of the
  // service. No merge / dedupe: clicking the same media twice creates
  // two rows so the operator can build a sequence.
  const appendMediaFromLibrary = useAppendMediaFromLibrary(activeServiceId)

  // Library Enter sets the ad-hoc ref AND clears active item so the show
  // pane swaps over cleanly. The verse goes live immediately; once the
  // append resolves we backfill the resulting row id so the live state
  // correlates to the "Scripture from Library" row and it highlights as
  // live in the schedule. The guard avoids stamping a stale id if the
  // operator has already typed another reference.
  const submitAdHocBibleRef = async (ref: AdHocBibleRef) => {
    setActiveItemIdState(undefined)
    setAdHocBibleRef(ref)
    const itemId = await appendPreviousVerse({
      book: ref.book,
      chapter: ref.chapter,
      verse_start: ref.verseStart,
      verse_end: ref.verseEnd,
    })
    if (itemId == null) return
    setAdHocBibleRef((prev) =>
      prev &&
      prev.book === ref.book &&
      prev.chapter === ref.chapter &&
      prev.verseStart === ref.verseStart &&
      prev.verseEnd === ref.verseEnd
        ? { ...prev, itemId }
        : prev
    )
  }

  // Media tile click in the library: append to the inbox, then set
  // the new schedule item as the show-pane source so the operator
  // immediately sees the preview (and can click that to go live).
  const handleMediaPick = async (mediaId: number) => {
    const newItemId = await appendMediaFromLibrary(mediaId)
    if (newItemId !== null && newItemId !== undefined) {
      setActiveItemId(newItemId)
    }
  }

  // Persisted "last opened" service id. Survives back-out so the service
  // list can mark the most recently used row — handy after a reload or
  // when the user backs out and wants to find where they were.
  const [lastActiveServiceId, setLastActiveServiceId] = useState<
    number | undefined
  >(() => {
    if (typeof window === "undefined") return undefined
    const saved = window.sessionStorage.getItem(LAST_ACTIVE_KEY)
    const n = saved ? Number(saved) : 0
    return n || undefined
  })

  const setActiveService = (id: number) => {
    setActiveItemId(undefined)
    if (id) {
      window.sessionStorage.setItem(AUTO_RESUME_KEY, String(id))
      window.sessionStorage.setItem(LAST_ACTIVE_KEY, String(id))
      setLastActiveServiceId(id)
    } else {
      // Back-out: clear the auto-resume so the user actually sees the
      // service list. The breadcrumb (LAST_ACTIVE_KEY) is kept so the row
      // still shows the emerald marker.
      window.sessionStorage.removeItem(AUTO_RESUME_KEY)
    }
    navigate({
      search: { service: id || undefined },
      replace: true,
    })
  }

  // exitMode controls which close animation plays. Save completion uses
  // "fade" so the panel dissolves in place; explicit back uses "slide" so
  // the panel retreats off-screen.
  const [editorExitMode, setEditorExitMode] = useState<"slide" | "fade">(
    "slide"
  )

  const closeEditor = (mode: "slide" | "fade" = "slide") => {
    setEditorExitMode(mode)
    navigate({
      search: (prev) => ({ ...prev, add: undefined, edit: undefined }),
      replace: true,
    })
  }

  const openAdd = (sectionId: number) =>
    navigate({
      search: (prev) => ({
        ...prev,
        add: sectionId,
        edit: undefined,
      }),
      replace: true,
    })

  const openEdit = (itemId: number) =>
    navigate({
      search: (prev) => ({
        ...prev,
        edit: itemId,
        add: undefined,
      }),
      replace: true,
    })

  const editorOpen = addSectionId !== undefined

  useEffect(() => {
    if (editorOpen) setEditorExitMode("slide")
  }, [editorOpen])

  // The top row (schedule | center | displays) is shared between the
  // normal projector layout and editor surfaces — editors swap the
  // left + center pane contents but keep the displays preview live.
  // Extracted so the editor provider can wrap BOTH panes (they
  // communicate through its context, not through the route tree).
  const topRow = (
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="20%" minSize="10%" maxSize="40%">
            {templateEditorOpen ? (
              <TemplateEditorOptions />
            ) : overlayEditorOpen ? (
              <OverlayEditorOptions />
            ) : backgroundEditorOpen ? (
              <BackgroundEditorOptions />
            ) : (
            <div className="relative h-full w-full overflow-hidden">
              {/* No mode="wait" — we want the incoming view to slide on
                 top of the outgoing one. Otherwise the just-created
                 service can briefly flash in the still-mounted list
                 (the invalidation refetch lands during exit) before
                 the schedule view enters. */}
              <AnimatePresence initial={false}>
                {activeServiceId ? (
                  <motion.div
                    key={`schedule-${activeServiceId}`}
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                    className="absolute inset-0 z-[1] bg-background"
                  >
                    <ScheduleView
                      serviceId={activeServiceId}
                      onBack={() => setActiveService(0)}
                      activeItemId={activeItemId}
                      onSelectItem={setActiveItemId}
                      onAddItem={openAdd}
                      onEditItem={openEdit}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="services"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                    className="absolute inset-0 bg-background"
                  >
                    <ServiceList
                      activeServiceId={activeServiceId}
                      lastActiveServiceId={lastActiveServiceId}
                      onSelect={setActiveService}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <EditorPanel open={editorOpen} exitMode={editorExitMode}>
                <AnimatePresence mode="wait" initial={false}>
                  {addSectionId !== undefined && (
                    <AddFlow
                      key={`add-${addSectionId}`}
                      sectionId={addSectionId}
                      onDone={() => closeEditor("fade")}
                      onClose={() => closeEditor("slide")}
                    />
                  )}
                </AnimatePresence>
              </EditorPanel>
              <EditItemDialog
                itemId={editItemId}
                onClose={() => closeEditor("fade")}
              />
            </div>
            )}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="60%" minSize="30%">
            {surface === "settings" ? (
              <SettingsSurface onClose={closeSurface} />
            ) : templateEditorOpen ? (
              <TemplateEditorCanvas />
            ) : overlayEditorOpen ? (
              <OverlayEditorCanvas />
            ) : backgroundEditorOpen ? (
              <BackgroundEditorCanvas />
            ) : (
              <ShowPane
                activeItemId={activeItemId}
                adHocBibleRef={adHocBibleRef}
                onAdHocBibleRef={submitAdHocBibleRef}
                onShowBibleNav={() => setShowBibleNavTick((t) => t + 1)}
              />
            )}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="20%" minSize="10%" maxSize="40%">
            <DisplayPreviewPane />
          </ResizablePanel>
        </ResizablePanelGroup>
  )

  return (
    <BibleEditProvider>
      <ServiceBackgroundBridge serviceId={activeServiceId} />
      <ResizablePanelGroup orientation="vertical" className="h-full">
      <ResizablePanel defaultSize="70%" minSize="30%">
        {templateEditorOpen && editId !== undefined ? (
          <TemplateEditorProvider
            id={editId}
            registerEscPolicy={registerEscPolicy}
            onClose={closeSurface}
          >
            {topRow}
          </TemplateEditorProvider>
        ) : overlayEditorOpen && editId !== undefined ? (
          <OverlayEditorProvider id={editId} onClose={closeSurface}>
            {topRow}
          </OverlayEditorProvider>
        ) : backgroundEditorOpen && editId !== undefined ? (
          <BackgroundEditorProvider id={editId} onClose={closeSurface}>
            {topRow}
          </BackgroundEditorProvider>
        ) : (
          topRow
        )}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel
        defaultSize="30%"
        minSize="10%"
        maxSize="60%"
        collapsible
        collapsedSize="2rem"
        panelRef={libraryPanelRef}
        onResize={() =>
          setLibraryCollapsed(libraryPanelRef.current?.isCollapsed() ?? false)
        }
        style={
          libAnimating
            ? // `flex` (not just flex-grow): collapsing to the fixed
              // 2rem changes flex-basis, expanding changes flex-grow —
              // transitioning the shorthand animates BOTH directions.
              { transition: "flex 320ms cubic-bezier(0.32, 0.72, 0, 1)" }
            : undefined
        }
      >
        <LibraryView
          onAdHocBibleRef={submitAdHocBibleRef}
          onMediaPick={handleMediaPick}
          onCollapseRequest={collapseLibrary}
          onExpandRequest={expandLibrary}
          collapsed={libraryCollapsed}
          showNavTick={showBibleNavTick}
        />
      </ResizablePanel>
      </ResizablePanelGroup>
    </BibleEditProvider>
  )
}
