package ui

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/zidell/ginote/tui/internal/audio"
	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/notes"
	"github.com/zidell/ginote/tui/internal/voice"
)

// 음성 녹음 창(VoiceRecorder.svelte)과 기록(App.svelte의 recordVoiceNote).
// 열면 바로 녹음을 시작한다. Space로 멈추고 이어 가며, 완료(Enter)를 누르면 전사 → 정제 →
// 노트 기록을 한다. 실패하면 녹음을 그대로 두고 다시 시도하거나 원본을 내려받을 수 있다.

// voiceTarget은 녹음을 기록할 곳이다(웹의 voiceRecordingDestination).
type voiceTarget struct {
	kind      string // "new"(새 노트), "body"(본문 끝), "comment-new"(새 댓글), "comment-edit"(댓글 끝)
	number    int
	commentID int64
}

type voiceState struct {
	target  voiceTarget
	gen     int
	rec     audio.Recorder
	phase   string // "preparing", "recording", "paused", "processing", "failed"
	status  string
	err     string
	levels  []float64
	bar     actionBar
	cancel  context.CancelFunc
	audio   *audio.Recording // 끝낸 녹음. 실패하면 다시 시도할 때 쓴다
	elapsed time.Duration
}

// newRecorder는 테스트에서 가짜 녹음기로 바꾼다.
var newRecorder = audio.New

var voiceGen int

type voiceStartedMsg struct {
	gen int
	err error
}

type voiceTickMsg struct{ gen int }

type voiceStatusMsg struct {
	gen    int
	text   string
	status <-chan string
}

type voiceProcessedMsg struct {
	gen       int
	recording audio.Recording
	result    voice.Refinement
	err       error
}

type voiceSavedMsg struct {
	gen        int
	target     voiceTarget
	body       string
	tags       []string
	issue      github.Issue
	comment    github.Comment
	attachment github.Attachment
	link       string
	err        error
}

var voiceTickInterval = 100 * time.Millisecond

func voiceTick(gen int) tea.Cmd {
	return tea.Tick(voiceTickInterval, func(time.Time) tea.Msg { return voiceTickMsg{gen} })
}

// openVoice는 녹음 창을 연다(openVoiceRecording). 키가 없으면 환경설정의 API 키 칸으로 보낸다.
func (m Model) openVoice(target voiceTarget) (Model, tea.Cmd) {
	if m.voice != nil || m.selectionMode() || len(m.workspaces) == 0 || (m.note != nil && m.note.pending) {
		return m, nil
	}
	if !m.voiceKeyLoaded {
		m.voicePending = &target
		return m, loadVoiceKey()
	}
	if strings.TrimSpace(m.voiceKey) == "" {
		next, cmd := m.openSettings()
		next.settings.focus = "voice-key"
		next, toast := next.showToast("음성 녹음을 사용하려면 OpenAI API 키를 발급한 뒤 환경설정의 음성 API 키에 지정하세요.")
		return next, tea.Batch(cmd, toast)
	}
	var cmds []tea.Cmd
	// 녹음 진입 때 이 저장소의 전사 단어를 한 번만 읽는다(웹과 같다).
	if m.voiceHintsRepo != m.repo() && !m.voiceHintsLoading {
		m.voiceHintsLoading = true
		cmds = append(cmds, m.loadVoiceHints())
	}
	m.blurInputs()
	voiceGen++
	rec := newRecorder()
	m.voice = &voiceState{target: target, gen: voiceGen, rec: rec, phase: "preparing", status: "마이크를 준비하고 있습니다…", bar: newActionBar()}
	gen := voiceGen
	cmds = append(cmds, func() tea.Msg { return voiceStartedMsg{gen: gen, err: rec.Start()} })
	return m, tea.Batch(cmds...)
}

// voiceTargetForNote는 노트에서 녹음할 곳이다. 저장 전 새 노트는 녹음할 수 없다.
func (m Model) voiceTargetForNote(kind string, commentID int64) (voiceTarget, bool) {
	if m.note == nil || m.note.number() == 0 || !m.note.editable(m.state == "closed") {
		return voiceTarget{}, false
	}
	return voiceTarget{kind: kind, number: m.note.number(), commentID: commentID}, true
}

