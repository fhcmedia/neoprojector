// Shared storage key + DEV-mock gate for the auth flow.
//
// The "auth" in this app is a development mock — username/password are
// not validated server-side, no token is signed, and the localStorage
// key here is the entire access check. Real auth has not been wired
// yet (license-key flow, server validation, signed sessions).
//
// To make that obvious in production, the route guard and the auth UI
// only enforce/render in dev builds. In production, the mock is
// inaccessible: users land in the app directly. When real auth lands,
// flip MOCK_AUTH_ENABLED off and gate the route on the real session
// instead.

export const AUTH_STORAGE_KEY = "neoprojector.auth"

// Mock auth is only active in dev. In production the auth screen is
// unreachable and the route guard is a no-op.
export const MOCK_AUTH_ENABLED = import.meta.env.DEV

export function hasMockSession(): boolean {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem(AUTH_STORAGE_KEY) !== null
}
