package updates

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

const releaseByTagAPI = "https://api.github.com/repos/fhcmedia/neoprojector/releases/tags/"

// Notes returns the "What's new" bullet list of the release for version
// (e.g. "0.1.25"), as CI writes it at the top of the release body.
// Missing releases and empty lists return nil without error.
func Notes(ctx context.Context, version string) ([]string, error) {
	tag := "v" + strings.TrimPrefix(version, "v")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseByTagAPI+tag, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("release notes: %s", resp.Status)
	}
	var rel struct {
		Body string `json:"body"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, err
	}
	return parseNotes(rel.Body), nil
}

// parseNotes extracts the "- item" lines under a "What's new" heading,
// up to the next heading or horizontal rule.
func parseNotes(body string) []string {
	var out []string
	in := false
	for _, line := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "#") {
			if in {
				break
			}
			in = strings.Contains(strings.ToLower(t), "what's new") ||
				strings.Contains(strings.ToLower(t), "what’s new")
			continue
		}
		if !in {
			continue
		}
		if t == "---" {
			break
		}
		if item, ok := strings.CutPrefix(t, "- "); ok && strings.TrimSpace(item) != "" {
			out = append(out, strings.TrimSpace(item))
		}
	}
	return out
}
