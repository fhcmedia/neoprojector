# Renderer Channels + Element Config Implementation Plan (sub-project 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox steps. **NEVER `git commit` — the user commits at each CHECKPOINT.**

**Goal:** Replace the single-kind `LivePayload` with four independent render channels (background, media, slide, presentation) + overlays, add per-service/section/item background config in the DB, and make live state derive from `compose(service default, section override, item override, manual toggles)` with Esc re-deriving instead of restoring.

**Architecture:** Go stays a cache-and-relay (struct reshape only; audio pick widens to any media-bearing channel). The operator window composes channels; output windows + preview tiles render them bottom-up gated by the existing per-display flags (`show_media` gates z0 *and* z3). Backgrounds are DB rows (`background` table) referenced by nullable `background_id` columns; negative ids resolve to frontend seeds (template convention).

**Tech Stack:** goose (embedded, next id 0020), sqlc (`database/queries/*.sql` → `database/`), Wails3 bindings (`task generate:bindings`), React/TanStack Query, gradflow.

**Spec:** `docs/superpowers/specs/2026-06-12-minimal-core-design.md`
**VERIFY (frontend)** = `pnpm exec vite build --logLevel error` then `rm -f tsconfig.tsbuildinfo && pnpm exec tsc -b`.
**VERIFY (go)** = `go build -o ./bin/neoprojector .`

---

## Phase 1 — Schema + Go plumbing (zero behavior change)

### Task 1.1: Migration + schema

**Files:** Create `database/migrations/0020_backgrounds.sql`; modify `database/schema.sql` (keep in lockstep — sqlc reads it).

```sql
-- +goose Up
CREATE TABLE background (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  engine      TEXT NOT NULL DEFAULT 'gradflow',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- No FK on background_id anywhere: negative ids reference frontend
-- seeds (template-binding convention); deleted rows resolve to "none".
ALTER TABLE service         ADD COLUMN background_id INTEGER;
ALTER TABLE service_section ADD COLUMN background_id INTEGER;
ALTER TABLE service_item    ADD COLUMN background_id INTEGER;

-- +goose Down
ALTER TABLE service_item    DROP COLUMN background_id;
ALTER TABLE service_section DROP COLUMN background_id;
ALTER TABLE service         DROP COLUMN background_id;
DROP TABLE background;
```

Mirror the same `CREATE TABLE` + three columns into `database/schema.sql`.

### Task 1.2: Queries + sqlc

**Files:** Create `database/queries/background.sql`; modify `database/queries/service.sql`, `service_section.sql`, `service_item.sql`.

