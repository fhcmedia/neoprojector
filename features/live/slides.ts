import { useQuery } from "@tanstack/react-query"
import { Service as Bible } from "@/bindings/neoprojector/services/bible"
import { Service as Songs } from "@/bindings/neoprojector/services/songs"
import type {
  ListServiceItemsWithContentRow,
} from "@/bindings/neoprojector/database"
import type { ChapterVerse } from "@/bindings/neoprojector/services/bible"
import type { SongFull } from "@/bindings/neoprojector/services/songs"
import type { SlotFill } from "@/features/templates/types"
import { useBibleTranslations } from "@/hooks/use-bible-translations"
import { songSectionType } from "@/features/songs/section-types"

// Slide is the unit a display broadcasts. One Slide per verse for
// bible ranges, one per section for songs, one for media. The Show
// pane lists slides and clicking one pushes its `fill` live; the
// preview tiles render that fill through each display's bound
// template.
export type Slide = {
  kind: "bible" | "song" | "media"
  caption: string
  // body is the visible content used by the Show-pane thumbnail
  // (no template rendering there — it's just a textual preview).
  body: string
  fill: SlotFill
  // sectionType is set for song slides so the show pane can colorize
  // the left accent by type (verse, chorus, bridge, …).
  sectionType?: string
}

// ---- bible ----------------------------------------------------------------

// Fetches a chapter in a specific translation. The Tanstack Query
// cache dedupes by [book, chapter, translation], so the three calls
// in useBibleSlides only hit the IPC layer once per (book, chapter,
// translation) tuple across the app's lifetime.
function useChapterIn(
  book: string | undefined,
  chapter: number | undefined,
  translation: string | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["bible", "verses", book, chapter, translation],
    queryFn: () =>
      Bible.ListVersesIn(book!, chapter!, translation!) as unknown as Promise<
        ChapterVerse[]
      >,
    enabled: enabled && !!book && !!chapter && !!translation,
  })
}

function lookupVerse(verses: ChapterVerse[] | undefined, verse: number): string {
  return verses?.find((v) => v.verse === verse)?.text ?? ""
}

export function useBibleSlides(
  item: ListServiceItemsWithContentRow | null
): { slides: Slide[]; isLoading: boolean } {
  const { state: translations } = useBibleTranslations()
  const enabled = !!item && item.kind === "bible"

  const primary = useChapterIn(
    item?.book,
    item?.chapter,
    translations.primary,
    enabled
  )
  const secondary = useChapterIn(
    item?.book,
    item?.chapter,
    translations.secondary,
    enabled && !!translations.secondary
  )
  const tertiary = useChapterIn(
    item?.book,
    item?.chapter,
    translations.tertiary,
    enabled && !!translations.tertiary
  )

  if (!enabled || !item) return { slides: [], isLoading: false }
  const isLoading =
    primary.isLoading ||
    (!!translations.secondary && secondary.isLoading) ||
    (!!translations.tertiary && tertiary.isLoading)

  const bookLabel = item.book_kjv || item.book
  const slides: Slide[] = []
  for (let n = item.verse_start; n <= item.verse_end; n++) {
    const pText = lookupVerse(primary.data, n)
    if (!pText) continue
    const fill: SlotFill = {
      primary: pText,
      caption: `${bookLabel} ${item.chapter}:${n}`,
    }
    if (translations.secondary) {
      fill.secondary = lookupVerse(secondary.data, n)
    }
    if (translations.tertiary) {
      fill.tertiary = lookupVerse(tertiary.data, n)
    }
    slides.push({
      kind: "bible",
      caption: `${bookLabel} ${item.chapter}:${n}`,
      body: pText,
      fill,
    })
  }
  return { slides, isLoading }
}

// Ad-hoc bible slides built from a typed reference (library search),
// without a schedule item. Used when the user "goes live" straight
// from the Bible library tab.
export function useAdHocBibleSlides(
  book: string | undefined,
  bookLabel: string,
  chapter: number | undefined,
  verseStart: number | undefined,
  verseEnd: number | undefined
): { slides: Slide[]; isLoading: boolean } {
  const { state: translations } = useBibleTranslations()
  const enabled = !!book && !!chapter
  const primary = useChapterIn(book, chapter, translations.primary, enabled)
  const secondary = useChapterIn(
    book,
    chapter,
    translations.secondary,
    enabled && !!translations.secondary
  )
  const tertiary = useChapterIn(
    book,
    chapter,
    translations.tertiary,
    enabled && !!translations.tertiary
  )

  if (!enabled || verseStart === undefined) {
    return { slides: [], isLoading: false }
  }
  const isLoading =
    primary.isLoading ||
    (!!translations.secondary && secondary.isLoading) ||
    (!!translations.tertiary && tertiary.isLoading)
  const end = verseEnd ?? verseStart
  const slides: Slide[] = []
  for (let n = verseStart; n <= end; n++) {
    const pText = lookupVerse(primary.data, n)
    if (!pText) continue
    const fill: SlotFill = {
      primary: pText,
      caption: `${bookLabel} ${chapter}:${n}`,
    }
    if (translations.secondary) {
      fill.secondary = lookupVerse(secondary.data, n)
    }
    if (translations.tertiary) {
      fill.tertiary = lookupVerse(tertiary.data, n)
    }
    slides.push({
      kind: "bible",
      caption: `${bookLabel} ${chapter}:${n}`,
      body: pText,
      fill,
    })
  }
  return { slides, isLoading }
}

