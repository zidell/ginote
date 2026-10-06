package ui

import (
	"os"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/notes"
)

func stripANSI(text string) string { return ansi.Strip(text) }

func TestListShowsTabsSearchPinnedAndRows(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	if len(m.pinned) != 1 || m.pinned[0].Number != 1 || len(m.issues) != 2 {
		t.Fatalf("pinned = %d issues = %d", len(m.pinned), len(m.issues))
	}
	screen := screenText(m)
	for _, want := range []string{"o/notes", "설정", "노트", "휴지통", "검색어 또는 #태그", "새 노트", "📌", "고정 노트", "장보기", "#2 · ", "#work", "왼쪽 목록에서 노트를 선택하세요."} {
		if !strings.Contains(screen, want) {
			t.Errorf("screen lacks %q\n%s", want, screen)
		}
	}
	if strings.Contains(screen, "#ginote:pin") {
		t.Error("pin label must stay hidden")
	}
	if strings.Contains(screen, "━") {
		t.Error("pinned notes must not add a second divider below the row divider")
	}
}

func TestEnterKeepsListFocusThenSecondEnterEdits(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter")
	if m.note == nil || m.note.number() != 2 || m.focus != focusNone || m.kbFocus != 1002 {
		t.Fatalf("note = %v focus = %v kb = %d", m.note != nil, m.focus, m.kbFocus)
	}
	// 열람 중에도 ↑/↓는 목록 커서를 움직인다.
	m = press(t, m, "up")
	if m.kbFocus != 1001 || m.note.number() != 2 {
		t.Fatalf("arrow keys must keep moving the list: kb = %d", m.kbFocus)
	}
	m = press(t, m, "down", "enter")
	if m.note.number() != 2 || m.focus != focusNone {
		t.Fatalf("enter on another row reopens without editing")
	}
	m = press(t, m, "enter")
	if m.focus != focusBody {
		t.Fatalf("second enter must focus the editor, focus = %v", m.focus)
	}
	if _, cursor := m.render(); cursor == nil {
		t.Error("editing shows the terminal cursor")
	}
	m = press(t, m, "esc")
	if m.focus != focusNone || m.note == nil {
		t.Fatal("first esc only leaves the editor")
	}
	m = press(t, m, "esc")
	if m.note != nil {
		t.Fatal("second esc closes the note")
	}
}

func TestTabMovesBetweenOpenNoteAndList(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter")
	if m.focus != focusNone || m.note == nil {
		t.Fatal("first Enter opens the note with list focus")
	}
	m = press(t, m, "tab")
	if m.focus != focusBody || m.kbFocus != m.note.issue.ID {
		t.Fatalf("Tab should focus the open editor: focus=%d row=%d", m.focus, m.kbFocus)
	}
	if _, cursor := m.render(); cursor == nil {
		t.Fatal("Tab should show the editor cursor")
	}
	m.note.body.MoveToEnd()
	m = typeText(t, m, " 추가")
	m = press(t, m, "shift+tab")
	if m.focus != focusNone || m.note == nil || m.kbFocus != 1002 {
		t.Fatalf("Shift+Tab should return to the list: focus=%d row=%d", m.focus, m.kbFocus)
	}
	if body := fake.issue(2)["body"].(string); !strings.Contains(body, "추가") {
		t.Fatalf("Shift+Tab should save the body: %q", body)
	}
	m = press(t, m, "tab")
	if m.focus != focusBody {
		t.Fatal("Tab should reenter the editor")
	}
}

func TestShiftTabFromSeparateTitleModeReturnsToList(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m.prefs.TitleMode = config.TitleSeparate
	m = press(t, m, "down", "down", "enter", "tab")
	if m.focus != focusBody {
		t.Fatalf("existing title should focus the body: %d", m.focus)
	}
	m = press(t, m, "shift+tab")
	if m.focus != focusNone || m.kbFocus != 1002 {
		t.Fatalf("Shift+Tab should return directly to the list: focus=%d row=%d", m.focus, m.kbFocus)
	}
}

func TestWorkspaceSwitchFocusesFirstListRow(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m.workspaces = append(m.workspaces, config.Workspace{ID: "w2", Repo: "o/notes", Origin: config.OriginApp})
	m.tool = "ws"
	m.choice = m.switcherChoice()
	m = press(t, m, "2")
	if m.active != 1 || m.tool != "" || m.focus != focusNone || m.kbFocus != 1001 {
		t.Fatalf("after switch: active=%d tool=%q focus=%d row=%d", m.active, m.tool, m.focus, m.kbFocus)
	}
	m = press(t, m, "down")
	if m.kbFocus != 1002 {
		t.Fatalf("down moves from first row: %d", m.kbFocus)
	}
}