func (m Model) closeVoice() (Model, tea.Cmd) {
	if v := m.voice; v != nil {
		if v.cancel != nil {
			v.cancel()
		}
		v.rec.Close()
	}
	m.voice = nil
	return m, nil
}

func (v *voiceState) actions() []modalAction {
	seconds := int(v.elapsed / time.Second)
	finish := modalAction{id: "finish", label: fmt.Sprintf("완료 (%d초)", seconds), primary: true, disabled: v.elapsed == 0}
	cancel := modalAction{id: "cancel", label: "취소"}
	switch v.phase {
	case "recording":
		return []modalAction{finish, {id: "pause", label: "일시정지"}, cancel}
	case "paused":
		return []modalAction{finish, {id: "resume", label: "계속 녹음"}, cancel}
	case "processing":
		return []modalAction{{id: "finish", label: "기록 중…", primary: true, disabled: true}, cancel}
	case "failed":
		if v.audio != nil {
			return []modalAction{{id: "retry", label: "다시 시도", primary: true}, {id: "download", label: "원본 내려받기"}, cancel}
		}
		if v.elapsed > 0 {
			return []modalAction{finish, {id: "resume", label: "계속 녹음"}, cancel}
		}
		return []modalAction{{id: "restart", label: "다시 녹음", primary: true}, cancel}
	}
	return []modalAction{cancel}
}

func (m Model) handleVoiceKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	v := m.voice
	key := keyName(msg)
	if pressed, handled := v.bar.barKey(v.actions(), key); handled {
		return m.voiceAction(pressed)
	}
	switch key {
	case "esc", "q":
		return m.voiceAction("cancel")
	case "space", "r":
		switch v.phase {
		case "recording":
			return m.voiceAction("pause")
		case "paused":
			return m.voiceAction("resume")
		}
	case "enter":
		for _, action := range v.actions() {
			if action.primary && !action.disabled {
				return m.voiceAction(action.id)
			}
		}
	}
	return m, nil
}

func (m Model) voiceAction(id string) (tea.Model, tea.Cmd) {
	v := m.voice
	switch id {
	case "cancel":
		// 녹음한 것이 있으면 버릴지 묻는다(웹의 requestClose).
		if (v.phase == "recording" || v.phase == "paused" || v.phase == "failed") && v.elapsed >= time.Second {
			m.prompt = newConfirmPrompt("confirm:cancel-voice", "녹음 취소", "녹음한 내용을 버리고 닫을까요?", "")
			return m, nil
		}
		return m.closeVoice()
	case "pause":
		v.rec.Pause()
		v.phase = "paused"
		v.status = "재개하시거나 완료하세요."
	case "resume":
		if err := v.rec.Resume(); err != nil {
			v.phase, v.err = "failed", "녹음을 시작할 수 없습니다. "+err.Error()
			return m, nil
		}
		v.phase, v.status, v.err = "recording", "녹음 중", ""
		return m, voiceTick(v.gen)
	case "finish":
		if v.elapsed == 0 || (v.phase != "recording" && v.phase != "paused" && v.phase != "failed") {
			return m, nil
		}
		return m.processVoice(nil)
	case "retry":
		return m.processVoice(v.audio)
	case "restart":
		v.rec.Close()
		m.voice = nil
		return m.openVoice(v.target)
	case "download":
		return m, m.saveVoiceAudio()
	}
	return m, nil
}

// processVoice는 녹음을 끝내고 전사·정제한다. recording이 있으면(다시 시도) 그것을 쓴다.
func (m Model) processVoice(recording *audio.Recording) (tea.Model, tea.Cmd) {
	v := m.voice
	v.phase, v.err = "processing", ""
	v.status = voice.StatusTranscribing
	v.bar = newActionBar()
	ctx, cancel := context.WithCancel(context.Background())
	v.cancel = cancel
	gen, rec := v.gen, v.rec
	settings, hints, tags := m.voiceSettings(), m.voiceHints, m.voiceTags()
	status := make(chan string, 8)
	pipeline := func() tea.Msg {
		defer close(status)
		var finished audio.Recording
		if recording != nil {
			finished = *recording
		} else {
			var err error
			finished, err = rec.Finish()
			if err != nil {
				return voiceProcessedMsg{gen: gen, err: err}
			}
		}
		result, err := voice.NewClient(settings.APIKey).Process(ctx, finished.Data, finished.ContentType, settings, "ko", hints, tags,
			func(text string) {
				select {
				case status <- text:
				default:
				}
			})
		return voiceProcessedMsg{gen: gen, recording: finished, result: result, err: err}
	}
	return m, tea.Batch(pipeline, waitVoiceStatus(gen, status))
}

