package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"neoprojector/database"

	"github.com/adrg/xdg"
	"github.com/google/uuid"
)

type Service struct {
	q *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{q: database.New(db)}
}

func (*Service) ServiceName() string { return "media" }

func (s *Service) ListMedia(ctx context.Context) ([]database.Medium, error) {
	return s.q.ListMedia(ctx)
}

func (s *Service) DeleteMedia(ctx context.Context, id int64) error {
	return s.q.DeleteMedia(ctx, id)
}

// ImportFiles copies each given absolute file path into the app's media
// storage directory under a uuid-prefixed filename, then inserts a media row
// for it. Files of unknown type are skipped. Returns the created rows in
// input order; missing entries indicate skipped files.
func (s *Service) ImportFiles(ctx context.Context, paths []string) ([]database.Medium, error) {
	mediaDir, err := xdg.DataFile("neoprojector/media/.touch")
	if err != nil {
		return nil, fmt.Errorf("media data dir: %w", err)
	}
	mediaDir = filepath.Dir(mediaDir)
	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		return nil, fmt.Errorf("ensure media dir: %w", err)
	}

	out := make([]database.Medium, 0, len(paths))
	for _, src := range paths {
		row, err := s.importOne(ctx, mediaDir, src)
		if err != nil {
			// Skip individual failures rather than failing the whole batch.
			// A dropped folder, unreadable file, or unsupported type
			// shouldn't abort the rest.
			continue
		}
		out = append(out, row)
	}
	return out, nil
}

func (s *Service) importOne(ctx context.Context, mediaDir, src string) (database.Medium, error) {
	info, err := os.Stat(src)
	if err != nil {
		return database.Medium{}, err
	}
	if info.IsDir() {
		return database.Medium{}, errors.New("directories not supported")
	}

	originalName := filepath.Base(src)
	ext := strings.ToLower(filepath.Ext(originalName))
	kind := mediaKindFromExt(ext)
	if kind == "" {
		return database.Medium{}, fmt.Errorf("unsupported extension %q", ext)
	}

	newName := uuid.NewString() + ext
	dst := filepath.Join(mediaDir, newName)
	if err := copyFile(src, dst); err != nil {
		return database.Medium{}, err
	}

	title := strings.TrimSuffix(originalName, ext)
	row, err := s.q.CreateMedia(ctx, database.CreateMediaParams{
		Type:             kind,
		Title:            title,
		Path:             dst,
		OriginalFilename: originalName,
	})
	if err != nil {
		// Roll back the copy on DB failure to avoid orphaning the file.
		_ = os.Remove(dst)
		return database.Medium{}, err
	}
	return row, nil
}

func mediaKindFromExt(ext string) string {
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".bmp", ".tiff", ".tif":
		return "image"
	case ".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v":
		return "video"
	case ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga":
		return "audio"
	case ".pdf":
		return "pdf"
	default:
		return ""
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		_ = os.Remove(dst)
		return err
	}
	return out.Close()
}
