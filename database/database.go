package database

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"

	"github.com/charmbracelet/log"
	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func Open(dbPath string) (*sql.DB, error) {
	// modernc.org/sqlite applies _pragma params to every new connection
	// in the pool, so foreign_keys and journal_mode stay enforced even
	// when database/sql opens fresh connections under load. Without this,
	// FK cascades silently no-op on non-primary connections.
	dsn := fmt.Sprintf(
		"file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)",
		dbPath,
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	return db, nil
}

func Migrate(db *sql.DB) error {
	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("set dialect: %w", err)
	}

	migrationsRoot, err := fs.Sub(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("sub fs migrations: %w", err)
	}

	provider, err := goose.NewProvider(goose.DialectSQLite3, db, migrationsRoot)
	if err != nil {
		return fmt.Errorf("create goose provider: %w", err)
	}

	results, err := provider.Up(context.Background())
	if err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}

	for _, r := range results {
		if r.Error != nil {
			log.Error("migration failed", "path", r.Source.Path, "err", r.Error)
		} else {
			log.Info("migration applied", "path", r.Source.Path, "duration", r.Duration)
		}
	}

	return nil
}
