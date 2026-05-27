import { useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  CheckIcon,
  ImagePlusIcon,
  Loader2Icon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import logoDefault from "@/assets/logo.png"
import { setWalkthroughRequested } from "@/features/walkthrough/walkthrough"

// 256KB cap on the base64-encoded data URL. Mirrors the server's
// ORG_LOGO_MAX_BYTES so the client rejects oversized files before
// shipping them across the wire and getting a 400 back.
const ORG_LOGO_MAX_BYTES = 256 * 1024
const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]

type Props = {
  initialName: string | null
  initialLogo: string | null
  defaultName: string
  email?: string
  onSubmit: (patch: {
    orgName: string | null
    orgLogo: string | null
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  /**
   * Called after the card has rendered its success state. The parent
   * should advance past onboarding here (BrandingSetup hides itself
   * the moment this returns). Decoupled from onSubmit so the success
   * checkmark gets ~650ms on-screen — without this hook the card
   * blinks out the instant the save resolves.
   */
  onSaved?: () => void
  onSkip: () => void
}

// BrandingSetup is the post-signup onboarding step. Rendered inside
// the auth page card, replacing the sign-in form once a new account
// has been created. The operator can name their organisation and
// upload a logo; both are optional — skipping leaves the row blank
// and the app falls back to the built-in defaults.
//
// All field updates feed the in-card live preview at the top so the
// user can see exactly what the desktop header will look like
// before they commit.
export function BrandingSetup({
  initialName,
  initialLogo,
  defaultName,
  email,
  onSubmit,
  onSaved,
  onSkip,
}: Props) {
  const [orgName, setOrgName] = useState<string>(initialName ?? "")
  const [orgLogo, setOrgLogo] = useState<string | null>(initialLogo)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorShake, setErrorShake] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Opt-in for the workspace walkthrough that runs after this card
  // dismisses. Default ON — first-time users get the tour unless they
  // actively decline. Stored as a localStorage flag the workspace
  // route picks up on mount; user can re-enable from Settings later.
  const [tourOptIn, setTourOptIn] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  function readFile(file: File) {
    setError(null)
    if (!ACCEPTED_MIME.includes(file.type)) {
      setError("Use PNG, JPEG, WEBP, or SVG.")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const data = typeof reader.result === "string" ? reader.result : ""
      if (data.length > ORG_LOGO_MAX_BYTES) {
        setError(
          `Logo is too big (${Math.round(
            data.length / 1024
          )}KB). Maximum 256KB — try resizing.`
        )
        return
      }
      setOrgLogo(data)
    }
    reader.onerror = () => setError("Couldn't read that file.")
    reader.readAsDataURL(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) readFile(file)
  }

  async function commit() {
    setSaving(true)
    setError(null)
    const trimmed = orgName.trim()
    const r = await onSubmit({
      orgName: trimmed.length === 0 ? null : trimmed,
      orgLogo,
    })
    if (!r.ok) {
      setSaving(false)
      setError(prettyError(r.error))
      // Bump the shake counter so the inline error card jolts. Using a
      // counter (rather than a boolean) re-fires the animation on every
      // failed submit, not just the first one.
      setErrorShake((n) => n + 1)
      return
    }
    setSaving(false)
    setSaved(true)
    setWalkthroughRequested(tourOptIn)
    // Hold the success state on-screen long enough for the user to
    // actually register the checkmark before we hand off to the next
    // route. 650ms feels celebratory without feeling slow.
    window.setTimeout(() => {
      onSaved?.()
    }, 650)
  }

  function skip() {
    setWalkthroughRequested(tourOptIn)
    onSkip()
  }

  const previewName = orgName.trim() || defaultName
  const previewLogo = orgLogo ?? logoDefault

  // Stagger config matches the sign-in form so the visual cadence
  // feels continuous when the user transitions from sign-in to here.
  // Slightly tighter than the default to keep the whole card from
  // taking too long to settle on slower machines.
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.055, delayChildren: 0.08 },
    },
    exit: {
      opacity: 0,
      y: -8,
      transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
    },
  }
  const item = {
    hidden: { opacity: 0, y: 14 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 340, damping: 28, mass: 0.7 },
    },
  }

  if (saved) {
    return (
      <motion.div
        key="branding-saved"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98, y: -8 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="flex flex-col items-center justify-center gap-4 py-12 text-center"
      >
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 18, delay: 0.05 }}
          className="relative grid size-20 place-items-center"
        >
          <motion.span
            initial={{ opacity: 0.8, scale: 1 }}
            animate={{ opacity: [0.8, 0, 0.8], scale: [1, 1.6, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            className="absolute inset-0 rounded-full bg-emerald-400/25"
          />
          <span className="relative grid size-20 place-items-center rounded-full bg-emerald-400/15 ring-2 ring-emerald-300/70">
            <motion.span
              initial={{ opacity: 0, scale: 0.4, rotate: -18 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{
                type: "spring",
                stiffness: 360,
                damping: 18,
                delay: 0.18,
              }}
              className="block"
            >
              <CheckIcon className="size-10 text-emerald-200" strokeWidth={2.4} />
            </motion.span>
          </span>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.18 }}
          className="flex flex-col gap-1"
        >
          <h2 className="text-xl font-semibold tracking-tight">
            {orgName.trim() || defaultName} is set
          </h2>
          <p className="text-xs text-white/55">Loading workspace…</p>
        </motion.div>
      </motion.div>
    )
  }

  return (
    <motion.div
      key="branding"
      variants={container}
      initial="hidden"
      animate="show"
      exit="exit"
      className="flex flex-col gap-5"
    >
      <motion.div variants={item} className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Set up your space</h1>
        <p className="mt-2 text-sm text-white/60">
          Name your organisation and pick a logo. You can change both later in
          Settings.
        </p>
        {email && (
          <p className="mt-1 text-[11px] uppercase tracking-widest text-white/35">
            {email}
          </p>
        )}
      </motion.div>

      {/* Live header preview — same shape as the desktop chrome strip
         the operator will see after this card disappears. */}
      <motion.div
        variants={item}
        className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 p-3"
      >
        <motion.div
          layout
          className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-white/5"
        >
          <AnimatePresence mode="wait">
            <motion.img
              key={previewLogo}
              src={previewLogo}
              alt=""
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.25 }}
              className="size-9 object-contain"
            />
          </AnimatePresence>
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest text-white/35">
            Header preview
          </p>
          <AnimatePresence mode="wait">
            <motion.p
              key={previewName}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="truncate text-sm font-medium"
            >
              {previewName}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.div>

      <motion.div variants={item} className="flex flex-col gap-1.5">
        <label className="text-[11px] uppercase tracking-widest text-white/55">
          Organisation name
        </label>
        <input
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          maxLength={60}
          placeholder={defaultName}
          className="rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all focus-visible:border-white/30 focus-visible:bg-white/15"
        />
      </motion.div>

      <motion.div variants={item} className="flex flex-col gap-1.5">
        <label className="text-[11px] uppercase tracking-widest text-white/55">
          Logo
        </label>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`relative grid min-h-[120px] cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed transition-all ${
            dragging
              ? "border-white/60 bg-white/10"
              : "border-white/15 bg-white/[0.04] hover:border-white/30 hover:bg-white/[0.07]"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_MIME.join(",")}
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
                key="have-logo"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="flex w-full items-center gap-3 px-4 py-3"
              >
                <img
                  src={orgLogo}
                  alt="Logo preview"
                  className="size-12 shrink-0 rounded-md bg-white/5 object-contain"
                />
                <span className="flex-1 truncate text-xs text-white/70">
                  Looking sharp.
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOrgLogo(null)
                  }}
                  className="grid size-7 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Remove logo"
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
                transition={{ duration: 0.18 }}
                className="flex flex-col items-center gap-2 px-4 py-6 text-center"
              >
                <ImagePlusIcon className="size-6 text-white/40" />
                <p className="text-xs text-white/65">
                  Drop a file here or{" "}
                  <span className="font-medium text-white/85">click to pick</span>
                </p>
                <p className="text-[10px] uppercase tracking-widest text-white/30">
                  PNG · JPEG · WEBP · SVG · ≤ 256KB
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.p
            key={`err-${errorShake}`}
            initial={{ opacity: 0, y: -6, x: 0 }}
            animate={{
              opacity: 1,
              y: 0,
              x: [0, -8, 8, -6, 6, -3, 3, 0],
            }}
            exit={{ opacity: 0, y: -6 }}
            transition={{
              opacity: { duration: 0.18 },
              y: { duration: 0.18 },
              x: { duration: 0.42, ease: "easeInOut" },
            }}
            className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            <XIcon className="mt-0.5 size-3.5 shrink-0" />
            <span className="flex-1">{error}</span>
          </motion.p>
        )}
      </AnimatePresence>

      <motion.label
        variants={item}
        className="flex items-start gap-2 text-xs text-white/60"
      >
        <input
          type="checkbox"
          checked={tourOptIn}
          onChange={(e) => setTourOptIn(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-white"
        />
        <span>
          Show me a quick tour of the workspace after this. You can re-run it
          any time from Settings.
        </span>
      </motion.label>

      <motion.div variants={item} className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={skip}
          disabled={saving}
          className="flex-1 rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/70 transition-colors hover:border-white/30 hover:text-white disabled:opacity-40"
        >
          Skip for now
        </button>
        <motion.button
          type="button"
          onClick={() => void commit()}
          disabled={saving}
          whileHover={saving ? undefined : { scale: 1.02 }}
          whileTap={saving ? undefined : { scale: 0.98 }}
          className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-medium text-black shadow-[0_0_22px_rgba(255,255,255,0.18)] transition-all hover:bg-white/90 hover:shadow-[0_0_32px_rgba(255,255,255,0.32)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            {saving ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <CheckIcon className="size-3.5" />
            )}
            {saving ? "Saving…" : "Save & continue"}
          </span>
        </motion.button>
      </motion.div>
    </motion.div>
  )
}

function prettyError(r: string): string {
  switch (r) {
    case "bad_payload":
      return "Some of those values didn't pass our checks. Try a smaller logo or shorter name."
    case "not_signed_in":
      return "Session lost — try signing in again."
    default:
      return r
  }
}
