// library-sync.ts
//
// Cloud-library sync engine for the desktop app.
//
//   * Push: every local mutation (song / template / presentation create,
//     update, delete) is serialized into the shape `library_items.body`
//     expects and POSTed to the Railway server. Server upserts by
//     (user_id, kind, body.local_id) or a known cloud_id.
//
//   * Pull: periodic GET against the same endpoint pulls cloud rows down
//     and applies them to local sqlite. Incremental via `since=` filter.
//     Conflict resolution: last-write-wins by updated_at.
//
//   * Mapping: cloud rows have UUID ids, local rows have INTEGER
//     autoincrement ids. We keep a localStorage-backed bidirectional map
//     (cloud_id ↔ local_id) per kind so both sides can look up the other
//     without a server round-trip. Phase-X future work promotes this map
//     into sqlite columns on song / template / presentation.
//
//   * Outbox: any push that fails (network error, 5xx) is appended to a
//     localStorage outbox and replayed on the next online event +
//     periodic flush. Lets the user keep editing offline without losing
//     work; the moment connectivity returns, the queue drains.
//
//   * Versioning: every body carries `schema_version`. Bump when shape
//     changes; server keeps old rows readable and migrates on read.

import { api } from "./api-client"
import type { SongFull } from "@/bindings/neoprojector/services/songs"
import type { Template, Presentation } from "@/bindings/neoprojector/database"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type LibraryKind = "song" | "template" | "presentation"

const SCHEMA_VERSION = 1

type SongBody = {
  schema_version: 1
  local_id: number
  kind: "song"
  title: string
  created_at: string
  updated_at: string
  sections: Array<{
    type: string
    position: number
    lines: Array<{ position: number; text: string }>
  }>
}

type TemplateBody = {
  schema_version: 1
  local_id: number
  kind: "template"
  name: string
  template_kind: string
  viewport_w: number
  viewport_h: number
  data: unknown
  updated_at: string
}

type PresentationBody = {
  schema_version: 1
  local_id: number
  kind: "presentation"
  name: string
  loop: boolean
  interval_ms: number
  transition_kind: string
  transition_duration_ms: number
  slide_count: number
  updated_at: string
}

type AnyBody = SongBody | TemplateBody | PresentationBody

// ---------------------------------------------------------------------------
// Log buffer — ring of structured events surfaced to the Settings panel
// for live debugging. Cheap (~200 entries kept). Each entry carries level,
// kind, op, status, ms, and a freeform message so the UI can colour-code
// and filter without parsing strings.
// ---------------------------------------------------------------------------
export type SyncLogLevel = "info" | "ok" | "warn" | "err"
export type SyncLogEntry = {
  id: number
  t: number // epoch ms
  level: SyncLogLevel
  msg: string
  kind?: LibraryKind | "engine" | "outbox" | "pull" | "push"
  op?: "push" | "pull" | "delete" | "flush" | "tick" | "boot" | "force"
  status?: number
  duration_ms?: number
  meta?: Record<string, unknown>
}

const LOG_CAP = 200
let logSeq = 0
const logBuf: SyncLogEntry[] = []
const logSubscribers = new Set<(entries: readonly SyncLogEntry[]) => void>()

function pushLog(entry: Omit<SyncLogEntry, "id" | "t">): void {
  const full: SyncLogEntry = { id: ++logSeq, t: Date.now(), ...entry }
  logBuf.push(full)
  if (logBuf.length > LOG_CAP) logBuf.splice(0, logBuf.length - LOG_CAP)
  for (const cb of logSubscribers) {
    try {
      cb(logBuf)
    } catch {
      /* one bad subscriber must not break the rest */
    }
  }
}

export function getSyncLog(): readonly SyncLogEntry[] {
  return logBuf
}

export function subscribeSyncLog(cb: (entries: readonly SyncLogEntry[]) => void): () => void {
  logSubscribers.add(cb)
  // Fire once so the subscriber gets the current buffer state without
  // waiting for the next event.
  cb(logBuf)
  return () => {
    logSubscribers.delete(cb)
  }
}

export function clearSyncLog(): void {
  logBuf.length = 0
  for (const cb of logSubscribers) {
    try {
      cb(logBuf)
    } catch {
      /* noop */
    }
  }
}

