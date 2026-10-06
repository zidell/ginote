package ui

import (
	"fmt"
	"strconv"
	"strings"
	"sync"

	"charm.land/glamour/v2"
	"charm.land/glamour/v2/styles"
	"charm.land/lipgloss/v2"

	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/notes"
)

// 본문 열의 최대 너비(웹 editor_max_width 840px을 글자 수로 옮긴 값).
const detailMaxContentWidth = 100

// detailGeometry는 노트 영역의 위치다. View와 Update가 같은 계산을 쓴다.
type detailGeometry struct {
	x, y, width, height int
	contentX            int
	contentWidth        int
	viewTop             int // 내용이 시작하는 화면 줄(툴바 아래)
	viewHeight          int
}

func (m Model) detailGeometry() detailGeometry {
	x, width := 0, m.width
	if m.wide() {
		x = m.sidebarWidth() + 1
		width = m.width - x
	}
	height := m.height - m.footerHeight()
	contentWidth := min(detailMaxContentWidth, max(10, width-6))
	return detailGeometry{
		x: x, y: 0, width: width, height: height,
		contentX:     x + (width-contentWidth)/2,
		contentWidth: contentWidth,
		viewTop:      2,
		viewHeight:   max(1, height-2),
	}
}

// detailContent는 노트 본문 영역 전체를 줄 단위로 편 것이다. 스크롤과 클릭 위치 계산에 쓴다.
type detailContent struct {
	lines []string
	zones []contentZone
	// 편집기의 내용 안 줄 위치. 커서와 클릭 위치 계산에 쓴다.
	titleLine    int
	bodyLine     int
	commentLines map[int]int
}

type contentZone struct {
	id     string
	line   int
	x      int // contentX 기준
	width  int
	height int
	origin bool // 편집기라 클릭 위치를 넘겨야 하는 영역
}

func (c *detailContent) add(line string) int {
	c.lines = append(c.lines, line)
	return len(c.lines) - 1
}

// addSegments는 버튼이 섞인 한 줄을 더하고 버튼 영역을 적는다.
func (c *detailContent) addSegments(parts ...segment) {
	var builder strings.Builder
	column := 0
	for _, part := range parts {
		width := lipgloss.Width(part.text)
		if part.id != "" {
			c.zones = append(c.zones, contentZone{id: part.id, line: len(c.lines), x: column, width: width, height: 1})
		}
		builder.WriteString(part.text)
		column += width
	}
	c.add(builder.String())
}

