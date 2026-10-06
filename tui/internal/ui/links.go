package ui

import (
	"regexp"
	"strings"

	"charm.land/bubbles/v2/textarea"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/zidell/ginote/tui/internal/notes"
	"github.com/zidell/ginote/tui/internal/voice"
)

// 본문·댓글의 링크. 웹 주소와 줄인 첨부 주소({repo}/…)에 밑줄을 긋고, 누르면 연다.
//   - 편집 중이 아닐 때 링크를 누르면 연다. 편집 중이면 평소처럼 커서를 두고, Ctrl·Option·⌘를
//     누른 채 누르면 연다(터미널이 그 키를 알려 줄 때).
//   - 이 노트의 첨부를 가리키면 훑어보기 창(attach.go), 그 밖은 브라우저로 연다.

var linkPattern = regexp.MustCompile(`https?://[^\s<>()\[\]"'` + "`" + `]+|\{repo\}/[^\s<>()\[\]"'` + "`" + `]+`)

// textLink는 편집기 한 논리 줄 안의 링크 하나다. start·end는 글자(rune) 위치다.
type textLink struct {
	row, start, end int
	url             string
}

// findLinks는 편집기 내용의 링크들이다. 끝에 붙은 문장부호는 뺀다.
func findLinks(value, repo string) []textLink {
	var links []textLink
	for row, line := range strings.Split(value, "\n") {
		for _, match := range linkPattern.FindAllStringIndex(line, -1) {
			text := strings.TrimRight(line[match[0]:match[1]], ".,;:!?")
			start := len([]rune(line[:match[0]]))
			url := text
			if strings.HasPrefix(text, notes.AttachmentLinkPlaceholder) {
				url = notes.ExpandAttachmentLinks(text, repo)
			}
			links = append(links, textLink{row: row, start: start, end: start + len([]rune(text)), url: url})
		}
	}
	return links
}

// linkAt은 편집기 안 (x, y)에 있는 링크 주소다.
func linkAt(area *textarea.Model, repo string, x, y int) string {
	position := area.PositionAt(max(0, x), max(0, y))
	// 줄 끝 너머를 누른 것은 링크가 아니다.
	lines := strings.Split(area.Value(), "\n")
	if position.Row < len(lines) && x >= ansi.StringWidth(wrappedRowText(area, lines, y)) {
		return ""
	}
	for _, link := range findLinks(area.Value(), repo) {
		if link.row == position.Row && position.Col >= link.start && position.Col < link.end {
			return link.url
		}
	}
	return ""
}

// rowSpan은 화면 줄 y가 보이는 논리 줄과 그 줄의 글자 범위다.
func rowSpan(area *textarea.Model, lines []string, y int) (row, from, to int) {
	start := area.PositionAt(0, y)
	next := area.PositionAt(0, y+1)
	to = len([]rune(lines[min(start.Row, len(lines)-1)]))
	if next.Row == start.Row && next.Col > start.Col {
		to = next.Col
	}
	return start.Row, start.Col, to
}

func wrappedRowText(area *textarea.Model, lines []string, y int) string {
	row, from, to := rowSpan(area, lines, y)
	if row >= len(lines) {
		return ""
	}
	runes := []rune(lines[row])
	return string(runes[min(from, len(runes)):min(to, len(runes))])
}

// underlineLinks는 편집기 화면(View)의 링크 자리에 밑줄을 긋는다. 줄바꿈으로 나뉜 링크도 잇는다.
func underlineLinks(view string, area *textarea.Model, repo string, color string) string {
	value := area.Value()
	links := findLinks(value, repo)
	if len(links) == 0 {
		return view
	}
	lines := strings.Split(value, "\n")
	rendered := strings.Split(view, "\n")
	for y := range rendered {
		row, from, to := rowSpan(area, lines, y)
		if row >= len(lines) {
			continue
		}
		runes := []rune(lines[row])
		// 화면 줄 하나에 링크가 여럿이면 뒤에서부터 칠해 앞 위치가 밀리지 않게 한다.
		for index := len(links) - 1; index >= 0; index-- {
			link := links[index]
			if link.row != row {
				continue
			}
			a, b := max(link.start, from), min(link.end, to)
			if a >= b || b > len(runes) {
				continue
			}
			x0 := ansi.StringWidth(string(runes[from:a]))
			x1 := x0 + ansi.StringWidth(string(runes[a:b]))
			line := rendered[y]
			middle := ansi.Cut(line, x0, x1)
			middle = strings.NewReplacer("\x1b[m", "\x1b[m\x1b[4m"+color, "\x1b[0m", "\x1b[0m\x1b[4m"+color).Replace(middle)
			rendered[y] = ansi.Cut(line, 0, x0) + "\x1b[4m" + color + middle + "\x1b[24m\x1b[39m" + ansi.TruncateLeft(line, x1, "")
		}
	}
	return strings.Join(rendered, "\n")
}

// linkColor는 밑줄 링크의 글자색 시작 코드다.
func (m Model) linkColor() string {
	rendered := lipgloss.NewStyle().Foreground(m.th.link).Render("\x00")
	return strings.SplitN(rendered, "\x00", 2)[0]
}

// openLink는 링크를 연다. 이 노트의 첨부면 훑어보기 창으로 연다.
func (m Model) openLink(url string) (tea.Model, tea.Cmd) {
	if n := m.note; n != nil {
		path := voice.AttachmentPathFromRawURL(url)
		for index, attachment := range n.attachments {
			if path != "" && attachment.Path == path {
				return m.previewAttachment(index)
			}
		}
	}
	return m, openURL(url)
}

// clickLink는 편집기 링크를 누른 것인지 본다. 편집 중이 아니거나 보조키를 눌렀으면 연다.
func (m Model) clickLink(area *textarea.Model, zone hitZone, editing, modifier bool) (tea.Model, tea.Cmd, bool) {
	if editing && !modifier {
		return m, nil, false
	}
	url := linkAt(area, m.repo(), m.lastClickX-zone.originX, m.lastClickY-zone.originY)
	if url == "" {
		return m, nil, false
	}
	next, cmd := m.openLink(url)
	return next, cmd, true
}
