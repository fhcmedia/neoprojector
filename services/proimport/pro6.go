// ProPresenter 4 / 5 / 6 XML parser + importer.
//
// The .pro4/.pro5/.pro6 file format is a plist-style XML document
// rooted at <RVPresentationDocument>. Slides are grouped under
// <RVSlideGrouping> blocks; each slide has <displayElements> containing
// <RVTextElement>s whose visible text sits in a base64-encoded
// <NSString rvXMLIvarName="RTFData"> (RTF) — newer Pro6 docs sometimes
// also expose <NSString rvXMLIvarName="PlainText">. We prefer plain
// text when present and fall back to stripping the RTF.
//
// CCLI metadata sits on the document root as attributes. We surface it
// for the UI but don't persist it onto songs yet — the songs table
// has no author/copyright/ccli columns. Adding them is a follow-up
// migration; this importer is forward-compatible.

package proimport

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"neoprojector/database"
	"neoprojector/services/internal/rtf"
)

// rvDocument is the bits of <RVPresentationDocument> we read.
type rvDocument struct {
	XMLName            xml.Name `xml:"RVPresentationDocument"`
	CCLISongTitle      string   `xml:"CCLISongTitle,attr"`
	CCLIArtistCredits  string   `xml:"CCLIArtistCredits,attr"`
	CCLIPublisher      string   `xml:"CCLIPublisher,attr"`
	CCLICopyrightYear  string   `xml:"CCLICopyrightYear,attr"`
	CCLISongNumber     string   `xml:"CCLISongNumber,attr"`
	Category           string   `xml:"category,attr"`
	Notes              string   `xml:"notes,attr"`
	Groups             rvGroups `xml:"groups"`
	Arrangements       rvArr    `xml:"arrangements"`
}

type rvGroups struct {
	Groupings []rvGrouping `xml:"RVSlideGrouping"`
}

type rvGrouping struct {
	Name   string     `xml:"name,attr"`
	UUID   string     `xml:"uuid,attr"`
	Color  string     `xml:"color,attr"`
	Slides rvSlides   `xml:"slides"`
}

type rvSlides struct {
	Slides []rvSlide `xml:"RVDisplaySlide"`
}

type rvSlide struct {
	UUID            string            `xml:"UUID,attr"`
	BackgroundColor string            `xml:"backgroundColor,attr"`
	DisplayElements rvDisplayElements `xml:"displayElements"`
}

type rvDisplayElements struct {
	TextElements []rvTextElement `xml:"RVTextElement"`
}

type rvTextElement struct {
	DisplayName string     `xml:"displayName,attr"`
	UUID        string     `xml:"UUID,attr"`
	NSStrings   []rvNSStr  `xml:"NSString"`
}

type rvNSStr struct {
	IvarName string `xml:"rvXMLIvarName,attr"`
	Value    string `xml:",chardata"`
}

type rvArr struct {
	Arrangements []rvArrangement `xml:"RVSongArrangement"`
}

type rvArrangement struct {
	Name     string   `xml:"name,attr"`
	GroupIDs []string `xml:"groupIDs>NSString"`
}

// scanProXML opens, parses, and previews a Pro4/5/6 XML document.
// Returns a populated ScanItem on any successful parse — even when
// the document has zero groups (we still want to show the user that
// it was found). Returns Supported=false with a Reason when the
// document parses but is structurally something we can't import yet.
func scanProXML(path string, ext string) ScanItem {
	format := "pro6"
	if ext == ".pro4" {
		format = "pro4"
	} else if ext == ".pro5" {
		format = "pro5"
	}
	filename := filepath.Base(path)
	item := ScanItem{
		Path:      path,
		Filename:  filename,
		Format:    format,
		Kind:      "song",
		Title:     strings.TrimSuffix(filename, ext),
		Supported: true,
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		item.Supported = false
		item.Reason = fmt.Sprintf("read failed: %v", err)
		return item
	}
	// Guard: documents larger than 20 MiB are almost certainly bundles
	// with embedded media — we still scan them but it's worth flagging.
	if len(raw) > 20*1024*1024 {
		item.Reason = "file >20MB — may contain embedded media; lyrics will still import"
	}

	var doc rvDocument
	dec := xml.NewDecoder(strings.NewReader(string(raw)))
	dec.Strict = false
	dec.CharsetReader = identityCharsetReader
	if err := dec.Decode(&doc); err != nil {
		item.Supported = false
		item.Reason = fmt.Sprintf("XML parse failed: %v", err)
		return item
	}

	if doc.CCLISongTitle != "" {
		item.Title = doc.CCLISongTitle
	}
	item.Author = doc.CCLIArtistCredits
	item.Publisher = doc.CCLIPublisher
	item.Copyright = doc.CCLICopyrightYear
	item.CCLINumber = doc.CCLISongNumber

	sectionCount := 0
	slideCount := 0
	lineCount := 0
	for _, g := range doc.Groups.Groupings {
		sectionCount++
		for _, sl := range g.Slides.Slides {
			slideCount++
			for _, te := range sl.DisplayElements.TextElements {
				text := extractText(te)
				lineCount += rtf.CountLines(text)
			}
		}
	}
	item.Sections = sectionCount
	item.Slides = slideCount
	item.Lines = lineCount
	if sectionCount == 0 && slideCount == 0 {
		item.Supported = false
		item.Reason = "no slide groupings found — not a song document"
	}
	return item
}

