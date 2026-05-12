import { useState } from "react"
import {
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/resizable"
import { ServiceList } from "@/features/schedule/service-list"
import { ScheduleView } from "@/features/schedule/schedule-view"

type Search = {
  service?: number
}

// Session-scoped memory of the last opened service. Cleared when the user
// explicitly backs out of a service. Persists across in-app navigation so
// hopping to /settings and back returns you to where you were.
const ACTIVE_SERVICE_KEY = "neoprojector.activeService"

export const Route = createFileRoute("/_app/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    service:
      typeof search.service === "number"
        ? search.service
        : typeof search.service === "string" && search.service !== ""
          ? Number(search.service)
          : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.service) return
    if (typeof window === "undefined") return
    const saved = window.sessionStorage.getItem(ACTIVE_SERVICE_KEY)
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
  const { service: activeServiceId } = Route.useSearch()
  const [activeItemId, setActiveItemId] = useState<number | undefined>()

  const setActiveService = (id: number) => {
    setActiveItemId(undefined)
    if (id) {
      window.sessionStorage.setItem(ACTIVE_SERVICE_KEY, String(id))
    } else {
      window.sessionStorage.removeItem(ACTIVE_SERVICE_KEY)
    }
    navigate({
      search: { service: id || undefined },
      replace: true,
    })
  }

  return (
    <ResizablePanelGroup orientation="vertical" className="h-full">
      <ResizablePanel defaultSize="70%" minSize="30%">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="20%" minSize="10%" maxSize="40%">
            {activeServiceId ? (
              <ScheduleView
                serviceId={activeServiceId}
                onBack={() => setActiveService(0)}
                activeItemId={activeItemId}
                onSelectItem={setActiveItemId}
              />
            ) : (
              <ServiceList
                activeServiceId={activeServiceId}
                onSelect={setActiveService}
              />
            )}
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
        <Pane label="Library" />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
