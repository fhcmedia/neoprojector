# Backgrounds Feature Implementation Plan (sub-project 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. **NEVER `git commit` — the user commits at checkpoints.**

**Goal:** Make backgrounds a managed, editable library: a Backgrounds tab beside the other library tabs, and a background editor surface (`surface=background&editId=…`) for tuning gradflow configs — with seed defaults editable via the shadow-row pattern (edit persists a DB row reusing the seed's negative id; restore deletes it).

**Architecture:** Everything reuses landed machinery — `BackgroundView` renders, `useBackgrounds` merges seeds/rows, the surface system hosts the editor (options over schedule pane, canvas over show pane, plain-Esc close like overlays), the templates editor's field widgets supply the controls.

**Spec:** `docs/superpowers/specs/2026-06-12-minimal-core-design.md` §5
**VERIFY** = `pnpm exec vite build --logLevel error` + fresh `tsc -b` + `pnpm test`.

## Task 1: API mutations (`features/backgrounds/api.ts`)
- Expose raw rows from `useBackgrounds` (`rows: query.data`) so shadow detection (`rows.some(r => r.id === seedId)`) is possible.
- Add `useCreateBackground`, `useUpdateBackground`, `useSaveBackgroundWithID` (seed shadowing), `useDeleteBackground` — all invalidate `backgroundKeys.list`.

## Task 2: Editor (`features/backgrounds/editor/`)
- `background-editor.tsx` — `BackgroundEditorProvider({id, onClose, children})`: resolve doc from merged list; working `name` + parsed config (`type/color1/color2/color3/speed/scale/noise` with defaults); 300ms-debounced autosave — seeds (`id < 0`) save via `SaveWithID` (creates/updates the shadow), user rows via `Update`; `restoreSeed()` deletes the shadow row and reseeds working state from the pristine seed; context exposes all of it + `isSeed`/`isShadowed`.
- `background-editor-options.tsx` — name input header (close arrow), Type select (gradflow's 7 types), three `ColorField`s + `NumberField`s for speed/scale/noise (reused from `features/templates/editor/fields`), "Restore default" button when shadowed.
- `background-editor-canvas.tsx` — full-bleed `BackgroundView` of the WORKING config (instant preview), name/engine chrome minimal.

## Task 3: Surface wiring
- `surface-search.ts`: add `"background"` to `SURFACES`.
- `_app.index.tsx`: `backgroundEditorOpen` branch — options replace schedule pane, canvas replaces show pane, provider wraps `topRow`; plain Esc (no policy registration).

## Task 4: Library tab
- `features/library/backgrounds-tab.tsx` — tile grid (16:9 live `BackgroundView` + name; seeds badge "Default", shadowed seeds badge "Edited"); click opens the surface; delete on user rows (double-confirm like presentations) and "Restore" on shadowed seeds; `AddTile` creates an untitled gradflow row (Silk-ish starter config) and opens it.
- `library-view.tsx`: add `backgrounds` to the Tab union + `TABS`, session-persisted search, content case (`onOpen` → `navigate surface=background&editId=id`). Neutral underline (no item kind).

## Task 5: VERIFY + CHECKPOINT
Preset visual tuning happens at the checkpoint with the user looking at real output — config numbers in `presets.ts` are expected to change there.
