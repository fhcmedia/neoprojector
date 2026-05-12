import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select"
import { cn } from "@/lib/utils"
import { useAddSongItem } from "../api"
import { songSectionType, songSectionTypes } from "../song-section-types"

type LocalSection = {
  localId: number
  type: string
  text: string
}

type Props =
  | {
      mode: "create"
      sectionId: number
      onSaved: () => void
      onCancel: () => void
    }
  | {
      mode: "edit"
      songId: number
      onSaved: () => void
      onCancel: () => void
    }

export function SongEditor(props: Props) {
  const isEdit = props.mode === "edit"
  const sectionId = props.mode === "create" ? props.sectionId : undefined
  const editingSongId = props.mode === "edit" ? props.songId : undefined

  const addSongMut = useAddSongItem(sectionId ?? 0)

  const [title, setTitle] = useState("")
  const [sections, setSections] = useState<LocalSection[]>([])
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)

  // Edit mode: load the existing song tree.
  const { data: existing, isLoading } = useQuery({
    queryKey: ["songs", "full", editingSongId],
    queryFn: () =>
      Songs.GetSong(editingSongId!) as unknown as Promise<SongFull>,
    enabled: !!editingSongId,
  })

  // Populate local state once when the fetch resolves.
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
      addSongMut.mutate(created.id, {
        onSettled: () => setBusy(false),
        onSuccess: props.onSaved,
      })
    } catch (err) {
      console.error(err)
      setBusy(false)
    }
  }

  const canSubmit = title.trim().length > 0 || sections.length > 0
  const submitLabel = isEdit ? "Save" : "Create & add to schedule"

  if (isEdit && isLoading) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 pt-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={props.onCancel}
          aria-label="Cancel"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Input
          autoFocus={!isEdit}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Song title"
          className="h-8 flex-1 text-sm"
        />
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={busy || !canSubmit}
        >
          {submitLabel}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto rounded-md border border-border/50 bg-background/30 p-3">
        <div className="space-y-3">
          {sections.map((sec) => (
            <SectionBlock
              key={sec.localId}
              section={sec}
              onChangeType={(t) => handleChangeType(sec.localId, t)}
              onChangeText={(t) => handleChangeText(sec.localId, t)}
              onDelete={() => handleDeleteSection(sec.localId)}
            />
          ))}
          <InsertSection
            empty={sections.length === 0}
            onPick={handleAddSection}
          />
        </div>
      </div>
    </div>
  )
}

function InsertSection({
  empty,
  onPick,
}: {
  empty: boolean
  onPick: (type: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border/60 py-2 text-xs text-muted-foreground/70 transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
          {empty ? "Add your first section" : "Add section"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={6}>
        {songSectionTypes.map((t) => (
          <DropdownMenuItem
            key={t.key}
            onSelect={() => onPick(t.key)}
          >
            <span className={cn("size-2.5 rounded-full", t.swatch)} />
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SectionBlock({
  section,
  onChangeType,
  onChangeText,
  onDelete,
}: {
  section: LocalSection
  onChangeType: (type: string) => void
  onChangeText: (text: string) => void
  onDelete: () => void
}) {
  const type = songSectionType(section.type)

  return (
    <div className="rounded-md border border-border/50">
      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-t-md px-2 py-1.5",
          type.chip,
          type.text
        )}
      >
        <Select
          value={section.type}
          onValueChange={(v) => onChangeType(v)}
        >
          <SelectTrigger className="h-6 border-0 bg-transparent px-1.5 text-xs font-semibold uppercase tracking-wider shadow-none hover:bg-foreground/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {songSectionTypes.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                <span className={cn("size-2.5 rounded-full", t.swatch)} />
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onDelete}
          aria-label="Delete section"
          className="text-foreground/70 hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <Textarea
        value={section.text}
        onChange={(e) => onChangeText(e.target.value)}
        placeholder="One line per line…"
        className="min-h-24 rounded-t-none border-0 text-sm leading-relaxed shadow-none focus-visible:ring-0"
      />
    </div>
  )
}
