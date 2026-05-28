// EasyWorship 6 / 7 / 8 SQLite parser + importer.
//
// EW stores its song library across two SQLite databases:
//
//   Songs.db    — `song` table: title, author, copyright, administrator,
//                 song_number, reference_number, ccli (rare), theme_name,
//                 chord_chart. Column set varies between EW versions, so
//                 every read is defensive: we ATTACH SongWords.db and
//                 use SELECT-by-name with COALESCE-style fallbacks.
//
//   SongWords.db — `word` table: each row is one slide's text for a
//                  song_id. The `words` column holds RTF; slides
//                  are the rows themselves, ordered by their
//                  presentation_index.
//
// EW song "groupings" (verse / chorus / bridge) are typically encoded
// at the start of each slide's RTF — patterns like "V1\n" or
// "Chorus\n". We strip those leading labels off the lyric and use
// them to seed the section type. When no label is present, every
// slide becomes its own "verse" section.

package ewimport

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"neoprojector/database"
	"neoprojector/services/internal/rtf"
)

// encodeSQLiteHandle / decodeSQLiteHandle pack the library + rowid
// into a single string the UI can ship back through Import. Using a
// fragment separator (#) avoids ambiguity with Windows paths
// (drive-letter colons + backslashes).
func encodeSQLiteHandle(libPath string, rowid int64) string {
	return fmt.Sprintf("%s#%d", libPath, rowid)
}

func decodeSQLiteHandle(handle string) (string, int64, bool) {
	idx := strings.LastIndex(handle, "#")
	if idx <= 0 || idx == len(handle)-1 {
		return "", 0, false
	}
	id, err := strconv.ParseInt(handle[idx+1:], 10, 64)
	if err != nil {
		return "", 0, false
	}
	return handle[:idx], id, true
}

