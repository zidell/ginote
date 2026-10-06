package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadReadsWorkspacesWrittenByTheDesktopApp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	text := `
# 앱이 쓰는 주석은 무시한다.
active_workspace = "b"

[display]
theme = "dark"
title_mode = "separate"

[behavior]
notes_per_page = 500

[voice]
transcription_model = "gpt-4o-transcribe"

[[workspaces]]
id = "a"
repo = "owner/notes"
name = ""
remember_token = true

[[workspaces]]
id = "b"
repo = "https://github.com/owner/work.git"
name = "업무"
remember_token = true

[[workspaces]]
id = "broken"
repo = "not a repo"
`
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(config.Workspaces) != 2 {
		t.Fatalf("workspaces = %+v", config.Workspaces)
	}
	if config.Preferences.TitleMode != TitleSeparate {
		t.Errorf("title mode = %q", config.Preferences.TitleMode)
	}
	if config.Preferences.NotesPerPage != 100 {
		t.Errorf("notes per page = %d", config.Preferences.NotesPerPage)
	}
	if config.Voice.TranscriptionModel == nil || *config.Voice.TranscriptionModel != "gpt-4o-transcribe" {
		t.Errorf("voice settings were not read")
	}
	if config.ActiveWorkspace != "b" {
		t.Errorf("active = %q", config.ActiveWorkspace)
	}
	if got := config.Workspaces[1]; got.Repo != "owner/work" || got.Label() != "업무" {
		t.Errorf("workspace = %+v", got)
	}
	if got := config.Workspaces[0].Label(); got != "owner/notes" {
		t.Errorf("label = %q", got)
	}
}

func TestLoadFallsBackToTheFirstWorkspace(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	os.WriteFile(path, []byte("active_workspace = \"gone\"\n[[workspaces]]\nid = \"a\"\nrepo = \"o/n\"\n"), 0o600)
	config, err := Load(path)
	if err != nil || config.ActiveWorkspace != "a" {
		t.Fatalf("config = %+v, err = %v", config, err)
	}
}

func TestLoadMissingFileIsEmpty(t *testing.T) {
	config, err := Load(filepath.Join(t.TempDir(), "none.toml"))
	if err != nil || len(config.Workspaces) != 0 || config.Preferences.NotesPerPage != 30 || config.Preferences.TitleMode != TitleFirstLine {
		t.Fatalf("config = %+v, err = %v", config, err)
	}
}

func TestParseRepoMatchesWeb(t *testing.T) {
	cases := map[string]string{
		"owner/name":                          "owner/name",
		" HTTPS://github.com/owner/name.git ": "owner/name",
		"/owner/name/":                        "owner/name",
		"owner":                               "",
		"owner/name/extra":                    "",
		"own er/name":                         "",
	}
	for input, want := range cases {
		got, ok := ParseRepo(input)
		if got != want || ok != (want != "") {
			t.Errorf("ParseRepo(%q) = %q, %v", input, got, ok)
		}
	}
}

// 기대값은 makePatCreationUrl(src/lib/repo-address.js)을 node로 실행해 얻은 값이다.
func TestPATCreationURLMatchesWeb(t *testing.T) {
	cases := map[string]string{
		"owner/notes": "https://github.com/settings/personal-access-tokens/new?name=Ginote+-+notes&description=Ginote+access+for+owner%2Fnotes&expires_in=none&issues=write&contents=write&target_name=owner",
		"":            "https://github.com/settings/personal-access-tokens/new?name=Ginote&description=Ginote+repository+access&expires_in=none&issues=write&contents=write",
	}
	for input, want := range cases {
		if got := PATCreationURL(input); got != want {
			t.Errorf("PATCreationURL(%q)\n got %s\nwant %s", input, got, want)
		}
	}
}
