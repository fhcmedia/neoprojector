import { ImageIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMediaItem } from "@/lib/media-item"
import { useVideoAssetUrl } from "@/lib/media-url"

// SlideMedia draws a presentation slide's image or video. thumb: a still
// (videos parked on an early frame, never playing); otherwise videos play
// muted and looping, like on the projector. fit: deck pages letterbox
// ("contain"), photos fill ("cover"), as the outputs do.
export function SlideMedia({
  mediaId,
  fit = "cover",
  thumb = false,
  className,
}: {
  mediaId: number
  fit?: "cover" | "contain"
  thumb?: boolean
  className?: string
}) {
  const { item } = useMediaItem(mediaId)
  const videoSrc = useVideoAssetUrl(item?.type === "video" ? mediaId : undefined)
  const objectFit = fit === "contain" ? "object-contain" : "object-cover"
  if (!item) {
    return (
      <div className={cn("grid h-full w-full place-items-center bg-muted/30 text-muted-foreground/40", className)}>
        <ImageIcon className="size-5 opacity-60" />
      </div>
    )
  }
  if (item.type === "image") {
    return (
      <img
        src={`/media-asset/${mediaId}`}
        alt={item.title || ""}
        className={cn("absolute inset-0 h-full w-full", objectFit, className)}
        loading="lazy"
        draggable={false}
      />
    )
  }
  if (item.type === "video") {
    return thumb ? (
      <video
        src={videoSrc}
        muted
        playsInline
        preload="metadata"
        className={cn("absolute inset-0 h-full w-full", objectFit, className)}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget
          const t = Math.min(0.5, Math.max(0, (el.duration || 0) - 0.1))
          if (Number.isFinite(t) && t > 0) el.currentTime = t
        }}
      />
    ) : (
      <video
        src={videoSrc}
        muted
        playsInline
        autoPlay
        loop
        className={cn("absolute inset-0 h-full w-full", objectFit, className)}
      />
    )
  }
  return (
    <div className={cn("grid h-full w-full place-items-center bg-muted/30 text-muted-foreground/40", className)}>
      <ImageIcon className="size-5 opacity-60" />
    </div>
  )
}