// ---------------------------------------------------------------------------
// Bidirectional localStorage mapping. Keys:
//   np.libsync.cloudid:<kind>:<local_id>   → cloud_id
//   np.libsync.localid:<kind>:<cloud_id>   → local_id
// Maintained in lock-step by setMapping. Phase 2 promotes these to sqlite.
// ---------------------------------------------------------------------------
const FWD_PREFIX = "np.libsync.cloudid:"
const REV_PREFIX = "np.libsync.localid:"

function fwdKey(kind: LibraryKind, localId: number): string {
  return `${FWD_PREFIX}${kind}:${localId}`
}
function revKey(kind: LibraryKind, cloudId: string): string {
  return `${REV_PREFIX}${kind}:${cloudId}`
}

export function getCloudId(kind: LibraryKind, localId: number): string | undefined {
  try {
    return localStorage.getItem(fwdKey(kind, localId)) ?? undefined
  } catch {
    return undefined
  }
}

function getLocalId(kind: LibraryKind, cloudId: string): number | undefined {
  try {
    const raw = localStorage.getItem(revKey(kind, cloudId))
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

function setMapping(kind: LibraryKind, localId: number, cloudId: string): void {
  try {
    localStorage.setItem(fwdKey(kind, localId), cloudId)
    localStorage.setItem(revKey(kind, cloudId), String(localId))
  } catch {
    /* private browsing / quota — non-fatal */
  }
}

function clearMapping(kind: LibraryKind, localId: number): void {
  try {
    const cloudId = localStorage.getItem(fwdKey(kind, localId))
    localStorage.removeItem(fwdKey(kind, localId))
    if (cloudId) localStorage.removeItem(revKey(kind, cloudId))
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// Body builders. Pure functions of the local entity. Kept private to this
// module so the wire shape can change without rippling out.
// ---------------------------------------------------------------------------
function buildSongBody(full: SongFull): SongBody {
  return {
    schema_version: SCHEMA_VERSION,
    local_id: full.song.id,
    kind: "song",
    title: full.song.title,
    created_at: full.song.created_at,
    updated_at: full.song.updated_at,
    sections: full.sections.map((sec) => ({
      type: sec.section.type,
      position: sec.section.position,
      lines: sec.lines
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((l) => ({ position: l.position, text: l.text })),
    })),
  }
}

function buildTemplateBody(t: Template): TemplateBody {
  let parsed: unknown = {}
  try {
    parsed = t.data_json ? JSON.parse(t.data_json) : {}
  } catch {
    parsed = { _raw: t.data_json }
  }
  return {
    schema_version: SCHEMA_VERSION,
    local_id: t.id,
    kind: "template",
    name: t.name,
    template_kind: t.kind,
    viewport_w: t.viewport_w,
    viewport_h: t.viewport_h,
    data: parsed,
    updated_at: t.updated_at,
  }
}

function buildPresentationBody(p: Presentation, slideCount: number): PresentationBody {
  return {
    schema_version: SCHEMA_VERSION,
    local_id: p.id,
    kind: "presentation",
    name: p.name,
    loop: !!p.loop,
    interval_ms: p.interval_ms,
    transition_kind: p.transition_kind,
    transition_duration_ms: p.transition_duration_ms,
    slide_count: slideCount,
    updated_at: p.updated_at,
  }
}

function approxBytes(obj: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Outbox — survives reloads, drains on connectivity restore.
// Each entry is a serialized intent: either "upsert" or "delete".
// ---------------------------------------------------------------------------
const OUTBOX_KEY = "np.libsync.outbox"

type OutboxEntry =
  | {
      op: "upsert"
      kind: LibraryKind
      local_id: number
      title: string
      size_bytes: number
      body: Record<string, unknown>
      cloud_id?: string
      updated_at?: string
      enqueued_at: number
      attempts: number
    }
  | {
      op: "delete"
      kind: LibraryKind
      local_id: number
      cloud_id: string
      enqueued_at: number
      attempts: number
    }

function readOutbox(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeOutbox(entries: OutboxEntry[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries))
  } catch {
    /* quota — drop oldest, retry once */
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries.slice(-50)))
    } catch {
      /* give up */
    }
  }
}

function enqueueOutbox(entry: Omit<OutboxEntry, "enqueued_at" | "attempts">): void {
  const entries = readOutbox()
  // Dedupe by (op, kind, local_id) — latest wins. A delete supersedes any
  // pending upsert for the same row.
  const filtered = entries.filter(
    (e) => !(e.kind === entry.kind && e.local_id === entry.local_id),
  )
  filtered.push({ ...(entry as OutboxEntry), enqueued_at: Date.now(), attempts: 0 })
  writeOutbox(filtered)
}

async function flushOutbox(): Promise<{ ok: number; fail: number; remaining: number }> {
  const entries = readOutbox()
  if (!entries.length) return { ok: 0, fail: 0, remaining: 0 }
  const started = Date.now()
  let ok = 0
  let fail = 0
  const survivors: OutboxEntry[] = []
  for (const entry of entries) {
    try {
      if (entry.op === "upsert") {
        const { item } = await api.libraryUpsert({
          cloud_id: entry.cloud_id,
          kind: entry.kind,
          title: entry.title,
          size_bytes: entry.size_bytes,
          body: entry.body,
          updated_at: entry.updated_at,
        })
        setMapping(entry.kind, entry.local_id, item.id)
        ok++
      } else {
        await api.libraryDelete(entry.cloud_id)
        clearMapping(entry.kind, entry.local_id)
        ok++
      }
    } catch (err) {
      fail++
      // Cap attempts so a permanently-bad entry can't poison the queue.
      const attempts = (entry.attempts ?? 0) + 1
      if (attempts < 10) {
        survivors.push({ ...entry, attempts })
      } else {
        console.warn("[library-sync] dropping outbox entry after 10 attempts", entry, err)
        pushLog({
          level: "err",
          kind: "outbox",
          op: "flush",
          msg: `dropped ${entry.op} ${entry.kind}#${entry.local_id} after 10 attempts`,
          meta: { entry, error: (err as Error)?.message },
        })
      }
    }
  }
  writeOutbox(survivors)
  pushLog({
    level: fail > 0 ? "warn" : "ok",
    kind: "outbox",
    op: "flush",
    duration_ms: Date.now() - started,
    msg: `outbox flush: ok=${ok} fail=${fail} remaining=${survivors.length}`,
  })
  return { ok, fail, remaining: survivors.length }
}

// ---------------------------------------------------------------------------
// Public push API — one entry point per kind. Returns a result so callers
// that care can surface "synced" vs "queued offline" toasts. Never throws.
// ---------------------------------------------------------------------------
export type SyncResult =
  | { ok: true; cloud_id: string; created: boolean; queued?: false }
  | { ok: true; cloud_id: ""; created: false; queued: true }
  | { ok: false; error: string }

async function pushGeneric(
  kind: LibraryKind,
  localId: number,
  title: string,
  body: AnyBody,
): Promise<SyncResult> {
  const cloud_id = getCloudId(kind, localId)
  const payload = {
    cloud_id,
    kind,
    title,
    size_bytes: approxBytes(body),
    body: body as unknown as Record<string, unknown>,
    updated_at: (body as { updated_at?: string }).updated_at,
  }
  const started = Date.now()
  try {
    const { item, created } = await api.libraryUpsert(payload)
    setMapping(kind, localId, item.id)
    pushLog({
      level: "ok",
      kind,
      op: "push",
      status: 200,
      duration_ms: Date.now() - started,
      msg: `push ${kind}#${localId} → ${created ? "created" : "updated"} (${item.id.slice(0, 8)}…)`,
      meta: { cloud_id: item.id, size_bytes: payload.size_bytes, title },
    })
    return { ok: true, cloud_id: item.id, created }
  } catch (err) {
    const httpStatus =
      typeof (err as { status?: number })?.status === "number"
        ? (err as { status: number }).status
        : undefined
    pushLog({
      level: "warn",
      kind,
      op: "push",
      status: httpStatus,
      duration_ms: Date.now() - started,
      msg: `push ${kind}#${localId} failed → outbox (${(err as Error)?.message ?? "unknown"})`,
      meta: { error: (err as Error)?.message, body_error: (err as { body?: unknown })?.body },
    })
    console.warn(`[library-sync] push ${kind}#${localId} failed → outbox`, err)
    enqueueOutbox({
      op: "upsert",
      kind,
      local_id: localId,
      title: payload.title,
      size_bytes: payload.size_bytes,
      body: payload.body,
      cloud_id: payload.cloud_id,
      updated_at: payload.updated_at,
    })
    return { ok: true, cloud_id: "", created: false, queued: true }
  }
}

async function deleteGeneric(kind: LibraryKind, localId: number): Promise<SyncResult> {
  const cloud_id = getCloudId(kind, localId)
  if (!cloud_id) {
    pushLog({
      level: "info",
      kind,
      op: "delete",
      msg: `delete ${kind}#${localId}: no cloud mapping, skipped`,
    })
    return { ok: true, cloud_id: "", created: false, queued: true }
  }
  const started = Date.now()
  try {
    await api.libraryDelete(cloud_id)
    clearMapping(kind, localId)
    pushLog({
      level: "ok",
      kind,
      op: "delete",
      status: 200,
      duration_ms: Date.now() - started,
      msg: `delete ${kind}#${localId} → cloud removed (${cloud_id.slice(0, 8)}…)`,
    })
    return { ok: true, cloud_id, created: false }
  } catch (err) {
    pushLog({
      level: "warn",
      kind,
      op: "delete",
      duration_ms: Date.now() - started,
      msg: `delete ${kind}#${localId} failed → outbox`,
      meta: { error: (err as Error)?.message },
    })
    console.warn(`[library-sync] delete ${kind}#${localId} failed → outbox`, err)
    enqueueOutbox({
      op: "delete",
      kind,
      local_id: localId,
      cloud_id,
    })
    return { ok: true, cloud_id: "", created: false, queued: true }
  }
}

export function pushSong(full: SongFull): Promise<SyncResult> {
  if (!full?.song?.id) return Promise.resolve({ ok: false, error: "no_local_id" })
  return pushGeneric("song", full.song.id, full.song.title || "Untitled", buildSongBody(full))
}

export function removeSong(localId: number): Promise<SyncResult> {
  return deleteGeneric("song", localId)
}

export function pushTemplate(t: Template): Promise<SyncResult> {
  return pushGeneric("template", t.id, t.name || "Untitled template", buildTemplateBody(t))
}

export function removeTemplate(localId: number): Promise<SyncResult> {
  return deleteGeneric("template", localId)
}

export async function pushPresentation(
  p: Presentation,
  slideCount?: number,
): Promise<SyncResult> {
  let count = slideCount ?? 0
  if (slideCount === undefined) {
    try {
      const { Service: Presentations } = await import(
        "@/bindings/neoprojector/services/presentations"
      )
      const slides = (await Presentations.ListSlides(p.id)) as unknown as unknown[]
      count = slides.length
    } catch {
      count = 0
    }
  }
  return pushGeneric(
    "presentation",
    p.id,
    p.name || "Untitled presentation",
    buildPresentationBody(p, count),
  )
}

export function removePresentation(localId: number): Promise<SyncResult> {
  return deleteGeneric("presentation", localId)
}

// ---------------------------------------------------------------------------
// Pull — cloud → app. Compares local vs cloud by (cloud_id mapping, then
// updated_at) and applies the newer side. We never delete local rows from
// pull alone (no tombstones yet); explicit removals only propagate via the
// originating client's push.
// ---------------------------------------------------------------------------
function rebuildSongTextFromBody(sec: SongBody["sections"][number]): string {
  return sec.lines
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((l) => l.text)
    .join("\n")
}

async function pullSongs(): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0
  let updated = 0
  let skipped = 0

  let resp: Awaited<ReturnType<typeof api.libraryList>>
  try {
    resp = await api.libraryList({ kind: "song" })
  } catch (err) {
    console.warn("[library-sync] pullSongs list failed", err)
    return { created, updated, skipped }
  }

  const { Service: Songs, SongSpec } = await import("@/bindings/neoprojector/services/songs")

  for (const cloud of resp.items) {
    if (cloud.kind !== "song") continue
    const body = cloud.body as Partial<SongBody>
    if (!body || !Array.isArray(body.sections)) {
      skipped++
      continue
    }
    const spec = new SongSpec({
      title: body.title || cloud.title || "Untitled",
      sections: body.sections
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          type: s.type,
          text: rebuildSongTextFromBody(s),
        })),
    })

    let localId = getLocalId("song", cloud.id)

    // If we don't have a forward mapping, try matching by local_id stamped
    // in the cloud body (this machine may have pushed it before).
    if (localId === undefined && typeof body.local_id === "number") {
      const candidate = body.local_id
      try {
        const probe = await Songs.SongByID(candidate)
        if (probe?.id === candidate) {
          localId = candidate
          setMapping("song", localId, cloud.id)
        }
      } catch {
        /* row doesn't exist locally — fall through to create */
      }
    }

    if (localId === undefined) {
      try {
        const createdRow = (await Songs.CreateSongFromSpec(spec)) as unknown as {
          id: number
        }
        setMapping("song", createdRow.id, cloud.id)
        created++
      } catch (err) {
        console.warn("[library-sync] pull-create song failed", cloud.id, err)
        skipped++
      }
      continue
    }

    // Have a local row. Decide who wins by updated_at.
    try {
      const local = await Songs.SongByID(localId)
      const localTs = Date.parse(local.updated_at ?? "") || 0
      const cloudTs = Date.parse(cloud.updated_at ?? "") || 0
      if (cloudTs > localTs) {
        await Songs.UpdateSongFromSpec(localId, spec)
        updated++
      } else {
        skipped++
      }
    } catch (err) {
      console.warn("[library-sync] pull-update song failed", localId, err)
      skipped++
    }
  }

  return { created, updated, skipped }
}

