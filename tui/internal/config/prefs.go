package config

import (
	"math"
	"strings"
)

// Preferences는 웹 환경설정(settings-storage.js의 normalizePreferences) 가운데 터미널에서
// 의미가 있는 항목이다. 글꼴·크기·줄간격·본문 너비는 터미널이 정하므로 두지 않는다.
type Preferences struct {
	Theme              string        `toml:"theme"`
	TitleMode          string        `toml:"title_mode"`
	ListRow            ListRowFields `toml:"list_row"`
	AutoSaveSeconds    int           `toml:"auto_save_seconds"`
	NotesPerPage       int           `toml:"notes_per_page"`
	LockSessionMinutes int           `toml:"lock_session_minutes"`
	// KeepInputSource면 단축키를 쓸 때 입력 소스를 영문 자판으로 바꾸지 않는다(TUI 전용, macOS).
	KeepInputSource bool `toml:"keep_input_source"`
	// LockPepper는 노트 잠금의 배포 pepper다(TUI 전용). 자체 배포 서버의 VITE_NOTE_LOCK_PEPPER와
	// 같은 값을 넣는다. 비우면 공식 값을 쓴다. 공개값이라 설정 파일에 둔다(docs/ENCRYPTION.md).
	LockPepper string `toml:"lock_pepper,omitempty"`
}

// ListRowFields는 노트 목록 행에 보일 항목이다(normalizeListRowFields).
type ListRowFields struct {
	Title   bool `toml:"title"`
	Summary bool `toml:"summary"`
	Meta    bool `toml:"meta"`
	Tags    bool `toml:"tags"`
}

const (
	ThemeDark  = "dark"
	ThemeLight = "light"
	// ThemeAuto는 터미널 배경색을 따른다. 웹에는 없고 TUI에만 있는 값이다.
	ThemeAuto = "auto"
)

// LockSessionOptions는 잠금 숫자를 기억하는 시간(분) 선택지다(LOCK_SESSION_OPTIONS).
var LockSessionOptions = []int{5, 15, 30, 60, 180, 480, 720, 1440}

func DefaultPreferences() Preferences {
	return Preferences{
		Theme:              ThemeAuto,
		TitleMode:          TitleFirstLine,
		ListRow:            ListRowFields{Title: true, Summary: true, Meta: true, Tags: true},
		AutoSaveSeconds:    5,
		NotesPerPage:       defaultNotesPerPage,
		LockSessionMinutes: 60,
		KeepInputSource:    true,
	}
}

// Normalize는 범위를 벗어난 값을 웹과 같은 규칙으로 맞춘다.
func (p Preferences) Normalize() Preferences {
	p.LockPepper = strings.TrimSpace(p.LockPepper)
	if p.Theme != ThemeDark && p.Theme != ThemeLight {
		p.Theme = ThemeAuto
	}
	if p.TitleMode != TitleSeparate {
		p.TitleMode = TitleFirstLine
	}
	p.AutoSaveSeconds = clampInt(p.AutoSaveSeconds, 3, 30, 5)
	p.NotesPerPage = clampInt(p.NotesPerPage, 10, 100, defaultNotesPerPage)
	valid := false
	for _, option := range LockSessionOptions {
		valid = valid || option == p.LockSessionMinutes
	}
	if !valid {
		p.LockSessionMinutes = 60
	}
	return p
}

func clampInt(value, minimum, maximum, fallback int) int {
	if value == 0 {
		return fallback
	}
	return int(math.Min(float64(maximum), math.Max(float64(minimum), float64(value))))
}

// rawDesktopPreferences는 데스크톱 config.toml에서 읽는 환경설정 키다(app-config.js의 ENTRIES).
type rawDesktopPreferences struct {
	Display struct {
		Theme     string `toml:"theme"`
		TitleMode string `toml:"title_mode"`
		ListRow   *struct {
			Title   *bool `toml:"title"`
			Summary *bool `toml:"summary"`
			Meta    *bool `toml:"meta"`
			Tags    *bool `toml:"tags"`
		} `toml:"list_row"`
	} `toml:"display"`
	Behavior struct {
		AutoSaveSeconds    *float64 `toml:"auto_save_seconds"`
		NotesPerPage       *float64 `toml:"notes_per_page"`
		LockSessionMinutes *float64 `toml:"lock_session_minutes"`
	} `toml:"behavior"`
	Voice VoiceSettings `toml:"voice"`
}

func (raw rawDesktopPreferences) preferences() Preferences {
	prefs := DefaultPreferences()
	if raw.Display.Theme != "" {
		prefs.Theme = raw.Display.Theme
	}
	if raw.Display.TitleMode != "" {
		prefs.TitleMode = raw.Display.TitleMode
	}
	if row := raw.Display.ListRow; row != nil {
		pick := func(value *bool) bool { return value == nil || *value }
		prefs.ListRow = ListRowFields{Title: pick(row.Title), Summary: pick(row.Summary), Meta: pick(row.Meta), Tags: pick(row.Tags)}
	}
	round := func(value *float64, target *int) {
		if value != nil {
			*target = int(math.Round(*value))
		}
	}
	round(raw.Behavior.AutoSaveSeconds, &prefs.AutoSaveSeconds)
	round(raw.Behavior.NotesPerPage, &prefs.NotesPerPage)
	round(raw.Behavior.LockSessionMinutes, &prefs.LockSessionMinutes)
	return prefs.Normalize()
}

// VoiceSettings는 음성 녹음 설정([voice], app-config.js의 voice 항목)이다. 값이 없는 항목은 nil이고,
// 쓰는 쪽(internal/ui)이 기본값(voice.DefaultSettings) 위에 데스크톱 → TUI 순서로 얹는다.
// OpenAI API 키는 여기 두지 않고 OS 자격 증명 저장소에 둔다(internal/auth).
type VoiceSettings struct {
	TranscriptionModel    *string `toml:"transcription_model,omitempty"`
	RefinementModel       *string `toml:"refinement_model,omitempty"`
	PreserveOriginalAudio *bool   `toml:"preserve_original_audio,omitempty"`
	RefinementPrompt      *string `toml:"refinement_prompt,omitempty"`
}