func TestEditingSavesAndKeepsManagedAttachmentBlock(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "down", "enter")
	if m.note.number() != 3 {
		t.Fatalf("opened #%d", m.note.number())
	}
	if value := m.note.body.Value(); strings.Contains(value, "ginote:attachments") || !strings.HasPrefix(value, "여행 계획") {
		t.Fatalf("managed block must be hidden while editing: %q", value)
	}
	m = press(t, m, "enter")
	m.note.body.CursorEnd()
	m.note.body.MoveToEnd()
	m = typeText(t, m, " 2박")
	if !m.note.dirty {
		t.Fatal("typing makes the note dirty")
	}
	m = press(t, m, "esc")
	issue := fake.issue(3)
	body := issue["body"].(string)
	if !strings.HasPrefix(body, "<!-- ginote:attachments:start -->\n\n![](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/a-photo.png)") {
		t.Fatalf("saved body lost the attachment block:\n%s", body)
	}
	if !strings.HasSuffix(body, "교토 2박") || issue["title"] != "여행 계획" {
		t.Fatalf("saved = %q / %q", issue["title"], body)
	}
	if m.note.dirty || m.note.saving {
		t.Fatal("saved note is clean")
	}
	if !strings.Contains(screenText(m), "저장됨") {
		t.Error("toolbar shows the saved state")
	}
}

func TestAutosaveAfterIdle(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter", "enter")
	m = typeText(t, m, "X")
	m = drive(t, m, autosaveMsg{id: m.note.issue.ID, revision: m.note.revision})
	// 웹처럼 편집으로 들어가면 커서는 본문 끝에 있다.
	if fake.issue(2)["body"] != "장보기\n\n- 우유X" {
		t.Fatalf("autosaved = %q", fake.issue(2)["body"])
	}
}

func TestNewNoteCreatesIssueAndSavesFirstLineTitle(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "n")
	if m.note == nil || m.note.pending || m.note.number() == 0 || m.focus != focusBody {
		t.Fatalf("new note: %+v focus = %v", m.note != nil, m.focus)
	}
	number := m.note.number()
	m = typeText(t, m, "첫 줄 제목\n본문")
	if !strings.Contains(screenText(m), "첫 줄 제목") {
		t.Error("the list shows the draft title while typing")
	}
	m = press(t, m, "ctrl+s")
	issue := fake.issue(number)
	if issue["title"] != "첫 줄 제목" || issue["body"] != "첫 줄 제목\n본문" {
		t.Fatalf("saved = %q / %q", issue["title"], issue["body"])
	}
}

func TestDeleteWaitsTwoSecondsAndEscCancels(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "delete")
	if m.deletions.Len() != 1 || !strings.Contains(screenText(m), "휴지통으로 옮기는 중") {
		t.Fatal("delete queues the note")
	}
	m = press(t, m, "esc")
	if m.deletions.Len() != 0 {
		t.Fatal("esc cancels the pending deletion")
	}
	m = press(t, m, "delete")
	m = drive(t, m, tickMsg{at: time.Now().Add(3 * time.Second)})
	if fake.issue(2)["state"] != "closed" {
		t.Fatalf("state = %v", fake.issue(2)["state"])
	}
	for _, issue := range m.orderedIssues() {
		if issue.Number == 2 {
			t.Fatal("trashed note leaves the list")
		}
	}
	// 휴지통 탭에서 복원한다.
	m = press(t, m, "]")
	if m.state != "closed" || len(m.issues) != 1 {
		t.Fatalf("trash = %d", len(m.issues))
	}
	m = press(t, m, "down", "enter")
	m = click(t, m, "tb:more")
	m = clickChoice(t, m, "move")
	if fake.issue(2)["state"] != "open" {
		t.Fatal("restore from the more menu reopens the issue")
	}
}

func TestPinToggleMovesNoteToTop(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter", "p")
	if len(m.pinned) != 2 || !notes.HasIssueLabel(fakeLabelNames(fake.issue(2)), "ginote:pin") {
		t.Fatalf("pinned = %d labels = %v", len(m.pinned), fakeLabelNames(fake.issue(2)))
	}
	if !strings.Contains(stripANSI(screenText(m)), "상단에 고정했습니다") {
		t.Error("toast")
	}
}

