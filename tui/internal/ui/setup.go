package ui

import (
	"context"
	"fmt"
	"strings"
	"time"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/zidell/ginote/tui/internal/auth"
	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/github"
)

// 워크스페이스 추가 화면. 웹의 저장소 추가(AddWorkspaceDialog.svelte)처럼 저장소 주소와 토큰을
// 받아 GitHub에 연결해 본 뒤 저장한다. 토큰을 비워 두면 `gh auth token`을 쓴다.

const (
	fieldRepo = iota
	fieldName
	fieldToken
	fieldCount
)

type setupForm struct {
	inputs [fieldCount]textinput.Model
	field  int
	busy   bool
	err    string
	// ghLogin은 gh로 로그인돼 있으면 true다. 처음 열 때 한 번 확인한다.
	ghLogin   bool
	ghChecked bool
	bar       actionBar
}

type ghCheckedMsg struct{ available bool }

type setupVerifiedMsg struct {
	workspace config.Workspace
	token     auth.Token
	err       error
}

func newSetupForm() *setupForm {
	form := &setupForm{bar: newActionBar()}
	placeholders := [fieldCount]string{"owner/name 또는 GitHub 주소", "비워 두면 저장소 주소", "github_pat_… (비워 두면 gh 로그인 토큰)"}
	for index := range form.inputs {
		input := textinput.New()
		input.Prompt = ""
		input.Placeholder = placeholders[index]
		input.SetWidth(46)
		form.inputs[index] = input
	}
	form.inputs[fieldToken].EchoMode = textinput.EchoPassword
	form.inputs[fieldToken].EchoCharacter = '•'
	form.inputs[fieldRepo].Focus()
	return form
}

func (m Model) openSetup() (Model, tea.Cmd) {
	m.setup = newSetupForm()
	m.choice = nil
	return m, func() tea.Msg { return ghCheckedMsg{auth.GHToken() != ""} }
}

// closeSetup은 추가 화면을 닫는다. 입력 중이라 미뤄 둔 개발 모드 재시작이 있으면 이제 한다.
func (m Model) closeSetup() (Model, tea.Cmd) {
	m.setup = nil
	if m.restartPending {
		m.restart = "dev"
		m.quitting = true
		return m, tea.Quit
	}
	return m, nil
}

func (f *setupForm) actions(m Model) []modalAction {
	return []modalAction{{id: "connect", label: "연결", primary: true, disabled: f.busy}, {id: "cancel", label: "취소", disabled: len(m.workspaces) == 0}}
}

func (m Model) handleSetupKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	form := m.setup
	if form.busy {
		return m, nil
	}
	key := msg.String()
	if form.bar.focus >= 0 {
		key = keyName(msg)
	}
	if pressed, handled := form.bar.barKey(form.actions(m), key); handled {
		switch pressed {
		case "connect":
			return m.submitSetup()
		case "cancel":
			return m.closeSetup()
		}
		return m, nil
	}
	switch key {
	case "esc":
		if len(m.workspaces) > 0 {
			return m.closeSetup()
		}
		return m, nil
	case "down":
		form.focus(min(fieldCount-1, form.field+1))
		return m, nil
	case "up":
		form.focus(max(0, form.field-1))
		return m, nil
	case "ctrl+o":
		return m, openURL(config.PATCreationURL(form.inputs[fieldRepo].Value()))
	case "enter":
		if form.field < fieldToken {
			form.focus(form.field + 1)
			return m, nil
		}
		return m.submitSetup()
	}
	var cmd tea.Cmd
	form.inputs[form.field], cmd = form.inputs[form.field].Update(msg)
	form.err = ""
	return m, cmd
}

func (f *setupForm) focus(field int) {
	f.inputs[f.field].Blur()
	f.field = field
	f.inputs[field].Focus()
}

func (m Model) submitSetup() (tea.Model, tea.Cmd) {
	form := m.setup
	repo, ok := config.ParseRepo(form.inputs[fieldRepo].Value())
	if !ok {
		form.err = "저장소는 \"owner/name\" 형식이어야 합니다."
		form.focus(fieldRepo)
		return m, nil
	}
	typed := strings.TrimSpace(strings.Map(dropZeroWidth, form.inputs[fieldToken].Value()))
	if typed == "" && form.ghChecked && !form.ghLogin {
		form.err = "토큰을 넣거나, 터미널에서 `gh auth login`을 한 뒤 다시 시도하세요."
		return m, nil
	}
	workspace := config.Workspace{
		ID:          config.NewWorkspaceID(),
		Repo:        repo,
		Name:        strings.TrimSpace(form.inputs[fieldName].Value()),
		Origin:      config.OriginTUI,
		TokenSource: config.TokenKeychain,
	}
	if typed == "" {
		workspace.TokenSource = config.TokenGH
	}
	form.busy = true
	form.err = ""
	return m, func() tea.Msg { return verifyWorkspace(workspace, typed) }
}

