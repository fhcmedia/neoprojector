import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  CheckIcon,
  ChevronDownIcon,
  ImagePlusIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react"
import { Switch } from "@/components/switch"
import { Input } from "@/components/input"
import { useAuth } from "@/hooks/use-auth"
import { setWalkthroughRequested } from "@/features/walkthrough/walkthrough"
import logoDefault from "@/assets/logo.png"
import { useAnimations } from "@/hooks/use-animations"
import { useVimMode } from "@/hooks/use-vim-mode"
import {
  resolveServiceName,
  useServiceNameFormat,
  TOKEN_SPECS,
} from "@/hooks/use-service-name-format"
import { DisplaySettings } from "@/features/displays/display-pane"
import {
  useBypassDisplayCheck,
  useSetBypassDisplayCheck,
} from "@/features/displays/api"
import { useQuery } from "@tanstack/react-query"
import { Service as Bible } from "@/bindings/neoprojector/services/bible"
import type { Bible as BibleTranslation } from "@/bindings/neoprojector/database"
import { useBibleTranslations } from "@/hooks/use-bible-translations"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  forcePushAll,
  isAutoPushEnabled,
  setAutoPushEnabled,
  subscribeSyncLog,
  clearSyncLog,
  type ForcePushReport,
  type SyncLogEntry,
} from "@/lib/library-sync"
import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

export const Route = createFileRoute("/_app/settings")({
  component: Settings,
})

const sections = [
  { id: "general", label: "General" },
  { id: "branding", label: "Branding" },
  { id: "output", label: "Output" },
  { id: "display", label: "Display" },
  { id: "audio", label: "Audio" },
  { id: "bibles", label: "Bibles" },
  { id: "songs", label: "Songs" },
  { id: "cloud", label: "Cloud sync" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "advanced", label: "Advanced" },
] as const

type SectionId = (typeof sections)[number]["id"]

function SectionHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="border-b border-border/50 pb-4">
      <h2 className="text-sm font-medium tracking-tight">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="space-y-0.5">
        <div className="text-xs font-medium">{label}</div>
        {description && (
          <div className="text-[11px] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function AnimationsToggle() {
  const { enabled, setEnabled } = useAnimations()
  return (
    <Switch
      checked={enabled}
      onCheckedChange={setEnabled}
      aria-label="Toggle UI animations"
    />
  )
}

function VimModeToggle() {
  const { enabled, setEnabled } = useVimMode()
  return (
    <Switch
      checked={enabled}
      onCheckedChange={setEnabled}
      aria-label="Toggle vim navigation"
    />
  )
}

function ServiceNameFormatField() {
  const { format, setFormat } = useServiceNameFormat()
  const preview = useMemo(() => resolveServiceName(format), [format])
  return (
    <div className="space-y-2">
      <Input
        value={format}
        onChange={(e) => setFormat(e.target.value)}
        spellCheck={false}
        className="h-8 w-72 text-xs"
      />
      <div className="text-[11px] text-muted-foreground">
        Preview: <span className="font-medium text-foreground">{preview}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {TOKEN_SPECS.map((t) => (
          <button
            key={t.token}
            type="button"
            onClick={() => setFormat((format ? format + " " : "") + t.token)}
            title={`${t.label} — e.g. ${t.example}`}
            className="rounded border border-border/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            {t.token}
          </button>
        ))}
      </div>
    </div>
  )
}

function GeneralPanel() {
  return (
    <div className="divide-y divide-border/40">
      <Row
        label="UI animations"
        description="Subtle motion across the app. Disable for an instant, static interface."
      >
        <AnimationsToggle />
      </Row>
      <Row
        label="Vim navigation"
        description="Adds j/k for next/prev slide on top of the arrow keys. Esc still clears the live output either way."
      >
        <VimModeToggle />
      </Row>
      <div className="space-y-2 py-3">
        <div className="text-xs font-medium">Service name format</div>
        <div className="text-[11px] text-muted-foreground">
          Used when creating a new service. Click a token to insert it.
        </div>
        <div className="pt-1">
          <ServiceNameFormatField />
        </div>
      </div>
      <Row
        label="Workspace walkthrough"
        description="Re-run the guided tour of the workspace chrome (header, account, settings, go-live)."
      >
        <ReplayWalkthroughButton />
      </Row>
    </div>
  )
}

function ReplayWalkthroughButton() {
  // The tour only mounts on `_app` initial render and reads the
  // localStorage flag once. Setting the flag and navigating to "/"
  // forces a fresh _app render, which picks up the new flag and
  // launches the overlay.
  return (
    <button
      type="button"
      onClick={() => {
        setWalkthroughRequested(true)
        window.location.assign("/")
      }}
      className="rounded-md border border-border/60 px-3 py-1.5 text-xs hover:border-border hover:bg-muted/40"
    >
      Re-run tour
    </button>
  )
}

function OutputPanel() {
  const { data: bypass = false } = useBypassDisplayCheck()
  const setMut = useSetBypassDisplayCheck()

  return (
    <div className="divide-y divide-border/40">
      <Row
        label="Bypass display check"
        description="Allow Go Live even when no displays are enabled or bound to a monitor. Useful for testing on single-screen machines."
      >
        <Switch
          checked={bypass}
          onCheckedChange={(v) => setMut.mutate(v)}
          aria-label="Bypass display requirement"
        />
      </Row>
    </div>
  )
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="py-3 text-[11px] text-muted-foreground">
      {label} settings will live here.
    </div>
  )
}

