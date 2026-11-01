//go:build !windows

package transcode

import "os/exec"

// HideWindow is a no-op off Windows (no console windows to hide).
func HideWindow(cmd *exec.Cmd) {}
