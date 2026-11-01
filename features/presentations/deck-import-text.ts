// Pure helpers for deck import (no Wails runtime, so they're unit-
// testable): which files are decks, their names, and the sentences the
// import toast shows for each converter stage.

export const DECK_EXTENSIONS = [
  "pdf", "pptx", "ppt", "pps", "ppsx", "pptm", "potx", "odp", "key",
] as const

export const DECK_FILE_PATTERN = DECK_EXTENSIONS.map((e) => `*.${e}`).join(";")

export function isDeckPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return (DECK_EXTENSIONS as readonly string[]).includes(ext)
}

export function deckName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.[^.]+$/, "")
}

// convertDetail turns the Go side's deck:progress stage into a sentence.
// The one-time converter setup can take minutes on a slow PC; saying so
// is what keeps it from looking stuck.
export function convertDetail(stage: string, pct: number): string {
  switch (stage) {
    case "waiting":
      return "Waiting for the other import to finish…"
    case "powerpoint":
      return "Opening in PowerPoint…"
    case "downloading":
      return `Downloading the PowerPoint converter (one time only, 360 MB)${pct >= 0 ? ` — ${pct}%` : "…"}`
    case "unpacking":
      return "Setting up the PowerPoint converter (one time only, can take a few minutes)…"
    case "converting":
      return "Converting slides…"
  }
  return "Preparing…"
}
