package ui

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"math/rand/v2"
	"path/filepath"
	"strings"
	"sync"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/charmbracelet/x/ansi/kitty"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"

	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/notes"
)

// 이미지 첨부 썸네일(웹의 AttachmentGrid 미리보기). Terminal.app에서도 보이도록 글자 칸
// 하나를 위아래 두 점으로 나눠(▀: 글자색이 위, 배경색이 아래) 줄인 그림을 모자이크처럼 보인다.
// 이미지는 노트를 열 때 한 번 내려받아 작게 줄여 기억한다.

const (
	thumbCols    = 18 // 썸네일 너비(칸)
	thumbRows    = 7  // 썸네일 높이(줄). 점으로는 두 배
	thumbKeep    = 96 // 기억해 둘 줄인 그림의 긴 변(점)
	kittyQueryID = 0x765432
)

type thumbState struct {
	img       image.Image
	failed    bool
	loading   bool
	id        int
	uploading bool
	uploaded  bool
}

// thumbCache는 첨부 경로별 썸네일이다. Model을 복사해도 같은 것을 쓰도록 포인터로 둔다.
type thumbCache struct {
	mu       sync.Mutex
	items    map[string]*thumbState
	rendered map[string][]string
	nextID   int
}

func newThumbCache() *thumbCache {
	return &thumbCache{items: map[string]*thumbState{}, rendered: map[string][]string{}, nextID: 0x10000 + int(rand.Uint32()%0xe00000)}
}

// Kitty 이미지 프로토콜을 묻는다. 응답이 없는 터미널에서는 기존 문자 썸네일을 쓴다.
func queryKittyGraphics() tea.Cmd {
	opts := kitty.Options{Action: kitty.Query, ID: kittyQueryID, Format: kitty.RGB, ImageWidth: 1, ImageHeight: 1}
	return tea.Raw(ansi.KittyGraphics([]byte("AAAA"), opts.Options()...))
}

type thumbUploadedMsg struct {
	path string
	id   int
}

func (m Model) uploadCachedThumbnails() tea.Cmd {
	if m.thumbs == nil {
		return nil
	}
	m.thumbs.mu.Lock()
	paths := make([]string, 0, len(m.thumbs.items))
	for path, state := range m.thumbs.items {
		if state.img != nil && !state.failed && !state.uploaded && !state.uploading {
			paths = append(paths, path)
		}
	}
	m.thumbs.mu.Unlock()
	var commands []tea.Cmd
	for _, path := range paths {
		if cmd := m.uploadThumbnail(path); cmd != nil {
			commands = append(commands, cmd)
		}
	}
	return tea.Batch(commands...)
}

func (m Model) uploadThumbnail(path string) tea.Cmd {
	if !m.kittyGraphics || m.thumbs == nil {
		return nil
	}
	m.thumbs.mu.Lock()
	state := m.thumbs.items[path]
	if state == nil || state.img == nil || state.failed || state.uploading || state.uploaded {
		m.thumbs.mu.Unlock()
		return nil
	}
	if state.id == 0 {
		state.id = m.thumbs.nextID
		m.thumbs.nextID++
		if m.thumbs.nextID > 0xefffff {
			m.thumbs.nextID = 0x10000
		}
	}
	state.uploading = true
	id, img := state.id, state.img
	m.thumbs.mu.Unlock()

	var encoded bytes.Buffer
	opts := kitty.Options{Action: kitty.TransmitAndPut, ID: id, Format: kitty.PNG,
		VirtualPlacement: true, Columns: thumbCols, Rows: thumbRows, Quiet: 2, Chunk: true}
	if err := kitty.EncodeGraphics(&encoded, img, &opts); err != nil {
		m.thumbs.mu.Lock()
		state.uploading = false
		m.thumbs.mu.Unlock()
		return nil
	}
	return tea.Sequence(tea.Raw(encoded.String()), func() tea.Msg { return thumbUploadedMsg{path: path, id: id} })
}

