package stage

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"neoprojector/services/displays"
)

func testService() *Service {
	s := New(func() []displays.OverlayActivation {
		return []displays.OverlayActivation{
			{Kind: "qr", Name: "QR"},
			{Kind: "sermon_timer", Name: "Old", ConfigJSON: `{"target_seconds":60}`, ActivatedAtMs: 100},
			{Kind: "sermon_timer", Name: "New", ConfigJSON: `{"target_seconds":1800}`,
				LayoutsJSON: `{"default":{"style":{"color":"#00ff00"}}}`, ActivatedAtMs: 200},
			{Kind: "sermon_timer", Name: "Broken", ConfigJSON: `not json`, ActivatedAtMs: 50},
		}
	})
	s.cfg = settings{Enabled: true, Token: "abc23456"}
	return s
}

func TestStageLinkToken(t *testing.T) {
	h := testService().handler()
	for path, want := range map[string]int{
		"/s/abc23456":       http.StatusOK,
		"/s/abc23456/state": http.StatusOK,
		"/s/wrongtok/state": http.StatusNotFound,
		"/s/":               http.StatusNotFound,
		"/":                 http.StatusNotFound,
		"/s/abc23456/x":     http.StatusNotFound,
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != want {
			t.Errorf("%s: %d, want %d", path, rec.Code, want)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/s/abc23456", nil))
	if !strings.Contains(rec.Body.String(), "Waiting for the sermon timer") {
		t.Error("page not served")
	}
}

func TestStageStateOnlyTimersNewestFirst(t *testing.T) {
	rec := httptest.NewRecorder()
	testService().handler().ServeHTTP(rec, httptest.NewRequest("GET", "/s/abc23456/state", nil))
	var st state
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if len(st.Overlays) != 3 {
		t.Fatalf("got %d overlays, want the 3 sermon timers", len(st.Overlays))
	}
	if st.Overlays[0].Name != "New" || st.Overlays[0].Color != "#00ff00" {
		t.Fatalf("newest first with its colour: %+v", st.Overlays[0])
	}
	if string(st.Overlays[2].Config) != "{}" {
		t.Fatalf("invalid config must become {}: %s", st.Overlays[2].Config)
	}
	if st.NowMs == 0 {
		t.Fatal("server clock missing")
	}
}

func TestNewToken(t *testing.T) {
	a, b := newToken(), newToken()
	if len(a) != 8 || a == b {
		t.Fatalf("tokens %q %q", a, b)
	}
	if strings.ContainsAny(a, "01ilo") {
		t.Fatalf("look-alike characters in %q", a)
	}
}

func TestLanIPsPutsRealNetworkFirst(t *testing.T) {
	ips := lanIPs()
	t.Logf("lanIPs=%v defaultRoute=%q", ips, defaultRouteIP())
	if d := defaultRouteIP(); d != "" && len(ips) > 0 && ips[0] != d {
		t.Fatalf("first address %s, want the default-route address %s", ips[0], d)
	}
	if !isVirtualAdapter("VMware Network Adapter VMnet8") || !isVirtualAdapter("vEthernet (WSL)") || isVirtualAdapter("Wi-Fi") {
		t.Fatal("isVirtualAdapter")
	}
}