func waitVoiceStatus(gen int, status <-chan string) tea.Cmd {
	return func() tea.Msg {
		text, ok := <-status
		if !ok {
			return nil
		}
		return voiceStatusMsg{gen: gen, text: text, status: status}
	}
}

// handleVoiceMsg는 녹음 창의 비동기 메시지다. 창을 닫았거나 새로 열었으면 버린다.
func (m Model) handleVoiceMsg(msg tea.Msg) (tea.Model, tea.Cmd, bool) {
	v := m.voice
	switch msg := msg.(type) {
	case voiceStartedMsg:
		if v == nil || v.gen != msg.gen {
			return m, nil, true
		}
		if msg.err != nil {
			v.phase, v.status = "failed", "마이크를 사용할 수 없습니다."
			v.err = msg.err.Error()
			if errors.Is(msg.err, audio.ErrUnsupported) {
				v.err = "이 빌드에서는 음성 녹음을 지원하지 않습니다."
			}
			return m, nil, true
		}
		v.phase, v.status = "recording", "녹음 중"
		return m, voiceTick(v.gen), true
	case voiceTickMsg:
		if v == nil || v.gen != msg.gen || v.phase != "recording" {
			return m, nil, true
		}
		v.elapsed = v.rec.Elapsed()
		v.levels = append(v.levels, v.rec.Level())
		if len(v.levels) > 200 {
			v.levels = v.levels[len(v.levels)-200:]
		}
		if v.elapsed >= audio.MaxDuration {
			v.status = "최대 녹음 시간에 도달했습니다. 자동으로 완료하는 중…"
			next, cmd := m.processVoice(nil)
			return next, cmd, true
		}
		return m, voiceTick(v.gen), true
	case voiceStatusMsg:
		if v == nil || v.gen != msg.gen {
			return m, nil, true
		}
		if v.phase == "processing" {
			v.status = msg.text
		}
		return m, waitVoiceStatus(msg.gen, msg.status), true
	case voiceProcessedMsg:
		if v == nil || v.gen != msg.gen {
			return m, nil, true
		}
		if msg.recording.Data != nil {
			recording := msg.recording
			v.audio = &recording
		}
		if msg.err != nil {
			return m.voiceFailed(msg.err), nil, true
		}
		v.status = voice.StatusSaving
		return m, m.recordVoiceNote(msg.result, msg.recording), true
	case voiceSavedMsg:
		next, cmd := m.applyVoiceSaved(msg)
		return next, cmd, true
	}
	return m, nil, false
}

func (m Model) voiceFailed(err error) Model {
	v := m.voice
	v.phase = "failed"
	v.status = voice.StatusRetryable
	v.bar = newActionBar()
	if errors.Is(err, context.Canceled) {
		v.err = ""
		return m
	}
	v.err = describeError(err)
	if v.err == "" {
		v.err = voice.RecordingFailedMessage
	}
	return m
}

