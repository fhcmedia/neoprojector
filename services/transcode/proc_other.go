//go:build !windows

package transcode

import "os/exec"

// HideWindow is a no-op off Windows (no console windows to hide).
func HideWindow(cmd *exec.Cmd) {}

// setBackground is a no-op off Windows (priority classes are Windows').
func setBackground(pid int, idle bool) {}
