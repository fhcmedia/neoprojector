package transcode

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// Quality is a playback-copy preset.
type Quality string

const (
	Q1080 Quality = "1080p" // default: full HD, what projectors show
	Q720  Quality = "720p"  // lighter, for weak PCs that stutter on 1080p
	Q480  Quality = "480p"  // lightest, last resort
)

type preset struct {
	long, short int    // fit inside long x short (either orientation)
	crf         string // x264 quality
	maxrate     string // peak bitrate cap
	bufsize     string
	fpsmax      string
}

var presets = map[Quality]preset{
	Q1080: {1920, 1080, "20", "12M", "24M", "60"},
	Q720:  {1280, 720, "21", "6M", "12M", "60"},
	Q480:  {854, 480, "23", "3M", "6M", "30"},
}

// ParseQuality maps a UI value to a preset, defaulting to 1080p.
func ParseQuality(s string) Quality {
	if _, ok := presets[Quality(s)]; ok {
		return Quality(s)
	}
	return Q1080
}

// PlaybackArgs is the ffmpeg command line for a playback copy:
//   - video: H.264 (libx264, veryfast), scaled down to fit the preset's
//     size in either orientation (never up), frame rate capped, 8-bit
//     4:2:0;
//   - audio: first track (if any) as stereo AAC 192k;
//   - a keyframe every 2s, so seeks land fast on every screen;
//   - tolerant input handling (corrupt packets dropped, timestamps
//     regenerated) so a slightly damaged file still converts;
//   - +faststart so playback can begin before the whole file is read;
//   - machine-readable progress on stdout.
func PlaybackArgs(in, out string, threads int, q Quality) []string {
	p, ok := presets[q]
	if !ok {
		p = presets[Q1080]
	}
	// Fit inside long x short for landscape, short x long for portrait.
	scale := fmt.Sprintf(
		"scale='if(gte(iw,ih),min(%[1]d,iw),min(%[2]d,iw))':'if(gte(iw,ih),min(%[2]d,ih),min(%[1]d,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2",
		p.long, p.short)
	return []string{
		"-hide_banner", "-nostdin", "-y",
		"-fflags", "+discardcorrupt+genpts",
		// Before -i: caps the decoder (a 4K HEVC decode otherwise takes
		// every core and ~1 GB); after -i: caps the encoder.
		"-threads", strconv.Itoa(threads),
		"-i", in,
		"-map", "0:v:0", "-map", "0:a:0?",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", p.crf,
		// A keyframe at least every 2s: seeking decodes from the previous
		// keyframe, and x264's default (every 250 frames, ~8s) made live
		// seeks take a second or more. Costs a few % of size.
		"-force_key_frames", "expr:gte(t,n_forced*2)",
		"-maxrate", p.maxrate, "-bufsize", p.bufsize,
		"-vf", scale,
		"-fpsmax", p.fpsmax,
		"-pix_fmt", "yuv420p",
		"-threads", strconv.Itoa(threads),
		"-c:a", "aac", "-b:a", "192k", "-ac", "2",
		"-max_muxing_queue_size", "4096",
		"-movflags", "+faststart",
		"-progress", "pipe:1", "-nostats",
		out,
	}
}

// Threads keeps half the CPU for everything else (the operator UI, other
// apps) so a conversion never makes the machine sluggish.
func Threads() int {
	n := runtime.NumCPU() / 2
	if n < 1 {
		n = 1
	}
	return n
}

// Duration returns a media file's duration in seconds via ffprobe.
func Duration(ctx context.Context, t Tools, path string) (float64, error) {
	cmd := exec.CommandContext(ctx, t.FFprobe,
		"-v", "error", "-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1", path)
	HideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe: %w", err)
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil {
		return 0, fmt.Errorf("ffprobe duration %q: %w", strings.TrimSpace(string(out)), err)
	}
	return d, nil
}

// Encode writes a playback copy of in to out, reporting 0–100 progress.
// Cancelling ctx kills ffmpeg (the caller removes the partial output).
func Encode(ctx context.Context, t Tools, in, out string, durationSec float64, q Quality, progress func(pct int)) error {
	cmd := exec.CommandContext(ctx, t.FFmpeg, PlaybackArgs(in, out, Threads(), q)...)
	HideWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr tailBuffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	parseProgress(stdout, durationSec, progress)
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("ffmpeg: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

// parseProgress reads ffmpeg's -progress key=value stream. out_time_us
// (alias out_time_ms, which is also microseconds) is the encoded media
// time; against the duration it gives the percentage.
func parseProgress(r io.Reader, durationSec float64, progress func(int)) {
	sc := bufio.NewScanner(r)
	last := -1
	for sc.Scan() {
		key, val, ok := strings.Cut(sc.Text(), "=")
		if !ok || progress == nil || durationSec <= 0 {
			continue
		}
		if key != "out_time_us" && key != "out_time_ms" {
			continue
		}
		us, err := strconv.ParseInt(val, 10, 64)
		if err != nil || us < 0 {
			continue
		}
		pct := int(float64(us) / (durationSec * 1e6) * 100)
		if pct > 99 {
			pct = 99 // 100 is reported by the caller once the file is in place
		}
		if pct != last {
			last = pct
			progress(pct)
		}
	}
}

// tailBuffer keeps the last 4 KB written (ffmpeg's error is at the end).
type tailBuffer struct{ b bytes.Buffer }

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.b.Write(p)
	if t.b.Len() > 4096 {
		keep := t.b.Bytes()[t.b.Len()-4096:]
		nb := make([]byte, len(keep))
		copy(nb, keep)
		t.b.Reset()
		t.b.Write(nb)
	}
	return len(p), nil
}

func (t *tailBuffer) String() string { return t.b.String() }
