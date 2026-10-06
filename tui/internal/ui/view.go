package ui

import (
	"strconv"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

func (m Model) View() tea.View {
	m.hits.reset()
	content, cursor := m.render()
	view := tea.NewView(content)
	view.AltScreen = true
	view.MouseMode = tea.MouseModeCellMotion
	view.ReportFocus = true
	view.BackgroundColor = m.th.bgApp
	view.ForegroundColor = m.th.text
	view.WindowTitle = "Ginote"
	if workspace, ok := m.activeWorkspace(); ok {
		view.WindowTitle = "Ginote · " + workspace.Label()
	}
	if cursor != nil {
		view.Cursor = tea.NewCursor(cursor.x, cursor.y+topMargin)
	}
	return view
}

func (m Model) render() (string, *cursorPos) {
	if m.width == 0 || m.height == 0 {
		return "", nil
	}
	t := m.th
	bodyHeight := m.height - m.footerHeight()
	var base string
	var cursor *cursorPos

	switch {
	case len(m.workspaces) == 0 && m.setup == nil:
		base = lipgloss.Place(m.width, bodyHeight, lipgloss.Center, lipgloss.Center, t.fg(t.faint).Render("연결된 저장소가 없습니다. ` 키로 저장소를 추가하세요."))
	case m.wide():
		sidebarWidth := m.sidebarWidth()
		sidebar := m.renderSidebar(sidebarWidth, bodyHeight)
		divider := t.fg(t.border).Render(strings.TrimSuffix(strings.Repeat("│\n", bodyHeight), "\n"))
		detail, detailCursor := m.renderDetail(m.detailGeometry())
		base = lipgloss.JoinHorizontal(lipgloss.Top, sidebar, divider, detail)
		cursor = detailCursor
	case m.note != nil:
		base, cursor = m.renderDetail(m.detailGeometry())
	default:
		base = m.renderSidebar(m.width, bodyHeight)
	}
	base = fitBlock(base, m.width, bodyHeight)
	if m.focus == focusSearch {
		if c := m.search.Cursor(); c != nil {
			cursor = &cursorPos{x: 1 + c.X, y: 3}
		}
	}

	// 위에 겹쳐 뜨는 것. 뒤에 그린 것이 위에 있다.
	if m.focus == focusSearch {
		if suggestions := m.searchSuggestions(); len(suggestions) > 0 {
			base = overlay(base, m.renderSuggestions(suggestions), 1, 4)
		}
	}
	// 모달은 겹겹이 뜰 수 있다. 하나를 올릴 때마다 그 아래를 모두 어둡게 해 맨 위 모달이 앞에 있게
	// 보인다. 아래 순서가 겹치는 순서이고, 키는 맨 위 것이 받는다(handleKey는 이 반대 순서).
	layer := func(box modalBox) {
		var boxCursor *cursorPos
		base, boxCursor = m.placeModal(base, box, bodyHeight)
		cursor = boxCursor
	}
	sheet := func(box string, x, y int, sheetCursor *cursorPos) {
		base = overlay(dim(base), box, x, y)
		cursor = sheetCursor
	}
	if m.help != "" {
		m.hits.add("modal-backdrop", 0, 0, m.width, m.height)
		box, x, y := m.renderHelp()
		sheet(box, x, y, nil)
	}
	if m.settings != nil {
		m.hits.add("modal-backdrop", 0, 0, m.width, m.height)
		box, x, y, settingsCursor := m.renderSettings()
		sheet(box, x, y, settingsCursor)
	}
	if m.choice != nil {
		layer(m.renderChoice(m.choice))
	}
	if m.picker != nil {
		layer(m.renderPicker())
	}
	if m.replace != nil && m.note != nil {
		layer(m.renderReplace())
	}
	if m.voice != nil {
		layer(m.renderVoice())
	}
	if m.prompt != nil {
		layer(m.renderPrompt())
	}
	if m.setup != nil {
		layer(m.renderSetup())
	}
	if footer := m.renderFooter(); footer != "" {
		base += "\n" + footer
	}
	return m.renderTopMargin() + base, cursor
}

// renderTopMargin은 맨 위 여백이다. 넓은 화면이면 사이드바 경계선을 위까지 잇는다.
func (m Model) renderTopMargin() string {
	if m.width == 0 {
		return strings.Repeat("\n", topMargin)
	}
	line := ""
	if m.wide() && (len(m.workspaces) > 0 || m.setup != nil) {
		color := m.th.border
		if m.dragSidebar {
			color = m.th.accentBright
		}
		line = strings.Repeat(" ", m.sidebarWidth()) + m.th.fg(color).Render("│")
	}
	if m.modalOpen() {
		line = dim(line)
	}
	return strings.Repeat(line+"\n", topMargin)
}

func (m Model) renderSuggestions(names []string) string {
	t := m.th
	width := m.sidebarWidth() - 2
	var lines []string
	for index, name := range names {
		if index >= 10 {
			break
		}
		text := fitLine(" #"+name, width-2)
		if index == m.suggestion {
			text = lipgloss.NewStyle().Background(t.bgHover).Render(text)
		}
		lines = append(lines, text)
	}
	box := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(t.border).Background(t.bgOverlay).Render(strings.Join(lines, "\n"))
	m.hits.add("suggest-box", 1, 4, lipgloss.Width(box), lipgloss.Height(box))
	for index := range lines {
		m.hits.add("suggest:"+strconv.Itoa(index), 2, 5+index, width-2, 1)
	}
	return box
}

// renderFooter는 맨 아래 한 줄이다: 삭제 유예, 알림, 오류, 개발 모드 상태.
func (m Model) renderFooter() string {
	if m.footerHeight() == 0 {
		return ""
	}
	t := m.th
	var parts []string
	if count := m.deletions.Len(); count > 0 {
		parts = append(parts, t.fg(t.danger).Render("🗑 휴지통으로 옮기는 중… ")+t.fg(t.muted).Render("Esc 취소"))
	}
	if m.toast != "" {
		parts = append(parts, lipgloss.NewStyle().Foreground(hex("#4a3410")).Background(hex("#fff3bf")).Render(" "+m.toast+" "))
	}
	if m.listErr != "" && len(m.orderedIssues()) > 0 {
		parts = append(parts, t.fg(t.danger).Render(m.listErr))
	}
	switch {
	case m.devError != "":
		parts = append(parts, t.fg(t.danger).Render("✗ "+m.devStatus+": "+m.devError))
	case m.devStatus != "":
		parts = append(parts, t.fg(t.accentBright).Render("● DEV "+m.devStatus))
	}
	return fitLine(" "+strings.Join(parts, "   "), m.width)
}

// fitBlock은 문자열을 정확히 width×height로 맞춘다.
func fitBlock(content string, width, height int) string {
	lines := strings.Split(content, "\n")
	if len(lines) > height {
		lines = lines[:height]
	}
	for index, line := range lines {
		lines[index] = fitLine(line, width)
	}
	for len(lines) < height {
		lines = append(lines, strings.Repeat(" ", width))
	}
	return strings.Join(lines, "\n")
}