func (c *thumbCache) get(path string) (thumbState, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	item, ok := c.items[path]
	if !ok {
		return thumbState{}, false
	}
	return *item, true
}

type thumbLoadedMsg struct {
	path string
	img  image.Image
	err  error
}

// loadThumbnails는 아직 없는 이미지 첨부의 썸네일을 내려받는다.
func (m Model) loadThumbnails() tea.Cmd {
	workspace, ok := m.activeWorkspace()
	n := m.note
	if !ok || n == nil || n.lock == lockLocked || m.thumbs == nil {
		return nil
	}
	var cmds []tea.Cmd
	m.thumbs.mu.Lock()
	defer m.thumbs.mu.Unlock()
	for _, attachment := range n.attachments {
		if !notes.IsImageAttachment(attachment.Name, attachment.Type) || attachment.Path == "" {
			continue
		}
		if _, known := m.thumbs.items[attachment.Path]; known {
			continue
		}
		m.thumbs.items[attachment.Path] = &thumbState{loading: true}
		path := attachment.Path
		cmds = append(cmds, func() tea.Msg {
			client, err := clientFor(workspace)
			if err != nil {
				return thumbLoadedMsg{path: path, err: err}
			}
			ctx, cancel := requestContext()
			defer cancel()
			data, err := client.DownloadAttachment(ctx, workspace.Repo, path)
			if err != nil {
				return thumbLoadedMsg{path: path, err: err}
			}
			img, err := shrinkImage(data)
			return thumbLoadedMsg{path: path, img: img, err: err}
		})
	}
	return tea.Batch(cmds...)
}

// shrinkImage는 그림을 읽어 긴 변이 thumbKeep 점이 되게 줄인다.
func shrinkImage(data []byte) (image.Image, error) {
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width == 0 || height == 0 {
		return nil, fmt.Errorf("빈 그림")
	}
	scale := min(1, float64(thumbKeep)/float64(max(width, height)))
	target := image.NewRGBA(image.Rect(0, 0, max(1, int(float64(width)*scale)), max(1, int(float64(height)*scale))))
	draw.CatmullRom.Scale(target, target.Bounds(), source, bounds, draw.Src, nil)
	return target, nil
}

func (m Model) applyThumbLoaded(msg thumbLoadedMsg) (tea.Model, tea.Cmd) {
	m.thumbs.mu.Lock()
	m.thumbs.items[msg.path] = &thumbState{img: msg.img, failed: msg.err != nil}
	m.thumbs.mu.Unlock()
	m.layoutNote()
	return m, m.uploadThumbnail(msg.path)
}

func (m Model) applyThumbUploaded(msg thumbUploadedMsg) (tea.Model, tea.Cmd) {
	m.thumbs.mu.Lock()
	if state := m.thumbs.items[msg.path]; state != nil && state.id == msg.id {
		state.uploading = false
		state.uploaded = true
	}
	m.thumbs.mu.Unlock()
	m.layoutNote()
	return m, nil
}

// renderThumb는 썸네일 타일의 그림 부분(thumbRows 줄, thumbCols 칸)이다.
func (m Model) renderThumb(attachment github.Attachment) []string {
	t := m.th
	placeholder := func(texts ...string) []string {
		return tileLines(m, texts...)
	}
	if !notes.IsImageAttachment(attachment.Name, attachment.Type) {
		extension := strings.ToUpper(strings.TrimPrefix(filepath.Ext(attachment.Name), "."))
		size := ""
		if attachment.Size > 0 {
			size = fileSize(attachment.Size)
		}
		return placeholder("FILE", extension, size)
	}
	state, ok := m.thumbs.get(attachment.Path)
	switch {
	case !ok || state.loading:
		return placeholder("불러오는 중…")
	case state.failed || state.img == nil:
		return placeholder("🖼  미리보기 없음")
	}
	if m.kittyGraphics && state.uploaded {
		return kittyPlaceholder(state.id, colorOf(t.bgInput))
	}
	key := fmt.Sprintf("%s|%v", attachment.Path, m.dark())
	m.thumbs.mu.Lock()
	cached, hit := m.thumbs.rendered[key]
	m.thumbs.mu.Unlock()
	if hit {
		return cached
	}
	lines := halfBlocks(state.img, thumbCols, thumbRows, colorOf(t.bgInput))
	m.thumbs.mu.Lock()
	m.thumbs.rendered[key] = lines
	m.thumbs.mu.Unlock()
	return lines
}

