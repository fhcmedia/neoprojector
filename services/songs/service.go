package songs

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"neoprojector/database"
)

type Service struct {
	db *sql.DB
	q  *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{db: db, q: database.New(db)}
}

func (*Service) ServiceName() string { return "songs" }

// --- library ---

func (s *Service) ListSongs(ctx context.Context) ([]database.Song, error) {
	return s.q.ListSongs(ctx)
}

func (s *Service) SongByID(ctx context.Context, id int64) (database.Song, error) {
	return s.q.SongByID(ctx, id)
}

// SectionWithLines is a song section bundled with its ordered lines.
type SectionWithLines struct {
	Section database.SongSection `json:"section"`
	Lines   []database.SongLine  `json:"lines"`
}

// SongFull is the editor's view of a song: header + ordered sections + each
// section's ordered lines.
type SongFull struct {
	Song     database.Song      `json:"song"`
	Sections []SectionWithLines `json:"sections"`
}

// GetSong returns the full song tree in one call to keep the editor simple.
func (s *Service) GetSong(ctx context.Context, id int64) (SongFull, error) {
	song, err := s.q.SongByID(ctx, id)
	if err != nil {
		return SongFull{}, err
	}
	sections, err := s.q.ListSongSections(ctx, id)
	if err != nil {
		return SongFull{}, err
	}
	out := SongFull{Song: song, Sections: make([]SectionWithLines, 0, len(sections))}
	for _, sec := range sections {
		lines, err := s.q.ListSongLines(ctx, sec.ID)
		if err != nil {
			return SongFull{}, err
		}
		out.Sections = append(out.Sections, SectionWithLines{Section: sec, Lines: lines})
	}
	return out, nil
}

// --- song CRUD ---

func (s *Service) CreateSong(ctx context.Context, title string) (database.Song, error) {
	return s.q.CreateSong(ctx, title)
}

func (s *Service) UpdateSongTitle(ctx context.Context, id int64, title string) (database.Song, error) {
	return s.q.UpdateSongTitle(ctx, database.UpdateSongTitleParams{ID: id, Title: title})
}

func (s *Service) DeleteSong(ctx context.Context, id int64) error {
	// service_item_song.song_id has no ON DELETE CASCADE, so deleting a song
	// that a schedule item references fails outright. Drop the join rows
	// first, then the song, in one transaction. The parent service_item
	// rows are intentionally left behind: they degrade to a kind="" item
	// the schedule UI renders as a removable "broken" row — exactly what
	// the delete dialog warns ("schedule items referencing it will break").
	return s.inTx(ctx, func(q *database.Queries) error {
		if err := q.DeleteServiceItemSongsForSong(ctx, id); err != nil {
			return err
		}
		return q.DeleteSong(ctx, id)
	})
}

// --- section CRUD ---

func (s *Service) CreateSongSection(ctx context.Context, songID int64, sectionType string) (database.SongSection, error) {
	return s.q.CreateSongSectionAppend(ctx, database.CreateSongSectionAppendParams{
		SongID: songID,
		Type:   sectionType,
	})
}

func (s *Service) UpdateSongSectionType(ctx context.Context, id int64, sectionType string) (database.SongSection, error) {
	return s.q.UpdateSongSectionType(ctx, database.UpdateSongSectionTypeParams{ID: id, Type: sectionType})
}

func (s *Service) DeleteSongSection(ctx context.Context, id int64) error {
	return s.q.DeleteSongSection(ctx, id)
}

