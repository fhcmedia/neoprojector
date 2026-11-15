package media

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"neoprojector/database"
	"neoprojector/services/transcode"

	"github.com/adrg/xdg"
	"github.com/charmbracelet/log"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Background playback-copy optimizer.
//
// Videos outside the playback envelope (see policy.go) are converted,
// one at a time, into a playback copy that replaces the original. The
// rules that keep this from ever hurting a service:
//   - ffmpeg runs on half the cores at below-normal priority, dropping to
//     idle priority while a service is live (it then only gets CPU time
//     nothing else wants), so conversions carry on during a service;
//   - a copy is never swapped in while its video is on screen (in the
//     live payload, or a template's background): the swap would reload
//     the video mid-play. The finished copy waits as ready-<uuid>.mp4
//     and swaps in within seconds of the video leaving the screen;
//   - the swap is atomic: the copy is verified, renamed into place, and
//     the media row is re-pointed only if it still points at the file the
//     copy was made from; the heavy original is deleted afterwards.
// The original keeps working until the swap, so a video can be used
// while its copy is being made (if this PC can play it at all).

// OptimizeStatus is one video's conversion state, sent to the UI.
type OptimizeStatus struct {
	MediaID int64 `json:"media_id"`
	// queued | downloading | converting | ready (copy made, waiting for
	// the video to leave the screen) | done | failed
	State  string `json:"state"`
	Pct    int    `json:"pct"`
	Reason string `json:"reason"`
	Error  string `json:"error,omitempty"`
	// Quality the copy is being made at ("1080p" | "720p" | "480p").
	Quality string `json:"quality"`
}

const optimizeEvent = "media:optimize"

type optimizer struct {
	svc    *Service
	isLive func() bool
	// onScreen reports whether the live payload shows this media.
	onScreen func(id int64) bool

	mu     sync.Mutex
	status map[int64]*OptimizeStatus
	failed map[int64]bool // not retried automatically
	// User-requested conversions (a retry, or a lighter copy of a video
	// that stutters), with their quality. Run even when the file is
	// already inside the playback envelope.
	forced map[int64]transcode.Quality
	wake   chan struct{}
	// files that couldn't be deleted yet (e.g. still open) — retried.
	pendingDeletes map[string]bool
	// finished copies waiting for their video to leave the screen.
	ready map[int64]readyCopy
}

// readyCopy is a verified playback copy not yet swapped in.
type readyCopy struct {
	path string // ready-<uuid>.mp4 next to the original
	from string // the original it was made from
}

func newOptimizer(svc *Service, isLive func() bool, onScreen func(id int64) bool) *optimizer {
	if isLive == nil {
		isLive = func() bool { return false }
	}
	if onScreen == nil {
		onScreen = func(int64) bool { return false }
	}
	return &optimizer{
		svc:            svc,
		isLive:         isLive,
		onScreen:       onScreen,
		ready:          map[int64]readyCopy{},
		status:         map[int64]*OptimizeStatus{},
		failed:         map[int64]bool{},
		forced:         map[int64]transcode.Quality{},
		wake:           make(chan struct{}, 1),
		pendingDeletes: map[string]bool{},
	}
}

// ServiceStartup starts the optimizer for the app's lifetime.
func (s *Service) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	go s.opt.run(ctx)
	return nil
}

// OptimizeStatus lists every video with a conversion state, for the UI's
// initial render; updates then arrive as "media:optimize" events.
func (s *Service) OptimizeStatus(_ context.Context) []OptimizeStatus {
	s.opt.mu.Lock()
	defer s.opt.mu.Unlock()
	out := make([]OptimizeStatus, 0, len(s.opt.status))
	for _, st := range s.opt.status {
		out = append(out, *st)
	}
	return out
}

// RetryOptimize clears a failed conversion so it is attempted again.
func (s *Service) RetryOptimize(ctx context.Context, id int64) {
	s.Reoptimize(ctx, id, string(transcode.Q1080))
}

// Reoptimize (re)makes a video's playback copy at quality ("1080p",
// "720p" or "480p"): after a failed conversion, or to get a lighter
// copy for a PC that stutters. Never upscales — asking for more than
// the file has keeps its size.
func (s *Service) Reoptimize(ctx context.Context, id int64, quality string) error {
	row, err := s.q.MediaByID(ctx, id)
	if err != nil {
		return err
	}
	if row.Type != "video" {
		return errors.New("only videos can be optimized")
	}
	q := transcode.ParseQuality(quality)
	s.opt.mu.Lock()
	delete(s.opt.failed, id)
	s.opt.forced[id] = q
	// A copy still waiting to swap in is superseded by this request.
	if rc, ok := s.opt.ready[id]; ok {
		delete(s.opt.ready, id)
		os.Remove(rc.path)
	}
	s.opt.mu.Unlock()
	s.opt.set(OptimizeStatus{MediaID: id, State: "queued", Reason: "requested " + string(q) + " copy", Quality: string(q)})
	s.opt.poke()
	return nil
}

func (o *optimizer) poke() {
	select {
	case o.wake <- struct{}{}:
	default:
	}
}

