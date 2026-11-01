package media

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
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
//   - it never runs while live: going live cancels the running job (the
//     partial file is discarded) and it resumes once output stops;
//   - ffmpeg runs at below-normal priority on half the cores;
//   - the swap is atomic: the copy is verified, renamed into place, and
//     the media row is re-pointed only if it still points at the file the
//     copy was made from; the heavy original is deleted afterwards.
// The original keeps working until the swap, so a video can be used
// while its copy is being made (if this PC can play it at all).

// OptimizeStatus is one video's conversion state, sent to the UI.
type OptimizeStatus struct {
	MediaID int64 `json:"media_id"`
	// queued | downloading | converting | waiting_live | done | failed
	State  string `json:"state"`
	Pct    int    `json:"pct"`
	Reason string `json:"reason"`
	Error  string `json:"error,omitempty"`
}

const optimizeEvent = "media:optimize"

type optimizer struct {
	svc    *Service
	isLive func() bool

	mu     sync.Mutex
	status map[int64]*OptimizeStatus
	failed map[int64]bool // not retried automatically
	wake   chan struct{}
	// files that couldn't be deleted yet (e.g. still open) — retried.
	pendingDeletes map[string]bool
}

func newOptimizer(svc *Service, isLive func() bool) *optimizer {
	if isLive == nil {
		isLive = func() bool { return false }
	}
	return &optimizer{
		svc:            svc,
		isLive:         isLive,
		status:         map[int64]*OptimizeStatus{},
		failed:         map[int64]bool{},
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
func (s *Service) RetryOptimize(_ context.Context, id int64) {
	s.opt.mu.Lock()
	delete(s.opt.failed, id)
	delete(s.opt.status, id)
	s.opt.mu.Unlock()
	s.opt.poke()
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
// queue newest-first until it's empty or a service goes live.
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
		o.mu.Unlock()
		if failed || (st != nil && st.State == "done") {
			continue
		}
		need, reason := needsPlaybackCopy(m.Path)
		if !need {
			continue
		}
		if st == nil {
			o.set(OptimizeStatus{MediaID: m.ID, State: "queued", Reason: reason})
		}
		todo = append(todo, m)
	}
	// Newest import first: that's the one the operator is waiting for.
	sort.Slice(todo, func(i, j int) bool { return todo[i].ID > todo[j].ID })
	for _, m := range todo {
		if ctx.Err() != nil {
			return
		}
		if o.isLive() {
			for _, w := range todo {
				o.update(w.ID, func(s *OptimizeStatus) { s.State, s.Pct = "waiting_live", 0 })
			}
			return
		}
		o.convert(ctx, m)
	}
}

// convert makes and swaps in one playback copy.
func (o *optimizer) convert(parent context.Context, m database.Medium) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	// Going live mid-conversion cancels it; it is retried after.
	var wentLive atomic.Bool
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if o.isLive() {
					wentLive.Store(true)
					cancel()
					return
				}
			}
		}
	}()

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
		o.interrupted(m.ID, wentLive.Load(), err)
		return
	}
	dur, err := transcode.Duration(ctx, tools, m.Path)
	if err != nil {
		o.interrupted(m.ID, wentLive.Load(), err)
		return
	}

	dir := filepath.Dir(m.Path)
	id := uuid.NewString()
	tmp := filepath.Join(dir, "tmp-"+id+".mp4")
	final := filepath.Join(dir, id+".mp4")
	o.update(m.ID, func(s *OptimizeStatus) { s.State, s.Pct = "converting", 0 })
	err = transcode.Encode(ctx, tools, m.Path, tmp, dur, func(pct int) {
		o.update(m.ID, func(s *OptimizeStatus) { s.State, s.Pct = "converting", pct })
	})
	if err != nil {
		os.Remove(tmp)
		o.interrupted(m.ID, wentLive.Load(), err)
		return
	}
	// The copy must itself be inside the envelope, or something is off.
	if need, reason := needsPlaybackCopy(tmp); need {
		os.Remove(tmp)
		o.fail(m.ID, errors.New("converted file still not playable: "+reason))
		return
	}
	if err := os.Rename(tmp, final); err != nil {
		os.Remove(tmp)
		o.fail(m.ID, err)
		return
	}
	n, err := o.svc.q.SwapMediaPath(parent, database.SwapMediaPathParams{
		Path: final, ID: m.ID, Path_2: m.Path,
	})
	if err != nil || n == 0 {
		// Deleted or changed meanwhile: drop the copy, keep whatever's there.
		os.Remove(final)
		if err != nil {
			o.fail(m.ID, err)
		} else {
			o.clear(m.ID)
		}
		return
	}
	o.deleteFile(m.Path)
	o.update(m.ID, func(s *OptimizeStatus) { s.State, s.Pct, s.Error = "done", 100, "" })
	log.Info("media: playback copy ready", "id", m.ID, "file", filepath.Base(final))
}

// interrupted handles a stopped job: a go-live is a pause, anything else
// a failure.
func (o *optimizer) interrupted(id int64, wentLive bool, err error) {
	if wentLive || errors.Is(err, context.Canceled) {
		o.update(id, func(s *OptimizeStatus) { s.State, s.Pct = "waiting_live", 0 })
		return
	}
	o.fail(id, err)
}

func (o *optimizer) fail(id int64, err error) {
	log.Warn("media: playback copy failed", "id", id, "err", err)
	o.mu.Lock()
	o.failed[id] = true
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

// sweepPartials deletes tmp-* conversion outputs left by a crash or a
// closed app (they're never referenced by a media row).
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
		if !e.IsDir() && strings.HasPrefix(e.Name(), "tmp-") {
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
