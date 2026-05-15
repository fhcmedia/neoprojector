// Shared motion variants for the schedule pickers (song / bible / media).
// Each picker root renders a vertical stack — the children stagger in on
// mount and out (reversed) when the picker unmounts, so going back to the
// schedule feels like the picker is "putting itself away" rather than
// disappearing all at once.

export const pickerContainerVariants = {
  visible: {
    transition: { staggerChildren: 0.03, delayChildren: 0.02 },
  },
  hidden: {
    transition: { staggerChildren: 0.025, staggerDirection: -1 },
  },
}

export const pickerRowVariants = {
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.14, ease: [0.32, 0.72, 0, 1] as const },
  },
  hidden: {
    opacity: 0,
    y: -6,
    transition: { duration: 0.1 },
  },
}
