package ui

import (
	"strconv"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/config"
)

// handleClick은 마우스 클릭이다. View가 적어 둔 영역(hitMap)으로 무엇을 눌렀는지 찾는다.
func (m Model) handleClick(msg tea.MouseClickMsg) (tea.Model, tea.Cmd) {
	mouse := msg.Mouse()
	if mouse.Button != tea.MouseLeft {
		return m, nil
	}
	m.lastClickX, m.lastClickY = mouse.X, mouse.Y
	m.lastClickAlt = mouse.Mod&tea.ModAlt != 0
	zone, found := m.hits.find(mouse.X, mouse.Y)
	id := ""
	if found {
		id = zone.id
	}

	if m.modalOpen() {
		return m.clickModal(id)
	}
	// 사이드바 경계선은 어느 높이에서든 끌어 조절할 수 있다.
	if !found && m.wide() && mouse.X == m.sidebarWidth() {
		id = "sidebar-divider"
	}
	if id == "sidebar-divider" {
		// 경계선을 눌러 끌면 사이드바 너비가 바뀐다(웹의 sidebar-resizer). 놓을 때 기억한다.
		m.dragSidebar = true
		return m, nil
	}
	return m.handleClickTarget(id, zone, msg)
}

// modalOpen은 모달이 하나라도 떠 있는지다. 그동안은 맨 위 모달 안만 누를 수 있다.
func (m Model) modalOpen() bool {
	return m.setup != nil || m.prompt != nil || m.voice != nil || (m.replace != nil && m.note != nil) ||
		m.picker != nil || m.choice != nil || m.settings != nil || m.help != ""
}

// clickModal은 맨 위 모달 안을 누른 것이다. 버튼 줄(act:)은 키보드의 버튼과 같다.
func (m Model) clickModal(id string) (tea.Model, tea.Cmd) {
	action, isAction := strings.CutPrefix(id, "act:")
	switch {
	case m.setup != nil:
		form := m.setup
		switch {
		case isAction && action == "connect":
			return m.submitSetup()
		case isAction && action == "cancel":
			return m.closeSetup()
		case id == "setup-pat":
			return m, openURL(config.PATCreationURL(form.inputs[fieldRepo].Value()))
		case strings.HasPrefix(id, "setup-field:"):
			index, _ := strconv.Atoi(strings.TrimPrefix(id, "setup-field:"))
			form.bar = newActionBar()
			form.focus(index)
		}
	case m.prompt != nil:
		switch {
		case isAction && action == "ok":
			return m.submitPrompt()
		case isAction && action == "cancel":
			return m.closePrompt()
		case id == "prompt-input":
			m.prompt.bar = newActionBar()
		}
	case m.voice != nil:
		if isAction {
			return m.voiceAction(action)
		}
	case m.replace != nil && m.note != nil:
		r := m.replace
		switch {
		case isAction && action == "apply":
			return m.applyReplacement()
		case isAction && action == "cancel":
			m.replace = nil
			return m.afterTyping()
		case strings.HasPrefix(id, "replace-field:"):
			index, _ := strconv.Atoi(strings.TrimPrefix(id, "replace-field:"))
			r.bar = newActionBar()
			r.focusField(index)
		}
	case m.picker != nil:
		p := m.picker
		switch {
		case isAction && action == "apply":
			return m.applyPicker()
		case isAction && action == "cancel":
			m.picker = nil
		case strings.HasPrefix(id, "pick:"):
			index, _ := strconv.Atoi(strings.TrimPrefix(id, "pick:"))
			if options := p.options(); index < len(options) {
				p.bar = newActionBar()
				p.cursor = index
				p.toggle(options[index])
			}
		case id == "picker-input":
			p.bar = newActionBar()
			p.cursor = -1
		}
	case m.choice != nil:
		c := m.choice
		switch {
		case isAction && action == "choose":
			return m.chooseCurrent()
		case isAction && action == "cancel":
			return m.closeChoice()
		case strings.HasPrefix(id, "choice:"):
			index, _ := strconv.Atoi(strings.TrimPrefix(id, "choice:"))
			if index < len(c.items) && !c.items[index].disabled {
				c.cursor = index
				return m.runChoice(c.items[index].id)
			}
		}
	case m.settings != nil:
		s := m.settings
		switch {
		case isAction && action == "apply":
			return m.applySettings()
		case isAction && action == "cancel", id == "settings-close":
			m.commitSettingsInput(s.focus)
			return m.requestCloseSettings()
		case strings.HasPrefix(id, "set:"):
			target := strings.TrimPrefix(id, "set:")
			m.commitSettingsInput(s.focus)
			s.focus = target
			s.bar = newActionBar()
			control, _, _ := m.settingsControl(target)
			if control.kind == "text" {
				return m, nil
			}
			return m.activateSettings(control)
		}
	case m.help != "":
		if (isAction && action == "close") || id == "help-close" {
			m.help = ""
			m.helpBar = newActionBar()
		}
	}
	return m, nil
}