// Phase-3 pull stubs. Templates can be fully reconstructed from body; for
// presentations the slide list is intentionally not pulled (depends on
// media sync — phase 6+).
async function pullTemplates(): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0
  let updated = 0
  let skipped = 0
  let resp: Awaited<ReturnType<typeof api.libraryList>>
  try {
    resp = await api.libraryList({ kind: "template" })
  } catch (err) {
    console.warn("[library-sync] pullTemplates list failed", err)
    return { created, updated, skipped }
  }
  const { Service: Templates } = await import("@/bindings/neoprojector/services/templates")

  for (const cloud of resp.items) {
    if (cloud.kind !== "template") continue
    const body = cloud.body as Partial<TemplateBody>
    if (!body || typeof body.name !== "string") {
      skipped++
      continue
    }
    const dataJSON =
      body.data === undefined ? "{}" : (() => {
        try {
          return JSON.stringify(body.data)
        } catch {
          return "{}"
        }
      })()

    let localId = getLocalId("template", cloud.id)
    if (localId === undefined && typeof body.local_id === "number") {
      try {
        const probe = await Templates.TemplateByID(body.local_id)
        if (probe?.id === body.local_id) {
          localId = body.local_id
          setMapping("template", localId, cloud.id)
        }
      } catch {
        /* fall through */
      }
    }

    if (localId === undefined) {
      try {
        const createdRow = (await Templates.CreateTemplate(
          body.name,
          body.template_kind ?? "general",
          body.viewport_w ?? 1920,
          body.viewport_h ?? 1080,
          dataJSON,
        )) as unknown as { id: number }
        setMapping("template", createdRow.id, cloud.id)
        created++
      } catch (err) {
        console.warn("[library-sync] pull-create template failed", cloud.id, err)
        skipped++
      }
      continue
    }

    try {
      const local = await Templates.TemplateByID(localId)
      const localTs = Date.parse(local.updated_at ?? "") || 0
      const cloudTs = Date.parse(cloud.updated_at ?? "") || 0
      if (cloudTs > localTs) {
        await Templates.UpdateTemplate(
          localId,
          body.name,
          body.template_kind ?? local.kind,
          body.viewport_w ?? local.viewport_w,
          body.viewport_h ?? local.viewport_h,
          dataJSON,
        )
        updated++
      } else {
        skipped++
      }
    } catch (err) {
      console.warn("[library-sync] pull-update template failed", localId, err)
      skipped++
    }
  }

  return { created, updated, skipped }
}

