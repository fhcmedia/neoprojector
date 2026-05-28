// Package docimport implements File → Import for office documents:
// PPTX, DOCX, PDF, ODP, ODT, RTF. Each importer parses the source
// document into a shared ParsedDeck representation, then materialises
// it as a `deck` row plus child `deck_slide` / `deck_block` rows.
// Embedded images are written into the media store and referenced by
// id rather than inlined into block JSON.
//
// Scope of this skeleton (M1):
//   - Format detection from path / magic bytes.
//   - Wails-bound surface: AutoDetectFormat, ScanDoc, ImportDoc.
//   - Per-format parsers are stubs that return ErrNotImplemented so the
//     frontend can wire up the menu now and the parsers can land in
//     follow-up milestones (M2: PPTX, M4: DOCX/RTF, M5: PDF, M6: ODP/ODT).
//
// The service is stateless. Every call re-opens the source file; the
// only persistent state is the destination DB.
package docimport

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"neoprojector/database"
)

// Service is bound to the frontend via Wails. Stateless.
type Service struct {
	db *sql.DB
	q  *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{db: db, q: database.New(db)}
}

func (*Service) ServiceName() string { return "docimport" }

// Format is the importer dispatch key. The string value is what the
// frontend receives; keep it stable across versions.
type Format string

const (
	FormatUnknown Format = ""
	FormatPPTX    Format = "pptx"
	FormatDOCX    Format = "docx"
	FormatPDF     Format = "pdf"
	FormatODP     Format = "odp"
	FormatODT     Format = "odt"
	FormatRTF     Format = "rtf"
)

// SupportedFormats is the canonical list surfaced to the UI for File
// → Import submenu generation. Order matches the menu order.
var SupportedFormats = []FormatInfo{
	{Format: FormatPPTX, Label: "PowerPoint", Extensions: []string{".pptx"}},
	{Format: FormatDOCX, Label: "Word", Extensions: []string{".docx"}},
	{Format: FormatPDF, Label: "PDF", Extensions: []string{".pdf"}},
	{Format: FormatODP, Label: "OpenDocument Presentation", Extensions: []string{".odp"}},
	{Format: FormatODT, Label: "OpenDocument Text", Extensions: []string{".odt"}},
	{Format: FormatRTF, Label: "Rich Text", Extensions: []string{".rtf"}},
}

type FormatInfo struct {
	Format     Format   `json:"format"`
	Label      string   `json:"label"`
	Extensions []string `json:"extensions"`
}

// ListSupportedFormats returns the metadata the frontend uses to
// render the File → Import submenu and file-dialog filters.
func (s *Service) ListSupportedFormats(_ context.Context) []FormatInfo {
	return SupportedFormats
}

// ScanItem mirrors the proimport ScanItem shape: enough metadata for
// the import wizard to preview without committing. SlideThumbs is a
// short list of base64 PNG previews (one per page, capped at 3) the
// wizard renders in the confirmation step. Empty for formats that
// have not landed yet.
type ScanItem struct {
	Path        string   `json:"path"`
	Filename    string   `json:"filename"`
	Format      Format   `json:"format"`
	Title       string   `json:"title"`
	Slides      int      `json:"slides"`
	Supported   bool     `json:"supported"`
	Reason      string   `json:"reason"`
	SlideThumbs []string `json:"slide_thumbs"`
}

// ImportOptions controls how a source document is mapped onto the
// deck schema. Sensible defaults are applied when zero values arrive
// from the frontend.
type ImportOptions struct {
	DeckName       string `json:"deck_name"`
	SplitHeading   string `json:"split_heading"`   // docx: "h1" | "h2" | "pagebreak"
	PreserveFonts  bool   `json:"preserve_fonts"`
	PreserveColors bool   `json:"preserve_colors"`
}

// ErrNotImplemented is returned by stub parsers until the per-format
// importer lands. The frontend surfaces the message verbatim.
var ErrNotImplemented = errors.New("import for this format is not yet implemented")

