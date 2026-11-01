package media

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Playback-copy policy.
//
// Every screen showing a live video (each output window, the operator's
// preview tile, the Show pane) decodes it separately, on hardware that
// may be modest. A 4K 35 Mbps HEVC file (what our announcement exports
// are) decodes fine on a gaming PC and stutters — or shows black, with
// no HEVC decoder — on a church PC. So videos outside a conservative
// envelope get converted once, on import, into a "playback copy": H.264,
// at most 1080p and 60fps, 8-bit 4:2:0, sane bitrate. Files already in
// the envelope are never touched.

const (
	maxLongSide  = 1920
	maxShortSide = 1080
	maxBitRate   = 20_000_000 // bits/s, all tracks
)

// H.264 profiles most hardware decoders can't do (10-bit / 4:2:2 /
// 4:4:4) — Chromium then falls back to slow software decoding.
var heavyH264Profiles = map[int]string{
	110: "10-bit H.264",
	122: "4:2:2 H.264",
	244: "4:4:4 H.264",
	44:  "4:4:4 H.264",
}

// needsPlaybackCopy decides from the file alone (no ffmpeg needed)
// whether a video should get a playback copy, and why. Unparseable
// MP4/MOV files are converted too: ffmpeg reads far more than we do,
// and a failed conversion is reported rather than retried forever.
func needsPlaybackCopy(path string) (bool, string) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".webm":
		return false, ""
	case ".mp4", ".mov", ".m4v":
	default:
		return true, fmt.Sprintf("%s files don't play reliably", strings.TrimPrefix(ext, "."))
	}
	m, err := probeMP4(path)
	if err != nil {
		return true, "unreadable video format"
	}
	return judge(m)
}

// judge applies the envelope to parsed file facts.
func judge(m mp4Info) (bool, string) {
	switch m.Fourcc {
	case "avc1", "avc3", "vp09", "av01":
	default:
		name := m.Fourcc
		if c, ok := codecs[m.Fourcc]; ok {
			name = c[0]
		}
		return true, name + " isn't supported on every PC"
	}
	long, short := m.Width, m.Height
	if short > long {
		long, short = short, long
	}
	if long > maxLongSide || short > maxShortSide {
		return true, fmt.Sprintf("%dx%d is larger than 1080p", m.Width, m.Height)
	}
	if br := m.BitRate(); br > maxBitRate {
		return true, fmt.Sprintf("%.0f Mbps is a very high bitrate", br/1e6)
	}
	if name, heavy := heavyH264Profiles[m.H264Profile]; heavy {
		return true, name + " is too heavy for most graphics chips"
	}
	return false, ""
}
