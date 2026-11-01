//go:build !windows

package presentations

import (
	"context"
	"errors"
)

// powerPointToPDF: PowerPoint automation is Windows-only.
func powerPointToPDF(context.Context, string, string) error {
	return errors.New("not available on this platform")
}