func (m Model) buildDetailContent(g detailGeometry) detailContent {
	t := m.th
	n := m.note
	content := detailContent{titleLine: -1, bodyLine: -1, commentLines: map[int]int{}}
	content.add("")
	if n.err != "" {
		for _, line := range wrapText(n.err, g.contentWidth) {
			content.add(t.fg(t.danger).Render(line))
		}
		content.add("")
	}
	editable := n.editable(m.state == "closed") && !m.selectionMode()

	if n.lock == lockLocked {
		content.add(t.fg(t.warning).Render("🔒 잠긴 노트입니다."))
		content.addSegments(hit("unlock", t.button("잠금 열기 (Enter · L)", false)))
		content.add("")
		// 웹처럼 저장된 암호문을 읽기 전용으로 그대로 보인다.
		for _, line := range wrapText(n.encryptedBody, g.contentWidth) {
			content.add(t.fg(t.faint).Render(line))
		}
		content.add("")
	}

	// 첨부파일(AttachmentGrid). 웹처럼 모든 첨부를 같은 크기 타일로 놓고, 끝(오른쪽)에 추가 타일을 둔다.
	// 이미지는 썸네일, 그 밖은 FILE과 확장자를 보인다.
	if len(n.attachments) > 0 {
		canAdd := editable && !n.preview && n.number() != 0
		count := len(n.attachments)
		if canAdd {
			count++
		}
		perRow := max(1, (g.contentWidth+2)/(thumbCols+2))
		for first := 0; first < count; first += perRow {
			last := min(count, first+perRow)
			tiles := make([][]string, 0, last-first)
			for index := first; index < last; index++ {
				if index == len(n.attachments) {
					tiles = append(tiles, m.renderAddTile())
				} else {
					tiles = append(tiles, m.renderThumb(n.attachments[index]))
				}
			}
			tileID := func(index int) string {
				if index == len(n.attachments) {
					return "attadd"
				}
				return "att:" + strconv.Itoa(index)
			}
			for line := 0; line < thumbRows; line++ {
				var parts []segment
				for position := range tiles {
					if position > 0 {
						parts = append(parts, seg("  "))
					}
					parts = append(parts, hit(tileID(first+position), tiles[position][line]))
				}
				content.addSegments(parts...)
			}
			var names []segment
			for index := first; index < last; index++ {
				if index > first {
					names = append(names, seg("  "))
				}
				if index == len(n.attachments) {
					names = append(names, hit("attadd", fitLine(t.fg(t.muted).Render("첨부 추가 ")+t.key("A"), thumbCols)))
					continue
				}
				remove := ""
				if editable && !n.preview {
					remove = "✕"
				}
				label := fitLine(t.fg(t.link).Render(truncate(n.attachments[index].Name, thumbCols-2)), thumbCols-lipgloss.Width(remove))
				names = append(names, hit("att:"+strconv.Itoa(index), label))
				if remove != "" {
					names = append(names, hit("attx:"+strconv.Itoa(index), t.fg(t.danger).Render(remove)))
				}
			}
			content.addSegments(names...)
			content.add("")
		}
	}

	// 태그 칩(editor-tags).
	if len(n.labels) > 0 || (editable && !n.preview) {
		var parts []segment
		for _, name := range n.labels {
			color := hex("#" + notes.TagColor(name))
			chip := fillBackground(" "+lipgloss.NewStyle().Foreground(color).Render("#"+name), 0, t.bgInput)
			parts = append(parts, hit("chip:"+name, chip))
			if editable && !n.preview {
				parts = append(parts, hit("chipx:"+name, fillBackground(t.fg(t.muted).Render(" × "), 0, t.bgInput)))
			} else {
				parts = append(parts, seg(fillBackground(" ", 0, t.bgInput)))
			}
			parts = append(parts, seg(" "))
		}
		if editable && !n.preview {
			parts = append(parts, hit("chipadd", t.fg(t.muted).Render("[+추가]")))
		}
		content.addSegments(parts...)
		content.add("")
	}

	if m.prefs.TitleMode == config.TitleSeparate && n.lock != lockLocked {
		if n.preview {
			if title := strings.TrimSpace(n.title.Value()); title != "" {
				content.add(lipgloss.NewStyle().Bold(true).Foreground(t.title).Render(title))
			}
		} else {
			n.title.SetWidth(g.contentWidth)
			content.titleLine = content.add(n.title.View())
			content.zones = append(content.zones, contentZone{id: "title", line: content.titleLine, width: g.contentWidth, height: 1, origin: true})
			content.add(t.fg(t.border).Render(strings.Repeat("─", g.contentWidth)))
		}
	}

	if n.lock != lockLocked {
		if n.preview {
			for _, line := range splitLines(m.renderMarkdown(n.body.Value(), g.contentWidth)) {
				content.add(line)
			}
		} else {
			n.body.SetWidth(g.contentWidth)
			start := len(content.lines)
			view := underlineLinks(n.body.View(), &n.body, n.repo, m.linkColor())
			for _, line := range splitLines(view) {
				content.add(line)
			}
			content.bodyLine = start
			content.zones = append(content.zones, contentZone{id: "body", line: start, width: g.contentWidth, height: len(content.lines) - start, origin: true})
		}
	}

	// 댓글(note-comments-section).
	if n.number() != 0 && (n.commentsLoading || len(n.comments) > 0 || editable) {
		content.add("")
		content.add(t.fg(t.border).Render(strings.Repeat("─", g.contentWidth)))
		if n.commentsLoading && n.issue.Comments > 0 && len(n.comments) == 0 {
			content.add(t.fg(t.faint).Render("⠋"))
		}
		for index := range n.comments {
			comment := &n.comments[index]
			meta := lipgloss.NewStyle().Bold(true).Foreground(t.secondary).Render(comment.comment.Author) + "  " +
				t.fg(t.faint).Render(dateTime(comment.comment.UpdatedAt))
			status := ""
			switch {
			case comment.saving:
				status = t.fg(t.faint).Render("⠋ ")
			case comment.failed:
				status = t.fg(t.danger).Render("저장 실패 ")
			}
			parts := []segment{seg(meta)}
			if editable && !n.preview {
				gap := max(1, g.contentWidth-lipgloss.Width(meta)-lipgloss.Width(status)-2)
				parts = append(parts, seg(strings.Repeat(" ", gap)+status), hit("cmore:"+strconv.Itoa(index), t.fg(t.muted).Render("⋯")))
			}
			content.addSegments(parts...)
			start := len(content.lines)
			if n.preview {
				for _, line := range splitLines(m.renderMarkdown(comment.comment.Body, g.contentWidth)) {
					content.add(line)
				}
			} else {
				comment.editor.SetWidth(g.contentWidth)
				for _, line := range splitLines(underlineLinks(comment.editor.View(), &comment.editor, n.repo, m.linkColor())) {
					content.add(line)
				}
				content.zones = append(content.zones, contentZone{id: "comment:" + strconv.Itoa(index), line: start, width: g.contentWidth, height: len(content.lines) - start, origin: true})
			}
			content.commentLines[index] = start
			content.add("")
		}
		if editable && !n.preview {
			add := t.fg(t.muted).Render("+ 댓글 추가")
			voice := t.fg(t.muted).Render("🎤 음성 추가")
			gap := max(1, g.contentWidth-lipgloss.Width(add)-lipgloss.Width(voice))
			content.addSegments(hit("addcomment", add), seg(strings.Repeat(" ", gap)), hit("voice-comment", voice))
		}
	}
	content.add("")
	return content
}

