package presentations

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"neoprojector/services/transcode"

	"github.com/charmbracelet/log"
)

// Converting presentation files to PDF.
//
// The app renders every deck from a PDF (pdf.js, in the operator window),
// so PowerPoint-family files are first turned into one, by whatever this
// PC has, best fidelity first:
//  1. Microsoft PowerPoint (Windows, via COM) — exactly what the author saw;
//  2. LibreOffice, if installed;
//  3. LibreOffice fetched once into the app's data folder (Windows): the
//     pinned official MSI, sha256-verified, unpacked with an
//     administrative install (`msiexec /a`), which needs no admin rights.

// deckExts are the files ImportDeck accepts, beyond PDF itself.
var deckExts = map[string]bool{
	".pptx": true, ".ppt": true, ".pps": true, ".ppsx": true,
	".pptm": true, ".potx": true, ".odp": true, ".key": true,
}

// IsDeckFile reports whether path is a PDF or a presentation file.
func IsDeckFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".pdf" || deckExts[ext]
}

// Pinned LibreOffice (bump all together; sha256 is TDF's published hash).
// The stable URL disappears once a newer release ships; the archive URL
// serves the same file from then on.
const (
	loVersion = "26.8.2"
	loSHA256  = "ff4b911403b67ee9e6249f820f9782c44bb32c94fdaa45b0da53a8e419e5307a"
)

var loURLs = []string{
	"https://download.documentfoundation.org/libreoffice/stable/" + loVersion + "/win/x86_64/LibreOffice_" + loVersion + "_Win_x86-64.msi",
	"https://downloadarchive.documentfoundation.org/libreoffice/old/" + loVersion + "/win/x86_64/LibreOffice_" + loVersion + "_Win_x86-64.msi",
}

// One conversion at a time: LibreOffice refuses a second instance on the
// same profile, and PowerPoint automation is single-document anyway.
var convertMu sync.Mutex

// progressFn reports a stage ("waiting", "powerpoint", "downloading",
// "unpacking", "converting") and, where known, a 0–100 percentage
// (-1 = unknown).
type progressFn func(stage string, pct int)

// toPDF converts src (a presentation file) into a PDF inside outDir and
// returns its path.
func toPDF(ctx context.Context, src, outDir, toolsDir string, progress progressFn) (string, error) {
	if !convertMu.TryLock() {
		// Another import is converting: say so instead of an unexplained
		// spinner, and give up if this one is cancelled while waiting.
		progress("waiting", -1)
		locked := make(chan struct{})
		go func() {
			convertMu.Lock()
			close(locked)
		}()
		select {
		case <-locked:
		case <-ctx.Done():
			go func() { <-locked; convertMu.Unlock() }()
			return "", ctx.Err()
		}
	}
	defer convertMu.Unlock()

	var errs []string
	if runtime.GOOS == "windows" {
		progress("powerpoint", -1)
		out := filepath.Join(outDir, "deck.pdf")
		err := powerPointToPDF(ctx, src, out)
		if err == nil && fileOK(out) {
			return out, nil
		}
		if err != nil {
			errs = append(errs, "PowerPoint: "+err.Error())
		}
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
	}
	soffice := findLibreOffice(toolsDir)
	if soffice == "" && runtime.GOOS == "windows" {
		var err error
		soffice, err = ensureLibreOffice(ctx, toolsDir, progress)
		if err != nil {
			errs = append(errs, "LibreOffice download: "+err.Error())
		}
	}
	if soffice == "" {
		errs = append(errs, "LibreOffice is not installed")
		return "", fmt.Errorf("can't convert this file (%s) — export it as PDF and import that instead", strings.Join(errs, "; "))
	}
	progress("converting", -1)
	out, err := libreOfficeToPDF(ctx, soffice, src, outDir, toolsDir)
	if err != nil {
		errs = append(errs, "LibreOffice: "+err.Error())
		return "", fmt.Errorf("can't convert this file (%s) — export it as PDF and import that instead", strings.Join(errs, "; "))
	}
	return out, nil
}

