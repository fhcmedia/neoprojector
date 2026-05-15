export type BoxState = {
  id: string
  type: "title" | "content"
  x: number
  y: number
  w: number
  h: number
  fontSize: number
  fontFamily: string
  color: string
}

export type AnimationState = {
  type: "none" | "fade" | "slide"
  duration: number
}

export type SlideState = {
  bgType: "color" | "gradient" | "image"
  bgColor: string
  bgImage?: string
  boxes: BoxState[]
  animation: AnimationState
  overrides: Record<string, {
    boxes?: BoxState[]
    title?: string
    content?: string
  }>
}

export const DEFAULT_STATE: SlideState = {
  bgType: "gradient",
  bgColor: "linear-gradient(to bottom right, #0f172a, #1e293b)",
  boxes: [
    {
      id: "content",
      type: "content",
      x: 100,
      y: 200,
      w: 1720,
      h: 780,
      fontSize: 72,
      fontFamily: "Roboto",
      color: "#ffffff",
    },
  ],
  animation: { type: "none", duration: 0.5 },
  overrides: {},
}

export type SlidePreview = {
  id: string
  title: string
  content: string
  sectionId?: number
}