// verifyWorkspace는 GitHub에 연결해 보고, 입력한 PAT는 확인이 끝난 뒤에만 저장한다.
func verifyWorkspace(workspace config.Workspace, typed string) tea.Msg {
	token := auth.Token{Value: typed, Source: "TUI에서 입력한 PAT"}
	if typed == "" {
		token = auth.Token{Value: auth.GHToken(), Source: "gh auth token"}
		if token.Value == "" {
			return setupVerifiedMsg{err: auth.ErrNoToken}
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_, fullName, err := github.New(token.Value).VerifyConnection(ctx, workspace.Repo)
	if err != nil {
		return setupVerifiedMsg{err: err}
	}
	if fullName != "" {
		workspace.Repo = fullName
	}
	if typed != "" {
		if err := auth.SavePAT(workspace.ID, typed); err != nil {
			return setupVerifiedMsg{err: fmt.Errorf("토큰을 자격 증명 저장소에 넣지 못했습니다: %w", err)}
		}
	}
	return setupVerifiedMsg{workspace: workspace, token: token}
}

func (m Model) applySetupResult(msg setupVerifiedMsg) (tea.Model, tea.Cmd) {
	if m.setup == nil {
		return m, nil
	}
	if msg.err != nil {
		m.setup.busy = false
		m.setup.err = describeError(msg.err)
		return m, nil
	}
	auth.Use(msg.workspace, msg.token)
	m.workspaces = append(m.workspaces, msg.workspace)
	index := len(m.workspaces) - 1
	m, switchCmd := m.switchWorkspace(index)
	m, closeCmd := m.closeSetup()
	m, toastCmd := m.showToast(msg.workspace.Label() + " 저장소를 연결했습니다.")
	return m, tea.Batch(switchCmd, closeCmd, toastCmd)
}

// removeWorkspace는 TUI에서 추가한 워크스페이스와 그 PAT를 지운다.
func (m Model) removeWorkspace(index int) (tea.Model, tea.Cmd) {
	workspace := m.workspaces[index]
	m.workspaces = append(m.workspaces[:index:index], m.workspaces[index+1:]...)
	cmds := []tea.Cmd{func() tea.Msg { auth.Forget(workspace); return nil }}
	m.choice = nil
	switch {
	case len(m.workspaces) == 0:
		m.active = -1
		m.issues = nil
		m.pinned = nil
		m.note = nil
		m.persist()
		next, cmd := m.openSetup()
		return next, tea.Batch(append(cmds, cmd)...)
	case index == m.active:
		m.active = -1
		next, cmd := m.switchWorkspace(min(index, len(m.workspaces)-1))
		return next, tea.Batch(append(cmds, cmd)...)
	case index < m.active:
		m.active--
	}
	m.persist()
	return m, tea.Batch(cmds...)
}

// persist는 TUI 워크스페이스와 마지막으로 연 워크스페이스를 TUI 설정 파일에 쓴다.
func (m *Model) persist() {
	if m.tuiConfigPath == "" {
		return
	}
	saved := config.TUIConfig{Workspaces: m.workspaces, Voice: m.voiceFileSettings()}
	if m.prefsCustom {
		prefs := m.prefs
		saved.Preferences = &prefs
	}
	if workspace, ok := m.activeWorkspace(); ok {
		saved.ActiveWorkspace = workspace.ID
	}
	if err := config.SaveTUI(m.tuiConfigPath, saved); err != nil {
		m.toast = "설정을 저장하지 못했습니다: " + err.Error()
	}
}

func dropZeroWidth(r rune) rune {
	switch r {
	case '\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF':
		return -1
	}
	return r
}

func (m Model) renderSetup() modalBox {
	c := m.th
	form := m.setup
	width := m.modalWidth(64)
	label := lipgloss.NewStyle().Width(8).Foreground(c.muted)
	active := lipgloss.NewStyle().Width(8).Foreground(c.accentBright).Bold(true)
	labels := [fieldCount]string{"저장소", "이름", "토큰"}
	faint := lipgloss.NewStyle().Foreground(c.faint)

	var content modalContent
	if len(m.workspaces) == 0 {
		for _, line := range wrapText("노트를 둘 GitHub 저장소를 연결하세요. 노트는 그 저장소의 이슈로 저장됩니다.", width) {
			content.add(c.fg(c.muted).Render(line))
		}
		content.add("")
	}
	var cursor *cursorPos
	for index := range form.inputs {
		style := label
		if index == form.field && form.bar.focus < 0 {
			style = active
			if position := form.inputs[index].Cursor(); position != nil {
				cursor = &cursorPos{x: 9 + position.X, y: 3 + len(content.lines)}
			}
		}
		form.inputs[index].SetWidth(width - 10)
		// textinput은 한글 같은 넓은 글자 placeholder를 그릴 때 NUL 문자를 섞어 내보내 테두리가
		// 어긋난다. 화면에 보이지 않는 문자라 지운다.
		view := strings.ReplaceAll(form.inputs[index].View(), "\x00", "")
		content.addRow(seg(style.Render(labels[index])), hit("setup-field:"+itoa(index), fillBackground(" "+view, width-8, c.bgInput)))
		if index < fieldCount-1 {
			content.add("")
		}
	}
	content.add("")
	gh := "gh 로그인 확인 중…"
	if form.ghChecked {
		gh = "gh 로그인 없음 · 토큰을 넣어야 합니다"
		if form.ghLogin {
			gh = "gh 로그인 감지됨 · 토큰을 비워 두면 그 토큰을 씁니다"
		}
	}
	content.add(faint.Render(gh))
	content.add(faint.Render("입력한 토큰은 OS 자격 증명 저장소에만 둡니다."))
	link := lipgloss.NewStyle().Foreground(c.accent).Underline(true).
		Hyperlink(config.PATCreationURL(form.inputs[fieldRepo].Value())).Render("PAT 만들기 화면 열기")
	content.addRow(seg(faint.Render("Ctrl+O ")), hit("setup-pat", link), seg(faint.Render(" (Issues·Contents 쓰기 권한)")))
	switch {
	case form.busy:
		content.add("")
		content.add(lipgloss.NewStyle().Foreground(c.accent).Render("GitHub에 연결하는 중…"))
	case form.err != "":
		content.add("")
		for _, line := range wrapText(form.err, width) {
			content.add(c.fg(c.danger).Render(line))
		}
	}
	box := m.buildModal("저장소 추가", content, width, form.actions(m), form.bar)
	box.cursor = cursor
	return box
}
