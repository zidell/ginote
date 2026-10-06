package ui

import (
	"context"
	"strconv"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/auth"
	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/voice"
)

// 음성 녹음 설정(VoiceSettings.svelte). 모델·정제 규칙·원본 보존은 TUI 설정 파일의 [voice]에,
// OpenAI API 키는 OS 자격 증명 저장소에, 자주 쓰는 전사 단어는 웹처럼 저장소(첨부 브랜치의
// voice-hints.json)에 둔다. 다른 환경설정처럼 확인을 눌러야 저장한다.

// voiceDraft는 환경설정 초안의 음성 항목이다.
type voiceDraft struct {
	apiKey             string
	transcriptionModel string
	refinementModel    string
	preserve           bool
	prompt             string
	hints              string
}

type voiceKeyMsg struct{ key string }

type voiceHintsMsg struct {
	repo  string
	hints string
	err   error
}

type voiceHintsSavedMsg struct {
	repo  string
	hints string
	err   error
}

type voiceModelsMsg struct {
	models []string
	err    error
}

// resolveVoice는 기본값 위에 데스크톱 → TUI 설정을 차례로 얹는다.
func resolveVoice(layers ...*config.VoiceSettings) voice.Settings {
	settings := voice.DefaultSettings()
	for _, layer := range layers {
		if layer == nil {
			continue
		}
		if layer.TranscriptionModel != nil {
			settings.TranscriptionModel = *layer.TranscriptionModel
		}
		if layer.RefinementModel != nil {
			settings.RefinementModel = *layer.RefinementModel
		}
		if layer.PreserveOriginalAudio != nil {
			settings.PreserveOriginalAudio = *layer.PreserveOriginalAudio
		}
		if layer.RefinementPrompt != nil {
			settings.RefinementPrompt = *layer.RefinementPrompt
		}
	}
	settings = settings.Normalize()
	// 전사 모델은 비울 수 없다(웹의 선택 상자에 "없음"이 없다).
	if strings.TrimSpace(settings.TranscriptionModel) == "" {
		settings.TranscriptionModel = voice.DefaultTranscriptionModel
	}
	return settings
}

// voiceFileSettings는 TUI 설정 파일에 쓸 [voice]다.
func (m Model) voiceFileSettings() *config.VoiceSettings {
	if !m.voiceCustom {
		return nil
	}
	settings := m.voiceConfig
	return &config.VoiceSettings{
		TranscriptionModel:    &settings.TranscriptionModel,
		RefinementModel:       &settings.RefinementModel,
		PreserveOriginalAudio: &settings.PreserveOriginalAudio,
		RefinementPrompt:      &settings.RefinementPrompt,
	}
}

// voiceSettings는 녹음에 쓸 설정(키 포함)이다.
func (m Model) voiceSettings() voice.Settings {
	settings := m.voiceConfig
	settings.APIKey = m.voiceKey
	return settings
}

func (m Model) voiceDraft() voiceDraft {
	return voiceDraft{
		apiKey:             m.voiceKey,
		transcriptionModel: m.voiceConfig.TranscriptionModel,
		refinementModel:    m.voiceConfig.RefinementModel,
		preserve:           m.voiceConfig.PreserveOriginalAudio,
		prompt:             m.voiceConfig.RefinementPrompt,
		hints:              m.voiceHints,
	}
}

// loadVoiceKey는 자격 증명 저장소에서 키를 읽는다. 키체인 확인 창이 뜰 수 있어 처음 쓸 때만 읽는다.
func loadVoiceKey() tea.Cmd {
	return func() tea.Msg { return voiceKeyMsg{key: readVoiceKey()} }
}

// readVoiceKey는 테스트에서 OS 자격 증명 저장소 대신 쓸 값으로 바꾼다.
var readVoiceKey = auth.OpenAIKey

