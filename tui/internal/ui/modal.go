package ui

import (
	"strconv"
	"strings"

	"charm.land/lipgloss/v2"
)

// 모달 공통 부품. 모든 모달은 가운데에 뜨고, 아래를 어둡게 하며, 맨 아래에 버튼 줄이 있다.
//
//   - Tab은 다음 입력칸이 아니라 버튼 줄로 간다: 첫 Tab은 첫 버튼, 다음 Tab은 다음 버튼, 마지막
//     버튼에서 Tab을 누르면 원래 있던 포커스(내용)로 돌아온다. Shift+Tab은 반대다.
//   - 입력칸·항목 사이는 ↑/↓로 옮긴다. Enter는 버튼에 포커스가 있으면 그 버튼, 아니면 내용의 기본 동작.
//   - Esc는 맨 위 모달을 닫는다(취소). 모달은 겹겹이 뜰 수 있고 그때마다 아래가 한 번 더 어두워진다.
//
// 바꾸는 모달(환경설정·태그 선택 등)은 확인을 눌러야 적용하고, 취소·Esc는 버린다.

// modalAction은 버튼 줄의 버튼 하나다.
type modalAction struct {
	id       string
	label    string
	primary  bool
	danger   bool
	disabled bool
}

// actionBar는 버튼 줄의 키보드 포커스다. focus가 -1이면 내용(입력칸·목록)에 있다.
type actionBar struct {
	focus int
}

func newActionBar() actionBar { return actionBar{focus: -1} }

// tab은 내용 → 첫 버튼 → … → 마지막 버튼 → 내용 순서로 돈다. 누를 수 없는 버튼은 건너뛴다.
func (b *actionBar) tab(actions []modalAction, back bool) {
	positions := []int{-1}
	for index, action := range actions {
		if !action.disabled {
			positions = append(positions, index)
		}
	}
	current := 0
	for index, position := range positions {
		if position == b.focus {
			current = index
		}
	}
	if back {
		current = (current - 1 + len(positions)) % len(positions)
	} else {
		current = (current + 1) % len(positions)
	}
	b.focus = positions[current]
}

// move는 버튼 줄 안에서 ←/→로 옆 버튼으로 간다.
func (b *actionBar) move(actions []modalAction, delta int) {
	if b.focus < 0 {
		return
	}
	for next := b.focus + delta; next >= 0 && next < len(actions); next += delta {
		if !actions[next].disabled {
			b.focus = next
			return
		}
	}
}

// focused는 버튼에 포커스가 있으면 그 버튼 id다.
func (b actionBar) focused(actions []modalAction) string {
	if b.focus >= 0 && b.focus < len(actions) {
		return actions[b.focus].id
	}
	return ""
}

// barKey는 모달 공통 키(Tab·Shift+Tab·버튼 줄의 ←/→·Enter)를 처리한다. 버튼을 눌렀으면 그 id,
// 키를 썼으면 handled가 true다.
func (b *actionBar) barKey(actions []modalAction, key string) (pressed string, handled bool) {
	switch key {
	case "tab":
		b.tab(actions, false)
		return "", true
	case "shift+tab":
		b.tab(actions, true)
		return "", true
	}
	if b.focus < 0 {
		return "", false
	}
	switch key {
	case "left", "h":
		b.move(actions, -1)
		return "", true
	case "right", "l":
		b.move(actions, 1)
		return "", true
	case "enter", "space":
		return b.focused(actions), true
	case "up", "k":
		b.focus = -1
		return "", true
	}
	return "", false
}

// modalZone은 모달 안에서 누를 수 있는 곳이다. 위치는 안쪽(테두리·여백 안) 기준이다.
type modalZone struct {
	id    string
	line  int
	x     int
	width int
}

// modalBox는 그릴 준비가 된 모달이다. placeModal이 가운데 놓고 클릭 영역을 적는다.
type modalBox struct {
	lines  []string
	width  int // 안쪽 너비
	pad    int
	zones  []modalZone
	cursor *cursorPos // 안쪽 기준 커서(입력칸)
}

// modalContent는 모달 본문을 쌓는 도구다.
type modalContent struct {
	lines []string
	zones []modalZone
}

func (c *modalContent) add(line string) { c.lines = append(c.lines, line) }

// addRow는 누를 수 있는 조각이 섞인 한 줄이다.
func (c *modalContent) addRow(parts ...segment) {
	var builder strings.Builder
	column := 0
	for _, part := range parts {
		width := lipgloss.Width(part.text)
		if part.id != "" {
			c.zones = append(c.zones, modalZone{id: part.id, line: len(c.lines), x: column, width: width})
		}
		builder.WriteString(part.text)
		column += width
	}
	c.add(builder.String())
}

// buildModal은 제목·본문·버튼 줄로 모달을 만든다.
func (m Model) buildModal(title string, content modalContent, width int, actions []modalAction, bar actionBar) modalBox {
	t := m.th
	box := modalBox{width: width, pad: 2}
	box.lines = append(box.lines, "", lipgloss.PlaceHorizontal(width, lipgloss.Center, lipgloss.NewStyle().Bold(true).Foreground(t.title).Render(title)), "")
	offset := len(box.lines)
	box.lines = append(box.lines, content.lines...)
	for _, zone := range content.zones {
		zone.line += offset
		box.zones = append(box.zones, zone)
	}
	box.lines = append(box.lines, "", t.fg(t.divider).Render(strings.Repeat("─", width)))

	row, zones := m.actionRow(width, actions, bar, "Tab 버튼 · Esc 닫기")
	for _, zone := range zones {
		zone.line = len(box.lines)
		box.zones = append(box.zones, zone)
	}
	box.lines = append(box.lines, row, "")
	return box
}