func (o *optimizer) run(ctx context.Context) {
	o.sweepPartials()
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	// Ready copies swap in soon after their video leaves the screen,
	// even while another conversion is running.
	go func() {
		t := time.NewTicker(3 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				o.swapReady(ctx)
			}
		}
	}()
	for {
		o.cycle(ctx)
		select {
		case <-ctx.Done():
			return
		case <-o.wake:
		case <-tick.C:
		}
	}
}

// cycle queues every video that needs a copy, then works through the
// queue newest-first.
func (o *optimizer) cycle(ctx context.Context) {
	o.retryDeletes()
	rows, err := o.svc.q.ListMedia(ctx)
	if err != nil {
		return
	}
	var todo []database.Medium
	for _, m := range rows {
		if m.Type != "video" || m.Path == "" {
			continue
		}
		o.mu.Lock()
		failed := o.failed[m.ID]
		st := o.status[m.ID]
		_, forced := o.forced[m.ID]
		_, waiting := o.ready[m.ID]
		o.mu.Unlock()
		if waiting {
			continue
		}
		if forced {
			todo = append(todo, m)
			continue
		}
		if failed || (st != nil && st.State == "done") {
			continue
		}
		need, reason := needsPlaybackCopy(m.Path)
		if !need {
			continue
		}
		if st == nil {
			o.set(OptimizeStatus{MediaID: m.ID, State: "queued", Reason: reason, Quality: string(transcode.Q1080)})
		}
		todo = append(todo, m)
	}
	// Newest import first: that's the one the operator is waiting for.
	sort.Slice(todo, func(i, j int) bool { return todo[i].ID > todo[j].ID })
	for _, m := range todo {
		if ctx.Err() != nil {
			return
		}
		o.convert(ctx, m)
	}
}

// convert makes and swaps in one playback copy.
func (o *optimizer) convert(parent context.Context, m database.Medium) {
	o.mu.Lock()
	quality, forced := o.forced[m.ID]
	o.mu.Unlock()
	if !forced {
		quality = transcode.Q1080
	}
	ctx := parent

	toolsDir, err := dataSubdir("tools")
	if err != nil {
		o.fail(m.ID, err)
		return
	}
	o.update(m.ID, func(s *OptimizeStatus) { s.State, s.Pct, s.Error = "downloading", 0, "" })
	tools, err := transcode.Ensure(ctx, toolsDir, func(pct int) {
		o.update(m.ID, func(s *OptimizeStatus) { s.State, s.Pct = "downloading", pct })
	})
	if err != nil {
		o.interrupted(m.ID, err)
		return
	}
	dur, err := transcode.Duration(ctx, tools, m.Path)
	if err != nil {
		o.interrupted(m.ID, err)
		return
	}

	dir := filepath.Dir(m.Path)
	id := uuid.NewString()
	tmp := filepath.Join(dir, "tmp-"+id+".mp4")
	o.update(m.ID, func(s *OptimizeStatus) { s.State, s.Pct, s.Quality = "converting", 0, string(quality) })
	err = transcode.Encode(ctx, tools, m.Path, tmp, dur, quality, func(pct int) {
		o.update(m.ID, func(s *OptimizeStatus) { s.State, s.Pct = "converting", pct })
	}, o.isLive)
	if err != nil {
		os.Remove(tmp)
		o.interrupted(m.ID, err)
		return
	}
	// The copy must itself be inside the envelope, or something is off.
	if need, reason := needsPlaybackCopy(tmp); need {
		os.Remove(tmp)
		o.fail(m.ID, errors.New("converted file still not playable: "+reason))
		return
	}
	if o.inUse(ctx, m.ID) {
		// On screen right now: park it; swapReady swaps it in later.
		ready := filepath.Join(dir, "ready-"+id+".mp4")
		if err := os.Rename(tmp, ready); err != nil {
			os.Remove(tmp)
			o.fail(m.ID, err)
			return
		}
		o.mu.Lock()
		o.ready[m.ID] = readyCopy{path: ready, from: m.Path}
		o.mu.Unlock()
		o.update(m.ID, func(s *OptimizeStatus) { s.State, s.Pct, s.Error = "ready", 100, "" })
		log.Info("media: playback copy waiting for the video to leave the screen", "id", m.ID)
		return
	}
	o.swapIn(ctx, m.ID, tmp, m.Path)
}

// swapIn renames a verified copy into place and re-points the media row
// at it, then deletes the original.
func (o *optimizer) swapIn(ctx context.Context, mediaID int64, copyPath, from string) {
	final := filepath.Join(filepath.Dir(copyPath), uuid.NewString()+".mp4")
	if err := os.Rename(copyPath, final); err != nil {
		os.Remove(copyPath)
		o.fail(mediaID, err)
		return
	}
	n, err := o.svc.q.SwapMediaPath(ctx, database.SwapMediaPathParams{
		Path: final, ID: mediaID, Path_2: from,
	})
	if err != nil || n == 0 {
		// Deleted or changed meanwhile: drop the copy, keep whatever's there.
		os.Remove(final)
		if err != nil {
			o.fail(mediaID, err)
		} else {
			o.clear(mediaID)
		}
		return
	}
	o.deleteFile(from)
	o.mu.Lock()
	delete(o.forced, mediaID)
	o.mu.Unlock()
	o.update(mediaID, func(s *OptimizeStatus) { s.State, s.Pct, s.Error = "done", 100, "" })
	log.Info("media: playback copy ready", "id", mediaID, "file", filepath.Base(final))
}

