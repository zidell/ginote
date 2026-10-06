package ui

import (
	"fmt"
	"strconv"
	"strings"

	"charm.land/lipgloss/v2"

	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/notes"
)

// 넓은 화면의 기준과 사이드바 폭(웹의 sidebar_width를 글자 수로 옮긴 값).
const (
	wideMinWidth    = 90
	sidebarMinWidth = 34
	sidebarMaxWidth = 50
)

func (m Model) wide() bool { return m.width >= wideMinWidth }

func (m Model) sidebarWidth() int {
	if !m.wide() {
		return m.width
	}
	if m.sidebarCols > 0 {
		return m.clampSidebar(m.sidebarCols)
	}
	return min(sidebarMaxWidth, max(sidebarMinWidth, m.width*30/100))
}

// clampSidebar는 끌어서 정한 사이드바 너비를 화면에 맞춘다. 노트 쪽은 40칸을 남긴다.
func (m Model) clampSidebar(width int) int {
	return max(sidebarMinWidth, min(width, m.width-41))
}

// sidebarToolsHeight는 목록 위에 고정된 줄 수다: 머리줄, 구분선, 탭, 가는 선, 검색, 구분선,
// 새 노트, 구분선.
const sidebarToolsHeight = 8

// searchRow는 검색칸이 있는 화면 줄이다(커서·추천 목록 위치).
const searchRow = 4

// listBodyHeight는 목록 행이 들어가는 높이다.
func (m Model) listBodyHeight() int { return max(1, m.height-sidebarToolsHeight-m.footerHeight()) }

func (m Model) footerHeight() int {
	if m.toast != "" || m.devStatus != "" || m.devError != "" || m.deletions.Len() > 0 || m.listErr != "" {
		return 1
	}
	return 0
}

