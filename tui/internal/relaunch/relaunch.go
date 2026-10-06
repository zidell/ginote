// Package relaunch는 화면 상태를 넘기며 이 프로그램을 다시 시작한다. 개발 모드 재빌드
// (internal/devreload)와 전체 새로고침(Ctrl+R·R·Cmd+R, 웹의 location.reload)이 쓴다.
package relaunch

import (
	"os"
	"path/filepath"
)

const restoreEnv = "GINOTE_TUI_RESTORE"

// writeState는 상태를 임시 파일에 쓰고 다음 프로세스에 넘길 환경을 만든다.
func writeState(state []byte, extraEnv []string) ([]string, error) {
	file, err := os.CreateTemp("", "ginote-tui-restore-*.json")
	if err != nil {
		return nil, err
	}
	if _, err := file.Write(state); err != nil {
		file.Close()
		return nil, err
	}
	file.Close()
	env := append(os.Environ(), restoreEnv+"="+file.Name())
	for _, item := range extraEnv {
		if item != "" {
			env = append(env, item)
		}
	}
	return env, nil
}

// Restore는 직전 프로세스가 넘긴 상태다. 한 번 읽으면 지운다.
func Restore() []byte {
	path := os.Getenv(restoreEnv)
	if path == "" {
		return nil
	}
	os.Unsetenv(restoreEnv)
	data, err := os.ReadFile(filepath.Clean(path))
	os.Remove(path)
	if err != nil {
		return nil
	}
	return data
}
