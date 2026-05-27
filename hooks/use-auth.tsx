import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { api, type AccountStatus } from "@/lib/api-client"
import { Service as AuthSvc, type SessionData, type FingerprintInfo } from "@/bindings/neoprojector/services/auth"
import type { AuthError } from "@supabase/supabase-js"

export type LoginResult = { ok: true } | { ok: false; error: string }

export type BrandingProfile = {
  orgName: string | null
  orgLogo: string | null
}

export type KickReason =
  | { kind: "banned"; message: string }
  | { kind: "suspended"; message: string }
  | { kind: "force"; message: string }

type AuthContextValue = {
  user: User | null
  session: Session | null
  loading: boolean
  account: AccountStatus | null
  fingerprint: FingerprintInfo | null
  isAuthenticated: boolean
  kick: KickReason | null
  profile: BrandingProfile | null
  // True the moment a brand-new account signs up (trial or license).
  // Drives the post-signup onboarding flow that lets the operator pick
  // their org name + logo before the app shell mounts.
  isFreshSignup: boolean
  login: (email: string, password: string) => Promise<LoginResult>
  signupTrial: (email: string, password: string) => Promise<LoginResult>
  signupWithLicense: (email: string, password: string, license: string) => Promise<LoginResult>
  startTrialExisting: () => Promise<LoginResult>
  redeemLicenseExisting: (license: string) => Promise<LoginResult>
  logout: () => Promise<void>
  refreshAccount: () => Promise<void>
  updateBranding: (patch: { orgName?: string | null; orgLogo?: string | null }) => Promise<LoginResult>
  acknowledgeOnboarding: () => void
}

