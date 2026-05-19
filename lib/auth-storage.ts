// Real-auth helpers replace the prior dev-only mock. The Supabase session
// itself lives encrypted in services/auth (Go-side). This file only exposes
// helpers used by the router guards.

export const AUTH_REDIRECT_PARAM = "from"

export function buildAuthRedirect(from: string): string {
  if (!from || from === "/auth") return "/auth"
  return `/auth?${AUTH_REDIRECT_PARAM}=${encodeURIComponent(from)}`
}
