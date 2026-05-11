import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: Index,
})

function Index() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold text-foreground">neoprojector</h1>
    </div>
  )
}
