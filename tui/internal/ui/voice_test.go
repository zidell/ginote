package ui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/zidell/ginote/tui/internal/audio"
)

type fakeRecorder struct {
	paused bool
}

func (r *fakeRecorder) Start() error           { return nil }
func (r *fakeRecorder) Pause()                 { r.paused = true }
func (r *fakeRecorder) Resume() error          { r.paused = false; return nil }
func (r *fakeRecorder) Recording() bool        { return !r.paused }
func (r *fakeRecorder) Elapsed() time.Duration { return 3 * time.Second }
func (r *fakeRecorder) Level() float64         { return 0.2 }
func (r *fakeRecorder) Close()                 {}
func (r *fakeRecorder) Finish() (audio.Recording, error) {
	return audio.Recording{Data: []byte("audio"), ContentType: "audio/mp4", Extension: "m4a", Duration: 3 * time.Second}, nil
}

// fakeVoice는 녹음기·OpenAI·키를 가짜로 바꾼다. 전사 결과는 transcript다.
func fakeVoice(t *testing.T, transcript string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/audio/transcriptions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"text":` + jsonQuote(transcript) + `}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("OPENAI_BASE_URL", server.URL)
	previousRecorder, previousKey, previousTick := newRecorder, readVoiceKey, voiceTickInterval
	newRecorder = func() audio.Recorder { return &fakeRecorder{} }
	readVoiceKey = func() string { return "sk-test" }
	voiceTickInterval = time.Hour
	t.Cleanup(func() { newRecorder, readVoiceKey, voiceTickInterval = previousRecorder, previousKey, previousTick })
}

func jsonQuote(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}

func recordAndFinish(t *testing.T, m Model) Model {
	t.Helper()
	if m.voice == nil || m.voice.phase != "recording" {
		t.Fatalf("the recorder starts right away: %+v", m.voice)
	}
	m = drive(t, m, voiceTickMsg{gen: m.voice.gen})
	if !strings.Contains(screenText(m), "완료 (3초)") {
		t.Fatalf("finish shows the seconds\n%s", screenText(m))
	}
	m = press(t, m, "space")
	if m.voice.phase != "paused" {
		t.Fatal("space pauses")
	}
	m = press(t, m, "space", "enter")
	return m
}

func TestVoiceRecordingMakesANewNote(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	fakeVoice(t, "회의 메모입니다")
	m := startApp(t, fake)
	m.voiceConfig.RefinementModel = ""
	m = click(t, m, "voice")
	m = recordAndFinish(t, m)
	if m.voice != nil {
		t.Fatalf("the recorder closes after saving: %+v", m.voice)
	}
	found := false
	for _, issue := range fake.issues {
		if strings.Contains(issue["body"].(string), "회의 메모입니다") {
			found = true
		}
	}
	if !found || m.note == nil || !strings.Contains(m.note.body.Value(), "회의 메모입니다") {
		t.Fatal("a voice note is created and opened")
	}
}

func TestVoiceRecordingAppendsToTheBody(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	fakeVoice(t, "계란도 사기")
	m := startApp(t, fake)
	m.voiceConfig.RefinementModel = ""
	m = press(t, m, "down", "down", "enter", "e")
	m = recordAndFinish(t, m)
	if !strings.Contains(fake.issue(2)["body"].(string), "- 우유\n\n계란도 사기") {
		t.Fatalf("body = %q", fake.issue(2)["body"])
	}
}

func TestVoiceWaveformUsesFourRowsForVisibleLevels(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m.voice = &voiceState{phase: "recording", status: "녹음 중", levels: []float64{0.2}, bar: newActionBar()}
	box := m.renderVoice()
	visible, rows := 0, 0
	for _, zone := range box.zones {
		if zone.id != "voice-wave" {
			continue
		}
		rows++
		if strings.ContainsAny(stripANSI(box.lines[zone.line]), "▁▂▃▄▅▆▇█") {
			visible++
		}
	}
	if rows != 4 || visible < 3 {
		t.Fatalf("wave rows=%d visible=%d", rows, visible)
	}
	m.height = 18
	box = m.renderVoice()
	rows = 0
	for _, zone := range box.zones {
		if zone.id == "voice-wave" {
			rows++
		}
	}
	if rows != 2 {
		t.Fatalf("short terminal wave rows=%d", rows)
	}
}

func TestVoiceWithoutKeyOpensTheSettings(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	fakeVoice(t, "")
	readVoiceKey = func() string { return "" }
	m := startApp(t, fake)
	m = click(t, m, "voice")
	if m.voice != nil || m.settings == nil || m.settings.focus != "voice-key" {
		t.Fatal("without a key the settings open at the API key field")
	}
	form := stripANSI(strings.Join(m.buildSettings(m.settingsInner()).lines, "\n"))
	for _, want := range []string{"음성 녹음", "OpenAI API 키", "음성 전사 모델", "텍스트 정제 모델", "원본 음성 보존", "정제 규칙", "약함", "중간", "강함", "자주 쓰는 전사 단어"} {
		if !strings.Contains(form, want) {
			t.Errorf("voice settings lack %q", want)
		}
	}
}
