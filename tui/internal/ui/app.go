// Package ui는 TUI 화면이다. 웹 앱(src/App.svelte와 src/lib의 컴포넌트)의 구성과 동작을
// 그대로 옮긴다: 왼쪽 사이드바(저장소 전환·설정, 노트/휴지통 탭, 검색, 새 노트, 목록)와
// 오른쪽 노트(툴바·태그·본문·댓글), 그리고 그 위에 뜨는 메뉴·태그 선택·환경설정·도움말.
package ui

import (
	"time"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	uv "github.com/charmbracelet/ultraviolet"
	"github.com/charmbracelet/x/ansi"

	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/devreload"
	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/ime"
	"github.com/zidell/ginote/tui/internal/notes"
	"github.com/zidell/ginote/tui/internal/voice"
)

// inputFocus는 키 입력을 받는 입력칸이다. focusNone이면 목록·노트 단축키가 동작한다
// (웹의 hasNoInteractiveFocus).
type inputFocus int

const topMargin = 1

const (
	focusNone inputFocus = iota
	focusSearch
	focusTitle
	focusBody
	focusComment
)

// Snapshot은 개발 모드 재시작 때 넘기는 화면 상태다. 비밀값은 넣지 않는다.
type Snapshot struct {
	WorkspaceID  string `json:"workspace_id"`
	WorkspaceIdx int    `json:"workspace_index"`
	State        string `json:"state"`
	Query        string `json:"query"`
	KeyboardID   int64  `json:"keyboard_id"`
	OpenNumber   int    `json:"open_number"`
	DetailScroll int    `json:"detail_scroll"`
	HelpTopic    string `json:"help_topic"`
	Settings     bool   `json:"settings"`
	DevStatus    string `json:"dev_status"`
	Notice       string `json:"notice"`
}

type Options struct {
	Workspaces    []config.Workspace
	Active        int
	Preferences   config.Preferences
	Restore       *Snapshot
	TUIConfigPath string
	// TUIPreferences는 TUI 설정 파일에 환경설정이 있었는지다. 없으면 바꿀 때 처음 쓴다.
	TUIPreferences bool
	// DesktopVoice·TUIVoice는 데스크톱 앱과 TUI 설정 파일의 [voice]다(TUI가 우선).
	DesktopVoice *config.VoiceSettings
	TUIVoice     *config.VoiceSettings
	// SidebarWidth는 state.json에 기억한 사이드바 너비다.
	SidebarWidth int
}

