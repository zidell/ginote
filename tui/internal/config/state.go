package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// State는 앱이 저절로 기억하는 값이다(사용자 설정이 아니라서 config.toml과 따로 둔다).
// 사이드바 너비는 경계선을 끌어 바꾼 값이다(웹의 sidebar-width.js처럼 기기마다 따로 기억한다).
type State struct {
	SidebarWidth int `json:"sidebarWidth,omitempty"`
}

// LoadState는 state.json을 읽는다. 없거나 읽지 못하면 빈 값이다.
func LoadState(path string) State {
	var state State
	if data, err := os.ReadFile(path); err == nil {
		json.Unmarshal(data, &state)
	}
	return state
}

// StatePath는 TUI 설정 파일 옆의 state.json이다.
func StatePath(tuiConfigPath string) string {
	return filepath.Join(filepath.Dir(tuiConfigPath), "state.json")
}

// SaveState는 state.json을 바꿔 끼워 쓴다.
func SaveState(path string, state State) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}
