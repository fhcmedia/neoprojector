import { useEffect } from "react"
import { useLive } from "@/features/live/live-context"
import { useVimMode } from "@/hooks/use-vim-mode"

// useKeybinds installs the operator's global keymap. Arrows always
// work; vim mode adds j/k as duplicates. Esc clears the live output
// regardless of mode. Mounted once at the app shell level — the
// listener bails when the user is typing in an input/textarea/
// contentEditable so the schedule rename, search, song editor, etc.
// keep their normal text-editing behaviour.
export function useKeybinds() {
  const { navigateNext, navigatePrev, clearLive } = useLive()
  const { enabled: vim } = useVimMode()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't hijack text input — operator is editing, not driving.
      const t = e.target as HTMLElement | null
      const editable =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      if (editable) return
      // Don't fight modifier combos — those are reserved for the OS
      // and for menu commands.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault()
          navigateNext()
          return
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault()
          navigatePrev()
          return
        case "Escape":
          e.preventDefault()
          clearLive()
          return
        case "/": {
          // Refocus the currently-mounted library search input AND
          // wipe its value — operator pressed "/" to start a fresh
          // query, not to edit the previous one. Dispatches an input
          // event so the React onChange handler picks up the clear.
          const el = document.querySelector<HTMLInputElement>(
            "input[data-library-search]"
          )
          if (el) {
            e.preventDefault()
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value"
            )?.set
            setter?.call(el, "")
            el.dispatchEvent(new Event("input", { bubbles: true }))
            el.focus()
          }
          return
        }
      }
      if (vim) {
        switch (e.key) {
          case "j":
          case "l":
            e.preventDefault()
            navigateNext()
            return
          case "k":
          case "h":
            e.preventDefault()
            navigatePrev()
            return
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigateNext, navigatePrev, clearLive, vim])
}