const Ctx = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [account, setAccount] = useState<AccountStatus | null>(null)
  const [fingerprint, setFingerprint] = useState<FingerprintInfo | null>(null)
  const [kick, setKick] = useState<KickReason | null>(null)
  const [profile, setProfile] = useState<BrandingProfile | null>(null)
  // Flips to true the moment login() / signupTrial() / signupWithLicense
  // returns ok for a NEW signup. The auth.tsx page reads this to show
  // the onboarding panel instead of bouncing straight to /. Acknowledge
  // (skip or save) clears it and the redirect fires.
  const [isFreshSignup, setIsFreshSignup] = useState(false)
  const appSessionId = useRef<string | null>(null)

  // 1. Pull the device fingerprint exactly once. The Go side caches the
  //    result internally so re-calling would be cheap, but no point.
  useEffect(() => {
    AuthSvc.Fingerprint().then(setFingerprint).catch(() => setFingerprint(null))
  }, [])

  // 2. Restore the encrypted Supabase session at launch.
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      try {
        const stored = await AuthSvc.LoadSession().catch(() => null)
        if (stored?.access_token && stored?.refresh_token) {
          const { data, error } = await supabase.auth.setSession({
            access_token: stored.access_token,
            refresh_token: stored.refresh_token,
          })
          if (cancelled) return
          if (error) {
            // Only wipe the stored session on real auth rejection (server
            // said the refresh token is invalid). A transient network
            // failure must keep the stored session so the next launch
            // can retry — otherwise a one-off offline boot would log the
            // user out for good.
            if (isAuthRejection(error)) {
              await AuthSvc.ClearSession().catch(() => {})
            } else {
              // Offline boot: synthesise a session object from the cached
              // tokens so the UI can render past the auth gate. Supabase
              // will refresh + replace it the moment the network is back.
              setSession(synthesiseSession(stored))
            }
          } else if (data.session) {
            setSession(data.session)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  // 2b. When the device comes back online after a synthesised-session boot,
  //     hand the cached tokens back to Supabase so its internal state
  //     catches up — that's what unlocks /auth/v1/* calls (token refresh,
  //     password change) and re-enables the Realtime channel auth.
  useEffect(() => {
    if (typeof window === "undefined") return
    const onOnline = async () => {
      const stored = await AuthSvc.LoadSession().catch(() => null)
      if (!stored?.access_token || !stored?.refresh_token) return
      const { data: cur } = await supabase.auth.getSession()
      if (cur.session) return
      const { data, error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      })
      if (!error && data.session) setSession(data.session)
    }
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [])

  // 3. Mirror Supabase session changes (refresh, signOut) back into the
  //    encrypted store so the next launch picks up the freshest tokens.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      setSession(s)
      if (s?.refresh_token && s?.access_token) {
        AuthSvc.StoreSession({
          user_id: s.user.id,
          email: s.user.email ?? "",
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at: s.expires_at ?? 0,
        }).catch(() => {})
      } else if (evt === "SIGNED_OUT") {
        AuthSvc.ClearSession().catch(() => {})
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // 4. Pull account-status whenever user / fingerprint changes. When the
  //    license server is unreachable, fall back to the last successful
  //    snapshot persisted in localStorage so the app launches cleanly
  //    offline. The cached snapshot is re-derived against Date.now() — a
  //    trial that ended while offline still flips to "trial_expired".
  const refreshAccount = async () => {
    if (!session?.user || !fingerprint) return
    const uid = session.user.id
    try {
      const s = await api.accountStatus(uid, fingerprint)
      setAccount(s)
      writeCachedAccount(uid, s)
      if (s.status === "banned") {
        setKick({
          kind: "banned",
          message: "This device has been blocked by your administrator. The session will end now.",
        })
      } else if (s.status === "suspended") {
        setKick({
          kind: "suspended",
          message: "Your account has been suspended by your administrator. The session will end now.",
        })
      }
    } catch {
      // Network or server failure. If we don't yet have an account in
      // memory, hydrate from the cached snapshot so the offline launch can
      // get past the _app gate. Otherwise leave the last-known value in
      // place.
      setAccount((prev) => prev ?? deriveOffline(readCachedAccount(uid)))
    }
  }
  useEffect(() => {
    void refreshAccount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, fingerprint?.fingerprint])

  // 4b. Load branding profile whenever the user changes. Independent of
  //     the license-status refresh because branding doesn't care about
  //     fingerprint and shouldn't block the account gate.
  useEffect(() => {
    if (!session?.user) {
      setProfile(null)
      return
    }
    let cancelled = false
    api
      .getMe()
      .then((me) => {
        if (cancelled) return
        setProfile({
          orgName: me.profile?.org_name ?? null,
          orgLogo: me.profile?.org_logo ?? null,
        })
      })
      .catch(() => {
        if (!cancelled) setProfile((prev) => prev ?? { orgName: null, orgLogo: null })
      })
    return () => {
      cancelled = true
    }
  }, [session?.user?.id])

  // 5. Periodic re-check + fingerprint pulse. 60s cadence — short enough
  //    that admin actions land near-instantly, but not so chatty that we
  //    burn cycles on a quiet machine. The Realtime broadcast subscription
  //    below covers the "instant kick" case for active sessions; this poll
  //    is the fallback for when Realtime is disconnected.
  useEffect(() => {
    if (!session?.user) return
    const id = window.setInterval(() => {
      void refreshAccount()
      if (fingerprint) api.fingerprintPulse(fingerprint).catch(() => {})
    }, 60_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, fingerprint])

  // 5b. Realtime force-signout subscription. The admin website broadcasts an
  //     "admin" event on the shared web-presence channel whenever it bans a
  //     device or suspends a user — clients with matching user_id show the
  //     blocking kick modal, then sign out, no polling delay.
  useEffect(() => {
    if (!session?.user) return
    const channel = supabase.channel("np:web-presence")
    channel.on("broadcast", { event: "admin" }, ({ payload }) => {
      const msg = payload as { kind?: string; target_user_id?: string }
      if (msg?.kind === "force_signout" && msg.target_user_id === session.user.id) {
        setKick({
          kind: "force",
          message:
            "Your access has been revoked by your administrator. This session will end now.",
        })
      }
    })
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  // 5c. Delayed sign-out once the kick modal is up. Gives the user a beat to
  //     read the message before the screen flips to /auth.
  useEffect(() => {
    if (!kick) return
    const id = window.setTimeout(() => {
      void logout()
      setKick(null)
    }, 3500)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kick])

  // 6. Server-side app_session row + heartbeat so admin's Live-sessions
  //    panel shows this instance.
  useEffect(() => {
    if (!session?.user || !fingerprint) return
    let cancelled = false
    let beatId: number | null = null
    api
      .startSession(account?.license?.key ?? null, fingerprint)
      .then((r) => {
        if (cancelled) return
        appSessionId.current = r.session.id
        beatId = window.setInterval(() => {
          const id = appSessionId.current
          if (id) api.sessionHeartbeat(id).catch(() => {})
        }, 90_000)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (beatId) window.clearInterval(beatId)
      const id = appSessionId.current
      appSessionId.current = null
      if (id) api.endSession(id).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, fingerprint])

  const login = async (email: string, password: string): Promise<LoginResult> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { ok: false, error: error.message }
    if (fingerprint) api.fingerprintPulse(fingerprint).catch(() => {})
    // App access is gated on having a usable license OR an active trial.
    // Trial-expired (or otherwise no-access) accounts must purchase on the
    // website first. We sign them straight back out so the desktop never
    // settles into an authenticated-but-locked state — the website is the
    // only place they can self-serve from here.
    if (data.user) {
      try {
        const fp = fingerprint ?? (await AuthSvc.Fingerprint().catch(() => null))
        if (fp) {
          const s = await api.accountStatus(data.user.id, fp)
          if (s.status === "trial_expired") {
            await supabase.auth.signOut().catch(() => {})
            await AuthSvc.ClearSession().catch(() => {})
            return { ok: false, error: "trial_expired_purchase_required" }
          }
          if (s.status === "no_access") {
            await supabase.auth.signOut().catch(() => {})
            await AuthSvc.ClearSession().catch(() => {})
            return { ok: false, error: "no_access_purchase_required" }
          }
          if (s.status === "banned" || s.status === "suspended") {
            await supabase.auth.signOut().catch(() => {})
            await AuthSvc.ClearSession().catch(() => {})
            return { ok: false, error: s.status }
          }
        }
      } catch {
        // Network failure: fall through. If the user has a cached good
        // status the offline path will hydrate it; if not, the _app
        // gate still catches an expired account once status loads.
      }
    }
    return { ok: true }
  }

  const updateBranding = async (patch: {
    orgName?: string | null
    orgLogo?: string | null
  }): Promise<LoginResult> => {
    if (!session?.user) return { ok: false, error: "not_signed_in" }
    try {
      const body: { org_name?: string | null; org_logo?: string | null } = {}
      if (patch.orgName !== undefined) body.org_name = patch.orgName
      if (patch.orgLogo !== undefined) body.org_logo = patch.orgLogo
      const res = await api.updateProfile(body)
      setProfile({
        orgName: res.profile?.org_name ?? null,
        orgLogo: res.profile?.org_logo ?? null,
      })
      return { ok: true }
    } catch (e) {
      const body = (e as { body?: { error?: string } })?.body
      return { ok: false, error: body?.error ?? "update_failed" }
    }
  }

  const acknowledgeOnboarding = () => setIsFreshSignup(false)

  const signupTrial = async (email: string, password: string): Promise<LoginResult> => {
    if (!fingerprint) return { ok: false, error: "fingerprint_unavailable" }
    let pre: { ok: boolean; reason?: string }
    try {
      pre = await api.precheckTrial(fingerprint)
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? "offline" }
    }
    if (!pre.ok) return { ok: false, error: describeReason(pre.reason ?? "unknown") }
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { ok: false, error: error.message }
    if (!data.user) return { ok: false, error: "signup_no_user" }
    try {
      await api.finalizeTrial(data.user.id, fingerprint)
    } catch (e) {
      const body = (e as { body?: { error?: string } })?.body
      return { ok: false, error: body?.error ?? "trial_finalize_failed" }
    }
    setIsFreshSignup(true)
    return { ok: true }
  }

  const signupWithLicense = async (
    email: string,
    password: string,
    license: string
  ): Promise<LoginResult> => {
    let check: { valid: boolean; reason?: string }
    try {
      check = await api.checkLicense(license)
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? "offline" }
    }
    if (!check.valid) return { ok: false, error: describeReason(check.reason ?? "unknown") }
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { ok: false, error: error.message }
    if (!data.user) return { ok: false, error: "signup_no_user" }
    try {
      await api.redeemLicense(license, data.user.id)
    } catch (e) {
      const body = (e as { body?: { error?: string } })?.body
      return { ok: false, error: body?.error ?? "redeem_failed" }
    }
    if (fingerprint) api.fingerprintPulse(fingerprint).catch(() => {})
    setIsFreshSignup(true)
    return { ok: true }
  }

  const startTrialExisting = async (): Promise<LoginResult> => {
    if (!session?.user) return { ok: false, error: "not_signed_in" }
    if (!fingerprint) return { ok: false, error: "fingerprint_unavailable" }
    try {
      await api.startTrialExisting(fingerprint)
      await refreshAccount()
      return { ok: true }
    } catch (e) {
      const body = (e as { body?: { error?: string } })?.body
      return { ok: false, error: body?.error ?? "trial_failed" }
    }
  }

  const redeemLicenseExisting = async (license: string): Promise<LoginResult> => {
    if (!session?.user) return { ok: false, error: "not_signed_in" }
    let check: { valid: boolean; reason?: string }
    try {
      check = await api.checkLicense(license)
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? "offline" }
    }
    if (!check.valid) return { ok: false, error: describeReason(check.reason ?? "unknown") }
    try {
      await api.redeemLicense(license, session.user.id)
    } catch (e) {
      const body = (e as { body?: { error?: string } })?.body
      return { ok: false, error: body?.error ?? "redeem_failed" }
    }
    await refreshAccount()
    // First-time license redemption (post-trial upgrade, or any signed-in
    // user activating a key) flips the same fresh-signup flag the original
    // signup paths use. The auth route reads it and renders BrandingSetup
    // so the operator can pick a name + logo before landing in the
    // workspace. Without this, license upgrades silently bypassed the
    // onboarding card and dropped users into a "Your church" default.
    setIsFreshSignup(true)
    return { ok: true }
  }

  const logout = async () => {
    await supabase.auth.signOut().catch(() => {})
    await AuthSvc.ClearSession().catch(() => {})
    if (session?.user?.id) clearCachedAccount(session.user.id)
    setAccount(null)
    setSession(null)
    setProfile(null)
    setIsFreshSignup(false)
  }

  const value: AuthContextValue = useMemo(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      account,
      fingerprint,
      isAuthenticated: !!session?.user,
      kick,
      profile,
      isFreshSignup,
      login,
      signupTrial,
      signupWithLicense,
      startTrialExisting,
      redeemLicenseExisting,
      logout,
      refreshAccount,
      updateBranding,
      acknowledgeOnboarding,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, loading, account, fingerprint, kick, profile, isFreshSignup]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useAuth outside AuthProvider")
  return ctx
}

// Non-throwing variant for components that can legitimately mount outside
// the provider (e.g. a global error-recovery modal, dev StrictMode double-
// render). Returns null instead of throwing so the caller can no-op rather
// than crash the recovery tree.
export function useTryAuth(): AuthContextValue | null {
  return useContext(Ctx)
}

// Supabase signals an actually-bad refresh token with specific error names
// or messages ("invalid_grant", refresh_token_not_found). Anything else —
// network down, DNS, CORS, TLS — should be treated as transient so we
// don't wipe a perfectly good session on an offline boot.
function isAuthRejection(error: AuthError): boolean {
  const name = (error.name || "").toLowerCase()
  const msg = (error.message || "").toLowerCase()
  if (name.includes("retryable") || name.includes("network") || name.includes("fetch")) {
    return false
  }
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timeout")) {
    return false
  }
  return (
    msg.includes("invalid_grant") ||
    msg.includes("invalid refresh token") ||
    msg.includes("refresh_token_not_found") ||
    msg.includes("refresh token not found") ||
    msg.includes("user not found") ||
    msg.includes("jwt") ||
    msg.includes("expired")
  )
}

// Build a minimal Session-shaped object from the locally-cached tokens so
// the UI can render past auth.loading even when the network is down and
// Supabase couldn't validate the session itself. Once connectivity is
// restored, Supabase replaces this with a real Session via
// onAuthStateChange.
function synthesiseSession(stored: SessionData): Session {
  return {
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    expires_at: stored.expires_at || undefined,
    expires_in: 0,
    token_type: "bearer",
    user: {
      id: stored.user_id,
      email: stored.email,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "",
    } as User,
  } as Session
}

const CACHE_PREFIX = "np.account."

function cacheKey(userId: string): string {
  return `${CACHE_PREFIX}${userId}`
}

function writeCachedAccount(userId: string, s: AccountStatus): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(s))
  } catch { /* quota / private-mode — non-fatal */ }
}