// renderSidebar는 NoteList.svelte와 App.svelte의 사이드바를 그린다.
func (m Model) renderSidebar(width, height int) string {
	t := m.th
	b := newBlock(m.hits, 0, 0, width)

	// 1. 머리줄: 저장소 전환(아바타·이름·`)과 설정. 다중 선택 중에는 선택 툴바(SelectionToolbar).
	if m.selectionMode() {
		count := len(m.selected)
		move := "삭제"
		if m.state == "closed" {
			move = "복원"
		}
		merge := t.button("병합", false)
		if m.state != "open" || count < 2 {
			merge = t.disabledButton("병합")
		}
		b.segments(
			seg(" "),
			hit("sel:tags", t.button("# 태그", m.picker != nil && m.picker.mode == "selection")), seg(" "),
			hit("sel:merge", merge), seg(" "),
			hit("sel:move", fillBackground(" "+t.fg(t.danger).Render(move)+" ", 0, t.bgInput)), seg(" "),
			hit("sel:close", t.button("닫기", false)),
			seg(t.fg(t.faint).Render(fmt.Sprintf("  %d개", count))),
		)
	} else {
		name := "Ginote"
		initial := "G"
		if workspace, ok := m.activeWorkspace(); ok {
			name = workspace.Label()
			initial = strings.ToUpper(string([]rune(strings.SplitN(workspace.Repo, "/", 2)[0])[0:1]))
		}
		if m.user != "" {
			initial = strings.ToUpper(m.user[:1])
		}
		avatar := lipgloss.NewStyle().Foreground(hex("#ffffff")).Background(hex("#6d5df5")).Bold(true).Render(" " + initial + " ")
		settings := t.button("설정", m.settings != nil)
		if m.tool == "settings" {
			settings = fillBackground(" "+t.fg(t.shortcut).Underline(true).Render("설정")+" ", 0, t.bgHover)
		}
		nameWidth := width - lipgloss.Width(settings) - 9
		nameStyle := lipgloss.NewStyle().Bold(true).Foreground(t.title)
		if m.tool == "ws" {
			nameStyle = nameStyle.Foreground(t.shortcut).Underline(true)
		}
		profile := " " + avatar + " " + nameStyle.Render(truncate(name, nameWidth)) + " " + t.key("`")
		if m.tool == "ws" || m.tool == "settings" {
			// 맨 위 줄에 키보드 포커스가 있으면 왼쪽에 주황 막대를 보인다.
			profile = t.fg(t.shortcut).Render("▌") + profile[1:]
		}
		gap := max(1, width-lipgloss.Width(profile)-lipgloss.Width(settings)-1)
		b.segments(hit("ws", profile), seg(strings.Repeat(" ", gap)), hit("settings", settings))
	}
	b.line(t.fg(t.divider).Render(strings.Repeat("─", width)))

	// 2. 노트/휴지통 탭.
	half := (width - 2) / 2
	tab := func(label string, active bool) string {
		background, style := t.bgInput, lipgloss.NewStyle().Foreground(t.secondary)
		if active {
			background, style = t.bgHover, lipgloss.NewStyle().Foreground(t.title).Bold(true)
			// 탭에 키보드 포커스가 있으면 고른 탭 글자를 단축키 색으로 보인다(←/→로 바꿈).
			if m.tool == "tabs" {
				style = style.Foreground(t.shortcut).Underline(true)
				label = "◂ " + label + " ▸"
			}
		}
		gap := max(0, half-lipgloss.Width(label))
		return fillBackground(strings.Repeat(" ", gap/2)+style.Render(label), half, background)
	}
	tabMarker := " "
	if m.tool == "tabs" {
		tabMarker = t.fg(t.shortcut).Render("▌")
	}
	b.segments(seg(tabMarker), hit("tab:open", tab("노트", m.state == "open")), hit("tab:closed", tab("휴지통", m.state == "closed")))
	// 탭과 검색칸이 붙어 보이지 않게 어두운 가로선으로 나눈다.
	b.line(t.fg(t.divider).Render(strings.Repeat("─", width)))

	// 3. 검색(SidebarSearch).
	button := t.button("검색", false)
	inputWidth := width - lipgloss.Width(button) - 3
	m.search.SetWidth(inputWidth - 1)
	input := m.search.View()
	if m.search.Value() == "" && m.focus != focusSearch {
		input = t.fg(t.placeholder).Render("검색어 또는 #태그")
	}
	fieldBackground := t.bgInput
	if m.focus == focusSearch {
		fieldBackground = t.bgHover
	}
	field := fillBackground(input, inputWidth, fieldBackground)
	clear := " "
	if m.search.Value() != "" {
		clear = "✕"
	}
	searchMarker := " "
	if m.focus == focusSearch {
		searchMarker = t.fg(t.shortcut).Render("▌")
	}
	b.segments(seg(searchMarker), hit("search", field), hit("search-clear", t.fg(t.muted).Render(clear)), hit("search-btn", button))
	b.line(t.fg(t.divider).Render(strings.Repeat("─", width)))

	// 4. 새 노트와 음성 녹음.
	newWidth := width - 6
	newLabel := "+ 새 노트 " + t.key("N")
	newButton := t.primaryButton(newLabel, newWidth)
	if m.selectionMode() || (m.note != nil && m.note.pending) {
		newButton = fillBackground(lipgloss.PlaceHorizontal(newWidth, lipgloss.Center, t.fg(t.disabled).Render("+ 새 노트 N")), newWidth, t.bgInput)
	}
	mic := fillBackground(t.fg(t.faint).Render(" 🎤 "), 0, hex("#12302d"))
	if m.tool == "voice" {
		mic = fillBackground(t.fg(t.shortcut).Render(" 🎤 "), 0, t.bgHover)
	}
	newMarker := " "
	if m.tool == "new" || m.tool == "voice" {
		// 새 노트 줄에 키보드 포커스가 있으면 목록 행처럼 주황 막대를 보인다.
		newMarker = t.fg(t.shortcut).Render("▌")
	}
	if m.tool == "new" {
		newButton = fillBackground(lipgloss.PlaceHorizontal(newWidth, lipgloss.Center, lipgloss.NewStyle().Foreground(hex("#ffffff")).Bold(true).Underline(true).Render("+ 새 노트")+" "+t.key("N")), newWidth, t.accent)
	}
	b.segments(seg(newMarker), hit("new", newButton), hit("voice", mic))
	b.line(t.fg(t.divider).Render(strings.Repeat("─", width)))

	// 5. 목록. 고정 노트, 일반 노트, 더 보기.
	listHeight := height - b.height()
	list := newBlock(m.hits, 0, b.height(), width)
	rows := m.listRows(width)
	start := min(m.listScroll, max(0, len(rows)-1))
	if m.listErr != "" && len(rows) == 0 {
		list.blank()
		for _, line := range wrapText(m.listErr, width-4) {
			list.line("  " + t.fg(t.danger).Render(line))
		}
	}
	if len(rows) == 0 && m.listErr == "" {
		list.blank()
		text := m.emptyMessage()
		if m.loading {
			text = "목록 불러오는 중…"
		}
		list.line(lipgloss.PlaceHorizontal(width, lipgloss.Center, t.fg(t.faint).Render(text)))
	}
	for index := start; index < len(rows) && list.height() < listHeight; index++ {
		row := rows[index]
		if row.id != "" {
			list.area(row.id, 1)
		}
		list.line(row.text)
	}
	return b.render(-1) + "\n" + list.render(listHeight)
}

// listRow는 목록의 한 화면 줄이다. id가 있으면 그 줄을 누를 수 있다.
type listRow struct {
	text string
	id   string
}

func (m Model) emptyMessage() string {
	switch {
	case m.appliedQuery != "" || m.activeLabel != "":
		return "검색 결과가 없습니다."
	case m.state == "closed":
		return "최근 30일 안에 휴지통으로 옮긴 노트가 없습니다."
	}
	return "아직 노트가 없습니다."
}

