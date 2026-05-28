import { useState, useMemo } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { motion } from "motion/react"
import {
  ArrowLeftIcon,
  PlusIcon,
  Trash2Icon,
  FileTextIcon,
  ImageIcon,
  SquareIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  useAddDeckSlide,
  useDeck,
  useDeckBlocks,
  useDeckSlides,
  useDeleteDeckSlide,
  useRenameDeck,
} from "@/features/decks/api"
import { Input } from "@/components/input"

// Deck editor — M1 skeleton. Shows slide thumb list + a single
// "canvas" pane that lists blocks for the selected slide. Full
// drag-to-edit canvas, block toolbar, undo/redo, and per-block
// inspector land in M3.
export const Route = createFileRoute("/_app/decks/$deckId")({
  component: DeckEditor,
})

function DeckEditor() {
  const { deckId } = Route.useParams()
  const id = Number(deckId)
  const navigate = useNavigate()
  const { data: deck } = useDeck(id)
  const { data: slides = [] } = useDeckSlides(id)
  const renameMut = useRenameDeck()
  const addSlideMut = useAddDeckSlide(id)
  const deleteSlideMut = useDeleteDeckSlide(id)

  const [selectedSlideId, setSelectedSlideId] = useState<number | null>(null)
  const activeSlideId = useMemo(() => {
    if (selectedSlideId !== null && slides.some((s) => s.id === selectedSlideId)) {
      return selectedSlideId
    }
    return slides[0]?.id ?? null
  }, [selectedSlideId, slides])

  const { data: blocks = [] } = useDeckBlocks(activeSlideId)

  if (!deck) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16 }}
      className="grid h-full grid-rows-[auto,1fr] bg-background text-foreground"
    >
      <header className="flex h-10 items-center gap-2 border-b border-border/50 px-3">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate({ to: "/" })}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <Input
          value={deck.name}
          onChange={(e) =>
            renameMut.mutate({ id: deck.id, name: e.target.value })
          }
          className="h-7 max-w-[320px] border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-1"
        />
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {deck.source} · {deck.width}×{deck.height}
        </span>
      </header>

      <div className="grid min-h-0 grid-cols-[200px,1fr,260px]">
        <aside className="flex min-h-0 flex-col border-r border-border/50">
          <div className="flex items-center justify-between border-b border-border/50 px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Slides ({slides.length})</span>
            <button
              type="button"
              aria-label="Add slide"
              onClick={() => addSlideMut.mutate()}
              className="grid size-5 place-items-center rounded hover:bg-muted hover:text-foreground"
            >
              <PlusIcon className="size-3" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <ol className="flex flex-col gap-1">
              {slides.map((slide, i) => (
                <li key={slide.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedSlideId(slide.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                      activeSlideId === slide.id &&
                        "border-primary/40 bg-primary/10"
                    )}
                  >
                    <span className="grid size-6 place-items-center rounded bg-background/60 text-[10px] text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="truncate flex-1">
                      {slide.notes || `Slide ${i + 1}`}
                    </span>
                    <button
                      type="button"
                      aria-label="Delete slide"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSlideMut.mutate(slide.id)
                      }}
                      className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2Icon className="size-3" />
                    </button>
                  </button>
                </li>
              ))}
              {slides.length === 0 && (
                <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No slides yet. Click + to add one.
                </li>
              )}
            </ol>
          </div>
        </aside>

        <main className="grid min-h-0 place-items-center bg-muted/20 p-6">
          {activeSlideId === null ? (
            <p className="text-sm text-muted-foreground">
              Select or add a slide to begin editing.
            </p>
          ) : (
            <SlideCanvas
              canvasW={deck.width}
              canvasH={deck.height}
              blocks={blocks}
            />
          )}
        </main>

        <aside className="flex min-h-0 flex-col border-l border-border/50">
          <div className="border-b border-border/50 px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Blocks ({blocks.length})
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <ul className="flex flex-col gap-1">
              {blocks.map((block) => (
                <li
                  key={block.id}
                  className="flex items-center gap-2 rounded border border-border/40 bg-muted/30 px-2 py-1 text-xs"
                >
                  <BlockKindIcon kind={block.kind} />
                  <span className="flex-1 truncate">{block.kind}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {Math.round(block.x * 100)},{Math.round(block.y * 100)}
                  </span>
                </li>
              ))}
              {blocks.length === 0 && activeSlideId !== null && (
                <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                  Empty slide. Block toolbar lands in M3.
                </li>
              )}
            </ul>
          </div>
        </aside>
      </div>
    </motion.div>
  )
}

function SlideCanvas({
  canvasW,
  canvasH,
  blocks,
}: {
  canvasW: number
  canvasH: number
  blocks: { id: number; x: number; y: number; w: number; h: number; kind: string }[]
}) {
  // Aspect-preserving canvas; longest dimension capped to the
  // available area via CSS aspect-ratio. Blocks render as
  // outlined placeholder rectangles at their normalised coords.
  return (
    <div
      className="relative rounded-md border border-border/50 bg-background shadow-sm"
      style={{ width: "min(80vh * " + canvasW / canvasH + ", 80%)", aspectRatio: `${canvasW} / ${canvasH}` }}
    >
      {blocks.map((b) => (
        <div
          key={b.id}
          className="absolute rounded-sm border border-dashed border-primary/40 bg-primary/5"
          style={{
            left: `${b.x * 100}%`,
            top: `${b.y * 100}%`,
            width: `${b.w * 100}%`,
            height: `${b.h * 100}%`,
          }}
          title={b.kind}
        />
      ))}
    </div>
  )
}

function BlockKindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "text":
      return <FileTextIcon className="size-3 text-muted-foreground" />
    case "image":
      return <ImageIcon className="size-3 text-muted-foreground" />
    case "shape":
      return <SquareIcon className="size-3 text-muted-foreground" />
    default:
      return <SquareIcon className="size-3 text-muted-foreground" />
  }
}
