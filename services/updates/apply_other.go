//go:build !darwin

package updates

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/minio/selfupdate"
)

// swapAndRelaunch swaps the running executable for the binary inside
// the downloaded archive and relaunches it. Does not return on
// success. selfupdate handles the platform dance — on Windows the
// running exe is renamed aside (legal while running) and the new one
// takes its path.
func swapAndRelaunch(archive string) error {
	bin, err := openArchiveBinary(archive)
	if err != nil {
		return err
	}
	defer bin.Close()

	if err := selfupdate.Apply(bin, selfupdate.Options{}); err != nil {
		if rerr := selfupdate.RollbackError(err); rerr != nil {
			return fmt.Errorf("update failed and rollback failed — reinstall may be required: %w", err)
		}
		return err
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("updated, but relaunch failed: %w", err)
	}
	if err := exec.Command(exe).Start(); err != nil {
		return fmt.Errorf("updated, but relaunch failed: %w", err)
	}
	os.Exit(0)
	return nil
}

// openArchiveBinary returns a reader over the app binary inside the
// platform archive: the .exe in a zip on Windows, the first regular
// file in a tar.gz on Linux (the release tarball contains only the
// binary).
func openArchiveBinary(archive string) (io.ReadCloser, error) {
	if runtime.GOOS == "windows" {
		zr, err := zip.OpenReader(archive)
		if err != nil {
			return nil, err
		}
		for _, f := range zr.File {
			if strings.HasSuffix(f.Name, ".exe") {
				rc, err := f.Open()
				if err != nil {
					zr.Close()
					return nil, err
				}
				return &zipEntry{rc: rc, zr: zr}, nil
			}
		}
		zr.Close()
		return nil, fmt.Errorf("no .exe in %s", archive)
	}

	f, err := os.Open(archive)
	if err != nil {
		return nil, err
	}
	gz, err := gzip.NewReader(f)
	if err != nil {
		f.Close()
		return nil, err
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			f.Close()
			return nil, err
		}
		if h.Typeflag == tar.TypeReg {
			return &tarEntry{r: tr, gz: gz, f: f}, nil
		}
	}
	f.Close()
	return nil, fmt.Errorf("no binary in %s", archive)
}

type zipEntry struct {
	rc io.ReadCloser
	zr *zip.ReadCloser
}

func (z *zipEntry) Read(p []byte) (int, error) { return z.rc.Read(p) }
func (z *zipEntry) Close() error {
	z.rc.Close()
	return z.zr.Close()
}

type tarEntry struct {
	r  *tar.Reader
	gz *gzip.Reader
	f  *os.File
}

func (t *tarEntry) Read(p []byte) (int, error) { return t.r.Read(p) }
func (t *tarEntry) Close() error {
	t.gz.Close()
	return t.f.Close()
}
