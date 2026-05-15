package bible

import (
	"context"
	"database/sql"

	"neoprojector/database"
)

// defaultTranslation is the translation used for preview/lookup in the picker.
// A user-configurable default will replace this when locale settings land.
const defaultTranslation = "KJV"

type Service struct {
	q *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{q: database.New(db)}
}

func (*Service) ServiceName() string { return "bible" }

func (s *Service) ListBibles(ctx context.Context) ([]database.Bible, error) {
	return s.q.ListBibles(ctx)
}

func (s *Service) ListBooks(ctx context.Context) ([]database.BibleBook, error) {
	return s.q.ListBibleBooks(ctx)
}

// ListChapters returns chapter numbers for a book in the default translation.
func (s *Service) ListChapters(ctx context.Context, book string) ([]int64, error) {
	return s.q.BibleChaptersForBook(ctx, database.BibleChaptersForBookParams{
		Translation: defaultTranslation,
		Book:        book,
	})
}

// ChapterVerse is a verse number paired with its default-translation text.
type ChapterVerse struct {
	Verse int64  `json:"verse"`
	Text  string `json:"text"`
}

// ListVerses returns all verses in a chapter (default translation) for the picker preview.
func (s *Service) ListVerses(ctx context.Context, book string, chapter int64) ([]ChapterVerse, error) {
	rows, err := s.q.BibleChapterVerses(ctx, database.BibleChapterVersesParams{
		Translation: defaultTranslation,
		Book:        book,
		Chapter:     chapter,
	})
	if err != nil {
		return nil, err
	}
	out := make([]ChapterVerse, len(rows))
	for i, r := range rows {
		out[i] = ChapterVerse{Verse: r.Verse, Text: r.Text}
	}
	return out, nil
}