// scanSQLiteLibrary opens both DBs read-only and emits one ScanItem
// per song row. Open-and-close per scan rather than caching handles:
// scans are infrequent and short, and per-scan handles dodge stale-FD
// problems if the user edits in EW between scan and import.
func scanSQLiteLibrary(libDir string) ([]ScanItem, error) {
	songsDB := filepath.Join(libDir, "Songs.db")
	wordsDB := filepath.Join(libDir, "SongWords.db")

	// SQLite open with mode=ro + immutable=1 + nolock=1 keeps the OS
	// file lock-free; EW is happy to keep running while we read.
	dsn := fmt.Sprintf("file:%s?mode=ro&immutable=1&_journal_mode=OFF", songsDB)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open songs.db: %w", err)
	}
	defer db.Close()

	// ATTACH SongWords so we can JOIN in one round trip. The escaped
	// path can contain spaces / unicode; single-quote it.
	if _, err := db.Exec(fmt.Sprintf(
		"ATTACH DATABASE '%s' AS sw",
		strings.ReplaceAll(wordsDB, "'", "''"),
	)); err != nil {
		return nil, fmt.Errorf("attach songwords.db: %w", err)
	}

	schema := detectSchema(db)
	if schema.SongTable == "" || schema.TitleCol == "" {
		return nil, fmt.Errorf("song table not found in Songs.db — schema unsupported")
	}

	q := buildSongScanQuery(schema)
	rows, err := db.Query(q)
	if err != nil {
		return nil, fmt.Errorf("query songs: %w", err)
	}
	defer rows.Close()

	out := make([]ScanItem, 0, 64)
	for rows.Next() {
		var (
			rowid           int64
			title           sql.NullString
			author          sql.NullString
			copyright       sql.NullString
			administrator   sql.NullString
			songNumber      sql.NullString
			referenceNumber sql.NullString
			vendorNumber    sql.NullString
			ccliNumber      sql.NullString
			themeName       sql.NullString
		)
		if err := rows.Scan(
			&rowid, &title, &author, &copyright, &administrator,
			&songNumber, &referenceNumber, &vendorNumber, &ccliNumber, &themeName,
		); err != nil {
			return nil, fmt.Errorf("scan song row: %w", err)
		}
		sections, slides, lines := countWordsFor(db, schema, rowid)
		out = append(out, ScanItem{
			Path:          encodeSQLiteHandle(libDir, rowid),
			Format:        "ew_sqlite",
			Library:       libDir,
			Title:         strings.TrimSpace(title.String),
			Author:        author.String,
			Copyright:     copyright.String,
			Administrator: administrator.String,
			CCLINumber:    firstNonEmpty(ccliNumber.String, referenceNumber.String),
			SongNumber:    firstNonEmpty(songNumber.String, vendorNumber.String),
			ThemeName:     themeName.String,
			Sections:      sections,
			Slides:        slides,
			Lines:         lines,
			Supported:     true,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows: %w", err)
	}
	return out, nil
}

// buildSongScanQuery emits one SELECT that always returns the same
// 10-column shape — present columns are read, missing ones are
// substituted with NULL literals. Keeps the scan loop above stable
// across EW versions + schemas where columns appear / disappear.
func buildSongScanQuery(s ewSchema) string {
	pick := func(actualCol, alias string) string {
		if actualCol == "" {
			return "NULL AS " + alias
		}
		return quoteIdent(actualCol) + " AS " + alias
	}
	return strings.Join([]string{
		"SELECT rowid,",
		pick(s.TitleCol, "title") + ",",
		pick(s.AuthorCol, "author") + ",",
		pick(s.CopyrightCol, "copyright") + ",",
		pick(s.AdministratorCol, "administrator") + ",",
		pick(s.SongNumberCol, "song_number") + ",",
		pick(s.ReferenceCol, "reference_number") + ",",
		pick(s.VendorCol, "vendor_song_number") + ",",
		pick(s.CCLICol, "ccli") + ",",
		pick(s.ThemeCol, "theme_name"),
		"FROM " + quoteIdent(s.SongTable),
		"ORDER BY " + quoteIdent(s.TitleCol) + " COLLATE NOCASE",
	}, " ")
}

// buildWordsQuery emits "SELECT <textCol> FROM sw.<wordTable> WHERE
// <songIDCol> = ? ORDER BY <orderCol or rowid>". Empty / missing
// pieces collapse safely.
func buildWordsQuery(s ewSchema) string {
	textCol := quoteIdent(s.WordTextCol)
	if textCol == "" {
		textCol = "NULL"
	}
	orderBy := "rowid"
	if s.WordOrderCol != "" {
		orderBy = quoteIdent(s.WordOrderCol)
	}
	return "SELECT " + textCol +
		" FROM sw." + quoteIdent(s.WordTable) +
		" WHERE " + quoteIdent(s.WordSongIDCol) + " = ?" +
		" ORDER BY " + orderBy
}

// countWordsFor returns (sections, slides, lines) for one song. Used
// only for the preview header counts.
func countWordsFor(db *sql.DB, s ewSchema, songID int64) (int, int, int) {
	if s.WordTable == "" || s.WordSongIDCol == "" || s.WordTextCol == "" {
		return 0, 0, 0
	}
	rows, err := db.Query(buildWordsQuery(s), songID)
	if err != nil {
		return 0, 0, 0
	}
	defer rows.Close()
	slides := 0
	lines := 0
	sectionTypes := map[string]struct{}{}
	for rows.Next() {
		var raw sql.NullString
		if err := rows.Scan(&raw); err != nil {
			continue
		}
		slides++
		txt := rtf.Strip(raw.String)
		secType, body := splitSectionLabel(txt)
		sectionTypes[secType] = struct{}{}
		lines += rtf.CountLines(body)
	}
	if slides == 0 {
		return 0, 0, 0
	}
	return len(sectionTypes), slides, lines
}

// importSQLiteSong pulls one row + its slide RTFs from the library,
// stamps NP song / sections / lines + CCLI metadata. Same conflict
// resolution semantics as proimport.
func (s *Service) importSQLiteSong(
	ctx context.Context,
	libDir string,
	rowid int64,
	policy ConflictPolicy,
	opts ImportOptions,
) (int64, string, error) {
	songsDB := filepath.Join(libDir, "Songs.db")
	wordsDB := filepath.Join(libDir, "SongWords.db")
	if _, err := os.Stat(songsDB); err != nil {
		return 0, "", fmt.Errorf("songs.db missing: %w", err)
	}

	dsn := fmt.Sprintf("file:%s?mode=ro&immutable=1&_journal_mode=OFF", songsDB)
	src, err := sql.Open("sqlite", dsn)
	if err != nil {
		return 0, "", fmt.Errorf("open: %w", err)
	}
	defer src.Close()
	if _, err := src.Exec(fmt.Sprintf(
		"ATTACH DATABASE '%s' AS sw",
		strings.ReplaceAll(wordsDB, "'", "''"),
	)); err != nil {
		return 0, "", fmt.Errorf("attach: %w", err)
	}

	schema := detectSchema(src)
	if schema.SongTable == "" || schema.TitleCol == "" {
		return 0, "", fmt.Errorf("song table not found")
	}

	// Re-query for the specific rowid we want. Same column shape as
	// the scan loop — swap ORDER BY for a WHERE clause.
	scanQ := buildSongScanQuery(schema)
	q := strings.Replace(scanQ,
		"ORDER BY "+quoteIdent(schema.TitleCol)+" COLLATE NOCASE",
		"WHERE rowid = ?", 1)
	row := src.QueryRow(q, rowid)
	var (
		_rowid          int64
		title           sql.NullString
		author          sql.NullString
		copyright       sql.NullString
		administrator   sql.NullString
		songNumber      sql.NullString
		referenceNumber sql.NullString
		vendorNumber    sql.NullString
		ccliNumber      sql.NullString
		themeName       sql.NullString
	)
	if err := row.Scan(
		&_rowid, &title, &author, &copyright, &administrator,
		&songNumber, &referenceNumber, &vendorNumber, &ccliNumber, &themeName,
	); err != nil {
		return 0, "", fmt.Errorf("song row: %w", err)
	}
	if !title.Valid || strings.TrimSpace(title.String) == "" {
		return 0, "", errors.New("song has empty title")
	}
	npTitle := strings.TrimSpace(title.String)

	// Pull all slide RTFs in order. Uses the detected word-table
	// schema so EW6 (lowercase) and EW7+ (PascalCase) both work.
	if schema.WordTable == "" || schema.WordSongIDCol == "" || schema.WordTextCol == "" {
		// Be loud about what we DID find — the user (or whoever
		// reads the warning) can ship the list back as a bug report.
		return 0, "", fmt.Errorf("words table not recognised in SongWords.db. tables present: %v", listTables(src, "sw"))
	}
	wrows, err := src.Query(buildWordsQuery(schema), rowid)
	if err != nil {
		return 0, "", fmt.Errorf("words query: %w", err)
	}
	defer wrows.Close()
	type slide struct {
		sectionType string
		body        string
	}
	slides := make([]slide, 0, 16)
	for wrows.Next() {
		var raw sql.NullString
		if err := wrows.Scan(&raw); err != nil {
			continue
		}
		txt := rtf.Strip(raw.String)
		secType, body := splitSectionLabel(txt)
		if opts.StripFirstLine {
			body = dropFirstNonEmptyLine(body)
		}
		slides = append(slides, slide{secType, body})
	}
	_ = themeName

	// Conflict resolution against the NP library.
	existing, hasExisting, err := s.songByTitle(ctx, npTitle)
	if err != nil {
		return 0, "", fmt.Errorf("lookup existing: %w", err)
	}
	action := "imported"
	if hasExisting {
		switch policy {
		case ConflictSkip:
			return existing.ID, "skipped", nil
		case ConflictRename:
			npTitle = s.nextAvailableTitle(ctx, npTitle)
			action = "renamed"
		case ConflictOverwrite:
			if err := s.deleteSongSections(ctx, existing.ID); err != nil {
				return 0, "", fmt.Errorf("clear: %w", err)
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

	var npSong database.Song
	if action == "overwrote" {
		npSong = existing
	} else {
		npSong, err = qtx.CreateSong(ctx, npTitle)
		if err != nil {
			return 0, "", fmt.Errorf("create song: %w", err)
		}
	}

	// Coalesce CCLI metadata. CCLI number lives in either `ccli` or
	// `reference_number` depending on version; prefer the dedicated
	// column when present.
	authorVal := strings.TrimSpace(author.String)
	copyrightVal := strings.TrimSpace(copyright.String)
	publisherVal := strings.TrimSpace(administrator.String)
	ccliVal := strings.TrimSpace(firstNonEmpty(ccliNumber.String, referenceNumber.String))
	if authorVal != "" || copyrightVal != "" || publisherVal != "" || ccliVal != "" {
		_, err = qtx.UpdateSongMetadata(ctx, database.UpdateSongMetadataParams{
			Author:     nullableString(authorVal),
			Copyright:  nullableString(copyrightVal),
			Publisher:  nullableString(publisherVal),
			CcliNumber: nullableString(ccliVal),
			ID:         npSong.ID,
		})
		if err != nil {
			return 0, "", fmt.Errorf("update metadata: %w", err)
		}
	}

	// Group consecutive slides by their inferred section type into a
	// single NP section. EW typically has one slide per section, but
	// some libraries stack two slides into the same "Verse 1" — we
	// want both lines under one NP "verse" section.
	type group struct {
		sectionType string
		slides      []string
	}
	var groups []group
	for _, sl := range slides {
		if len(groups) == 0 || groups[len(groups)-1].sectionType != sl.sectionType {
			groups = append(groups, group{sl.sectionType, []string{sl.body}})
		} else {
			groups[len(groups)-1].slides = append(groups[len(groups)-1].slides, sl.body)
		}
	}

	for gi, g := range groups {
		sec, err := qtx.CreateSongSectionAppend(ctx, database.CreateSongSectionAppendParams{
			SongID: npSong.ID,
			Type:   g.sectionType,
		})
		if err != nil {
			return 0, "", fmt.Errorf("section %d: %w", gi, err)
		}
		linePos := int64(0)
		for _, body := range g.slides {
			for _, ln := range rtf.SplitLines(body) {
				if ln == "" {
					continue
				}
				if _, err := qtx.CreateSongLine(ctx, database.CreateSongLineParams{
					SectionID: sec.ID,
					Position:  linePos,
					Text:      ln,
				}); err != nil {
					return 0, "", fmt.Errorf("line: %w", err)
				}
				linePos++
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, "", fmt.Errorf("commit: %w", err)
	}
	return npSong.ID, action, nil
}

// dropFirstNonEmptyLine returns body with its first non-empty line
// removed. Used by the "strip first line of each slide" import
// option to clean up labels / titles EW operators leave at the top
// of every slide.
func dropFirstNonEmptyLine(body string) string {
	lines := strings.Split(body, "\n")
	out := make([]string, 0, len(lines))
	dropped := false
	for _, ln := range lines {
		if !dropped && strings.TrimSpace(ln) != "" {
			dropped = true
			continue
		}
		out = append(out, ln)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

// splitSectionLabel inspects the first line of a slide's stripped
// text and, if it looks like a section label ("V1", "Verse 1",
// "Chorus", "Bridge", "Tag", "Intro", "Outro", "Pre-chorus"),
// returns (sectionType, rest-of-text). Otherwise returns
// ("verse", original) so unlabeled slides still land in a section.
func splitSectionLabel(text string) (string, string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "verse", ""
	}
	lines := strings.SplitN(text, "\n", 2)
	first := strings.TrimSpace(lines[0])
	rest := ""
	if len(lines) > 1 {
		rest = lines[1]
	}
	low := strings.ToLower(first)

	// Compact labels: V1, V2, C, B, T, I, O, P, P1
	if len(low) <= 3 {
		switch {
		case strings.HasPrefix(low, "v"):
			return "verse", rest
		case strings.HasPrefix(low, "c"):
			return "chorus", rest
		case strings.HasPrefix(low, "b"):
			return "bridge", rest
		case strings.HasPrefix(low, "t"):
			return "tag", rest
		case strings.HasPrefix(low, "i"):
			return "intro", rest
		case strings.HasPrefix(low, "o"):
			return "outro", rest
		case strings.HasPrefix(low, "p"):
			return "prechorus", rest
		}
	}

	// Word labels.
	switch {
	case strings.HasPrefix(low, "verse"):
		return "verse", rest
	case strings.HasPrefix(low, "chorus"):
		return "chorus", rest
	case strings.HasPrefix(low, "bridge"):
		return "bridge", rest
	case strings.HasPrefix(low, "pre-chorus"), strings.HasPrefix(low, "prechorus"):
		return "prechorus", rest
	case strings.HasPrefix(low, "tag"):
		return "tag", rest
	case strings.HasPrefix(low, "intro"):
		return "intro", rest
	case strings.HasPrefix(low, "outro"), strings.HasPrefix(low, "ending"):
		return "outro", rest
	case strings.HasPrefix(low, "interlude"):
		return "interlude", rest
	}
	// No label — keep the whole text and treat it as a verse.
	return "verse", text
}

// --- DB helpers ----------------------------------------------------------
//
// Mirrors the equivalents in proimport. Tempting to share via a
// helper module — leaving them duplicated for now because the two
// services already differ on their conflict-resolution surface and
// would diverge further once arrangements / themes land.

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

func nullableString(s string) sql.NullString {
	t := strings.TrimSpace(s)
	if t == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: t, Valid: true}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		t := strings.TrimSpace(v)
		if t != "" {
			return t
		}
	}
	return ""
}