// actionRow는 버튼 줄 한 줄이다. 왼쪽에 안내 문구, 오른쪽에 [ 확인 ] 모양 버튼이 붙는다.
// 포커스가 있는 버튼은 주황 글자·밝은 배경이다. zones의 줄 번호는 0이다.
func (m Model) actionRow(width int, actions []modalAction, bar actionBar, hint string) (string, []modalZone) {
	t := m.th
	var parts []segment
	used := 0
	for index, action := range actions {
		label := "[ " + action.label + " ]"
		style := lipgloss.NewStyle().Foreground(t.text)
		background := t.bgInput
		switch {
		case action.disabled:
			style = style.Foreground(t.disabled)
		case action.danger:
			style = style.Foreground(t.danger)
		case action.primary:
			style = style.Foreground(hex("#ffffff")).Bold(true)
			background = t.accent
		}
		if index == bar.focus {
			style = lipgloss.NewStyle().Foreground(t.shortcut).Bold(true).Underline(true)
			background = t.bgHover
		}
		text := fillBackground(style.Render(label), 0, background)
		id := ""
		if !action.disabled {
			id = "act:" + action.id
		}
		if index > 0 {
			parts = append(parts, seg("  "))
			used += 2
		}
		parts = append(parts, hit(id, text))
		used += lipgloss.Width(text)
	}
	hintText := t.fg(t.faint).Render(truncate(hint, max(0, width-used-1)))
	gap := max(1, width-used-lipgloss.Width(hintText))
	row := modalContent{}
	row.addRow(append([]segment{seg(hintText), seg(strings.Repeat(" ", gap))}, parts...)...)
	return row.lines[0], row.zones
}

// placeModal은 아래 화면을 어둡게 하고 모달을 가운데에 겹친다. 클릭 영역도 적는다.
func (m Model) placeModal(base string, box modalBox, bodyHeight int) (string, *cursorPos) {
	t := m.th
	rendered := panel(box.lines, box.width, t.bgOverlay, t.border, box.pad)
	width, height := lipgloss.Width(rendered), lipgloss.Height(rendered)
	x, y := max(0, (m.width-width)/2), max(0, (bodyHeight-height)/2)
	// 아래 화면의 클릭 영역을 덮는다. 모달 밖을 눌러도 아래 것이 눌리지 않는다.
	m.hits.add("modal-backdrop", 0, 0, m.width, m.height)
	m.hits.add("modal-box", x, y, width, height)
	for _, zone := range box.zones {
		m.hits.add(zone.id, x+1+box.pad+zone.x, y+1+zone.line, zone.width, 1)
	}
	var cursor *cursorPos
	if box.cursor != nil {
		cursor = &cursorPos{x: x + 1 + box.pad + box.cursor.x, y: y + 1 + box.cursor.y}
	}
	return overlay(dim(base), rendered, x, y), cursor
}

// modalWidth는 화면에 맞춘 모달 안쪽 너비다.
func (m Model) modalWidth(preferred int) int {
	return max(20, min(preferred, m.width-8))
}

// --- 선택 창: 드롭다운 대신 쓰는 모달 목록 (저장소 전환, 노트·댓글 메뉴, 환경설정 선택 상자) ---

type choiceModal struct {
	kind   string // "switcher", "note", "comment:<i>", "settings:<id>", "settings-ws:<i>"
	title  string
	items  []menuItem
	cursor int
	bar    actionBar
	footer []string
}

func newChoice(kind, title string, items []menuItem, selected int) *choiceModal {
	choice := &choiceModal{kind: kind, title: title, items: items, cursor: -1, bar: newActionBar()}
	if selected >= 0 && selected < len(items) && !items[selected].disabled {
		choice.cursor = selected
	} else {
		choice.move(1)
	}
	return choice
}

func (c *choiceModal) move(delta int) {
	for step := 0; step < len(c.items); step++ {
		c.cursor = (c.cursor + delta + len(c.items)) % len(c.items)
		if !c.items[c.cursor].disabled {
			return
		}
	}
}

func (c *choiceModal) actions() []modalAction {
	return []modalAction{{id: "choose", label: "선택", primary: true}, {id: "cancel", label: "취소"}}
}

func (m Model) renderChoice(c *choiceModal) modalBox {
	t := m.th
	width := m.modalWidth(56)
	var content modalContent
	for index, item := range c.items {
		if item.divider {
			content.add(t.fg(t.divider).Render(strings.Repeat("─", width)))
		}
		icon := "  "
		if item.icon != "" {
			icon = item.icon
		}
		style := lipgloss.NewStyle().Foreground(t.text)
		switch {
		case item.disabled:
			style = style.Foreground(t.disabled)
		case item.danger:
			style = style.Foreground(t.danger)
		}
		key := ""
		if item.key != "" {
			key = t.key(item.key)
			if item.disabled {
				key = t.fg(t.disabled).Render(item.key)
			}
		}
		label := " " + icon + " " + style.Render(item.label)
		if item.detail != "" {
			label += t.fg(t.faint).Render("  " + item.detail)
		}
		line := fitLine(label, width-lipgloss.Width(key)-1) + key + " "
		if index == c.cursor && c.bar.focus < 0 {
			line = fillBackground(t.fg(t.shortcut).Render("▌")+line[1:], width, t.bgHover)
		} else if index == c.cursor {
			line = fillBackground(line, width, t.bgHover)
		}
		id := ""
		if !item.disabled {
			id = "choice:" + strconv.Itoa(index)
		}
		content.addRow(hit(id, line))
	}
	if len(c.footer) > 0 {
		content.add("")
		for _, line := range c.footer {
			content.add(t.fg(t.faint).Render(line))
		}
	}
	return m.buildModal(c.title, content, width, c.actions(), c.bar)
}
