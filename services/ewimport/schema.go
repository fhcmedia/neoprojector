// EasyWorship's two SQLite databases drift between versions. EW 6
// uses snake_case (`song`, `song_id`, `words`); EW 7+ uses PascalCase
// (`Song`, `SongID`, `Words`). Some installs surprise us with a
// half-and-half schema after an in-place upgrade. We can't hardcode
// the names, so this file detects them at runtime from
// `sqlite_master` + `PRAGMA table_info`.
//
// The detection is best-effort and gracefully degrades: if we can't
// find a column with a sensible name, the slot stays empty and the
// caller treats it as missing data (rather than failing the import).

package ewimport

import (
	"database/sql"
	"strings"
)

// ewSchema holds the resolved table + column identifiers for one
// EasyWorship library. Fields are quoted as written in the DB so the
// query builder can drop them straight into SQL — SQLite is
// case-insensitive for identifiers, but ATTACHed databases sometimes
// surprise us, and case-preserving is the safer move.
type ewSchema struct {
	// song-side
	SongTable        string
	SongIDCol        string // usually rowid; some EW versions add an `id` PK column
	TitleCol         string
	AuthorCol        string
	CopyrightCol     string
	AdministratorCol string
	SongNumberCol    string
	ReferenceCol     string
	VendorCol        string
	CCLICol          string
	ThemeCol         string

	// word-side (in attached "sw" db)
	WordTable string
	WordSongIDCol string
	WordTextCol   string
	WordOrderCol  string // optional; if present we order by it, else by rowid
}

// detectSchema inspects the main + sw databases and returns a fully
// populated schema. Missing fields stay as empty strings; queries
// that need them treat empty as "skip that column" or "no order".
func detectSchema(db *sql.DB) ewSchema {
	s := ewSchema{}

	// Song table is whatever sqlite_master calls it. Common: "song"
	// (EW6) or "Song" (EW7). Pick the first non-system table whose
	// name lowercases to "song".
	if t, cols := findTable(db, "main", []string{"song"}); t != "" {
		s.SongTable = t
		s.TitleCol = pickColumn(cols, "title")
		s.AuthorCol = pickColumn(cols, "author", "writer", "songwriter")
		s.CopyrightCol = pickColumn(cols, "copyright", "copyrighttext", "copyright_text")
		s.AdministratorCol = pickColumn(cols, "administrator", "publisher", "admin")
		s.SongNumberCol = pickColumn(cols, "song_number", "songnumber")
		s.ReferenceCol = pickColumn(cols, "reference_number", "referencenumber")
		s.VendorCol = pickColumn(cols, "vendor_song_number", "vendorsongnumber")
		s.CCLICol = pickColumn(cols, "ccli", "ccli_number", "cclinumber")
		s.ThemeCol = pickColumn(cols, "theme_name", "themename", "theme")
		// PK column. PRAGMA didn't capture pk flag here; default to
		// rowid which sqlite always exposes implicitly for non-WITHOUT-ROWID
		// tables.
		s.SongIDCol = "rowid"
	}

	// Word table in the attached sw db. Names seen in the wild:
	// "word" (EW6), "Word" (EW7), occasionally "WordList" / "Slide".
	// When none of those hit, fall back to enumerating every table in
	// the attached db and pick the first one with a sensible
	// (song_id, text) column pair.
	t, cols := findTable(db, "sw", []string{"word", "wordlist", "slide", "songslide", "lyric", "lyrics"})
	if t == "" {
		t, cols = findFirstSongChildTable(db, "sw")
	}
	if t != "" {
		s.WordTable = t
		s.WordSongIDCol = pickColumn(cols, "song_id", "songid")
		s.WordTextCol = pickColumn(cols, "words", "word", "text", "slide_text", "slidetext", "rtf", "rtfdata", "content")
		s.WordOrderCol = pickColumn(cols, "order", "slide_order", "slideorder", "position", "sort_order", "rank")
	}

	return s
}

// findFirstSongChildTable enumerates every table in the named schema
// and returns the first one that has both a song-id-shaped column
// (`song_id` / `songid`) AND a text-shaped column. Last-chance
// fallback when a SongWords variant uses an unexpected table name.
func findFirstSongChildTable(db *sql.DB, schema string) (string, map[string]string) {
	rows, err := db.Query("SELECT name FROM " + schema + ".sqlite_master WHERE type='table'")
	if err != nil {
		return "", nil
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			names = append(names, name)
		}
	}
	for _, n := range names {
		cols := columnsOf(db, schema, n)
		songIDCol := pickColumn(cols, "song_id", "songid")
		textCol := pickColumn(cols, "words", "word", "text", "slide_text", "slidetext", "rtf", "rtfdata", "content")
		if songIDCol != "" && textCol != "" {
			return n, cols
		}
	}
	return "", nil
}

// findTable scans the named schema's sqlite_master for the first
// table whose lowercased name matches one of candidates. Returns the
// actual table name (case preserved) plus its column map (lowercased
// name → actual name).
func findTable(db *sql.DB, schema string, candidates []string) (string, map[string]string) {
	want := map[string]struct{}{}
	for _, c := range candidates {
		want[strings.ToLower(c)] = struct{}{}
	}
	q := "SELECT name FROM " + schema + ".sqlite_master WHERE type='table'"
	rows, err := db.Query(q)
	if err != nil {
		return "", nil
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		if _, ok := want[strings.ToLower(name)]; !ok {
			continue
		}
		cols := columnsOf(db, schema, name)
		if len(cols) > 0 {
			return name, cols
		}
	}
	return "", nil
}

// columnsOf returns a map of (lowercased name → actual case-preserved
// name) for the given table.
func columnsOf(db *sql.DB, schema, table string) map[string]string {
	// PRAGMA table_info has to interpolate the table — placeholders
	// aren't supported for schema-introspection statements. Quote
	// double-quoted identifiers to defang names with weird chars.
	q := "PRAGMA " + schema + ".table_info(\"" + strings.ReplaceAll(table, "\"", "\"\"") + "\")"
	rows, err := db.Query(q)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			continue
		}
		out[strings.ToLower(name)] = name
	}
	return out
}

// pickColumn returns the first candidate column name that exists in
// the supplied map. Empty string when none match.
func pickColumn(cols map[string]string, candidates ...string) string {
	for _, c := range candidates {
		if actual, ok := cols[strings.ToLower(c)]; ok {
			return actual
		}
	}
	return ""
}

// listTables returns every user table in the named schema. Used in
// error messages so an unsupported library tells us what it actually
// contains rather than just "not recognised".
func listTables(db *sql.DB, schema string) []string {
	rows, err := db.Query("SELECT name FROM " + schema + ".sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			out = append(out, name)
		}
	}
	return out
}

// quoteIdent wraps an identifier in double-quotes for safe SQL
// embedding. Falls back to an explicit NULL literal when the
// identifier is empty (col not present).
func quoteIdent(ident string) string {
	if ident == "" {
		return ""
	}
	return "\"" + strings.ReplaceAll(ident, "\"", "\"\"") + "\""
}