async function pullPresentations(): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0
  let updated = 0
  let skipped = 0
  let resp: Awaited<ReturnType<typeof api.libraryList>>
  try {
    resp = await api.libraryList({ kind: "presentation" })
  } catch (err) {
    console.warn("[library-sync] pullPresentations list failed", err)
    return { created, updated, skipped }
  }
  const { Service: Presentations } = await import(
    "@/bindings/neoprojector/services/presentations"
  )

  for (const cloud of resp.items) {
    if (cloud.kind !== "presentation") continue
    const body = cloud.body as Partial<PresentationBody>
    if (!body || typeof body.name !== "string") {
      skipped++
      continue
    }
    let localId = getLocalId("presentation", cloud.id)
    if (localId === undefined && typeof body.local_id === "number") {
      try {
        const probe = await Presentations.PresentationByID(body.local_id)
        if (probe?.id === body.local_id) {
          localId = body.local_id
          setMapping("presentation", localId, cloud.id)
        }
      } catch {
        /* fall through */
      }
    }

    if (localId === undefined) {
      try {
        const createdRow = (await Presentations.CreatePresentation(
          body.name,
        )) as unknown as { id: number }
        // Apply playback after create so the new row matches cloud state.
        const { PlaybackSettings } = await import(
          "@/bindings/neoprojector/services/presentations"
        )
        await Presentations.UpdatePlayback(
          createdRow.id,
          new PlaybackSettings({
            loop: !!body.loop,
            interval_ms: body.interval_ms ?? 5000,
            transition_kind: body.transition_kind ?? "fade",
            transition_duration_ms: body.transition_duration_ms ?? 300,
          }),
        )
        setMapping("presentation", createdRow.id, cloud.id)
        created++
      } catch (err) {
        console.warn("[library-sync] pull-create presentation failed", cloud.id, err)
        skipped++
      }
      continue
    }

    try {
      const local = await Presentations.PresentationByID(localId)
      const localTs = Date.parse(local.updated_at ?? "") || 0
      const cloudTs = Date.parse(cloud.updated_at ?? "") || 0
      if (cloudTs > localTs) {
        if (local.name !== body.name) {
          await Presentations.RenamePresentation(localId, body.name)
        }
        const { PlaybackSettings } = await import(
          "@/bindings/neoprojector/services/presentations"
        )
        await Presentations.UpdatePlayback(
          localId,
          new PlaybackSettings({
            loop: !!body.loop,
            interval_ms: body.interval_ms ?? local.interval_ms,
            transition_kind: body.transition_kind ?? local.transition_kind,
            transition_duration_ms:
              body.transition_duration_ms ?? local.transition_duration_ms,
          }),
        )
        updated++
      } else {
        skipped++
      }
    } catch (err) {
      console.warn("[library-sync] pull-update presentation failed", localId, err)
      skipped++
    }
  }

  return { created, updated, skipped }
}

