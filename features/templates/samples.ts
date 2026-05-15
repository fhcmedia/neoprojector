import type { SlotFill } from "./types"

// Sample fills used for thumbnails and the editor preview. Picked by
// template.kind so a Bible template renders with verse-shaped content
// even before any live item is wired up.

export const sampleByKind: Record<string, SlotFill> = {
  bible: {
    primary:
      "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
    secondary:
      "Ибо так возлюбил Бог мир, что отдал Сына Своего Единородного, дабы всякий, верующий в Него, не погиб, но имел жизнь вечную.",
    tertiary:
      "Бо так полюбив Бог світ, що дав Сина Свого Однородженого, щоб кожен, хто вірує в Нього, не загинув, але мав життя вічне.",
    caption: "John 3:16",
  },
  song: {
    // Two-line "current" block. Stage and Lower Thirds templates assume
    // song slides come in as 2-line chunks; that's what users typically
    // structure their songs into.
    primary:
      "Amazing grace, how sweet the sound\nThat saved a wretch like me",
    // Two-line "next" block. Used by Song - Stage to preview the
    // upcoming pair, dimmed below the current pair.
    secondary:
      "I once was lost, but now am found\nWas blind, but now I see",
    caption: "Verse 1",
  },
  media: {
    caption: "media.mp4",
  },
  general: {
    primary: "Sample content",
    caption: "Sample",
  },
}

export function sampleFor(kind: string): SlotFill {
  return sampleByKind[kind] ?? sampleByKind.general
}
