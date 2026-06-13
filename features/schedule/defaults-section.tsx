import { useState } from "react"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  useBackgrounds,
  useServiceRow,
  useSetServiceBackground,
} from "@/features/backgrounds/api"
import { BackgroundPicker } from "@/features/backgrounds/background-picker"
import { BackgroundView } from "@/features/backgrounds/background-view"

// DefaultsSection: the pinned, non-deletable block at the top of the
// schedule. It is VIRTUAL — not a service_section row — so it cannot
// be deleted, renamed, or reordered by construction. It holds the
// service-level default elements; v1 has exactly one: the default
// background (persisted on service.background_id, so reopening an old
// service restores its defaults). Future default elements (e.g. an
// always-on overlay) get rows here.
export function DefaultsSection({ serviceId }: { serviceId: number }) {
  const { data: serviceRow } = useServiceRow(serviceId)
  const { data: backgrounds } = useBackgrounds()
  const setMut = useSetServiceBackground()
  const [pickerOpen, setPickerOpen] = useState(false)

  const bgId = serviceRow?.background_id?.Valid
    ? serviceRow.background_id.Int64
    : 0
  const doc = bgId !== 0 ? backgrounds?.find((b) => b.id === bgId) : undefined

  return (
    <div className="border-b border-border/40">
      <div className="flex items-center gap-1 border-l-2 border-border/60 py-1.5 pl-1.5 pr-1.5">
        <span className="flex-1 truncate pl-5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Defaults
        </span>
      </div>
      <BackgroundPicker
        value={bgId}
        inheritLabel="None"
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(id) => setMut.mutate({ serviceId, backgroundId: id })}
      >
        <button
          type="button"
          className={cn(
            "group flex w-full items-center gap-2 border-l-2 border-border/60 py-1 pl-5 pr-1.5 text-left text-xs transition-colors hover:bg-muted",
            doc ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/60 hover:text-foreground"
          )}
        >
          <span className="relative h-6 w-10 shrink-0 overflow-hidden border border-border/40 bg-black">
            {doc && (
              <BackgroundView
                background={{
                  background_id: doc.id,
                  engine: doc.engine,
                  config_json: doc.config_json,
                }}
              />
            )}
          </span>
          <span className="truncate">
            Background
            <span className="text-muted-foreground/50">
              {" — "}
              {doc ? doc.name : "none"}
            </span>
          </span>
          <ChevronDownIcon className="ml-auto size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
      </BackgroundPicker>
    </div>
  )
}
