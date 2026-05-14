package seed

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// SeedTemplates installs (or refreshes) the default reference
// templates. Idempotent.
//
// Strategy is upsert keyed on the unique name index, with the UPDATE
// clause guarded by is_default = 1. The effect:
//   - first boot: inserts each default.
//   - later boot, app ships an updated default geometry: the existing
//     row gets the new body. User sees the improvement.
//   - user has a row (is_default = 0) whose name collides with a
//     default: ON CONFLICT triggers but the WHERE clause fails, so the
//     INSERT silently no-ops. The user's row wins.
//
// Defaults themselves remain immutable through the API layer
// (services/templates refuses UPDATE/DELETE on is_default rows).
// Duplicate-to-edit is still how the user customizes.
func SeedTemplates(db *sql.DB) error {
	for _, t := range defaultTemplates {
		data, err := json.Marshal(t.Body)
		if err != nil {
			return fmt.Errorf("marshal template %q: %w", t.Name, err)
		}
		if _, err := db.Exec(
			`INSERT INTO template
			   (name, kind, viewport_w, viewport_h, data_json, is_default)
			 VALUES (?, ?, ?, ?, ?, 1)
			 ON CONFLICT(name) DO UPDATE SET
			   kind = excluded.kind,
			   viewport_w = excluded.viewport_w,
			   viewport_h = excluded.viewport_h,
			   data_json = excluded.data_json,
			   updated_at = CURRENT_TIMESTAMP
			 WHERE template.is_default = 1`,
			t.Name, t.Kind, t.ViewportW, t.ViewportH, string(data),
		); err != nil {
			return fmt.Errorf("seed template %q: %w", t.Name, err)
		}
	}
	return nil
}

// templateSeed describes one default. Body is a free-form JSON object
// (boxes, slots, background, etc.) — the renderer is the source of
// truth for the shape; this struct just carries the metadata.
type templateSeed struct {
	Name      string
	Kind      string
	ViewportW int64
	ViewportH int64
	Body      map[string]any
}

// background helpers
func bgColor(hex string) map[string]any {
	return map[string]any{"type": "color", "value": hex}
}

func bgTransparent() map[string]any {
	return map[string]any{"type": "transparent"}
}

// box builds a slot box with sensible defaults. Pass only the fields you
// care about; the rest fall back to the values that make a typical
// centered, white, fit-to-box text block.
type boxOpts struct {
	slot                 string
	x, y, w, h           int
	font                 string
	fontSize             int
	fontSizeMin          int
	fitToBox             bool
	color                string
	weight               int
	italic               bool
	align                string // "left" | "center" | "right"
	vAlign               string // "top" | "middle" | "bottom"
	maxLines             int
	lineHeight           float64
}

func box(o boxOpts) map[string]any {
	if o.font == "" {
		o.font = "Inter"
	}
	if o.fontSize == 0 {
		o.fontSize = 48
	}
	if o.fontSizeMin == 0 {
		o.fontSizeMin = o.fontSize
	}
	if o.color == "" {
		o.color = "#ffffff"
	}
	if o.weight == 0 {
		o.weight = 500
	}
	if o.align == "" {
		o.align = "center"
	}
	if o.vAlign == "" {
		o.vAlign = "middle"
	}
	if o.maxLines == 0 {
		o.maxLines = 6
	}
	if o.lineHeight == 0 {
		o.lineHeight = 1.25
	}
	return map[string]any{
		"slot":        o.slot,
		"x":           o.x,
		"y":           o.y,
		"w":           o.w,
		"h":           o.h,
		"font":        o.font,
		"fontSize":    o.fontSize,
		"fontSizeMin": o.fontSizeMin,
		"fitToBox":    o.fitToBox,
		"color":       o.color,
		"weight":      o.weight,
		"italic":      o.italic,
		"align":       o.align,
		"vAlign":      o.vAlign,
		"maxLines":    o.maxLines,
		"lineHeight":  o.lineHeight,
	}
}

// 1080p canvas. All seeds use the same viewport so they're directly
// comparable — the editor and runtime scale to actual output size.
const (
	vw = 1920
	vh = 1080
)

