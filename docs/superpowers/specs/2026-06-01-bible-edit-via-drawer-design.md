# Bible edit via drawer (remove the edit modal)

**Date:** 2026-06-01
**Status:** Approved, implementing

## Problem

Editing a Bible verse already in the schedule pops a modal (`EditItemDialog` →
`BiblePicker mode="edit"`). The modal is a heavy, separate surface for what is a
tiny change. The app's ethos is minimal + seamless.

## Goal

Remove the modal for Bible edits. Clicking the pencil on a Bible schedule row
arms the existing **Bible drawer** (the Bible tab in the bottom Library panel),
jumps it to that row's reference, and a verse pick in the drawer applies the
edit directly.

## Behavior

- Pencil on a Bible row → arm the drawer for that row, switch Library to the
  Bible tab, jump the panes to the row's **book + chapter**, highlight the
  current verse range, **and preview the row in the Show pane** (preview only —
  selecting a row never broadcasts to the projector).
- **Book + chapter are locked** while armed (dimmed, non-interactive). Edit is
  **verse-selection only** — changing book/chapter is not what edit is for.
- Picks are **tentative** (confirm model): click = single verse, Shift+click =
  extend range. Each pick updates the tentative range, which the drawer
  highlight, the header chip, **and the Show-pane preview** all follow live — so
  an added verse appears in the preview as you pick it. Nothing is persisted yet.
- **Enter** (or the chip's ✓) commits the tentative range to the schedule row via
  `UpdateBibleItem`. **Esc** (or the chip's ✕) cancels — the row is left exactly
  as it was, no write.
- Editing **never touches the projector**. The preview is the operator's Show
  pane, which does not broadcast on its own; the live output (`PushLive`) is only
  ever changed by an explicit go-live click, never by editing.
- Disarms on: Enter/✓ (commit), Esc/✕ (cancel), selecting a different schedule
  row, or switching Library tabs away from Bible. On disarm the edited row's
  pencil returns to its normal (un-highlighted) state.
- **Drawer position:** after a confirm the drawer *stays on the verse just
  edited*; after a cancel it *returns to wherever it was browsing* before the
  edit (not the Genesis default). Implemented with a one-shot `committedAt`
  signal the drawer applies in a `useLayoutEffect` (no flash); cancel publishes
  nothing, so the browse position is never touched.

## Scope

- **Edit only.** The Add flow (slide-in `AddFlow` → `BiblePicker mode="add"`) is
  unchanged.
- Songs/overlays keep the existing `EditItemDialog` modal. Only the **bible**
  branch is removed from the modal. `BiblePicker`'s `mode="edit"` path is left
  intact: its only other caller, `EditFlow` in `editor-flow.tsx`, is already
  dead code (exported, imported nowhere), so removing the path would mean
  editing dead code for no benefit — out of scope.

## Architecture

A small transient **`bible-edit` React context** provider wraps `Projector`
(`routes/_app.index.tsx`), mirroring the existing `useLive` context pattern.

- `useBibleEdit()` exposes `{ target, begin(item), setRange(s,e), commit(),
  cancel() }` where `target` is `{ itemId, book, bookLabel, chapter, verseStart,
  verseEnd } | null` and the verse range is the **tentative** edit.
- The schedule pencil (for `kind === "bible"`) calls `begin(item)` (and previews
  the row) instead of the `?edit` URL param flow; non-bible kinds keep the modal.
- `LibraryView` forces `active = "bible"` while a target exists and renders the
  edit chip in place of the search input.
- `BibleTab` reads `target`: when armed it becomes **controlled** by the target
  (book/chapter fixed, verse range from target), locks the books/chapters panes,
  and routes verse picks to `setRange` (tentative) instead of `onSubmit`.
- `ShowPane` reads `target` and previews the **tentative** range for the row
  under edit (overriding the saved range), so the preview tracks each pick before
  anything is persisted. Its previewed-item lookup is also resolved fresh each
  render (was a stale `useMemo`) so a committed edit shows immediately.
- `commit()` writes the range into the schedule-items cache (instant label +
  preview) and persists via `useUpdateBibleItem`; `cancel()` just clears the
  target. The provider binds **Enter → commit / Esc → cancel** in the capture
  phase so it beats the global Esc-clears-live keybind and the focused verse
  button's own Enter.
- Context is in-memory (not `useSessionState`) so edit mode does not survive an
  app reload.

No backend changes — `useUpdateBibleItem({ itemId, ref })` already exists and is
what the modal called.

## Affordance

While armed, the Bible tab header replaces the search input with a compact chip:
`✎ Editing <Book> <chapter>:<range>   Enter to confirm · Esc to cancel   ✓ ✕`.
The range updates live as the operator picks. Books/chapters panes dim; the
verses pane stays interactive with the tentative range highlighted.
