import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select"

// OptionSelect is the app's styled dropdown for a fixed list of string
// options — a thin typed wrapper over the Radix Select so inspector
// panels never fall back to a native <select> (whose OS-drawn option
// list ignores the theme). Compact by default to sit in dense editors.
export function OptionSelect<V extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  className,
}: {
  value: V
  options: readonly { value: V; label: string }[]
  onChange: (v: V) => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as V)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        className={cn("h-8 w-full px-2 text-xs", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" sideOffset={4}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