`background.sql` (mirror template.sql naming):
```sql
-- name: ListBackgrounds :many
SELECT * FROM background ORDER BY name;
-- name: BackgroundByID :one
SELECT * FROM background WHERE id = ?;
-- name: CreateBackground :one
INSERT INTO background (name, engine, config_json) VALUES (?, ?, ?) RETURNING *;
-- name: CreateBackgroundWithID :one
INSERT INTO background (id, name, engine, config_json) VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, engine=excluded.engine,
  config_json=excluded.config_json, updated_at=CURRENT_TIMESTAMP RETURNING *;
-- name: UpdateBackground :one
UPDATE background SET name=?, engine=?, config_json=?, updated_at=CURRENT_TIMESTAMP
WHERE id=? RETURNING *;
-- name: DeleteBackground :exec
DELETE FROM background WHERE id = ?;
```
(`CreateBackgroundWithID` is the shadow-a-seed path: editing a default upserts a row reusing the seed's negative id.)

Setters (one per file, mirroring `SetSectionColor`):
```sql
-- name: SetServiceBackground :exec
UPDATE service SET background_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;
-- name: SetSectionBackground :exec  (service_section.sql)
-- name: SetItemBackground :exec     (service_item.sql)
```
NULL clears — sqlc param is `sql.NullInt64`. Confirm `ListServiceItemsWithContent` (service_item.sql) selects `service_item.*` or add `background_id` + section's `background_id` to the row (needed by Phase 3 resolution; add now: `sec.background_id AS section_background_id`).

Run `task generate:sqlc`. VERIFY(go).

### Task 1.3: Backgrounds service + schedule setters + registration

**Files:** Create `services/backgrounds/service.go`; modify `services/schedule/service.go`, `main.go`.

- `services/backgrounds`: `ServiceName() "backgrounds"`, List/ByID/Create/Update/Delete + `SaveWithID(id, name, engine, configJSON)` (upsert for seed shadowing); copy templates service's `inTx`/unique-name discipline where it applies (name uniqueness NOT required — skip).
- `services/schedule`: `SetServiceBackground(ctx, id, backgroundID int64)`, `SetSectionBackground`, `SetItemBackground` — `backgroundID == 0` writes NULL (clear/inherit).
- `main.go`: `application.NewService(backgrounds.New(db))` after overlays.
- `task generate:bindings`, then VERIFY(go) + VERIFY(frontend).

**CHECKPOINT A — STOP.** App behavior unchanged; schema + services land. User reviews/commits.

---

## Phase 2 — Channelized LivePayload (behavior-preserving reshape)

### Task 2.1: Go payload reshape (`services/displays/service.go`)

```go
type LivePayload struct {
    // z0 — exactly one of Media/Background renders; Media wins.
    Background *BackgroundSnapshot `json:"background,omitempty"`
    Media      *MediaChannel       `json:"media,omitempty"`
    // z1 (unchanged shape)
    ActiveOverlays []OverlayActivation `json:"active_overlays"`
    // z2 — templated text
    Slide *SlideChannel `json:"slide,omitempty"`
    // z3 — presentation playback
    Presentation *PresentationChannel `json:"presentation,omitempty"`
    AudioDisplayID int64 `json:"audio_display_id,omitempty"`
}
type BackgroundSnapshot struct {
    BackgroundID int64  `json:"background_id"`
    Engine       string `json:"engine"`
    ConfigJSON   string `json:"config_json"`
}
type MediaChannel struct {
    Ref          LiveMediaRef `json:"ref"`
    SourceItemID int64        `json:"source_item_id"`
}
type SlideChannel struct {
    Kind         string   `json:"kind"` // "song" | "bible"
    Fill         LiveFill `json:"fill"`
    SourceItemID int64    `json:"source_item_id"`
    SlideIndex   int64    `json:"slide_index"`
    FontSizeOverrideByTemplate map[string]int64 `json:"font_size_override_by_template,omitempty"`
}
type PresentationChannel struct {
    Ref                  LiveMediaRef `json:"ref"`
    SourceItemID         int64        `json:"source_item_id"`
    SlideIndex           int64        `json:"slide_index"`
    TransitionKind       string       `json:"transition_kind,omitempty"`
    TransitionDurationMs int64        `json:"transition_duration_ms,omitempty"`
    NextMediaID          int64        `json:"next_media_id,omitempty"`
}
```
`LiveFill`/`LiveMediaRef`/`OverlayActivation` unchanged. Kill `Kind`/top-level fill fields. `CurrentLive` empty-state: zero-value payload (all channels nil). PushLive audio pick: choose smallest media-capable display when `Media != nil || Presentation != nil`. Regenerate bindings.

### Task 2.2: Frontend live state (`features/live/live-context.tsx`)

`LiveSlide` → discriminated by channel:
```ts
export type LiveContent =
  | { channel: "slide"; kind: "song" | "bible"; sourceItemId: number | null;
      slideIndex: number; fill: SlotFill;
      fontSizeOverrideByTemplate?: Record<number, number>;
      bibleRef?: {...} }
  | { channel: "media"; sourceItemId: number | null; media: MediaRef }
  | { channel: "presentation"; sourceItemId: number | null; slideIndex: number;
      media: MediaRef; transitionKind?: string; transitionDurationMs?: number;
      nextMediaId?: number }
```
Provider state: `content: LiveContent | null` (one item live at a time — matches today), `serviceBackground: BackgroundSnapshot | null` (Phase 3 feeds it; null until then), `itemBackground: BackgroundSnapshot | null` carried on setLive (Phase 3). `buildPayload()` maps content → its channel, background = `itemBackground ?? serviceBackground ?? null` (z0 derivation lives HERE — one place). Keep `isLive(kind,...)` signature compatibility by deriving from content. Media playback patches operate on whichever of media/presentation is live.

### Task 2.3: Show-pane call sites (`features/show/show-pane.tsx`)

Every `setLive({kind: "media", ...})` where the item is a presentation (`playback != null` / `isPresentation`) becomes `channel: "presentation"` with its transition + nextMediaId fields; plain media items → `channel: "media"`; song/bible → `channel: "slide"`. Auto-advance + navigators + uniform-fit effect re-point at the new shape (fontSizeOverride lives on the slide channel only).

### Task 2.4: Output window + preview parity + BackgroundView

- Create `features/backgrounds/background-view.tsx`: renders a `BackgroundSnapshot` — engine `gradflow` → `<GradFlow config={parsed}/>` (parse errors → black; unknown engine → black). Used by output, preview tiles, and later the library/editor.
- `routes/output.$displayId.tsx` composite, bottom-up:
  ```
  z0: show_media ? (slot.media ? DualLayerMediaCanvas : slot.background ? BackgroundView : black) : black
  z1: OverlayLayer (show_overlay)            [cover_slide rule unchanged]
  z2: LiveTemplateView for slot.slide        (show_song/show_bible by slide.kind)
  z3: presentation media via DualLayerMediaCanvas (show_media)
  ```
  Background unmounts when an opaque cover sits above it (presentation live, or media in cover mode) — no invisible WebGL.
- `features/displays/display-preview-pane.tsx`: identical gating/order (parity).

VERIFY(go) + VERIFY(frontend). Manual: song/bible/media/presentation go-live all behave exactly as before (background channel still always null).

**CHECKPOINT B — STOP.**

---

## Phase 3 — Derivation, Esc semantics, schedule UI

### Task 3.1: Seeds (minimal) + resolution

- Create `features/backgrounds/presets.ts`: the four grayscale seeds with negative ids and first-pass gradflow configs (tuned in sub-project 3):
  `-9001 Godrays (stripe)`, `-9002 Sand (smoke, high noise)`, `-9003 Silk (silk)`, `-9004 Mist (smoke, low noise)` — all three colors grayscale, slow speeds.
- Create `features/backgrounds/resolve.ts`:
  ```ts
  resolveBackgroundId(item, section, service): number | null   // item ?? section ?? service ?? null
  snapshotFor(id, dbRows): BackgroundSnapshot | null           // negative → seed, positive → row, missing → null
  ```
  Pure functions. Add vitest (devDep + `"test": "vitest run"`) with cases: item wins, section fallback, service fallback, null chain, deleted-row → null, seed resolution.

### Task 3.2: Wiring derivation

- Service bridge: in `_app.index.tsx` (or a small `LiveBackgroundBridge` component), watch `activeServiceId` → query service row → `setServiceBackground(snapshotFor(row.background_id))` into LiveProvider. Updates mid-live re-push automatically (payload effect).
- Item/section override: show-pane stamps `itemBackground: snapshotFor(resolveBackgroundId(...))` on setLive — the items query rows now carry `background_id` + `section_background_id` (Task 1.2).
- Esc (`clearLive`): clears `content` + `itemBackground` only — `serviceBackground` persists, so the resting state is the service default. Full blackout stays Go Offline.

### Task 3.3: Pinned "Defaults" section + chips

- `features/schedule/defaults-section.tsx`: virtual section pinned above real sections in the schedule pane — not a DB row, non-deletable/non-sortable by construction. One row: **Background** — name + mini `BackgroundView` thumbnail of the resolved service default; click opens a picker (popover listing seeds + DB rows + "None"); writes `Schedule.SetServiceBackground`.
- Section headers + item rows: background chip (small swatch) when an override is set; assignment via the existing edit affordances (section header menu, item edit dialog) using the same picker component; "Inherit" clears.
- Live-state correctness: changing any background while live re-derives + re-pushes (bridge/query invalidation handles service; item changes re-stamp on next setLive — acceptable; note in checkpoint).

VERIFY(go) + VERIFY(frontend) + `pnpm test`. Manual: set service default → goes live as resting background; configure per-song background → song click swaps z0 + lyrics on z2; Esc → lyrics drop, default background returns; presentation covers everything, Esc reveals what was beneath.

**CHECKPOINT C — STOP.** Sub-project 2 complete; sub-project 3 (real presets, library tab, editor surface) plans next.
