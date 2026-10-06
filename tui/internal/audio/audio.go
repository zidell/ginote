// Package audio는 음성 노트용 마이크 녹음이다(웹 VoiceRecorder.svelte의 MediaRecorder 자리).
// 16kHz 모노 PCM으로 받아 입력 크기(파형 표시용)를 알려 주고, 끝나면 파일로 만든다. macOS는 내장
// afconvert로 AAC(m4a, audio/mp4)로 줄인다. 웹 Safari가 쓰는 형식과 같고 한 시간 녹음도 첨부
// 한도(10MB) 안에 든다. 그 밖의 OS는 WAV(audio/wav)다.
package audio

import (
	"bytes"
	"encoding/binary"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

const (
	SampleRate = 16000
	Channels   = 1
	// MaxDuration은 한 번에 녹음할 수 있는 길이다(MAX_RECORDING_MILLISECONDS).
	MaxDuration = time.Hour
)

var (
	// ErrUnsupported는 이 빌드에서 녹음할 수 없을 때다(cgo 없이 빌드한 경우).
	ErrUnsupported = errors.New("이 환경에서는 마이크 녹음을 쓸 수 없습니다.")
	errNoAudio     = errors.New("먼저 음성을 녹음해 주세요.")
)

// Recording은 끝난 녹음 파일이다.
type Recording struct {
	Data        []byte
	ContentType string
	Extension   string
	Duration    time.Duration
}

// Recorder는 마이크 하나를 다룬다. 메서드는 UI 고루틴에서 부르고, 소리 데이터는 장치 고루틴이 쌓는다.
type Recorder interface {
	Start() error
	Pause()
	Resume() error
	Recording() bool
	Elapsed() time.Duration
	// Level은 최근 입력 크기다(0~1). 녹음 중이 아니면 0.
	Level() float64
	// Finish는 녹음을 끝내고 파일을 만든다. 장치를 놓는다.
	Finish() (Recording, error)
	// Close는 녹음을 버리고 장치를 놓는다.
	Close()
}

// EncodeWAV는 16비트 PCM을 WAV 파일로 감싼다.
func EncodeWAV(pcm []byte, sampleRate, channels int) []byte {
	var buffer bytes.Buffer
	write := func(value any) { binary.Write(&buffer, binary.LittleEndian, value) }
	buffer.WriteString("RIFF")
	write(uint32(36 + len(pcm)))
	buffer.WriteString("WAVEfmt ")
	write(uint32(16))
	write(uint16(1)) // PCM
	write(uint16(channels))
	write(uint32(sampleRate))
	write(uint32(sampleRate * channels * 2))
	write(uint16(channels * 2))
	write(uint16(16))
	buffer.WriteString("data")
	write(uint32(len(pcm)))
	buffer.Write(pcm)
	return buffer.Bytes()
}

// Compress는 WAV를 보낼 파일로 만든다. macOS는 AAC m4a, 줄이지 못하면 WAV 그대로다.
func Compress(wav []byte, duration time.Duration) Recording {
	recording := Recording{Data: wav, ContentType: "audio/wav", Extension: "wav", Duration: duration}
	if runtime.GOOS != "darwin" {
		return recording
	}
	directory, err := os.MkdirTemp("", "ginote-voice-*")
	if err != nil {
		return recording
	}
	defer os.RemoveAll(directory)
	input, output := filepath.Join(directory, "voice.wav"), filepath.Join(directory, "voice.m4a")
	if os.WriteFile(input, wav, 0o600) != nil {
		return recording
	}
	// 말소리용 모노 32kbps AAC(웹은 Opus 16kbps). 한 시간이 약 14MB라 웹보다 크므로 길면 비트레이트를 낮춘다.
	bitrate := "32000"
	if duration > 30*time.Minute {
		bitrate = "16000"
	}
	if exec.Command("afconvert", "-f", "m4af", "-d", "aac", "-b", bitrate, input, output).Run() != nil {
		return recording
	}
	data, err := os.ReadFile(output)
	if err != nil || len(data) == 0 {
		return recording
	}
	return Recording{Data: data, ContentType: "audio/mp4", Extension: "mp4", Duration: duration}
}
