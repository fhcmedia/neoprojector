//go:build darwin

package updates

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// swapAndRelaunch replaces the running .app bundle with the one inside
// the downloaded zip, then relaunches it. Does not return on success.
//
// The staging dir lives next to the bundle (same volume) so the two
// renames are cheap and atomic; extraction goes through ditto, which
// preserves symlinks and permissions the way archive/zip does not.
// If the app was translocated (launched while still quarantined from
// ~/Downloads) the bundle path is a read-only mount and the first
// rename fails — the error propagates and the splash continues on the
// current version.
func swapAndRelaunch(archive string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return err
	}
	// …/NeoProjector.app/Contents/MacOS/neoprojector → bundle root
	bundle := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	if !strings.HasSuffix(bundle, ".app") {
		return fmt.Errorf("not running from an .app bundle: %s", exe)
	}

	staging, err := os.MkdirTemp(filepath.Dir(bundle), ".neoprojector-update-")
	if err != nil {
		return fmt.Errorf("staging dir: %w", err)
	}
	defer os.RemoveAll(staging)

	if out, err := exec.Command("ditto", "-x", "-k", archive, staging).CombinedOutput(); err != nil {
		return fmt.Errorf("extract: %w: %s", err, out)
	}
	entries, err := os.ReadDir(staging)
	if err != nil {
		return err
	}
	var newBundle string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".app") {
			newBundle = filepath.Join(staging, e.Name())
			break
		}
	}
	if newBundle == "" {
		return fmt.Errorf("archive contains no .app bundle")
	}

	previous := filepath.Join(staging, "previous.app")
	if err := os.Rename(bundle, previous); err != nil {
		return fmt.Errorf("move current bundle aside: %w", err)
	}
	if err := os.Rename(newBundle, bundle); err != nil {
		// Put the old bundle back so the install stays launchable.
		if rerr := os.Rename(previous, bundle); rerr != nil {
			return fmt.Errorf("install new bundle: %w (restore also failed: %v)", err, rerr)
		}
		return fmt.Errorf("install new bundle: %w", err)
	}

	// The swap is done — from here even a relaunch failure leaves a
	// valid new install on disk; the running (old) process just keeps
	// going for this session.
	if err := exec.Command("open", "-n", bundle).Run(); err != nil {
		return fmt.Errorf("updated, but relaunch failed: %w", err)
	}
	os.RemoveAll(staging) // deleting the old bundle under a running binary is fine on macOS
	os.Exit(0)
	return nil
}