// ---------------------------------------------------------------------------
// Boot-time backfill + periodic loop. Idempotent.
// ---------------------------------------------------------------------------
const BOOT_FLAG_KEY = "np.libsync.boot.run"

export async function syncAllOnce(): Promise<{
  pushed: number
  pulled: number
  outbox_drained: number
  outbox_remaining: number
}> {
  let pushed = 0
  let pulled = 0
  if (typeof sessionStorage !== "undefined") {
    if (sessionStorage.getItem(BOOT_FLAG_KEY) !== "1") {
      sessionStorage.setItem(BOOT_FLAG_KEY, "1")
      pushed += await backfillLocalSongs()
      pushed += await backfillLocalTemplates()
      pushed += await backfillLocalPresentations()
    }
  }

  // Drain outbox before pulling, so any locally-queued state lands on the
  // cloud first and we don't redundantly download what we just pushed.
  const drained = await flushOutbox()

  const s = await pullSongs()
  const t = await pullTemplates()
  const p = await pullPresentations()
  pulled = s.created + s.updated + t.created + t.updated + p.created + p.updated

  return {
    pushed,
    pulled,
    outbox_drained: drained.ok,
    outbox_remaining: drained.remaining,
  }
}

async function backfillLocalSongs(): Promise<number> {
  let pushed = 0
  try {
    const { Service: Songs } = await import("@/bindings/neoprojector/services/songs")
    const list = (await Songs.ListSongs()) as unknown as Array<{ id: number }>
    for (const s of list) {
      if (getCloudId("song", s.id)) continue
      try {
        const full = (await Songs.GetSong(s.id)) as unknown as SongFull
        const res = await pushSong(full)
        if (res.ok) pushed++
      } catch (err) {
        console.warn("[library-sync] backfill song failed", s.id, err)
      }
    }
  } catch (err) {
    console.warn("[library-sync] backfill songs list failed", err)
  }
  return pushed
}

