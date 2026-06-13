// Seed background presets. Negative ids, never in the DB — the same
// convention as default templates. A DB row saved WITH one of these
// ids (via Backgrounds.SaveWithID) shadows the seed; deleting that row
// restores it. All four ship grayscale to match the app's flat,
// monochrome aesthetic — color arrives when someone makes their own.
//
// Engine v1 is gradflow: 3 colors + speed/scale/noise + a shader type
// from its fixed set. "Godrays" is an approximation within that set
// (angled stripe bands reading as light shafts); a dedicated shader
// can replace it later without touching the data model — that's what
// the `engine` field is for.

export type BackgroundDoc = {
  id: number
  name: string
  engine: string
  config_json: string
}

function gradflow(config: object): { engine: string; config_json: string } {
  return { engine: "gradflow", config_json: JSON.stringify(config) }
}

export const defaultBackgrounds: BackgroundDoc[] = [
  {
    id: -9001,
    name: "Godrays",
    ...gradflow({
      type: "stripe",
      color1: "#d9d9d9",
      color2: "#101010",
      color3: "#6b6b6b",
      speed: 0.15,
      scale: 1.4,
      noise: 0.06,
    }),
  },
  {
    id: -9002,
    name: "Sand",
    ...gradflow({
      type: "smoke",
      color1: "#c4c4c4",
      color2: "#2b2b2b",
      color3: "#5f5f5f",
      speed: 0.25,
      scale: 1.6,
      noise: 0.5,
    }),
  },
  {
    id: -9003,
    name: "Silk",
    ...gradflow({
      type: "silk",
      color1: "#e0e0e0",
      color2: "#0d0d0d",
      color3: "#8c8c8c",
      speed: 0.4,
      scale: 1.2,
      noise: 0.15,
    }),
  },
  {
    id: -9004,
    name: "Mist",
    ...gradflow({
      type: "smoke",
      color1: "#3d3d3d",
      color2: "#050505",
      color3: "#1f1f1f",
      speed: 0.12,
      scale: 1.8,
      noise: 0.08,
    }),
  },
]

export function isDefaultBackgroundId(id: number): boolean {
  return id < 0
}
