import { createFileRoute } from "@tanstack/react-router"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/resizable"

export const Route = createFileRoute("/_app/")({
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
  return (
    <ResizablePanelGroup orientation="vertical" className="h-full">
      <ResizablePanel defaultSize="70%" minSize="30%">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="20%" minSize="10%" maxSize="40%">
            <Pane label="Schedule" />
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
