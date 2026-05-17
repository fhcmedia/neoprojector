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
	"github.com/charmbracelet/log"
	"github.com/google/uuid"
)

type Service struct {
	q *database.Queries
}

func New(db *sql.DB) *Service {
	return &Service{q: database.New(db)}
}

func (*Service) ServiceName() string { return "media" }

// ListMedia returns every imported media row. The `path` field is zeroed
// before crossing the Wails boundary — the frontend reaches the actual
// file through /media-asset/{id}, and exposing the raw filesystem path
// would leak the user's home directory layout to anything that can read
// the response (e.g. webview devtools, a misbehaving extension).
func (s *Service) ListMedia(ctx context.Context) ([]database.Medium, error) {
	rows, err := s.q.ListMedia(ctx)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].Path = ""
	}
	return rows, nil
}

// DeleteMedia removes the DB row and the on-disk file together. A
// failure to remove the file is logged but does not roll the DB row
// back — the row is the authoritative reference; an orphan file on
// disk is recoverable, a deleted file with a stale row is not.
func (s *Service) DeleteMedia(ctx context.Context, id int64) error {
	row, err := s.q.MediaByID(ctx, id)
	if err != nil {
		// Row gone already — best-effort idempotent delete.
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if err := s.q.DeleteMedia(ctx, id); err != nil {
		return err
	}
	if row.Path == "" {
		return nil
	}
	if err := os.Remove(row.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Warn("media file remove failed", "id", id, "path", row.Path, "err", err)
	}
	return nil
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
		// Same path-stripping as ListMedia — the row crosses to the
		// frontend, which should never see the on-disk path.
		row.Path = ""
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
