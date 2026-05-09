import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { Greet } from "../../wailsjs/go/main/App"

export const Route = createFileRoute("/")({
  component: Index,
})

function Index() {
  const [name, setName] = useState("")
  const [submitted, setSubmitted] = useState("")

  const greetQuery = useQuery({
    queryKey: ["greet", submitted],
    queryFn: () => Greet(submitted),
    enabled: submitted.length > 0,
  })

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold text-foreground">neoprojector</h1>
      <div className="flex gap-2">
        <input
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Enter your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setSubmitted(name)}
        />
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          onClick={() => setSubmitted(name)}
        >
          Greet
        </button>
      </div>
      {greetQuery.data && (
        <p className="text-lg text-muted-foreground">{greetQuery.data}</p>
      )}
    </div>
  )
}
