//go:build !darwin || !cgo

package ime

const supported = false

func currentSource() string        { return "" }
func asciiSource() string          { return "" }
func currentIsASCII() bool         { return true }
func selectSource(id string) error { return nil }