// swapReady swaps in every parked copy whose video has left the screen.
func (o *optimizer) swapReady(ctx context.Context) {
	o.mu.Lock()
	ids := make([]int64, 0, len(o.ready))
	for id := range o.ready {
		ids = append(ids, id)
	}
	o.mu.Unlock()
	for _, id := range ids {
		if ctx.Err() != nil || o.inUse(ctx, id) {
			continue
		}
		o.mu.Lock()
		rc, ok := o.ready[id]
		delete(o.ready, id)
		o.mu.Unlock()
		if ok {
			o.swapIn(ctx, id, rc.path, rc.from)
		}
	}
}

// inUse reports whether swapping this video now would reload it on a
// screen: a service is live and it's in the live payload or is the
// background of a template.
func (o *optimizer) inUse(ctx context.Context, id int64) bool {
	if !o.isLive() {
		return false
	}
	if o.onScreen(id) {
		return true
	}
	tpls, err := o.svc.q.ListTemplates(ctx)
	if err != nil {
		return true // can't tell: wait
	}
	for _, t := range tpls {
		if ReferencesMedia(t.DataJson, id) {
			return true
		}
	}
	return false
}

// ReferencesMedia reports whether a JSON document (a live payload, a
// template; also JSON nested inside its strings) names this media id
// under any of the keys media is referenced by.
func ReferencesMedia(doc string, id int64) bool {
	re := regexp.MustCompile(fmt.Sprintf(`\\?"(?:mediaId|media_id|next_media_id)\\?"\s*:\s*%d(?:[^0-9]|$)`, id))
	return re.MatchString(doc)
}

// interrupted handles a stopped job: the app closing (the copy is made
// again next launch) or a failure.
func (o *optimizer) interrupted(id int64, err error) {
	if errors.Is(err, context.Canceled) {
		o.update(id, func(s *OptimizeStatus) { s.State, s.Pct = "queued", 0 })
		return
	}
	o.fail(id, err)
}

func (o *optimizer) fail(id int64, err error) {
	log.Warn("media: playback copy failed", "id", id, "err", err)
	o.mu.Lock()
	o.failed[id] = true
	delete(o.forced, id) // a retry is the user's call (Reoptimize)
	o.mu.Unlock()
	msg := err.Error()
	if len(msg) > 300 {
		msg = msg[len(msg)-300:]
	}
	o.update(id, func(s *OptimizeStatus) { s.State, s.Error = "failed", msg })
}

func (o *optimizer) set(st OptimizeStatus) {
	o.mu.Lock()
	cp := st
	o.status[st.MediaID] = &cp
	o.mu.Unlock()
	emitOptimize(cp)
}

func (o *optimizer) update(id int64, fn func(*OptimizeStatus)) {
	o.mu.Lock()
	st := o.status[id]
	if st == nil {
		st = &OptimizeStatus{MediaID: id}
		o.status[id] = st
	}
	fn(st)
	cp := *st
	o.mu.Unlock()
	emitOptimize(cp)
}

func (o *optimizer) clear(id int64) {
	o.mu.Lock()
	delete(o.status, id)
	delete(o.forced, id)
	o.mu.Unlock()
	emitOptimize(OptimizeStatus{MediaID: id, State: "cleared"})
}

// deleteFile removes a replaced original; if it's still open (Windows
// refuses), it's retried on later cycles.
func (o *optimizer) deleteFile(p string) {
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		o.mu.Lock()
		o.pendingDeletes[p] = true
		o.mu.Unlock()
	}
}

func (o *optimizer) retryDeletes() {
	o.mu.Lock()
	paths := make([]string, 0, len(o.pendingDeletes))
	for p := range o.pendingDeletes {
		paths = append(paths, p)
	}
	o.mu.Unlock()
	for _, p := range paths {
		if err := os.Remove(p); err == nil || errors.Is(err, os.ErrNotExist) {
			o.mu.Lock()
			delete(o.pendingDeletes, p)
			o.mu.Unlock()
		}
	}
}

// sweepPartials deletes tmp-*/ready-* conversion outputs left by a crash
// or a closed app (they're never referenced by a media row).
func (o *optimizer) sweepPartials() {
	dir, err := dataSubdir("media")
	if err != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		// ready-* copies never got swapped in before the app closed;
		// they're remade (cheaper than proving they still match).
		if !e.IsDir() && (strings.HasPrefix(e.Name(), "tmp-") || strings.HasPrefix(e.Name(), "ready-")) {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

func dataSubdir(name string) (string, error) {
	p, err := xdg.DataFile("neoprojector/" + name + "/.touch")
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(p)
	return dir, os.MkdirAll(dir, 0o755)
}

func emitOptimize(st OptimizeStatus) {
	if app := application.Get(); app != nil {
		app.Event.Emit(optimizeEvent, st)
	}
}