// handleClickTarget은 겹친 것이 없을 때 누른 대상이다.
func (m Model) handleClickTarget(id string, zone hitZone, msg tea.MouseClickMsg) (tea.Model, tea.Cmd) {
	mouse := msg.Mouse()
	shift := mouse.Mod&tea.ModShift != 0
	ctrl := mouse.Mod&(tea.ModCtrl|tea.ModMeta|tea.ModSuper) != 0

	// 입력칸 밖을 누르면 그 칸의 포커스를 푼다(바뀐 내용은 저장).
	var blur tea.Cmd
	if m.focus != focusNone && !strings.HasPrefix(id, "body") && id != "title" && !strings.HasPrefix(id, "comment:") && id != "search" {
		var saved tea.Cmd
		if m.focus == focusComment && m.note != nil {
			m, saved = m.saveComment(m.note.commentFocus)
		} else if m.note != nil && m.note.dirty {
			m, saved = m.saveNote(false)
		}
		m.blurInputs()
		blur = saved
	}
	next, cmd := m.clickTarget(id, zone, shift, ctrl)
	return next, tea.Batch(blur, cmd)
}

func (m Model) clickTarget(id string, zone hitZone, shift, ctrl bool) (tea.Model, tea.Cmd) {
	m.tool = ""
	switch {
	case id == "ws":
		if !m.selectionMode() {
			m.choice = m.switcherChoice()
		}
	case id == "settings":
		return m.openSettings()
	case id == "tab:open":
		return m.changeState("open")
	case id == "tab:closed":
		return m.changeState("closed")
	case id == "search":
		return m.focusSearch(), nil
	case id == "search-clear":
		m.search.SetValue("")
		return m.submitSearch()
	case id == "search-btn":
		return m.submitSearch()
	case strings.HasPrefix(id, "suggest:"):
		index, _ := strconv.Atoi(strings.TrimPrefix(id, "suggest:"))
		suggestions := m.searchSuggestions()
		if index < len(suggestions) {
			return m.openLabel(suggestions[index])
		}
	case id == "new":
		return m.newNote("")
	case id == "voice":
		return m.openVoice(voiceTarget{kind: "new"})
	case id == "voice-comment":
		if target, ok := m.voiceTargetForNote("comment-new", 0); ok {
			return m.openVoice(target)
		}
	case strings.HasPrefix(id, "row:"):
		issueID, _ := strconv.ParseInt(strings.TrimPrefix(id, "row:"), 10, 64)
		return m.clickRow(issueID, shift, ctrl)
	case id == "loadmore":
		return m.loadMore()
	case id == "sel:tags":
		return m.openSelectionTags(), nil
	case id == "sel:merge":
		return m.mergeSelected()
	case id == "sel:move":
		return m.moveIssues(m.selectedIssues())
	case id == "sel:close":
		m.clearSelection()
	case strings.HasPrefix(id, "help:"):
		m.help = strings.TrimPrefix(id, "help:")

	// 노트 영역
	case id == "back":
		next, cmd := m.closeNote()
		return next, cmd
	case id == "copynumber":
		return m.copyIssueNumber()
	case id == "tb:tag":
		return m.noteShortcut("t")
	case id == "tb:attach":
		return m.noteShortcut("a")
	case id == "tb:more":
		if m.note != nil {
			m.choice = m.noteMenu()
		}
	case id == "preview-close":
		return m.noteShortcut("m")
	case id == "unlock":
		return m.requestLock()
	case strings.HasPrefix(id, "chip:"):
		return m.openLabel(strings.TrimPrefix(id, "chip:"))
	case strings.HasPrefix(id, "chipx:"):
		if m.note != nil {
			m.note.toggleLabel(strings.TrimPrefix(id, "chipx:"))
			m.layoutNote()
			return m.saveNote(false)
		}
	case id == "chipadd":
		return m.noteShortcut("t")
	case id == "title":
		if m.note != nil && m.note.editable(m.state == "closed") {
			m.blurInputs()
			m.focus = focusTitle
			m.note.title.Focus()
		}
	case id == "body":
		if m.note != nil && !m.note.preview {
			if next, cmd, opened := m.clickLink(&m.note.body, zone, m.focus == focusBody, ctrl || m.lastClickAlt); opened {
				return next, cmd
			}
		}
		return m.clickBody(zone)
	case strings.HasPrefix(id, "comment:"):
		index, _ := strconv.Atoi(strings.TrimPrefix(id, "comment:"))
		if m.note != nil && index < len(m.note.comments) {
			editing := m.focus == focusComment && m.note.commentFocus == index
			if next, cmd, opened := m.clickLink(&m.note.comments[index].editor, zone, editing, ctrl || m.lastClickAlt); opened {
				return next, cmd
			}
		}
		if m.note != nil && index < len(m.note.comments) && m.note.editable(m.state == "closed") {
			if m.focus == focusComment && m.note.commentFocus != index {
				m, _ = m.saveComment(m.note.commentFocus)
			}
			m = m.focusComment(index)
			m.beginTextDrag(id, &m.note.comments[index].editor, zone)
		}
	case strings.HasPrefix(id, "cmore:"):
		index, _ := strconv.Atoi(strings.TrimPrefix(id, "cmore:"))
		if m.note != nil && index < len(m.note.comments) {
			m.choice = m.commentMenu(index)
		}
	case id == "addcomment":
		return m.addComment(), nil
	case strings.HasPrefix(id, "att:"):
		index, _ := strconv.Atoi(strings.TrimPrefix(id, "att:"))
		if m.note != nil && index < len(m.note.attachments) {
			return m.previewAttachment(index)
		}
	case id == "attadd":
		return m.requestAttach()
	case strings.HasPrefix(id, "attx:"):
		index, _ := strconv.Atoi(strings.TrimPrefix(id, "attx:"))
		if m.note != nil && index < len(m.note.attachments) {
			name := m.note.attachments[index].Name
			m.prompt = newConfirmPrompt("confirm:delete-attachment", "첨부파일 삭제", "“"+name+"” 파일을 저장소에서도 삭제할까요?", m.note.attachments[index].Path)
		}
	}
	return m, nil
}

