package ui

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	tea "charm.land/bubbletea/v2"
)

// 키 기록(문제 확인용). TUI 설정 파일 옆에 keylog.on 파일이 있으면, 들어온 키와 붙여넣기를
// keylog.txt에 적는다. 한글 입력기가 Enter를 어떻게 넘기는지처럼 터미널이 실제로 보내는 것을 볼 때 쓴다.
// 입력한 글자가 그대로 남으므로 확인이 끝나면 keylog.on을 지운다.

var keyLogFile *os.File

func openKeyLog(configPath string) {
	if configPath == "" {
		return
	}
	directory := filepath.Dir(configPath)
	if _, err := os.Stat(filepath.Join(directory, "keylog.on")); err != nil {
		return
	}
	keyLogFile, _ = os.OpenFile(filepath.Join(directory, "keylog.txt"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
}

func logKey(msg tea.Msg) {
	if keyLogFile == nil {
		return
	}
	stamp := time.Now().Format("15:04:05.000")
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		fmt.Fprintf(keyLogFile, "%s key %q text=%q code=%U mod=%d base=%U\n", stamp, msg.String(), msg.Text, msg.Code, msg.Mod, msg.BaseCode)
	case tea.KeyReleaseMsg:
		fmt.Fprintf(keyLogFile, "%s release %q\n", stamp, msg.String())
	case tea.PasteMsg:
		fmt.Fprintf(keyLogFile, "%s paste %q\n", stamp, msg.Content)
	case tea.FocusMsg, tea.BlurMsg:
		fmt.Fprintf(keyLogFile, "%s %T\n", stamp, msg)
	}
}