type Model struct {
	workspaces    []config.Workspace
	active        int
	prefs         config.Preferences
	prefsCustom   bool // TUI에서 환경설정을 바꿨거나 TUI 설정 파일에 있었다
	tuiConfigPath string

	width, height int
	terminalDark  bool
	th            theme
	hits          *hitMap
	user          string

	// 목록 (App.svelte의 state, query, appliedQuery, activeLabel, issues, pinnedIssues…)
	state           string
	search          textinput.Model
	suggestion      int
	appliedQuery    string
	activeLabel     string
	labels          []github.Label
	pinned          []github.Issue
	issues          []github.Issue
	page            int
	hasMore         bool
	searchAll       []github.Issue // 검색은 한 번에 100개를 받고 화면에는 페이지 크기만큼 보인다
	loading         bool
	loadingMore     bool
	listErr         string
	gen             int
	listScroll      int
	kbFocus         int64 // keyboardFocusedIssueId
	focusListOnLoad bool  // 저장소 전환 뒤 새 목록의 첫 행을 포커스한다
	// tool은 목록 위 도구에 키보드 포커스가 있을 때 그 도구다("tabs", "new"). 검색칸은 focusSearch.
	// 목록 첫 행에서 ↑를 누르면 새 노트 → 검색 → 탭 순서로 올라간다.
	tool      string
	entered   int64 // keyboardEnteredIssueId: Enter로 연 노트. 한 번 더 Enter면 편집
	selected  map[int64]bool
	anchor    int64
	deletions *notes.DeletionQueue[github.Issue]
	pinBusy   bool

	// 노트
	note         *noteState
	focus        inputFocus
	detailScroll int
	lockPin      string
	lockPinUntil time.Time

	// 겹쳐 뜨는 것
	choice   *choiceModal
	picker   *tagPicker
	settings *settingsState
	help     string
	helpBar  actionBar
	setup    *setupForm
	prompt   *promptState
	replace  *replaceState
	voice    *voiceState // 음성 녹음 창

	toast          string
	toastGen       int
	lastClickX     int
	lastClickY     int
	thumbs         *thumbCache // 이미지 첨부 썸네일(thumbs.go)
	kittyGraphics  bool        // 터미널이 Kitty 이미지 프로토콜 쿼리에 응답했다
	lastClickAlt   bool        // Option(Alt)을 누른 채 눌렀다(편집 중 링크 열기)
	devStatus      string
	devError       string
	restart        string // "dev"(새 빌드) 또는 "reload"(전체 새로고침)
	restartPending bool
	quitting       bool  // 끝내는 중. 이때 오는 종료 메시지는 그대로 통과시킨다(main의 QuitFilter)
	imeText        *bool // 입력 소스에 마지막으로 알린 모드(true면 글쓰기)
	blurred        bool  // 창을 떠나 있다. 그동안은 입력 소스를 바꾸지 않는다
	sidebarCols    int   // 경계선을 끌어 정한 사이드바 너비(0이면 화면 너비에 맞춤)
	dragSidebar    bool  // 사이드바 경계선을 끄는 중
	dragText       string
	restore        *Snapshot

	// 음성 녹음(voice_settings.go, voice_recorder.go)
	voiceConfig       voice.Settings // 키를 뺀 설정
	voiceCustom       bool           // TUI 설정 파일에 [voice]를 쓴다
	voiceKey          string
	voiceKeyLoaded    bool
	voicePending      *voiceTarget // 키를 읽은 뒤 열 녹음 창
	voiceHints        string
	voiceHintsRepo    string
	voiceHintsLoading bool
	voiceHintsErr     string
	voiceModels       voice.ModelLists
	voiceModelsBusy   bool
	voiceModelsErr    string
}

type clearToastMsg struct{ gen int }

type tickMsg struct{ at time.Time }

func New(options Options) Model {
	search := textinput.New()
	search.Prompt = ""
	search.Placeholder = "검색어 또는 #태그"
	search.SetVirtualCursor(false)

	m := Model{
		workspaces:    options.Workspaces,
		active:        options.Active,
		prefs:         options.Preferences.Normalize(),
		prefsCustom:   options.TUIPreferences,
		tuiConfigPath: options.TUIConfigPath,
		terminalDark:  true,
		hits:          &hitMap{},
		state:         "open",
		search:        search,
		suggestion:    -1,
		selected:      map[int64]bool{},
		deletions:     newDeletionQueue(),
		restore:       options.Restore,
		helpBar:       newActionBar(),
		thumbs:        newThumbCache(),
		sidebarCols:   options.SidebarWidth,
		voiceConfig:   resolveVoice(options.DesktopVoice, options.TUIVoice),
		voiceCustom:   options.TUIVoice != nil,
		voiceModels:   voice.DefaultModelLists(),
	}
	if m.active < 0 || m.active >= len(m.workspaces) {
		m.active = -1
		if len(m.workspaces) > 0 {
			m.active = 0
		}
	}
	m.th = newTheme(m.dark())
	notes.UsePepper(m.prefs.LockPepper)
	openKeyLog(m.tuiConfigPath)
	m.loading = len(m.workspaces) > 0
	if restore := options.Restore; restore != nil {
		if index := m.workspaceIndex(restore.WorkspaceID, restore.WorkspaceIdx); index >= 0 {
			m.active = index
		}
		if restore.State == "closed" {
			m.state = "closed"
		}
		m.search.SetValue(restore.Query)
		m.appliedQuery = restore.Query
		m.kbFocus = restore.KeyboardID
		m.help = restore.HelpTopic
		m.devStatus = restore.DevStatus
		m.toast = restore.Notice
	}
	return m
}

func (m Model) dark() bool {
	switch m.prefs.Theme {
	case config.ThemeDark:
		return true
	case config.ThemeLight:
		return false
	}
	return m.terminalDark
}

func (m Model) workspaceIndex(id string, fallback int) int {
	for index, workspace := range m.workspaces {
		if id != "" && workspace.ID == id {
			return index
		}
	}
	if id == "" && fallback >= 0 && fallback < len(m.workspaces) {
		return fallback
	}
	return -1
}