func (s *Service) ReorderSongSections(ctx context.Context, ids []int64) error {
	return s.inTx(ctx, func(q *database.Queries) error {
		for i, id := range ids {
			if err := q.SetSongSectionPosition(ctx, database.SetSongSectionPositionParams{
				ID:       id,
				Position: int64(i),
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// --- batch create (used by the editor) ---

// SongSpec is the editor's snapshot at save time. The whole song + sections +
// lines are inserted in a single transaction so abandoning the editor (Esc,
// back arrow, modal close) never persists anything.
type SongSpec struct {
	Title    string            `json:"title"`
	Sections []SongSectionSpec `json:"sections"`
}

type SongSectionSpec struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// UpdateSongFromSpec replaces the song's title and all sections+lines in one
// transaction. Simpler than diffing existing state — the editor's "Save"
// button always rewrites the whole tree.
func (s *Service) UpdateSongFromSpec(ctx context.Context, id int64, spec SongSpec) error {
	title := spec.Title
	if strings.TrimSpace(title) == "" {
		title = "Untitled"
	}
	return s.inTx(ctx, func(q *database.Queries) error {
		if _, err := q.UpdateSongTitle(ctx, database.UpdateSongTitleParams{
			ID:    id,
			Title: title,
		}); err != nil {
			return err
		}
		if err := q.DeleteSongSectionsForSong(ctx, id); err != nil {
			return err
		}
		for i, secSpec := range spec.Sections {
			sec, err := q.CreateSongSection(ctx, database.CreateSongSectionParams{
				SongID:   id,
				Type:     secSpec.Type,
				Position: int64(i),
			})
			if err != nil {
				return err
			}
			for j, line := range splitLyrics(secSpec.Text) {
				if _, err := q.CreateSongLine(ctx, database.CreateSongLineParams{
					SectionID: sec.ID,
					Position:  int64(j),
					Text:      line,
				}); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// CreateSongFromSpec writes the entire song tree atomically.
func (s *Service) CreateSongFromSpec(ctx context.Context, spec SongSpec) (database.Song, error) {
	title := spec.Title
	if strings.TrimSpace(title) == "" {
		title = "Untitled"
	}
	var out database.Song
	err := s.inTx(ctx, func(q *database.Queries) error {
		song, err := q.CreateSong(ctx, title)
		if err != nil {
			return err
		}
		for i, secSpec := range spec.Sections {
			sec, err := q.CreateSongSection(ctx, database.CreateSongSectionParams{
				SongID:   song.ID,
				Type:     secSpec.Type,
				Position: int64(i),
			})
			if err != nil {
				return err
			}
			for j, line := range splitLyrics(secSpec.Text) {
				if _, err := q.CreateSongLine(ctx, database.CreateSongLineParams{
					SectionID: sec.ID,
					Position:  int64(j),
					Text:      line,
				}); err != nil {
					return err
				}
			}
		}
		out = song
		return nil
	})
	return out, err
}

// DuplicateSong copies a song's title, every section, and every line
// into a fresh row. Title suffix walks " (copy)", " (copy 2)", … until
// a free slot is found so the NOCASE-unique title index doesn't
// reject the insert. Returns the new song row.
func (s *Service) DuplicateSong(ctx context.Context, id int64) (database.Song, error) {
	src, err := s.q.SongByID(ctx, id)
	if err != nil {
		return database.Song{}, err
	}
	newTitle := s.uniqueCopyTitle(ctx, src.Title)

	var out database.Song
	err = s.inTx(ctx, func(q *database.Queries) error {
		song, err := q.CreateSong(ctx, newTitle)
		if err != nil {
			return err
		}
		// Copy metadata that the importer / editor may have populated.
		if src.Author.Valid || src.Copyright.Valid || src.Publisher.Valid || src.CcliNumber.Valid {
			if _, err := q.UpdateSongMetadata(ctx, database.UpdateSongMetadataParams{
				Author:     src.Author,
				Copyright:  src.Copyright,
				Publisher:  src.Publisher,
				CcliNumber: src.CcliNumber,
				ID:         song.ID,
			}); err != nil {
				return err
			}
		}
		secs, err := q.ListSongSections(ctx, id)
		if err != nil {
			return err
		}
		for i, sec := range secs {
			newSec, err := q.CreateSongSection(ctx, database.CreateSongSectionParams{
				SongID:   song.ID,
				Type:     sec.Type,
				Position: int64(i),
			})
			if err != nil {
				return err
			}
			lines, err := q.ListSongLines(ctx, sec.ID)
			if err != nil {
				return err
			}
			for j, ln := range lines {
				if _, err := q.CreateSongLine(ctx, database.CreateSongLineParams{
					SectionID: newSec.ID,
					Position:  int64(j),
					Text:      ln.Text,
				}); err != nil {
					return err
				}
			}
		}
		out = song
		return nil
	})
	return out, err
}

// uniqueCopyTitle finds a free " (copy)" suffix for the given base
// title. " (copy)" first; then " (copy 2)", " (copy 3)", … up to a
// safety cap. Cap exists so a broken DB can't loop forever.
func (s *Service) uniqueCopyTitle(ctx context.Context, base string) string {
	candidate := base + " (copy)"
	if !s.titleTaken(ctx, candidate) {
		return candidate
	}
	for i := 2; i < 100; i++ {
		candidate = fmt.Sprintf("%s (copy %d)", base, i)
		if !s.titleTaken(ctx, candidate) {
			return candidate
		}
	}
	return fmt.Sprintf("%s (copy %d)", base, time.Now().UnixNano())
}

func (s *Service) titleTaken(ctx context.Context, title string) bool {
	row := s.db.QueryRowContext(ctx,
		"SELECT 1 FROM song WHERE title = ? COLLATE NOCASE LIMIT 1",
		title,
	)
	var n int
	return row.Scan(&n) == nil
}

// --- lines ---

// ReplaceSectionLines splits `text` into lines and replaces the entire line
// set for the section atomically (delete-all then insert). Each non-empty
// trimmed line becomes a song_line row; blank lines are skipped.
func (s *Service) ReplaceSectionLines(ctx context.Context, sectionID int64, text string) error {
	lines := splitLyrics(text)
	return s.inTx(ctx, func(q *database.Queries) error {
		if err := q.DeleteSongLinesForSection(ctx, sectionID); err != nil {
			return err
		}
		for i, line := range lines {
			if _, err := q.CreateSongLine(ctx, database.CreateSongLineParams{
				SectionID: sectionID,
				Position:  int64(i),
				Text:      line,
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// splitLyrics splits a section's textarea content into one line per
// row. Internal blank lines are preserved (as empty strings) — the
// renderer uses them as slide-break markers, so a 4-line verse with a
// blank in the middle becomes two slides that still share "Verse 1".
// Leading/trailing blanks are trimmed so saved-then-reloaded text
// doesn't grow whitespace.
func splitLyrics(text string) []string {
	raw := strings.Split(text, "\n")
	out := make([]string, 0, len(raw))
	for _, l := range raw {
		l = strings.TrimRight(l, " \t\r")
		if strings.TrimSpace(l) == "" {
			l = ""
		}
		out = append(out, l)
	}
	for len(out) > 0 && out[0] == "" {
		out = out[1:]
	}
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return out
}

// --- tx helper ---

func (s *Service) inTx(ctx context.Context, fn func(*database.Queries) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(s.q.WithTx(tx)); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