// recordVoiceNote는 정제한 결과를 기록한다(App.svelte의 같은 이름 함수).
func (m Model) recordVoiceNote(result voice.Refinement, recording audio.Recording) tea.Cmd {
	workspace, ok := m.activeWorkspace()
	v := m.voice
	if !ok || v == nil {
		return nil
	}
	gen, target := v.gen, v.target
	body := voice.NormalizeParagraphs(result.Body)
	title := voice.NormalizeSuggestedTitle(result.Title)
	tags := voice.KnownTagNames(result.Tags, labelNames(m.visibleLabels()))
	preserve, titleMode := m.voiceConfig.PreserveOriginalAudio, m.prefs.TitleMode
	return func() tea.Msg {
		saved := voiceSavedMsg{gen: gen, target: target, body: body, tags: tags}
		client, err := clientFor(workspace)
		if err != nil {
			saved.err = err
			return saved
		}
		ctx, cancel := requestContext()
		defer cancel()
		upload := func(number int) error {
			if !preserve || len(recording.Data) == 0 {
				return nil
			}
			name, fileType := voice.AudioFile(recording.ContentType, time.Now())
			saved.attachment, err = client.UploadAttachment(ctx, workspace.Repo, number, name, fileType, recording.Data, 0)
			return err
		}
		addTags := func() error {
			for _, name := range tags {
				if _, err := client.AddIssueLabel(ctx, workspace.Repo, target.number, name); err != nil {
					return err
				}
			}
			return nil
		}
		switch target.kind {
		case "body":
			saved.err = upload(target.number)
		case "comment-edit":
			if saved.err = addTags(); saved.err == nil {
				saved.err = upload(target.number)
				saved.link = voice.AttachmentLink(workspace.Repo, saved.attachment.Path)
			}
		case "comment-new":
			if saved.err = addTags(); saved.err != nil {
				return saved
			}
			if saved.err = upload(target.number); saved.err != nil {
				return saved
			}
			// 태그만 말한 경우 빈 댓글을 만들지 않는다.
			if body == "" && saved.attachment.Path == "" {
				return saved
			}
			saved.comment, saved.err = client.CreateIssueComment(ctx, workspace.Repo, target.number,
				voice.AppendAttachmentLink(body, workspace.Repo, saved.attachment.Path))
		default:
			issueTitle, issueBody := voice.ComposeIssue(titleMode, body, title)
			saved.issue, saved.err = client.CreateIssue(ctx, workspace.Repo, github.NoteInput{Title: issueTitle, Body: issueBody, Labels: tags})
			if saved.err == nil {
				// 원본 업로드가 실패해도 노트는 이미 만들었으므로 실패로 보지 않는다.
				if err := upload(saved.issue.Number); err != nil {
					saved.attachment = github.Attachment{}
				}
			}
		}
		return saved
	}
}

func (m Model) applyVoiceSaved(msg voiceSavedMsg) (tea.Model, tea.Cmd) {
	if m.voice == nil || m.voice.gen != msg.gen {
		return m, nil
	}
	if msg.err != nil {
		return m.voiceFailed(msg.err), nil
	}
	m, _ = m.closeVoice()
	n := m.note
	switch msg.target.kind {
	case "new":
		var reset tea.Cmd
		if m.state != "open" || m.appliedQuery != "" || m.activeLabel != "" {
			m.state = "open"
			m.search.SetValue("")
			m.appliedQuery = ""
			m.activeLabel = ""
			m, reset = m.restartList()
		}
		m.issues = append([]github.Issue{msg.issue}, removeIssue(m.issues, msg.issue.ID)...)
		m.kbFocus = msg.issue.ID
		m.entered = msg.issue.ID
		next, open := m.openNote(msg.issue, false)
		next, toast := next.showToast("음성 노트를 만들었습니다.")
		return next, tea.Batch(reset, open, toast)
	case "body":
		if n == nil || n.number() != msg.target.number {
			return m.showToast("음성 기록을 받은 노트가 닫혀 있어 본문에 넣지 못했습니다.")
		}
		if msg.attachment.Path != "" {
			n.attachments = append(n.attachments, inferAttachment(msg.attachment))
		}
		for _, name := range msg.tags {
			if !n.hasLabel(name) {
				n.labels = append(n.labels, name)
			}
		}
		n.body.SetValue(voice.AppendText(n.body.Value(), msg.body))
		n.changed()
		n.dirty = true
		m.layoutNote()
		return m.saveNote(true)
	case "comment-new":
		if n == nil || n.number() != msg.target.number {
			return m, nil
		}
		m.addVoiceTags(msg.tags)
		if msg.comment.ID != 0 {
			n.comments = append(n.comments, newCommentState(msg.comment, n.repo))
		}
		m.layoutNote()
		return m, nil
	case "comment-edit":
		if n == nil || n.number() != msg.target.number {
			return m, nil
		}
		m.addVoiceTags(msg.tags)
		for index := range n.comments {
			comment := &n.comments[index]
			if comment.comment.ID != msg.target.commentID {
				continue
			}
			current := notes.ExpandAttachmentLinks(comment.editor.Value(), n.repo)
			comment.editor.SetValue(notes.CompressAttachmentLinks(voice.AppendToComment(current, msg.body, msg.link), n.repo))
			m.layoutNote()
			return m.saveComment(index)
		}
	}
	return m, nil
}

