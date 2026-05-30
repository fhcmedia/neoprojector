import { useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { useLive } from "@/features/live/live-context"

// Subscribes to the per-user Supabase Realtime broadcast channel and applies
// phone-remote commands to the live output. Renders nothing. Mounted inside
// the authenticated app shell so both useAuth (user id) and useLive
// (navigators) resolve. Blackout maps to clearLive — output snaps to black.
export function RemoteListener() {
  const { user } = useAuth()
  const { navigateNext, navigatePrev, clearLive } = useLive()
  const uid = user?.id

  useEffect(() => {
    if (!uid) return
    const channel = supabase.channel(`remote:${uid}`, {
      config: { broadcast: { self: false } },
    })
    channel.on("broadcast", { event: "cmd" }, (msg) => {
      const cmd = (msg.payload as { cmd?: string } | undefined)?.cmd
      if (cmd === "next") navigateNext()
      else if (cmd === "prev") navigatePrev()
      else if (cmd === "blackout" || cmd === "clear") clearLive()
    })
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [uid, navigateNext, navigatePrev, clearLive])

  return null
}
