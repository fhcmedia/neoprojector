import { useState, useSyncExternalStore, type DragEvent } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Service as Schedule } from "@/bindings/neoprojector/services/schedule"
import { BibleRef, OverlayItemSpec } from "@/bindings/neoprojector/services/schedule"
import type { ServiceItem } from "@/bindings/neoprojector/database"

// Dragging library things into the schedule.
//
// Library tiles (songs, media, presentations, overlays, Bible verses,
// backgrounds, templates) are HTML5-draggable with a JSON payload under a
// private MIME type — files from Explorer travel a separate path (Wails'
// native file drop, schedule-drop.ts) and never carry this type.
//
// Drop on a section → the item is added to it. Drop on an item → it's
// inserted at that item's position. Backgrounds set the section's/item's
// background; templates apply to a song or Bible item (see itemTemplate).

export const LIBRARY_DRAG_MIME = "application/x-neoprojector-item"

export type LibraryDrag =
  | { type: "song"; id: number; label: string }
  | { type: "media"; id: number; label: string }
  | { type: "presentation"; id: number; label: string }
  | { type: "overlay"; label: string; spec: { kind: string; name: string; config_json: string; layouts_json: string; rules_json: string } }
  | { type: "bible"; label: string; ref: { book: string; chapter: number; verse_start: number; verse_end: number } }
  | { type: "background"; id: number; label: string }
  // kind: the template's slide kind ("song" | "bible"); it only fits
  // items of that kind (the boxes are laid out for lyrics or verses).
  | { type: "template"; id: number; label: string; kind: string }

// What's being dragged right now (for drop-zone highlighting); null when
// nothing from the library is in flight.
let current: LibraryDrag | null = null
const listeners = new Set<() => void>()
function setCurrent(d: LibraryDrag | null) {
  current = d
  for (const l of listeners) l()
}
export function useLibraryDrag(): LibraryDrag | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}

// libraryDragProps makes a library tile draggable into the schedule.
export function libraryDragProps(item: LibraryDrag) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(item))
      e.dataTransfer.setData("text/plain", item.label)
      e.dataTransfer.effectAllowed = "copy"
      setCurrent(item)
    },
    onDragEnd: () => setCurrent(null),
  }
}

export function isLibraryDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(LIBRARY_DRAG_MIME)
}

export function readLibraryDrag(e: DragEvent): LibraryDrag | null {
  try {
    const raw = e.dataTransfer.getData(LIBRARY_DRAG_MIME)
    return raw ? (JSON.parse(raw) as LibraryDrag) : null
  } catch {
    return null
  }
}

// addToSchedule adds a dropped library thing. target: a section (append)
// or an item (the new one is inserted just before it).
export async function addToSchedule(
  qc: QueryClient,
  drag: LibraryDrag,
  target: { sectionId: number; itemId?: number; itemKind?: string }
): Promise<void> {
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["schedule"] })
  }
  try {
    let created: ServiceItem | null = null
    switch (drag.type) {
      case "song":
        created = (await Schedule.AddSongItem(target.sectionId, drag.id)) as unknown as ServiceItem
        break
      case "media":
        created = (await Schedule.AddMediaItem(target.sectionId, drag.id)) as unknown as ServiceItem
        break
      case "presentation":
        created = (await Schedule.AddPresentationItem(target.sectionId, drag.id)) as unknown as ServiceItem
        break
      case "overlay":
        created = (await Schedule.AddOverlayItem(
          target.sectionId,
          new OverlayItemSpec(drag.spec)
        )) as unknown as ServiceItem
        break
      case "bible":
        created = (await Schedule.AddBibleItem(
          target.sectionId,
          new BibleRef(drag.ref)
        )) as unknown as ServiceItem
        break
      case "background":
        if (target.itemId !== undefined) await Schedule.SetItemBackground(target.itemId, drag.id)
        else await Schedule.SetSectionBackground(target.sectionId, drag.id)
        refresh()
        toast.success(`Background “${drag.label}” set`)
        return
      case "template":
        if (target.itemId === undefined || (target.itemKind !== "song" && target.itemKind !== "bible")) {
          toast.info("Drop a template onto a song or Bible item to use it for that item")
          return
        }
        if (drag.kind && drag.kind !== target.itemKind) {
          toast.info(
            `“${drag.label}” is a ${drag.kind === "bible" ? "Bible" : "song"} template — drop it onto a ${drag.kind === "bible" ? "Bible" : "song"} item`
          )
          return
        }
        await Schedule.SetItemTemplate(target.itemId, drag.id)
        refresh()
        toast.success(`“${drag.label}” is now used for this item`)
        return
    }
    // Dropped onto an item: re-order the section so the new item sits
    // just before it (positions are rewritten, never duplicated).
    if (created && target.itemId !== undefined) {
      const items = (await Schedule.ListItems(target.sectionId)) as unknown as { id: number }[]
      const ids = items.map((i) => i.id).filter((id) => id !== created!.id)
      const at = ids.indexOf(target.itemId)
      ids.splice(at < 0 ? ids.length : at, 0, created.id)
      await Schedule.ReorderItems(ids)
    }
    refresh()
  } catch (err) {
    toast.error(`Couldn't add “${drag.label}”`, {
      description: err instanceof Error ? err.message : String(err),
    })
  }
}

// useLibraryDropZone: drag-over highlight + drop handling for a schedule
// section or row. Only library drags are accepted here (files from
// Explorer go through Wails' native drop, schedule-drop.ts). stop keeps
// a row's drop from also reaching its section.
export function useLibraryDropZone(onDrop: (drag: LibraryDrag) => void, stop = false) {
  const [hover, setHover] = useState(false)
  return {
    hover,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!isLibraryDrag(e)) return
        e.preventDefault()
        if (stop) e.stopPropagation()
        e.dataTransfer.dropEffect = "copy"
        if (!hover) setHover(true)
      },
      onDragLeave: (e: DragEvent) => {
        // Leaving into a child isn't leaving the zone.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setHover(false)
      },
      onDrop: (e: DragEvent) => {
        if (!isLibraryDrag(e)) return
        e.preventDefault()
        if (stop) e.stopPropagation()
        setHover(false)
        setCurrent(null)
        const drag = readLibraryDrag(e)
        if (drag) onDrop(drag)
      },
    },
  }
}
