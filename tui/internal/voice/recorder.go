package voice

import (
	"context"
	"errors"
)

// 전사 힌트(src/lib/transcription-hints.js)를 읽거나 저장하지 못했을 때 오류에 메시지가 없으면
// 보여 주는 문구다. 힌트 파일 읽기·쓰기는 github 패키지(LoadVoiceTranscriptionHints,
// SaveVoiceTranscriptionHints)가 하고, 전사 요청의 prompt로 바꾸는 일은 TranscriptionPrompt가 한다.
const (
	HintsLoadFailedMessage = "전사 힌트를 불러오지 못했습니다."
	HintsSaveFailedMessage = "전사 힌트를 저장하지 못했습니다."
)

// 음성 녹음 화면(VoiceRecorder.svelte)의 상태·오류 문구다.
const (
	StatusTranscribing      = "음성을 텍스트로 변환하는 중…"
	StatusRefining          = "텍스트를 정제하는 중…"
	StatusSaving            = "노트에 기록하는 중…"
	StatusRetryable         = "다시 시도할 수 있습니다."
	NoRecordingMessage      = "먼저 음성을 녹음해 주세요."
	NoTranscriptMessage     = "음성에서 텍스트를 찾지 못했습니다."
	EmptyRefinementMessage  = "정제된 텍스트와 선택된 태그가 모두 비어 있습니다."
	RecordingFailedMessage  = "음성 기록에 실패했습니다."
	ModelListFailedMessage  = "모델 목록을 가져오지 못했습니다."
	transcriptionRetryLabel = "음성 전사"
	refinementRetryLabel    = "텍스트 정제"
)

// Process는 VoiceRecorder.svelte의 submit()에서 녹음 이후의 처리다. 전사하고, 정제 모델이
// 있으면 정제한다. 각 요청은 취소가 아닌 실패에서 한 번 더 시도한다. status에는 화면에 보일
// 진행 문구가 순서대로 온다(nil 가능). 결과의 Body는 정리 전 값이므로 노트에 넣기 전에
// NormalizeParagraphs·NormalizeSuggestedTitle·KnownTagNames를 거친다(App.svelte recordVoiceNote).
func (c *Client) Process(ctx context.Context, audio []byte, contentType string, settings Settings, language, hints string, tags []Tag, status func(string)) (Refinement, error) {
	report := func(message string) {
		if status != nil {
			status(message)
		}
	}
	report(StatusTranscribing)
	transcript, err := retryOnce(ctx, transcriptionRetryLabel, report, func() (string, error) {
		return c.Transcribe(ctx, audio, contentType, settings.TranscriptionModel, language, hints)
	})
	if err != nil {
		return Refinement{}, err
	}
	if transcript == "" {
		return Refinement{}, errors.New(NoTranscriptMessage)
	}
	result := Refinement{Body: transcript, Tags: []string{}}
	// 모델을 고른 경우에만 편집 가능한 정제 규칙을 적용한다.
	if model := jsTrim(settings.RefinementModel); model != "" {
		report(StatusRefining)
		result, err = retryOnce(ctx, refinementRetryLabel, report, func() (Refinement, error) {
			return c.Refine(ctx, transcript, settings.RefinementPrompt, settings.RefinementModel, tags)
		})
		if err != nil {
			return Refinement{}, err
		}
	}
	if result.Body == "" && len(result.Tags) == 0 {
		return Refinement{}, errors.New(EmptyRefinementMessage)
	}
	return result, nil
}

// retryOnce는 같은 이름의 함수(VoiceRecorder.svelte)다. 취소가 아니면 문구를 알리고 한 번 더 한다.
func retryOnce[T any](ctx context.Context, label string, report func(string), operation func() (T, error)) (T, error) {
	value, err := operation()
	if err == nil || ctx.Err() != nil || errors.Is(err, context.Canceled) {
		return value, err
	}
	report(label + "에 실패해 한 번 더 시도하는 중…")
	return operation()
}
