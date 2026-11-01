import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Events } from "@wailsio/runtime"
import { toast } from "sonner"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import { Service as Schedule } from "@/bindings/neoprojector/services/schedule"
import type { Medium } from "@/bindings/neoprojector/database"
import { isDeckPath } from "@/features/presentations/deck-import"
import { createPresentationFromDeck } from "@/features/presentations/import-flow"

// Dropping files from Explorer onto a schedule section adds them to it,
// in the order dropped: images, videos and audio become media items
// (imported into the library first); PowerPoint/PDF files become a
// presentation item (pages import in the background with progress).

export const SECTION_DROP_PREFIX = "schedule-section:"

export function sectionDropTarget(sectionId: number): string {
  return `${SECTION_DROP_PREFIX}${sectionId}`
}

type DropPayload = { paths?: string[]; target_id?: string }

export function useScheduleDrop() {
  const qc = useQueryClient()
  useEffect(() => {
    const off = Events.On("media:files-dropped", (event: { data?: DropPayload }) => {
      const data = event?.data ?? {}
      const target = data.target_id ?? ""
      if (!target.startsWith(SECTION_DROP_PREFIX)) return
      const sectionId = Number(target.slice(SECTION_DROP_PREFIX.length))
      const paths = data.paths ?? []
      if (!sectionId || paths.length === 0) return
      void addToSection(sectionId, paths)
    })
    async function addToSection(sectionId: number, paths: string[]) {
      let added = 0
      const skipped: string[] = []
      for (const path of paths) {
        const name = path.split(/[\/]/).pop() ?? path
        try {
          if (isDeckPath(path)) {
            const p = await createPresentationFromDeck(qc, path)
            await Schedule.AddPresentationItem(sectionId, p.id)
            added++
          } else {
            const imported = (await Media.ImportFiles([path])) as unknown as Medium[]
            if (imported.length === 0) skipped.push(name)
            for (const m of imported) {
              await Schedule.AddMediaItem(sectionId, m.id)
              added++
            }
          }
        } catch {
          skipped.push(name)
        }
        qc.invalidateQueries({ queryKey: ["schedule", "items"] })
      }
      qc.invalidateQueries({ queryKey: ["media", "list"] })
      if (skipped.length) {
        toast.error(
          `Couldn't add ${skipped.length === 1 ? skipped[0] : `${skipped.length} files`}`,
          { description: "Only images, videos, audio, PowerPoint and PDF files can be added." }
        )
      } else if (added > 1) {
        toast.success(`Added ${added} items`)
      }
    }
    return () => {
      off?.()
    }
  }, [qc])
}
