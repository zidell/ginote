package ui

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/notes"
)

// 파일 첨부의 두 입구(웹의 파일 선택과 끌어 놓기).
//   - A 키·툴바 첨부: macOS면 Finder 파일 선택 창을 띄워 여러 개를 고른다. 다른 OS나 창을 띄우지
//     못하면 경로 입력 창(newAttachPrompt)을 쓴다.
//   - 끌어 놓기: Terminal은 끌어 놓은 파일을 경로 글자로 붙여 넣는다. 노트가 열려 있을 때 붙여 넣은
//     글자가 모두 실제 파일 경로면 본문에 넣지 않고 첨부로 올린다.

// errPickerUnavailable은 파일 선택 창을 띄울 수 없다는 뜻이다(경로 입력 창으로 대신한다).
var errPickerUnavailable = errors.New("파일 선택 창을 띄울 수 없습니다")

// pickFiles는 파일 선택 창이다. 취소하면 빈 목록이다. 테스트에서 바꾼다.
var pickFiles = pickFilesNative

const chooseFileScript = `activate
set picked to choose file with prompt "첨부할 파일을 고르세요 (10MB까지)" with multiple selections allowed
set out to ""
repeat with f in picked
	set out to out & POSIX path of f & linefeed
end repeat
return out`

func pickFilesNative() ([]string, error) {
	if runtime.GOOS != "darwin" {
		return nil, errPickerUnavailable
	}
	command := exec.Command("osascript", "-e", chooseFileScript)
	output, err := command.Output()
	// 대화상자는 osascript가 띄우므로 닫은 뒤 포커스를 Terminal로 돌려준다.
	exec.Command("open", "-a", "Terminal").Run()
	if err != nil {
		var exit *exec.ExitError
		// 취소(-128)는 오류 출력에 "User canceled"가 남는다.
		if errors.As(err, &exit) && strings.Contains(string(exit.Stderr), "-128") {
			return nil, nil
		}
		return nil, errPickerUnavailable
	}
	var paths []string
	for _, line := range strings.Split(string(output), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			paths = append(paths, line)
		}
	}
	return paths, nil
}

type filesPickedMsg struct {
	number int
	paths  []string
	err    error
}

// requestAttach는 A 키다. 파일 선택 창을 띄우고, 띄울 수 없으면 경로 입력 창을 연다.
func (m Model) requestAttach() (tea.Model, tea.Cmd) {
	n := m.note
	if n == nil || n.number() == 0 || !n.editable(m.state == "closed") || n.preview {
		return m, nil
	}
	number := n.number()
	return m, func() tea.Msg {
		paths, err := pickFiles()
		return filesPickedMsg{number: number, paths: paths, err: err}
	}
}

func (m Model) applyFilesPicked(msg filesPickedMsg) (tea.Model, tea.Cmd) {
	if m.note == nil || m.note.number() != msg.number {
		return m, nil
	}
	if msg.err != nil {
		m.prompt = newAttachPrompt()
		return m, nil
	}
	return m.uploadFiles(msg.paths)
}

// uploadFiles는 파일들을 차례로 올린다. 하나씩 끝날 때마다 첨부 목록에 더하고 저장한다.
func (m Model) uploadFiles(paths []string) (Model, tea.Cmd) {
	if len(paths) == 0 {
		return m, nil
	}
	var cmds []tea.Cmd
	for _, path := range paths {
		if cmd := m.uploadAttachment(path); cmd != nil {
			cmds = append(cmds, cmd)
		}
	}
	text := "업로드 중…"
	if len(paths) > 1 {
		text = itoa(len(paths)) + "개 파일 업로드 중…"
	}
	next, toast := m.showToast(text)
	return next, tea.Batch(toast, tea.Sequence(cmds...))
}

// droppedFiles는 실제 파일의 절대 경로만 첨부로 받는다. Unix 셸의 백슬래시 이스케이프와
// Windows 경로의 백슬래시를 구분한다. 하나라도 파일이 아니면 평소처럼 글자로 붙여 넣는다.
func droppedFiles(text string) []string {
	paths := splitDroppedPaths(strings.TrimSpace(text), runtime.GOOS == "windows")
	if len(paths) == 0 {
		return nil
	}
	for index, path := range paths {
		path = expandHome(path)
		if !filepath.IsAbs(path) {
			return nil
		}
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			return nil
		}
		paths[index] = path
	}
	return paths
}

func splitDroppedPaths(text string, windows bool) []string {
	var paths []string
	var current strings.Builder
	var quote rune
	escaped := false
	flush := func() {
		if current.Len() > 0 {
			paths = append(paths, current.String())
			current.Reset()
		}
	}
	runes := []rune(text)
	for index := 0; index < len(runes); index++ {
		r := runes[index]
		switch {
		case escaped:
			current.WriteRune(r)
			escaped = false
		case quote != 0:
			if r == quote {
				if windows && index+1 < len(runes) && runes[index+1] == quote {
					current.WriteRune(r)
					index++
				} else {
					quote = 0
				}
			} else if windows && quote == '"' && r == '`' {
				escaped = true
			} else {
				current.WriteRune(r)
			}
		case !windows && r == '\\', windows && r == '`':
			escaped = true
		case r == '\'' || r == '"':
			quote = r
		case r == ' ' || r == '\n' || r == '\r' || r == '\t':
			flush()
		default:
			current.WriteRune(r)
		}
	}
	flush()
	if quote != 0 || escaped || len(paths) == 0 {
		return nil
	}
	return paths
}

