// Single source of truth for fonts available to templates.
//
// The UI itself uses Inter (loaded by App.css), and template defaults
// align to that so newly-created text boxes match the app's typography
// out of the box. Authors can override per-box via the font picker.
//
// Every entry here must be either (a) a system font present on every
// supported OS, or (b) a Google Font that App.css imports — otherwise
// the picker offers a font that silently falls back to the platform
// default and the editor preview lies about what the audience sees.

// The app's UI font (chrome, menus, panels, the editor itself).
// Applied in App.css body rule; bundled via @fontsource.
export const UI_FONT = "Inter"

// Template default = UI font so the editor preview, picker swatch, and
// default slides all read in the same family the user sees in the app
// chrome. Picker lets authors swap per-box from the curated list in
// FONTS below.
export const TEMPLATE_DEFAULT_FONT = UI_FONT

export type FontCategory =
  | "App"
  | "Sans"
  | "Display Sans"
  | "Serif"
  | "Mono"
  | "Handwritten"
  | "System"

export type Font = {
  family: string
  category: FontCategory
  // True when the family is loaded by App.css via Google Fonts. False
  // means we rely on the OS having the font installed.
  google: boolean
}

// Categorised list. Order within a category is roughly "most useful
// first" so the picker reads top-to-bottom as a usable recommendation.
export const FONTS: readonly Font[] = [
  // App default
  { family: "Inter", category: "App", google: true },

  // Modern sans — the bread and butter of slide text.
  { family: "Geist", category: "Sans", google: true },
  { family: "Roboto", category: "Sans", google: true },
  { family: "Open Sans", category: "Sans", google: true },
  { family: "Lato", category: "Sans", google: true },
  { family: "Source Sans 3", category: "Sans", google: true },
  { family: "Nunito", category: "Sans", google: true },
  { family: "Work Sans", category: "Sans", google: true },
  { family: "DM Sans", category: "Sans", google: true },
  { family: "Manrope", category: "Sans", google: true },

  // Display sans — bigger, more characterful headings.
  { family: "Montserrat", category: "Display Sans", google: true },
  { family: "Poppins", category: "Display Sans", google: true },
  { family: "Raleway", category: "Display Sans", google: true },
  { family: "Bebas Neue", category: "Display Sans", google: true },
  { family: "Oswald", category: "Display Sans", google: true },
  { family: "Archivo Black", category: "Display Sans", google: true },

  // Serif — sermon-text vibes, traditional Bible / hymn typography.
  { family: "Playfair Display", category: "Serif", google: true },
  { family: "Merriweather", category: "Serif", google: true },
  { family: "Lora", category: "Serif", google: true },
  { family: "EB Garamond", category: "Serif", google: true },
  { family: "Crimson Pro", category: "Serif", google: true },
  { family: "PT Serif", category: "Serif", google: true },
  { family: "Source Serif 4", category: "Serif", google: true },

  // Mono — useful for verse references, timers, scripture address text.
  { family: "Geist Mono", category: "Mono", google: true },
  { family: "JetBrains Mono", category: "Mono", google: true },
  { family: "Fira Code", category: "Mono", google: true },
  { family: "IBM Plex Mono", category: "Mono", google: true },
  { family: "Roboto Mono", category: "Mono", google: true },
  { family: "Source Code Pro", category: "Mono", google: true },

  // Handwritten / decorative — occasional event titles.
  { family: "Dancing Script", category: "Handwritten", google: true },
  { family: "Pacifico", category: "Handwritten", google: true },
  { family: "Caveat", category: "Handwritten", google: true },

  // System fallbacks — kept for templates that pre-existed the curated
  // Google set, so older saved data still renders the chosen font.
  // New picks should prefer the Google entries above; these aren't
  // hidden but they sort to the bottom.
  { family: "Arial", category: "System", google: false },
  { family: "Helvetica Neue", category: "System", google: false },
  { family: "Segoe UI", category: "System", google: false },
  { family: "Georgia", category: "System", google: false },
  { family: "Times New Roman", category: "System", google: false },
  { family: "Courier New", category: "System", google: false },
  { family: "Consolas", category: "System", google: false },
  { family: "Impact", category: "System", google: false },
]

// Convenience for places that just want the family names.
export const FONT_FAMILIES: readonly string[] = FONTS.map((f) => f.family)

// Build the Google Fonts CSS @import URL for App.css. Exposed for
// reference / future codegen; not consumed at runtime, App.css holds
// a static copy so the browser can preload at first paint without
// waiting for JS to evaluate this module.
export const GOOGLE_FONTS_IMPORT_URL = (() => {
  const families = FONTS.filter((f) => f.google).map((f) => {
    // Most families look best with 300..700 covered. Heavier weights
    // are needed for display headings; lighter for body. Bebas/Pacifico
    // /Dancing Script only ship one weight — handle those specifically.
    const single = new Set([
      "Bebas Neue",
      "Pacifico",
      "Dancing Script",
      "Caveat",
      "Archivo Black",
    ])
    const name = f.family.replace(/ /g, "+")
    if (single.has(f.family)) return `family=${name}`
    return `family=${name}:wght@300;400;500;600;700;800`
  })
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`
})()