// AutoDetectFormat sniffs the file extension and (for ambiguous cases)
// the magic bytes / ZIP container. Returns FormatUnknown if no parser
// matches.
func (s *Service) AutoDetectFormat(_ context.Context, path string) (Format, error) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".pptx":
		return FormatPPTX, nil
	case ".docx":
		return FormatDOCX, nil
	case ".pdf":
		return FormatPDF, nil
	case ".odp":
		return FormatODP, nil
	case ".odt":
		return FormatODT, nil
	case ".rtf":
		return FormatRTF, nil
	}
	// Fallback: peek at magic bytes. PPTX/DOCX/ODP/ODT are ZIP-backed
	// so the parser will still need to identify the container kind by
	// inspecting the central-directory contents — that happens in the
	// per-format parser, not here.
	f, err := os.Open(path)
	if err != nil {
		return FormatUnknown, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	hdr := make([]byte, 8)
	n, _ := f.Read(hdr)
	if n >= 4 && hdr[0] == 0x25 && hdr[1] == 0x50 && hdr[2] == 0x44 && hdr[3] == 0x46 {
		return FormatPDF, nil // "%PDF"
	}
	if n >= 5 && hdr[0] == 0x7B && hdr[1] == 0x5C && hdr[2] == 0x72 && hdr[3] == 0x74 && hdr[4] == 0x66 {
		return FormatRTF, nil // "{\rtf"
	}
	// ZIP local header "PK\x03\x04" — could be any Open XML / OD*; we
	// cannot disambiguate without unzipping. Caller passes that path
	// to per-format scanners which then probe content.
	return FormatUnknown, nil
}

// ScanDoc returns a preview of the document without writing to the
// database. v1 surfaces title + slide count; thumbnails are filled
// in per-format as parsers land.
func (s *Service) ScanDoc(ctx context.Context, path string) (ScanItem, error) {
	format, err := s.AutoDetectFormat(ctx, path)
	if err != nil {
		return ScanItem{}, err
	}
	if format == FormatUnknown {
		return ScanItem{
			Path:      path,
			Filename:  filepath.Base(path),
			Format:    FormatUnknown,
			Supported: false,
			Reason:    "unrecognised format",
		}, nil
	}
	return ScanItem{
		Path:      path,
		Filename:  filepath.Base(path),
		Format:    format,
		Title:     strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)),
		Supported: false,
		Reason:    ErrNotImplemented.Error(),
	}, nil
}

// ImportDoc writes the parsed source into a new deck row. The deck id
// of the new row is returned so the frontend can navigate straight
// into the editor.
//
// M1 skeleton: stubs return ErrNotImplemented. The signature matches
// the final API so the frontend wiring lands ahead of the parser
// implementations.
func (s *Service) ImportDoc(ctx context.Context, path string, opts ImportOptions) (int64, error) {
	format, err := s.AutoDetectFormat(ctx, path)
	if err != nil {
		return 0, err
	}
	switch format {
	case FormatPPTX:
		return s.importPPTX(ctx, path, opts)
	case FormatDOCX:
		return s.importDOCX(ctx, path, opts)
	case FormatPDF:
		return s.importPDF(ctx, path, opts)
	case FormatODP:
		return s.importODP(ctx, path, opts)
	case FormatODT:
		return s.importODT(ctx, path, opts)
	case FormatRTF:
		return s.importRTF(ctx, path, opts)
	}
	return 0, fmt.Errorf("unsupported format for %s", path)
}

// Per-format stubs. Each one lands in its own milestone — see the
// package doc comment for the rollout plan.
func (s *Service) importPPTX(_ context.Context, _ string, _ ImportOptions) (int64, error) {
	return 0, ErrNotImplemented
}
func (s *Service) importDOCX(_ context.Context, _ string, _ ImportOptions) (int64, error) {
	return 0, ErrNotImplemented
}
func (s *Service) importPDF(_ context.Context, _ string, _ ImportOptions) (int64, error) {
	return 0, ErrNotImplemented
}
func (s *Service) importODP(_ context.Context, _ string, _ ImportOptions) (int64, error) {
	return 0, ErrNotImplemented
}
func (s *Service) importODT(_ context.Context, _ string, _ ImportOptions) (int64, error) {
	return 0, ErrNotImplemented
}
func (s *Service) importRTF(_ context.Context, _ string, _ ImportOptions) (int64, error) {
	return 0, ErrNotImplemented
}
