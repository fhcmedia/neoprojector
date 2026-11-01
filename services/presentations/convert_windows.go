//go:build windows

package presentations

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"neoprojector/services/transcode"
)

// powerPointTimeout bounds one export. PowerPoint exports a sermon deck
// in seconds; anything near this means it is stuck behind a dialog
// (activation, sign-in, repair prompt) that can't be seen.
const powerPointTimeout = 2 * time.Minute

// powerPointToPDF exports src with Microsoft PowerPoint through COM
// automation (PowerShell). It fails fast when PowerPoint isn't
// installed; the caller then falls back to LibreOffice. The document is
// opened read-only and without a window, with alerts off, and
// PowerPoint is only quit when this export was its only open document.
// If the export hangs and PowerPoint wasn't running before, the
// PowerPoint it started is ended too — otherwise the next attempt would
// attach to the same stuck instance and hang again.
func powerPointToPDF(ctx context.Context, src, out string) error {
	script := `
$ErrorActionPreference = 'Stop'
try { $pp = New-Object -ComObject PowerPoint.Application } catch { Write-Output 'NOPOWERPOINT'; exit 3 }
try { $pp.DisplayAlerts = 1 } catch {}
$had = $pp.Presentations.Count
$p = $pp.Presentations.Open($env:NP_SRC, -1, 0, 0)
try { $p.SaveAs($env:NP_OUT, 32) } finally { $p.Close() }
if ($had -eq 0) { $pp.Quit() }
`
	before := powerPointPIDs()
	cctx, cancel := context.WithTimeout(ctx, powerPointTimeout)
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
		if cctx.Err() != nil {
			// Stuck or cancelled: end only PowerPoint processes this
			// export started, never the user's own open PowerPoint.
			for pid := range powerPointPIDs() {
				if !before[pid] {
					kill := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
					transcode.HideWindow(kill)
					_ = kill.Run()
				}
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return errors.New("PowerPoint didn't respond (it may be waiting on a dialog)")
		}
		return fmt.Errorf("%w %s", err, strings.TrimSpace(string(b)))
	}
	return nil
}

// powerPointPIDs lists running POWERPNT.EXE process ids.
func powerPointPIDs() map[int]bool {
	cmd := exec.Command("tasklist", "/FI", "IMAGENAME eq POWERPNT.EXE", "/FO", "CSV", "/NH")
	transcode.HideWindow(cmd)
	out, err := cmd.Output()
	pids := map[int]bool{}
	if err != nil {
		return pids
	}
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Split(line, ",")
		if len(f) < 2 {
			continue
		}
		if pid, err := strconv.Atoi(strings.Trim(f[1], "\" \r")); err == nil {
			pids[pid] = true
		}
	}
	return pids
}
