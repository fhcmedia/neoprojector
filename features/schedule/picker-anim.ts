// Shared motion variants for the schedule pickers (song / bible / media).
// Each picker root renders a vertical stack — the children stagger in on
// mount and out (reversed) when the picker unmounts, so going back to the
// schedule feels like the picker is "putting itself away" rather than
// disappearing all at once.

export const pickerContainerVariants = {
  visible: {
    transition: { staggerChildren: 0.05, delayChildren: 0.03 },
  },
  hidden: {
    transition: { staggerChildren: 0.04, staggerDirection: -1 },
  },
}

export const pickerRowVariants = {
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 500, damping: 30 },
  },
  hidden: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.14 },
  },
}
