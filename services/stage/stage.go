// Package stage serves the "stage display": a web page any phone, tablet,
// laptop or smart TV on the church network can open to show the sermon
// timer to the preacher.
//
// Why: with an HDMI splitter every screen shows the same picture — the
// computer sees one monitor — so a timer meant for the preacher would be
// on the projector too, and no screen setting can separate them. The
// stage display moves the timer onto a separate device instead.
//
// The server is off until enabled in Settings (listening on the LAN can
// trigger a Windows Firewall prompt). It serves one read-only page and
// its state, behind a random link token, so only someone given the link
// (or the QR code) sees anything.
package stage

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"neoprojector/services/displays"

	"github.com/adrg/xdg"
	"github.com/charmbracelet/log"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed page.html
var pageHTML []byte

// Port is fixed so a bookmarked/QR link keeps working across restarts.
const Port = 7120

// Status is what Settings shows.
type Status struct {
	Enabled bool `json:"enabled"`
	// Running is false when enabled but the port couldn't be opened.
	Running bool     `json:"running"`
	URLs    []string `json:"urls"` // one per LAN address, best first
	Error   string   `json:"error,omitempty"`
}

type settings struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token"`
}

// Service runs the stage display server.
type Service struct {
	overlays func() []displays.OverlayActivation

	mu     sync.Mutex
	cfg    settings
	srv    *http.Server
	runErr string
}

// New takes how to read the overlays that are on right now (the live
// payload the operator window pushes).
func New(overlays func() []displays.OverlayActivation) *Service {
	return &Service{overlays: overlays}
}

func (*Service) ServiceName() string { return "stage" }

// ServiceStartup restores the last enabled state.
func (s *Service) ServiceStartup(context.Context, application.ServiceOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = loadSettings()
	if s.cfg.Token == "" {
		s.cfg.Token = newToken()
		_ = saveSettings(s.cfg)
	}
	if s.cfg.Enabled {
		s.startLocked()
	}
	return nil
}

// Status reports whether the stage display is on and its links.
func (s *Service) Status(context.Context) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked()
}

// SetEnabled turns the stage display server on or off.
func (s *Service) SetEnabled(_ context.Context, on bool) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg.Enabled = on
	if s.cfg.Token == "" {
		s.cfg.Token = newToken()
	}
	_ = saveSettings(s.cfg)
	if on {
		s.startLocked()
	} else {
		s.stopLocked()
	}
	return s.statusLocked()
}

// NewLink replaces the link token (old links and QR codes stop working).
func (s *Service) NewLink(context.Context) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg.Token = newToken()
	_ = saveSettings(s.cfg)
	return s.statusLocked()
}

func (s *Service) statusLocked() Status {
	st := Status{Enabled: s.cfg.Enabled, Running: s.srv != nil, Error: s.runErr}
	if s.srv != nil {
		for _, ip := range lanIPs() {
			st.URLs = append(st.URLs, fmt.Sprintf("http://%s:%d/s/%s", ip, Port, s.cfg.Token))
		}
		if len(st.URLs) == 0 {
			st.Error = "This computer isn't on a network. Connect it to the church Wi-Fi or network."
		}
	}
	return st
}

func (s *Service) startLocked() {
	if s.srv != nil {
		return
	}
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", Port))
	if err != nil {
		s.runErr = fmt.Sprintf("couldn't open port %d: %v", Port, err)
		log.Warn("stage display: listen failed", "err", err)
		return
	}
	s.runErr = ""
	srv := &http.Server{Handler: s.handler(), ReadHeaderTimeout: 5 * time.Second}
	s.srv = srv
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Warn("stage display: server stopped", "err", err)
		}
	}()
	log.Info("stage display: listening", "port", Port)
}

func (s *Service) stopLocked() {
	if s.srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.srv.Shutdown(ctx)
	s.srv = nil
}

// stateOverlay is one running timer as the page needs it.
type stateOverlay struct {
	Name          string          `json:"name"`
	Kind          string          `json:"kind"`
	Config        json.RawMessage `json:"config"`
	Color         string          `json:"color"`
	ActivatedAtMs int64           `json:"activated_at_ms"`
}

type state struct {
	NowMs    int64          `json:"now_ms"` // server clock, for skew
	Overlays []stateOverlay `json:"overlays"`
}