// listRows는 목록 전체를 화면 줄로 편다. 스크롤은 이 줄 단위로 한다.
func (m Model) listRows(width int) []listRow {
	t := m.th
	var rows []listRow
	for _, issue := range m.pinned {
		rows = append(rows, m.issueRows(issue, true, width)...)
	}
	for _, issue := range m.issues {
		rows = append(rows, m.issueRows(issue, false, width)...)
	}
	if m.hasMore {
		label := "⌄ 더 보기"
		if m.loadingMore {
			label = "⠋ 불러오는 중…"
		}
		rows = append(rows, listRow{text: lipgloss.PlaceHorizontal(width, lipgloss.Center, t.fg(t.muted).Render(label)), id: "loadmore"})
	}
	return rows
}

// issueRows는 NoteListRow.svelte 한 행이다: 제목, 요약, #번호 · 시각, 태그, 구분선.
func (m Model) issueRows(issue github.Issue, pinned bool, width int) []listRow {
	t := m.th
	id := "row:" + strconv.FormatInt(issue.ID, 10)
	fields := m.prefs.ListRow
	// 편집 중인 노트는 저장 전 내용으로 보인다(noteDraftChanged).
	if n := m.note; n != nil && n.issue.ID == issue.ID && (n.dirty || n.pending) && n.lock == lockPlain {
		if title := n.currentTitle(m.prefs.TitleMode); title != "" {
			issue.Title = title
		}
		issue.Body = n.bodyText()
	}
	locked := notes.IsLockedTitle(issue.Title)
	pending := m.pendingDeletion(issue.ID)
	open := m.note != nil && m.note.issue.ID == issue.ID && issue.ID != 0
	focused := m.kbFocus == issue.ID
	checked := m.selected[issue.ID]

	left := 2
	if m.selectionMode() {
		left = 5
	}
	textWidth := width - left - 1
	var content []string
	if fields.Title {
		var badges string
		if due, ok := notes.DueBadge(issue.Body+"\n"+issue.Title, nowFunc()); ok {
			style := t.fg(t.faint)
			if due.Days <= 3 {
				style = t.fg(t.danger)
			}
			badges += style.Render("["+due.Label+"]") + " "
		}
		if pinned {
			badges += t.fg(t.danger).Render("📌") + " "
		}
		if locked {
			badges += t.fg(t.warning).Render("🔒") + " "
		}
		title := notes.MarkdownToPlainText(notes.RemoveLockFromTitle(issue.Title))
		content = append(content, badges+lipgloss.NewStyle().Bold(true).Foreground(t.title).Render(truncate(title, textWidth-lipgloss.Width(badges))))
	}
	if fields.Summary {
		summary := notes.Excerpt(issue.Body, issue.Title)
		if locked {
			summary = "잠금된 노트입니다"
		} else if summary == "" {
			summary = "내용이 없습니다."
		}
		content = append(content, t.fg(t.secondary).Render(truncate(summary, textWidth)))
	}
	if fields.Meta {
		content = append(content, t.fg(t.faint).Render(fmt.Sprintf("#%d · %s", issue.Number, listDate(issue))))
	}
	if fields.Tags {
		var tags []string
		for _, name := range notes.VisibleLabelNames(issue.LabelNames()) {
			tags = append(tags, lipgloss.NewStyle().Foreground(hex("#"+notes.TagColor(name))).Render("#"+name))
		}
		if len(tags) > 0 {
			content = append(content, truncate(strings.Join(tags, " "), textWidth))
		}
	}
	if pending {
		content = append(content, t.fg(t.danger).Render("⠋ 삭제 중… ")+t.fg(t.muted).Underline(true).Render("취소(Esc)"))
	}

	var rows []listRow
	for index, line := range content {
		prefix := strings.Repeat(" ", left)
		if m.selectionMode() && index == 0 {
			box := "[ ]"
			if checked {
				box = t.fg(t.accentBright).Render("[✓]")
			}
			prefix = " " + box + " "
		}
		text := fitLine(prefix+line, width-1)
		if pending || m.state == "closed" {
			text = lipgloss.NewStyle().Faint(true).Render(text)
		}
		if open || checked {
			text = fillBackground(text, width-1, t.selectedRow)
		}
		marker := " "
		if focused {
			// 웹의 키보드 포커스 테두리(주황 외곽선)를 왼쪽 막대로 그린다.
			marker = t.fg(t.shortcut).Render("▌")
		}
		rows = append(rows, listRow{text: marker + text, id: id})
	}
	rows = append(rows, listRow{text: t.fg(t.divider).Render(strings.Repeat("─", width))})
	return rows
}

func wrapText(text string, width int) []string {
	return strings.Split(lipgloss.NewStyle().Width(max(1, width)).Render(text), "\n")
}

func splitLines(text string) []string { return strings.Split(text, "\n") }
