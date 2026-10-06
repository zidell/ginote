package audio

import (
	"bytes"
	"encoding/binary"
	"runtime"
	"testing"
	"time"
)

func TestEncodeWAVHeader(t *testing.T) {
	pcm := []byte{1, 0, 2, 0}
	wav := EncodeWAV(pcm, SampleRate, Channels)
	if !bytes.HasPrefix(wav, []byte("RIFF")) || string(wav[8:16]) != "WAVEfmt " || len(wav) != 44+len(pcm) {
		t.Fatalf("header = %q", wav[:16])
	}
	if rate := binary.LittleEndian.Uint32(wav[24:]); rate != SampleRate {
		t.Fatalf("rate = %d", rate)
	}
	if size := binary.LittleEndian.Uint32(wav[40:]); size != uint32(len(pcm)) {
		t.Fatalf("data size = %d", size)
	}
}

// macOS에서는 내장 afconvert로 AAC(m4a)로 줄인다.
func TestCompressMakesM4AOnMac(t *testing.T) {
	pcm := make([]byte, SampleRate*2) // 1초 무음
	recording := Compress(EncodeWAV(pcm, SampleRate, Channels), time.Second)
	if runtime.GOOS != "darwin" {
		if recording.ContentType != "audio/wav" {
			t.Fatalf("type = %s", recording.ContentType)
		}
		return
	}
	if recording.ContentType != "audio/mp4" || recording.Extension != "mp4" || len(recording.Data) >= len(pcm) {
		t.Fatalf("recording = %s %s %d bytes", recording.ContentType, recording.Extension, len(recording.Data))
	}
}
