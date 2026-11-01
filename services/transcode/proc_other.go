//go:build !windows

package transcode

import "os/exec"

// quiet is a no-op off Windows (no console windows to hide).
func quiet(cmd *exec.Cmd) {}
