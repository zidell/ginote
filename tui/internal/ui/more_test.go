package ui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/devreload"
)

// 첨부 목록을 받으면 관리 블록을 그 목록으로 다시 만든다. 본문에 직접 링크한 파일은 블록에
// 넣지 않고, 링크가 없는 파일(고아 첨부)은 블록에 넣는다(reconcileIssueAttachments).
func TestAttachmentsReconcileIntoManagedBlock(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	uuid := "0f8fad5b-d9cb-469f-a165-70867728950e-"
	fake.files = map[string][]string{".issue-note-assets/issues/3": {uuid + "a-photo.png", uuid + "plan.pdf"}}
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "down", "enter")
	if len(m.note.attachments) != 2 || m.note.attachments[1].Name != "plan.pdf" {
		t.Fatalf("attachments = %+v", m.note.attachments)
	}
	if !strings.Contains(screenText(m), "plan.pdf") {
		t.Error("attachments are listed above the body")
	}
	m = press(t, m, "s")
	body := fake.issue(3)["body"].(string)
	want := "<!-- ginote:attachments:start -->\n\n![](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/" + uuid + "a-photo.png)\n\n[](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/" + uuid + "plan.pdf)\n\n<!-- ginote:attachments:end -->\n\n여행 계획\n\n교토"
	if body != want {
		t.Fatalf("body =\n%s\nwant\n%s", body, want)
	}
}

func TestMergeCombinesSelectedNotes(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	fake.files = map[string][]string{} // 첨부 브랜치가 있는 저장소
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "space", "shift+down")
	m = click(t, m, "sel:merge")
	if fake.issue(2)["state"] != "closed" || fake.issue(3)["state"] != "closed" {
		t.Fatalf("sources stay open: %v %v", fake.issue(2)["state"], fake.issue(3)["state"])
	}
	var merged map[string]any
	for _, issue := range fake.issues {
		if issue["number"].(int) > 200 {
			merged = issue
		}
	}
	if merged == nil || !strings.Contains(merged["body"].(string), "- 우유") || !strings.Contains(merged["body"].(string), "교토") {
		t.Fatalf("merged = %v", merged)
	}
	if len(m.selected) != 0 {
		t.Fatal("merge clears the selection")
	}
}

func TestReplacePanel(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter", "x")
	if m.replace == nil {
		t.Fatal("X opens the replace panel")
	}
	m = typeText(t, m, "/우(유)/")
	m = press(t, m, "down")
	m = typeText(t, m, "두$1")
	if !strings.Contains(screenText(m), "1개 일치") || !strings.Contains(screenText(m), "“우유” → “두유”") {
		t.Fatalf("analysis\n%s", screenText(m))
	}
	m = press(t, m, "enter")
	if m.replace != nil || !strings.Contains(m.note.body.Value(), "- 두유") {
		t.Fatalf("body = %q", m.note.body.Value())
	}
}

func TestMarkdownViewerToggles(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter", "m")
	if !m.note.preview || !strings.Contains(screenText(m), "닫기") {
		t.Fatal("M opens the viewer")
	}
	m = press(t, m, "esc")
	if m.note == nil || m.note.preview {
		t.Fatal("esc closes the viewer first")
	}
}

func TestSeparateTitleMode(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	prefs := config.DefaultPreferences()
	prefs.TitleMode = config.TitleSeparate
	m := New(Options{Workspaces: []config.Workspace{{ID: "w1", Repo: "o/notes", Origin: config.OriginApp}}, Preferences: prefs, TUIConfigPath: t.TempDir() + "/tui.toml"})
	m = drive(t, m, tea.WindowSizeMsg{Width: 140, Height: 40})
	m = runCmd(t, m, m.Init())
	m = press(t, m, "down", "down", "enter", "enter")
	if m.focus != focusBody {
		t.Fatalf("focus = %v", m.focus)
	}
	m = click(t, m, "title")
	m.note.title.CursorEnd()
	m = typeText(t, m, "!")
	m = press(t, m, "ctrl+s")
	if fake.issue(2)["title"] != "장보기!" {
		t.Fatalf("title = %v", fake.issue(2)["title"])
	}
}

