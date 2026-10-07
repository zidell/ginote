// Package config는 설치형 앱의 config.toml(docs/CONFIG.md)에서 워크스페이스 목록을 읽는다.
// 파일의 형식과 쓰기는 데스크톱 앱(src/lib/app-config.js)이 맡고, TUI는 읽기만 한다.
package config

import (
	"errors"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"github.com/BurntSushi/toml"
)

const appIdentifier = "net.gitools.note"

type Workspace struct {
	ID   string
	Repo string
	Name string
	// Origin은 이 워크스페이스를 어디서 읽었는지다. OriginApp은 데스크톱 앱 설정이라 TUI가
	// 고치지 않고, OriginTUI는 TUI에서 추가한 것이다(tui.go).
	Origin string
	// TokenSource는 TUI 워크스페이스의 토큰 출처다(TokenKeychain, TokenGH).
	TokenSource string
}

const (
	OriginApp     = "app"
	OriginTUI     = "tui"
	OriginFlag    = "flag"
	TokenKeychain = "keychain"
	TokenGH       = "gh"
)

// Label은 화면에 보일 이름이다. 이름이 비어 있으면 저장소 주소를 쓴다(웹과 같음).
func (w Workspace) Label() string {
	if w.Name != "" {
		return w.Name
	}
	return w.Repo
}

type Config struct {
	Workspaces      []Workspace
	ActiveWorkspace string
	Preferences     Preferences
	Voice           VoiceSettings
}

const (
	defaultNotesPerPage = 30
	TitleFirstLine      = "first-line"
	TitleSeparate       = "separate"
)

// Path는 데스크톱 앱이 쓰는 config.toml 경로다. 옛 Windows MSIX 설치는 패키지 이름이
// 필요하므로 GINOTE_CONFIG로 지정한다. 현재 NSIS 설치는 APPDATA를 그대로 쓴다.
func Path() string {
	if path := os.Getenv("GINOTE_CONFIG"); path != "" {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support", appIdentifier, "config.toml")
	}
	if runtime.GOOS == "windows" {
		base, err := os.UserConfigDir()
		if err != nil {
			return ""
		}
		return filepath.Join(base, appIdentifier, "config.toml")
	}
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, appIdentifier, "config.toml")
}

type rawConfig struct {
	rawDesktopPreferences
	ActiveWorkspace string `toml:"active_workspace"`
	Workspaces      []struct {
		ID   string `toml:"id"`
		Repo string `toml:"repo"`
		Name string `toml:"name"`
	} `toml:"workspaces"`
}

// Load는 파일이 없으면 빈 설정을 돌려준다. repo가 "owner/name"이 아닌 항목은 앱처럼 건너뛴다.
func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return Config{Preferences: DefaultPreferences()}, nil
	}
	if err != nil {
		return Config{}, err
	}
	var raw rawConfig
	if err := toml.Unmarshal(data, &raw); err != nil {
		return Config{}, err
	}
	config := Config{Preferences: raw.preferences(), Voice: raw.Voice}
	for _, item := range raw.Workspaces {
		repo, ok := ParseRepo(item.Repo)
		if !ok {
			continue
		}
		id := strings.TrimSpace(item.ID)
		if id == "" {
			id = repo
		}
		config.Workspaces = append(config.Workspaces, Workspace{ID: id, Repo: repo, Name: strings.TrimSpace(item.Name), Origin: OriginApp})
	}
	config.ActiveWorkspace = raw.ActiveWorkspace
	if _, ok := config.Find(raw.ActiveWorkspace); !ok && len(config.Workspaces) > 0 {
		config.ActiveWorkspace = config.Workspaces[0].ID
	}
	return config, nil
}

func (c Config) Find(id string) (Workspace, bool) {
	for _, workspace := range c.Workspaces {
		if workspace.ID == id {
			return workspace, true
		}
	}
	return Workspace{}, false
}

var (
	githubURLPrefix = regexp.MustCompile(`(?i)^https?://github\.com/`)
	gitSuffix       = regexp.MustCompile(`(?i)\.git$`)
	edgeSlashes     = regexp.MustCompile(`^/+|/+$`)
	repoPattern     = regexp.MustCompile(`^[^/\s]+/[^/\s]+$`)
)

// ParseRepo는 parseRepositoryAddress(src/lib/repo-address.js)와 같은 규칙으로
// "owner/name"을 꺼낸다.
func ParseRepo(value string) (string, bool) {
	cleaned := githubURLPrefix.ReplaceAllString(strings.TrimSpace(value), "")
	cleaned = gitSuffix.ReplaceAllString(cleaned, "")
	cleaned = edgeSlashes.ReplaceAllString(cleaned, "")
	if !repoPattern.MatchString(cleaned) {
		return "", false
	}
	return cleaned, true
}

// PATCreationURL은 makePatCreationUrl(src/lib/repo-address.js)과 같은 주소다. 이 저장소에
// Issues·Contents 쓰기 권한만 가진 fine-grained PAT 만들기 화면을 연다.
func PATCreationURL(value string) string {
	repo, ok := ParseRepo(value)
	name := "Ginote"
	description := "Ginote repository access"
	owner := ""
	if ok {
		parts := strings.SplitN(repo, "/", 2)
		owner = parts[0]
		name = "Ginote - " + parts[1]
		description = "Ginote access for " + repo
	}
	if runes := []rune(name); len(runes) > 40 {
		name = string(runes[:40])
	}
	query := []string{
		"name=" + url.QueryEscape(name),
		"description=" + url.QueryEscape(description),
		"expires_in=none",
		"issues=write",
		"contents=write",
	}
	if owner != "" {
		query = append(query, "target_name="+url.QueryEscape(owner))
	}
	return "https://github.com/settings/personal-access-tokens/new?" + strings.Join(query, "&")
}