// 실제 이미지의 위치는 글자 셀로 표현한다. 화면 스크롤·모달·크기 변경 때
// Bubble Tea가 이 셀을 평소처럼 옮기면 터미널이 해당 위치에 이미지를 다시 그린다.
func kittyPlaceholder(id int, background color.RGBA) []string {
	lines := make([]string, thumbRows)
	for row := range lines {
		var builder strings.Builder
		fmt.Fprintf(&builder, "\x1b[38;2;%d;%d;%dm\x1b[48;2;%d;%d;%dm", id>>16&255, id>>8&255, id&255,
			background.R, background.G, background.B)
		for col := 0; col < thumbCols; col++ {
			builder.WriteRune(kitty.Placeholder)
			builder.WriteRune(kitty.Diacritic(row))
			builder.WriteRune(kitty.Diacritic(col))
		}
		builder.WriteString("\x1b[m")
		lines[row] = builder.String()
	}
	return lines
}

// tileLines는 글자만 있는 타일이다. 글자 줄들을 가운데에 놓는다.
func tileLines(m Model, texts ...string) []string {
	t := m.th
	lines := make([]string, thumbRows)
	top := (thumbRows - len(texts)) / 2
	for row := range lines {
		label := ""
		if index := row - top; index >= 0 && index < len(texts) {
			label = texts[index]
		}
		lines[row] = fillBackground(t.fg(t.faint).Render(centerText(label, thumbCols)), thumbCols, t.bgInput)
	}
	return lines
}

// renderAddTile은 첨부 목록 끝의 추가 타일이다(attachment-add-tile).
func (m Model) renderAddTile() []string {
	return tileLines(m, "+", "추가")
}

// halfBlocks는 그림을 cols×rows 칸 안에 비율을 지켜 넣는다. 칸 하나가 위아래 두 점이다.
func halfBlocks(img image.Image, cols, rows int, background color.RGBA) []string {
	bounds := img.Bounds()
	pixelsHigh := rows * 2
	scale := min(float64(cols)/float64(bounds.Dx()), float64(pixelsHigh)/float64(bounds.Dy()))
	width, height := max(1, int(float64(bounds.Dx())*scale+0.5)), max(1, int(float64(bounds.Dy())*scale+0.5))
	canvas := image.NewRGBA(image.Rect(0, 0, cols, pixelsHigh))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{background}, image.Point{}, draw.Src)
	left, top := (cols-width)/2, (pixelsHigh-height)/2
	draw.ApproxBiLinear.Scale(canvas, image.Rect(left, top, left+width, top+height), img, bounds, draw.Over, nil)
	lines := make([]string, rows)
	for row := 0; row < rows; row++ {
		var builder strings.Builder
		for column := 0; column < cols; column++ {
			upper := canvas.RGBAAt(column, row*2)
			lower := canvas.RGBAAt(column, row*2+1)
			fmt.Fprintf(&builder, "\x1b[38;2;%d;%d;%dm\x1b[48;2;%d;%d;%dm▀", upper.R, upper.G, upper.B, lower.R, lower.G, lower.B)
		}
		builder.WriteString("\x1b[m")
		lines[row] = builder.String()
	}
	return lines
}

// colorOf는 테마 색을 RGBA로 바꾼다.
func colorOf(value color.Color) color.RGBA {
	r, g, b, _ := value.RGBA()
	return color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), 255}
}

func centerText(text string, width int) string {
	text = truncate(text, width)
	gap := max(0, width-lipgloss.Width(text))
	return strings.Repeat(" ", gap/2) + text + strings.Repeat(" ", gap-gap/2)
}