// ---- song -----------------------------------------------------------------

export function useSongSlides(
  item: ListServiceItemsWithContentRow | null
): { slides: Slide[]; isLoading: boolean } {
  const enabled = !!item && item.kind === "song" && item.song_id !== null
  const { data, isLoading } = useQuery({
    queryKey: ["songs", "full", item?.song_id],
    queryFn: () =>
      Songs.GetSong(item!.song_id) as unknown as Promise<SongFull>,
    enabled,
  })
  if (!enabled) return { slides: [], isLoading: false }
  if (!data) return { slides: [], isLoading }
  const title = data.song.title || "(untitled)"

  // Number sections per type (verse 1, verse 2, chorus 1, …). Within
  // a section, a blank line splits the text into separate slides that
  // still share the section's number — so a 4-line verse with a blank
  // in the middle renders as two "Verse 1" slides, not Verse 1 + 2.
  const counters: Record<string, number> = {}
  const slides: Slide[] = []
  for (const s of data.sections) {
    const type = s.section.type
    counters[type] = (counters[type] ?? 0) + 1
    const number = counters[type]
    const label = `${songSectionType(type).label} ${number}`

    const chunks: string[][] = [[]]
    for (const line of s.lines) {
      if (line.text === "") {
        if (chunks[chunks.length - 1].length > 0) chunks.push([])
      } else {
        chunks[chunks.length - 1].push(line.text)
      }
    }
    if (chunks[chunks.length - 1].length === 0) chunks.pop()
    if (chunks.length === 0) continue

    for (const chunk of chunks) {
      const text = chunk.join("\n")
      slides.push({
        kind: "song",
        sectionType: type,
        caption: `${title} · ${label}`,
        body: text,
        // `secondary` is filled in a second pass below — at this point
        // we don't know what the next slide's text will be yet.
        fill: { primary: text, caption: title },
      })
    }
  }

  // Second pass: link each slide's `secondary` fill to the NEXT slide's
  // primary text. The audience template renders this under the current
  // line as a "what's next" preview so singers see the upcoming line
  // before the slide actually advances. Last slide gets no secondary.
  for (let i = 0; i < slides.length - 1; i++) {
    const next = slides[i + 1]
    const nextText = typeof next.fill.primary === "string" ? next.fill.primary : ""
    slides[i] = {
      ...slides[i],
      fill: { ...slides[i].fill, secondary: nextText },
    }
  }

  return { slides, isLoading }
}

// ---- media ----------------------------------------------------------------

export function useMediaSlides(
  item: ListServiceItemsWithContentRow | null
): { slides: Slide[]; isLoading: boolean } {
  if (!item || item.kind !== "media") return { slides: [], isLoading: false }
  // Initial playback defaults: send-to-live starts playback for
  // video/audio, no loop, audible (muted=false). The operator
  // controls in show-pane override after the first push.
  // restartToken=0 — bumped only by the explicit Restart control.
  const slide: Slide = {
    kind: "media",
    caption: item.label || "Media",
    body: item.label || "(media)",
    fill: {
      media: {
        mediaId: item.media_id,
        playing: true,
        loop: false,
        muted: false,
        restartToken: 0,
      },
    },
  }
  return { slides: [slide], isLoading: false }
}

// ---- unified --------------------------------------------------------------

// useItemSlides dispatches to the right per-kind hook based on the
// item type. All three hooks always render (React rule); only the one
// matching the kind returns real data.
export function useItemSlides(
  item: ListServiceItemsWithContentRow | null
): { slides: Slide[]; isLoading: boolean } {
  const bible = useBibleSlides(item)
  const song = useSongSlides(item)
  const media = useMediaSlides(item)
  if (!item) return { slides: [], isLoading: false }
  switch (item.kind) {
    case "bible":
      return bible
    case "song":
      return song
    case "media":
      return media
    default:
      return { slides: [], isLoading: false }
  }
}