func (s *Service) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/s/", func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/s/")
		token, sub, _ := strings.Cut(rest, "/")
		s.mu.Lock()
		ok := token != "" && token == s.cfg.Token
		s.mu.Unlock()
		if !ok {
			http.Error(w, "This stage display link is no longer valid. Scan the new QR code in NeoProjector → Settings.", http.StatusNotFound)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		switch sub {
		case "":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(pageHTML)
		case "state":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(s.snapshot())
		default:
			http.NotFound(w, r)
		}
	})
	return mux
}

// snapshot lists the running sermon timers (all of them, whatever
// screens they're set to show on — "not shown anywhere" plus the stage
// display is exactly the HDMI-splitter setup), newest first.
func (s *Service) snapshot() state {
	st := state{NowMs: time.Now().UnixMilli(), Overlays: []stateOverlay{}}
	for _, o := range s.overlays() {
		if o.Kind != "sermon_timer" {
			continue
		}
		cfg := json.RawMessage(o.ConfigJSON)
		if !json.Valid(cfg) {
			cfg = json.RawMessage("{}")
		}
		st.Overlays = append(st.Overlays, stateOverlay{
			Name: o.Name, Kind: o.Kind, Config: cfg,
			Color:         layoutColor(o.LayoutsJSON),
			ActivatedAtMs: o.ActivatedAtMs,
		})
	}
	sort.Slice(st.Overlays, func(i, j int) bool {
		return st.Overlays[i].ActivatedAtMs > st.Overlays[j].ActivatedAtMs
	})
	return st
}

// layoutColor reads the timer's base text colour from its default layout.
func layoutColor(layoutsJSON string) string {
	var l struct {
		Default struct {
			Style map[string]any `json:"style"`
		} `json:"default"`
	}
	if json.Unmarshal([]byte(layoutsJSON), &l) == nil {
		if c, ok := l.Default.Style["color"].(string); ok {
			return c
		}
	}
	return ""
}

// lanIPs lists this PC's IPv4 addresses, the one a phone can most
// likely reach first:
//  1. the address Windows uses for its default route (where the network
//     is) — found by "connecting" a UDP socket, which sends nothing;
//  2. other private addresses on real adapters;
//  3. virtual adapters last (VMware, VirtualBox, Hyper-V, WSL, Docker…),
//     which a phone on the church Wi-Fi can't reach.
func lanIPs() []string {
	primary := defaultRouteIP()
	type cand struct {
		ip      string
		virtual bool
		private bool
	}
	var cands []cand
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		virtual := isVirtualAdapter(ifc.Name)
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipn.IP.To4()
			if ip == nil || ip.IsLinkLocalUnicast() {
				continue
			}
			cands = append(cands, cand{ip.String(), virtual, ip.IsPrivate()})
		}
	}
	rank := func(c cand) int {
		switch {
		case c.ip == primary:
			return 0
		case !c.virtual && c.private:
			return 1
		case !c.virtual:
			return 2
		default:
			return 3
		}
	}
	sort.SliceStable(cands, func(i, j int) bool { return rank(cands[i]) < rank(cands[j]) })
	out := make([]string, 0, len(cands))
	for _, c := range cands {
		out = append(out, c.ip)
	}
	return out
}

// defaultRouteIP is the local address of the default route ("" if none).
func defaultRouteIP() string {
	c, err := net.Dial("udp4", "192.0.2.1:9") // TEST-NET-1; nothing is sent
	if err != nil {
		return ""
	}
	defer c.Close()
	if a, ok := c.LocalAddr().(*net.UDPAddr); ok {
		return a.IP.String()
	}
	return ""
}

func isVirtualAdapter(name string) bool {
	n := strings.ToLower(name)
	for _, v := range []string{"vmware", "vmnet", "virtualbox", "vbox", "hyper-v", "vethernet", "wsl", "docker", "loopback", "bluetooth", "tailscale", "zerotier", "npcap"} {
		if strings.Contains(n, v) {
			return true
		}
	}
	return false
}

// newToken: 8 characters, no look-alikes (typable from a screen).
func newToken() string {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	b := make([]byte, 8)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		b[i] = alphabet[n.Int64()]
	}
	return string(b)
}

func settingsPath() (string, error) {
	return xdg.DataFile("neoprojector/stage.json")
}

func loadSettings() settings {
	var c settings
	p, err := settingsPath()
	if err != nil {
		return c
	}
	if b, err := os.ReadFile(p); err == nil {
		_ = json.Unmarshal(b, &c)
	}
	return c
}

func saveSettings(c settings) error {
	p, err := settingsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(p, b, 0o644)
}
