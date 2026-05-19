import { useEffect, useState } from "react"
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { GradFlow } from "gradflow"
import { motion, AnimatePresence } from "motion/react"
import { useAuth } from "@/hooks/use-auth"
import { Input } from "@/components/input"
import { Label } from "@/components/label"

type Tab = "login" | "trial" | "license"
type Search = { reason?: string; from?: string }

export const Route = createFileRoute("/auth")({
  validateSearch: (raw: Record<string, unknown>): Search => ({
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
    from: typeof raw.from === "string" ? raw.from : undefined,
  }),
  component: AuthPage,
})

function AnimatedInput({
  id,
  type = "text",
  value,
  onChange,
  className,
  placeholder,
}: {
  id: string
  type?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  className?: string
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`${className} text-transparent caret-white`}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center px-4 overflow-hidden whitespace-pre md:text-sm text-base text-white">
        {!value && placeholder && <span className="opacity-0">{placeholder}</span>}
        {value.split("").map((char, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            {type === "password" ? "•" : char}
          </motion.span>
        ))}
      </div>
    </div>
  )
}

function AuthPage() {
  const [tab, setTab] = useState<Tab>("login")
  const search = useSearch({ from: "/auth" })

  const staggerContainer = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
    exit: { opacity: 0, transition: { duration: 0.25 } },
  }
  const staggerItem = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } },
  }

  const auth = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [license, setLicense] = useState("")
  const [error, setError] = useState<string | null>(reasonToMessage(search.reason))
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [agreed, setAgreed] = useState(false)

  // Auto-bounce once we have an authenticated session with a usable account.
  useEffect(() => {
    if (auth.loading) return
    if (!auth.isAuthenticated) return
    if (!auth.account) return
    if (auth.account.status === "licensed" || auth.account.status === "trial") {
      const dest = search.from ?? "/"
      navigate({ to: dest, replace: true })
    }
  }, [auth.loading, auth.isAuthenticated, auth.account, navigate, search.from])

  // Signed in but account has no usable access (no license, no trial, or
  // trial expired). Render an upgrade panel instead of the sign-in form so
  // the user isn't stranded on a "Loading workspace…" message.
  const needsUpgrade =
    !auth.loading &&
    auth.isAuthenticated &&
    !!auth.account &&
    (auth.account.status === "no_access" || auth.account.status === "trial_expired")
  const trialAlreadyUsed = auth.account?.trial?.expired === true

  // Splash-style overlay while we restore a stored session at launch.
  if (auth.loading) {
    return (
      <div className="grid h-screen w-screen place-items-center bg-black text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white" />
          <span className="text-xs uppercase tracking-widest text-white/50">Restoring session</span>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    setInfo(null)
    if ((tab === "trial" || tab === "license") && !agreed) {
      setError("You must agree to the Terms of Service and Privacy Policy.")
      return
    }
    setBusy(true)
    try {
      let result: { ok: boolean; error?: string }
      if (tab === "login") {
        result = await auth.login(email, password)
      } else if (tab === "trial") {
        result = await auth.signupTrial(email, password)
      } else {
        result = await auth.signupWithLicense(email, password, license.trim().toUpperCase())
      }
      if (!result.ok) {
        setError(describeServerError(result.error ?? "Something went wrong."))
        return
      }
      setInfo(
        tab === "trial"
          ? "Trial activated. Loading workspace…"
          : tab === "license"
            ? "License redeemed. Loading workspace…"
            : "Signed in. Loading workspace…"
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <div className="absolute inset-0 z-0">
        <GradFlow
          config={{
            color1: { r: 163, g: 106, b: 242 },
            color2: { r: 0, g: 0, b: 0 },
            color3: { r: 234, g: 130, b: 106 },
            speed: 0.6,
            scale: 1.2,
            type: "silk",
            noise: 0.18,
          }}
        />
      </div>

      <div className="relative z-10 flex h-full items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.1 }}
          className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-black/45 p-8 shadow-2xl backdrop-blur-xl"
        >
          <AnimatePresence mode="wait">
            {busy ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                transition={{ duration: 0.32 }}
                className="flex flex-col items-center justify-center py-12"
              >
                <div className="relative mb-6 h-16 w-16">
                  <span className="absolute inset-0 rounded-full border-4 border-white/10" />
                  <motion.span
                    className="absolute inset-0 rounded-full border-4 border-white border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  />
                </div>
                <h2 className="text-xl font-medium tracking-tight">
                  {tab === "login" ? "Signing you in…" : "Creating your account…"}
                </h2>
                <p className="mt-2 text-sm text-white/50">Verifying device and license</p>
              </motion.div>
            ) : needsUpgrade ? (
              <UpgradePanel
                email={auth.user?.email ?? ""}
                trialExpired={trialAlreadyUsed}
                onStartTrial={async () => {
                  setError(null); setInfo(null); setBusy(true)
                  const r = await auth.startTrialExisting()
                  setBusy(false)
                  if (!r.ok) setError(describeServerError(r.error))
                }}
                onRedeem={async (key) => {
                  setError(null); setInfo(null); setBusy(true)
                  const r = await auth.redeemLicenseExisting(key)
                  setBusy(false)
                  if (!r.ok) setError(describeServerError(r.error))
                }}
                onLogout={async () => {
                  setError(null); setInfo(null)
                  await auth.logout()
                }}
                onRefresh={async () => {
                  setError(null); setInfo(null)
                  await auth.refreshAccount()
                }}
                error={error}
              />
            ) : (
              <motion.div
                key={`form-${tab}`}
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <motion.div variants={staggerItem} className="mb-6 text-center">
                  <h1 className="text-3xl font-bold tracking-tight">Welcome to NeoProjector</h1>
                  <p className="mt-2 text-sm text-white/60">
                    {tab === "login"
                      ? "Sign in to continue."
                      : tab === "trial"
                        ? "Start your 7-day free trial."
                        : "Activate with a license key."}
                  </p>
                </motion.div>

                <motion.div variants={staggerItem} className="mb-6 flex rounded-xl bg-white/5 p-1">
                  {(["login", "trial", "license"] as Tab[]).map((t) => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => {
                        setTab(t)
                        setError(null)
                        setInfo(null)
                      }}
                      className={`relative z-10 flex-1 rounded-lg py-2 text-xs font-medium transition-colors duration-200 ${
                        tab === t ? "text-black" : "text-white/60 hover:text-white"
                      }`}
                    >
                      {t === "login" ? "Sign In" : t === "trial" ? "Free Trial" : "License"}
                      {tab === t && (
                        <motion.span
                          layoutId="activeTab"
                          className="absolute inset-0 -z-10 rounded-lg bg-white"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                    </button>
                  ))}
                </motion.div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <motion.div variants={staggerItem} className="space-y-1.5">
                    <Label htmlFor="email" className="text-white/70 ml-1">Email</Label>
                    <AnimatedInput
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="rounded-xl border-white/10 bg-white/10 px-4 py-6 placeholder:text-white/30 transition-all focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:bg-white/15"
                      placeholder="you@church.org"
                    />
                  </motion.div>
                  <motion.div variants={staggerItem} className="space-y-1.5">
                    <Label htmlFor="password" className="text-white/70 ml-1">Password</Label>
                    <AnimatedInput
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="rounded-xl border-white/10 bg-white/10 px-4 py-6 placeholder:text-white/30 transition-all focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:bg-white/15"
                      placeholder={tab === "login" ? "Enter your password" : "At least 8 characters"}
                    />
                  </motion.div>

                  <AnimatePresence>
                    {tab === "license" && (
                      <motion.div
                        key="license"
                        initial={{ opacity: 0, height: 0, marginTop: 0 }}
                        animate={{ opacity: 1, height: "auto", marginTop: 8 }}
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        transition={{ duration: 0.25 }}
                        className="space-y-1.5 overflow-hidden"
                      >
                        <Label htmlFor="license" className="text-white/70 ml-1">License key</Label>
                        <AnimatedInput
                          id="license"
                          value={license}
                          onChange={(e) => setLicense(e.target.value.toUpperCase())}
                          className="rounded-xl border-white/10 bg-white/10 px-4 py-6 font-mono uppercase tracking-wider placeholder:text-white/30 transition-all focus-visible:ring-2 focus-visible:ring-white/20"
                          placeholder="NP-XXXX-XXXX-XXXX-XXXX"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {(tab === "trial" || tab === "license") && (
                      <motion.label
                        key="agree"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25 }}
                        className="flex items-start gap-2 overflow-hidden text-xs text-white/60"
                      >
                        <input
                          type="checkbox"
                          checked={agreed}
                          onChange={(e) => setAgreed(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-white"
                        />
                        <span>
                          I agree to the{" "}
                          <a
                            href="https://neoprojector.com/terms"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white/80 underline-offset-2 hover:text-white hover:underline"
                          >
                            Terms of Service
                          </a>{" "}
                          and{" "}
                          <a
                            href="https://neoprojector.com/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white/80 underline-offset-2 hover:text-white hover:underline"
                          >
                            Privacy Policy
                          </a>
                          .
                        </span>
                      </motion.label>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {error && (
                      <motion.p
                        key="err"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
                      >
                        {error}
                      </motion.p>
                    )}
                  </AnimatePresence>
                  <AnimatePresence>
                    {info && !error && (
                      <motion.p
                        key="info"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
                      >
                        {info}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <motion.div
                    variants={staggerItem}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="pt-2"
                  >
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full rounded-xl bg-white px-4 py-3.5 text-sm font-medium text-black shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60"
                    >
                      {tab === "login" ? "Sign In" : tab === "trial" ? "Start Free Trial" : "Activate License"}
                    </button>
                  </motion.div>

                  <motion.p variants={staggerItem} className="pt-1 text-center text-[11px] text-white/40">
                    {tab === "login"
                      ? "Forgot password? Reset it from the website dashboard."
                      : "Same credentials work on neoprojector.com."}
                  </motion.p>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}

function reasonToMessage(reason?: string): string | null {
  switch (reason) {
    case "trial_expired":
      return "Your 7-day trial has ended. Activate a license to keep using NeoProjector."
    case "suspended":
      return "This account is suspended. Contact your administrator."
    case "banned":
      return "This device is blocked. Contact support."
    case "no_access":
      return "No active license or trial on this account."
    default:
      return null
  }
}

function describeServerError(r: string): string {
  switch (r) {
    case "trial_already_used":
      return "This account already used its trial. Enter a license key to continue."
    case "trial_expired_purchase_required":
      return "Your 7-day trial has ended. Purchase a license at neoprojector.com, then return to activate it from the License tab."
    case "no_access_purchase_required":
      return "This account has no active license or trial. Purchase a license at neoprojector.com to continue."
    case "trial_abuse":
      return "Trial abuse detected. This device has been blocked. Contact your administrator to unblock."
    case "banned":
      return "This device is blocked from starting trials. Contact your administrator."
    case "suspended":
      return "Your account is suspended. Ask your administrator to unsuspend it, then sign out and back in."
    case "fingerprint_missing":
      return "Could not identify this device. Restart the app and try again."
    case "fingerprint_unavailable":
      return "Device identity unavailable. Restart the app."
    case "not_signed_in":
      return "Sign in first."
    case "not_found":
      return "License key not recognised."
    case "revoked":
      return "License has been revoked."
    case "expired":
      return "License has expired."
    case "already_assigned":
      return "License is already assigned to another account."
    case "format":
      return "License key format invalid (expected NP-XXXX-XXXX-XXXX-XXXX)."
    case "trial_failed":
      return "Trial activation failed. Try again."
    case "redeem_failed":
      return "License redemption failed. Try again."
    default:
      return r
  }
}

function UpgradePanel({
  email,
  trialExpired,
  onStartTrial,
  onRedeem,
  onLogout,
  onRefresh,
  error,
}: {
  email: string
  trialExpired: boolean
  onStartTrial: () => Promise<void>
  onRedeem: (key: string) => Promise<void>
  onLogout: () => Promise<void>
  onRefresh: () => Promise<void>
  error: string | null
}) {
  const [licenseKey, setLicenseKey] = useState("")
  const [mode, setMode] = useState<"trial" | "license">(trialExpired ? "license" : "trial")
  const [upgradeAgreed, setUpgradeAgreed] = useState(false)
  return (
    <motion.div
      key="upgrade"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="space-y-5"
    >
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-sm text-white/60 break-all">{email}</p>
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {trialExpired
            ? "Your trial ended. Activate a license to keep going."
            : "Your account has no active subscription yet."}
        </p>
      </div>

      <div className="flex rounded-xl bg-white/5 p-1">
        {(["trial", "license"] as const).map((m) => (
          <button
            type="button"
            key={m}
            onClick={() => setMode(m)}
            disabled={trialExpired && m === "trial"}
            className={`relative z-10 flex-1 rounded-lg py-2 text-xs font-medium transition-colors duration-200 disabled:opacity-30 ${
              mode === m ? "text-black" : "text-white/60 hover:text-white"
            }`}
          >
            {m === "trial" ? "Start 7-day Trial" : "Enter License Key"}
            {mode === m && (
              <motion.span
                layoutId="upgradeTab"
                className="absolute inset-0 -z-10 rounded-lg bg-white"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      <label className="flex items-start gap-2 text-xs text-white/60">
        <input
          type="checkbox"
          checked={upgradeAgreed}
          onChange={(e) => setUpgradeAgreed(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-white"
        />
        <span>
          I agree to the{" "}
          <a
            href="https://neoprojector.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/80 underline-offset-2 hover:text-white hover:underline"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href="https://neoprojector.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/80 underline-offset-2 hover:text-white hover:underline"
          >
            Privacy Policy
          </a>
          .
        </span>
      </label>

      <AnimatePresence mode="wait">
        {mode === "trial" ? (
          <motion.button
            key="trial-cta"
            type="button"
            disabled={!upgradeAgreed}
            onClick={() => void onStartTrial()}
            whileHover={upgradeAgreed ? { scale: 1.02 } : undefined}
            whileTap={upgradeAgreed ? { scale: 0.98 } : undefined}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="w-full rounded-xl bg-white px-4 py-3.5 text-sm font-medium text-black shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Activate Free Trial
          </motion.button>
        ) : (
          <motion.div
            key="license-form"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-3"
          >
            <input
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
              placeholder="NP-XXXX-XXXX-XXXX-XXXX"
              className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 font-mono uppercase tracking-wider text-white placeholder:text-white/30 outline-none focus:border-white/30"
            />
            <motion.button
              type="button"
              disabled={!upgradeAgreed}
              onClick={() => void onRedeem(licenseKey.trim())}
              whileHover={upgradeAgreed ? { scale: 1.02 } : undefined}
              whileTap={upgradeAgreed ? { scale: 0.98 } : undefined}
              className="w-full rounded-xl bg-white px-4 py-3.5 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              Redeem License
            </motion.button>
            {trialExpired && (
              <p className="text-center text-[11px] text-white/50">
                No license yet? Purchase one at{" "}
                <a
                  href="https://neoprojector.com/dashboard/billing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/80 hover:text-white"
                >
                  neoprojector.com
                </a>
                .
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.p
            key="upgrade-err"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-center gap-3 pt-1 text-xs">
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="text-white/50 hover:text-white/80"
        >
          Refresh status
        </button>
        <span className="text-white/20">·</span>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="text-white/50 hover:text-white/80"
        >
          Sign out
        </button>
      </div>
    </motion.div>
  )
}
