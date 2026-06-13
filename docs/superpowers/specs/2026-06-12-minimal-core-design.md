# Minimal-Core Rework — Design Spec

Date: 2026-06-12
Status: approved pending user review

## Context

NeoProjector accumulated standalone pages (presenter view, presentation editor,
template/overlay editor routes, settings page) that fragment the app. The goal
is a minimal, cohesive core: one Show page whose panes host everything, and a
renderer with strict, predictable layer precedence.

A prior session (≈2026-06-02) already implemented the surface migration
(settings/template/overlay editors as inline Show-page surfaces, presenter
route deleted) but the work was never committed and was lost when the repo was
re-cloned. The design decisions from that session are preserved and re-applied
here.

## Decisions (settled with the user)

1. **Live model: derived channels.** Live state is always
   `compose(service defaults, section overrides, active item elements, manual
   overlay toggles)`. No history stack. Esc clears the active item; defaults
   re-derive.
2. **Background config scope: service + section + item**, nearest wins:
   `item ?? section ?? service ?? none`.
3. **Presentations: keep playback, drop editor.** DB tables, schedule items,
   library tab, and live playback (loop/auto-advance/transitions) survive.
   Only the `/presentations/$presentationId` editor route is deleted. A
   Show-surface slide editor + PDF import are a later, separate project.
4. **Architecture: channels in the payload, composition in the operator
   window.** Go stays a cache-and-relay; outputs render channels bottom-up
   with the existing per-display flags.
5. **Service defaults UI: a pinned, non-deletable "Defaults" section** at the
   top of the schedule (not a chip on the service header).
6. **Backgrounds are first-class**: DB-backed documents with seeded grayscale
   defaults (negative ids, same shadow/restore pattern as templates) and their
   own editor surface. Engine v1: gradflow.

## Non-goals (explicitly deferred)

- PPTX/Google Slides/PDF import.
- Presentation slide editor as a Show surface; clicker / auto-advance settings
  UI in the settings surface.
- Media (image/video) backgrounds in the assignment UI (the schema supports
  them from day one; the UI does not expose them yet).
- Per-section/per-item overlay attachment (overlays stay manual toggles).
- Per-item template overrides (templates stay per-display bindings).
- Custom shader engines for backgrounds beyond gradflow.

---

## 1. Demolition

Delete:

- `routes/_app.presenter.tsx` and presenter-only feature code.
- `routes/_app.settings.tsx` (content re-homed, placeholders dropped).
- `routes/_app.templates.$templateId.tsx`, `routes/_app.overlays.$overlayId.tsx`
  (re-homed as surfaces).
- `routes/_app.presentations.$presentationId.tsx` (editor only; feature stays).
- Header: presenter link, fake notifications bell (wired to nothing).

Keep: auth screen, command palette, Go Live flow, library, schedule, displays
preview pane, presentations playback.

## 2. Surfaces

The `/` route (`_app.index.tsx`) gets typed search params:

```ts
surface?: "settings" | "template" | "overlay" | "background"
editId?: number   // which row an editor edits (omit for settings)
```

- **Settings surface**: the center (Show) pane becomes a single scrollable
  column — General (UI animations, vim nav, auto-collapse, service name
  format), Output (bypass display check), Displays (existing DisplaySettings),
  Bibles (translations + next-verse preview). Empty placeholder sections die.
- **Editor surfaces** (template, overlay, background): center pane = editor
  canvas; schedule pane = editor options/inspector. Displays preview pane and
  library stay visible. Pattern per editor:
  `features/<kind>/editor/` exporting `<Kind>EditorProvider({id, children})`
  (working state, autosave, selection) + `<Kind>EditorOptions()` (left pane) +
  `<Kind>EditorCanvas()` (center). Both regions consume the provider via
  context (TanStack Router has a single Outlet — search params bridge the
  regions; verified previously against TanStack docs).
- **Esc** closes the surface via a capture-phase listener (beats the global
  clear-live keybind). Template editor: deselect-then-exit; others: exit.
- Shell cog toggles `surface=settings`; editors open from the library tabs.
- Style: flat & squared (rounded-none), per the app's aesthetic.

**Transparency rule**: templates and overlays are always transparent.
Background controls are removed from both editors; the renderer ignores
`TemplateBody.background` and new writes omit it. Editor canvases render a
checkerboard (or live service background) behind the work so text is visible.

## 3. Renderer — layered channels

### Payload

`LivePayload` (Go `services/displays/service.go` + generated TS bindings)
becomes independent channels. Go remains a dumb cache-and-relay — `PushLive`
logic (audio pick, caching, broadcast) is unchanged in role.

```go
type LivePayload struct {
    // z0 — exactly one of Media/Background renders; Media wins.
    Background     *BackgroundSnapshot  // resolved at push time
    Media          *MediaChannel        // media schedule items
    // z1
    ActiveOverlays []OverlayActivation  // unchanged
    // z2
    Slide          *SlideChannel        // kind song|bible, fill, source ids,
                                        // font_size_override_by_template
    // z3
    Presentation   *PresentationChannel // slide media, transition, next_media_id
    AudioDisplayID int64
}

type BackgroundSnapshot struct {
    BackgroundID int64  // negative = seed, positive = DB row
    Engine       string // "gradflow"
    ConfigJSON   string // opaque to Go
}
```

`MediaChannel` carries the current `LiveMediaRef` + source item id.
`PresentationChannel` carries its media ref, playback/transition fields, and
`next_media_id` for preloading. Exact field-level layout is an implementation
detail; the invariant is: **four channels + overlays, each independently
nullable.**

### Compositing (output window, bottom-up)