// clickRow는 목록 행 클릭이다(handleIssueClick). Shift는 범위, Ctrl/Cmd는 하나씩 다중 선택이다.
// 그냥 누르면 노트를 열고, 다음 Enter는 편집으로 들어간다.
func (m Model) clickRow(id int64, shift, ctrl bool) (tea.Model, tea.Cmd) {
	issue, ok := m.issueByID(id)
	if !ok {
		return m, nil
	}
	switch {
	case m.selectionMode():
		m.toggleSelection(id, shift)
		return m, m.previewSelected()
	case shift && m.note != nil && m.note.issue.ID != 0 && m.note.issue.ID != id:
		m.anchor = m.note.issue.ID
		m.toggleSelection(id, true)
		return m, m.previewSelected()
	case ctrl:
		if m.kbFocus != 0 && m.kbFocus != id {
			m.selected = map[int64]bool{m.kbFocus: true}
			m.anchor = m.kbFocus
		}
		m.toggleSelection(id, false)
		return m, m.previewSelected()
	}
	m.entered = id
	return m.openNote(issue, false)
}

// clickBody는 본문을 누른 자리에 커서를 두고 편집을 시작한다.
func (m Model) clickBody(zone hitZone) (tea.Model, tea.Cmd) {
	n := m.note
	if n == nil || !n.editable(m.state == "closed") || n.preview {
		return m, nil
	}
	if m.focus != focusBody {
		m.blurInputs()
		m.focus = focusBody
		n.body.Focus()
	}
	m.beginTextDrag("body", &n.body, zone)
	m.keepCursorVisible()
	return m, nil
}

func (m Model) handleWheel(msg tea.MouseWheelMsg) (tea.Model, tea.Cmd) {
	mouse := msg.Mouse()
	delta := 3
	if mouse.Button == tea.MouseWheelUp {
		delta = -3
	}
	switch {
	case m.help != "":
		helpScroll[m.help] = max(0, helpScroll[m.help]+delta)
		return m, nil
	case m.settings != nil:
		m.settings.scroll = max(0, m.settings.scroll+delta)
		return m, nil
	}
	if m.wide() && mouse.X < m.sidebarWidth() || !m.wide() && m.note == nil {
		m.listScroll = max(0, m.listScroll+delta)
		m.clampListScroll()
		return m, nil
	}
	m.scrollDetail(delta)
	return m, nil
}
