//go:build cgo

package audio

import (
	"encoding/binary"
	"math"
	"sync"
	"time"

	"github.com/gen2brain/malgo"
)

// deviceRecorder는 miniaudio(malgo)로 기본 입력 장치에서 받는다.
type deviceRecorder struct {
	mu        sync.Mutex
	context   *malgo.AllocatedContext
	device    *malgo.Device
	pcm       []byte
	level     float64
	recording bool
}

// New는 기본 마이크를 쓰는 녹음기다. 장치는 Start에서 연다.
func New() Recorder { return &deviceRecorder{} }

func (r *deviceRecorder) Start() error {
	if r.device != nil {
		return r.Resume()
	}
	context, err := malgo.InitContext(nil, malgo.ContextConfig{}, nil)
	if err != nil {
		return err
	}
	config := malgo.DefaultDeviceConfig(malgo.Capture)
	config.Capture.Format = malgo.FormatS16
	config.Capture.Channels = Channels
	config.SampleRate = SampleRate
	device, err := malgo.InitDevice(context.Context, config, malgo.DeviceCallbacks{Data: r.receive})
	if err != nil {
		context.Uninit()
		context.Free()
		return err
	}
	r.context, r.device = context, device
	return r.Resume()
}

// receive는 장치 고루틴에서 불린다. 받은 소리를 쌓고 크기(RMS)를 잰다.
func (r *deviceRecorder) receive(_, input []byte, frames uint32) {
	var sum float64
	samples := len(input) / 2
	for index := 0; index+1 < len(input); index += 2 {
		value := float64(int16(binary.LittleEndian.Uint16(input[index:]))) / 32768
		sum += value * value
	}
	level := 0.0
	if samples > 0 {
		level = math.Min(1, math.Sqrt(sum/float64(samples))*4)
	}
	r.mu.Lock()
	if r.recording && time.Duration(len(r.pcm)/2)*time.Second/SampleRate < MaxDuration {
		r.pcm = append(r.pcm, input...)
	}
	r.level = level
	r.mu.Unlock()
}

func (r *deviceRecorder) Pause() {
	r.mu.Lock()
	r.recording = false
	r.level = 0
	r.mu.Unlock()
	if r.device != nil {
		r.device.Stop()
	}
}

func (r *deviceRecorder) Resume() error {
	if r.device == nil {
		return r.Start()
	}
	if err := r.device.Start(); err != nil {
		return err
	}
	r.mu.Lock()
	r.recording = true
	r.mu.Unlock()
	return nil
}

func (r *deviceRecorder) Recording() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.recording
}

func (r *deviceRecorder) Elapsed() time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	return time.Duration(len(r.pcm)/2/Channels) * time.Second / SampleRate
}

func (r *deviceRecorder) Level() float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.recording {
		return 0
	}
	return r.level
}

func (r *deviceRecorder) Finish() (Recording, error) {
	elapsed := r.Elapsed()
	r.Close()
	r.mu.Lock()
	pcm := r.pcm
	r.mu.Unlock()
	if len(pcm) == 0 {
		return Recording{}, errNoAudio
	}
	return Compress(EncodeWAV(pcm, SampleRate, Channels), elapsed), nil
}

func (r *deviceRecorder) Close() {
	r.mu.Lock()
	r.recording = false
	r.mu.Unlock()
	if r.device != nil {
		r.device.Uninit()
		r.device = nil
	}
	if r.context != nil {
		r.context.Uninit()
		r.context.Free()
		r.context = nil
	}
}
