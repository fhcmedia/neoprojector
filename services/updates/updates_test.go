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
