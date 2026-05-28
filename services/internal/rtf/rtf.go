// Package rtf is a minimal RTF text extractor for importer paths.
//
// ProPresenter slide text and EasyWorship song words both ship as
// RTF blobs. We don't need full RTF rendering — just the plain
// Unicode underneath, with paragraph / line breaks preserved so the
// caller can split into NP song lines.
//
// The parser is destination-aware: RTF wraps non-text payloads
// (font tables, colour tables, style sheets, embedded pictures,
// generator metadata, document info, …) in groups marked with `\*`
// or a known destination control word. We skip those groups
// entirely. Without that step the font-family names from `\fonttbl`
// leak straight into the extracted text — which is exactly what
// happened before this rewrite.
//
// Strip is permissive: malformed input returns whatever plain runs
// are recoverable rather than failing. Better to land an imperfect
// song than refuse the whole library over one stray brace.
package rtf

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// destinationCWs is the set of control words that introduce a
// non-text destination group. Anything between the opening `{` of
// the group containing one of these and its matching `}` is dropped.
//
// Sourced from the RTF 1.9.1 spec + observed real-world payloads
// (ProPresenter / EasyWorship / Word). Conservative: when in doubt,
// add to the list — leaking a destination's content is the worse
// outcome.
var destinationCWs = map[string]bool{
	"fonttbl":              true,
	"colortbl":             true,
	"stylesheet":           true,
	"listtable":            true,
	"listoverridetable":    true,
	"rsidtbl":              true,
	"generator":            true,
	"info":                 true,
	"author":               true,
	"company":              true,
	"operator":             true,
	"title":                true,
	"subject":              true,
	"keywords":             true,
	"comment":              true,
	"doccomm":              true,
	"hlinkbase":            true,
	"creatim":              true,
	"revtim":               true,
	"printim":              true,
	"buptim":               true,
	"version":              true,
	"vern":                 true,
	"edmins":               true,
	"nofpages":             true,
	"nofwords":             true,
	"nofchars":             true,
	"nofcharsws":           true,
	"id":                   true,
	"pict":                 true,
	"object":               true,
	"objdata":              true,
	"shppict":              true,
	"nonshppict":           true,
	"themedata":            true,
	"colorschememapping":   true,
	"datastore":            true,
	"latentstyles":         true,
	"xmlnstbl":             true,
	"mmathPr":              true,
	"mmath":                true,
	"defchp":               true,
	"defpap":               true,
	"falt":                 true,
	"panose":               true,
	"fname":                true,
	"filetbl":              true,
	"file":                 true,
	"bkmkstart":            true,
	"bkmkend":              true,
	"field":                true,
	"fldinst":              true,
	"fldrslt":              false, // KEEP rendered field result — that's user-visible text
}

// frame is one RTF group frame. skip = drop everything emitted from
// this group + nested ones (set by `\*` or a destination control
// word at the start of the group). Lives at package scope so the
// top() helper can return it.
type frame struct {
	skip bool
}

