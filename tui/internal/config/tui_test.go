package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveAndLoadTUIWorkspaces(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "config.toml")
	saved := TUIConfig{
		ActiveWorkspace: "tui-b",
		Workspaces: []Workspace{
			{ID: "tui-a", Repo: "o/notes", Origin: OriginTUI, TokenSource: TokenKeychain},
			{ID: "app", Repo: "o/app", Origin: OriginApp},
			{ID: "tui-b", Repo: "o/work", Name: "업무", Origin: OriginTUI, TokenSource: TokenGH},
		},
	}
	if err := SaveTUI(path, saved); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if strings.Contains(string(data), "o/app") {
		t.Fatal("desktop workspaces must not be copied into the TUI file")
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v", info.Mode().Perm())
	}
	loaded, err := LoadTUI(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ActiveWorkspace != "tui-b" || len(loaded.Workspaces) != 2 {
		t.Fatalf("loaded = %+v", loaded)
	}
	if got := loaded.Workspaces[1]; got.Name != "업무" || got.TokenSource != TokenGH || got.Origin != OriginTUI {
		t.Errorf("workspace = %+v", got)
	}
}

func TestNewWorkspaceIDIsPrefixed(t *testing.T) {
	if id := NewWorkspaceID(); !strings.HasPrefix(id, "tui-") || len(id) != 16 || id == NewWorkspaceID() {
		t.Fatalf("id = %q", id)
	}
}

func TestLoadTUIPreferencesKeepsInputSourceWhenUnset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte("[preferences]\ntheme = 'dark'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadTUI(path)
	if err != nil || loaded.Preferences == nil || !loaded.Preferences.KeepInputSource {
		t.Fatalf("preferences = %+v, err = %v", loaded.Preferences, err)
	}
	if err := os.WriteFile(path, []byte("[preferences]\nkeep_input_source = false\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err = LoadTUI(path)
	if err != nil || loaded.Preferences == nil || loaded.Preferences.KeepInputSource {
		t.Fatalf("explicit preference = %+v, err = %v", loaded.Preferences, err)
	}
}
