package ui

import (
	"errors"
	"testing"

	tea "charm.land/bubbletea/v2"
)

func TestDragSelectsBodyTextAndCopies(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	var copied string
	previous := writeClipboard
	writeClipboard = func(text string) error { copied = text; return nil }
	t.Cleanup(func() { writeClipboard = previous })
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter")
	m.View()
	zone, _ := m.hits.lookup("body")
	// 본문 "장보기\n\n- 우유"에서 첫 줄 처음부터 셋째 줄 "- 우"까지 끈다.
	m = drive(t, m, tea.MouseClickMsg{X: zone.originX, Y: zone.originY + topMargin, Button: tea.MouseLeft})
	m = drive(t, m, tea.MouseMotionMsg{X: zone.originX + 4, Y: zone.originY + 2 + topMargin, Button: tea.MouseLeft})
	m = drive(t, m, tea.MouseReleaseMsg{X: zone.originX + 4, Y: zone.originY + 2 + topMargin, Button: tea.MouseLeft})
	if copied != "" || m.note.body.SelectedText() != "장보기\n\n- 우" {
		t.Fatalf("release only selects: copied = %q", copied)
	}
	for _, keyPress := range []tea.KeyPressMsg{{Code: 'c', Mod: tea.ModSuper}, {Code: 'c', Mod: tea.ModCtrl}} {
		copied = ""
		m = drive(t, m, keyPress)
		if copied != "장보기\n\n- 우" || m.quitting {
			t.Fatalf("%v copies the selection: %q", keyPress, copied)
		}
	}
	if m.focus != focusBody || !m.note.body.HasSelection() {
		t.Fatal("the selection stays in the focused body")
	}
	// 선택한 채 입력하면 덮어쓴다.
	m = typeText(t, m, "두")
	if m.note.body.Value() != "두유" {
		t.Fatalf("typing replaces the selection: %q", m.note.body.Value())
	}
}

func TestClipboardResultsAndIssueNumber(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter")
	previous := writeClipboard
	t.Cleanup(func() { writeClipboard = previous })
	var copied string
	writeClipboard = func(text string) error { copied = text; return nil }
	m.View()
	zone, ok := m.hits.lookup("copynumber")
	if !ok {
		t.Fatal("issue number hit target missing")
	}
	m = drive(t, m, tea.MouseClickMsg{X: zone.x0, Y: zone.y0 + topMargin, Button: tea.MouseLeft})
	if copied != "#2" || m.toast != "#2 복사했습니다." {
		t.Fatalf("issue number copy: %q, toast %q", copied, m.toast)
	}
	writeClipboard = func(string) error { return errors.New("unavailable") }
	var cmd tea.Cmd
	m, cmd = m.copyIssueNumber()
	m = runCmd(t, m, cmd)
	if m.toast != "클립보드에 복사하지 못했습니다: unavailable" {
		t.Fatalf("failed copy toast: %q", m.toast)
	}
}