async function backfillLocalTemplates(): Promise<number> {
  let pushed = 0
  try {
    const { Service: Templates } = await import("@/bindings/neoprojector/services/templates")
    const list = (await Templates.ListTemplates()) as unknown as Template[]
    for (const t of list) {
      if (getCloudId("template", t.id)) continue
      const res = await pushTemplate(t)
      if (res.ok) pushed++
    }
  } catch (err) {
    console.warn("[library-sync] backfill templates list failed", err)
  }
  return pushed
}

async function backfillLocalPresentations(): Promise<number> {
  let pushed = 0
  try {
    const { Service: Presentations } = await import(
      "@/bindings/neoprojector/services/presentations"
    )
    const list = (await Presentations.ListPresentations()) as unknown as Presentation[]
    for (const p of list) {
      if (getCloudId("presentation", p.id)) continue
      const res = await pushPresentation(p)
      if (res.ok) pushed++
    }
  } catch (err) {
    console.warn("[library-sync] backfill presentations list failed", err)
  }
  return pushed
}

// ---------------------------------------------------------------------------
// Auto-push toggle. When enabled (default), the engine periodically runs
// `forcePushAll` so the cloud library mirrors local state even if the
// user has been editing offline, or the mapping localStorage got cleared,
// or some mutation slipped past the push hooks. When disabled, only
// explicit per-mutation pushes happen.
// ---------------------------------------------------------------------------
const AUTOPUSH_KEY = "np.libsync.autopush.enabled"
const AUTOPUSH_DEFAULT = true

