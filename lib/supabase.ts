import { createClient } from "@supabase/supabase-js"

// Desktop-app side. We DO NOT use Supabase's localStorage persistence —
// the Go-side encrypted store (services/auth) is the source of truth.
// Supabase sessions are loaded/saved manually via setSession() so that the
// refresh token lives in the OS keyring instead of plaintext in IndexedDB.

const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim() || "http://stub.localhost"
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim() || "stub-anon-key"

if (url === "http://stub.localhost" || anon === "stub-anon-key") {
  // eslint-disable-next-line no-console
  console.warn("[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing")
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