func TestSetupAddsWorkspaceWithPastedToken(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := New(Options{TUIConfigPath: t.TempDir() + "/tui.toml"})
	m = drive(t, m, tea.WindowSizeMsg{Width: 140, Height: 40})
	m = drive(t, m, openSetupMsg{})
	if m.setup == nil || !strings.Contains(screenText(m), "저장소 추가") {
		t.Fatal("setup opens without workspaces")
	}
	m = drive(t, m, tea.PasteMsg{Content: " https://github.com/o/notes \n"})
	if got := m.setup.inputs[fieldRepo].Value(); got != "https://github.com/o/notes" {
		t.Fatalf("pasted repo = %q", got)
	}
	m = drive(t, m, setupVerifiedMsg{workspace: config.Workspace{ID: "tui-1", Repo: "o/notes", Origin: config.OriginTUI, TokenSource: config.TokenGH}})
	if m.setup != nil || len(m.workspaces) != 1 || m.active != 0 || len(m.orderedIssues()) == 0 {
		t.Fatalf("workspaces = %+v issues = %d", m.workspaces, len(m.orderedIssues()))
	}
	saved, err := config.LoadTUI(m.tuiConfigPath)
	if err != nil || len(saved.Workspaces) != 1 || saved.ActiveWorkspace != "tui-1" {
		t.Fatalf("saved = %+v err = %v", saved, err)
	}
}

func TestDevRestartWaitsWhileTyping(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "enter", "enter")
	next, _ := m.Update(devreload.ReadyMsg{})
	m = next.(Model)
	if m.restart != "" || !m.restartPending {
		t.Fatal("restart waits while the editor has focus")
	}
	next, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	m = next.(Model)
	if m.restart != "dev" || cmd == nil {
		t.Fatal("leaving the editor applies the restart")
	}
}

func TestWorkspaceSwitchByNumberAndSwitcher(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := New(Options{Workspaces: []config.Workspace{
		{ID: "w1", Repo: "o/notes", Origin: config.OriginApp},
		{ID: "w2", Repo: "o/notes", Name: "둘째", Origin: config.OriginApp},
	}, Preferences: config.DefaultPreferences(), TUIConfigPath: t.TempDir() + "/tui.toml"})
	m = drive(t, m, tea.WindowSizeMsg{Width: 140, Height: 40})
	m = runCmd(t, m, m.Init())
	m = press(t, m, "2")
	if m.active != 1 || !strings.Contains(screenText(m), "둘째") {
		t.Fatal("2 switches workspace")
	}
	m = press(t, m, "`")
	m = click(t, m, "choice:0")
	if m.active != 0 || m.choice != nil {
		t.Fatal("clicking a workspace switches")
	}
}

func TestSidebarDragRemembersWidth(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m.View()
	m = drive(t, m, tea.MouseClickMsg{X: m.sidebarWidth(), Y: topMargin + 5, Button: tea.MouseLeft})
	m = drive(t, m, tea.MouseMotionMsg{X: 55, Y: topMargin + 5, Button: tea.MouseLeft})
	m = drive(t, m, tea.MouseReleaseMsg{X: 55, Y: topMargin + 5, Button: tea.MouseLeft})
	if got := config.LoadState(config.StatePath(m.tuiConfigPath)).SidebarWidth; got != m.sidebarCols || got <= 0 {
		t.Fatalf("saved sidebar width = %d, screen = %d", got, m.sidebarCols)
	}
}

func TestHelpTopicsOpenFromLinks(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	for _, topic := range []string{"security", "mcp", "app", "keyboard"} {
		m = click(t, m, "help:"+topic)
		if m.help != topic || !strings.Contains(screenText(m), helpTitles[topic]) {
			t.Fatalf("help %s", topic)
		}
		m = press(t, m, "esc")
	}
}

