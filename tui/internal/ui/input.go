package ui

import (
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	tea "charm.land/bubbletea/v2"
)

// handleKey는 App.svelte의 handleGlobalKeydown과 NoteEditor.svelte의 노트 단축키를 따른다.
// 위에 뜬 것(설정·도움말·메뉴…)이 먼저 키를 받고, 입력칸에 포커스가 있으면 그 칸이 받는다.
func (m Model) handleKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	key := keyName(msg)
	switch msg.String() {
	case "super+c", "meta+c", "ctrl+shift+c":
		return m.copySelection(m.focusedArea())
	case "ctrl+c":
		if area := m.focusedArea(); area != nil && area.HasSelection() {
			return m.copySelection(area)
		}
		return m.quit()
	case "ctrl+r", "super+r", "meta+r":
		// 전체 새로고침은 어디서든 된다(웹의 Ctrl/Cmd+R).
		if m.setup == nil {
			return m.hardReload()
		}
	}
	// 한글 입력 상태로 단축키를 누르면(다른 창에서 한글로 바꾸고 돌아온 경우 등) 입력 소스를
	// 다시 확인해 영문 자판으로 돌린다. 이번 키는 keyName이 같은 자리의 영문 키로 읽는다.
	if msg.Text != "" && msg.Text[0] >= 0x80 && !m.wantsText() {
		m.recheckInputSource()
	}
	// 모달은 맨 위 것이 키를 받는다(겹치는 순서는 view.go의 renderModals와 같다).
	switch {
	case m.setup != nil:
		return m.handleSetupKey(msg)
	case m.prompt != nil:
		return m.handlePromptKey(msg)
	case m.voice != nil:
		return m.handleVoiceKey(msg)
	case m.replace != nil:
		return m.handleReplaceKey(msg)
	case m.picker != nil:
		return m.handlePickerKey(msg)
	case m.choice != nil:
		return m.handleChoiceKey(msg)
	case m.settings != nil:
		return m.handleSettingsKey(msg)
	case m.help != "":
		return m.handleHelpKey(key)
	}

	switch m.focus {
	case focusSearch:
		return m.handleSearchKey(msg)
	case focusBody, focusTitle, focusComment:
		return m.handleEditorKey(msg)
	}
	return m.handleShortcut(msg, key)
}

// quit은 저장하지 않은 노트를 저장한 뒤 끝낸다.
func (m Model) quit() (tea.Model, tea.Cmd) {
	m.quitting = true
	if m.note != nil && m.note.dirty && !m.note.saving {
		next, cmd := m.saveNote(true)
		if cmd != nil {
			return next, tea.Sequence(cmd, tea.Quit)
		}
	}
	if cmd := m.saveDirtyComments(); cmd != nil {
		return m, tea.Sequence(cmd, tea.Quit)
	}
	return m, tea.Quit
}

