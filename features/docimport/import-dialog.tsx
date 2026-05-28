import { useEffect, useMemo, useState } from "react"
import { Dialogs } from "@wailsio/runtime"
import { motion, AnimatePresence } from "motion/react"
import { FileTextIcon, FileTypeIcon, FileImageIcon, XIcon } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/alert-dialog"
import { Service as DocImport } from "@/bindings/neoprojector/services/docimport"
import { ImportOptions } from "@/bindings/neoprojector/services/docimport"
import type {
  FormatInfo,
  ScanItem,
} from "@/bindings/neoprojector/services/docimport"
import { cn } from "@/lib/utils"

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onImported?: (deckId: number) => void
}

// ImportDialog — File → Import wizard. Surfaces the per-format list
// from the backend (DocImport.ListSupportedFormats), opens the native
// file picker, and runs ScanDoc to preview. Calling ImportDoc lands
// once per-format parsers ship (currently returns ErrNotImplemented,
// which we surface as a friendly "coming soon" badge so the wizard
// still lights up the menu shape).
export function ImportDialog({ open, onOpenChange, onImported }: Props) {
  const [formats, setFormats] = useState<FormatInfo[]>([])
  const [scan, setScan] = useState<ScanItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setScan(null)
      setError(null)
      return
    }
    void (async () => {
      try {
        const list = (await DocImport.ListSupportedFormats()) as unknown as FormatInfo[]
        setFormats(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [open])

  const dialogFilters = useMemo(
    () => buildDialogFilters(formats),
    [formats]
  )

  async function pickAndScan(targetFormat?: string) {
    setError(null)
    const filters = targetFormat
      ? buildDialogFilters(formats.filter((f) => f.format === targetFormat))
      : dialogFilters
    const picked = await Dialogs.OpenFile({
      Title: "Import document",
      AllowsMultipleSelection: false,
      CanChooseFiles: true,
      CanChooseDirectories: false,
      Filters: filters,
    })
    const path = Array.isArray(picked) ? picked[0] : picked
    if (typeof path !== "string" || !path) return
    setBusy(true)
    try {
      const item = (await DocImport.ScanDoc(path)) as unknown as ScanItem
      setScan(item)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!scan) return
    setError(null)
    setBusy(true)
    try {
      const deckId = (await DocImport.ImportDoc(
        scan.path,
        new ImportOptions({
          deck_name: scan.title || scan.filename,
          split_heading: "h1",
          preserve_fonts: true,
          preserve_colors: true,
        })
      )) as unknown as number
      onOpenChange(false)
      onImported?.(deckId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Import document</AlertDialogTitle>
          <AlertDialogDescription>
            Pick a PowerPoint, Word, PDF, OpenDocument, or Rich Text file.
            Each slide / page / section becomes an editable deck slide.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AnimatePresence mode="wait" initial={false}>
          {!scan && (
            <motion.div
              key="picker"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="grid grid-cols-2 gap-2 py-2"
            >
              <FormatTile
                label="Any supported file"
                hint=".pptx .docx .pdf .odp .odt .rtf"
                icon={<FileTextIcon className="size-4" />}
                onClick={() => void pickAndScan()}
              />
              {formats.map((f) => (
                <FormatTile
                  key={f.format}
                  label={f.label}
                  hint={f.extensions.join(" ")}
                  icon={iconForFormat(f.format)}
                  onClick={() => void pickAndScan(f.format)}
                />
              ))}
            </motion.div>
          )}

          {scan && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="grid gap-3 py-2"
            >
              <div className="rounded-md border border-border/50 bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {scan.format || "unknown"} · {scan.filename}
                </p>
                <p className="mt-1 text-sm font-medium">
                  {scan.title || scan.filename}
                </p>
                {!scan.supported && (
                  <p className="mt-2 text-xs text-amber-500">
                    {scan.reason || "Parser not yet available — coming soon."}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        <AlertDialogFooter>
          {scan && (
            <button
              type="button"
              onClick={() => setScan(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Pick another file
            </button>
          )}
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {scan && (
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void runImport()
              }}
              disabled={busy || !scan.supported}
            >
              {scan.supported ? "Import" : "Unavailable"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function FormatTile({
  label,
  hint,
  icon,
  onClick,
}: {
  label: string
  hint: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-start gap-2 rounded-md border border-border/50 bg-background/50 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/50"
      )}
    >
      <span className="mt-0.5 text-muted-foreground group-hover:text-foreground">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  )
}

function iconForFormat(fmt: string) {
  switch (fmt) {
    case "pptx":
    case "odp":
      return <FileTypeIcon className="size-4" />
    case "pdf":
      return <FileImageIcon className="size-4" />
    case "docx":
    case "odt":
    case "rtf":
    default:
      return <FileTextIcon className="size-4" />
  }
}

// buildDialogFilters builds the OpenFileDialog filter list. We always
// append an "All files" catch-all so the user can still poke at
// edge-case extensions.
function buildDialogFilters(formats: FormatInfo[]) {
  const filters = formats.map((f) => ({
    DisplayName: f.label,
    Pattern: f.extensions.map((ext) => `*${ext}`).join(";"),
  }))
  if (formats.length > 1) {
    const all = formats.flatMap((f) => f.extensions).map((ext) => `*${ext}`)
    filters.unshift({
      DisplayName: "All supported",
      Pattern: all.join(";"),
    })
  }
  filters.push({ DisplayName: "All files", Pattern: "*.*" })
  return filters
}
