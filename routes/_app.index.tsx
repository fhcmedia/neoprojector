import { useEffect, useRef, useState } from "react"
import {
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/resizable"
import { ServiceList } from "@/features/schedule/service-list"
import { ScheduleView } from "@/features/schedule/schedule-view"
import { EditorPanel } from "@/features/schedule/editor-panel"
import { AddFlow, EditFlow } from "@/features/schedule/editor-flow"
import { LibraryView } from "@/features/library/library-view"

type Search = {
  service?: number
  add?: number // section id to add into
  edit?: number // item id to edit
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

function Projector() {
  const navigate = useNavigate({ from: "/" })
  const {
    service: activeServiceId,
    add: addSectionId,
    edit: editItemId,
  } = Route.useSearch()
  const [activeItemId, setActiveItemId] = useState<number | undefined>()
  // newItemId is set after the add-drawer finishes sliding away. It cues
  // the matching ItemRow to play a brief squeeze-in so the user can see
  // what they just created. Cleared shortly after.
  const [newItemId, setNewItemId] = useState<number | undefined>()
  const pendingNewItemRef = useRef<number | undefined>(undefined)
  const newItemTimerRef = useRef<number | undefined>(undefined)

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

  // Set when a brand-new service is opened — ScheduleView consumes it to
  // auto-focus its name input, replacing the old "edit row in the list"
  // pattern that flashed during the slide-in.
  const [pendingNameEdit, setPendingNameEdit] = useState(false)

  const setActiveService = (id: number, opts?: { editName?: boolean }) => {
    setActiveItemId(undefined)
    if (id) {
      window.sessionStorage.setItem(AUTO_RESUME_KEY, String(id))
      window.sessionStorage.setItem(LAST_ACTIVE_KEY, String(id))
      setLastActiveServiceId(id)
      if (opts?.editName) setPendingNameEdit(true)
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

  const closeEditor = (
    mode: "slide" | "fade" = "slide",
    addedItemId?: number
  ) => {
    setEditorExitMode(mode)
    pendingNewItemRef.current = addedItemId
    navigate({
      search: (prev) => ({ ...prev, add: undefined, edit: undefined }),
      replace: true,
    })
  }

  // Fires once the editor panel finishes closing — that's the cue to
  // emphasise the newly added item.
  const handleEditorClosed = () => {
    const id = pendingNewItemRef.current
    pendingNewItemRef.current = undefined
    if (!id) return
    setNewItemId(id)
    if (newItemTimerRef.current)
      window.clearTimeout(newItemTimerRef.current)
    newItemTimerRef.current = window.setTimeout(
      () => setNewItemId(undefined),
      600
    )
  }

  useEffect(() => {
    return () => {
      if (newItemTimerRef.current)
        window.clearTimeout(newItemTimerRef.current)
    }
  }, [])

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

  const editorOpen = addSectionId !== undefined || editItemId !== undefined
  const editorTitle = addSectionId
    ? "Add item"
    : editItemId
      ? "Edit item"
      : ""

  useEffect(() => {
    if (editorOpen) setEditorExitMode("slide")
  }, [editorOpen])

  return (
    <ResizablePanelGroup orientation="vertical" className="h-full">
      <ResizablePanel defaultSize="70%" minSize="30%">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="20%" minSize="10%" maxSize="40%">
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
                      newItemId={newItemId}
                      autoEditName={pendingNameEdit}
                      onAutoEditConsumed={() => setPendingNameEdit(false)}
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
              <EditorPanel
                open={editorOpen}
                title={editorTitle}
                exitMode={editorExitMode}
                onBack={() => closeEditor("slide")}
                onClosed={handleEditorClosed}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {addSectionId !== undefined && (
                    <AddFlow
                      key={`add-${addSectionId}`}
                      sectionId={addSectionId}
                      onDone={(id) => closeEditor("fade", id)}
                    />
                  )}
                  {editItemId !== undefined && (
                    <EditFlow
                      key={`edit-${editItemId}`}
                      itemId={editItemId}
                      onDone={() => closeEditor("fade")}
                    />
                  )}
                </AnimatePresence>
              </EditorPanel>
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="60%" minSize="30%">
            <Pane label="Show" />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="20%" minSize="10%" maxSize="40%">
            <Pane label="Preview" />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="30%" minSize="10%" maxSize="60%">
        <LibraryView />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
