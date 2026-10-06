package ui

import (
	"strings"
	"unicode"

	"charm.land/bubbles/v2/textarea"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/notes"
)

// promptState는 한 줄 입력 창이다. 잠금 숫자(note-lock 패널), 첨부 파일 경로, 이름 바꾸기,
// 확인 질문에 쓴다.
type promptState struct {
	kind    string // "lock", "unlock", "attach", "confirm:<action>", "settings-rename-workspace", "voice-prompt"
	title   string
	help    string
	input   textinput.Model
	err     string
	busy    bool
	confirm bool // 입력 없이 Enter/Esc만 받는 확인 창
	target  string
	bar     actionBar
	// multiline이면 input 대신 여러 줄 칸(area)을 쓴다(음성 정제 규칙). Enter는 줄바꿈이고
	// 확인은 Tab으로 버튼에 가서 누르거나 Ctrl+S다.
	multiline bool
	area      textarea.Model
}

func newPinPrompt(mode string) *promptState {
	input := textinput.New()
	input.Prompt = ""
	input.CharLimit = 6
	input.EchoMode = textinput.EchoPassword
	input.EchoCharacter = '•'
	input.Placeholder = "6자리 숫자"
	input.SetVirtualCursor(false)
	input.Focus()
	prompt := &promptState{kind: mode, input: input, bar: newActionBar()}
	if mode == "lock" {
		prompt.title = "노트 잠금"
		prompt.help = "6자리 숫자로 본문을 암호화합니다. 모든 잠금 노트에 같은 숫자를 씁니다. 숫자를 잊으면 노트를 열 수 없습니다."
	} else {
		prompt.title = "잠금 열기"
		prompt.help = "잠금에 쓴 6자리 숫자를 입력하세요."
	}
	return prompt
}

func newAttachPrompt() *promptState {
	input := textinput.New()
	input.Prompt = ""
	input.Placeholder = "~/Downloads/사진.png"
	input.SetVirtualCursor(false)
	input.Focus()
	return &promptState{bar: newActionBar(), kind: "attach", title: "파일 첨부", help: "올릴 파일의 경로를 입력하세요. 파일을 터미널로 끌어다 놓으면 경로가 들어갑니다. 10MB까지 올릴 수 있습니다.", input: input}
}

func newTextPrompt(kind, title, help, value string) *promptState {
	input := textinput.New()
	input.Prompt = ""
	input.SetValue(value)
	input.CharLimit = 120
	input.SetVirtualCursor(false)
	input.Focus()
	input.CursorEnd()
	return &promptState{kind: kind, title: title, help: help, input: input, bar: newActionBar()}
}

// newAreaPrompt는 여러 줄 입력 창이다.
func newAreaPrompt(kind, title, help, value string, limit int) *promptState {
	area := textarea.New()
	area.Prompt = ""
	area.ShowLineNumbers = false
	area.CharLimit = limit
	area.SetVirtualCursor(false)
	area.SetValue(value)
	area.Focus()
	return &promptState{kind: kind, title: title, help: help, multiline: true, area: area, bar: newActionBar()}
}

func newConfirmPrompt(kind, title, help, target string) *promptState {
	return &promptState{kind: kind, title: title, help: help, confirm: true, target: target, bar: newActionBar()}
}

func (p *promptState) actions() []modalAction {
	if p.confirm {
		danger := strings.HasPrefix(p.kind, "confirm:delete") || p.kind == "confirm:discard-settings"
		label := "확인"
		if danger {
			label = "삭제"
			if p.kind == "confirm:discard-settings" {
				label = "버리기"
			}
		}
		return []modalAction{{id: "ok", label: label, primary: !danger, danger: danger}, {id: "cancel", label: "취소"}}
	}
	return []modalAction{{id: "ok", label: "확인", primary: true, disabled: p.busy}, {id: "cancel", label: "취소"}}
}

func (m Model) closePrompt() (tea.Model, tea.Cmd) {
	m.prompt = nil
	return m.afterTyping()
}

