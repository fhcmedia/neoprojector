import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Trash2Icon } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import { cn } from "@/lib/utils"
import { AddTile } from "@/features/library/add-tile"
import {
  useCreateDeck,
  useDecks,
  useDeleteDeck,
  useDeckSlides,
} from "@/features/decks/api"
import type { Deck } from "@/bindings/neoprojector/database"

type Props = {
  search: string
  onOpen: (deck: Deck) => void
  onImportClick?: () => void
}

// DecksTab — tile grid mirroring PresentationsTab. Each tile shows the
// deck name + slide count. Add tile creates a new empty deck and
// opens the editor. Import button (when wired) opens the docimport
// wizard.
export function DecksTab({ search, onOpen, onImportClick }: Props) {
  const { data: decks, isLoading } = useDecks()
  const createMut = useCreateDeck()
  const deleteMut = useDeleteDeck()
  const debounced = useDebounce(search, 200)

  const filtered = useMemo(() => {
    const list = decks ?? []
    const needle = debounced.trim().toLowerCase()
    if (!needle) return list
    return list.filter((d) => d.name.toLowerCase().includes(needle))
  }, [decks, debounced])

  if (isLoading) return <Empty>Loading…</Empty>

  return (
    <div className="h-full w-full overflow-y-auto p-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        <AnimatePresence initial={false}>
          {filtered.map((d) => (
            <DeckTile
              key={d.id}
              deck={d}
              onOpen={() => onOpen(d)}
              onDelete={() => deleteMut.mutate(d.id)}
            />
          ))}
        </AnimatePresence>
        <AddTile
          label="Add deck"
          sublabel="New"
          onClick={() =>
            createMut.mutate(
              { name: "Untitled deck" },
              { onSuccess: (created) => onOpen(created) }
            )
          }
        />
        {onImportClick && (
          <AddTile
            label="Import…"
            sublabel="PPTX / DOCX / PDF"
            onClick={onImportClick}
          />
        )}
      </div>
      {filtered.length === 0 && (
        <Empty>
          {decks && decks.length === 0
            ? "No decks yet — click Add deck or Import to start."
            : "No matches."}
        </Empty>
      )}
    </div>
  )
}

function DeckTile({
  deck,
  onOpen,
  onDelete,
}: {
  deck: Deck
  onOpen: () => void
  onDelete: () => void
}) {
  const { data: slides } = useDeckSlides(deck.id)
  const count = slides?.length ?? 0
  const [pendingDelete, setPendingDelete] = useState(false)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
      className="group relative overflow-hidden rounded-lg border border-border/50 bg-muted/30 transition-colors hover:border-border"
    >
      <button
        type="button"
        onClick={onOpen}
        className="block aspect-video w-full text-left"
      >
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted/50 to-muted text-muted-foreground">
          <span className="text-xs uppercase tracking-wider">
            {deck.source === "native" ? "deck" : deck.source}
          </span>
        </div>
      </button>
      <div className="flex items-center justify-between px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{deck.name}</p>
          <p className="text-[10px] text-muted-foreground">
            {count} slide{count === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Delete deck"
          onClick={(e) => {
            e.stopPropagation()
            if (pendingDelete) {
              onDelete()
            } else {
              setPendingDelete(true)
              window.setTimeout(() => setPendingDelete(false), 2500)
            }
          }}
          className={cn(
            "rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500",
            pendingDelete && "bg-red-500/10 text-red-500 opacity-100"
          )}
        >
          <Trash2Icon className="h-3 w-3" />
        </button>
      </div>
    </motion.div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
