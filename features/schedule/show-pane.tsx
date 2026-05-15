import { useSlides } from "./use-slides"
import { motion, AnimatePresence } from "motion/react"
import { ArrowUpIcon, MonitorOffIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function ShowPane({ 
  liveItem, 
  isLiveEnabled,
  onToggleLive 
}: { 
  liveItem: { itemId?: number, songId?: number, slideId: string } | null
  isLiveEnabled: boolean
  onToggleLive: (enabled: boolean) => void
}) {
  const { slides, slideState } = useSlides(liveItem?.itemId, liveItem?.songId)
  
  const activeSlide = slides.find(s => s.id === liveItem?.slideId)

  return (
    <div className="relative h-full w-full flex flex-col bg-black overflow-hidden">
      {/* Live Output Header / Toolbar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex h-10 items-center justify-between px-3 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Show Output</span>
        </div>
        <button
          onClick={() => onToggleLive(!isLiveEnabled)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors",
            isLiveEnabled 
              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" 
              : "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white"
          )}
        >
          {isLiveEnabled ? <MonitorOffIcon className="size-3" /> : <ArrowUpIcon className="size-3" />}
          {isLiveEnabled ? "Live Output ON" : "Live Output OFF"}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        {/* The Projector Canvas Area */}
        <div 
          className="relative w-full aspect-video rounded-md overflow-hidden bg-zinc-950 ring-1 ring-white/10 shadow-2xl flex items-center justify-center" 
          style={{ 
            containerType: "size",
            background: slideState.bgType === "image" ? `url(${slideState.bgImage}) center/cover no-repeat` : slideState.bgColor 
          }}
        >
          
          {!isLiveEnabled && (
            <div className="absolute inset-0 z-20 bg-black/80 flex items-center justify-center backdrop-blur-sm">
              <span className="text-white/30 text-sm font-medium tracking-widest uppercase">Live Output Disabled</span>
            </div>
          )}

          {isLiveEnabled && !activeSlide && (
            <div className="absolute inset-0 z-20 flex items-center justify-center">
               <span className="text-white/20 text-sm font-medium tracking-widest uppercase">Logo / Blank</span>
            </div>
          )}

          {isLiveEnabled && activeSlide && (
            <div 
              className="absolute inset-0 origin-center"
              style={{ 
                background: slideState.bgType === "image" ? `url(${slideState.bgImage}) center/cover no-repeat` : slideState.bgColor 
              }}
            >
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={activeSlide.id}
                  initial={slideState.animation.type === "fade" ? { opacity: 0 } : slideState.animation.type === "slide" ? { x: 50, opacity: 0 } : { opacity: 1 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={slideState.animation.type === "fade" ? { opacity: 0 } : slideState.animation.type === "slide" ? { x: -50, opacity: 0 } : { opacity: 1 }}
                  transition={{ duration: slideState.animation.duration }}
                  className="absolute inset-0"
                >
                  {(slideState.overrides[activeSlide.id]?.boxes || slideState.boxes).map((box) => {
                    const leftPct = (box.x / 1920) * 100
                    const topPct = (box.y / 1080) * 100
                    const widthPct = (box.w / 1920) * 100
                    const heightPct = (box.h / 1080) * 100
                    return (
                      <div
                        key={box.id}
                        className="absolute flex"
                        style={{
                          left: `${leftPct}%`,
                          top: `${topPct}%`,
                          width: `${widthPct}%`,
                          height: `${heightPct}%`,
                          fontSize: `${(box.fontSize / 1080) * 100}cqh`,
                          fontFamily: box.fontFamily,
                          color: box.color,
                          alignItems: "flex-start",
                          justifyContent: box.type === "title" ? "flex-start" : "center",
                          textAlign: box.type === "title" ? "left" : "center",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {box.type === "title" 
                          ? (slideState.overrides[activeSlide.id]?.title ?? activeSlide.title)
                          : (slideState.overrides[activeSlide.id]?.content ?? activeSlide.content)}
                      </div>
                    )
                  })}
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
