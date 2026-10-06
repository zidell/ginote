//go:build !unix

package relaunch

import (
	"os"
	"os/exec"
)

const Supported = true

// Exec는 Windows처럼 프로세스를 바꿔 끼울 수 없는 곳에서 새 프로세스를 띄우고 기다린다.
func Exec(binary string, state []byte, extraEnv ...string) error {
	env, err := writeState(state, extraEnv)
	if err != nil {
		return err
	}
	command := exec.Command(binary, os.Args[1:]...)
	command.Env = env
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := command.Run(); err != nil {
		return err
	}
	os.Exit(0)
	return nil
}