// handleToolKey는 목록 위 도구(탭·새 노트)에 키보드 포커스가 있을 때의 이동 키다.
// 처리했으면 true다. 그 밖의 키는 포커스를 목록으로 돌리고 평소 단축키로 넘긴다.
func (m Model) handleToolKey(key string) (Model, tea.Cmd, bool) {
	switch m.tool {
	case "tabs":
		switch key {
		case "left", "h", "right", "l":
			state := "open"
			if key == "right" || key == "l" {
				state = "closed"
			}
			next, cmd := m.changeState(state)
			next.tool = "tabs"
			return next, cmd, true
		case "enter", "space":
			state := "closed"
			if m.state == "closed" {
				state = "open"
			}
			next, cmd := m.changeState(state)
			next.tool = "tabs"
			return next, cmd, true
		case "down", "j":
			m.tool = ""
			return m.focusSearch(), nil, true
		case "up", "k":
			m.tool = "ws"
			return m, nil, true
		case "esc":
			m.tool = ""
			return m, nil, true
		}
	case "ws", "settings":
		// 맨 위 줄: 저장소 선택기와 설정 버튼. ←/→로 오가고 Enter로 연다.
		switch key {
		case "left", "h":
			m.tool = "ws"
			return m, nil, true
		case "right", "l":
			m.tool = "settings"
			return m, nil, true
		case "enter", "space":
			if m.tool == "ws" {
				m.choice = m.switcherChoice()
				return m, nil, true
			}
			next, cmd := m.openSettings()
			return next, cmd, true
		case "down", "j":
			m.tool = "tabs"
			return m, nil, true
		case "up", "k":
			return m, nil, true
		case "esc":
			m.tool = ""
			return m, nil, true
		}
	case "new", "voice":
		switch key {
		case "right", "l":
			m.tool = "voice"
			return m, nil, true
		case "left", "h":
			m.tool = "new"
			return m, nil, true
		case "enter", "space":
			if m.tool == "voice" {
				next, cmd := m.openVoice(voiceTarget{kind: "new"})
				return next, cmd, true
			}
			m.tool = ""
			next, cmd := m.newNote("")
			return next, cmd, true
		case "up", "k":
			m.tool = ""
			return m.focusSearch(), nil, true
		case "down", "j":
			m.tool = ""
			// 새 노트 버튼 바로 아래는 화면의 첫 행이다. 열려 있는 노트를 기준으로
			// 이동하면 고정 노트나 그 다음 행을 건너뛸 수 있다.
			if issues := m.orderedIssues(); len(issues) > 0 {
				m.kbFocus = issues[0].ID
				m.entered = 0
				m.scrollListTo(m.kbFocus)
			}
			return m, nil, true
		case "esc":
			m.tool = ""
			return m, nil, true
		}
	}
	m.tool = ""
	return m, nil, false
}