func TestSearchAndTagFilter(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "/")
	m = typeText(t, m, "#")
	if len(m.searchSuggestions()) != 1 || !strings.Contains(screenText(m), "#work") {
		t.Fatalf("suggestions = %v", m.searchSuggestions())
	}
	m = press(t, m, "down", "enter")
	// 웹처럼 고정 노트는 태그 필터와 상관없이 위에 남는다(loadIssues의 pinnedResult).
	if m.activeLabel != "work" || len(m.issues) != 1 || m.issues[0].Number != 2 {
		t.Fatalf("label = %q issues = %d", m.activeLabel, len(m.issues))
	}
	m = press(t, m, "/")
	for range "#work" {
		m = press(t, m, "backspace")
	}
	m = typeText(t, m, "교토")
	m = press(t, m, "enter")
	if m.activeLabel != "" || len(m.issues) != 1 || m.issues[0].Number != 3 {
		t.Fatalf("search = %d", len(m.issues))
	}
}

func TestTagPickerAddsNewTagAndChipRemoves(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter", "t")
	if m.picker == nil {
		t.Fatal("T opens the tag picker")
	}
	m = typeText(t, m, "여행")
	m = press(t, m, "enter")
	if m.note.hasLabel("여행") || !m.picker.has("여행") {
		t.Fatalf("enter only stages the tag until 확인: labels = %v", m.note.labels)
	}
	// 입력칸이 비었을 때 Enter는 확인이다.
	m = press(t, m, "enter")
	if m.picker != nil || !m.note.hasLabel("여행") {
		t.Fatalf("labels = %v", m.note.labels)
	}
	if names := fakeLabelNames(fake.issue(2)); !notes.HasIssueLabel(names, "여행") || !notes.HasIssueLabel(names, "work") {
		t.Fatalf("saved labels = %v", names)
	}
	if !fake.saw("POST /repos/o/notes/labels") {
		t.Error("a new tag is created in the repository")
	}
	m = click(t, m, "chipx:work")
	if notes.HasIssueLabel(fakeLabelNames(fake.issue(2)), "work") {
		t.Fatal("chip × removes the tag")
	}
}

func TestSelectionTagsSeveralNotes(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "space", "shift+down")
	if len(m.selected) != 2 || !strings.Contains(screenText(m), "병합") {
		t.Fatalf("selected = %d", len(m.selected))
	}
	m = click(t, m, "sel:tags")
	m = typeText(t, m, "묶음")
	m = press(t, m, "enter")
	if notes.HasIssueLabel(fakeLabelNames(fake.issue(2)), "묶음") {
		t.Fatal("nothing is applied before 확인")
	}
	m = press(t, m, "tab", "enter")
	for _, number := range []int{2, 3} {
		if !notes.HasIssueLabel(fakeLabelNames(fake.issue(number)), "묶음") {
			t.Errorf("#%d labels = %v", number, fakeLabelNames(fake.issue(number)))
		}
	}
	m = press(t, m, "esc", "esc")
	if len(m.selected) != 0 {
		t.Fatal("esc clears the selection")
	}
}

func TestCommentsAddEditDelete(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter")
	m = click(t, m, "addcomment")
	m = typeText(t, m, "첫 댓글")
	m = press(t, m, "shift+tab")
	if len(fake.comments[2]) != 1 || fake.comments[2][0]["body"] != "첫 댓글" {
		t.Fatalf("comments = %v", fake.comments[2])
	}
	m = click(t, m, "cmore:0")
	m = clickChoice(t, m, "comment-delete")
	if len(fake.comments[2]) != 0 || len(m.note.comments) != 0 {
		t.Fatal("comment deleted")
	}
}

func TestCommentLoadingKeepsAddButtonStillWhenIssueHasNoComments(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter")
	addLine := func() int {
		content := m.buildDetailContent(m.detailGeometry())
		for _, zone := range content.zones {
			if zone.id == "addcomment" {
				return zone.line
			}
		}
		t.Fatal("add comment button missing")
		return -1
	}
	stableLine := addLine()
	m.note.commentsLoading = true
	if line := addLine(); line != stableLine {
		t.Fatalf("empty issue loading moved add button: %d -> %d", stableLine, line)
	}
	m.note.issue.Comments = 1
	if line := addLine(); line != stableLine+1 {
		t.Fatalf("issue with comments needs loading row: %d -> %d", stableLine, line)
	}
}

