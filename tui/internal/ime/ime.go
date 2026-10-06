// Package ime는 단축키를 쓸 때 macOS 입력 소스를 영문 자판으로 바꾸고, 글을 쓸 때 원래 입력
// 소스(한글 등)로 되돌린다. 한글 입력기가 켜져 있으면 키가 앱에 오기 전에 입력기가 글자를
// 조합해, 단일 키 단축키가 바로 듣지 않고 조합 중인 글자가 엉뚱한 자리에 보이기 때문이다.
//
// 입력 소스 API는 메인 스레드에서 불러야 하므로, 실제 전환은 이 바이너리를 짧게 다시 실행한
// 하위 프로세스(`<binary> __ime ...`, Main)가 한다. 전환 요청은 한 작업자가 차례로 처리하고,
// 쌓인 요청은 마지막 것만 남긴다. GINOTE_TUI_IME=off이면 아무것도 하지 않는다.
package ime

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"
)

const command = "__ime"

// Main은 하위 프로세스로 실행됐을 때 전환을 하고 true를 돌려준다. main 맨 앞에서 부른다.
//
//	__ime ascii       영문 자판이 아니면 영문으로 바꾸고, 바꾸기 전 입력 소스 ID를 출력한다
//	__ime select ID   그 입력 소스로 바꾼다
//	__ime current     지금 입력 소스 ID를 출력한다(문제 확인용)
func Main(args []string) bool {
	if len(args) < 2 || args[1] != command {
		return false
	}
	if len(args) >= 3 && args[2] == "current" {
		fmt.Println(currentSource())
		return true
	}
	if len(args) >= 3 && args[2] == "ascii" {
		if !currentIsASCII() {
			previous := currentSource()
			if ascii := asciiSource(); ascii != "" && selectSource(ascii) == nil {
				fmt.Print(previous)
			}
		}
		return true
	}
	if len(args) >= 4 && args[2] == "select" {
		if err := selectSource(args[3]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	return true
}

// Available은 이 환경에서 입력 소스를 바꿀 수 있는지다. 테스트 바이너리에서는 하위 프로세스가
// 테스트를 다시 돌리므로 쓰지 않는다.
func Available() bool {
	return supported && os.Getenv("GINOTE_TUI_IME") != "off" && !testing.Testing()
}

type switcher struct {
	mu      sync.Mutex
	want    *bool // 마지막으로 요청한 모드(true면 글쓰기)
	force   bool  // 이미 영문으로 바꿨어도 지금 입력 소스를 다시 확인한다
	running bool
	saved   string // 영문으로 바꾸기 전 입력 소스. 글쓰기로 돌아갈 때 되돌린다
	idle    *sync.Cond
}

var global = func() *switcher {
	s := &switcher{}
	s.idle = sync.NewCond(&s.mu)
	return s
}()

// Want는 지금 글쓰기 모드인지 알린다. 단축키 모드(false)면 영문 자판으로, 글쓰기 모드(true)면
// 원래 입력 소스로 바꾼다. 바로 돌아오며, 전환은 뒤에서 한다.
func Want(text bool) {
	if !Available() {
		return
	}
	s := global
	s.mu.Lock()
	s.want = &text
	if !s.running {
		s.running = true
		go s.work()
	}
	s.mu.Unlock()
}

func (s *switcher) work() {
	for {
		s.mu.Lock()
		if s.want == nil {
			s.running = false
			s.idle.Broadcast()
			s.mu.Unlock()
			return
		}
		text := *s.want
		s.want = nil
		saved := s.saved
		force := s.force
		s.force = false
		s.mu.Unlock()

		if text {
			if saved != "" && run("select", saved) == nil {
				s.mu.Lock()
				s.saved = ""
				s.mu.Unlock()
				settle()
			}
			continue
		}
		if saved != "" && !force {
			continue // 이미 영문 자판이다
		}
		// 바꾼 뒤 사용자가 다시 한글로 돌렸으면 그 입력 소스를 새로 기억한다.
		if output, err := output("ascii"); err == nil && output != "" {
			s.mu.Lock()
			s.saved = output
			s.mu.Unlock()
			settle()
		}
	}
}

// Recheck는 지금 입력 소스를 다시 확인해 모드에 맞춘다. 입력 소스는 앱(Terminal) 단위라 다른
// Terminal 창에서 한글로 바꾸고 돌아오면 TUI가 바꿔 둔 영문이 풀려 있다. 창으로 돌아왔을 때와
// 단축키 상태에서 한글 글자가 들어왔을 때 부른다.
func Recheck(text bool) {
	if !Available() {
		return
	}
	global.mu.Lock()
	global.force = !text
	global.mu.Unlock()
	Want(text)
}

// Release는 창을 떠날 때 바꿔 둔 입력 소스를 되돌린다(다른 창에서는 쓰던 한글을 그대로 쓴다).
// 기다리지 않는다. 돌아오면 Recheck가 다시 맞춘다.
func Release() {
	Want(true)
}

// Restore는 바꿔 둔 입력 소스를 되돌리고 끝날 때까지 기다린다. 끝내거나 다시 시작하기 전에 부른다.
func Restore() {
	if !Available() {
		return
	}
	s := global
	s.mu.Lock()
	for s.running {
		s.idle.Wait()
	}
	saved := s.saved
	s.saved = ""
	s.mu.Unlock()
	if saved != "" {
		run("select", saved)
	}
}

// settle은 전환이 실제로 적용될 때까지 잠깐 기다린다. 입력기 전환은 비동기라, 바로 다음
// 요청이 지금 입력 소스를 읽으면 바뀌기 전 값을 볼 수 있다.
func settle() { time.Sleep(400 * time.Millisecond) }

func binary() string {
	path, err := os.Executable()
	if err != nil {
		return os.Args[0]
	}
	return path
}

func run(args ...string) error {
	return exec.Command(binary(), append([]string{command}, args...)...).Run()
}

func output(args ...string) (string, error) {
	out, err := exec.Command(binary(), append([]string{command}, args...)...).Output()
	return strings.TrimSpace(string(out)), err
}
