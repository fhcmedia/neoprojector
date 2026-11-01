//go:build windows

package presentations

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"neoprojector/services/transcode"
)

// powerPointToPDF exports src with Microsoft PowerPoint through COM
// automation (PowerShell). It fails fast when PowerPoint isn't
// installed; the caller then falls back to LibreOffice. The document is
// opened read-only and without a window, and PowerPoint is only quit
// when this export was its only open document.
func powerPointToPDF(ctx context.Context, src, out string) error {
	script := `
$ErrorActionPreference = 'Stop'
try { $pp = New-Object -ComObject PowerPoint.Application } catch { Write-Output 'NOPOWERPOINT'; exit 3 }
$had = $pp.Presentations.Count
$p = $pp.Presentations.Open($env:NP_SRC, -1, 0, 0)
try { $p.SaveAs($env:NP_OUT, 32) } finally { $p.Close() }
if ($had -eq 0) { $pp.Quit() }
`
	cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(cctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	// Paths travel as environment variables: no quoting/escaping bugs
	// with apostrophes or brackets in file names.
	cmd.Env = append(cmd.Environ(), "NP_SRC="+src, "NP_OUT="+out)
	transcode.HideWindow(cmd)
	b, err := cmd.CombinedOutput()
	if strings.Contains(string(b), "NOPOWERPOINT") {
		return errors.New("not installed")
	}
	if err != nil {
		return fmt.Errorf("%w %s", err, strings.TrimSpace(string(b)))
	}
	return nil
}
