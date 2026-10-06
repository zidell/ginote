package ui

import (
	"strconv"
	"strings"

	"charm.land/bubbles/v2/textarea"
	tea "charm.land/bubbletea/v2"
	"github.com/atotto/clipboard"
)

// 본문·댓글 편집기의 글자 선택. 편집기(bubbles textarea)가 선택·칠하기·선택한 채 입력하면
// 덮어쓰기·지우기와 Shift+방향키 선택을 이미 하고, 여기서는 마우스 드래그를 잇는다.
//   - 누른 자리에서 끌면 선택한다. 놓을 때 저절로 복사하지 않는다.
//   - 복사는 ⌘C(터미널이 앱에 넘겨줄 때), Ctrl+C, Ctrl+Shift+C다. 선택이 있으면 Ctrl+C는 끝내지
//     않고 복사한다. macOS Terminal은 ⌘C를 앱에 넘기지 않고 자기 화면 선택을 복사한다.
//   - Fn을 누른 채 끌면 Terminal의 원래 선택이 된다(화면 글자 그대로).

// beginTextDrag는 편집기를 누른 것이다. 커서를 옮기고 드래그 선택을 시작한다.
func (m *Model) beginTextDrag(id string, area *textarea.Model, zone hitZone) {
	area.BeginSelection(max(0, m.lastClickX-zone.originX), max(0, m.lastClickY-zone.originY))
	m.dragText = id
}

// dragArea는 끌고 있는 편집기다.
func (m Model) dragArea() *textarea.Model {
	n := m.note
	if n == nil {
		return nil
	}
	if m.dragText == "body" {
		return &n.body
	}
	if index, err := strconv.Atoi(strings.TrimPrefix(m.dragText, "comment:")); err == nil && index < len(n.comments) {
		return &n.comments[index].editor
	}
	return nil
}

func (m Model) extendTextDrag(msg tea.MouseMotionMsg) Model {
	area := m.dragArea()
	zone, ok := m.hits.lookup(m.dragText)
	if area == nil || !ok {
		return m
	}
	mouse := msg.Mouse()
	area.ExtendSelection(max(0, mouse.X-zone.originX), max(0, mouse.Y-zone.originY))
	return m
}

func (m Model) endTextDrag() (Model, tea.Cmd) {
	area := m.dragArea()
	m.dragText = ""
	if area == nil {
		return m, nil
	}
	area.EndSelection()
	return m, nil
}

// copySelection은 선택한 글을 클립보드에 넣는다.
func (m Model) copySelection(area *textarea.Model) (Model, tea.Cmd) {
	if area == nil || !area.HasSelection() {
		return m, nil
	}
	return m, copyText(area.SelectedText(), "선택한 글을 복사했습니다.")
}

type clipboardResultMsg struct {
	success string
	err     error
}

// 터미널의 OSC 52 지원 여부에 의존하지 않고 OS 클립보드에 복사한다.
var writeClipboard = clipboard.WriteAll

func copyText(text, success string) tea.Cmd {
	return func() tea.Msg {
		return clipboardResultMsg{success: success, err: writeClipboard(text)}
	}
}

// focusedArea는 포커스가 있는 본문·댓글 편집기다.
func (m Model) focusedArea() *textarea.Model {
	n := m.note
	switch {
	case n == nil:
		return nil
	case m.focus == focusBody:
		return &n.body
	case m.focus == focusComment && n.commentFocus < len(n.comments):
		return &n.comments[n.commentFocus].editor
	}
	return nil
}