func TestArrowUpFromListReachesNewNoteSearchAndTabs(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "up")
	if m.tool != "new" || m.kbFocus != 0 {
		t.Fatalf("up from the first row focuses the new note button: tool = %q", m.tool)
	}
	m = press(t, m, "right")
	if m.tool != "voice" {
		t.Fatal("right moves to the voice button")
	}
	m = press(t, m, "left")
	if m.tool != "new" {
		t.Fatal("left returns to new note")
	}
	if !strings.Contains(screenText(m), "+ 새 노트 N") {
		t.Error("the new note button keeps its N hint while focused")
	}
	m = press(t, m, "up")
	if m.focus != focusSearch {
		t.Fatal("then the search field")
	}
	m = press(t, m, "up")
	if m.tool != "tabs" || m.focus != focusNone {
		t.Fatal("then the tabs")
	}
	m = press(t, m, "up")
	if m.tool != "ws" {
		t.Fatal("up from the tabs reaches the workspace switcher")
	}
	m = press(t, m, "right")
	if m.tool != "settings" {
		t.Fatal("right moves to the settings button")
	}
	m = press(t, m, "enter")
	if m.settings == nil {
		t.Fatal("enter opens the settings")
	}
	m = press(t, m, "esc", "left", "enter")
	if m.choice == nil {
		t.Fatal("enter on the switcher opens it")
	}
	m = press(t, m, "esc", "down")
	if m.tool != "tabs" {
		t.Fatalf("down returns to the tabs: tool = %q", m.tool)
	}
	m = press(t, m, "right")
	if m.state != "closed" || m.tool != "tabs" {
		t.Fatal("right switches to the trash tab")
	}
	m = press(t, m, "left", "down", "down")
	if m.state != "open" || m.tool != "new" {
		t.Fatalf("down goes back through search to new note: tool = %q", m.tool)
	}
	m = press(t, m, "down")
	if m.tool != "" || m.kbFocus != 1001 {
		t.Fatalf("down from new note lands on the first row: kb = %d", m.kbFocus)
	}
	m = press(t, m, "up", "enter")
	if m.note == nil || m.note.pending || m.focus != focusBody {
		t.Fatal("Enter on the new note button makes a note")
	}
}

func TestDownFromNewNoteFollowsVisiblePinnedThenRegularOrder(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter") // #2를 열어 둔 채 목록을 이동한다.
	m = press(t, m, "up", "up")
	if m.tool != "new" || m.kbFocus != 0 {
		t.Fatalf("up reaches the new note button: tool=%q row=%d", m.tool, m.kbFocus)
	}
	m = press(t, m, "down")
	if m.tool != "" || m.kbFocus != 1001 {
		t.Fatalf("first down should reach pinned #1: tool=%q row=%d", m.tool, m.kbFocus)
	}
	m = press(t, m, "down")
	if m.kbFocus != 1002 {
		t.Fatalf("second down should reach open #2: row=%d", m.kbFocus)
	}
	m = press(t, m, "down")
	if m.kbFocus != 1003 {
		t.Fatalf("third down should reach #3: row=%d", m.kbFocus)
	}
	m = press(t, m, "up", "up")
	if m.kbFocus != 1001 || m.tool != "" {
		t.Fatalf("up retraces visible rows: tool=%q row=%d", m.tool, m.kbFocus)
	}
	m = press(t, m, "up")
	if m.tool != "new" || m.kbFocus != 0 {
		t.Fatalf("up from pinned row reaches new note: tool=%q row=%d", m.tool, m.kbFocus)
	}
}

func TestReloadRestartsWithSnapshot(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "enter")
	for _, keyPress := range []tea.KeyPressMsg{{Code: 'r', Mod: tea.ModCtrl}, {Code: 'r', Mod: tea.ModSuper}, {Code: 'r', Text: "r"}} {
		next, cmd := m.Update(keyPress)
		model := next.(Model)
		if model.Restart() != "reload" || cmd == nil {
			t.Fatalf("%v: restart = %q", keyPress, model.Restart())
		}
		snapshot := model.Snapshot()
		if snapshot.OpenNumber != 1 || snapshot.Notice == "" {
			t.Fatalf("snapshot = %+v", snapshot)
		}
	}
}

