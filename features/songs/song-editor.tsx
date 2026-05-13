import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react"

import { Service as Songs } from "@/bindings/neoprojector/services/songs"
import { SongSpec } from "@/bindings/neoprojector/services/songs"
import type { SongFull } from "@/bindings/neoprojector/services/songs"
import type { Song } from "@/bindings/neoprojector/database"
import { Input } from "@/components/input"
import { Textarea } from "@/components/textarea"
import { Button } from "@/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu"
import { cn } from "@/lib/utils"
import { songSectionType, songSectionTypes } from "@/features/songs/section-types"
import {
  pickerContainerVariants,
  pickerRowVariants,
} from "@/features/schedule/picker-anim"

type LocalSection = {
  localId: number
  type: string
  text: string
}

type Props =
  | {
      mode: "create"
      onSaved: (songId: number) => void
      onCancel: () => void
    }
  | {
      mode: "edit"
      songId: number
      onSaved: () => void
      onCancel?: () => void
    }

// SongEditor is the canonical CRUD form for a song. It has no knowledge of
// schedules or any other consumer — after a create, the parent decides what
// to do with the new song id.
export function SongEditor(props: Props) {
  const isEdit = props.mode === "edit"
  const editingSongId = props.mode === "edit" ? props.songId : undefined

  const [title, setTitle] = useState("")
  const [sections, setSections] = useState<LocalSection[]>([])
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)

  const { data: existing, isLoading } = useQuery({
    queryKey: ["songs", "full", editingSongId],
    queryFn: () =>
      Songs.GetSong(editingSongId!) as unknown as Promise<SongFull>,
    enabled: !!editingSongId,
  })

  const populatedRef = useRef(false)
  useEffect(() => {
    if (!isEdit || !existing || populatedRef.current) return
    populatedRef.current = true
    setTitle(existing.song.title)
    const localSections: LocalSection[] = existing.sections.map((s) => ({
      localId: nextId.current++,
      type: s.section.type,
      text: s.lines.map((l) => l.text).join("\n"),
    }))
    setSections(localSections)
  }, [existing, isEdit])

  function handleAddSection(type: string) {
    setSections((prev) => [
      ...prev,
      { localId: nextId.current++, type, text: "" },
    ])
  }

  function handleChangeType(localId: number, type: string) {
    setSections((prev) =>
      prev.map((s) => (s.localId === localId ? { ...s, type } : s))
    )
  }

  function handleChangeText(localId: number, text: string) {
    setSections((prev) =>
      prev.map((s) => (s.localId === localId ? { ...s, text } : s))
    )
  }

  function handleDeleteSection(localId: number) {
    setSections((prev) => prev.filter((s) => s.localId !== localId))
  }

  async function handleSubmit() {
    if (busy) return
    setBusy(true)
    try {
      const spec = new SongSpec({
        title: title.trim(),
        sections: sections.map((s) => ({ type: s.type, text: s.text })),
      })

      if (props.mode === "edit") {
        await Songs.UpdateSongFromSpec(props.songId, spec)
        setBusy(false)
        props.onSaved()
        return
      }

      const created = (await Songs.CreateSongFromSpec(
        spec
      )) as unknown as Song
      setBusy(false)
      props.onSaved(created.id)
    } catch (err) {
      console.error(err)
      setBusy(false)
    }
  }

  // Pull the library for live duplicate-title detection. Shares the cache
  // key with consumers so no extra fetch occurs.
  const { data: librarySongs } = useQuery({
    queryKey: ["songs", "list"],
    queryFn: () => Songs.ListSongs() as unknown as Promise<Song[]>,
  })

  const validation = useMemo<{ ok: boolean; reason: string }>(() => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return { ok: false, reason: "Title is required." }

    if (librarySongs) {
      const lower = trimmedTitle.toLowerCase()
      const clash = librarySongs.find(
        (s) => s.title.toLowerCase() === lower && s.id !== editingSongId
      )
      if (clash) {
        return {
          ok: false,
          reason: "A song with this title already exists.",
        }
      }
    }

    if (sections.length === 0) {
      return { ok: false, reason: "Add at least one section." }
    }

    const emptySection = sections.find((s) => !s.text.trim())
    if (emptySection) {
      return { ok: false, reason: "Every section needs lyrics." }
    }

    return { ok: true, reason: "" }
  }, [title, sections, librarySongs, editingSongId])

  const submitLabel = isEdit ? "Save" : "Create"

  // The submit area only matters once the user has started: a blank
  // song can't be saved, so showing a disabled Create + a validation
  // notice on first render is just clutter.
  const hasContent = title.trim().length > 0 || sections.length > 0

  if (isEdit && isLoading) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
        Loading…
      </div>
    )
  }

  return (
    <motion.div
      className="flex h-full flex-col"
      variants={pickerContainerVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
    >
      <motion.div variants={pickerRowVariants}>
        <Input
          autoFocus={!isEdit}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Song title"
          className="h-7 rounded-none border-0 border-b border-border/50 bg-transparent px-3 text-xs font-medium tracking-tight shadow-none focus-visible:ring-0"
        />
      </motion.div>

      <motion.div
        variants={pickerRowVariants}
        className="flex flex-1 flex-col overflow-y-auto"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {sections.map((sec) => (
            <motion.div
              key={sec.localId}
              layout
              variants={pickerRowVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
            >
              <SectionBlock
                section={sec}
                empty={!sec.text.trim()}
                onChangeType={(t) => handleChangeType(sec.localId, t)}
                onChangeText={(t) => handleChangeText(sec.localId, t)}
                onDelete={() => handleDeleteSection(sec.localId)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        <InsertSection
          empty={sections.length === 0}
          onPick={handleAddSection}
        />
      </motion.div>

      {hasContent && (
        <motion.div variants={pickerRowVariants}>
          {!validation.ok && (
            <div className="border-t border-border/40 px-3 py-1 text-[11px] text-muted-foreground/70">
              {validation.reason}
            </div>
          )}
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={busy || !validation.ok}
            className="w-full rounded-none"
          >
            {submitLabel}
          </Button>
        </motion.div>
      )}
    </motion.div>
  )
}

const chooserContainerVariants = {
  open: {
    transition: { staggerChildren: 0.04, staggerDirection: 1 },
  },
  closed: {
    transition: { staggerChildren: 0.04, staggerDirection: -1 },
  },
}

const chooserRowVariants = {
  open: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 500, damping: 30 },
  },
  closed: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.14 },
  },
}

function InsertSection({
  empty,
  onPick,
}: {
  empty: boolean
  onPick: (type: string) => void
}) {
  const [choosing, setChoosing] = useState(false)

  function pick(type: string) {
    onPick(type)
    setChoosing(false)
  }

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {choosing ? (
        <motion.div
          key="chooser"
          className="flex flex-1 flex-col"
          variants={chooserContainerVariants}
          initial="closed"
          animate="open"
          exit="closed"
        >
          {songSectionTypes.map((t) => (
            <motion.button
              key={t.key}
              type="button"
              onClick={() => pick(t.key)}
              variants={chooserRowVariants}
              className={cn(
                "flex flex-1 items-center gap-1.5 border-b border-border/40 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-foreground/90 transition-[filter] hover:brightness-110",
                t.chip
              )}
              style={{ minHeight: "2.25rem" }}
            >
              {t.label}
            </motion.button>
          ))}
          <motion.button
            type="button"
            onClick={() => setChoosing(false)}
            variants={chooserRowVariants}
            className="flex shrink-0 items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <XIcon className="size-3" />
            Cancel
          </motion.button>
        </motion.div>
      ) : (
        <motion.button
          key="prompt"
          type="button"
          onClick={() => setChoosing(true)}
          aria-label={empty ? "Add your first section" : "Add section"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className={cn(
            "group flex flex-1 items-center justify-center gap-1.5 text-xs transition-colors",
            empty
              ? "min-h-full text-muted-foreground/70 hover:text-muted-foreground"
              : "min-h-16 text-muted-foreground/0 hover:text-muted-foreground/60"
          )}
        >
          <PlusIcon
            className={cn(
              "size-3.5 transition-opacity",
              !empty && "opacity-0 group-hover:opacity-100"
            )}
          />
          <span
            className={cn(
              "transition-opacity",
              !empty && "opacity-0 group-hover:opacity-100"
            )}
          >
            {empty ? "Add your first section" : "Add section"}
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}

function SectionBlock({
  section,
  empty,
  onChangeType,
  onChangeText,
  onDelete,
}: {
  section: LocalSection
  empty: boolean
  onChangeType: (type: string) => void
  onChangeText: (text: string) => void
  onDelete: () => void
}) {
  const type = songSectionType(section.type)

  return (
    <div className="group/section flex flex-col border-b border-border/40">
      <div
        className={cn(
          "flex items-center justify-between gap-1.5 px-3 py-1.5",
          type.chip,
          type.text
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:bg-foreground/10 focus-visible:outline-none"
            >
              {type.label}
              <ChevronDownIcon className="size-3 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6}>
            {songSectionTypes.map((t) => (
              <DropdownMenuItem
                key={t.key}
                onSelect={() => onChangeType(t.key)}
              >
                <span className={cn("size-2.5 rounded-full", t.swatch)} />
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete section"
          className="grid size-5 place-items-center rounded text-foreground/70 opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover/section:opacity-100"
        >
          <XIcon className="size-3" />
        </button>
      </div>
      <div className={cn("flex-1", type.body)}>
        <Textarea
          value={section.text}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder="One line per line…"
          className={cn(
            "h-full w-full resize-none rounded-none border-0 bg-transparent px-4 py-2 text-xs leading-relaxed text-foreground/90 shadow-none focus-visible:ring-0 dark:bg-transparent",
            empty ? "min-h-16" : "min-h-12"
          )}
        />
      </div>
    </div>
  )
}