// 미리보기는 화면을 다시 그릴 때마다(1초 tick 포함) 그리므로, 렌더러와 결과를 기억해 두고
// 같은 본문·너비·화면 모드면 다시 만들지 않는다. 결과는 markdownCacheMax개를 넘으면 비운다.
const markdownCacheMax = 64

type markdownKey struct {
	source string
	width  int
	dark   bool
}

var markdownCache = struct {
	sync.Mutex
	renderer *glamour.TermRenderer
	width    int
	dark     bool
	out      map[markdownKey]string
}{out: map[markdownKey]string{}}

func (m Model) renderMarkdown(source string, width int) string {
	if strings.TrimSpace(source) == "" {
		return m.th.fg(m.th.faint).Render("내용이 없습니다.")
	}
	dark := m.dark()
	key := markdownKey{source, width, dark}
	markdownCache.Lock()
	defer markdownCache.Unlock()
	if out, ok := markdownCache.out[key]; ok {
		return out
	}
	if markdownCache.renderer == nil || markdownCache.width != width || markdownCache.dark != dark {
		style := styles.DarkStyle
		if !dark {
			style = styles.LightStyle
		}
		renderer, err := glamour.NewTermRenderer(glamour.WithStandardStyle(style), glamour.WithWordWrap(width))
		if err != nil {
			return source
		}
		markdownCache.renderer, markdownCache.width, markdownCache.dark = renderer, width, dark
	}
	out, err := markdownCache.renderer.Render(source)
	if err != nil {
		return source
	}
	out = strings.Trim(out, "\n")
	if len(markdownCache.out) >= markdownCacheMax {
		clear(markdownCache.out)
	}
	markdownCache.out[key] = out
	return out
}

