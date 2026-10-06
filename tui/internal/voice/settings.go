// Package voice는 웹 앱의 음성 기록 모듈(src/lib/openai-voice.js, voice-settings.js,
// voice-notes.js, transcription-hints.js와 NoteEditor.svelte의 음성 도우미)을 옮긴 것이다.
// 결과가 웹과 같아야 하므로 고칠 때는 원본과 함께 고치고, 테스트의 기대값은 원본 JS 함수가
// 내는 값으로 둔다.
package voice

import (
	"regexp"
	"slices"
	"unicode/utf16"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// 기본 모델(DEFAULT_TRANSCRIPTION_MODEL, DEFAULT_REFINEMENT_MODEL)과 기본 정제 규칙
// (DEFAULT_REFINEMENT_PROMPT, 약함 프리셋과 같다).
const (
	DefaultTranscriptionModel = "gpt-transcribe"
	DefaultRefinementModel    = "gpt-5.6-luna"
	DefaultRefinementPrompt   = TypoCorrectionRefinementPrompt
)

// Preset은 환경설정의 정제 규칙 프리셋 버튼이다(VoiceSettings.svelte).
type Preset struct {
	Label  string
	Prompt string
}

// RefinementPresets는 화면에 보이는 순서대로의 약함·중간·강함 프리셋이다.
var RefinementPresets = []Preset{
	{Label: "약함", Prompt: TypoCorrectionRefinementPrompt},
	{Label: "중간", Prompt: WrittenStyleRefinementPrompt},
	{Label: "강함", Prompt: ConclusionFocusedRefinementPrompt},
}

// upgradedRefinementPrompts는 UPGRADED_REFINEMENT_PROMPTS다. 지난 프리셋 문구(앞뒤 공백 제거)를
// 같은 프리셋의 새 문구로 잇는다.
var upgradedRefinementPrompts = func() map[string]string {
	upgraded := map[string]string{}
	for _, group := range []struct {
		previous []string
		current  string
	}{
		{SupersededTypoPrompts, TypoCorrectionRefinementPrompt},
		{SupersededWrittenPrompts, WrittenStyleRefinementPrompt},
		{SupersededConclusionPrompts, ConclusionFocusedRefinementPrompt},
	} {
		for _, prompt := range group.previous {
			upgraded[jsTrim(prompt)] = group.current
		}
	}
	return upgraded
}()

// UpgradeRefinementPrompt는 upgradeRefinementPrompt와 같다. 비어 있으면 기본 규칙, 손대지 않은
// 지난 프리셋이면 같은 프리셋의 새 문구, 그 밖에는 앞뒤 공백만 뺀 값이다.
func UpgradeRefinementPrompt(prompt string) string {
	saved := jsTrim(prompt)
	if saved == "" {
		return DefaultRefinementPrompt
	}
	if upgraded, ok := upgradedRefinementPrompts[saved]; ok {
		return upgraded
	}
	return saved
}

// Settings는 음성 설정이다(loadVoiceSettings가 돌려주는 객체). 모델명이 비어 있으면 "없음"을
// 뜻하며, 정제 모델이 비어 있으면 녹음 완료 때 정제를 하지 않는다.
type Settings struct {
	APIKey                string
	TranscriptionModel    string
	RefinementModel       string
	PreserveOriginalAudio bool
	RefinementPrompt      string
}

// DefaultSettings는 저장값이 없을 때의 설정이다.
func DefaultSettings() Settings {
	return Settings{
		TranscriptionModel: DefaultTranscriptionModel,
		RefinementModel:    DefaultRefinementModel,
		RefinementPrompt:   DefaultRefinementPrompt,
	}
}

// Normalize는 loadVoiceSettings/saveVoiceSettings가 저장값에 하는 정리다. 키·모델명은 앞뒤
// 공백을 빼고(빈 모델명은 그대로 둔다), 정제 규칙은 UpgradeRefinementPrompt를 거친다. 값이
// 아예 없을 때 기본 모델을 쓰는 처리는 Go 문자열로 "없음"과 구분할 수 없어 DefaultSettings에 둔다.
func (s Settings) Normalize() Settings {
	return Settings{
		APIKey:                jsTrim(s.APIKey),
		TranscriptionModel:    jsTrim(s.TranscriptionModel),
		RefinementModel:       jsTrim(s.RefinementModel),
		PreserveOriginalAudio: s.PreserveOriginalAudio,
		RefinementPrompt:      UpgradeRefinementPrompt(s.RefinementPrompt),
	}
}

// ModelLists는 환경설정에서 고를 수 있는 모델 후보다.
type ModelLists struct {
	Transcription []string
	Refinement    []string
}

// DefaultModelLists는 DEFAULT_VOICE_MODEL_LISTS다.
func DefaultModelLists() ModelLists {
	return ModelLists{
		Transcription: []string{"gpt-transcribe", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"},
		Refinement:    []string{"gpt-5.6-luna"},
	}
}

var (
	datedModelSnapshot  = regexp.MustCompile(`-\d{4}-\d{2}-\d{2}(?:$|[-_])`)
	transcriptionModel  = regexp.MustCompile(`(?:^|-)transcribe(?:-|$)|^whisper-`)
	refinementModel     = regexp.MustCompile(`^(gpt-(?:4|5)|o[1-4])`)
	nonRefinementFamily = regexp.MustCompile(`(audio|realtime|transcribe|tts|image|moderation|embedding)`)
)

// IsDatedModelSnapshot은 날짜가 붙은 모델 스냅샷인지다(isDatedModelSnapshot).
func IsDatedModelSnapshot(model string) bool {
	return datedModelSnapshot.MatchString(jsTrim(model))
}

// UniqueModels는 uniqueModels(캐시 목록 정리)다: 앞뒤 공백을 빼고 빈 값·날짜 스냅샷·중복을 뺀다.
func UniqueModels(models []string) []string {
	unique := []string{}
	for _, model := range models {
		model = jsTrim(model)
		if model != "" && !IsDatedModelSnapshot(model) && !slices.Contains(unique, model) {
			unique = append(unique, model)
		}
	}
	return unique
}

// localeCompare는 기본 로캘의 String.prototype.localeCompare 순서로 정렬한다.
func sortLocale(values []string) {
	collator := collate.New(language.Und)
	slices.SortStableFunc(values, collator.CompareString)
}

// ClassifyModels는 classifyVoiceModels다. OpenAI 모델 ID를 전사용과 정제용으로 나누고 날짜
// 스냅샷과 특수 모델은 뺀다.
func ClassifyModels(modelIDs []string) ModelLists {
	sorted := []string{}
	for _, id := range modelIDs {
		if !IsDatedModelSnapshot(id) && !slices.Contains(sorted, id) {
			sorted = append(sorted, id)
		}
	}
	sortLocale(sorted)
	lists := ModelLists{Transcription: []string{}, Refinement: []string{}}
	for _, id := range sorted {
		if transcriptionModel.MatchString(id) {
			lists.Transcription = append(lists.Transcription, id)
		}
		if refinementModel.MatchString(id) && !nonRefinementFamily.MatchString(id) {
			lists.Refinement = append(lists.Refinement, id)
		}
	}
	return lists
}

// WithSelectedModels는 withSelectedModels다. 선택 중인 모델이 새 목록에 없으면 남겨 둔다.
// 원본 목록은 바꾸지 않는다.
func WithSelectedModels(lists ModelLists, transcription, refinement string) ModelLists {
	keep := func(models []string, selected string) []string {
		next := append([]string{}, models...)
		if !IsDatedModelSnapshot(selected) && selected != "" && !slices.Contains(next, selected) {
			next = append(next, selected)
		}
		sortLocale(next)
		return next
	}
	return ModelLists{
		Transcription: keep(lists.Transcription, transcription),
		Refinement:    keep(lists.Refinement, refinement),
	}
}

// MaskAPIKey는 maskApiKey다. 20자(UTF-16 단위)를 넘는 키는 앞뒤 10자만, 짧은 키는 모두 가린다.
func MaskAPIKey(value string) string {
	if value == "" {
		return ""
	}
	units := utf16.Encode([]rune(value))
	if len(units) <= 20 {
		return "••••••••••••"
	}
	return string(utf16.Decode(units[:10])) + "..." + string(utf16.Decode(units[len(units)-10:]))
}