// handleShortcut은 입력칸에 포커스가 없을 때의 단축키다.
func (m Model) handleShortcut(msg tea.KeyPressMsg, key string) (tea.Model, tea.Cmd) {
	selection := m.selectionMode()
	if m.tool != "" {
		next, cmd, handled := m.handleToolKey(key)
		if handled {
			return next, cmd
		}
		m = next
	}

	switch key {
	case "esc":
		// 삭제 유예는 Esc로 가장 최근 것부터 되돌린다.
		if m.cancelLatestDeletion() {
			return m, nil
		}
		if selection {
			m.clearSelection()
			return m, nil
		}
		if m.note != nil && m.note.preview {
			m.note.preview = false
			m.layoutNote()
			return m, nil
		}
		if m.note != nil {
			next, cmd := m.closeNote()
			next.entered = 0
			return next, cmd
		}
		if m.appliedQuery != "" {
			m.search.SetValue("")
			return m.submitSearch()
		}
		return m, nil
	case "shift+up", "shift+down", "K", "J":
		direction := 1
		if key == "shift+up" || key == "K" {
			direction = -1
		}
		if m.kbFocus == 0 {
			m.moveKeyboardFocus(direction)
			return m, nil
		}
		m.extendSelection(direction)
		return m, m.previewSelected()
	case "up", "k", "down", "j":
		direction := 1
		if key == "up" || key == "k" {
			direction = -1
		}
		m.moveKeyboardFocus(direction)
		return m, nil
	case "space":
		issue, ok := m.issueByID(m.kbFocus)
		if !ok {
			return m, nil
		}
		m.toggleSelection(issue.ID, false)
		return m, m.previewSelected()
	case "enter":
		if selection {
			if issue, ok := m.issueByID(m.kbFocus); ok {
				m.toggleSelection(issue.ID, false)
				return m, m.previewSelected()
			}
			return m, nil
		}
		// 목록 커서의 노트를 열고, 이미 그 노트를 Enter로 열었으면 편집으로 들어간다.
		if m.note != nil && m.note.lock == lockLocked && (m.kbFocus == 0 || m.kbFocus == m.note.issue.ID) {
			return m.requestLock()
		}
		if m.kbFocus != 0 {
			if m.entered == m.kbFocus && m.note != nil && m.note.issue.ID == m.kbFocus {
				return m.focusEditor(), nil
			}
			if issue, ok := m.issueByID(m.kbFocus); ok {
				m.entered = issue.ID
				return m.openNote(issue, false)
			}
		}
		if m.note != nil {
			return m.focusEditor(), nil
		}
		return m, nil
	case "tab":
		if m.note != nil && !selection {
			if m.note.lock == lockLocked {
				return m.requestLock()
			}
			m.kbFocus = m.note.issue.ID
			m.entered = m.kbFocus
			m.scrollListTo(m.kbFocus)
			return m.focusEditor(), nil
		}
		return m, nil
	case "delete", "backspace":
		targets := m.selectedIssues()
		if len(targets) == 0 {
			if issue, ok := m.issueByID(m.kbFocus); ok {
				targets = append(targets, issue)
			} else if m.note != nil && m.note.issue.ID != 0 {
				targets = append(targets, m.note.issue)
			}
		}
		if m.state == "closed" && len(m.selected) == 0 {
			return m, nil
		}
		return m.moveIssues(targets)
	case "ctrl+r", "r", "super+r", "meta+r":
		return m.hardReload()
	case "`":
		if len(m.workspaces) > 0 && !selection {
			m.choice = m.switcherChoice()
		}
		return m, nil
	case "?":
		m.help = "keyboard"
		return m, nil
	case "/":
		if !selection {
			return m.focusSearch(), nil
		}
	case "[":
		return m.changeState("open")
	case "]":
		return m.changeState("closed")
	case "q":
		return m.quit()
	case "n":
		if !selection {
			return m.newNote("")
		}
	case ",":
		return m.openSettings()
	case "pgdown", "ctrl+d":
		m.scrollDetail(m.detailGeometry().viewHeight / 2)
		return m, nil
	case "pgup", "ctrl+u":
		m.scrollDetail(-m.detailGeometry().viewHeight / 2)
		return m, nil
	}
	if !selection {
		if number, err := strconv.Atoi(key); err == nil && number >= 1 && number <= 9 {
			return m.switchWorkspace(number - 1)
		}
	}
	if m.note != nil && !selection {
		return m.noteShortcut(key)
	}
	return m, nil
}

// previewSelected는 넓은 화면에서 다중 선택한 노트를 오른쪽에 보여준다(previewSelectedIssue).
func (m *Model) previewSelected() tea.Cmd {
	if !m.wide() {
		return nil
	}
	issue, ok := m.issueByID(m.kbFocus)
	if !ok {
		return nil
	}
	next, cmd := m.openNote(issue, false)
	*m = next
	return cmd
}

// noteShortcut은 노트가 열려 있고 입력칸에 포커스가 없을 때의 단축키다(handleNoteShortcut).
func (m Model) noteShortcut(key string) (tea.Model, tea.Cmd) {
	n := m.note
	archived := m.state == "closed"
	switch key {
	case "m":
		n.preview = !n.preview
		m.layoutNote()
	case "l":
		if !archived {
			return m.requestLock()
		}
	case "s":
		if n.editable(archived) {
			return m.saveNote(true)
		}
	case "t":
		if n.editable(archived) && !n.preview {
			m = m.openNoteTags()
		}
	case "a":
		return m.requestAttach()
	case "p":
		if n.number() != 0 && !archived {
			return m.togglePin(n.issue)
		}
	case "e":
		if target, ok := m.voiceTargetForNote("body", 0); ok && !n.preview {
			return m.openVoice(target)
		}
	case "x":
		if n.editable(archived) && !n.preview {
			m.replace = newReplaceState()
		}
	case "g":
		if n.issue.HTMLURL != "" {
			return m, openURL(n.issue.HTMLURL)
		}
	}
	return m, nil
}