// previewFiles는 내려받은 첨부를 미리보기 창으로 연다. 테스트에서 바꾼다.
var previewFiles = quickLook

type quickLookSession struct {
	command *exec.Cmd
	done    chan struct{}
}

var activeQuickLook struct {
	sync.Mutex
	session *quickLookSession
}

func closeQuickLook() {
	activeQuickLook.Lock()
	session := activeQuickLook.session
	activeQuickLook.Unlock()
	if session != nil {
		_ = session.command.Process.Kill()
	}
}

// lsappinfo는 접근성 권한 없이 현재 맨 앞 앱의 ASN을 돌려준다.
func frontmostApp() string {
	output, err := exec.Command("lsappinfo", "front").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// 훑어보기 창이 앞에 왔다가 다른 앱으로 이동하면 닫는다. 터미널 탭만 바꾼 경우는
// 터미널의 FocusMsg가 별도로 처리한다.
func watchQuickLookFocus(session *quickLookSession, previousApp string) {
	if previousApp == "" {
		return
	}
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	previewApp := ""
	for {
		select {
		case <-session.done:
			return
		case <-deadline.C:
			return
		case <-ticker.C:
			front := frontmostApp()
			if front == "" {
				continue
			}
			if previewApp == "" {
				if front != previousApp {
					previewApp = front
					deadline.Stop()
				}
			} else if front != previewApp {
				_ = session.command.Process.Kill()
				return
			}
		}
	}
}

// quickLook은 macOS 훑어보기(Quick Look) 창을 띄운다. 여러 파일이면 창 안에서 ←/→로 넘긴다.
// 창을 닫으면 임시 폴더를 지운다. macOS가 아니면 false다.
func quickLook(directory string, paths []string) bool {
	if runtime.GOOS != "darwin" {
		return false
	}
	previousApp := frontmostApp()
	command := exec.Command("qlmanage", append([]string{"-p"}, paths...)...)
	if err := command.Start(); err != nil {
		return false
	}
	session := &quickLookSession{command: command, done: make(chan struct{})}
	activeQuickLook.Lock()
	previous := activeQuickLook.session
	activeQuickLook.session = session
	activeQuickLook.Unlock()
	if previous != nil {
		_ = previous.command.Process.Kill()
	}
	go watchQuickLookFocus(session, previousApp)
	go func() {
		_ = command.Wait()
		close(session.done)
		_ = os.RemoveAll(directory)
		activeQuickLook.Lock()
		if activeQuickLook.session == session {
			activeQuickLook.session = nil
		}
		activeQuickLook.Unlock()
	}()
	return true
}

type previewOpenedMsg struct {
	err      error
	fallback string // 미리보기를 못 띄우면 브라우저로 열 주소
}

// previewAttachment는 첨부를 누른 것이다(웹의 첨부 미리보기). 내려받아 훑어보기 창으로 연다.
// 이미지는 노트의 다른 이미지도 함께 넘겨 창 안에서 넘겨 볼 수 있게 한다(웹의 이미지 뷰어).
// 미리보기를 쓸 수 없으면 예전처럼 브라우저로 연다.
func (m Model) previewAttachment(index int) (tea.Model, tea.Cmd) {
	workspace, ok := m.activeWorkspace()
	n := m.note
	if !ok || n == nil || index < 0 || index >= len(n.attachments) {
		return m, nil
	}
	clicked := n.attachments[index]
	files := []string{clicked.Path}
	names := []string{clicked.Name}
	if notes.IsImageAttachment(clicked.Name, clicked.Type) {
		// 누른 것부터 시작해 뒤로 한 바퀴 돈다.
		for step := 1; step < len(n.attachments); step++ {
			other := n.attachments[(index+step)%len(n.attachments)]
			if notes.IsImageAttachment(other.Name, other.Type) {
				files = append(files, other.Path)
				names = append(names, other.Name)
			}
		}
	}
	fallback := notes.AttachmentRawURL(workspace.Repo, clicked.Path)
	next, toast := m.showToast("미리보기를 여는 중…")
	return next, tea.Batch(toast, func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return previewOpenedMsg{err: err}
		}
		directory, err := os.MkdirTemp("", "ginote-preview-")
		if err != nil {
			return previewOpenedMsg{err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		var paths []string
		for position, path := range files {
			data, err := client.DownloadAttachment(ctx, workspace.Repo, path)
			if err != nil {
				os.RemoveAll(directory)
				return previewOpenedMsg{err: err}
			}
			// 같은 이름이 있어도 덮지 않게 순번을 붙인다. 순번이 넘겨 보는 순서다.
			local := filepath.Join(directory, itoa(position+1)+"-"+filepath.Base(names[position]))
			if err := os.WriteFile(local, data, 0o600); err != nil {
				os.RemoveAll(directory)
				return previewOpenedMsg{err: err}
			}
			paths = append(paths, local)
		}
		if !previewFiles(directory, paths) {
			os.RemoveAll(directory)
			return previewOpenedMsg{fallback: fallback}
		}
		return previewOpenedMsg{}
	})
}

func (m Model) applyPreviewOpened(msg previewOpenedMsg) (tea.Model, tea.Cmd) {
	switch {
	case msg.err != nil:
		return m.showToast("첨부를 내려받지 못했습니다. " + describeError(msg.err))
	case msg.fallback != "":
		return m, openURL(msg.fallback)
	}
	m.toast = ""
	return m, nil
}
