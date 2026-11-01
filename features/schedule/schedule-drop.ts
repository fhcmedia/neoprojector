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
export const SERVICE_DROP_PREFIX = "schedule-service:"

export function sectionDropTarget(sectionId: number): string {
  return `${SECTION_DROP_PREFIX}${sectionId}`
}

// serviceDropTarget: the whole open service (below/between sections).
// Drops there go to the last section, or a new one when there's none.
export function serviceDropTarget(serviceId: number): string {
  return `${SERVICE_DROP_PREFIX}${serviceId}`
}

// lastSectionOf returns the service's last section, creating one when
// the service has none yet.
export async function lastSectionOf(serviceId: number): Promise<number> {
  const sections = (await Schedule.ListSections(serviceId)) as unknown as { id: number; position: number }[]
  if (sections.length > 0) {
    return [...sections].sort((a, b) => a.position - b.position)[sections.length - 1].id
  }
  const created = (await Schedule.CreateSection(serviceId, "Untitled section")) as unknown as { id: number }
  return created.id
}

type DropPayload = { paths?: string[]; target_id?: string }

export function useScheduleDrop() {
  const qc = useQueryClient()
  useEffect(() => {
    const off = Events.On("media:files-dropped", (event: { data?: DropPayload }) => {
      const data = event?.data ?? {}
      const target = data.target_id ?? ""
      const paths = data.paths ?? []
      if (paths.length === 0) return
      if (target.startsWith(SECTION_DROP_PREFIX)) {
        const sectionId = Number(target.slice(SECTION_DROP_PREFIX.length))
        if (sectionId) void addToSection(sectionId, paths)
      } else if (target.startsWith(SERVICE_DROP_PREFIX)) {
        const serviceId = Number(target.slice(SERVICE_DROP_PREFIX.length))
        if (serviceId)
          void lastSectionOf(serviceId).then((sid) => {
            qc.invalidateQueries({ queryKey: ["schedule"] })
            return addToSection(sid, paths)
          })
      }
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