func (m *Model) scrollDetail(delta int) {
	if m.note == nil {
		return
	}
	g := m.detailGeometry()
	total := len(m.buildDetailContent(g).lines)
	m.detailScroll = max(0, min(m.detailScroll+delta, total-g.viewHeight))
}

// --- 검색칸 (SidebarSearch.svelte) ---

func (m Model) focusSearch() Model {
	m.blurInputs()
	m.focus = focusSearch
	m.search.Focus()
	m.search.CursorEnd()
	m.suggestion = -1
	return m
}

func (m Model) searchSuggestions() []string {
	value := strings.TrimSpace(m.search.Value())
	if !strings.HasPrefix(value, "#") {
		return nil
	}
	term := strings.ToLower(strings.TrimPrefix(value, "#"))
	var names []string
	for _, label := range m.visibleLabels() {
		if strings.Contains(strings.ToLower(label.Name), term) {
			names = append(names, label.Name)
		}
	}
	return names
}

func (m Model) handleSearchKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	suggestions := m.searchSuggestions()
	switch msg.String() {
	case "esc":
		m.blurInputs()
		return m.afterTyping()
	case "down":
		if len(suggestions) > 0 && m.suggestion < len(suggestions)-1 {
			m.suggestion++
			return m, nil
		}
		// 추천이 없으면 아래의 새 노트 버튼으로 내려간다.
		m.blurInputs()
		m.tool = "new"
		return m, nil
	case "up":
		if len(suggestions) > 0 && m.suggestion >= 0 {
			m.suggestion--
			return m, nil
		}
		// 위의 노트/휴지통 탭으로 올라간다.
		m.blurInputs()
		m.tool = "tabs"
		return m, nil
	case "enter":
		if m.suggestion >= 0 && m.suggestion < len(suggestions) {
			return m.openLabel(suggestions[m.suggestion])
		}
		m.blurInputs()
		return m.submitSearch()
	}
	var cmd tea.Cmd
	m.search, cmd = m.search.Update(msg)
	m.suggestion = -1
	return m, cmd
}

// --- 편집기 (본문·제목·댓글) ---

func (m Model) handleEditorKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	n := m.note
	if n == nil {
		m.blurInputs()
		return m, nil
	}
	switch msg.String() {
	case "esc":
		// 웹처럼 첫 Esc는 포커스만 푼다. 바뀐 내용은 바로 저장한다.
		var cmd tea.Cmd
		if m.focus == focusComment {
			m, cmd = m.saveComment(n.commentFocus)
		} else if n.dirty {
			m, cmd = m.saveNote(false)
		}
		m.blurInputs()
		next, restart := m.afterTyping()
		return next, tea.Batch(cmd, restart)
	case "ctrl+s":
		if m.focus == focusComment {
			return m.saveComment(n.commentFocus)
		}
		return m.saveNote(true)
	case "tab":
		if m.focus == focusTitle {
			m.blurInputs()
			m.focus = focusBody
			n.body.Focus()
			m.keepCursorVisible()
			return m, nil
		}
	case "shift+tab":
		// 오른쪽 편집기에서 목록으로 돌아간다. Esc와 같이 수정 중인 내용을 저장한다.
		var cmd tea.Cmd
		if m.focus == focusComment {
			m, cmd = m.saveComment(n.commentFocus)
		} else if n.dirty {
			m, cmd = m.saveNote(false)
		}
		m.blurInputs()
		m.tool = ""
		m.kbFocus = n.issue.ID
		m.scrollListTo(m.kbFocus)
		next, restart := m.afterTyping()
		return next, tea.Batch(cmd, restart)
	case "enter":
		if m.focus == focusTitle {
			m.blurInputs()
			m.focus = focusBody
			n.body.Focus()
			n.body.MoveToBegin()
			m.keepCursorVisible()
			return m, nil
		}
	}
	var cmd tea.Cmd
	switch m.focus {
	case focusBody:
		before := n.body.Value()
		n.body, cmd = n.body.Update(msg)
		if n.body.Value() != before {
			n.changed()
			cmd = tea.Batch(cmd, m.scheduleAutosave())
		}
	case focusTitle:
		before := n.title.Value()
		n.title, cmd = n.title.Update(msg)
		if n.title.Value() != before {
			n.changed()
			cmd = tea.Batch(cmd, m.scheduleAutosave())
		}
	case focusComment:
		if n.commentFocus < len(n.comments) {
			n.comments[n.commentFocus].editor, cmd = n.comments[n.commentFocus].editor.Update(msg)
		}
	}
	m.keepCursorVisible()
	return m, cmd
}

