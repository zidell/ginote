//go:build !cgo

package audio

import "time"

type unsupported struct{}

// New는 cgo 없이 빌드하면 녹음할 수 없는 녹음기를 준다.
func New() Recorder { return unsupported{} }

func (unsupported) Start() error               { return ErrUnsupported }
func (unsupported) Pause()                     {}
func (unsupported) Resume() error              { return ErrUnsupported }
func (unsupported) Recording() bool            { return false }
func (unsupported) Elapsed() time.Duration     { return 0 }
func (unsupported) Level() float64             { return 0 }
func (unsupported) Finish() (Recording, error) { return Recording{}, ErrUnsupported }
func (unsupported) Close()                     {}
