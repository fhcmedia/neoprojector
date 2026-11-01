package media

import (
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Video codec probing.
//
// The audience/preview players are WebView2 (Chromium), which decodes
// H.264, VP9 and AV1 everywhere but HEVC only on machines with a
// hardware decoder plus Microsoft's HEVC extension, and never decodes
// ProRes or MPEG-4 Part 2. Such a file imports fine and then shows a
// black picture (ProRes plays its audio track with no frames) — so the
// UI needs to say WHY. probeVideoCodec reads the codec straight from an
// MP4/MOV file's sample description (moov/trak/mdia/minf/stbl/stsd)
// without decoding anything; it walks box headers and seeks past
// payloads, so it is cheap even on multi-gigabyte files whose moov sits
// at the end.

// VideoInfo describes a media file's video codec for the UI.
type VideoInfo struct {
	// Codec is the sample-entry fourcc ("avc1", "hvc1", "apcn", …), or
	// the container name for files we don't parse ("mkv", "avi", …).
	Codec string `json:"codec"`
	// Name is a human label ("H.264", "HEVC (H.265)", "Apple ProRes").
	Name string `json:"name"`
	// Support is the expected playback support in the app:
	//   "yes"    — plays everywhere
	//   "maybe"  — depends on this machine (HEVC)
	//   "no"     — cannot play in the app; convert it
	//   "unknown"— couldn't tell
	Support string `json:"support"`
	// Width/Height of the video track (0 when not parsed), so the UI can
	// offer only quality presets that don't exceed the file.
	Width  int `json:"width"`
	Height int `json:"height"`
}

// codecs maps sample-entry fourccs to a label and support level.
var codecs = map[string][2]string{
	"avc1": {"H.264", "yes"},
	"avc3": {"H.264", "yes"},
	"hvc1": {"HEVC (H.265)", "maybe"},
	"hev1": {"HEVC (H.265)", "maybe"},
	"dvh1": {"Dolby Vision (HEVC)", "maybe"},
	"dvhe": {"Dolby Vision (HEVC)", "maybe"},
	"vp09": {"VP9", "yes"},
	"av01": {"AV1", "yes"},
	"apco": {"Apple ProRes 422 Proxy", "no"},
	"apcs": {"Apple ProRes 422 LT", "no"},
	"apcn": {"Apple ProRes 422", "no"},
	"apch": {"Apple ProRes 422 HQ", "no"},
	"ap4h": {"Apple ProRes 4444", "no"},
	"ap4x": {"Apple ProRes 4444 XQ", "no"},
	"mp4v": {"MPEG-4 Part 2", "no"},
	"jpeg": {"Motion JPEG", "no"},
	"mjpa": {"Motion JPEG", "no"},
}

// containers the WebView handles that we don't parse for codecs.
var otherContainers = map[string]VideoInfo{
	".webm": {Codec: "webm", Name: "WebM", Support: "yes"},
	".mkv":  {Codec: "mkv", Name: "Matroska (MKV)", Support: "unknown"},
	".avi":  {Codec: "avi", Name: "AVI", Support: "no"},
}

// ProbeVideo reports the video codec of the file at path.
func ProbeVideo(path string) VideoInfo {
	ext := strings.ToLower(filepath.Ext(path))
	if info, ok := otherContainers[ext]; ok {
		return info
	}
	m, err := probeMP4(path)
	fourcc := m.Fourcc
	if err != nil || fourcc == "" {
		return VideoInfo{Codec: "", Name: "Unknown format", Support: "unknown"}
	}
	info := VideoInfo{Codec: fourcc, Name: strings.ToUpper(fourcc), Support: "unknown", Width: m.Width, Height: m.Height}
	if c, ok := codecs[fourcc]; ok {
		info.Name, info.Support = c[0], c[1]
	}
	return info
}

// mp4Info is what probeMP4 reads from an MP4/MOV file's boxes.
type mp4Info struct {
	Fourcc      string  // video sample-entry format ("avc1", "hvc1", …)
	Width       int     // coded width of the video track
	Height      int     // coded height
	DurationSec float64 // movie duration (mvhd)
	H264Profile int     // avcC AVCProfileIndication (0 when not H.264)
	SizeBytes   int64   // file size, for an average-bitrate estimate
}

// BitRate is the file's average bitrate in bits/s (all tracks), or 0
// when the duration is unknown.
func (m mp4Info) BitRate() float64 {
	if m.DurationSec <= 0 {
		return 0
	}
	return float64(m.SizeBytes) * 8 / m.DurationSec
}

// probeVideoCodec returns the sample-entry fourcc of the first video
// track ('vide' handler) in an MP4/MOV file.
func probeVideoCodec(path string) (string, error) {
	m, err := probeMP4(path)
	return m.Fourcc, err
}

// probeMP4 reads the first video track's sample description (format,
// coded size, avcC profile) and the movie duration. It only walks box
// headers and reads a few hundred bytes, so it is instant on any size.
func probeMP4(path string) (mp4Info, error) {
	var out mp4Info
	f, err := os.Open(path)
	if err != nil {
		return out, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return out, err
	}
	out.SizeBytes = st.Size()
	moov, ok, err := findBox(f, 0, st.Size(), "moov")
	if err != nil || !ok {
		return out, errOrMissing(err, "moov")
	}
	if mvhd, ok, _ := findBox(f, moov.payload, moov.end, "mvhd"); ok {
		out.DurationSec = mvhdDuration(f, mvhd)
	}
	// Each trak: check its handler is video, then read its stsd entry.
	off := moov.payload
	for off < moov.end {
		trak, ok, err := findBox(f, off, moov.end, "trak")
		if err != nil || !ok {
			break
		}
		off = trak.end
		mdia, ok, err := findBox(f, trak.payload, trak.end, "mdia")
		if err != nil || !ok {
			continue
		}
		if h, _ := handlerType(f, mdia); h != "vide" {
			continue
		}
		box := mdia
		for _, name := range []string{"minf", "stbl", "stsd"} {
			next, ok, err := findBox(f, box.payload, box.end, name)
			if err != nil || !ok {
				box = boxRef{}
				break
			}
			box = next
		}
		if box.end == 0 {
			continue
		}
		// stsd: version/flags(4) + entry_count(4), then the first sample
		// entry. A VisualSampleEntry is: size(4) format(4) reserved(6)
		// data_reference_index(2) pre_defined(2) reserved(2)
		// pre_defined(12) width(2) height(2) … 78 bytes of fixed fields
		// after the 8-byte header, then child boxes (avcC, hvcC, …).
		entry := box.payload + 8
		var hdr [36]byte
		if _, err := f.ReadAt(hdr[:], entry); err != nil {
			return out, err
		}
		entrySize := int64(binary.BigEndian.Uint32(hdr[0:4]))
		out.Fourcc = string(hdr[4:8])
		out.Width = int(binary.BigEndian.Uint16(hdr[32:34]))
		out.Height = int(binary.BigEndian.Uint16(hdr[34:36]))
		if out.Fourcc == "avc1" || out.Fourcc == "avc3" {
			childStart := entry + 8 + 78
			if avcC, ok, _ := findBox(f, childStart, entry+entrySize, "avcC"); ok {
				var b [2]byte
				if _, err := f.ReadAt(b[:], avcC.payload); err == nil {
					out.H264Profile = int(b[1]) // configurationVersion, AVCProfileIndication
				}
			}
		}
		return out, nil
	}
	return out, errors.New("no video track")
}

// mvhdDuration reads duration/timescale from an mvhd box (v0 or v1).
func mvhdDuration(r io.ReaderAt, mvhd boxRef) float64 {
	var b [32]byte
	if _, err := r.ReadAt(b[:], mvhd.payload); err != nil {
		return 0
	}
	if b[0] == 1 { // version 1: 64-bit times
		ts := binary.BigEndian.Uint32(b[20:24])
		d := binary.BigEndian.Uint64(b[24:32])
		if ts == 0 {
			return 0
		}
		return float64(d) / float64(ts)
	}
	ts := binary.BigEndian.Uint32(b[12:16])
	d := binary.BigEndian.Uint32(b[16:20])
	if ts == 0 {
		return 0
	}
	return float64(d) / float64(ts)
}

type boxRef struct {
	payload int64 // offset of the box payload (after the header)
	end     int64 // offset just past the box
}

// findBox scans sibling boxes in [start, end) for the first box of the
// given type.
func findBox(r io.ReaderAt, start, end int64, want string) (boxRef, bool, error) {
	var hdr [16]byte
	off := start
	for off+8 <= end {
		if _, err := r.ReadAt(hdr[:8], off); err != nil {
			return boxRef{}, false, err
		}
		size := int64(binary.BigEndian.Uint32(hdr[:4]))
		typ := string(hdr[4:8])
		hdrLen := int64(8)
		switch size {
		case 1: // 64-bit largesize follows
			if _, err := r.ReadAt(hdr[8:16], off+8); err != nil {
				return boxRef{}, false, err
			}
			size = int64(binary.BigEndian.Uint64(hdr[8:16]))
			hdrLen = 16
		case 0: // box extends to the end of its parent
			size = end - off
		}
		if size < hdrLen || off+size > end {
			return boxRef{}, false, errors.New("malformed box " + typ)
		}
		if typ == want {
			return boxRef{payload: off + hdrLen, end: off + size}, true, nil
		}
		off += size
	}
	return boxRef{}, false, nil
}

// handlerType reads the handler type ("vide", "soun", …) of an mdia box.
func handlerType(r io.ReaderAt, mdia boxRef) (string, error) {
	hdlr, ok, err := findBox(r, mdia.payload, mdia.end, "hdlr")
	if err != nil || !ok {
		return "", errOrMissing(err, "hdlr")
	}
	// version/flags(4) + pre_defined(4) + handler_type(4)
	var buf [12]byte
	if _, err := r.ReadAt(buf[:], hdlr.payload); err != nil {
		return "", err
	}
	return string(buf[8:12]), nil
}

func errOrMissing(err error, box string) error {
	if err != nil {
		return err
	}
	return errors.New("no " + box + " box")
}
