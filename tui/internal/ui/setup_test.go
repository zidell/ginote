package ui

import (
	"path/filepath"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/auth"
	"github.com/zidell/ginote/tui/internal/config"
)

func emptyModel(t *testing.T) Model {
	t.Helper()
	m := New(Options{TUIConfigPath: filepath.Join(t.TempDir(), "tui.toml")})
	m = drive(t, m, tea.WindowSizeMsg{Width: 120, Height: 34})
	return drive(t, m, openSetupMsg{})
}

func TestStartsInSetupWhenThereIsNoWorkspace(t *testing.T) {
	m := emptyModel(t)
	if m.setup == nil {
		t.Fatal("setup should open")
	}
	out := screenText(m)
	for _, want := range []string{"저장소 추가", "저장소", "토큰", "PAT 만들기"} {
		if !strings.Contains(out, want) {
			t.Errorf("screen lacks %q\n%s", want, out)
		}
	}
	if m = press(t, m, "esc"); m.setup == nil {
		t.Fatal("esc must not close setup when there is nothing else to show")
	}
}

func TestSetupRejectsBadRepository(t *testing.T) {
	m := emptyModel(t)
	m = typeText(t, m, "not-a-repo")
	m = press(t, m, "enter")
	m = press(t, m, "enter")
	next, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	m = next.(Model)
	if cmd != nil || m.setup.err == "" || m.setup.field != fieldRepo {
		t.Fatalf("err = %q field = %d", m.setup.err, m.setup.field)
	}
}

func TestSetupNeedsTokenWithoutGHLogin(t *testing.T) {
	m := emptyModel(t)
	m = drive(t, m, ghCheckedMsg{available: false})
	m = typeText(t, m, "owner/notes")
	m = press(t, m, "enter")
	m = press(t, m, "enter")
	next, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	m = next.(Model)
	if cmd != nil || !strings.Contains(m.setup.err, "gh auth login") {
		t.Fatalf("err = %q", m.setup.err)
	}
}

func TestVerifiedWorkspaceIsAddedOpenedAndSaved(t *testing.T) {
	m := emptyModel(t)
	workspace := config.Workspace{ID: "tui-1", Repo: "Owner/Notes", Name: "노트", Origin: config.OriginTUI, TokenSource: config.TokenGH}
	m.setup.busy = true
	m = drive(t, m, setupVerifiedMsg{workspace: workspace, token: auth.Token{Value: "x", Source: "test"}})
	if m.setup != nil || len(m.workspaces) != 1 || m.active != 0 {
		t.Fatalf("setup = %v workspaces = %+v active = %d", m.setup, m.workspaces, m.active)
	}
	saved, err := config.LoadTUI(m.tuiConfigPath)
	if err != nil || len(saved.Workspaces) != 1 || saved.ActiveWorkspace != "tui-1" || saved.Workspaces[0].TokenSource != config.TokenGH {
		t.Fatalf("saved = %+v err = %v", saved, err)
	}
}

func TestVerifyFailureKeepsTheForm(t *testing.T) {
	m := emptyModel(t)
	m.setup.busy = true
	m = drive(t, m, setupVerifiedMsg{err: auth.ErrNoToken})
	if m.setup == nil || m.setup.busy || m.setup.err == "" {
		t.Fatalf("setup = %+v", m.setup)
	}
}

func TestPasteGoesIntoTheFocusedField(t *testing.T) {
	m := emptyModel(t)
	m = drive(t, m, tea.PasteMsg{Content: "https://github.com/owner/notes\n"})
	m = press(t, m, "down", "down")
	m = drive(t, m, tea.PasteMsg{Content: " github_pat_abc "})
	if got := m.setup.inputs[fieldRepo].Value(); got != "https://github.com/owner/notes" {
		t.Errorf("repo = %q", got)
	}
	if got := m.setup.inputs[fieldToken].Value(); got != "github_pat_abc" {
		t.Errorf("token = %q", got)
	}
	if strings.Contains(screenText(m), "github_pat_abc") {
		t.Error("the token must stay masked")
	}
}
