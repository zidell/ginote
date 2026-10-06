package ui

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	uv "github.com/charmbracelet/ultraviolet"
	"github.com/charmbracelet/x/ansi/kitty"
)

func TestImageAttachmentsShowMosaicThumbnails(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.RGBA{255, 0, 0, 255})
		}
	}
	var encoded bytes.Buffer
	png.Encode(&encoded, img)
	fake.files = map[string][]string{".issue-note-assets/issues/3": {"a-photo.png", "b-plan.pdf"}}
	fake.data = map[string][]byte{".issue-note-assets/issues/3/a-photo.png": encoded.Bytes()}
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "down", "enter")
	rendered, _ := m.render()
	if !strings.Contains(rendered, "38;2;255;0;0") || !strings.Contains(rendered, "▀") {
		t.Fatal("the image is drawn with half blocks")
	}
	screen := screenText(m)
	if !strings.Contains(screen, "a-photo.png") || !strings.Contains(screen, "b-plan.pdf") || !strings.Contains(screen, "FILE") || !strings.Contains(screen, "첨부 추가") {
		t.Fatalf("image tile and file row\n%s", screen)
	}
	if _, ok := m.hits.lookup("att:0"); !ok {
		t.Fatal("the tile is clickable")
	}
	// 추가 타일은 마지막 첨부의 오른쪽에 있다.
	last, _ := m.hits.lookup("att:1")
	add, ok := m.hits.lookup("attadd")
	if !ok || add.y0 != last.y0 || add.x0 <= last.x0 {
		t.Fatalf("add tile = %+v, last = %+v", add, last)
	}
}

func TestKittyGraphicsReplacesMosaicAfterCapabilityReply(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.RGBA{255, 0, 0, 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatal(err)
	}
	fake.files = map[string][]string{".issue-note-assets/issues/3": {"a-photo.png"}}
	fake.data = map[string][]byte{".issue-note-assets/issues/3/a-photo.png": encoded.Bytes()}
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "down", "enter")

	// 다른 쿼리 응답이나 실패 응답은 썸네일 방식을 바꾸지 않는다.
	m = drive(t, m, uv.KittyGraphicsEvent{Options: kitty.Options{ID: kittyQueryID}, Payload: []byte("ENOENT")})
	if m.kittyGraphics {
		t.Fatal("failed graphics query enabled images")
	}
	m = drive(t, m, uv.KittyGraphicsEvent{Options: kitty.Options{ID: kittyQueryID}, Payload: []byte("OK")})
	state, ok := m.thumbs.get(m.note.attachments[0].Path)
	if !ok || !state.uploaded || state.id == 0 {
		t.Fatalf("image was not transmitted: %+v", state)
	}
	lines := m.renderThumb(m.note.attachments[0])
	if len(lines) != thumbRows || strings.Contains(strings.Join(lines, ""), "▀") {
		t.Fatal("native thumbnail did not replace mosaic")
	}
	for _, line := range lines {
		if lipgloss.Width(line) != thumbCols || strings.Count(line, string(kitty.Placeholder)) != thumbCols {
			t.Fatalf("invalid native thumbnail row: width=%d placeholders=%d", lipgloss.Width(line), strings.Count(line, string(kitty.Placeholder)))
		}
	}
	buffer := uv.NewScreenBuffer(thumbCols, thumbRows)
	uv.NewStyledString(strings.Join(lines, "\n")).Draw(buffer, buffer.Bounds())
	if got := buffer.Render(); strings.Count(got, string(kitty.Placeholder)) != thumbCols*thumbRows || !strings.Contains(got, string(kitty.Diacritic(1))) {
		t.Fatal("Bubble Tea renderer dropped Kitty image placeholder cells")
	}
	if _, ok := m.hits.lookup("att:0"); !ok {
		m.View()
		if _, ok := m.hits.lookup("att:0"); !ok {
			t.Fatal("native image tile is not clickable")
		}
	}
}