func TestBaseCodeMapsAnyKoreanLayout(t *testing.T) {
	// 세벌식 등 어떤 자판이든 터미널이 물리 키(BaseCode)를 주면 그 키로 본다.
	if got := keyName(tea.KeyPressMsg{Code: 'ㄱ', Text: "ㄱ", BaseCode: 'j'}); got != "j" {
		t.Fatalf("keyName = %q", got)
	}
}

func TestSettingsSheetManagesTagsAndPreferences(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, ",")
	for _, want := range []string{"저장소 관리", "태그 관리", "편집기 설정", "자동 저장 지연"} {
		if !strings.Contains(screenText(m), want) {
			t.Errorf("settings lack %q", want)
		}
	}
	m = click(t, m, "set:tag-new")
	m = typeText(t, m, "여행: 놀러 간 기록")
	m = click(t, m, "set:tag-add")
	if len(m.settings.draft.tagOps) != 1 || m.settings.draft.tagOps[0].name != "여행" {
		t.Fatalf("draft tags = %+v", m.settings.draft.tagOps)
	}
	if len(fake.labels) != 2 {
		t.Fatal("changes must wait for confirmation")
	}
	m.settings.focus = "theme"
	m.View()
	m = click(t, m, "set:theme")
	if m.choice == nil {
		t.Fatal("theme selector does not open")
	}
	m = click(t, m, "choice:2")
	if m.settings.draft.prefs.Theme != config.ThemeLight {
		t.Fatal("theme draft was not changed")
	}
	m = click(t, m, "act:apply")
	if m.settings != nil || m.prefs.Theme != config.ThemeLight || len(fake.labels) != 3 || fake.labels[2]["name"] != "여행" {
		t.Fatalf("settings were not applied: theme=%q labels=%v", m.prefs.Theme, fake.labels)
	}
}

// 모달은 겹쳐 뜨고, 아래는 어둡게 보이며, Esc는 맨 위 것만 닫는다.
func TestModalsStackDimAndCloseFromTheTop(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	plain, _ := m.render()
	if strings.Contains(plain, "\x1b[2m") {
		t.Fatal("nothing is dimmed without a modal")
	}
	m = press(t, m, ",")
	m = click(t, m, "set:ws-add")
	if m.setup == nil || m.settings == nil {
		t.Fatal("adding a workspace opens over the settings")
	}
	stacked, _ := m.render()
	if !strings.Contains(stacked, "\x1b[2m") {
		t.Fatal("the screen under a modal is dimmed")
	}
	m = press(t, m, "esc")
	if m.setup != nil || m.settings == nil {
		t.Fatal("esc closes only the top modal")
	}
	m = click(t, m, "set:tag-del:work")
	if len(m.settings.draft.tagOps) != 1 || m.prompt != nil {
		t.Fatal("tag removal stays in the settings draft")
	}
	m = press(t, m, "esc")
	if m.prompt == nil || m.settings == nil {
		t.Fatal("discard confirmation opens over settings")
	}
	m = press(t, m, "esc")
	if m.prompt != nil || m.settings == nil {
		t.Fatal("esc closes only discard confirmation")
	}
}

// 휠로 내린 환경설정은 포커스 자리로 되돌아가지 않아 아래쪽 음성 녹음 설정까지 보인다.
func TestSettingsWheelReachesVoiceSection(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, ",")
	m.View()
	for range 20 {
		m = drive(t, m, tea.MouseWheelMsg{X: 70, Y: 20, Button: tea.MouseWheelDown})
	}
	if screen := screenText(m); !strings.Contains(screen, "자주 쓰는 전사 단어") {
		t.Fatalf("wheel scrolls to the voice settings\n%s", screen)
	}
}
