import { supabase } from "./supabase"
import type { FingerprintInfo } from "@/bindings/neoprojector/services/auth"

// Railway server base URL. Defaults to localhost while in dev; production
// builds embed the real domain via VITE_API_URL.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080"

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const t = data.session?.access_token
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const { auth = false, headers, ...rest } = init
  const extra = auth ? await authHeader() : {}
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...extra,
      ...(headers as Record<string, string> | undefined),
    },
  })
  if (!res.ok) {
    let body: unknown = null
    try { body = await res.json() } catch { /* noop */ }
    const err = new Error(`HTTP ${res.status}`) as Error & { status: number; body: unknown }
    err.status = res.status
    err.body = body
    throw err
  }
  return res.json() as Promise<T>
}

export type CheckLicense =
  | { valid: true; license: { key: string; plan: string; max_displays: number; expires_at: string | null } }
  | { valid: false; reason: string }

export type PrecheckTrial =
  | { ok: true; hash: string; network: string | null }
  | { ok: false; reason: string; detail?: string }

export type AccountStatus = {
  status: "licensed" | "trial" | "trial_expired" | "suspended" | "no_access" | "banned" | "not_found"
  suspended: boolean
  license: {
    key: string
    plan: string
    max_displays: number
    status: string
    expires_at: string | null
  } | null
  trial: {
    started_at: string
    expires_at: string
    ms_remaining: number
    expired: boolean
  } | null
}

export const api = {
  async checkLicense(key: string): Promise<CheckLicense> {
    return request("/api/auth/check-license", {
      method: "POST",
      body: JSON.stringify({ key }),
    })
  },
  async redeemLicense(key: string, userId: string): Promise<{ ok: true }> {
    return request("/api/auth/redeem-license", {
      method: "POST",
      body: JSON.stringify({ key, user_id: userId }),
    })
  },
  async precheckTrial(fp: FingerprintInfo): Promise<PrecheckTrial> {
    return request("/api/auth/precheck-trial", {
      method: "POST",
      body: JSON.stringify(fp),
    })
  },
  async finalizeTrial(userId: string, fp: FingerprintInfo): Promise<{
    ok: true
    trial: { started_at: string; expires_at: string; days: number }
  }> {
    return request("/api/auth/finalize-trial", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, ...fp }),
    })
  },
  async accountStatus(userId: string, fp: FingerprintInfo): Promise<AccountStatus> {
    return request("/api/auth/account-status", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        fingerprint: fp.fingerprint,
        network_signature: fp.network_signature,
      }),
    })
  },
  async startSession(licenseKey: string | null, fp: FingerprintInfo): Promise<{
    session: { id: string }
  }> {
    return request("/api/user/me/session/start", {
      method: "POST",
      auth: true,
      body: JSON.stringify({
        license_key: licenseKey,
        device_name: fp.hostname,
        platform: fp.platform,
      }),
    })
  },
  async sessionHeartbeat(sessionId: string): Promise<{ ok: true }> {
    return request(`/api/user/me/session/${sessionId}/heartbeat`, {
      method: "POST",
      auth: true,
    })
  },
  async endSession(sessionId: string): Promise<{ ok: true }> {
    return request(`/api/user/me/session/${sessionId}/end`, {
      method: "POST",
      auth: true,
    })
  },
  async fingerprintPulse(fp: FingerprintInfo): Promise<{ ok: true }> {
    return request("/api/user/me/fingerprint-pulse", {
      method: "POST",
      auth: true,
      body: JSON.stringify(fp),
    })
  },
  async startTrialExisting(fp: FingerprintInfo): Promise<{
    ok: true
    trial: { started_at: string; expires_at: string; ms_remaining: number; expired: false; days: number }
  }> {
    return request("/api/user/me/start-trial", {
      method: "POST",
      auth: true,
      body: JSON.stringify(fp),
    })
  },
  async redeemLicenseExisting(key: string, userId: string): Promise<{ ok: true }> {
    return request("/api/auth/redeem-license", {
      method: "POST",
      body: JSON.stringify({ key, user_id: userId }),
    })
  },
}