function readCachedAccount(userId: string): AccountStatus | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId))
    if (!raw) return null
    return JSON.parse(raw) as AccountStatus
  } catch {
    return null
  }
}

function clearCachedAccount(userId: string): void {
  try { localStorage.removeItem(cacheKey(userId)) } catch { /* noop */ }
}

// Re-evaluate the cached status against the current clock so a trial or
// license that lapsed while the device was offline still locks the app
// down. Licenses with `expires_at == null` are perpetual.
function deriveOffline(cached: AccountStatus | null): AccountStatus | null {
  if (!cached) return null
  const now = Date.now()
  const next: AccountStatus = { ...cached }
  if (next.license) {
    const exp = next.license.expires_at ? Date.parse(next.license.expires_at) : null
    if (exp !== null && !Number.isNaN(exp) && exp <= now) {
      next.license = null
      next.status = "no_access"
    } else {
      next.status = "licensed"
    }
  }
  if (!next.license && next.trial) {
    const exp = Date.parse(next.trial.expires_at)
    if (Number.isNaN(exp)) {
      // Bad timestamp — fall through with last-known status.
    } else if (exp <= now) {
      next.trial = { ...next.trial, ms_remaining: 0, expired: true }
      next.status = "trial_expired"
    } else {
      next.trial = { ...next.trial, ms_remaining: exp - now, expired: false }
      next.status = "trial"
    }
  }
  return next
}

function describeReason(r: string): string {
  switch (r) {
    case "format": return "License key doesn't match the expected format."
    case "not_found": return "License key not recognised."
    case "revoked": return "This license has been revoked."
    case "expired": return "This license has expired."
    case "already_assigned": return "License is already assigned to another account."
    case "banned": return "This device has been blocked from creating accounts."
    case "trial_already_used": return "This device has already used the free trial."
    case "trial_abuse": return "Trial-abuse detected. Contact support."
    case "fingerprint_missing": return "Could not identify this device."
    case "fingerprint_unavailable": return "Device identity unavailable. Restart the app."
    case "offline": return "Couldn't reach the license server."
    default: return r
  }
}