export function isAutoPushEnabled(): boolean {
  try {
    const raw = localStorage.getItem(AUTOPUSH_KEY)
    if (raw === null) return AUTOPUSH_DEFAULT
    return raw === "1" || raw === "true"
  } catch {
    return AUTOPUSH_DEFAULT
  }
}

export function setAutoPushEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOPUSH_KEY, enabled ? "1" : "0")
    // Notify any listeners (settings UI re-renders, engine re-checks).
    window.dispatchEvent(new CustomEvent("np-libsync-autopush-changed"))
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// Periodic engine. Caller (routes/_app.tsx) invokes `startSyncEngine` once
// the user is authenticated; the engine returns a teardown function for
// React cleanup on unmount / sign-out.
// ---------------------------------------------------------------------------
const PULL_INTERVAL_MS = 60_000
const OUTBOX_RETRY_MS = 15_000
const AUTOPUSH_INTERVAL_MS = 5 * 60_000

export function startSyncEngine(
  onTick?: (summary: { pulled: number; pushed: number; outbox: number }) => void,
): () => void {
  let stopped = false

  pushLog({ level: "info", kind: "engine", op: "boot", msg: "engine started" })

  void syncAllOnce().then((r) => {
    pushLog({
      level: "info",
      kind: "engine",
      op: "boot",
      msg: `boot sync: pushed=${r.pushed} pulled=${r.pulled} outbox=${r.outbox_remaining}`,
    })
    onTick?.({ pulled: r.pulled, pushed: r.pushed, outbox: r.outbox_remaining })
  })

  const pullId = setInterval(async () => {
    if (stopped) return
    const started = Date.now()
    try {
      const s = await pullSongs()
      const t = await pullTemplates()
      const p = await pullPresentations()
      const pulled =
        s.created + s.updated + t.created + t.updated + p.created + p.updated
      if (pulled > 0) {
        pushLog({
          level: "ok",
          kind: "pull",
          op: "tick",
          duration_ms: Date.now() - started,
          msg: `pull: songs ${s.created}c/${s.updated}u, templates ${t.created}c/${t.updated}u, presentations ${p.created}c/${p.updated}u`,
        })
      }
      const summary = { pulled, pushed: 0, outbox: readOutbox().length }
      if (summary.pulled > 0 || summary.outbox > 0) onTick?.(summary)
    } catch (err) {
      pushLog({
        level: "err",
        kind: "pull",
        op: "tick",
        msg: `pull tick failed: ${(err as Error)?.message}`,
      })
      console.warn("[library-sync] pull tick failed", err)
    }
  }, PULL_INTERVAL_MS)

  const outboxId = setInterval(async () => {
    if (stopped) return
    if (!readOutbox().length) return
    const r = await flushOutbox()
    if (r.ok > 0) onTick?.({ pulled: 0, pushed: r.ok, outbox: r.remaining })
  }, OUTBOX_RETRY_MS)

  // Auto-push tick. Re-uploads the entire local library on a slow cadence
  // so out-of-band local edits (DB direct write, plugin, etc.) eventually
  // reach the cloud even without an in-app mutation. Toggle lives in
  // localStorage and is settable from the Cloud-sync settings panel.
  const autoPushId = setInterval(async () => {
    if (stopped) return
    if (!isAutoPushEnabled()) return
    const started = Date.now()
    try {
      const r = await forcePushAll()
      const pushed = r.songs.ok + r.templates.ok + r.presentations.ok
      pushLog({
        level: pushed > 0 ? "ok" : "info",
        kind: "push",
        op: "tick",
        duration_ms: Date.now() - started,
        msg: `auto-push: songs ${r.songs.ok}/${r.songs.attempted}, templates ${r.templates.ok}/${r.templates.attempted}, presentations ${r.presentations.ok}/${r.presentations.attempted}`,
      })
      if (pushed > 0) onTick?.({ pulled: 0, pushed, outbox: r.outbox_remaining })
    } catch (err) {
      pushLog({
        level: "err",
        kind: "push",
        op: "tick",
        msg: `auto-push tick failed: ${(err as Error)?.message}`,
      })
      console.warn("[library-sync] auto-push tick failed", err)
    }
  }, AUTOPUSH_INTERVAL_MS)

  const onOnline = () => {
    void flushOutbox().then((r) => {
      if (r.ok > 0) onTick?.({ pulled: 0, pushed: r.ok, outbox: r.remaining })
    })
  }
  const onVisible = () => {
    if (document.visibilityState === "visible") onOnline()
  }
  window.addEventListener("online", onOnline)
  document.addEventListener("visibilitychange", onVisible)

  return () => {
    stopped = true
    clearInterval(pullId)
    clearInterval(outboxId)
    clearInterval(autoPushId)
    window.removeEventListener("online", onOnline)
    document.removeEventListener("visibilitychange", onVisible)
  }
}

