//go:build windows

package transcode

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

const (
	createNoWindow           = 0x08000000
	belowNormalPriorityClass = 0x00004000
)

// HideWindow runs a helper process (ffmpeg, LibreOffice, PowerShell)
// without flashing a console window over the operator UI, at below-
// normal priority so a conversion can never starve the app (or a live
// service) of CPU.
func HideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow | belowNormalPriorityClass,
	}
}

// setBackground moves a running helper to idle priority (it only gets
// CPU time nothing else wants — used while a service is live) or back
// to below-normal.
func setBackground(pid int, idle bool) {
	h, err := windows.OpenProcess(windows.PROCESS_SET_INFORMATION, false, uint32(pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(h)
	class := uint32(windows.BELOW_NORMAL_PRIORITY_CLASS)
	if idle {
		class = windows.IDLE_PRIORITY_CLASS
	}
	_ = windows.SetPriorityClass(h, class)
}
