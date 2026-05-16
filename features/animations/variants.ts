// Single source of truth for motion presets used on the output side
// (template slide transitions and overlay enter/exit). Adding a new
// AnimKind is one entry in the literal union + a matching record in
// VARIANTS. Consumers stay framework-stable (just pass {variants,
// transition} to motion.div).
//
// The output side is the only consumer — these animations are part
// of the live presentation, not the in-app UI. The Settings → UI
// animations toggle does NOT gate these.

import type { Transition, Variants } from "motion/react"

export type AnimKind =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "scale"
  | "blur"
  | "zoom-blur"
  | "flip-up"
  | "wipe-up"
  | "rise"

export const ANIM_KINDS: { kind: AnimKind; label: string }[] = [
  { kind: "fade", label: "Fade" },
  { kind: "slide-up", label: "Slide up" },
  { kind: "slide-down", label: "Slide down" },
  { kind: "slide-left", label: "Slide left" },
  { kind: "slide-right", label: "Slide right" },
  { kind: "scale", label: "Scale" },
  { kind: "blur", label: "Blur" },
  { kind: "zoom-blur", label: "Zoom + blur" },
  { kind: "flip-up", label: "Flip up" },
  { kind: "wipe-up", label: "Wipe up" },
  { kind: "rise", label: "Rise" },
  { kind: "none", label: "None (cut)" },
]

// Each variant defines all three motion states (hidden / visible /
// exiting) so callers can use the same record for both enter and
// exit phases. AnimatePresence picks `exit` automatically; entering
// elements go from `hidden` → `visible`.
type VariantSet = {
  variants: Variants
  transition: Transition
}

// distance used by slide variants — keep them subtle. Output canvas
// is large; small offsets read as "smooth" rather than "swooshy."
const SLIDE = "4%"

export const VARIANTS: Record<AnimKind, VariantSet> = {
  none: {
    variants: {
      hidden: { opacity: 1 },
      visible: { opacity: 1 },
    },
    transition: { duration: 0 },
  },
  fade: {
    variants: {
      hidden: { opacity: 0 },
      visible: { opacity: 1 },
    },
    transition: { duration: 0.18, ease: [0.32, 0.72, 0, 1] },
  },
  "slide-up": {
    variants: {
      hidden: { opacity: 0, y: SLIDE },
      visible: { opacity: 1, y: 0 },
    },
    transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
  },
  "slide-down": {
    variants: {
      hidden: { opacity: 0, y: `-${SLIDE}` },
      visible: { opacity: 1, y: 0 },
    },
    transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
  },
  "slide-left": {
    variants: {
      hidden: { opacity: 0, x: SLIDE },
      visible: { opacity: 1, x: 0 },
    },
    transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
  },
  "slide-right": {
    variants: {
      hidden: { opacity: 0, x: `-${SLIDE}` },
      visible: { opacity: 1, x: 0 },
    },
    transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
  },
  scale: {
    variants: {
      hidden: { opacity: 0, scale: 0.97 },
      visible: { opacity: 1, scale: 1 },
    },
    transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
  },
  blur: {
    variants: {
      hidden: { opacity: 0, filter: "blur(8px)" },
      visible: { opacity: 1, filter: "blur(0px)" },
    },
    transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] },
  },
  "zoom-blur": {
    variants: {
      hidden: { opacity: 0, scale: 1.08, filter: "blur(12px)" },
      visible: { opacity: 1, scale: 1, filter: "blur(0px)" },
    },
    transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] },
  },
  "flip-up": {
    variants: {
      hidden: { opacity: 0, rotateX: 12, y: SLIDE },
      visible: { opacity: 1, rotateX: 0, y: 0 },
    },
    transition: { duration: 0.28, ease: [0.32, 0.72, 0, 1] },
  },
  "wipe-up": {
    variants: {
      hidden: { opacity: 0, clipPath: "inset(100% 0% 0% 0%)" },
      visible: { opacity: 1, clipPath: "inset(0% 0% 0% 0%)" },
    },
    transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] },
  },
  rise: {
    variants: {
      hidden: { opacity: 0, y: "8%", scale: 0.98 },
      visible: { opacity: 1, y: 0, scale: 1 },
    },
    transition: { duration: 0.26, ease: [0.32, 0.72, 0, 1] },
  },
}

export function variantsFor(kind: AnimKind | undefined): VariantSet {
  return VARIANTS[kind ?? "fade"] ?? VARIANTS.fade
}

// Helper: motion props for an enter-only AnimatePresence child (used
// when only one direction needs custom variants and the exit can
// mirror the entry).
export function motionProps(kind: AnimKind | undefined, durationMs?: number) {
  const v = variantsFor(kind)
  const t = durationMs !== undefined
    ? { ...v.transition, duration: durationMs / 1000 }
    : v.transition
  return {
    variants: v.variants,
    initial: "hidden",
    animate: "visible",
    exit: "hidden",
    transition: t,
  }
}
