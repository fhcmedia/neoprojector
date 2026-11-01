import { useEffect } from "react"
import { Events } from "@wailsio/runtime"
import { isStickyOverlay, useLive } from "@/features/live/live-context"
import { useVimMode } from "@/hooks/use-vim-mode"

// Presentation clickers are keyboards: most send PageDown/PageUp, some
// arrows; their "start show" button sends F5 (or Shift+F5), which in a
// webview would RELOAD the operator window mid-service — swallowed.
// Output windows forward these keys here (OUTPUT_KEY_EVENT), so a
// clicker keeps working even when a projector window has focus.
export const OUTPUT_KEY_EVENT = "output:key"
export const FORWARDED_KEYS = new Set([
  "ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft",
  "PageDown", "PageUp", "Escape", "F5",
])

// useKeybinds installs the operator's global keymap. Arrows always
// work; vim mode adds j/k as duplicates. Esc clears the live output
// regardless of mode. Mounted once at the app shell level — the
// listener bails when the user is typing in an input/textarea/
// contentEditable so the schedule rename, search, song editor, etc.
// keep their normal text-editing behaviour.
// overlayOpen: a Radix popover/menu/select or a dialog is open — the
// Escape key belongs to it.
function overlayOpen(): boolean {
  return !!document.querySelector(
    '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]'
  )
}

export function useKeybinds() {
  const { navigateNext, navigatePrev, clearLive, clearOverlays, activeOverlays } = useLive()
  const { enabled: vim } = useVimMode()

  useEffect(() => {
    // handleNavKey runs a navigation key (from this window or forwarded
    // from an output window); false when the key isn't one.
    function handleNavKey(key: string): boolean {
      switch (key) {
        case "ArrowDown":
        case "ArrowRight":
        case "PageDown":
          navigateNext()
          return true
        case "ArrowUp":
        case "ArrowLeft":
        case "PageUp":
          navigatePrev()
          return true
        case "Escape":
          // Priority tree: clear overlays first, then slide.
          // Each press peels back one layer so the operator always
          // knows what Escape will do next. Sticky overlays (e.g. the
          // sermon timer) are never cleared by Esc — only by toggling
          // their schedule item or "Clear all overlays".
          if (activeOverlays.some((o) => !isStickyOverlay(o))) {
            clearOverlays({ keepSticky: true })
          } else {
            clearLive()
          }
          return true
        case "F5":
          return true // swallowed: see FORWARDED_KEYS
      }
      return false
    }
    function onKey(e: KeyboardEvent) {
      // Don't hijack text input — operator is editing, not driving.
      const t = e.target as HTMLElement | null
      const editable =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      if (editable) return
      // F5 must never reload the operator window — not even with a
      // modifier (Shift+F5 is a clicker's "resume show").
      if (e.key === "F5") {
        e.preventDefault()
        return
      }
      // Don't fight modifier combos — those are reserved for the OS
      // and for menu commands.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // Esc that closes a popover, menu or dialog must not ALSO clear
      // the live output (closing a menu mid-sermon blacked the screens).
      // The overlay closes itself before this bubble-phase handler runs,
      // so whether one was open is recorded in the capture phase below.
      if (e.key === "Escape" && (e.defaultPrevented || escClosesOverlay)) return

      if (handleNavKey(e.key)) {
        e.preventDefault()
        return
      }
      switch (e.key) {
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
    let escClosesOverlay = false
    function onKeyCapture(e: KeyboardEvent) {
      if (e.key === "Escape") escClosesOverlay = overlayOpen()
    }
    window.addEventListener("keydown", onKeyCapture, { capture: true })
    window.addEventListener("keydown", onKey)
    const off = Events.On(OUTPUT_KEY_EVENT, (event: { data?: unknown }) => {
      if (typeof event?.data === "string") handleNavKey(event.data)
    })
    return () => {
      window.removeEventListener("keydown", onKeyCapture, { capture: true })
      window.removeEventListener("keydown", onKey)
      off?.()
    }
  }, [navigateNext, navigatePrev, clearLive, clearOverlays, activeOverlays, vim])
}
