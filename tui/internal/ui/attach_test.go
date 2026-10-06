package ui

import (
	tea "charm.land/bubbletea/v2"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDroppedFilesParsesTerminalPaths(t *testing.T) {
	directory := t.TempDir()
	plain := filepath.Join(directory, "a.png")
	spaced := filepath.Join(directory, "회의 메모 (1).pdf")
	for _, path := range []string{plain, spaced} {
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	escaped := strings.NewReplacer(" ", `\ `, "(", `\(`, ")", `\)`).Replace(spaced)
	got := droppedFiles(plain + " " + escaped + " ")
	if len(got) != 2 || got[0] != plain || got[1] != spaced {
		t.Fatalf("paths = %q", got)
	}
	if got := droppedFiles("'" + spaced + "'"); len(got) != 1 || got[0] != spaced {
		t.Fatalf("quoted = %q", got)
	}
	for _, text := range []string{"그냥 글", plain + " 없는파일", directory, "/no/such/file"} {
		if got := droppedFiles(text); got != nil {
			t.Errorf("%q is not a drop: %q", text, got)
		}
	}
}

func TestViewReportsTerminalFocus(t *testing.T) {
	if !New(Options{}).View().ReportFocus {
		t.Fatal("Quick Look must close when terminal focus returns")
	}
}

func TestTerminalFocusClosesQuickLook(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS Quick Look")
	}
	command := exec.Command("sleep", "30")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	activeQuickLook.Lock()
	activeQuickLook.session = &quickLookSession{command: command, done: make(chan struct{})}
	activeQuickLook.Unlock()
	t.Cleanup(func() {
		_ = command.Process.Kill()
		activeQuickLook.Lock()
		activeQuickLook.session = nil
		activeQuickLook.Unlock()
	})

	_, _ = New(Options{}).update(tea.FocusMsg{})
	if err := command.Wait(); err == nil {
		t.Fatal("Quick Look process survived terminal focus")
	}
}

func TestAttachWithPickerAndDrop(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	fake.files = map[string][]string{}
	directory := t.TempDir()
	first, second := filepath.Join(directory, "one.txt"), filepath.Join(directory, "two.txt")
	for _, path := range []string{first, second} {
		os.WriteFile(path, []byte("x"), 0o600)
	}
	previous := pickFiles
	pickFiles = func() ([]string, error) { return []string{first, second}, nil }
	t.Cleanup(func() { pickFiles = previous })

	m := startApp(t, fake)
	m = press(t, m, "down", "down", "enter", "a")
	if len(fake.files[".issue-note-assets/issues/2"]) != 2 || len(m.note.attachments) != 2 {
		t.Fatalf("A uploads the picked files: %v / %d", fake.files, len(m.note.attachments))
	}
	// 끌어 놓기: Terminal이 경로를 붙여 넣는다.
	m = drive(t, m, tea.PasteMsg{Content: first})
	if len(m.note.attachments) != 3 || strings.Contains(m.note.body.Value(), first) {
		t.Fatalf("a dropped file is attached, not pasted: %d", len(m.note.attachments))
	}
	// 창을 띄울 수 없으면 경로 입력 창을 연다.
	pickFiles = func() ([]string, error) { return nil, errPickerUnavailable }
	m = press(t, m, "a")
	if m.prompt == nil || m.prompt.kind != "attach" {
		t.Fatal("falls back to the path prompt")
	}
}

func TestAttachmentClickOpensQuickLookWithAllImages(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	fake.files = map[string][]string{".issue-note-assets/issues/3": {"a-photo.png", "b-plan.pdf", "c-map.jpg"}}
	var opened []string
	previous := previewFiles
	previewFiles = func(directory string, paths []string) bool {
		for _, path := range paths {
			data, _ := os.ReadFile(path)
			opened = append(opened, filepath.Base(path)+"="+string(data))
		}
		os.RemoveAll(directory)
		return true
	}
	t.Cleanup(func() { previewFiles = previous })
	m := startApp(t, fake)
	m = press(t, m, "down", "down", "down", "enter")
	if len(m.note.attachments) != 3 {
		t.Fatalf("attachments = %d", len(m.note.attachments))
	}
	index := -1
	for position, attachment := range m.note.attachments {
		if attachment.Name == "c-map.jpg" {
			index = position
		}
	}
	m = click(t, m, "att:"+itoa(index))
	if strings.Join(opened, ",") != "1-c-map.jpg=file:c-map.jpg,2-a-photo.png=file:a-photo.png" {
		t.Fatalf("opened = %v", opened)
	}
}
