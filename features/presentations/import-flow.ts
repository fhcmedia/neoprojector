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
// in a single toast that turns into the result.
export async function runDeckImport(qc: QueryClient, presentationId: number, path: string) {
  const name = path.split(/[\/]/).pop() ?? path
  const id = toast.loading(`Importing ${name}…`, { description: "Converting…" })
  const refresh = () => qc.invalidateQueries({ queryKey: presentationKeys.slides(presentationId) })
  try {
    const n = await importDeck(presentationId, path, (p) => {
      toast.loading(`Importing ${name}…`, {
        id,
        description: p.stage === "converting" ? "Converting…" : `Page ${p.page} of ${p.pages}`,
      })
      if (p.stage === "rendering" && p.page > 1) void refresh()
    })
    toast.success(`Imported ${name}`, { id, description: `${n} slide${n === 1 ? "" : "s"}` })
  } catch (err) {
    toast.error(`Couldn't import ${name}`, {
      id,
      description: err instanceof Error ? err.message : String(err),
      duration: 15000,
    })
  } finally {
    await refresh()
    qc.invalidateQueries({ queryKey: presentationKeys.list })
    qc.invalidateQueries({ queryKey: ["media", "list"] })
  }
}
