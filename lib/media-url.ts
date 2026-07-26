import { useQuery } from "@tanstack/react-query"
import { MediaServer } from "@/bindings/neoprojector/app"

export type MediaServerConn = { port: number; token: string }

// Video is served over a real loopback TCP socket instead of through
// the wails webview asset bridge — see MediaServer's doc comment
// (bindings/neoprojector/app.ts, sourced from app.go) for why: on
// Windows that bridge buffers an entire response in memory before
// streaming it to WebView2, which freezes or crashes the app on a
// several-minute video. Resolved once per app session and cached —
// the port/token don't change while the app is running.
//
// Exported (not just the single-id convenience hook below) for
// callers that build URLs for a dynamic-length list of media ids —
// calling useVideoAssetUrl once per id in a .map() would call a
// variable number of hooks per render, which breaks the rules of
// hooks. Those callers call this once and build URLs with
// videoAssetUrl() in a plain loop instead.
export function useMediaServerConn(): MediaServerConn | undefined {
  const { data } = useQuery({
    queryKey: ["mediaServer"],
    queryFn: () => MediaServer(),
    staleTime: Infinity,
    gcTime: Infinity,
  })
  return data
}

// Plain (non-hook) URL builder — pair with useMediaServerConn() when
// building URLs for more than one id per component.
export function videoAssetUrl(
  conn: MediaServerConn | undefined,
  mediaId: number | null | undefined
): string | undefined {
  if (mediaId === null || mediaId === undefined || !conn) return undefined
  return `http://127.0.0.1:${conn.port}/media-asset/${mediaId}?t=${conn.token}`
}

// Builds the loopback URL for a single video's bytes. Returns
// undefined until the server info resolves (a beat after app
// startup) or when there's no media id yet — callers already handle
// an undefined/empty <video src> the same way a not-yet-loaded id is
// handled today.
export function useVideoAssetUrl(
  mediaId: number | null | undefined
): string | undefined {
  const conn = useMediaServerConn()
  return videoAssetUrl(conn, mediaId)
}