// ---------------------------------------------------------------------------
// Manual "push everything now" — bypasses the cloud_id skip in backfill so
// the user can force a clean re-upload from Settings. Useful when: clocks
// drifted, mapping got corrupted, or the user just wants visual confirmation
// that the dashboard matches local state right now.
//
// Reports per-kind counts so the UI can render "Pushed X songs, Y templates,
// Z presentations" instead of an opaque success toast.
// ---------------------------------------------------------------------------
export type ForcePushReport = {
  songs: { attempted: number; ok: number; queued: number; failed: number }
  templates: { attempted: number; ok: number; queued: number; failed: number }
  presentations: { attempted: number; ok: number; queued: number; failed: number }
  outbox_remaining: number
}

export async function forcePushAll(
  onProgress?: (info: { kind: LibraryKind; done: number; total: number }) => void,
): Promise<ForcePushReport> {
  const out: ForcePushReport = {
    songs: { attempted: 0, ok: 0, queued: 0, failed: 0 },
    templates: { attempted: 0, ok: 0, queued: 0, failed: 0 },
    presentations: { attempted: 0, ok: 0, queued: 0, failed: 0 },
    outbox_remaining: 0,
  }

  // Songs
  try {
    const { Service: Songs } = await import("@/bindings/neoprojector/services/songs")
    const list = (await Songs.ListSongs()) as unknown as Array<{ id: number }>
    out.songs.attempted = list.length
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      try {
        const full = (await Songs.GetSong(s.id)) as unknown as SongFull
        const res = await pushSong(full)
        if (!res.ok) out.songs.failed++
        else if (res.queued) out.songs.queued++
        else out.songs.ok++
      } catch {
        out.songs.failed++
      }
      onProgress?.({ kind: "song", done: i + 1, total: list.length })
    }
  } catch (err) {
    console.warn("[library-sync] forcePushAll songs failed", err)
  }

  // Templates
  try {
    const { Service: Templates } = await import("@/bindings/neoprojector/services/templates")
    const list = (await Templates.ListTemplates()) as unknown as Template[]
    out.templates.attempted = list.length
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      const res = await pushTemplate(t)
      if (!res.ok) out.templates.failed++
      else if (res.queued) out.templates.queued++
      else out.templates.ok++
      onProgress?.({ kind: "template", done: i + 1, total: list.length })
    }
  } catch (err) {
    console.warn("[library-sync] forcePushAll templates failed", err)
  }

  // Presentations
  try {
    const { Service: Presentations } = await import(
      "@/bindings/neoprojector/services/presentations"
    )
    const list = (await Presentations.ListPresentations()) as unknown as Presentation[]
    out.presentations.attempted = list.length
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      const res = await pushPresentation(p)
      if (!res.ok) out.presentations.failed++
      else if (res.queued) out.presentations.queued++
      else out.presentations.ok++
      onProgress?.({ kind: "presentation", done: i + 1, total: list.length })
    }
  } catch (err) {
    console.warn("[library-sync] forcePushAll presentations failed", err)
  }

  // Drain anything that got queued during the run.
  const drained = await flushOutbox()
  out.outbox_remaining = drained.remaining

  return out
}

// Legacy export kept so song-editor's existing import still resolves while
// other phases roll out. Internally equivalent to syncAllOnce for songs.
export const syncAllSongsOnce = syncAllOnce
