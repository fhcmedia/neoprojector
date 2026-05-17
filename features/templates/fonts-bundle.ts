// Side-effect imports that pull every picker-listed font into the app
// bundle. Each @fontsource/<name>/<weight>.css injects an @font-face
// rule whose `src` points at a woff2 file that vite copies into the
// build's asset graph — so the produced binary ships fonts and the
// app renders correctly offline. Replaces the previous Google Fonts
// URL @import.
//
// Weight strategy:
// - High-use families (Inter for UI, Geist + Geist Mono for templates):
//   300..700 covers panels, headings, body, and bold.
// - Other families: 400 (regular) and 700 (bold) — keeps the bundle
//   from ballooning while still letting picker users hit a useful
//   contrast range. Templates that demand a specific weight a family
//   doesn't ship will synthesise a faux-bold; not ideal, but contained.
// - Single-weight families (Bebas Neue, Archivo Black, Pacifico): the
//   package root is the only file — import it directly.
//
// To add weights for a specific family, add explicit imports here. The
// `features/templates/fonts.ts` picker list is the source of truth for
// which family names exist; this file is what makes those names
// resolvable at render time.

// High-use families — full weight range
import "@fontsource/inter/300.css"
import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "@fontsource/inter/700.css"
import "@fontsource/geist/300.css"
import "@fontsource/geist/400.css"
import "@fontsource/geist/500.css"
import "@fontsource/geist/600.css"
import "@fontsource/geist/700.css"
import "@fontsource/geist-mono/300.css"
import "@fontsource/geist-mono/400.css"
import "@fontsource/geist-mono/500.css"
import "@fontsource/geist-mono/600.css"
import "@fontsource/geist-mono/700.css"

// Sans — 400 / 700
import "@fontsource/roboto/400.css"
import "@fontsource/roboto/700.css"
import "@fontsource/open-sans/400.css"
import "@fontsource/open-sans/700.css"
import "@fontsource/lato/400.css"
import "@fontsource/lato/700.css"
import "@fontsource/source-sans-3/400.css"
import "@fontsource/source-sans-3/700.css"
import "@fontsource/nunito/400.css"
import "@fontsource/nunito/700.css"
import "@fontsource/work-sans/400.css"
import "@fontsource/work-sans/700.css"
import "@fontsource/dm-sans/400.css"
import "@fontsource/dm-sans/700.css"
import "@fontsource/manrope/400.css"
import "@fontsource/manrope/700.css"

// Display sans — 400 / 700
import "@fontsource/montserrat/400.css"
import "@fontsource/montserrat/700.css"
import "@fontsource/poppins/400.css"
import "@fontsource/poppins/700.css"
import "@fontsource/raleway/400.css"
import "@fontsource/raleway/700.css"
import "@fontsource/oswald/400.css"
import "@fontsource/oswald/700.css"

// Single-weight display
import "@fontsource/bebas-neue/400.css"
import "@fontsource/archivo-black/400.css"

// Serif — 400 / 700
import "@fontsource/playfair-display/400.css"
import "@fontsource/playfair-display/700.css"
import "@fontsource/merriweather/400.css"
import "@fontsource/merriweather/700.css"
import "@fontsource/lora/400.css"
import "@fontsource/lora/700.css"
import "@fontsource/eb-garamond/400.css"
import "@fontsource/eb-garamond/700.css"
import "@fontsource/crimson-pro/400.css"
import "@fontsource/crimson-pro/700.css"
import "@fontsource/pt-serif/400.css"
import "@fontsource/pt-serif/700.css"
import "@fontsource/source-serif-4/400.css"
import "@fontsource/source-serif-4/700.css"

// Mono — 400 / 700 (Geist Mono handled above)
import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/jetbrains-mono/700.css"
import "@fontsource/fira-code/400.css"
import "@fontsource/fira-code/700.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/700.css"
import "@fontsource/roboto-mono/400.css"
import "@fontsource/roboto-mono/700.css"
import "@fontsource/source-code-pro/400.css"
import "@fontsource/source-code-pro/700.css"

// Handwritten / decorative
import "@fontsource/dancing-script/400.css"
import "@fontsource/dancing-script/700.css"
import "@fontsource/pacifico/400.css"
import "@fontsource/caveat/400.css"
import "@fontsource/caveat/700.css"