func (m Model) activeWorkspace() (config.Workspace, bool) {
	if m.active < 0 || m.active >= len(m.workspaces) {
		return config.Workspace{}, false
	}
	return m.workspaces[m.active], true
}

func (m Model) Init() tea.Cmd {
	// 2031: 터미널이 다크·라이트가 바뀔 때만 알려 준다(알림을 받으면 배경색을 다시 묻는다).
	cmds := []tea.Cmd{tea.RequestBackgroundColor, tea.Raw(ansi.SetModeLightDark), devreload.Watch(), tickEvery(), queryKittyGraphics()}
	if len(m.workspaces) == 0 {
		cmds = append(cmds, func() tea.Msg { return openSetupMsg{} })
	} else {
		cmds = append(cmds, m.loadList(false), m.loadLabels(), m.loadUser())
	}
	return tea.Batch(cmds...)
}

// saveSidebarWidth는 사용자가 끌어 조절한 사이드바 너비를 기억한다.
func (m Model) saveSidebarWidth() tea.Cmd {
	if m.tuiConfigPath == "" || m.sidebarCols <= 0 {
		return nil
	}
	path, state := config.StatePath(m.tuiConfigPath), config.State{SidebarWidth: m.sidebarCols}
	return func() tea.Msg {
		config.SaveState(path, state)
		return nil
	}
}

// tickEvery는 삭제 유예·잠금 세션 만료처럼 시간이 지나야 하는 일을 1초마다 확인한다.
func tickEvery() tea.Cmd {
	return tea.Tick(time.Second, func(at time.Time) tea.Msg { return tickMsg{at} })
}

// openSetupMsg는 워크스페이스가 하나도 없을 때 시작하자마자 추가 화면을 연다.
type openSetupMsg struct{}

// QuitRequestMsg는 바깥에서 끝내라고 할 때(SIGTERM) 보낸다. 저장하지 않은
// 노트를 저장한 뒤 끝낸다.
type QuitRequestMsg struct{}

// QuitFilter는 tea.WithFilter에 넣는다. 신호로 온 종료(tea.QuitMsg)를 QuitRequestMsg로 바꿔
// 저장할 기회를 주고, 앱이 스스로 끝낼 때의 종료는 그대로 통과시킨다.
func QuitFilter(model tea.Model, msg tea.Msg) tea.Msg {
	if _, ok := msg.(tea.QuitMsg); ok {
		if m, isModel := model.(Model); isModel && !m.quitting {
			return QuitRequestMsg{}
		}
	}
	return msg
}

// Restart는 다시 시작해야 하면 그 까닭("dev", "reload")이다.
func (m Model) Restart() string { return m.restart }

func (m Model) Snapshot() Snapshot {
	snapshot := Snapshot{
		WorkspaceIdx: m.active,
		State:        m.state,
		Query:        m.appliedQuery,
		KeyboardID:   m.kbFocus,
		DetailScroll: m.detailScroll,
		HelpTopic:    m.help,
		Settings:     m.settings != nil,
	}
	switch m.restart {
	case "dev":
		snapshot.DevStatus = "다시 빌드해 적용함 · " + time.Now().Format("15:04:05")
	case "reload":
		snapshot.DevStatus = m.devStatus
		snapshot.Notice = "새로고침했습니다."
	}
	if workspace, ok := m.activeWorkspace(); ok {
		snapshot.WorkspaceID = workspace.ID
	}
	if m.note != nil && m.note.number() != 0 {
		snapshot.OpenNumber = m.note.number()
	}
	return snapshot
}

func (m Model) showToast(text string) (Model, tea.Cmd) {
	m.toast = text
	m.toastGen++
	gen := m.toastGen
	return m, tea.Tick(3*time.Second, func(time.Time) tea.Msg { return clearToastMsg{gen} })
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	next, cmd := m.update(fromScreen(msg))
	model := next.(Model)
	model.syncInputSource()
	return model, cmd
}

func fromScreen(msg tea.Msg) tea.Msg {
	switch event := msg.(type) {
	case tea.MouseClickMsg:
		event.Y -= topMargin
		return event
	case tea.MouseMotionMsg:
		event.Y -= topMargin
		return event
	case tea.MouseReleaseMsg:
		event.Y -= topMargin
		return event
	case tea.MouseWheelMsg:
		event.Y -= topMargin
		return event
	}
	return msg
}

