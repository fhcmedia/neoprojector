import { useEffect } from "react"
import { Events } from "@wailsio/runtime"
import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as LiveUpdate } from "@/bindings/neoprojector/services/liveupdate"
import type { Status } from "@/bindings/neoprojector/services/liveupdate"
import { Switch } from "@/components/switch"

// Instant updates (services/liveupdate): with the setting on, a new
// version installs while the app runs, and the screens keep showing
// what they show while the new version takes over.

const keys = {
  supported: ["liveupdate", "supported"] as const,
  enabled: ["liveupdate", "enabled"] as const,
  status: ["liveupdate", "status"] as const,
}

// InstantUpdateToggle is the Settings switch, with what it's doing.
export function InstantUpdateToggle() {
  const qc = useQueryClient()
  const { data: supported } = useQuery({
    queryKey: keys.supported,
    queryFn: () => LiveUpdate.Supported(),
    staleTime: Infinity,
  })
  const { data: enabled = false } = useQuery({
    queryKey: keys.enabled,
    queryFn: () => LiveUpdate.Enabled(),
  })
  const { data: status } = useQuery({
    queryKey: keys.status,
    queryFn: () => LiveUpdate.Status() as Promise<Status>,
  })
  useEffect(() => {
    const off = Events.On("liveupdate:status", () => {
      void qc.invalidateQueries({ queryKey: keys.status })
    })
    return () => {
      off?.()
    }
  }, [qc])
  const set = useMutation({
    mutationFn: (on: boolean) => LiveUpdate.SetEnabled(on),
    onMutate: (on) => qc.setQueryData(keys.enabled, on),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.enabled }),
  })

  const line =
    supported === false
      ? "Not available in this build"
      : status?.state === "downloading"
        ? `Downloading v${status.version}…`
        : status?.state === "switching"
          ? `Switching to v${status.version}…`
          : status?.state === "failed"
            ? `v${status.version} didn't install: ${status.error}`
            : enabled
              ? "Checks every minute"
              : ""
  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <Switch
        checked={enabled && supported !== false}
        disabled={supported === false}
        onCheckedChange={(on) => set.mutate(on)}
        aria-label="Toggle instant updates"
      />
      {line && (
        <span className="max-w-56 text-[10px] text-muted-foreground">{line}</span>
      )}
    </div>
  )
}

// InstantUpdateNotice keeps the operator posted on an instant update:
// found and downloading, switching (hold off clicking for a few
// seconds), or failed. It's mounted in the operator shell only, where
// the Toaster lives; projector and stage screens never show it.
export function InstantUpdateNotice() {
  useEffect(() => {
    const off = Events.On("liveupdate:status", (e: { data?: Status }) => {
      const st = e.data
      if (!st) return
      if (st.state === "downloading") {
        toast.loading(`New version v${st.version} found`, {
          id: "liveupdate",
          description:
            "Downloading now. It installs by itself in a moment; the screens stay on.",
        })
      } else if (st.state === "switching") {
        toast.loading(`Updating to v${st.version}`, {
          id: "liveupdate",
          description: "The screens stay on. Wait a few seconds before clicking.",
        })
      } else if (st.state === "failed") {
        toast.error(`Update to v${st.version} didn't finish`, {
          id: "liveupdate",
          description: `Still running this version. ${st.error ?? ""}`,
        })
      } else if (st.state === "idle") {
        toast.dismiss("liveupdate")
      }
    })
    return () => {
      off?.()
    }
  }, [])
  return null
}