// handlePaste는 붙여넣기다(bracketed paste). 입력칸이면 그 칸에 넣고, 목록에서 붙여넣으면
// 그 내용으로 새 노트를 만든다(handleGlobalPaste).
func (m Model) handlePaste(msg tea.PasteMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.setup != nil:
		if !m.setup.busy {
			form := m.setup
			var cmd tea.Cmd
			form.inputs[form.field], cmd = form.inputs[form.field].Update(tea.PasteMsg{Content: strings.TrimSpace(msg.Content)})
			form.err = ""
			return m, cmd
		}
		return m, nil
	case m.prompt != nil:
		var cmd tea.Cmd
		m.prompt.input, cmd = m.prompt.input.Update(tea.PasteMsg{Content: strings.TrimSpace(msg.Content)})
		return m, cmd
	case m.replace != nil:
		var cmd tea.Cmd
		m.replace.inputs[m.replace.field], cmd = m.replace.inputs[m.replace.field].Update(msg)
		return m, cmd
	case m.picker != nil:
		var cmd tea.Cmd
		m.picker.input, cmd = m.picker.input.Update(msg)
		return m, cmd
	case m.settings != nil:
		return m.settingsPaste(msg)
	}
	// Finder에서 끌어 놓은 파일은 경로 글자로 온다. 열린 노트에 첨부한다(attach.go).
	if n := m.note; n != nil && m.focus != focusSearch && m.focus != focusTitle && n.number() != 0 && n.editable(m.state == "closed") && !n.preview {
		if paths := droppedFiles(msg.Content); paths != nil {
			return m.uploadFiles(paths)
		}
	}
	switch m.focus {
	case focusSearch:
		var cmd tea.Cmd
		m.search, cmd = m.search.Update(msg)
		return m, cmd
	case focusBody, focusTitle, focusComment:
		return m.handleEditorKey2(msg)
	}
	if m.note == nil && strings.TrimSpace(msg.Content) != "" && m.state == "open" {
		return m.newNote(msg.Content)
	}
	if m.note != nil {
		return m.showToast("붙여넣을 위치를 먼저 클릭하세요.")
	}
	return m, nil
}

// handleEditorKey2는 키가 아닌 메시지(붙여넣기)를 편집기에 넘긴다.
func (m Model) handleEditorKey2(msg tea.Msg) (tea.Model, tea.Cmd) {
	n := m.note
	var cmd tea.Cmd
	switch m.focus {
	case focusBody:
		n.body, cmd = n.body.Update(msg)
		n.changed()
		cmd = tea.Batch(cmd, m.scheduleAutosave())
	case focusTitle:
		n.title, cmd = n.title.Update(msg)
		n.changed()
		cmd = tea.Batch(cmd, m.scheduleAutosave())
	case focusComment:
		if n.commentFocus < len(n.comments) {
			n.comments[n.commentFocus].editor, cmd = n.comments[n.commentFocus].editor.Update(msg)
		}
	}
	m.keepCursorVisible()
	return m, cmd
}

// openURL은 주소를 기본 브라우저로 연다. 테스트에서 바꾼다.
var openURL = func(url string) tea.Cmd {
	return func() tea.Msg {
		command := exec.Command("xdg-open", url)
		switch runtime.GOOS {
		case "darwin":
			command = exec.Command("open", url)
		case "windows":
			command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
		}
		command.Start()
		return nil
	}
}
