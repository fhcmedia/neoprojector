package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/adrg/xdg"
	"github.com/zalando/go-keyring"
)

const (
	keyringService = "neoprojector"
	keyringAccount = "session-key"
	sessionRelPath = "neoprojector/session.enc"
)

// Service exposes auth helpers to the frontend through Wails bindings:
//   - Fingerprint: stable device identity (forwarded to the Railway server)
//   - {Store,Load,Clear}Session: encrypted refresh-token persistence
//
// Encryption uses AES-256-GCM with a key generated on first use and stored in
// the OS keyring (Windows Credential Manager / macOS Keychain / Secret
// Service on Linux). The ciphertext blob lives in the user's XDG config dir,
// so wiping the OS keyring invalidates any leaked session file.
type Service struct {
	mu     sync.Mutex
	fpOnce sync.Once
	fpInfo FingerprintInfo
	fpErr  error
}

func New() *Service { return &Service{} }

// FingerprintInfo is the payload the frontend sends to the server's
// /api/auth/* endpoints. Hash is computed server-side too as a defence
// against a tampered client.
type FingerprintInfo struct {
	Fingerprint      string   `json:"fingerprint"`
	NetworkSignature string   `json:"network_signature"`
	MacAddresses     []string `json:"mac_addresses"`
	Hostname         string   `json:"hostname"`
	OSInfo           string   `json:"os_info"`
	WifiSSID         string   `json:"wifi_ssid"`
	Platform         string   `json:"platform"`
}

