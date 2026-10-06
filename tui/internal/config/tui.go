package config

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
)

// TUI에서 추가한 워크스페이스는 데스크톱 앱의 config.toml이 아니라 이 파일에 둔다. 데스크톱
// 앱은 config.toml이 없을 때만 예전 localStorage 설정을 옮겨 오므로(settings-backend.js init),
// TUI가 그 파일을 먼저 만들면 앱의 기존 워크스페이스가 옮겨지지 않는다. 토큰은 이 파일에
// 쓰지 않는다(internal/auth).

// TUIPath는 TUI 설정 파일 경로다. GINOTE_TUI_CONFIG로 바꿀 수 있다.
func TUIPath() string {
	if path := os.Getenv("GINOTE_TUI_CONFIG"); path != "" {
		return path
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "ginote-tui", "config.toml")
}

type tuiFile struct {
	ActiveWorkspace string         `toml:"active_workspace"`
	Workspaces      []tuiWorkspace `toml:"workspaces"`
	Preferences     *Preferences   `toml:"preferences,omitempty"`
	Voice           *VoiceSettings `toml:"voice,omitempty"`
}

type tuiWorkspace struct {
	ID    string `toml:"id"`
	Repo  string `toml:"repo"`
	Name  string `toml:"name"`
	Token string `toml:"token"`
}

// TUIConfig는 TUI 설정 파일의 내용이다.
type TUIConfig struct {
	Workspaces      []Workspace
	ActiveWorkspace string
	Preferences     *Preferences
	Voice           *VoiceSettings
}

func LoadTUI(path string) (TUIConfig, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return TUIConfig{}, nil
	}
	if err != nil {
		return TUIConfig{}, err
	}
	var raw tuiFile
	metadata, err := toml.Decode(string(data), &raw)
	if err != nil {
		return TUIConfig{}, err
	}
	if raw.Preferences != nil && !metadata.IsDefined("preferences", "keep_input_source") {
		raw.Preferences.KeepInputSource = true
	}
	config := TUIConfig{ActiveWorkspace: raw.ActiveWorkspace, Preferences: raw.Preferences, Voice: raw.Voice}
	for _, item := range raw.Workspaces {
		repo, ok := ParseRepo(item.Repo)
		if !ok || strings.TrimSpace(item.ID) == "" {
			continue
		}
		source := TokenKeychain
		if item.Token == TokenGH {
			source = TokenGH
		}
		config.Workspaces = append(config.Workspaces, Workspace{
			ID: strings.TrimSpace(item.ID), Repo: repo, Name: strings.TrimSpace(item.Name),
			Origin: OriginTUI, TokenSource: source,
		})
	}
	return config, nil
}

const tuiHeader = `# Ginote TUI 설정. TUI에서 추가한 워크스페이스를 둔다. 데스크톱 앱의 워크스페이스는
# 앱의 config.toml에서 따로 읽는다(docs/TUI.md).
#
# active_workspace  시작할 때 열 워크스페이스 id
# [[workspaces]]
#   id     바꾸지 않는다. 토큰 이름(github-pat:<id>)에 쓰인다
#   repo   "owner/name"
#   name   화면에 보일 이름. ""이면 저장소 주소
#   token  "keychain"(TUI에서 넣은 PAT, OS 자격 증명 저장소) 또는 "gh"(gh auth token)

`

// SaveTUI는 파일 전체를 다시 쓴다. 다른 이름으로 쓴 뒤 바꿔 끼워 중간 상태가 남지 않게 한다.
func SaveTUI(path string, config TUIConfig) error {
	raw := tuiFile{ActiveWorkspace: config.ActiveWorkspace, Preferences: config.Preferences, Voice: config.Voice}
	for _, workspace := range config.Workspaces {
		if workspace.Origin != OriginTUI {
			continue
		}
		raw.Workspaces = append(raw.Workspaces, tuiWorkspace{
			ID: workspace.ID, Repo: workspace.Repo, Name: workspace.Name, Token: workspace.TokenSource,
		})
	}
	var buffer bytes.Buffer
	buffer.WriteString(tuiHeader)
	if err := toml.NewEncoder(&buffer).Encode(raw); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, buffer.Bytes(), 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

// NewWorkspaceID는 TUI 워크스페이스 id다. 데스크톱 앱의 id와 섞이지 않게 접두사를 붙인다.
func NewWorkspaceID() string {
	random := make([]byte, 6)
	rand.Read(random)
	return "tui-" + hex.EncodeToString(random)
}
