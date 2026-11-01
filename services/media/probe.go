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
	fourcc, err := probeVideoCodec(path)
	if err != nil || fourcc == "" {
		return VideoInfo{Codec: "", Name: "Unknown format", Support: "unknown"}
	}
	if c, ok := codecs[fourcc]; ok {
		return VideoInfo{Codec: fourcc, Name: c[0], Support: c[1]}
	}
	return VideoInfo{Codec: fourcc, Name: strings.ToUpper(fourcc), Support: "unknown"}
}

// probeVideoCodec returns the sample-entry fourcc of the first video
// track ('vide' handler) in an MP4/MOV file.
func probeVideoCodec(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return "", err
	}
	moov, ok, err := findBox(f, 0, st.Size(), "moov")
	if err != nil || !ok {
		return "", errOrMissing(err, "moov")
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
		// entry: size(4) + format(4).
		var buf [16]byte
		if _, err := f.ReadAt(buf[:], box.payload); err != nil {
			return "", err
		}
		return string(buf[12:16]), nil
	}
	return "", errors.New("no video track")
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
