import { useEffect } from "react"

// Capture-phase Esc handler: surfaces must close on Esc BEFORE the
// global clear-live keybind sees the event (use-keybinds listens at
// bubble phase on window). `when` gates installation so the hook can
// be declared unconditionally by the page. onEsc may return false to
// signal it handled the key internally (e.g. the template editor
// deselecting a box) — the surface stays open, but the event is still
// swallowed so the clear-live keybind never fires while a surface is
// up.
export function useSurfaceEsc(when: boolean, onEsc: () => boolean | void) {
  useEffect(() => {
    if (!when) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      // Don't steal Esc from open dialogs/popovers or text inputs —
      // those close themselves and the user expects that to win.
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.closest("[role=dialog]") ||
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA")
      ) {
        return
      }
      onEsc()
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true })
  }, [when, onEsc])
}