// Strip converts RTF source to plain text. Hand-rolled state machine
// — small enough to follow, fast enough that the whole library
// imports in seconds.
func Strip(in string) string {
	stack := []frame{{}}
	var b strings.Builder
	b.Grow(len(in))

	i := 0
	for i < len(in) {
		c := in[i]
		switch c {
		case '{':
			// New group inherits parent's skip state by default. A
			// `\*` or destination-CW seen at the start of this group
			// can flip it on.
			parentSkip := false
			if len(stack) > 0 {
				parentSkip = stack[len(stack)-1].skip
			}
			stack = append(stack, frame{skip: parentSkip})
			i++
		case '}':
			if len(stack) > 1 {
				stack = stack[:len(stack)-1]
			}
			i++
		case '\\':
			if i+1 >= len(in) {
				i++
				continue
			}
			next := in[i+1]
			// Escaped specials.
			if next == '\\' || next == '{' || next == '}' {
				if !top(stack).skip {
					b.WriteByte(next)
				}
				i += 2
				continue
			}
			// `\*` marks current group as a destination — skip its
			// remaining content.
			if next == '*' {
				if len(stack) > 0 {
					stack[len(stack)-1].skip = true
				}
				i += 2
				continue
			}
			// `\'XX` hex escape — one byte in the document's code
			// page. We decode as windows-1252 / latin-1 which covers
			// virtually every English / Western-European RTF.
			if next == '\'' && i+3 < len(in) {
				hex := in[i+2 : i+4]
				if n, err := strconv.ParseInt(hex, 16, 32); err == nil {
					if !top(stack).skip {
						b.WriteRune(decodeCP1252(byte(n)))
					}
					i += 4
					continue
				}
				i += 2
				continue
			}
			// `\uNNNN[?]` unicode escape.
			if next == 'u' && i+2 < len(in) && (in[i+2] == '-' || (in[i+2] >= '0' && in[i+2] <= '9')) {
				j := i + 2
				neg := false
				if in[j] == '-' {
					neg = true
					j++
				}
				k := j
				for k < len(in) && k < j+6 && in[k] >= '0' && in[k] <= '9' {
					k++
				}
				if k > j {
					n, _ := strconv.Atoi(in[j:k])
					if neg {
						n = 65536 - n
					}
					if !top(stack).skip {
						b.WriteRune(rune(n))
					}
					// Skip the fallback char (one byte) after \uN.
					if k < len(in) && in[k] == '?' {
						k++
					} else if k < len(in) && in[k] != '\\' && in[k] != '{' && in[k] != '}' && in[k] != ' ' {
						k++
					}
					i = k
					continue
				}
			}
			// Other line-break-ish symbol escapes.
			if next == '\n' || next == '\r' {
				if !top(stack).skip {
					b.WriteByte('\n')
				}
				i += 2
				continue
			}
			if next == '~' {
				if !top(stack).skip {
					b.WriteByte(' ')
				}
				i += 2
				continue
			}
			if next == '-' || next == '_' {
				// non-breaking hyphen / optional hyphen → emit '-'
				if !top(stack).skip {
					b.WriteByte('-')
				}
				i += 2
				continue
			}
			// Generic control word: `\name[-digits][ ]`.
			j := i + 1
			start := j
			for j < len(in) && isAlpha(in[j]) {
				j++
			}
			name := in[start:j]
			// Optional numeric argument.
			for j < len(in) && (in[j] == '-' || (in[j] >= '0' && in[j] <= '9')) {
				j++
			}
			// Optional single space delimiter.
			if j < len(in) && in[j] == ' ' {
				j++
			}
			// Destination control words flip the current group to skip.
			if destinationCWs[name] {
				if len(stack) > 0 {
					stack[len(stack)-1].skip = true
				}
			}
			// Paragraph / line breaks — only emit when not in a skip
			// group. Both `\par` and `\line` are common; some RTF
			// flavours use `\sect` for section breaks too.
			if !top(stack).skip {
				switch name {
				case "par", "line", "sect":
					b.WriteByte('\n')
				case "tab":
					b.WriteByte('\t')
				case "emdash":
					b.WriteRune('—')
				case "endash":
					b.WriteRune('–')
				case "lquote":
					b.WriteRune('‘')
				case "rquote":
					b.WriteRune('’')
				case "ldblquote":
					b.WriteRune('“')
				case "rdblquote":
					b.WriteRune('”')
				case "bullet":
					b.WriteRune('•')
				}
			}
			i = j
		default:
			if !top(stack).skip {
				b.WriteByte(c)
			}
			i++
		}
	}
	return normaliseWhitespace(b.String())
}

// top returns the deepest frame without panicking when the stack is
// somehow empty — defensive against malformed RTF that closes more
// braces than it opens.
func top(stack []frame) frame {
	if len(stack) == 0 {
		return frame{}
	}
	return stack[len(stack)-1]
}

// decodeCP1252 maps a windows-1252 byte to its Unicode rune. The
// 0x80–0x9F range diverges from ISO-8859-1 — those slots hold the
// curly quotes, em-dash, euro sign, etc. that show up everywhere
// in real-world RTF.
func decodeCP1252(b byte) rune {
	if b < 0x80 {
		return rune(b)
	}
	if b >= 0xA0 {
		return rune(b) // matches ISO-8859-1 above 0x9F
	}
	// CP1252 0x80–0x9F overrides
	table := map[byte]rune{
		0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„',
		0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ',
		0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ',
		0x8E: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“',
		0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
		0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›',
		0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ',
	}
	if r, ok := table[b]; ok {
		return r
	}
	return rune(b)
}

// SplitLines normalises and splits a text block on newlines, trimming
// each line. Empty lines are preserved in the returned slice so the
// caller can spot paragraph breaks; callers that want only content
// lines should filter for ln != "".
func SplitLines(s string) []string {
	if s == "" {
		return nil
	}
	out := strings.Split(s, "\n")
	for i, ln := range out {
		out[i] = strings.TrimSpace(ln)
	}
	return out
}

// CountLines reports the number of non-empty lines.
func CountLines(s string) int {
	n := 0
	for _, ln := range SplitLines(s) {
		if ln != "" {
			n++
		}
	}
	return n
}

// StripWhitespace drops every Unicode whitespace rune (used when
// decoding base64 RTF blobs that ProPresenter wraps at 76 columns).
func StripWhitespace(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if !unicode.IsSpace(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func isAlpha(c byte) bool { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }

var (
	wsRunRE    = regexp.MustCompile(`[ \t]+`)
	blankRunRE = regexp.MustCompile(`\n{3,}`)
)

func normaliseWhitespace(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = wsRunRE.ReplaceAllString(s, " ")
	s = blankRunRE.ReplaceAllString(s, "\n\n")
	lines := strings.Split(s, "\n")
	for i, ln := range lines {
		lines[i] = strings.TrimRightFunc(ln, unicode.IsSpace)
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}