func (m Model) handlePromptKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	p := m.prompt
	if p.busy {
		return m, nil
	}
	key := msg.String()
	if p.confirm || p.bar.focus >= 0 {
		key = keyName(msg)
	}
	if pressed, handled := p.bar.barKey(p.actions(), key); handled {
		switch pressed {
		case "ok":
			return m.submitPrompt()
		case "cancel":
			return m.closePrompt()
		}
		return m, nil
	}
	if p.multiline {
		switch key {
		case "esc":
			return m.closePrompt()
		case "ctrl+s":
			return m.submitPrompt()
		}
		var cmd tea.Cmd
		p.area, cmd = p.area.Update(msg)
		return m, cmd
	}
	switch key {
	case "esc":
		return m.closePrompt()
	case "enter":
		return m.submitPrompt()
	case "y":
		if p.confirm {
			return m.submitPrompt()
		}
	case "n":
		if p.confirm {
			return m.closePrompt()
		}
	}
	if p.confirm {
		return m, nil
	}
	var cmd tea.Cmd
	p.input, cmd = p.input.Update(msg)
	p.err = ""
	if p.kind == "lock" || p.kind == "unlock" {
		digits := strings.Map(func(r rune) rune {
			if unicode.IsDigit(r) && r < 128 {
				return r
			}
			return -1
		}, p.input.Value())
		p.input.SetValue(digits)
		// 웹처럼 잠금을 열 때는 6자리를 다 넣으면 바로 연다.
		if p.kind == "unlock" && len(digits) == 6 {
			return m.submitPrompt()
		}
	}
	return m, cmd
}

func (m Model) submitPrompt() (tea.Model, tea.Cmd) {
	p := m.prompt
	value := strings.TrimSpace(p.input.Value())
	switch p.kind {
	case "lock", "unlock":
		pin := notes.NormalizeLockPin(value)
		if len(pin) != 6 {
			p.err = "6자리 숫자를 입력해 주세요."
			return m, nil
		}
		p.busy = true
		if p.kind == "lock" {
			return m, m.lockWithPin(pin)
		}
		p.busy = false
		return m, m.unlockNote(pin)
	case "attach":
		if value == "" {
			return m, nil
		}
		m.prompt = nil
		if paths := droppedFiles(value); paths != nil {
			return m.uploadFiles(paths)
		}
		next, _ := m.showToast("업로드 중…")
		return next, next.uploadAttachment(value)
	case "settings-rename-workspace":
		m.renameDraftWorkspace(p.target, value)
	case "voice-prompt":
		m.prompt = nil
		m.setDraftRefinementPrompt(p.area.Value())
		return m.afterTyping()
	case "confirm:discard-settings":
		m.prompt = nil
		m.settings = nil
		return m, nil
	case "confirm:delete-attachment":
		m.prompt = nil
		return m.deleteAttachment(p.target)
	case "confirm:cancel-voice":
		m.prompt = nil
		return m.closeVoice()
	}
	m.prompt = nil
	return m.afterTyping()
}

func (m Model) renderPrompt() modalBox {
	t := m.th
	p := m.prompt
	width := m.modalWidth(56)
	if p.multiline {
		width = m.modalWidth(76)
	}
	var content modalContent
	for _, line := range wrapText(p.help, width) {
		content.add(t.fg(t.secondary).Render(line))
	}
	var cursor *cursorPos
	if p.multiline {
		content.add("")
		p.area.SetWidth(width - 2)
		p.area.SetHeight(min(12, max(4, m.height-20)))
		top := len(content.lines)
		for _, line := range strings.Split(p.area.View(), "\n") {
			content.add(fillBackground(" "+line, width, t.bgInput))
		}
		if c := p.area.Cursor(); c != nil && p.bar.focus < 0 {
			cursor = &cursorPos{x: 1 + c.X, y: top + c.Y}
		}
	} else if !p.confirm {
		content.add("")
		p.input.SetWidth(width - 2)
		if c := p.input.Cursor(); c != nil && p.bar.focus < 0 {
			cursor = &cursorPos{x: 1 + c.X, y: len(content.lines)}
		}
		content.addRow(hit("prompt-input", fillBackground(" "+p.input.View(), width, t.bgInput)))
	}
	if p.err != "" {
		content.add("")
		content.add(t.fg(t.danger).Render(p.err))
	}
	if p.busy {
		content.add("")
		content.add(t.fg(t.faint).Render("⠋ 처리하는 중…"))
	}
	box := m.buildModal(p.title, content, width, p.actions(), p.bar)
	if cursor != nil {
		// 본문은 제목 세 줄(빈 줄·제목·빈 줄) 아래에서 시작한다.
		cursor.y += 3
		box.cursor = cursor
	}
	return box
}