// loadVoiceHints는 지금 저장소의 자주 쓰는 전사 단어를 읽는다.
func (m Model) loadVoiceHints() tea.Cmd {
	workspace, ok := m.activeWorkspace()
	if !ok {
		return nil
	}
	return func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return voiceHintsMsg{repo: workspace.Repo, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		hints, err := client.LoadVoiceTranscriptionHints(ctx, workspace.Repo)
		return voiceHintsMsg{repo: workspace.Repo, hints: hints, err: err}
	}
}

func (m Model) applyVoiceKey(msg voiceKeyMsg) (tea.Model, tea.Cmd) {
	m.voiceKeyLoaded = true
	if m.settings != nil && m.settings.draft.voice.apiKey == m.voiceKey {
		m.settings.draft.voice.apiKey = msg.key
	}
	m.voiceKey = msg.key
	if target := m.voicePending; target != nil {
		m.voicePending = nil
		return m.openVoice(*target)
	}
	return m, nil
}

func (m Model) applyVoiceHints(msg voiceHintsMsg) (tea.Model, tea.Cmd) {
	if msg.repo != m.repo() {
		return m, nil
	}
	m.voiceHintsLoading = false
	if msg.err != nil {
		m.voiceHintsErr = voice.HintsLoadFailedMessage
		return m, nil
	}
	m.voiceHintsErr = ""
	m.voiceHintsRepo = msg.repo
	if m.settings != nil && m.settings.draft.voice.hints == m.voiceHints {
		m.settings.draft.voice.hints = msg.hints
		delete(m.settings.inputs, "voice-hints")
	}
	m.voiceHints = msg.hints
	return m, nil
}

func (m Model) applyVoiceHintsSaved(msg voiceHintsSavedMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		return m.showToast(voice.HintsSaveFailedMessage + " " + describeError(msg.err))
	}
	if msg.repo == m.repo() {
		m.voiceHints = msg.hints
	}
	return m, nil
}

func (m Model) applyVoiceModels(msg voiceModelsMsg) (tea.Model, tea.Cmd) {
	m.voiceModelsBusy = false
	if msg.err != nil {
		m.voiceModelsErr = voice.ModelListFailedMessage + " " + msg.err.Error()
		return m, nil
	}
	m.voiceModelsErr = ""
	m.voiceModels = voice.ClassifyModels(msg.models)
	return m, nil
}

// openSettings는 환경설정을 연다. 웹처럼 열 때마다 저장소의 전사 단어를 다시 읽는다.
func (m Model) openSettings() (Model, tea.Cmd) {
	m.settings = m.newSettingsState()
	cmds := []tea.Cmd{m.loadVoiceHints()}
	m.voiceHintsLoading = true
	if !m.voiceKeyLoaded {
		cmds = append(cmds, loadVoiceKey())
	}
	return m, tea.Batch(cmds...)
}

// voiceSelectItems는 음성 모델 선택 창의 항목이다.
func (m Model) voiceSelectItems(id string) (string, []menuItem, int) {
	d := m.settings.draft.voice
	lists := voice.WithSelectedModels(m.voiceModels, d.transcriptionModel, d.refinementModel)
	var items []menuItem
	selected := 0
	add := func(value, label string, current bool) {
		item := menuItem{id: value, label: label}
		if current {
			item.icon = "✓"
			selected = len(items)
		}
		items = append(items, item)
	}
	switch id {
	case "voice-transcription":
		for _, model := range lists.Transcription {
			add(model, model, model == d.transcriptionModel)
		}
		return "음성 전사 모델", items, selected
	case "voice-refinement":
		add("", "없음", d.refinementModel == "")
		for _, model := range lists.Refinement {
			add(model, model, model == d.refinementModel)
		}
		return "텍스트 정제 모델", items, selected
	}
	return "", nil, 0
}

func (m Model) chooseVoiceSetting(field, value string) {
	d := &m.settings.draft.voice
	switch field {
	case "voice-transcription":
		d.transcriptionModel = value
	case "voice-refinement":
		d.refinementModel = value
	}
}

