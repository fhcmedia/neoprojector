package presentations

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"neoprojector/database"

	"github.com/adrg/xdg"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Importing a deck (PDF or PowerPoint) as slides.
//
// The work is split between the two sides, each doing what it's good at:
//  1. PrepareDeck (Go): turn the file into a PDF if needed (convert.go)
//     and register it as a hidden "pdf" media row, which the loopback
//     media server can then stream to the operator window;
//  2. the operator window renders each page with pdf.js and hands the
//     image to AddDeckPage (Go), which stores it as a hidden image
//     media row and appends a slide;
//  3. FinishDeck (Go) removes the temporary PDF.
// Slides are plain images from then on: no converter, PDF engine or
// PowerPoint is involved while presenting, so a deck plays like any
// photo slideshow — instantly, on every screen, with transitions.

// DeckFile is a deck ready for page rendering.
type DeckFile struct {
	// PDFMediaID is the hidden media row holding the PDF to render.
	PDFMediaID int64 `json:"pdf_media_id"`
	// Name is the file's name without extension — the slides' source
	// label and a default presentation name.
	Name string `json:"name"`
}

// DeckProgress is emitted as "deck:progress" while PrepareDeck works.
type DeckProgress struct {
	Path  string `json:"path"`
	Stage string `json:"stage"` // powerpoint | downloading | unpacking | converting
	Pct   int    `json:"pct"`   // 0–100, or -1 when unknown
}

// maxPageBytes bounds one rendered page image (a 1920px WebP is
// typically 100–600 KB; 25 MB means something is wrong).
const maxPageBytes = 25 << 20

// PrepareDeck makes a PDF of path (converting PowerPoint files) and
// registers it for rendering. May take a while the first time a
// PowerPoint file is imported on a PC without PowerPoint (LibreOffice
// is fetched once); progress arrives as "deck:progress" events.
func (s *Service) PrepareDeck(ctx context.Context, path string) (DeckFile, error) {
	if !IsDeckFile(path) {
		return DeckFile{}, fmt.Errorf("%s isn't a PDF or presentation file", filepath.Base(path))
	}
	if st, err := os.Stat(path); err != nil || st.IsDir() {
		return DeckFile{}, fmt.Errorf("can't read %s", filepath.Base(path))
	}
	mediaDir, err := dataSubdir("media")
	if err != nil {
		return DeckFile{}, err
	}
	name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	pdf := path
	if strings.ToLower(filepath.Ext(path)) != ".pdf" {
		toolsDir, err := dataSubdir("tools")
		if err != nil {
			return DeckFile{}, err
		}
		work, err := os.MkdirTemp(toolsDir, "deck-*")
		if err != nil {
			return DeckFile{}, err
		}
		defer os.RemoveAll(work)
		// Convert a copy with a plain name: LibreOffice derives its
		// output name from the input, and odd characters in a file name
		// shouldn't be able to break that.
		local := filepath.Join(work, "deck"+strings.ToLower(filepath.Ext(path)))
		if err := copyFile(path, local); err != nil {
			return DeckFile{}, err
		}
		pdf, err = toPDF(ctx, local, work, toolsDir, func(stage string, pct int) {
			emit("deck:progress", DeckProgress{Path: path, Stage: stage, Pct: pct})
		})
		if err != nil {
			return DeckFile{}, err
		}
	}
	dst := filepath.Join(mediaDir, uuid.NewString()+".pdf")
	if err := copyFile(pdf, dst); err != nil {
		return DeckFile{}, err
	}
	row, err := s.q.CreateHiddenMedia(ctx, database.CreateHiddenMediaParams{
		Type: "pdf", Title: name, Path: dst, OriginalFilename: filepath.Base(path),
	})
	if err != nil {
		os.Remove(dst)
		return DeckFile{}, err
	}
	return DeckFile{PDFMediaID: row.ID, Name: name}, nil
}

// AddDeckPage stores one rendered page (PNG, JPEG or WebP bytes) as a
// hidden image and appends it to the presentation as a slide.
func (s *Service) AddDeckPage(ctx context.Context, presentationID int64, source string, page int, image []byte) (database.PresentationSlide, error) {
	ext, err := imageExt(image)
	if err != nil {
		return database.PresentationSlide{}, err
	}
	mediaDir, err := dataSubdir("media")
	if err != nil {
		return database.PresentationSlide{}, err
	}
	dst := filepath.Join(mediaDir, uuid.NewString()+ext)
	if err := os.WriteFile(dst, image, 0o644); err != nil {
		return database.PresentationSlide{}, err
	}
	title := fmt.Sprintf("%s — %d", source, page)
	m, err := s.q.CreateHiddenMedia(ctx, database.CreateHiddenMediaParams{
		Type: "image", Title: title, Path: dst, OriginalFilename: title + ext,
	})
	if err != nil {
		os.Remove(dst)
		return database.PresentationSlide{}, err
	}
	slide, err := s.q.CreatePresentationSlideFromSource(ctx, database.CreatePresentationSlideFromSourceParams{
		PresentationID: presentationID, MediaID: m.ID, Source: source,
	})
	if err != nil {
		s.q.DeleteHiddenMedia(ctx, m.ID)
		os.Remove(dst)
		return database.PresentationSlide{}, err
	}
	return slide, nil
}

// FinishDeck deletes the temporary PDF registered by PrepareDeck (also
// call it when rendering fails or is cancelled).
func (s *Service) FinishDeck(ctx context.Context, pdfMediaID int64) error {
	m, err := s.q.MediaByID(ctx, pdfMediaID)
	if err != nil || m.Hidden != 1 || m.Type != "pdf" {
		return nil
	}
	if err := s.q.DeleteHiddenMedia(ctx, m.ID); err != nil {
		return err
	}
	if err := os.Remove(m.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// imageExt sniffs the page image format; anything else is refused.
func imageExt(b []byte) (string, error) {
	switch {
	case len(b) > maxPageBytes:
		return "", errors.New("page image too large")
	case len(b) >= 12 && bytes.Equal(b[0:4], []byte("RIFF")) && bytes.Equal(b[8:12], []byte("WEBP")):
		return ".webp", nil
	case len(b) >= 8 && bytes.Equal(b[0:8], []byte("\x89PNG\r\n\x1a\n")):
		return ".png", nil
	case len(b) >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF:
		return ".jpg", nil
	}
	return "", errors.New("page image must be PNG, JPEG or WebP")
}

func dataSubdir(name string) (string, error) {
	p, err := xdg.DataFile("neoprojector/" + name + "/.touch")
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(p)
	return dir, os.MkdirAll(dir, 0o755)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	return out.Close()
}

func emit(name string, data any) {
	if app := application.Get(); app != nil {
		app.Event.Emit(name, data)
	}
}