```
z0  media ?? background ?? black     gated by show_media
z1  overlays                         gated by show_overlay (cover_slide kept)
z2  template slide (song|bible)      gated by show_song / show_bible
z3  presentation                     gated by show_media
```

- No new per-display flags. `show_media` gates both z0 and z3 (a lyrics-only
  stage display wants neither media nor announcement slides).
- Operator preview tiles keep pixel-parity with outputs (same gating logic).
- Audio source selection unchanged, considering z0-media or z3 media.
- The background pauses/unmounts when an opaque channel fully covers it
  (presentation live, or cover-mode media) so gradflow's WebGL doesn't burn
  GPU invisibly across N output windows.
- Media fast-path (DualLayerMediaCanvas) and next-media warming survive as the
  z0/z3 media renderers.

### Derivation (operator window, LiveProvider)

State inputs: active item (+ its section/service config), manual overlay
toggles, manual media playback patches. A pure function derives the payload:

```
background = item.background_id ?? section.background_id ?? service.background_id ?? none
slide / media / presentation = from active item's kind
overlays = manual toggles
```

- Going live on a song with a configured background fills z2 AND swaps z0.
- **Esc clears the active item**; the service-default background re-derives.
  The resting state is the default background, never forced black. Full
  blackout remains Go Offline.
- Esc with a surface open closes the surface instead (capture-phase).
- No persisted live state across app restarts (unchanged).

## 4. Schedule element config

### Schema (one goose migration)

```sql
CREATE TABLE background (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  engine      TEXT NOT NULL DEFAULT 'gradflow',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE service         ADD COLUMN background_id INTEGER; -- NULL = none/inherit
ALTER TABLE service_section ADD COLUMN background_id INTEGER;
ALTER TABLE service_item    ADD COLUMN background_id INTEGER;
```

No FK on `background_id` — negative ids reference frontend seeds, resolved
client-side (same convention as template bindings).

### Services (Go)

`services/backgrounds`: List/Create/Update/Delete/ByID (mirrors templates
service). `services/schedule`: `SetServiceBackground`, `SetSectionBackground`,
`SetItemBackground` (0 clears → NULL).

### Seeds & editable defaults

`features/backgrounds/defaults.ts` ships 4 grayscale presets with negative
ids, following the editable-defaults pattern used by templates: editing a
default persists a DB row reusing the seed's negative id (shadowing it);
"restore" deletes the row.

| Seed | gradflow type | Character |
|------|--------------|-----------|
| Godrays | `stripe`/`wave` (tuned) | soft angled light beams, slow drift |
| Sand | `smoke`, high noise | grainy sand moving cohesively |
| Silk | `silk` | grayscale of the login flow |
| Mist | `smoke`, low noise | near-black slow fog |

All grayscale (3 gray tones per config). Godrays is an approximation within
gradflow's shader set; a custom shader can replace it in a later polish pass
without changing the data model (engine field exists for this).

### Schedule UI

- **Defaults are persisted per-service in the DB** (`service.background_id`),
  not app-level state: reopening an older service restores exactly the
  defaults it was configured with.
- **Pinned "Defaults" section** at the top of the schedule pane: virtual (not
  a `service_section` row), non-deletable and non-reorderable by construction.
  v1 contains one item-like row: Background — shows the resolved service
  default (name + mini animated thumbnail), click opens a picker; empty state
  reads "No default background". Future default elements (e.g. an always-on
  overlay) slot into this section.
- Section headers and item rows show a small background chip when an override
  is set; assignment via the existing edit affordances/pickers.

## 5. Backgrounds feature

- `features/backgrounds/`: `defaults.ts` (seeds), `types.ts` (config shape =
  gradflow's `GradientConfigInput` + engine envelope), `background-view.tsx`
  (one component rendering a BackgroundSnapshot — used by output windows,
  preview tiles, library thumbnails, editor canvas), `api.ts` (query hooks).
- **Library tab "Backgrounds"** alongside Songs/Bible/Media/…: grid of seeds +
  user rows with animated thumbnails (animate only visible tiles; pause
  offscreen — N WebGL contexts are not free), "New background" tile opens the
  editor surface, row actions: edit / duplicate / delete (seeds: edit shadows,
  restore un-shadows).
- **Background editor surface** (`surface=background&editId=…`): center canvas
  = full-bleed live preview; options pane = name, gradflow type picker, three
  color controls (free-pick; defaults grayscale), speed/scale/noise sliders.
  Autosave like the other editors.

## 6. Sub-project order

1. **Demolition + surfaces** — removals, surface mechanism, settings/template/
   overlay surfaces, header cleanup, transparency rule. No schema changes.
   App fully usable after.
2. **Renderer channels + element config** — payload restructure, output/preview
   compositing, derivation + Esc semantics, migration (background table +
   columns), schedule services, pinned Defaults section + chips (picker can
   stub on seeds before the editor exists).
3. **Backgrounds** — seeds, BackgroundView, library tab, editor surface.

Each sub-project gets its own implementation plan and lands as a reviewable
unit.

## 7. Error handling & testing

- Derivation/resolution is a pure TS function — unit-tested (the repo has no
  test harness yet; add vitest scoped to `features/live`/`features/backgrounds`
  pure logic in sub-project 2).
- Corrupt/missing `config_json` falls back to a built-in default config
  (pattern: `parseTemplateBody`). Unknown `engine` renders black, never
  throws.
- A `background_id` pointing at a deleted row resolves to none (inherit
  continues up the chain) — no FK, so deletion is soft-tolerant.
- Go service methods follow existing transactional patterns (`inTx`).
- End-to-end verification via `task dev` with bypass display check + output
  windows on a single machine.
