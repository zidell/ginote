package ui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

func TestFindLinksAndUnderline(t *testing.T) {
	links := findLinks("보기 https://example.com/a. 그리고 {repo}/.issue-note-assets/x.png", "o/notes")
	if len(links) != 2 || links[0].url != "https://example.com/a" || links[0].start != 3 || !strings.HasPrefix(links[1].url, "https://github.com/o/notes/raw/") {
		t.Fatalf("links = %+v", links)
	}
}

func TestClickingABodyLinkOpensIt(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	fake.issues[2]["body"] = "장보기\n\n가게 https://example.com/shop 참고"
	var opened []string
	previous := openURL
	openURL = func(url string) tea.Cmd { opened = append(opened, url); return nil }
	t.Cleanup(func() { openURL = previous })
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter")
	rendered, _ := m.render()
	if !strings.Contains(rendered, "\x1b[4m") {
		t.Fatal("the link is underlined")
	}
	m.View()
	zone, _ := m.hits.lookup("body")
	at := func(x, y int, mod tea.KeyMod) tea.MouseClickMsg {
		return tea.MouseClickMsg{X: zone.originX + x, Y: zone.originY + y + topMargin, Button: tea.MouseLeft, Mod: mod}
	}
	// 편집 중이 아니면 링크를 누르면 연다.
	m = drive(t, m, at(8, 2, 0))
	if len(opened) != 1 || opened[0] != "https://example.com/shop" || m.focus == focusBody {
		t.Fatalf("opened = %v focus = %v", opened, m.focus)
	}
	// 링크가 아닌 곳은 편집을 시작하고, 편집 중에는 링크를 눌러도 커서만 옮긴다.
	m = drive(t, m, at(0, 0, 0))
	m = drive(t, m, tea.MouseReleaseMsg{X: zone.originX, Y: zone.originY + topMargin})
	m = drive(t, m, at(8, 2, 0))
	m = drive(t, m, tea.MouseReleaseMsg{X: zone.originX + 8, Y: zone.originY + 2 + topMargin})
	if len(opened) != 1 || m.focus != focusBody {
		t.Fatalf("editing keeps the click in the editor: %v", opened)
	}
	// 편집 중에도 Option을 누른 채 누르면 연다.
	m = drive(t, m, at(8, 2, tea.ModAlt))
	if len(opened) != 2 {
		t.Fatal("option-click opens while editing")
	}
}
