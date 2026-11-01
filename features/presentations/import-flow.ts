import type { QueryClient } from "@tanstack/react-query"
import { openFilesSafe } from "@/lib/open-files"
import { toast } from "sonner"
import { Service as Presentations } from "@/bindings/neoprojector/services/presentations"
import type { Presentation } from "@/bindings/neoprojector/database"
import { presentationKeys } from "@/features/presentations/api"
import { DECK_FILE_PATTERN, deckName, importDeck } from "@/features/presentations/deck-import"

// pickDeckFiles opens the file dialog for PDFs / PowerPoint files.
export async function pickDeckFiles(): Promise<string[]> {
  const picked = await openFilesSafe({
    Title: "Import PowerPoint or PDF",
    AllowsMultipleSelection: true,
    CanChooseFiles: true,
    CanChooseDirectories: false,
    Filters: [
      { DisplayName: "PowerPoint / PDF", Pattern: DECK_FILE_PATTERN },
      { DisplayName: "All files", Pattern: "*.*" },
    ],
  })
  return Array.isArray(picked) ? picked : typeof picked === "string" && picked ? [picked] : []
}

// createPresentationFromDeck makes a presentation named after the file,
// then imports its pages in the background with a progress toast.
// Resolves with the new presentation as soon as it exists (callers can
// schedule it right away; slides appear as pages finish).
export async function createPresentationFromDeck(
  qc: QueryClient,
  path: string
): Promise<Presentation> {
  const name = deckName(path)
  const created = (await Presentations.CreatePresentation(name)) as unknown as Presentation
  qc.invalidateQueries({ queryKey: presentationKeys.list })
  void runDeckImport(qc, created.id, path)
  return created
}

// runDeckImport imports one deck into a presentation, showing progress
// in a single toast that turns into the result. The toast says what is
// happening, counts the elapsed time (so a long one-time converter setup
// visibly isn't stuck) and has a Cancel button.
export async function runDeckImport(qc: QueryClient, presentationId: number, path: string) {
  const name = path.split(/[\\/]/).pop() ?? path
  const id = toast.loading(`Importing ${name}…`, { description: "Preparing…" })
  const refresh = () => qc.invalidateQueries({ queryKey: presentationKeys.slides(presentationId) })
  const ac = new AbortController()
  const started = Date.now()
  let detail = "Preparing…"
  const show = () =>
    toast.loading(`Importing ${name}…`, {
      id,
      description: `${detail} · ${formatElapsed(Date.now() - started)}`,
      action: { label: "Cancel", onClick: () => ac.abort() },
      duration: Infinity,
    })
  show()
  const tick = window.setInterval(show, 1000)
  try {
    const n = await importDeck(
      presentationId,
      path,
      (p) => {
        detail = p.stage === "converting" ? p.detail : `Page ${p.page} of ${p.pages}`
        show()
        if (p.stage === "rendering" && p.page > 1) void refresh()
      },
      ac.signal
    )
    window.clearInterval(tick)
    if (ac.signal.aborted) {
      toast.info(`Stopped importing ${name}`, { id, description: `${n} slide${n === 1 ? "" : "s"} added`, action: undefined, duration: 5000 })
    } else {
      toast.success(`Imported ${name}`, { id, description: `${n} slide${n === 1 ? "" : "s"}`, action: undefined, duration: 5000 })
    }
  } catch (err) {
    window.clearInterval(tick)
    if (ac.signal.aborted) {
      toast.info(`Stopped importing ${name}`, { id, description: undefined, action: undefined, duration: 5000 })
    } else {
      toast.error(`Couldn't import ${name}`, {
        id,
        description: errorText(err),
        action: undefined,
        duration: 15000,
      })
    }
  } finally {
    await refresh()
    qc.invalidateQueries({ queryKey: presentationKeys.list })
    qc.invalidateQueries({ queryKey: ["media", "list"] })
  }
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// errorText: Wails binding errors arrive as JSON ({"message": …}).
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  try {
    const j = JSON.parse(raw) as { message?: string }
    if (j?.message) return j.message
  } catch {
    // not JSON
  }
  return raw
}
