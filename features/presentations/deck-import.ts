import { Events } from "@wailsio/runtime"
import { Service as Presentations } from "@/bindings/neoprojector/services/presentations"
import type { DeckFile } from "@/bindings/neoprojector/services/presentations"

import { convertDetail } from "./deck-import-text"

export {
  convertDetail,
  deckName,
  DECK_EXTENSIONS,
  DECK_FILE_PATTERN,
  isDeckPath,
} from "./deck-import-text"

// "deck:progress" event payload (services/presentations/deck.go).
type DeckProgress = { path: string; stage: string; pct: number }

// Importing a PDF or PowerPoint file as presentation slides. The Go side
// (services/presentations/deck.go) converts PowerPoint files to PDF; here
// pdf.js renders each page into an image, which becomes one slide. See
// deck.go for the whole flow.

export type DeckImportProgress =
  // Before pages exist: what the converter is doing right now (a
  // readable sentence) and a percentage when it's known.
  | { stage: "converting"; detail: string; pct?: number }
  | { stage: "rendering"; page: number; pages: number }

// Pages are rendered to fit 1920x1080 (the projector), keeping their
// aspect; WebP at high quality keeps text crisp at a fraction of PNG's
// size.
const MAX_W = 1920
const MAX_H = 1080
const QUALITY = 0.92

// importDeck appends every page of the file at path to the presentation
// and returns how many slides were added. Throws with a readable message
// when the file can't be converted or read.
// signal cancels: the conversion (download/LibreOffice/PowerPoint) is
// stopped on the Go side, and pages already added stay.
export async function importDeck(
  presentationId: number,
  path: string,
  onProgress?: (p: DeckImportProgress) => void,
  signal?: AbortSignal
): Promise<number> {
  onProgress?.({ stage: "converting", detail: "Preparing…" })
  const off = Events.On("deck:progress", (e: { data?: DeckProgress }) => {
    const d = e?.data
    if (!d || d.path !== path) return
    onProgress?.({
      stage: "converting",
      detail: convertDetail(d.stage, d.pct),
      pct: d.pct >= 0 ? d.pct : undefined,
    })
  })
  let deck: DeckFile
  try {
    const call = Presentations.PrepareDeck(path)
    const abort = () => call.cancel()
    signal?.addEventListener("abort", abort, { once: true })
    try {
      deck = (await call) as unknown as DeckFile
    } finally {
      signal?.removeEventListener("abort", abort)
    }
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError")
    throw err
  } finally {
    off?.()
  }
  try {
    // Same-origin asset path (not the loopback media server, which has
    // no CORS headers for fetch). A deck PDF is a few MB, fine to buffer.
    const res = await fetch(`/media-asset/${deck.pdf_media_id}`)
    if (!res.ok) throw new Error(`couldn't read the converted PDF (${res.status})`)
    const data = new Uint8Array(await res.arrayBuffer())
    const pdfjs = await loadPdfJs()
    const task = pdfjs.getDocument({ data })
    const doc = await task.promise
    try {
      let added = 0
      for (let n = 1; n <= doc.numPages; n++) {
        if (signal?.aborted) break
        onProgress?.({ stage: "rendering", page: n, pages: doc.numPages })
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(MAX_W / base.width, MAX_H / base.height)
        const vp = page.getViewport({ scale })
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(vp.width)
        canvas.height = Math.round(vp.height)
        await page.render({ canvas, viewport: vp }).promise
        page.cleanup()
        const bytes = await canvasToBase64(canvas)
        canvas.width = canvas.height = 0 // release the bitmap now
        await Presentations.AddDeckPage(presentationId, deck.name, n, bytes)
        added++
      }
      return added
    } finally {
      void task.destroy()
    }
  } finally {
    void Presentations.FinishDeck(deck.pdf_media_id).catch(() => {})
  }
}

// pdf.js is ~1 MB: loaded on first import only.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null
function loadPdfJs() {
  pdfjsPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })()
  return pdfjsPromise
}

function canvasToBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("page render failed"))
        const r = new FileReader()
        r.onload = () => {
          const s = String(r.result)
          resolve(s.slice(s.indexOf(",") + 1))
        }
        r.onerror = () => reject(r.error ?? new Error("page read failed"))
        r.readAsDataURL(blob)
      },
      "image/webp",
      QUALITY
    )
  })
}
