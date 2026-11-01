//go:build windows

package transcode

import (
	"os/exec"
	"syscall"
)

const (
	createNoWindow           = 0x08000000
	belowNormalPriorityClass = 0x00004000
)

// quiet runs ffmpeg/ffprobe without flashing a console window over the
// operator UI, at below-normal priority so a conversion can never starve
// the app (or a live service) of CPU.
func quiet(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow | belowNormalPriorityClass,
	}
}
