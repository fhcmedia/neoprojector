import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Decks } from "@/bindings/neoprojector/services/decks"
import { BlockSpec, CreateDeckOptions } from "@/bindings/neoprojector/services/decks"
import type {
  Deck,
  DeckSlide,
  DeckBlock,
} from "@/bindings/neoprojector/database"

// Stable query keys for deck reads. Each key is `["decks", scope, id?]`
// so the editor's slide list refetches without thrashing the library
// grid.
export const deckKeys = {
  list: ["decks", "list"] as const,
  one: (id: number) => ["decks", "one", id] as const,
  slides: (id: number) => ["decks", "slides", id] as const,
  blocks: (slideId: number) => ["decks", "blocks", slideId] as const,
}

export function useDecks() {
  return useQuery({
    queryKey: deckKeys.list,
    queryFn: () => Decks.ListDecks() as unknown as Promise<Deck[]>,
  })
}

export function useDeck(id: number | null) {
  return useQuery({
    queryKey:
      id !== null ? deckKeys.one(id) : ["decks", "one", "none"],
    queryFn: () => Decks.DeckByID(id!) as unknown as Promise<Deck>,
    enabled: id !== null,
  })
}

export function useDeckSlides(id: number | null) {
  return useQuery({
    queryKey:
      id !== null ? deckKeys.slides(id) : ["decks", "slides", "none"],
    queryFn: () => Decks.ListSlides(id!) as unknown as Promise<DeckSlide[]>,
    enabled: id !== null,
  })
}

export function useDeckBlocks(slideId: number | null) {
  return useQuery({
    queryKey:
      slideId !== null ? deckKeys.blocks(slideId) : ["decks", "blocks", "none"],
    queryFn: () =>
      Decks.ListBlocks(slideId!) as unknown as Promise<DeckBlock[]>,
    enabled: slideId !== null,
  })
}

export function useCreateDeck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (opts: {
      name?: string
      source?: string
      source_path?: string
      width?: number
      height?: number
    }) =>
      Decks.CreateDeck(
        new CreateDeckOptions({
          name: opts.name ?? "",
          source: opts.source ?? "",
          source_path: opts.source_path ?? "",
          width: opts.width ?? 0,
          height: opts.height ?? 0,
        })
      ) as unknown as Promise<Deck>,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: deckKeys.list })
      qc.setQueryData(deckKeys.one(created.id), created)
    },
  })
}

export function useRenameDeck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      Decks.RenameDeck(id, name) as unknown as Promise<Deck>,
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: deckKeys.list })
      qc.setQueryData(deckKeys.one(updated.id), updated)
    },
  })
}

export function useDeleteDeck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      Decks.DeleteDeck(id) as unknown as Promise<void>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deckKeys.list })
    },
  })
}

export function useDuplicateDeck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      Decks.DuplicateDeck(id) as unknown as Promise<Deck>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deckKeys.list })
    },
  })
}

export function useAddDeckSlide(deckId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => Decks.AddSlide(deckId) as unknown as Promise<DeckSlide>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deckKeys.slides(deckId) })
    },
  })
}

export function useDeleteDeckSlide(deckId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slideId: number) =>
      Decks.DeleteSlide(slideId) as unknown as Promise<void>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deckKeys.slides(deckId) })
    },
  })
}

export function useReorderDeckSlides(deckId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) =>
      Decks.ReorderSlides(deckId, ids) as unknown as Promise<void>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deckKeys.slides(deckId) })
    },
  })
}

export function useCreateDeckBlock(slideId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (spec: BlockSpec) =>
      Decks.CreateBlock(slideId, spec) as unknown as Promise<DeckBlock>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deckKeys.blocks(slideId) })
    },
  })
}

export function useUpdateDeckBlock(slideId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, spec }: { id: number; spec: BlockSpec }) =>
      Decks.UpdateBlock(id, spec) as unknown as Promise<DeckBlock>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deckKeys.blocks(slideId) })
    },
  })
}

export function useDeleteDeckBlock(slideId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      Decks.DeleteBlock(id) as unknown as Promise<void>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deckKeys.blocks(slideId) })
    },
  })
}
