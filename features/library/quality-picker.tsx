import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { GaugeIcon } from "lucide-react"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import { Button } from "@/components/button"
import { OptionSelect } from "@/components/option-select"

// Playback-copy quality (services/transcode presets). 1080p is what the
// optimizer makes by default; lighter copies are for PCs where a video
// still stutters, or for a conversion that failed at full size.

type Quality = "1080p" | "720p" | "480p"

const QUALITIES: readonly { value: Quality; label: string; short: number }[] = [
  { value: "1080p", label: "1080p — best", short: 1080 },
  { value: "720p", label: "720p — lighter, for slower PCs", short: 720 },
  { value: "480p", label: "480p — lightest", short: 480 },
]

// QualityPicker offers the presets that would actually change the file:
// never above its current size (a copy is never upscaled), unless the
// conversion failed (the original is still there, any size works).
export function QualityPicker({
  mediaId,
  width,
  height,
  failed,
  actionLabel,
}: {
  mediaId: number
  width: number
  height: number
  failed?: boolean
  actionLabel?: string
}) {
  const short = Math.min(width, height)
  const options = QUALITIES.filter(
    (q) => failed || short === 0 || q.short < short || (q.short === 1080 && short > 1080)
  )
  const [quality, setQuality] = useState<Quality>(options[0]?.value ?? "720p")
  const mut = useMutation({
    mutationFn: (q: Quality) => Media.Reoptimize(mediaId, q),
  })
  if (options.length === 0) return null
  const value = options.some((o) => o.value === quality) ? quality : options[0].value
  return (
    <div className="flex items-center gap-2">
      <OptionSelect
        value={value}
        options={options}
        onChange={setQuality}
        ariaLabel="Playback quality"
        className="w-52"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={mut.isPending}
        onClick={() => mut.mutate(value)}
      >
        <GaugeIcon className="size-3.5" />
        {actionLabel ?? "Make copy"}
      </Button>
    </div>
  )
}
