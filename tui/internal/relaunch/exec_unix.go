//go:build unix

package relaunch

import (
	"os"
	"syscall"
)

const Supported = true

// Exec는 binary로 현재 프로세스를 바꾼다. state는 다음 프로세스가 Restore로 받는다.
// extraEnv는 "KEY=value"이며 파일에 쓰지 않고 환경으로만 넘긴다.
func Exec(binary string, state []byte, extraEnv ...string) error {
	env, err := writeState(state, extraEnv)
	if err != nil {
		return err
	}
	return syscall.Exec(binary, os.Args, env)
}