// findLibreOffice returns an installed or previously fetched soffice.
func findLibreOffice(toolsDir string) string {
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		candidates = append(candidates,
			filepath.Join(toolsDir, "libreoffice-"+loVersion, "program", "soffice.exe"),
			filepath.Join(os.Getenv("ProgramFiles"), "LibreOffice", "program", "soffice.exe"),
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "LibreOffice", "program", "soffice.exe"),
		)
	case "darwin":
		candidates = append(candidates, "/Applications/LibreOffice.app/Contents/MacOS/soffice")
	}
	for _, c := range candidates {
		if fileOK(c) {
			return c
		}
	}
	for _, name := range []string{"soffice", "libreoffice"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	return ""
}

// ensureLibreOffice fetches and unpacks the pinned LibreOffice into
// toolsDir (≈360 MB download, ≈1.5 GB unpacked, once).
func ensureLibreOffice(ctx context.Context, toolsDir string, progress progressFn) (string, error) {
	final := filepath.Join(toolsDir, "libreoffice-"+loVersion)
	soffice := filepath.Join(final, "program", "soffice.exe")
	if fileOK(soffice) {
		return soffice, nil
	}
	if err := os.MkdirAll(toolsDir, 0o755); err != nil {
		return "", err
	}
	var msi string
	var lastErr error
	for _, u := range loURLs {
		progress("downloading", 0)
		p, err := transcode.DownloadVerified(ctx, u, loSHA256, toolsDir, func(pct int) { progress("downloading", pct) })
		if err == nil {
			msi = p
			break
		}
		if p != "" {
			os.Remove(p)
		}
		lastErr = err
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
	}
	if msi == "" {
		return "", lastErr
	}
	defer os.Remove(msi)
	// msiexec wants a .msi extension.
	named := msi + ".msi"
	if err := os.Rename(msi, named); err != nil {
		return "", err
	}
	defer os.Remove(named)

	progress("unpacking", -1)
	tmp := final + ".part"
	os.RemoveAll(tmp)
	cctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(cctx, "msiexec.exe", "/a", named, "/qn", "TARGETDIR="+tmp)
	transcode.HideWindow(cmd)
	if out, err := cmd.CombinedOutput(); err != nil {
		os.RemoveAll(tmp)
		return "", fmt.Errorf("unpack: %w %s", err, strings.TrimSpace(string(out)))
	}
	// The administrative image also carries a copy of the MSI; drop it.
	if entries, err := os.ReadDir(tmp); err == nil {
		for _, e := range entries {
			if strings.HasSuffix(strings.ToLower(e.Name()), ".msi") {
				os.Remove(filepath.Join(tmp, e.Name()))
			}
		}
	}
	if !fileOK(filepath.Join(tmp, "program", "soffice.exe")) {
		os.RemoveAll(tmp)
		return "", errors.New("unpacked LibreOffice has no soffice.exe")
	}
	os.RemoveAll(final)
	if err := os.Rename(tmp, final); err != nil {
		return "", err
	}
	log.Info("presentations: LibreOffice ready", "dir", final)
	return soffice, nil
}

// libreOfficeToPDF runs a headless conversion with a private profile
// (so it never collides with a LibreOffice the user has open).
func libreOfficeToPDF(ctx context.Context, soffice, src, outDir, toolsDir string) (string, error) {
	profile := filepath.ToSlash(filepath.Join(toolsDir, "libreoffice-profile"))
	if !strings.HasPrefix(profile, "/") {
		profile = "/" + profile
	}
	// The first conversion also builds LibreOffice's profile: ~1.5 min on
	// a fast PC, several on an old one.
	cctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(cctx, soffice,
		"-env:UserInstallation=file://"+profile,
		"--headless", "--norestore", "--nologo", "--nolockcheck",
		"--convert-to", "pdf", "--outdir", outDir, src)
	transcode.HideWindow(cmd)
	out, err := cmd.CombinedOutput()
	pdf := filepath.Join(outDir, strings.TrimSuffix(filepath.Base(src), filepath.Ext(src))+".pdf")
	if err != nil {
		if cctx.Err() == context.DeadlineExceeded {
			return "", errors.New("LibreOffice took longer than 10 minutes")
		}
		return "", fmt.Errorf("%w %s", err, strings.TrimSpace(string(out)))
	}
	if !fileOK(pdf) {
		return "", fmt.Errorf("no PDF produced %s", strings.TrimSpace(string(out)))
	}
	return pdf, nil
}

func fileOK(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir() && st.Size() > 0
}
