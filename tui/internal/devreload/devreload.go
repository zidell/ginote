//go:build dev && unix

// Package devreload는 개발 모드(`-tags dev`, tui/dev.sh)에서 소스가 바뀌면 다시 빌드한다.
// 빌드가 성공하면 ReadyMsg를 보내고, main이 화면 상태를 넘겨 새 바이너리(Binary)로 제자리
// 재시작한다(internal/relaunch). 빌드가 실패하면 앱은 그대로 두고 오류만 알린다. 릴리스
// 빌드에는 들어가지 않는다(devreload_off.go).
package devreload

import (
	"bytes"
	"fmt"
	"hash/fnv"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/zidell/ginote/tui/internal/notes"

	tea "charm.land/bubbletea/v2"
)

const (
	sourceEnv   = "GINOTE_TUI_DEV_SRC"
	pollEvery   = 400 * time.Millisecond
	settleAfter = 300 * time.Millisecond
)

const Enabled = true

// BuildingMsg는 바뀐 소스를 감지해 빌드를 시작했다는 알림이다.
type BuildingMsg struct{}

// FailedMsg는 빌드 실패다. Output은 컴파일러 출력이다.
type FailedMsg struct{ Output string }

// ReadyMsg는 새 바이너리가 준비됐다는 뜻이다. 받은 쪽은 상태를 저장하고 종료한 뒤 Exec를 부른다.
type ReadyMsg struct{}

type changedMsg struct{ signature uint64 }

// idleMsg는 바뀐 게 없을 때의 감시 주기다. bubbletea는 nil 메시지를 버리므로 따로 둔다.
type idleMsg struct{}

type watcher struct {
	source string
	binary string
	built  uint64
}

var current *watcher

func init() {
	source := os.Getenv(sourceEnv)
	binary, err := os.Executable()
	if source == "" || err != nil {
		return
	}
	current = &watcher{source: source, binary: binary}
	current.built = current.signature()
}

// Watch는 다음 변경을 기다리는 명령이다. 모든 devreload 메시지를 처리한 뒤 다시 부른다.
func Watch() tea.Cmd {
	if current == nil {
		return nil
	}
	return tea.Tick(pollEvery, func(time.Time) tea.Msg {
		if signature := current.signature(); signature != current.built {
			return changedMsg{signature}
		}
		return idleMsg{}
	})
}

// Handle은 devreload 내부 메시지면 처리하고 true를 돌려준다. 첫 값은 화면이 알아야 할
// 메시지(BuildingMsg)이고 없으면 nil이다. FailedMsg를 받은 쪽은 Watch를 다시 부른다.
func Handle(msg tea.Msg) (tea.Msg, tea.Cmd, bool) {
	switch msg := msg.(type) {
	case changedMsg:
		// 편집기가 여러 파일을 연달아 저장하는 동안 빌드하지 않도록 잠깐 기다렸다가 다시 본다.
		return BuildingMsg{}, tea.Tick(settleAfter, func(time.Time) tea.Msg {
			return current.build(msg.signature)
		}), true
	case idleMsg:
		return nil, Watch(), true
	}
	return nil, nil, false
}

func (w *watcher) build(seen uint64) tea.Msg {
	if signature := w.signature(); signature != seen {
		return changedMsg{signature}
	}
	next := w.binary + ".next"
	// 잠금 pepper는 dev.sh와 같이 scripts/pepper.sh로 웹 빌드 값을 넣는다. 스크립트를 못 쓰면 지금
	// 바이너리에 든 값을 잇는다.
	flags := ""
	pepperScript := exec.Command("bash", filepath.Join(w.source, "scripts", "pepper.sh"))
	pepperScript.Dir = w.source
	if pepperFlag, err := pepperScript.Output(); err == nil && len(pepperFlag) > 0 {
		flags += " " + strings.TrimSpace(string(pepperFlag))
	} else if notes.AppPepper != notes.DefaultAppPepper {
		flags += " -X github.com/zidell/ginote/tui/internal/notes.AppPepper=" + notes.AppPepper
	}
	command := exec.Command("go", "build", "-tags", "dev", "-ldflags", flags,
		"-o", next, "./cmd/ginote-tui")
	command.Dir = w.source
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	err := command.Run()
	w.built = seen
	if err != nil {
		return FailedMsg{Output: strings.TrimSpace(output.String())}
	}
	if err := os.Rename(next, w.binary); err != nil {
		return FailedMsg{Output: err.Error()}
	}
	return ReadyMsg{}
}

// signature는 소스 파일의 경로·크기·수정 시각을 섞은 값이다.
func (w *watcher) signature() uint64 {
	hash := fnv.New64a()
	filepath.WalkDir(w.source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if name := entry.Name(); path != w.source && (strings.HasPrefix(name, ".") || name == "testdata") {
				return filepath.SkipDir
			}
			return nil
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") && name != "go.mod" && name != "go.sum" {
			return nil
		}
		if info, err := entry.Info(); err == nil {
			fmt.Fprintf(hash, "%s|%d|%d\n", path, info.Size(), info.ModTime().UnixNano())
		}
		return nil
	})
	return hash.Sum64()
}

// Binary는 다시 빌드한 바이너리 경로다. 개발 모드가 아니면 "".
func Binary() string {
	if current == nil {
		return ""
	}
	return current.binary
}