// ---------------------------------------------------------------------------
// SyncLogViewer — live tail of every event the sync engine emits. Filters
// by level + kind, supports clear + pause. Shipped inside the Cloud-sync
// panel so the operator can see exactly what's happening during a sync.
// ---------------------------------------------------------------------------
function SyncLogViewer() {
  const [entries, setEntries] = useState<readonly SyncLogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [levelFilter, setLevelFilter] = useState<"all" | "warn-err" | "err">("all")
  const [kindFilter, setKindFilter] = useState<string>("all")
  const [expanded, setExpanded] = useState(true)
  // Hold a buffered snapshot while paused so the user can scroll without
  // entries jumping around as new events arrive in the background.
  const liveRef = useRef<readonly SyncLogEntry[]>([])

  useEffect(() => {
    const off = subscribeSyncLog((e) => {
      liveRef.current = e
      if (!paused) setEntries(e.slice())
    })
    return off
  }, [paused])

  // When un-pausing, sync the displayed buffer with the latest live one.
  useEffect(() => {
    if (!paused) setEntries(liveRef.current.slice())
  }, [paused])

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (levelFilter === "err" && e.level !== "err") return false
      if (levelFilter === "warn-err" && e.level !== "err" && e.level !== "warn") return false
      if (kindFilter !== "all" && e.kind !== kindFilter) return false
      return true
    })
  }, [entries, levelFilter, kindFilter])

  const counts = useMemo(() => {
    let ok = 0, warn = 0, err = 0, info = 0
    for (const e of entries) {
      if (e.level === "ok") ok++
      else if (e.level === "warn") warn++
      else if (e.level === "err") err++
      else info++
    }
    return { ok, warn, err, info }
  }, [entries])

  return (
    <div className="py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-xs font-medium text-foreground"
        >
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform",
              expanded ? "rotate-0" : "-rotate-90",
            )}
          />
          Advanced log
          <span className="text-[10px] font-normal text-muted-foreground">
            {entries.length} entries · {counts.ok} ok · {counts.warn} warn · {counts.err} err
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            className="rounded-md border border-border/40 px-2 py-1 text-[10px] hover:border-border hover:bg-muted/40"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={() => clearSyncLog()}
            className="rounded-md border border-border/40 px-2 py-1 text-[10px] hover:border-border hover:bg-muted/40"
          >
            Clear
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-muted-foreground/70">Level:</span>
            {(["all", "warn-err", "err"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevelFilter(l)}
                className={cn(
                  "rounded-full px-2 py-0.5 transition-colors",
                  levelFilter === l
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/40",
                )}
              >
                {l === "all" ? "All" : l === "warn-err" ? "Warn+" : "Err only"}
              </button>
            ))}
            <span className="ml-2 text-muted-foreground/70">Kind:</span>
            {(["all", "song", "template", "presentation", "engine", "outbox", "pull", "push"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKindFilter(k)}
                className={cn(
                  "rounded-full px-2 py-0.5 transition-colors",
                  kindFilter === k
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/40",
                )}
              >
                {k}
              </button>
            ))}
          </div>

          <div className="max-h-[320px] overflow-y-auto rounded-md border border-border/40 bg-black/40 font-mono text-[10px]">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-muted-foreground">
                No log entries yet. Try pushing something or wait for the next sync tick.
              </div>
            ) : (
              <table className="w-full table-fixed">
                <tbody>
                  {filtered
                    .slice()
                    .reverse()
                    .map((e) => (
                      <tr
                        key={e.id}
                        className={cn(
                          "border-b border-border/20 align-top",
                          e.level === "err" && "bg-red-500/5",
                          e.level === "warn" && "bg-amber-500/5",
                          e.level === "ok" && "bg-emerald-500/5",
                        )}
                      >
                        <td className="w-[80px] px-2 py-1 text-muted-foreground/70">
                          {new Date(e.t).toLocaleTimeString(undefined, {
                            hour12: false,
                          })}
                        </td>
                        <td
                          className={cn(
                            "w-[44px] px-2 py-1 font-semibold uppercase",
                            e.level === "ok" && "text-emerald-400",
                            e.level === "warn" && "text-amber-400",
                            e.level === "err" && "text-red-400",
                            e.level === "info" && "text-zinc-400",
                          )}
                        >
                          {e.level}
                        </td>
                        <td className="w-[80px] px-2 py-1 text-muted-foreground">
                          {e.kind ?? "-"}
                        </td>
                        <td className="px-2 py-1 text-foreground">
                          {e.msg}
                          {(e.status !== undefined || e.duration_ms !== undefined) && (
                            <span className="ml-2 text-muted-foreground/70">
                              {e.status !== undefined ? ` ${e.status}` : ""}
                              {e.duration_ms !== undefined ? ` · ${e.duration_ms}ms` : ""}
                            </span>
                          )}
                          {e.meta && (
                            <details className="mt-0.5">
                              <summary className="cursor-pointer text-muted-foreground/60">
                                meta
                              </summary>
                              <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-black/40 px-1.5 py-1 text-[9.5px] text-muted-foreground">
                                {JSON.stringify(e.meta, null, 2)}
                              </pre>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cloud sync panel — manual "push everything now" + last-run report. The
// app already runs `startSyncEngine` (boot backfill, 60s pull, outbox drain)
// automatically; this panel exists for the case where the user wants
// instant confirmation that local state is mirrored in the dashboard
// without waiting for the next mutation or pull tick.
// ---------------------------------------------------------------------------
function CloudSyncPanel() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{
    kind: "song" | "template" | "presentation"
    done: number
    total: number
  } | null>(null)
  const [report, setReport] = useState<ForcePushReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoPush, setAutoPushState] = useState<boolean>(() => isAutoPushEnabled())

  // Keep the toggle in sync if another tab / another component flips it
  // (e.g. command palette in the future).
  useEffect(() => {
    function refresh() {
      setAutoPushState(isAutoPushEnabled())
    }
    window.addEventListener("np-libsync-autopush-changed", refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener("np-libsync-autopush-changed", refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [])

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    setReport(null)
    setProgress(null)
    try {
      const r = await forcePushAll((info) => setProgress(info))
      setReport(r)
      // Nudge any dashboard / library queries so visible counts refresh.
      qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
      qc.invalidateQueries({ queryKey: ["songs", "list"] })
      qc.invalidateQueries({ queryKey: ["templates", "list"] })
      qc.invalidateQueries({ queryKey: ["presentations", "list"] })
    } catch (err) {
      setError((err as Error)?.message ?? "unknown error")
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="divide-y divide-border/40">
      <Row
        label="Auto-push to cloud"
        description="Continuously mirror every local song, template, and presentation to the cloud dashboard. Mutations push instantly; a slow background tick re-checks every 5 minutes so out-of-band edits also land. Turn off to keep edits local-only (the cloud will still receive on-mutation pushes if you ever turn it back on)."
      >
        <Switch
          checked={autoPush}
          onCheckedChange={(v) => {
            setAutoPushEnabled(v)
            setAutoPushState(v)
          }}
          aria-label="Auto-push library to cloud"
        />
      </Row>
      <Row
        label="Push everything now"
        description="Force-uploads the entire local library immediately. Useful after restoring a backup, fixing a mapping mismatch, or to confirm the dashboard matches local state right now."
      >
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors",
            busy
              ? "cursor-not-allowed border-border/40 text-muted-foreground"
              : "border-border/60 hover:border-border hover:bg-muted/40",
          )}
        >
          {busy ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
          {busy ? "Pushing…" : "Push now"}
        </button>
      </Row>

      <SyncLogViewer />

      {(busy || report || error) && (
        <div className="space-y-2 py-3 text-[11px]">
          {busy && progress && (
            <div className="text-muted-foreground">
              {progress.kind}s: {progress.done} / {progress.total}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-red-300">
              {error}
            </div>
          )}
          {report && (
            <div className="space-y-1 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-emerald-300">
              <div>
                Songs: {report.songs.ok} pushed
                {report.songs.queued ? `, ${report.songs.queued} queued offline` : ""}
                {report.songs.failed ? `, ${report.songs.failed} failed` : ""}
              </div>
              <div>
                Templates: {report.templates.ok} pushed
                {report.templates.queued ? `, ${report.templates.queued} queued offline` : ""}
                {report.templates.failed ? `, ${report.templates.failed} failed` : ""}
              </div>
              <div>
                Presentations: {report.presentations.ok} pushed
                {report.presentations.queued
                  ? `, ${report.presentations.queued} queued offline`
                  : ""}
                {report.presentations.failed ? `, ${report.presentations.failed} failed` : ""}
              </div>
              {report.outbox_remaining > 0 && (
                <div className="text-amber-300">
                  {report.outbox_remaining} item(s) still queued — will retry on next connectivity tick.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// BiblesPanel: pick primary / secondary / tertiary translations. The
// primary always renders; secondary/tertiary are optional and only
// fill their slots when the bound template has matching boxes.
function BiblesPanel() {
  const { data: bibles, isLoading } = useQuery({
    queryKey: ["bible", "list"],
    queryFn: () =>
      Bible.ListBibles() as unknown as Promise<BibleTranslation[]>,
  })
  const { state, setPrimary, setSecondary, setTertiary } = useBibleTranslations()

  if (isLoading) {
    return (
      <div className="py-3 text-[11px] text-muted-foreground">Loading…</div>
    )
  }
  const options = bibles ?? []
  return (
    <div className="divide-y divide-border/40">
      <TranslationRow
        label="Primary"
        description="Default for picker and the primary slot in templates."
        value={state.primary}
        options={options}
        onChange={(v) => v && setPrimary(v)}
        clearable={false}
      />
      <TranslationRow
        label="Secondary"
        description="Fills the second slot in 'Two Translations' / 'Three Translations' templates."
        value={state.secondary}
        options={options}
        onChange={setSecondary}
        clearable
      />
      <TranslationRow
        label="Tertiary"
        description="Fills the third slot in 'Three Translations' templates."
        value={state.tertiary}
        options={options}
        onChange={setTertiary}
        clearable
      />
    </div>
  )
}

function TranslationRow({
  label,
  description,
  value,
  options,
  onChange,
  clearable,
}: {
  label: string
  description: string
  value: string | null
  options: BibleTranslation[]
  onChange: (translation: string | null) => void
  clearable: boolean
}) {
  const current = options.find((b) => b.translation === value)
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="space-y-0.5">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-8 min-w-[180px] shrink-0 items-center justify-between gap-2 rounded-md border border-border/50 px-3 text-xs transition-colors hover:bg-muted",
              current ? "text-foreground" : "text-muted-foreground/60"
            )}
          >
            <span className="truncate">
              {current ? current.name : "None"}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
              {current?.translation ?? ""}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="min-w-[220px]">
          {clearable && (
            <>
              <DropdownMenuItem
                onSelect={() => onChange(null)}
                className={cn(value === null && "font-medium")}
              >
                None
              </DropdownMenuItem>
              {options.length > 0 && <DropdownMenuSeparator />}
            </>
          )}
          {options.map((b) => (
            <DropdownMenuItem
              key={b.translation}
              onSelect={() => onChange(b.translation)}
              className={cn(value === b.translation && "font-medium")}
            >
              <span className="flex-1 truncate">{b.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {b.translation}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

const BRANDING_LOGO_MAX_BYTES = 256 * 1024
const BRANDING_ACCEPTED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]

function BrandingPanel() {
  const auth = useAuth()
  const [orgName, setOrgName] = useState(auth.profile?.orgName ?? "")
  const [orgLogo, setOrgLogo] = useState<string | null>(
    auth.profile?.orgLogo ?? null
  )
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<
    { kind: "ok" | "error"; message: string } | null
  >(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Hydrate local state if the auth profile loads after this panel
  // mounts (initial fetch is async). Without this the inputs stay
  // blank on first render even after the org row is fetched.
  const lastProfileSig = useRef<string>("")
  const sig = `${auth.profile?.orgName ?? ""}|${auth.profile?.orgLogo ?? ""}`
  if (lastProfileSig.current !== sig && status === null && !saving) {
    lastProfileSig.current = sig
    if (orgName === "" && auth.profile?.orgName) setOrgName(auth.profile.orgName)
    if (orgLogo === null && auth.profile?.orgLogo)
      setOrgLogo(auth.profile.orgLogo)
  }

  function readFile(file: File) {
    setStatus(null)
    if (!BRANDING_ACCEPTED_MIME.includes(file.type)) {
      setStatus({ kind: "error", message: "Use PNG, JPEG, WEBP, or SVG." })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const data = typeof reader.result === "string" ? reader.result : ""
      if (data.length > BRANDING_LOGO_MAX_BYTES) {
        setStatus({
          kind: "error",
          message: `Logo too big (${Math.round(
            data.length / 1024
          )}KB). Max 256KB.`,
        })
        return
      }
      setOrgLogo(data)
    }
    reader.onerror = () =>
      setStatus({ kind: "error", message: "Couldn't read that file." })
    reader.readAsDataURL(file)
  }

  async function save() {
    setSaving(true)
    setStatus(null)
    const trimmed = orgName.trim()
    const r = await auth.updateBranding({
      orgName: trimmed.length === 0 ? null : trimmed,
      orgLogo,
    })
    setSaving(false)
    if (r.ok) setStatus({ kind: "ok", message: "Saved." })
    else setStatus({ kind: "error", message: r.error })
  }

  const previewName = orgName.trim() || "Fathers House Church Media"
  const previewLogo = orgLogo ?? logoDefault

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 p-3">
        <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-background">
          <AnimatePresence mode="wait">
            <motion.img
              key={previewLogo}
              src={previewLogo}
              alt=""
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.2 }}
              className="size-9 object-contain"
            />
          </AnimatePresence>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
            Header preview
          </p>
          <AnimatePresence mode="wait">
            <motion.p
              key={previewName}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.15 }}
              className="truncate text-sm font-medium"
            >
              {previewName}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
          Organisation name
        </span>
        <Input
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          maxLength={60}
          placeholder="Fathers House Church Media"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
          Logo
        </span>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files?.[0]
            if (f) readFile(f)
          }}
          onClick={() => fileRef.current?.click()}
          className={`grid min-h-[110px] cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed transition-all ${
            dragging
              ? "border-foreground/40 bg-muted/40"
              : "border-border/60 hover:border-border hover:bg-muted/30"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept={BRANDING_ACCEPTED_MIME.join(",")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) readFile(f)
              e.target.value = ""
            }}
          />
          <AnimatePresence mode="wait">
            {orgLogo ? (
              <motion.div
                key="logo"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18 }}
                className="flex w-full items-center gap-3 px-4"
              >
                <img
                  src={orgLogo}
                  alt="Logo preview"
                  className="size-12 shrink-0 rounded-md bg-background object-contain"
                />
                <span className="flex-1 text-xs text-muted-foreground">
                  Click to replace or drop a new file.
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOrgLogo(null)
                  }}
                  aria-label="Remove logo"
                  className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col items-center gap-2 py-5 text-center"
              >
                <ImagePlusIcon className="size-5 text-muted-foreground/60" />
                <p className="text-xs text-muted-foreground">
                  Drop a file or{" "}
                  <span className="font-medium text-foreground">click to pick</span>
                </p>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50">
                  PNG · JPEG · WEBP · SVG · ≤ 256KB
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {status && (
          <motion.p
            key={status.message}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={
              "rounded-lg px-3 py-2 text-xs " +
              (status.kind === "ok"
                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border border-red-500/30 bg-red-500/10 text-red-300")
            }
          >
            {status.message}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-end gap-2 pt-1">
        <motion.button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          whileHover={saving ? undefined : { scale: 1.02 }}
          whileTap={saving ? undefined : { scale: 0.98 }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
          {saving ? "Saving…" : "Save changes"}
        </motion.button>
      </div>
    </div>
  )
}

function Settings() {
  const [active, setActive] = useState<SectionId>("general")
  const current = sections.find((s) => s.id === active)!

  return (
    <div className="grid h-full grid-cols-[200px_1fr]">
      <aside className="border-r border-border/50 px-2 py-4">
        <nav className="flex flex-col gap-px">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={
                "rounded-md px-2 py-1.5 text-left text-xs transition-colors " +
                (active === s.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")
              }
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <section className="overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <SectionHeader
            title={current.label}
            description={
              active === "general"
                ? "Look and feel."
                : active === "branding"
                  ? "Organisation name and logo shown in the desktop app header."
                  : active === "display"
                    ? "Configured outputs and their template bindings."
                    : active === "bibles"
                      ? "Pick which translations fill the slots in multi-translation templates."
                      : active === "cloud"
                        ? "Force-push your entire local library to the cloud dashboard."
                        : `${current.label} settings will live here.`
            }
          />
          {active === "general" ? (
            <GeneralPanel />
          ) : active === "branding" ? (
            <BrandingPanel />
          ) : active === "output" ? (
            <OutputPanel />
          ) : active === "display" ? (
            <DisplaySettings />
          ) : active === "bibles" ? (
            <BiblesPanel />
          ) : active === "cloud" ? (
            <CloudSyncPanel />
          ) : (
            <Placeholder label={current.label} />
          )}
        </div>
      </section>
    </div>
  )
}
