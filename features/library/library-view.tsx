import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/lib/utils"
import { ScriptureTab } from "@/features/library/scripture-tab"
import { SongsTab } from "@/features/library/songs-tab"
import { MediaTab } from "@/features/library/media-tab"

type Tab = "scripture" | "songs" | "media"

const TABS: { key: Tab; label: string }[] = [
  { key: "scripture", label: "Scripture" },
  { key: "songs", label: "Songs" },
  { key: "media", label: "Media" },
]

export function LibraryView() {
  const [active, setActive] = useState<Tab>("scripture")

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-7 shrink-0 items-center border-b border-border/50">
        {TABS.map((t) => {
          const isActive = t.key === active
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={cn(
                "relative h-full px-3 text-[10px] font-medium uppercase tracking-wider transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground"
              )}
            >
              {t.label}
              {isActive && (
                <span className="absolute inset-x-2 -bottom-px h-px bg-foreground" />
              )}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            className="h-full"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {active === "scripture" && <ScriptureTab />}
            {active === "songs" && <SongsTab />}
            {active === "media" && <MediaTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