func (m Model) wantsText() bool {
	pinPrompt := m.prompt != nil && (m.prompt.kind == "lock" || m.prompt.kind == "unlock")
	return m.setup != nil || (m.prompt != nil && !m.prompt.confirm && !pinPrompt) || m.replace != nil ||
		(m.picker != nil && m.picker.cursor < 0 && m.picker.bar.focus < 0) ||
		(m.choice == nil && m.focus != focusNone) || m.settingsTyping()
}

func (m *Model) syncInputSource() {
	if m.blurred {
		return
	}
	want := m.wantsText() || m.prefs.KeepInputSource
	if m.imeText != nil && *m.imeText == want {
		return
	}
	m.imeText = &want
	ime.Want(want)
}

func (m *Model) recheckInputSource() {
	want := m.wantsText() || m.prefs.KeepInputSource
	m.imeText = &want
	ime.Recheck(want)
}

func (m Model) update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if visible, cmd, ok := devreload.Handle(msg); ok {
		if _, building := visible.(devreload.BuildingMsg); building {
			m.devStatus = "변경 감지 · 빌드 중…"
			m.devError = ""
		}
		return m, cmd
	}

	switch msg := msg.(type) {
	case devreload.FailedMsg:
		m.devStatus = "빌드 실패 · 고치면 다시 빌드함"
		m.devError = firstLine(msg.Output)
		return m, devreload.Watch()
	case devreload.ReadyMsg:
		if m.isTyping() {
			// 입력하던 내용을 날리지 않도록 입력을 마칠 때 다시 시작한다.
			m.restartPending = true
			m.devStatus = "새 빌드 준비됨 · 입력을 마치면 적용"
			return m, devreload.Watch()
		}
		return m.quitForRestart()

	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, max(1, msg.Height-topMargin)
		m.layoutNote()
		return m, nil
	case tea.BackgroundColorMsg:
		m.terminalDark = msg.IsDark()
		m.th = newTheme(m.dark())
		m.layoutNote()
		return m, nil
	case uv.DarkColorSchemeEvent, uv.LightColorSchemeEvent:
		return m, tea.RequestBackgroundColor
	case uv.KittyGraphicsEvent:
		if msg.Options.ID == kittyQueryID && string(msg.Payload) == "OK" && !m.kittyGraphics {
			m.kittyGraphics = true
			return m, m.uploadCachedThumbnails()
		}
		return m, nil
	case clearToastMsg:
		if msg.gen == m.toastGen {
			m.toast = ""
		}
		return m, nil
	case clipboardResultMsg:
		if msg.err != nil {
			return m.showToast("클립보드에 복사하지 못했습니다: " + msg.err.Error())
		}
		return m.showToast(msg.success)
	case tickMsg:
		return m.onTick(msg.at)

	case QuitRequestMsg:
		return m.quit()
	case openSetupMsg:
		if m.setup == nil {
			return m.openSetup()
		}
		return m, nil
	case ghCheckedMsg:
		if m.setup != nil {
			m.setup.ghChecked = true
			m.setup.ghLogin = msg.available
		}
		return m, nil
	case setupVerifiedMsg:
		return m.applySetupResult(msg)

	case tea.FocusMsg:
		// 창으로 돌아오면 입력 소스를 다시 맞춘다.
		closeQuickLook()
		m.blurred = false
		m.recheckInputSource()
		return m, nil
	case tea.BlurMsg:
		// 창을 떠나면 바꿔 둔 입력 소스를 되돌려 다른 창에서는 쓰던 한글을 그대로 쓴다.
		m.blurred = true
		m.imeText = nil
		ime.Release()
		return m, nil
	case tea.KeyPressMsg:
		return m.handleKey(msg)
	case tea.PasteMsg:
		return m.handlePaste(msg)
	case tea.MouseClickMsg:
		return m.handleClick(msg)
	case tea.MouseWheelMsg:
		return m.handleWheel(msg)
	case tea.MouseMotionMsg:
		if m.dragSidebar {
			m.sidebarCols = m.clampSidebar(msg.Mouse().X)
			m.layoutNote()
		}
		if m.dragText != "" {
			m = m.extendTextDrag(msg)
		}
		return m, nil
	case tea.MouseReleaseMsg:
		if m.dragSidebar {
			m.dragSidebar = false
			return m, m.saveSidebarWidth()
		}
		if m.dragText != "" {
			return m.endTextDrag()
		}
		return m, nil
	}
	if next, cmd, ok := m.handleVoiceMsg(msg); ok {
		return next, cmd
	}
	switch msg := msg.(type) {
	case filesPickedMsg:
		return m.applyFilesPicked(msg)
	case voiceKeyMsg:
		return m.applyVoiceKey(msg)
	case voiceHintsMsg:
		return m.applyVoiceHints(msg)
	case voiceHintsSavedMsg:
		return m.applyVoiceHintsSaved(msg)
	case voiceModelsMsg:
		return m.applyVoiceModels(msg)
	}
	return m.handleData(msg)
}

