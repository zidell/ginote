package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveStateRemembersSidebarWidth(t *testing.T) {
	path := StatePath(filepath.Join(t.TempDir(), "ginote-tui", "config.toml"))
	if err := SaveState(path, State{SidebarWidth: 42}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	var raw map[string]int
	if err := json.Unmarshal(data, &raw); err != nil || raw["sidebarWidth"] != 42 {
		t.Fatalf("state = %s", data)
	}
	if got := LoadState(path).SidebarWidth; got != 42 {
		t.Fatalf("sidebar width = %d", got)
	}
}
