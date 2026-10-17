package ui

import (
	"fmt"
	"image/color"
	"regexp"
	"strconv"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// hitMap은 마우스로 누를 수 있는 영역이다. View가 그리면서 좌표를 적고, Update가 클릭 위치로
// 찾는다. 나중에 적은 영역(겹쳐 뜬 메뉴 등)이 위에 있으므로 뒤에서부터 찾는다.
type hitMap struct {
	zones []hitZone
}

type hitZone struct {
	id             string
	x0, y0, x1, y1 int // x1, y1은 포함하지 않는다
	// originX, originY는 편집기처럼 영역 안 클릭 위치가 필요한 곳의 기준점이다(화면 밖일 수 있음).
	originX, originY int
}

func (h *hitMap) reset() { h.zones = h.zones[:0] }

func (h *hitMap) add(id string, x, y, width, height int) {
	if width <= 0 || height <= 0 {
		return
	}
	h.zones = append(h.zones, hitZone{id: id, x0: x, y0: y, x1: x + width, y1: y + height})
}

// addWithOrigin은 클릭 위치를 originX, originY 기준으로 바꿔 쓸 영역을 적는다.
func (h *hitMap) addWithOrigin(id string, x, y, width, height, originX, originY int) {
	if width <= 0 || height <= 0 {
		return
	}
	h.zones = append(h.zones, hitZone{id: id, x0: x, y0: y, x1: x + width, y1: y + height, originX: originX, originY: originY})
}

// lookup은 id로 영역을 찾는다(메뉴를 버튼 아래에 띄울 때).
func (h *hitMap) lookup(id string) (hitZone, bool) {
	for index := len(h.zones) - 1; index >= 0; index-- {
		if h.zones[index].id == id {
			return h.zones[index], true
		}
	}
	return hitZone{}, false
}

func (h *hitMap) find(x, y int) (hitZone, bool) {
	for index := len(h.zones) - 1; index >= 0; index-- {
		zone := h.zones[index]
		if x >= zone.x0 && x < zone.x1 && y >= zone.y0 && y < zone.y1 {
			return zone, true
		}
	}
	return hitZone{}, false
}

// block은 화면의 한 덩어리를 그리는 도구다. 줄을 쌓으면서 그 줄에 놓인 버튼의 클릭 영역을
// 절대 좌표로 적는다.
type block struct {
	x, y, width int
	lines       []string
	hits        *hitMap
}

func newBlock(hits *hitMap, x, y, width int) *block {
	return &block{x: x, y: y, width: width, hits: hits}
}

// line은 한 줄을 더한다. 넘치는 부분은 자르고 모자라면 채운다.
func (b *block) line(text string) int {
	b.lines = append(b.lines, fitLine(text, b.width))
	return len(b.lines) - 1
}

// segments는 여러 조각으로 이뤄진 한 줄을 더하고, id가 있는 조각마다 클릭 영역을 적는다.
func (b *block) segments(parts ...segment) {
	var builder strings.Builder
	column := 0
	row := len(b.lines)
	for _, part := range parts {
		width := lipgloss.Width(part.text)
		if part.id != "" && column < b.width {
			b.hits.add(part.id, b.x+column, b.y+row, min(width, b.width-column), 1)
		}
		builder.WriteString(part.text)
		column += width
	}
	b.line(builder.String())
}

// area는 지금 위치부터 height줄짜리 클릭 영역을 적는다(목록 행 전체 등).
func (b *block) area(id string, height int) {
	b.hits.add(id, b.x, b.y+len(b.lines), b.width, height)
}

func (b *block) blank() { b.line("") }

func (b *block) height() int { return len(b.lines) }

func (b *block) render(height int) string {
	lines := b.lines
	if height >= 0 {
		if len(lines) > height {
			lines = lines[:height]
		}
		for len(lines) < height {
			lines = append(lines, strings.Repeat(" ", b.width))
		}
	}
	return strings.Join(lines, "\n")
}

type segment struct {
	text string
	id   string
}

func seg(text string) segment            { return segment{text: text} }
func hit(id string, text string) segment { return segment{text: text, id: id} }

func fitLine(text string, width int) string {
	text = ansi.Truncate(text, width, "")
	if gap := width - ansi.StringWidth(text); gap > 0 {
		text += strings.Repeat(" ", gap)
	}
	return text
}

// fillBackground는 text 전체(그리고 width까지 채운 빈칸)에 배경색을 깐다. 안쪽 조각의
// 색 초기화(ESC[m)가 배경까지 지우지 않도록 초기화 뒤마다 배경을 다시 건다.
func fillBackground(text string, width int, background color.Color) string {
	if width > 0 {
		text = fitLine(text, width)
	}
	sequence := ansi.Style{}.BackgroundColor(background).String()
	text = strings.ReplaceAll(text, "\x1b[m", "\x1b[m"+sequence)
	text = strings.ReplaceAll(text, "\x1b[0m", "\x1b[0m"+sequence)
	return sequence + text + "\x1b[m"
}

// stripStyles는 색 같은 ANSI 꾸밈을 뺀 글자다.
func stripStyles(text string) string { return ansi.Strip(text) }

// truncate는 넘치면 말줄임표로 자른다.
func truncate(text string, width int) string {
	if width <= 0 {
		return ""
	}
	return ansi.Truncate(text, width, "…")
}

// overlay는 base 위 (x, y)에 top을 겹쳐 그린다. 줄마다 왼쪽·top·오른쪽을 이어 붙인다.
func overlay(base string, top string, x, y int) string {
	baseLines := strings.Split(base, "\n")
	for row, line := range strings.Split(top, "\n") {
		target := y + row
		if target < 0 || target >= len(baseLines) {
			continue
		}
		under := baseLines[target]
		width := ansi.StringWidth(line)
		left := ansi.Truncate(under, x, "")
		if gap := x - ansi.StringWidth(left); gap > 0 {
			left += strings.Repeat(" ", gap)
		}
		// 오른쪽 조각은 잘린 앞부분에서 켠 색을 잃으므로, 앞부분의 SGR을 차례로 다시 적용해 이어 간다
		// (어둡게 한 화면에서 색을 지정하지 않은 칸이 원래 밝기로 돌아오지 않게).
		state := strings.Join(sgrPattern.FindAllString(ansi.Truncate(under, x+width, ""), -1), "")
		right := ansi.TruncateLeft(under, x+width, "")
		baseLines[target] = left + "\x1b[m" + line + "\x1b[m" + state + right
	}
	return strings.Join(baseLines, "\n")
}

// modalScrim은 모달 아래 화면에 남길 밝기다. 글자만 흐리게(SGR 2) 하면 배경이 그대로라 덜 가려지므로,
// 웹의 반투명 마스크처럼 글자색·배경색을 모두 검정 쪽으로 섞는다.
const modalScrim = 0.4

// dim은 모달 아래 화면을 어둡게 한다. 트루컬러 글자·배경색을 어둡게 바꾸고, 색을 지정하지 않은 칸은
// 터미널 기본색(앱 배경·본문색)을 어둡게 한 값으로 칠한다.
func (t theme) dim(content string) string {
	reset := "\x1b[0;" + scrimSGR(38, t.text) + ";" + scrimSGR(48, t.bgApp) + "m"
	lines := strings.Split(content, "\n")
	for index, line := range lines {
		line = sgrPattern.ReplaceAllStringFunc(line, func(seq string) string {
			return dimSGR(seq[2:len(seq)-1], t)
		})
		lines[index] = reset + line + "\x1b[m"
	}
	return strings.Join(lines, "\n")
}

var sgrPattern = regexp.MustCompile("\x1b\\[[0-9;]*m")

func scrimSGR(kind int, c color.Color) string {
	r, g, b, _ := c.RGBA()
	scale := func(v uint32) int { return int(float64(v>>8) * modalScrim) }
	return fmt.Sprintf("%d;2;%d;%d;%d", kind, scale(r), scale(g), scale(b))
}

// dimSGR은 SGR 매개변수 하나를 어둡게 바꾼다. 초기화(0, 39, 49)는 어둡게 한 기본색으로 돌린다.
func dimSGR(params string, t theme) string {
	if params == "" {
		params = "0"
	}
	parts := strings.Split(params, ";")
	var out []string
	for i := 0; i < len(parts); i++ {
		switch parts[i] {
		case "0", "":
			out = append(out, "0", scrimSGR(38, t.text), scrimSGR(48, t.bgApp))
		case "39":
			out = append(out, scrimSGR(38, t.text))
		case "49":
			out = append(out, scrimSGR(48, t.bgApp))
		case "38", "48":
			if i+4 < len(parts) && parts[i+1] == "2" {
				var rgb [3]int
				for j := range rgb {
					rgb[j], _ = strconv.Atoi(parts[i+2+j])
				}
				out = append(out, scrimSGR(atoi(parts[i]), color.RGBA{uint8(rgb[0]), uint8(rgb[1]), uint8(rgb[2]), 255}))
				i += 4
				continue
			}
			out = append(out, parts[i])
		default:
			out = append(out, parts[i])
		}
	}
	return "\x1b[" + strings.Join(out, ";") + "m"
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// panel은 테두리 상자다. 줄마다 배경을 채워 안쪽 색 조각 사이에 빈 곳이 생기지 않게 한다.
func panel(lines []string, innerWidth int, background, border color.Color, padX int) string {
	pad := strings.Repeat(" ", padX)
	var filled []string
	for _, line := range lines {
		filled = append(filled, fillBackground(pad+line, innerWidth+padX*2, background))
	}
	return lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(border).
		BorderBackground(background).Render(strings.Join(filled, "\n"))
}