// renderDetail은 NoteEditor.svelte를 그린다. 반환값의 커서는 입력 중인 칸의 화면 좌표다.
func (m Model) renderDetail(g detailGeometry) (string, *cursorPos) {
	t := m.th
	if m.note == nil {
		return m.renderDetailEmpty(g), nil
	}
	n := m.note
	b := newBlock(m.hits, g.x, g.y, g.width)

	// 툴바(detail-toolbar).
	var left []segment
	if !m.wide() {
		left = append(left, hit("back", t.button("← 목록", false)), seg(" "))
	}
	info := ""
	switch n.lock {
	case lockLocked:
		info = t.fg(t.warning).Render("🔒 ")
	case lockUnlocked:
		info = t.fg(t.warning).Render("🔓 ")
	}
	left = append(left, seg(" "+info))
	if n.number() != 0 {
		left = append(left, hit("copynumber", t.fg(t.faint).Render(fmt.Sprintf("#%d", n.number()))), seg(t.fg(t.faint).Render(" | "+dateOnly(n.issue.UpdatedAt))))
	} else {
		left = append(left, seg(t.fg(t.faint).Render("새 노트")))
	}
	if status := n.statusText(); status != "" {
		style := t.fg(t.faint)
		if n.saveFailed {
			style = t.fg(t.danger)
		}
		left = append(left, seg("  "+style.Render(status)))
	}
	var center []segment
	editable := n.editable(m.state == "closed") && !m.selectionMode()
	switch {
	case n.preview:
		center = append(center, hit("preview-close", t.button("✕ 닫기 ("+t.key("M")+")", false)))
	case editable:
		center = append(center,
			hit("tb:tag", t.button("# 태그 "+t.key("T"), m.picker != nil)), seg(" "),
			hit("tb:attach", t.button("📎 첨부 "+t.key("A"), false)))
	}
	more := t.button("⋮", m.choice != nil && m.choice.kind == "note")
	leftWidth, centerWidth, moreWidth := segmentsWidth(left), segmentsWidth(center), lipgloss.Width(more)
	centerStart := max(leftWidth+1, (g.width-centerWidth)/2)
	parts := append([]segment{}, left...)
	parts = append(parts, seg(strings.Repeat(" ", max(0, centerStart-leftWidth))))
	parts = append(parts, center...)
	parts = append(parts, seg(strings.Repeat(" ", max(1, g.width-centerStart-centerWidth-moreWidth-1))), hit("tb:more", more))
	b.segments(parts...)
	b.line(t.fg(t.border).Render(strings.Repeat("─", g.width)))

	// 내용과 스크롤.
	content := m.buildDetailContent(g)
	scroll := min(m.detailScroll, max(0, len(content.lines)-g.viewHeight))
	pad := strings.Repeat(" ", g.contentX-g.x)
	for row := 0; row < g.viewHeight; row++ {
		index := scroll + row
		if index >= len(content.lines) {
			b.line("")
			continue
		}
		b.line(pad + content.lines[index])
	}
	for _, zone := range content.zones {
		top := g.y + g.viewTop + zone.line - scroll
		bottom := top + zone.height
		visibleTop := max(top, g.y+g.viewTop)
		visibleBottom := min(bottom, g.y+g.viewTop+g.viewHeight)
		if visibleBottom <= visibleTop {
			continue
		}
		x := g.contentX + zone.x
		if zone.origin {
			m.hits.addWithOrigin(zone.id, x, visibleTop, zone.width, visibleBottom-visibleTop, x, top)
		} else {
			m.hits.add(zone.id, x, visibleTop, zone.width, visibleBottom-visibleTop)
		}
	}
	// 노트 영역 어디든 누르면(편집기 밖) 입력칸 포커스를 푼다.
	return b.render(g.height), m.detailCursor(g, content, scroll)
}

func segmentsWidth(parts []segment) int {
	width := 0
	for _, part := range parts {
		width += lipgloss.Width(part.text)
	}
	return width
}

type cursorPos struct{ x, y int }