var defaultTemplates = []templateSeed{
	// --- Bible ---
	{
		Name:      "Bible - One Translation",
		Kind:      "bible",
		ViewportW: vw, ViewportH: vh,
		Body: map[string]any{
			"background": bgColor("#000000"),
			"boxes": []map[string]any{
				box(boxOpts{
					slot: "primary",
					x:    120, y: 240, w: 1680, h: 560,
					fontSize: 64, fontSizeMin: 36, fitToBox: true,
					weight:   500,
					maxLines: 8, lineHeight: 1.3,
				}),
				box(boxOpts{
					slot: "caption",
					x:    120, y: 880, w: 1680, h: 80,
					fontSize: 32, fontSizeMin: 24,
					color: "#cccccc", weight: 400,
					maxLines: 1, lineHeight: 1.0,
				}),
			},
		},
	},
	{
		Name:      "Bible - Two Translations",
		Kind:      "bible",
		ViewportW: vw, ViewportH: vh,
		Body: map[string]any{
			"background": bgColor("#000000"),
			"boxes": []map[string]any{
				box(boxOpts{
					slot: "primary",
					x:    120, y: 140, w: 1680, h: 340,
					fontSize: 56, fontSizeMin: 32, fitToBox: true,
					weight:   500,
					maxLines: 6, lineHeight: 1.25,
				}),
				box(boxOpts{
					slot: "secondary",
					x:    120, y: 520, w: 1680, h: 340,
					fontSize: 56, fontSizeMin: 32, fitToBox: true,
					color:    "#dddddd", weight: 400,
					maxLines: 6, lineHeight: 1.25,
				}),
				box(boxOpts{
					slot: "caption",
					x:    120, y: 900, w: 1680, h: 60,
					fontSize: 28, fontSizeMin: 22,
					color:    "#aaaaaa", weight: 400,
					maxLines: 1, lineHeight: 1.0,
				}),
			},
		},
	},
	{
		Name:      "Bible - Three Translations",
		Kind:      "bible",
		ViewportW: vw, ViewportH: vh,
		Body: map[string]any{
			"background": bgColor("#000000"),
			"boxes": []map[string]any{
				box(boxOpts{
					slot: "primary",
					x:    120, y: 100, w: 1680, h: 240,
					fontSize: 44, fontSizeMin: 28, fitToBox: true,
					weight:   500,
					maxLines: 5, lineHeight: 1.2,
				}),
				box(boxOpts{
					slot: "secondary",
					x:    120, y: 360, w: 1680, h: 240,
					fontSize: 44, fontSizeMin: 28, fitToBox: true,
					color:    "#dddddd", weight: 400,
					maxLines: 5, lineHeight: 1.2,
				}),
				box(boxOpts{
					slot: "tertiary",
					x:    120, y: 620, w: 1680, h: 240,
					fontSize: 44, fontSizeMin: 28, fitToBox: true,
					color:    "#bbbbbb", weight: 400,
					maxLines: 5, lineHeight: 1.2,
				}),
				box(boxOpts{
					slot: "caption",
					x:    120, y: 900, w: 1680, h: 60,
					fontSize: 26, fontSizeMin: 20,
					color:    "#aaaaaa", weight: 400,
					maxLines: 1, lineHeight: 1.0,
				}),
			},
		},
	},
	{
		Name:      "Bible - Lower Thirds",
		Kind:      "bible",
		ViewportW: vw, ViewportH: vh,
		Body: map[string]any{
			"background": bgTransparent(),
			"boxes": []map[string]any{
				box(boxOpts{
					slot: "primary",
					x:    80, y: 800, w: 1760, h: 140,
					fontSize: 42, fontSizeMin: 28, fitToBox: true,
					weight:   500,
					align:    "left",
					maxLines: 3, lineHeight: 1.2,
				}),
				box(boxOpts{
					slot: "caption",
					x:    80, y: 960, w: 1760, h: 40,
					fontSize: 22, fontSizeMin: 18,
					color:    "#cccccc", weight: 400,
					align:    "left",
					maxLines: 1, lineHeight: 1.0,
				}),
			},
		},
	},

	// --- Song ---
	{
		Name:      "Song - Audience",
		Kind:      "song",
		ViewportW: vw, ViewportH: vh,
		Body: map[string]any{
			"background": bgColor("#000000"),
			"boxes": []map[string]any{
				box(boxOpts{
					slot: "primary",
					x:    120, y: 200, w: 1680, h: 680,
					fontSize: 72, fontSizeMin: 40, fitToBox: true,
					weight:   600,
					maxLines: 8, lineHeight: 1.3,
				}),
			},
		},
	},
	{
		Name:      "Song - Stage",
		Kind:      "song",
		ViewportW: vw, ViewportH: vh,
		Body: map[string]any{
			// Performer cue: the current two lines bright + centered,
			// the next two lines dimmer right below. Reads as a
			// continuous "scroll" — the singer sees what's playing now
			// AND what's coming next without losing focus.
			"background": bgColor("#000000"),
			"boxes": []map[string]any{
				box(boxOpts{
					slot: "primary",
					x:    120, y: 280, w: 1680, h: 220,
					fontSize: 64, fontSizeMin: 40, fitToBox: true,
					color:    "#ffffff", weight: 600,
					maxLines: 2, lineHeight: 1.3,
				}),
				box(boxOpts{
					slot: "secondary",
					x:    120, y: 540, w: 1680, h: 220,
					fontSize: 64, fontSizeMin: 40, fitToBox: true,
					color:    "#888888", weight: 500,
					maxLines: 2, lineHeight: 1.3,
				}),
			},
		},
	},
	{
		Name:      "Song - Lower Thirds",
		Kind:      "song",
		ViewportW: vw, ViewportH: vh,
		Body: map[string]any{
			// Two-line lyric strip near the bottom. Mirrors the Bible
			// Lower Thirds shape (transparent, fit-to-box, low-position)
			// but centered for lyric readability.
			"background": bgTransparent(),
			"boxes": []map[string]any{
				box(boxOpts{
					slot: "primary",
					x:    80, y: 820, w: 1760, h: 160,
					fontSize: 48, fontSizeMin: 30, fitToBox: true,
					weight:   500,
					maxLines: 2, lineHeight: 1.2,
				}),
			},
		},
	},
}