func TestLockAndUnlockRoundTrip(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter", "l")
	if m.prompt == nil || m.prompt.kind != "lock" {
		t.Fatal("L asks for the lock number")
	}
	m = typeText(t, m, "123456")
	// Intel CI에서는 암호화가 drive의 150ms 제한을 넘는다. 결과 메시지를 반드시 적용한다.
	next, cmd := m.Update(key("enter"))
	m = drive(t, next.(Model), cmd())
	// 저장 요청도 비동기이므로 가짜 API의 결과를 확인한다.
	deadline := time.Now().Add(3 * time.Second)
	for {
		fake.mu.Lock()
		issue := fake.issues[2]
		title, body := issue["title"].(string), issue["body"].(string)
		fake.mu.Unlock()
		if notes.IsLockedTitle(title) && notes.IsLockedPayload(body) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("locked = %q / %q", title, body)
		}
		time.Sleep(10 * time.Millisecond)
	}
	// 세션 숫자를 잊은 새 TUI에서 열면 잠겨 있고, 숫자를 넣으면 열린다.
	other := startApp(t, fake)
	other = press(t, other, "down", "down", "enter")
	if other.note.lock != lockLocked || strings.Contains(screenText(other), "우유") {
		t.Fatal("locked note hides its body")
	}
	other = press(t, other, "enter")
	other = typeText(t, other, "123456")
	t.Logf("prompt=%+v lock=%v", other.prompt, other.note.lock)
	if other.note.lock != lockUnlocked || !strings.Contains(other.note.body.Value(), "우유") {
		t.Fatalf("unlocked body = %q", other.note.body.Value())
	}
}

func TestSettingsChangeIsSavedToTheTUIFile(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, ",")
	m = click(t, m, "set:autosave")
	m = press(t, m, "backspace")
	m = typeText(t, m, "7")
	m = press(t, m, "enter")
	m = click(t, m, "act:apply")
	if m.prefs.AutoSaveSeconds != 7 {
		t.Fatalf("autosave = %d", m.prefs.AutoSaveSeconds)
	}
	saved, err := config.LoadTUI(m.tuiConfigPath)
	if err != nil || saved.Preferences == nil || saved.Preferences.AutoSaveSeconds != 7 {
		t.Fatalf("saved = %+v err = %v", saved.Preferences, err)
	}
	if _, err := os.Stat(m.tuiConfigPath); err != nil {
		t.Fatal(err)
	}
}

func TestMouseTabsAndRows(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	fake.issues[2]["state"] = "closed"
	fake.issues[2]["closed_at"] = time.Now().UTC().Format(time.RFC3339)
	m := startApp(t, fake)
	m = click(t, m, "tab:closed")
	if m.state != "closed" || len(m.issues) != 1 {
		t.Fatalf("closed tab = %d", len(m.issues))
	}
	m = click(t, m, "tab:open")
	m = click(t, m, "row:1003")
	if m.note == nil || m.note.number() != 3 || m.entered != 1003 {
		t.Fatal("clicking a row opens it")
	}
	m = press(t, m, "enter")
	if m.focus != focusBody {
		t.Fatal("after a click the next Enter edits")
	}
	m = drive(t, m, tea.KeyPressMsg{Code: tea.KeyEscape})
	m = click(t, m, "settings")
	if m.settings == nil {
		t.Fatal("settings button")
	}
}

func TestHangulKeysWorkAsShortcuts(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "ㅓ", "ㅓ")
	if m.kbFocus != 1002 {
		t.Fatalf("ㅓ moves like j: kb = %d", m.kbFocus)
	}
}

func TestNarrowLayoutStacksNoteOverList(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = drive(t, m, tea.WindowSizeMsg{Width: 70, Height: 30})
	m = press(t, m, "down", "enter")
	screen := screenText(m)
	if !strings.Contains(screen, "← 목록") || strings.Contains(screen, "검색어 또는") {
		t.Fatalf("narrow note covers the list\n%s", screen)
	}
	m = click(t, m, "back")
	if m.note != nil {
		t.Fatal("back closes the note")
	}
}

// 열린 노트 목록은 검색 API(분당 30회 한도)를 쓰지 않는다. 휴지통은 한 번만 쓴다.
func TestListingAvoidsSearchAPI(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "enter")
	if fake.saw("GET /search/issues") {
		t.Fatalf("open notes must not use the search API: %v", fake.requests)
	}
	fake.mu.Lock()
	fake.requests = nil
	fake.mu.Unlock()
	m = press(t, m, "]")
	searches := 0
	for _, request := range fake.requests {
		if request == "GET /search/issues" {
			searches++
		}
	}
	if searches != 1 || m.state != "closed" {
		t.Fatalf("trash uses one search, got %d", searches)
	}
}
