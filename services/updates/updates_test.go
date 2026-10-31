package updates

import "testing"

func rel(tag string, assets ...ghAsset) *ghRelease {
	return &ghRelease{TagName: tag, Assets: assets}
}

func asset(name, digest string) ghAsset {
	return ghAsset{Name: name, Digest: digest, Size: 42, URL: "https://example.invalid/" + name}
}

func TestEvaluate(t *testing.T) {
	mac := "-mac.zip"
	tests := []struct {
		name    string
		rel     *ghRelease
		cur     string
		want    string // expected Info.Version, "" = nil Info
		wantErr bool
	}{
		{
			name: "newer stable offered",
			rel:  rel("v0.2.0", asset("neoprojector-0.2.0-mac.zip", "sha256:abc")),
			cur:  "v0.1.0",
			want: "0.2.0",
		},
		{
			name: "equal version is not an update",
			rel:  rel("v0.1.0", asset("neoprojector-0.1.0-mac.zip", "sha256:abc")),
			cur:  "v0.1.0",
		},
		{
			name: "older release is not an update",
			rel:  rel("v0.1.0", asset("neoprojector-0.1.0-mac.zip", "sha256:abc")),
			cur:  "v0.2.0",
		},
		{
			name: "beta install upgrades to its stable",
			rel:  rel("v0.1.0", asset("neoprojector-0.1.0-mac.zip", "sha256:abc")),
			cur:  "v0.1.0-beta.12",
			want: "0.1.0",
		},
		{
			name: "garbage tag ignored",
			rel:  rel("nightly", asset("neoprojector-mac.zip", "sha256:abc")),
			cur:  "v0.1.0",
		},
		{
			name: "stable-named duplicate also matches the suffix",
			rel:  rel("v0.2.0", asset("neoprojector-mac.zip", "sha256:abc")),
			cur:  "v0.1.0",
			want: "0.2.0",
		},
		{
			name: "wrong platform assets only",
			rel: rel("v0.2.0",
				asset("neoprojector-0.2.0-windows.zip", "sha256:abc"),
				asset("neoprojector-0.2.0-linux.tar.gz", "sha256:abc"),
			),
			cur:     "v0.1.0",
			wantErr: true,
		},
		{
			name:    "missing digest is an error, not an unverified update",
			rel:     rel("v0.2.0", asset("neoprojector-0.2.0-mac.zip", "")),
			cur:     "v0.1.0",
			wantErr: true,
		},
		{
			name:    "non-sha256 digest rejected",
			rel:     rel("v0.2.0", asset("neoprojector-0.2.0-mac.zip", "md5:abc")),
			cur:     "v0.1.0",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, err := evaluate(tt.rel, tt.cur, mac)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("want error, got info=%v", info)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.want == "" {
				if info != nil {
					t.Fatalf("want no update, got %+v", info)
				}
				return
			}
			if info == nil {
				t.Fatalf("want update to %s, got none", tt.want)
			}
			if info.Version != tt.want {
				t.Fatalf("version: got %s want %s", info.Version, tt.want)
			}
			if info.SHA256 != "abc" {
				t.Fatalf("digest not stripped: %s", info.SHA256)
			}
		})
	}
}

func TestNewestRelease(t *testing.T) {
	rels := []ghRelease{
		{TagName: "v0.1.0-beta.13", Prerelease: true},
		{TagName: "v0.1.0-beta.19", Prerelease: true},
		{TagName: "v0.1.0-beta.9", Prerelease: true}, // numeric, not lexical: 9 < 13
		{TagName: "v0.2.0-beta.1", Draft: true},      // drafts are never offered
		{TagName: "not-a-version"},
	}
	if got := newestRelease(rels); got == nil || got.TagName != "v0.1.0-beta.19" {
		t.Fatalf("got %v, want v0.1.0-beta.19", got)
	}

	// Once a stable release is cut it outranks every beta of that version.
	rels = append(rels, ghRelease{TagName: "v0.1.0"})
	if got := newestRelease(rels); got == nil || got.TagName != "v0.1.0" {
		t.Fatalf("got %v, want v0.1.0", got)
	}

	if newestRelease(nil) != nil {
		t.Fatal("no releases must yield nil")
	}
}

func TestBetaTrackOffersNewerBeta(t *testing.T) {
	// The exact situation on 2026-10-30: install on beta.13, newest
	// release beta.19 (prerelease). It must be offered.
	r := rel("v0.1.0-beta.19", asset("neoprojector-0.1.0-beta.19-windows.zip", "sha256:abc"))
	info, err := evaluate(r, "v0.1.0-beta.13", "-windows.zip")
	if err != nil || info == nil || info.Version != "0.1.0-beta.19" {
		t.Fatalf("got %+v, %v; want update to 0.1.0-beta.19", info, err)
	}
}