func (m Model) detailCursor(g detailGeometry, content detailContent, scroll int) *cursorPos {
	n := m.note
	var line int
	var x, y int
	switch m.focus {
	case focusBody:
		cursor := n.body.Cursor()
		if cursor == nil || content.bodyLine < 0 {
			return nil
		}
		line, x, y = content.bodyLine, cursor.X, cursor.Y
	case focusTitle:
		cursor := n.title.Cursor()
		if cursor == nil || content.titleLine < 0 {
			return nil
		}
		line, x, y = content.titleLine, cursor.X, cursor.Y
	case focusComment:
		start, ok := content.commentLines[n.commentFocus]
		if !ok || n.commentFocus >= len(n.comments) {
			return nil
		}
		cursor := n.comments[n.commentFocus].editor.Cursor()
		if cursor == nil {
			return nil
		}
		line, x, y = start, cursor.X, cursor.Y
	default:
		return nil
	}
	row := line + y - scroll
	if row < 0 || row >= g.viewHeight {
		return nil
	}
	return &cursorPos{x: g.contentX + x, y: g.y + g.viewTop + row}
}

// cursorContentLine은 입력 중인 칸의 커서가 내용 안 몇째 줄인지다. 스크롤을 맞출 때 쓴다.
func (m Model) cursorContentLine(content detailContent) int {
	n := m.note
	switch m.focus {
	case focusBody:
		if cursor := n.body.Cursor(); cursor != nil && content.bodyLine >= 0 {
			return content.bodyLine + cursor.Y
		}
	case focusTitle:
		return content.titleLine
	case focusComment:
		if start, ok := content.commentLines[n.commentFocus]; ok && n.commentFocus < len(n.comments) {
			if cursor := n.comments[n.commentFocus].editor.Cursor(); cursor != nil {
				return start + cursor.Y
			}
		}
	}
	return -1
}

// keepCursorVisible은 편집 중인 줄이 보이도록 노트 스크롤을 맞춘다.
func (m *Model) keepCursorVisible() {
	if m.note == nil {
		return
	}
	g := m.detailGeometry()
	content := m.buildDetailContent(g)
	line := m.cursorContentLine(content)
	if line < 0 {
		return
	}
	if line < m.detailScroll {
		m.detailScroll = line
	} else if line >= m.detailScroll+g.viewHeight {
		m.detailScroll = line - g.viewHeight + 1
	}
}

// layoutNote는 창 크기나 노트가 바뀐 뒤 스크롤을 범위 안으로 맞춘다.
func (m *Model) layoutNote() {
	if m.note == nil {
		m.detailScroll = 0
		return
	}
	g := m.detailGeometry()
	content := m.buildDetailContent(g)
	m.detailScroll = min(m.detailScroll, max(0, len(content.lines)-g.viewHeight))
	m.keepCursorVisible()
}

// renderDetailEmpty는 노트를 고르지 않았을 때의 안내다(detail-empty-guide).
func (m Model) renderDetailEmpty(g detailGeometry) string {
	t := m.th
	b := newBlock(m.hits, g.x, g.y, g.width)
	top := g.height/2 - 2
	for b.height() < top {
		b.blank()
	}
	b.line(lipgloss.PlaceHorizontal(g.width, lipgloss.Center, t.fg(t.faint).Render("왼쪽 목록에서 노트를 선택하세요.")))
	b.blank()
	links := []struct{ id, label string }{
		{"help:security", "보안 안내"}, {"help:mcp", "MCP 안내"}, {"help:app", "설치 안내"}, {"help:keyboard", "단축키 안내"},
	}
	var parts []segment
	width := 0
	for index, link := range links {
		if index > 0 {
			parts = append(parts, seg(t.fg(t.disabled).Render("  |  ")))
			width += 5
		}
		text := t.fg(t.faint).Underline(true).Render(link.label)
		parts = append(parts, hit(link.id, text))
		width += lipgloss.Width(text)
	}
	b.segments(append([]segment{seg(strings.Repeat(" ", max(0, (g.width-width)/2)))}, parts...)...)
	return b.render(g.height)
}

func fileSize(size int64) string {
	switch {
	case size >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(size)/float64(1<<20))
	case size >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(size)/float64(1<<10))
	}
	return fmt.Sprintf("%d B", size)
}