// addVoiceTags는 서버에서 이미 붙인 태그를 화면의 노트에도 더한다.
func (m Model) addVoiceTags(tags []string) {
	n := m.note
	for _, name := range tags {
		if !n.hasLabel(name) {
			n.labels = append(n.labels, name)
		}
	}
}

// saveVoiceAudio는 실패한 녹음의 원본을 내려받기 폴더에 저장한다(웹의 원본 음성 다운로드).
func (m Model) saveVoiceAudio() tea.Cmd {
	v := m.voice
	if v == nil || v.audio == nil {
		return nil
	}
	recording := *v.audio
	return func() tea.Msg {
		home, err := os.UserHomeDir()
		if err != nil {
			return toastMsg{"원본을 저장하지 못했습니다: " + err.Error()}
		}
		name, _ := voice.AudioFile(recording.ContentType, time.Now())
		path := filepath.Join(home, "Downloads", name)
		if err := os.WriteFile(path, recording.Data, 0o600); err != nil {
			return toastMsg{"원본을 저장하지 못했습니다: " + err.Error()}
		}
		return toastMsg{"원본 음성을 저장했습니다: " + path}
	}
}

// renderVoice는 녹음 창이다. 웹의 파형 대신 소리 크기를 막대로 보인다.
func (m Model) renderVoice() modalBox {
	t := m.th
	v := m.voice
	width := m.modalWidth(56)
	var content modalContent
	indicator := t.fg(t.faint).Render("○ 준비 중")
	switch v.phase {
	case "recording":
		indicator = lipgloss.NewStyle().Foreground(t.danger).Bold(true).Render("● 녹음 중")
	case "paused":
		indicator = t.fg(t.shortcut).Render("❚❚ 일시정지")
	case "processing":
		indicator = t.fg(t.accentBright).Render("⠋ 기록 중")
	case "failed":
		indicator = t.fg(t.danger).Render("! 멈춤")
	}
	clock := lipgloss.NewStyle().Foreground(t.title).Bold(true).Render(formatDuration(v.elapsed))
	content.add(fitLine(indicator, width-lipgloss.Width(clock)) + clock)
	content.add("")
	// 소리 크기: 최근 값부터 오른쪽에 쌓는다. 보통 네 줄, 낮은 터미널에서는 두세 줄이다.
	blocks := []rune(" ▁▂▃▄▅▆▇█")
	waveRows := min(4, max(2, m.height-16))
	rows := make([][]rune, waveRows)
	for row := range rows {
		rows[row] = make([]rune, width)
	}
	for column := 0; column < width; column++ {
		index := len(v.levels) - width + column
		level := 0.0
		if index >= 0 {
			level = min(1, v.levels[index]*4)
		}
		steps := int(level*float64(waveRows*8) + 0.5)
		for row := range rows {
			rows[row][column] = blocks[min(8, max(0, steps-(waveRows-row-1)*8))]
		}
	}
	waveColor := t.accentBright
	if v.phase != "recording" {
		waveColor = t.faint
	}
	for _, row := range rows {
		content.addRow(hit("voice-wave", t.fg(waveColor).Render(string(row))))
	}
	content.add("")
	content.add(t.fg(t.secondary).Render(truncate(v.status, width)))
	if v.err != "" {
		for _, line := range wrapText(v.err, width) {
			content.add(t.fg(t.danger).Render(line))
		}
	}
	content.add("")
	switch v.phase {
	case "recording", "paused":
		content.add(t.fg(t.faint).Render("Space 일시정지·계속 · Enter 완료 · Esc 취소"))
	case "processing":
		content.add(t.fg(t.faint).Render("Esc를 누르면 기록을 멈춥니다."))
	}
	return m.buildModal("음성 녹음", content, width, v.actions(), v.bar)
}

func formatDuration(value time.Duration) string {
	seconds := int(value / time.Second)
	if seconds >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", seconds/3600, seconds/60%60, seconds%60)
	}
	return fmt.Sprintf("%02d:%02d", seconds/60, seconds%60)
}