// SessionData mirrors the bits of a Supabase session we need to resume the
// next launch. Stored encrypted at rest; the access token always gets
// refreshed before use even if it hasn't expired.
type SessionData struct {
	UserID       string `json:"user_id"`
	Email        string `json:"email"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
}

var ErrNoSession = errors.New("no session")

func (s *Service) Fingerprint() (FingerprintInfo, error) {
	s.fpOnce.Do(func() { s.fpInfo, s.fpErr = buildFingerprint() })
	return s.fpInfo, s.fpErr
}

// HasStoredSession is a cheap pre-check the splash screen can call before
// deciding whether to show the auth UI.
func (s *Service) HasStoredSession() bool {
	_, err := xdg.SearchConfigFile(sessionRelPath)
	return err == nil
}

func (s *Service) StoreSession(data SessionData) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	plaintext, err := json.Marshal(data)
	if err != nil {
		return err
	}
	key, err := s.getOrCreateKey()
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return err
	}
	ct := gcm.Seal(nonce, nonce, plaintext, nil)
	path, err := xdg.ConfigFile(sessionRelPath)
	if err != nil {
		return err
	}
	return os.WriteFile(path, ct, 0o600)
}

func (s *Service) LoadSession() (SessionData, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	path, err := xdg.SearchConfigFile(sessionRelPath)
	if err != nil {
		return SessionData{}, ErrNoSession
	}
	blob, err := os.ReadFile(path)
	if err != nil || len(blob) == 0 {
		return SessionData{}, ErrNoSession
	}
	key, err := s.getOrCreateKey()
	if err != nil {
		return SessionData{}, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return SessionData{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return SessionData{}, err
	}
	ns := gcm.NonceSize()
	if len(blob) < ns {
		return SessionData{}, errors.New("session corrupt")
	}
	pt, err := gcm.Open(nil, blob[:ns], blob[ns:], nil)
	if err != nil {
		return SessionData{}, errors.New("session decrypt failed")
	}
	var sd SessionData
	if err := json.Unmarshal(pt, &sd); err != nil {
		return SessionData{}, err
	}
	return sd, nil
}

func (s *Service) ClearSession() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	path, err := xdg.SearchConfigFile(sessionRelPath)
	if err != nil {
		return nil
	}
	return os.Remove(path)
}

/* --------------------------------------------------------------------- */
/* Internals                                                              */
/* --------------------------------------------------------------------- */

func (s *Service) getOrCreateKey() ([]byte, error) {
	raw, err := keyring.Get(keyringService, keyringAccount)
	if err == nil && raw != "" {
		return base64.StdEncoding.DecodeString(raw)
	}
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := keyring.Set(keyringService, keyringAccount,
		base64.StdEncoding.EncodeToString(key)); err != nil {
		return nil, err
	}
	return key, nil
}

func buildFingerprint() (FingerprintInfo, error) {
	info := FingerprintInfo{Platform: runtime.GOOS}
	hn, _ := os.Hostname()
	info.Hostname = hn
	info.OSInfo = runtime.GOOS + "/" + runtime.GOARCH

	ifaces, _ := net.Interfaces()
	macs := []string{}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		if len(ifc.HardwareAddr) == 0 {
			continue
		}
		// Skip virtual / docker / vmware ranges — they're per-install random
		// and would defeat the "same device" check.
		name := strings.ToLower(ifc.Name)
		if strings.Contains(name, "vmnet") || strings.Contains(name, "vbox") ||
			strings.Contains(name, "docker") || strings.Contains(name, "veth") ||
			strings.Contains(name, "br-") {
			continue
		}
		mac := strings.ToLower(ifc.HardwareAddr.String())
		if mac == "" {
			continue
		}
		macs = append(macs, mac)
	}
	sort.Strings(macs)
	info.MacAddresses = macs

	info.WifiSSID = currentWifiSSID()
	info.NetworkSignature = networkSignature()

	machineID := readMachineID()
	sum := sha256.New()
	fmt.Fprintf(sum, "v1|%s|%s|%s|%s|%s",
		machineID, hn, info.OSInfo, strings.Join(macs, ","), info.NetworkSignature)
	info.Fingerprint = hex.EncodeToString(sum.Sum(nil))
	return info, nil
}

func readMachineID() string {
	switch runtime.GOOS {
	case "linux":
		if b, err := os.ReadFile("/etc/machine-id"); err == nil {
			return strings.TrimSpace(string(b))
		}
		if b, err := os.ReadFile("/var/lib/dbus/machine-id"); err == nil {
			return strings.TrimSpace(string(b))
		}
	case "darwin":
		out, err := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
		if err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				if strings.Contains(line, "IOPlatformUUID") {
					parts := strings.Split(line, `"`)
					if len(parts) >= 4 {
						return parts[3]
					}
				}
			}
		}
	case "windows":
		out, err := exec.Command("reg", "query",
			`HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid").Output()
		if err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				if strings.Contains(line, "MachineGuid") {
					fields := strings.Fields(line)
					if len(fields) >= 3 {
						return fields[len(fields)-1]
					}
				}
			}
		}
	}
	return "unknown"
}

func currentWifiSSID() string {
	switch runtime.GOOS {
	case "windows":
		out, err := exec.Command("netsh", "wlan", "show", "interfaces").Output()
		if err != nil {
			return ""
		}
		for _, line := range strings.Split(string(out), "\n") {
			t := strings.TrimSpace(line)
			// "BSSID" line also starts with B; explicitly skip it.
			if strings.HasPrefix(t, "SSID") && !strings.HasPrefix(t, "BSSID") {
				if _, after, ok := strings.Cut(t, ":"); ok {
					return strings.TrimSpace(after)
				}
			}
		}
	case "darwin":
		out, err := exec.Command(
			"/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport",
			"-I",
		).Output()
		if err != nil {
			return ""
		}
		for _, line := range strings.Split(string(out), "\n") {
			t := strings.TrimSpace(line)
			if strings.HasPrefix(t, "SSID:") {
				if _, after, ok := strings.Cut(t, ":"); ok {
					return strings.TrimSpace(after)
				}
			}
		}
	case "linux":
		if out, err := exec.Command("iwgetid", "-r").Output(); err == nil {
			return strings.TrimSpace(string(out))
		}
	}
	return ""
}

// networkSignature hashes the (sorted) set of v4 CIDRs the device is on. Same
// LAN → same signature, regardless of which interface is preferred — so the
// admin can ban a fingerprint by network too.
func networkSignature() string {
	ifaces, _ := net.Interfaces()
	parts := []string{}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
				if ip4 := ipnet.IP.To4(); ip4 != nil {
					_ = ip4
					parts = append(parts, ipnet.String())
				}
			}
		}
	}
	sort.Strings(parts)
	sum := sha256.Sum256([]byte("net1|" + strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:16])
}