func (m Model) commitVoiceInput(id, value string) {
	d := &m.settings.draft.voice
	switch id {
	case "voice-key":
		d.apiKey = strings.TrimSpace(value)
	case "voice-hints":
		d.hints = value
	}
}

func (m Model) toggleVoiceSetting(id string) {
	if id == "voice-preserve" {
		m.settings.draft.voice.preserve = !m.settings.draft.voice.preserve
	}
}

func (m Model) setDraftRefinementPrompt(value string) {
	if m.settings != nil {
		m.settings.draft.voice.prompt = strings.TrimSpace(value)
	}
}

// activateVoiceSetting은 음성 설정의 버튼이다(모델 목록 새로고침·정제 규칙 프리셋·규칙 편집).
func (m Model) activateVoiceSetting(id string) (tea.Model, tea.Cmd) {
	d := &m.settings.draft.voice
	switch {
	case id == "voice-refresh":
		key := strings.TrimSpace(d.apiKey)
		if key == "" || m.voiceModelsBusy {
			return m, nil
		}
		m.voiceModelsBusy = true
		m.voiceModelsErr = ""
		return m, func() tea.Msg {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			models, err := voice.NewClient(key).ListModels(ctx)
			return voiceModelsMsg{models: models, err: err}
		}
	case strings.HasPrefix(id, "voice-preset:"):
		index, _ := strconv.Atoi(strings.TrimPrefix(id, "voice-preset:"))
		if index >= 0 && index < len(voice.RefinementPresets) {
			d.prompt = voice.RefinementPresets[index].Prompt
		}
	case id == "voice-prompt":
		m.prompt = newAreaPrompt("voice-prompt", "정제 규칙", "전사문을 다듬을 때 모델에 줄 규칙입니다. Enter는 줄바꿈, Ctrl+S나 확인 버튼으로 마칩니다. 환경설정에서 확인을 눌러야 저장됩니다.", d.prompt, 1000)
	}
	return m, nil
}

// applyVoiceDraft는 환경설정 확인 때 음성 항목을 적용한다.
func (m *Model) applyVoiceDraft(d voiceDraft) tea.Cmd {
	current := m.voiceDraft()
	if d == current {
		return nil
	}
	var cmds []tea.Cmd
	next := voice.Settings{TranscriptionModel: d.transcriptionModel, RefinementModel: d.refinementModel,
		PreserveOriginalAudio: d.preserve, RefinementPrompt: d.prompt}.Normalize()
	if next != m.voiceConfig {
		m.voiceConfig = next
		m.voiceCustom = true
	}
	if d.apiKey != current.apiKey {
		m.voiceKey = d.apiKey
		key := d.apiKey
		cmds = append(cmds, func() tea.Msg {
			if err := auth.SaveOpenAIKey(key); err != nil {
				return toastMsg{"OpenAI API 키를 자격 증명 저장소에 넣지 못했습니다: " + err.Error()}
			}
			return nil
		})
	}
	if d.hints != current.hints {
		if workspace, ok := m.activeWorkspace(); ok {
			hints := d.hints
			cmds = append(cmds, func() tea.Msg {
				client, err := clientFor(workspace)
				if err != nil {
					return voiceHintsSavedMsg{repo: workspace.Repo, err: err}
				}
				ctx, cancel := requestContext()
				defer cancel()
				saved, err := client.SaveVoiceTranscriptionHints(ctx, workspace.Repo, hints)
				return voiceHintsSavedMsg{repo: workspace.Repo, hints: saved, err: err}
			})
		}
	}
	return tea.Batch(cmds...)
}

// voiceTags는 정제 모델에 넘길 저장소 태그다.
func (m Model) voiceTags() []voice.Tag {
	var tags []voice.Tag
	for _, label := range m.visibleLabels() {
		tags = append(tags, voice.Tag{Name: label.Name, Description: label.Description})
	}
	return tags
}

func labelNames(labels []github.Label) []string {
	names := make([]string, 0, len(labels))
	for _, label := range labels {
		names = append(names, label.Name)
	}
	return names
}