// importProXML parses the document, applies the conflict policy
// against the existing library, and writes the resulting song + its
// sections + lines in a single transaction. Returns the new song's id
// and one of: "imported" | "renamed" | "overwrote" | "skipped".
func (s *Service) importProXML(
	ctx context.Context,
	path string,
	policy ConflictPolicy,
) (int64, string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, "", fmt.Errorf("read: %w", err)
	}
	var doc rvDocument
	dec := xml.NewDecoder(strings.NewReader(string(raw)))
	dec.Strict = false
	dec.CharsetReader = identityCharsetReader
	if err := dec.Decode(&doc); err != nil {
		return 0, "", fmt.Errorf("parse: %w", err)
	}

	title := strings.TrimSpace(doc.CCLISongTitle)
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}

	// Conflict resolution. The unique index on song.title (NOCASE)
	// forbids duplicates, so we have to check + decide before insert.
	// sqlc has no SongByTitle query yet; raw SQL keeps this importer
	// self-contained without forcing a schema/codegen change.
	existing, hasExisting, err := s.songByTitle(ctx, title)
	if err != nil {
		return 0, "", fmt.Errorf("lookup existing: %w", err)
	}
	action := "imported"
	if hasExisting {
		switch policy {
		case ConflictSkip:
			return existing.ID, "skipped", nil
		case ConflictRename:
			title = s.nextAvailableTitle(ctx, title)
			action = "renamed"
		case ConflictOverwrite:
			// Tear down the prior song's sections (cascades to lines)
			// and reuse the row by clearing + repopulating. Simpler
			// than DELETE-then-INSERT: the song's id survives so any
			// references (schedule items) keep working.
			if err := s.deleteSongSections(ctx, existing.ID); err != nil {
				return 0, "", fmt.Errorf("clear existing sections: %w", err)
			}
			action = "overwrote"
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	qtx := s.q.WithTx(tx)

	var song database.Song
	if action == "overwrote" {
		song = existing
	} else {
		song, err = qtx.CreateSong(ctx, title)
		if err != nil {
			return 0, "", fmt.Errorf("create song: %w", err)
		}
	}

	// CCLI metadata: only stamped when the document actually carried
	// values, so a re-import of a metadata-less file doesn't clobber
	// fields the operator filled in by hand. Nulls preserve existing.
	if doc.CCLIArtistCredits != "" || doc.CCLICopyrightYear != "" ||
		doc.CCLIPublisher != "" || doc.CCLISongNumber != "" {
		_, err = qtx.UpdateSongMetadata(ctx, database.UpdateSongMetadataParams{
			Author:     nullableString(doc.CCLIArtistCredits),
			Copyright:  nullableString(doc.CCLICopyrightYear),
			Publisher:  nullableString(doc.CCLIPublisher),
			CcliNumber: nullableString(doc.CCLISongNumber),
			ID:         song.ID,
		})
		if err != nil {
			return 0, "", fmt.Errorf("update metadata: %w", err)
		}
	}

	for gi, g := range doc.Groups.Groupings {
		sectionType := classifySectionType(g.Name)
		sec, err := qtx.CreateSongSectionAppend(ctx, database.CreateSongSectionAppendParams{
			SongID: song.ID,
			Type:   sectionType,
		})
		if err != nil {
			return 0, "", fmt.Errorf("create section %d: %w", gi, err)
		}
		linePos := int64(0)
		for _, sl := range g.Slides.Slides {
			// Collect lines from every text element on the slide,
			// preferring "primary"-ish elements (heuristic: longest
			// text wins per slide). ProPresenter slides can have
			// multiple boxes (lyric + chord) — we want lyrics.
			text := primaryText(sl)
			for _, ln := range rtf.SplitLines(text) {
				if ln == "" {
					continue
				}
				if _, err := qtx.CreateSongLine(ctx, database.CreateSongLineParams{
					SectionID: sec.ID,
					Position:  linePos,
					Text:      ln,
				}); err != nil {
					return 0, "", fmt.Errorf("create line: %w", err)
				}
				linePos++
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, "", fmt.Errorf("commit: %w", err)
	}
	return song.ID, action, nil
}

// deleteSongSections drops every section (and via FK cascade, every
// line) on the given song. Used by the overwrite path so the in-place
// re-import doesn't end up with the union of old + new content.
func (s *Service) deleteSongSections(ctx context.Context, songID int64) error {
	secs, err := s.q.ListSongSections(ctx, songID)
	if err != nil {
		return err
	}
	for _, sec := range secs {
		if err := s.q.DeleteSongSection(ctx, sec.ID); err != nil {
			return err
		}
	}
	return nil
}

// nextAvailableTitle suffixes "(2)", "(3)", … until a free name is
// found. Capped at 99 to avoid runaway loops on broken data.
func (s *Service) nextAvailableTitle(ctx context.Context, base string) string {
	for i := 2; i < 100; i++ {
		candidate := fmt.Sprintf("%s (%d)", base, i)
		_, has, err := s.songByTitle(ctx, candidate)
		if err == nil && !has {
			return candidate
		}
	}
	return fmt.Sprintf("%s (imported)", base)
}

// songByTitle is a sqlc-bypassing lookup keyed on the NOCASE-collated
// title index. Returns (song, found, err). Selects every column so the
// returned struct matches what sqlc produces for SongByID / ListSongs.
func (s *Service) songByTitle(ctx context.Context, title string) (database.Song, bool, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT id, title, author, copyright, publisher, ccli_number, created_at, updated_at FROM song WHERE title = ? COLLATE NOCASE LIMIT 1",
		title,
	)
	var song database.Song
	if err := row.Scan(
		&song.ID, &song.Title, &song.Author, &song.Copyright, &song.Publisher, &song.CcliNumber,
		&song.CreatedAt, &song.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return database.Song{}, false, nil
		}
		return database.Song{}, false, err
	}
	return song, true, nil
}

// classifySectionType maps ProPresenter group names to NP section
// types ("verse" / "chorus" / "bridge" / etc). Falls through to
// "verse" for anything we don't recognise — operators can retype it
// in the editor.
func classifySectionType(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	switch {
	case strings.HasPrefix(n, "chorus"):
		return "chorus"
	case strings.HasPrefix(n, "bridge"):
		return "bridge"
	case strings.HasPrefix(n, "pre-chorus"), strings.HasPrefix(n, "prechorus"):
		return "prechorus"
	case strings.HasPrefix(n, "tag"):
		return "tag"
	case strings.HasPrefix(n, "intro"):
		return "intro"
	case strings.HasPrefix(n, "outro"), strings.HasPrefix(n, "ending"):
		return "outro"
	case strings.HasPrefix(n, "interlude"):
		return "interlude"
	case strings.HasPrefix(n, "verse"), n == "":
		return "verse"
	default:
		return "verse"
	}
}

// extractText pulls the human-readable text out of an RVTextElement.
// Prefers <NSString rvXMLIvarName="PlainText"> when present (Pro6+
// sometimes provides it); otherwise base64-decodes the RTFData and
// strips RTF control words.
func extractText(te rvTextElement) string {
	var rtfB64 string
	for _, s := range te.NSStrings {
		switch s.IvarName {
		case "PlainText":
			if t := strings.TrimSpace(s.Value); t != "" {
				return t
			}
		case "RTFData":
			rtfB64 = s.Value
		}
	}
	if rtfB64 == "" {
		return ""
	}
	decoded, err := base64.StdEncoding.DecodeString(rtf.StripWhitespace(rtfB64))
	if err != nil {
		return ""
	}
	return rtf.Strip(string(decoded))
}

// primaryText walks every text element on the slide and picks the
// longest extracted text — heuristic for "this is the lyric box,
// the other box is chords / annotations / labels". When the longest
// match is one short word, we fall back to concatenating everything.
func primaryText(sl rvSlide) string {
	best := ""
	all := make([]string, 0, len(sl.DisplayElements.TextElements))
	for _, te := range sl.DisplayElements.TextElements {
		t := extractText(te)
		if t == "" {
			continue
		}
		all = append(all, t)
		if len(t) > len(best) {
			best = t
		}
	}
	if len(best) <= 1 && len(all) > 1 {
		return strings.Join(all, "\n")
	}
	return best
}

// nullableString wraps a string in sql.NullString — empty strings
// become Valid=false so the column stays NULL instead of an empty
// literal. Lets the metadata UI tell apart "never set" from "blank".
func nullableString(s string) sql.NullString {
	t := strings.TrimSpace(s)
	if t == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: t, Valid: true}
}

// identityCharsetReader lets the XML decoder accept any declared
// encoding without us bundling an encoding/charmap dep. ProPresenter
// docs are virtually always UTF-8 in practice; on the rare encoding=
// mismatch we'd rather decode as-bytes than refuse the file.
func identityCharsetReader(_ string, input io.Reader) (io.Reader, error) {
	return input, nil
}
