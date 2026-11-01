import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { QRCode } from "react-qr-code"
import { MonitorSmartphoneIcon, RefreshCwIcon } from "lucide-react"
import { Service as Stage } from "@/bindings/neoprojector/services/stage"
import type { Status } from "@/bindings/neoprojector/services/stage"
import { Button } from "@/components/button"
import { Switch } from "@/components/switch"

// Stage display: the sermon timer on a phone, tablet, laptop or smart TV
// over the church network (services/stage). The answer for HDMI-splitter
// setups, where every screen shows the same picture and a "stage only"
// timer can't exist on the projector output.

const KEY = ["stage", "status"] as const

export function useStageStatus() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => Stage.Status() as unknown as Promise<Status>,
  })
}

export function StageDisplayCard({ compact }: { compact?: boolean }) {
  const qc = useQueryClient()
  const { data: st } = useStageStatus()
  const set = (s: Status) => qc.setQueryData(KEY, s)
  const toggle = useMutation({
    mutationFn: (on: boolean) => Stage.SetEnabled(on) as unknown as Promise<Status>,
    onSuccess: set,
  })
  const newLink = useMutation({
    mutationFn: () => Stage.NewLink() as unknown as Promise<Status>,
    onSuccess: set,
  })
  const url = st?.urls?.[0]

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
      <div className="flex items-start gap-2">
        <MonitorSmartphoneIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-1 flex-col gap-1">
          <span className="font-medium">Stage display on a phone, tablet or TV</span>
          <span className="text-muted-foreground">
            Using an HDMI splitter? Every screen then shows the same
            picture, so a timer just for the preacher can't go through it.
            Instead, open the sermon timer on any device on the church
            network — it shows full-screen, the projector stays clean.
            {compact ? "" : " Set the timer's “Show on” to no screens if the audience shouldn't see it."}
          </span>
        </div>
        <Switch
          checked={!!st?.enabled}
          onCheckedChange={(v) => toggle.mutate(v)}
          aria-label="Stage display"
        />
      </div>
      {st?.enabled && st.error && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-300">
          {st.error}
        </div>
      )}
      {st?.enabled && url && (
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded bg-white p-1.5">
            <QRCode value={url} size={compact ? 84 : 112} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-muted-foreground">
              Scan with the device's camera, or type:
            </span>
            <span className="select-all break-all font-mono text-[13px] text-foreground">
              {url}
            </span>
            {st.urls.length > 1 && (
              <span className="text-[10px] text-muted-foreground/70">
                Other networks: {st.urls.slice(1).join(" · ")}
              </span>
            )}
            {!compact && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="xs" variant="outline" onClick={() => newLink.mutate()}>
                  <RefreshCwIcon className="size-3" />
                  New link
                </Button>
                <span className="text-[10px] text-muted-foreground/70">
                  Old links and QR codes stop working.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {st?.enabled && !compact && (
        <span className="text-[10px] text-muted-foreground/70">
          The device must be on the same network as this computer. If
          Windows asks about the firewall, allow private networks. Set the
          device's screen to stay on while it's showing the timer.
        </span>
      )}
    </div>
  )
}
