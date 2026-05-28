// Shared in-memory representation produced by every per-format
// parser and consumed by the deck-writer. The model is intentionally
// renderer-agnostic — coordinates are normalised in [0, 1], colours
// are sRGB hex strings, fonts are the raw source-document name (font
// substitution happens at render time, not at parse time).
//
// Embedded image bytes live on ParsedImage.Bytes; the writer hashes
// and dedupes them into the media store, then drops a media_id into
// the deck_block row.

package docimport

// ParsedDeck is the unit of import: one deck per source file.
type ParsedDeck struct {
	Title  string
	Width  int64 // canvas pixel width (defaults to 1920 if unknown)
	Height int64 // canvas pixel height (defaults to 1080 if unknown)
	Slides []ParsedSlide
}

// ParsedSlide is one slide / one page / one heading-rooted section.
type ParsedSlide struct {
	Background ParsedBackground
	Notes      string
	Blocks     []ParsedBlock
}

// ParsedBackground captures the slide-level fill. Exactly one of
// Color / GradientStops / Image is populated; ImageBytes is set when
// the background is an embedded raster.
type ParsedBackground struct {
	Color         string         // "#rrggbb" (empty = transparent)
	GradientStops []GradientStop // empty unless Color = "" and gradient is present
	ImageBytes    []byte         // raw bytes; nil when no image
	ImageMime     string         // "image/png" | "image/jpeg" | …
}

type GradientStop struct {
	Offset float64 // 0..1
	Color  string  // "#rrggbb"
}

// ParsedBlock is the parent type for all positioned content. The
// non-empty payload field determines the block kind that lands in
// the deck_block row.
type ParsedBlock struct {
	Z      int64
	X, Y   float64 // [0, 1]
	W, H   float64 // [0, 1]
	Text   *ParsedText
	Image  *ParsedImage
	Shape  *ParsedShape
	Table  *ParsedTable
	Style  ParsedStyle
}

// ParsedText is rich text — a sequence of styled runs plus paragraph
// alignment and line height. The renderer composes runs left-to-right
// and breaks lines at Run.Newline boundaries.
type ParsedText struct {
	Runs       []ParsedRun
	Align      string  // "left" | "center" | "right" | "justify"
	LineHeight float64 // multiplier (0 = renderer default)
}

type ParsedRun struct {
	Text       string
	FontFamily string
	FontSize   float64 // points
	Bold       bool
	Italic     bool
	Underline  bool
	Strike     bool
	Color      string // "#rrggbb"
	Newline    bool   // true = forced line break after this run
}

// ParsedImage carries embedded image bytes. The deck-writer hashes
// these and reuses the same media row when the same bytes appear in
// multiple slides (very common in branded decks).
type ParsedImage struct {
	Bytes   []byte
	Mime    string
	AltText string
}

// ParsedShape is a vector primitive — rect, ellipse, line. Fill /
// stroke are resolved at parse time (theme colours dereferenced)
// so the renderer never has to look up theme XML.
type ParsedShape struct {
	Kind        string  // "rect" | "ellipse" | "line"
	Fill        string  // "#rrggbb" (empty = no fill)
	Stroke      string  // "#rrggbb" (empty = no stroke)
	StrokeWidth float64 // px in source coords; writer normalises
	CornerRadius float64
}

// ParsedTable is a 2D grid of styled cells. Renderer treats each
// cell like a tiny ParsedText.
type ParsedTable struct {
	Rows [][]ParsedTableCell
}

type ParsedTableCell struct {
	Text     ParsedText
	Fill     string
	RowSpan  int
	ColSpan  int
}

// ParsedStyle is the opaque renderer-hints bag that lands in
// style_json. Effects, padding, rotation, and any source-specific
// quirks live here so the deck_block schema doesn't sprout a column
// every time a parser learns a new trick.
type ParsedStyle struct {
	Rotation     float64 // degrees
	Opacity      float64 // 0..1 (0 = inherited / fully opaque)
	PaddingTop   float64
	PaddingRight float64
	PaddingBot   float64
	PaddingLeft  float64
	Effects      []ParsedEffect
	Raw          map[string]any // escape hatch for parser-specific extras
}

type ParsedEffect struct {
	Kind     string         // "shadow" | "glow" | "blur" | …
	Settings map[string]any // free-form per kind
}