// isTyping은 사용자가 입력칸에 글을 쓰는 중인지다. 개발 모드 재시작을 미룰 때 쓴다.
func (m Model) isTyping() bool {
	return m.setup != nil || m.prompt != nil || m.replace != nil ||
		m.focus == focusBody || m.focus == focusTitle || m.focus == focusComment ||
		(m.note != nil && m.note.dirty)
}

func (m Model) quitForRestart() (tea.Model, tea.Cmd) {
	m.restart = "dev"
	m.quitting = true
	return m, tea.Quit
}

// hardReload는 전체 새로고침이다(웹의 R·Ctrl/Cmd+R = location.reload). 저장하지 않은 노트를
// 먼저 저장하고, 설정 파일·토큰·목록을 처음부터 다시 읽도록 프로그램을 다시 시작한다.
// 화면 상태(저장소·탭·검색어·연 노트)는 넘긴다.
func (m Model) hardReload() (tea.Model, tea.Cmd) {
	m.restart = "reload"
	next, cmd := m.quit()
	model := next.(Model)
	model.restart = "reload"
	return model, cmd
}

// afterTyping은 입력을 마친 뒤 미뤄 둔 개발 모드 재시작을 한다.
func (m Model) afterTyping() (Model, tea.Cmd) {
	if m.restartPending && !m.isTyping() {
		m.restart = "dev"
		m.quitting = true
		return m, tea.Quit
	}
	return m, nil
}

func (m Model) onTick(now time.Time) (tea.Model, tea.Cmd) {
	cmds := []tea.Cmd{tickEvery()}
	if !m.lockPinUntil.IsZero() && now.After(m.lockPinUntil) {
		m.lockPin = ""
		m.lockPinUntil = time.Time{}
		if m.note != nil {
			m.note.relock()
			m.layoutNote()
		}
	}
	for _, entry := range m.deletions.Expired(now) {
		cmds = append(cmds, m.moveIssuesNow(entry.Items, entry.NextState, entry.ID))
	}
	return m, tea.Batch(cmds...)
}

func firstLine(text string) string {
	for _, line := range splitLines(text) {
		if line != "" && line[0] != '#' {
			return line
		}
	}
	return text
}

// orderedIssues는 화면 순서(고정 노트 먼저)의 목록이다.
func (m Model) orderedIssues() []github.Issue {
	ordered := make([]github.Issue, 0, len(m.pinned)+len(m.issues))
	ordered = append(ordered, m.pinned...)
	return append(ordered, m.issues...)
}

func (m Model) issueByID(id int64) (github.Issue, bool) {
	for _, issue := range m.orderedIssues() {
		if issue.ID == id {
			return issue, true
		}
	}
	return github.Issue{}, false
}

func (m Model) indexOfID(id int64) int {
	for index, issue := range m.orderedIssues() {
		if issue.ID == id {
			return index
		}
	}
	return -1
}

func (m Model) isPinned(issue github.Issue) bool {
	for _, item := range m.pinned {
		if item.ID == issue.ID {
			return true
		}
	}
	for _, name := range issue.LabelNames() {
		if notes.IsPinLabel(name) {
			return true
		}
	}
	return false
}

func (m Model) selectionMode() bool { return len(m.selected) > 0 }

func (m Model) selectedIssues() []github.Issue {
	var issues []github.Issue
	for _, issue := range m.orderedIssues() {
		if m.selected[issue.ID] {
			issues = append(issues, issue)
		}
	}
	return issues
}
