package ui

import (
	"fmt"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/zidell/ginote/tui/internal/auth"
	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/ime"
	"github.com/zidell/ginote/tui/internal/notes"
	"github.com/zidell/ginote/tui/internal/voice"
)

// 환경설정 시트. 웹(App.svelte의 SheetView)과 같은 구성이다.
//
//	저장소 관리: 저장소마다 카드(이름·현재 사용 중·↑·↓·⋯). 펼친 카드 안에 태그 관리
//	            (새 태그 칸·추가, 태그마다 이름 칸·삭제). 아래에 "다른 저장소 추가".
//	편집기 설정·음성 녹음: 테두리 상자 안에 라벨과 값(선택 상자·체크·글자 칸).
//
// 웹은 바꿀 때마다 바로 저장하지만, TUI 모달은 확인을 눌러야 저장한다(modal.go). 열 때 지금 값을
// 초안(draft)으로 복사하고, 바꾸는 것은 모두 초안에만 반영한다. 확인을 누르면 환경설정·저장소
// 순서·이름·전환·연결 해제·태그 추가·이름 바꾸기·삭제를 한꺼번에 적용하고, 취소·Esc는 버린다.
// ↑/↓로 항목을 옮기고 Enter·Space로 누르며, 선택 상자는 ←/→로도 바꾼다. Tab은 버튼 줄로 간다.

type settingsState struct {
	focus    string // 포커스가 있는 항목 id
	scroll   int
	expanded string // 펼친 저장소 id. "\x00"이면 초안에서 쓰는 저장소
	inputs   map[string]*textinput.Model
	bar      actionBar
	draft    settingsDraft
	// shownFocus는 마지막으로 화면에 맞춘 포커스다. 포커스가 바뀔 때만 스크롤을 따라 옮긴다.
	shownFocus string
}

// settingsDraft는 확인을 누르기 전까지의 바뀐 값이다.
type settingsDraft struct {
	prefs      config.Preferences
	workspaces []config.Workspace
	removed    []config.Workspace
	active     string // 확인하면 쓸 저장소 id
	tagOps     []tagOp
	voice      voiceDraft
}

// tagOp은 확인하면 저장소에 보낼 태그 변경이다.
type tagOp struct {
	kind        string // "create", "rename", "delete"
	name        string // create·delete: 태그 이름. rename: 바꾸기 전 이름
	newName     string
	description string
}

func (m Model) newSettingsState() *settingsState {
	s := &settingsState{inputs: map[string]*textinput.Model{}, expanded: "\x00", bar: newActionBar()}
	s.draft.prefs = m.prefs
	s.draft.workspaces = append([]config.Workspace{}, m.workspaces...)
	if workspace, ok := m.activeWorkspace(); ok {
		s.draft.active = workspace.ID
	}
	s.draft.voice = m.voiceDraft()
	return s
}

// dirty는 초안이 지금 값과 다른지다(닫을 때 버릴지 묻는다).
func (s *settingsState) dirty(m Model) bool {
	d := s.draft
	if d.prefs != m.prefs || len(d.removed) > 0 || len(d.tagOps) > 0 || len(d.workspaces) != len(m.workspaces) || d.voice != m.voiceDraft() {
		return true
	}
	if workspace, ok := m.activeWorkspace(); ok && workspace.ID != d.active {
		return true
	}
	for index := range d.workspaces {
		if d.workspaces[index] != m.workspaces[index] {
			return true
		}
	}
	return false
}

func (s *settingsState) actions() []modalAction {
	return []modalAction{{id: "apply", label: "확인", primary: true}, {id: "cancel", label: "취소"}}
}

// settingsControl은 누를 수 있는 항목 하나의 위치다(내용 안 좌표).
type settingsControl struct {
	id    string
	kind  string // "button", "text", "select", "check", "header"
	line  int
	x     int
	width int
}

type settingsForm struct {
	lines    []string
	controls []settingsControl
}

func (f *settingsForm) add(line string) { f.lines = append(f.lines, line) }

// addRow는 버튼·칸이 섞인 한 줄을 더한다. kind가 있는 조각은 포커스 항목이 된다.
func (f *settingsForm) addRow(parts ...formPart) {
	var builder strings.Builder
	column := 0
	for _, part := range parts {
		width := lipgloss.Width(part.text)
		if part.id != "" {
			f.controls = append(f.controls, settingsControl{id: part.id, kind: part.kind, line: len(f.lines), x: column, width: width})
		}
		builder.WriteString(part.text)
		column += width
	}
	f.add(builder.String())
}

type formPart struct {
	text, id, kind string
}

func plain(text string) formPart { return formPart{text: text} }

var (
	themeOptions    = []string{config.ThemeAuto, config.ThemeDark, config.ThemeLight}
	themeLabels     = map[string]string{config.ThemeAuto: "터미널 따라가기", config.ThemeDark: "다크모드 (기본)", config.ThemeLight: "라이트모드"}
	titleModes      = []string{config.TitleFirstLine, config.TitleSeparate}
	titleModeLabels = map[string]string{config.TitleFirstLine: "본문 첫 줄에서 앞 50자를 제목으로 사용", config.TitleSeparate: "제목을 별도 입력"}
)

func lockMinutesLabel(minutes int) string {
	if minutes >= 60 {
		return fmt.Sprintf("%d시간", minutes/60)
	}
	return fmt.Sprintf("%d분", minutes)
}

// input은 설정 시트의 글자 칸이다. 처음 쓸 때 만들고 값을 채운다.
func (s *settingsState) input(id, value, placeholder string) *textinput.Model {
	if input, ok := s.inputs[id]; ok {
		return input
	}
	input := textinput.New()
	input.Prompt = ""
	input.Placeholder = placeholder
	input.CharLimit = 3000
	input.SetVirtualCursor(false)
	if id == "voice-key" {
		input.EchoMode = textinput.EchoPassword
		input.EchoCharacter = '•'
	}
	input.SetValue(value)
	s.inputs[id] = &input
	return &input
}

func (m Model) expandedWorkspace() string {
	if m.settings.expanded != "\x00" {
		return m.settings.expanded
	}
	return m.settings.draft.active
}

// draftLabel은 초안의 태그 하나다(저장소 태그에 초안의 변경을 얹은 것).
type draftLabel struct {
	original    string // 저장소에 있는 이름(새 태그면 새 이름)
	name        string
	description string
	deleted     bool
	pending     string // "추가 예정"·"이름 바꿀 예정"
}

func (m Model) draftLabels() []draftLabel {
	var labels []draftLabel
	for _, label := range m.visibleLabels() {
		labels = append(labels, draftLabel{original: label.Name, name: label.Name, description: label.Description})
	}
	for _, op := range m.settings.draft.tagOps {
		switch op.kind {
		case "create":
			labels = append(labels, draftLabel{original: op.name, name: op.name, description: op.description, pending: "추가 예정"})
		case "rename":
			for index := range labels {
				if labels[index].original == op.name {
					labels[index].name, labels[index].description = op.newName, op.description
					if labels[index].pending == "" {
						labels[index].pending = "바꿀 예정"
					}
				}
			}
		case "delete":
			for index := range labels {
				if labels[index].original == op.name {
					labels[index].deleted = true
				}
			}
		}
	}
	return labels
}

func (m Model) buildSettings(width int) settingsForm {
	t := m.th
	s := m.settings
	var form settingsForm
	focused := func(id string) bool { return s.focus == id }

	// 웹의 버튼·칸 모양. 포커스가 있으면 주황 글자와 밝은 배경으로 보인다.
	button := func(id, label string, danger, disabled bool) formPart {
		color := t.text
		if danger {
			color = t.danger
		}
		if disabled {
			color = t.disabled
		}
		background := t.bgInput
		if focused(id) {
			background = t.bgHover
			color = t.shortcut
		}
		return formPart{text: fillBackground(" "+lipgloss.NewStyle().Foreground(color).Render(label)+" ", 0, background), id: id, kind: "button"}
	}
	field := func(id, kind, value, placeholder string, fieldWidth int) formPart {
		background := t.bgInput
		text := value
		switch {
		case kind == "text" && focused(id):
			input := s.input(id, value, placeholder)
			input.SetWidth(fieldWidth - 2)
			input.Focus()
			text = " " + input.View()
			background = t.bgHover
		case kind == "text":
			if input, ok := s.inputs[id]; ok {
				text = input.Value()
			}
			if text == "" {
				text = t.fg(t.placeholder).Render(placeholder)
			}
			text = " " + text
		case kind == "select":
			text = fitLine(" "+value, fieldWidth-2) + t.fg(t.muted).Render("▾ ")
			if focused(id) {
				background = t.bgHover
			}
		}
		marker := " "
		if focused(id) {
			marker = t.fg(t.shortcut).Render("▌")
		}
		return formPart{text: marker + fillBackground(text, fieldWidth, background), id: id, kind: kind}
	}
	check := func(id, label string, value bool) formPart {
		box := "[ ]"
		if value {
			box = t.fg(t.accentBright).Render("[✓]")
		}
		text := box + " " + label
		if focused(id) {
			text = fillBackground(t.fg(t.shortcut).Render(ansiStripped(box)+" "+label), 0, t.bgHover)
		}
		return formPart{text: text, id: id, kind: "check"}
	}
	heading := func(text string) string {
		return lipgloss.NewStyle().Bold(true).Foreground(t.title).Render(text)
	}

	// --- 저장소 관리 (WorkspaceList.svelte) ---
	form.add(heading("저장소 관리"))
	for _, line := range wrapText("저장소를 바꿀 때 표시되는 순서를 정하거나, 더 이상 쓰지 않는 저장소의 연결을 해제할 수 있습니다.", width) {
		form.add(t.fg(t.faint).Render(line))
	}
	form.add("")
	cardInner := width - 4
	draft := &s.draft
	expanded := m.expandedWorkspace()
	for index, workspace := range draft.workspaces {
		key := strconv.Itoa(index)
		current := workspace.ID == draft.active
		borderColor := t.border
		if current {
			borderColor = t.accent
		}
		border := t.fg(borderColor)
		open := workspace.ID == expanded
		form.add(border.Render("╭" + strings.Repeat("─", width-2) + "╮"))
		row := func(parts ...formPart) {
			content := append([]formPart{plain(border.Render("│ "))}, parts...)
			used := 0
			for _, part := range content {
				used += lipgloss.Width(part.text)
			}
			content = append(content, plain(strings.Repeat(" ", max(0, width-1-used))+border.Render("│")))
			form.addRow(content...)
		}

		chevron := "›"
		if open {
			chevron = "⌄"
		}
		label := chevron + " " + truncate(workspace.Label(), cardInner/2)
		name := lipgloss.NewStyle().Foreground(t.title).Render(label)
		if focused("ws-head:" + key) {
			name = fillBackground(lipgloss.NewStyle().Foreground(t.shortcut).Render(label), 0, t.bgHover)
		}
		var right []formPart
		if current {
			right = append(right, plain(fillBackground(lipgloss.NewStyle().Foreground(hex("#5eead4")).Render(" 현재 사용 중 "), 0, hex("#042f2e"))), plain(" "))
		}
		movable := workspace.Origin == config.OriginTUI
		right = append(right,
			button("ws-up:"+key, "↑", false, !movable || index == 0 || draft.workspaces[index-1].Origin != config.OriginTUI), plain(" "),
			button("ws-down:"+key, "↓", false, !movable || index == len(draft.workspaces)-1), plain(" "),
			button("ws-more:"+key, "⋯", false, false))
		used := lipgloss.Width(name)
		for _, part := range right {
			used += lipgloss.Width(part.text)
		}
		row(append([]formPart{{text: name, id: "ws-head:" + key, kind: "header"}, plain(strings.Repeat(" ", max(1, cardInner-used)))}, right...)...)

		if open {
			row(plain(t.fg(t.border).Render(strings.Repeat("─", cardInner))))
			activeNow, _ := m.activeWorkspace()
			if workspace.ID != activeNow.ID {
				// 웹처럼 태그는 지금 쓰는 저장소에서만 관리한다. 전환도 확인을 눌러야 적용된다.
				if current {
					row(plain(t.fg(t.faint).Render("확인을 누르면 이 저장소로 전환합니다. 태그는 전환한 뒤 관리할 수 있습니다.")))
				} else {
					row(plain(t.fg(t.faint).Render("태그를 관리하려면 이 저장소로 먼저 전환하세요.")), plain("  "), button("ws-switch:"+key, "전환", false, false))
				}
			} else {
				row(plain(lipgloss.NewStyle().Bold(true).Foreground(t.secondary).Render("태그 관리")))
				add := button("tag-add", "+ 추가", false, false)
				row(field("tag-new", "text", "", "태그명: 분류 설명", cardInner-lipgloss.Width(add.text)-2), plain(" "), add)
				row(plain(t.fg(t.border).Render(strings.Repeat("─", cardInner))))
				labels := m.draftLabels()
				if len(labels) == 0 {
					row(plain(t.fg(t.faint).Render("이 저장소에는 태그가 없습니다.")))
				}
				for _, label := range labels {
					dot := lipgloss.NewStyle().Foreground(hex("#" + notes.TagColor(label.name))).Render("●")
					if label.deleted {
						undo := button("tag-del:"+label.original, "되돌리기", false, false)
						text := t.fg(t.disabled).Strikethrough(true).Render(label.name) + t.fg(t.danger).Render("  삭제 예정")
						row(plain(dot), plain(" "+fitLine(text, cardInner-lipgloss.Width(undo.text)-4)), plain(" "), undo)
						continue
					}
					remove := button("tag-del:"+label.original, "삭제", true, false)
					value := notes.FormatTagDefinition(label.name, label.description)
					row(plain(dot), field("tag-name:"+label.original, "text", value, "", cardInner-lipgloss.Width(remove.text)-3), plain(" "), remove)
					if label.pending != "" {
						row(plain("  " + t.fg(t.accentBright).Render(label.pending)))
					}
				}
			}
		}
		form.add(border.Render("╰" + strings.Repeat("─", width-2) + "╯"))
	}
	addWorkspace := t.fg(t.link).Underline(true).Render("+ 다른 저장소 추가")
	if focused("ws-add") {
		addWorkspace = fillBackground(t.fg(t.shortcut).Underline(true).Render("+ 다른 저장소 추가"), 0, t.bgHover)
	}
	form.addRow(plain("  "), formPart{text: addWorkspace, id: "ws-add", kind: "button"})
	for index, workspace := range draft.removed {
		undo := button("ws-undo:"+strconv.Itoa(index), "되돌리기", false, false)
		form.addRow(plain("  "+t.fg(t.danger).Render("연결 해제 예정: "+workspace.Repo)+"  "), undo)
	}
	form.add("")

	// --- 편집기 설정 (DisplaySettings.svelte) ---
	prefs := draft.prefs
	border := t.fg(t.border)
	inner := width - 4
	legend := " 편집기 설정 "
	form.add(border.Render("╭─") + lipgloss.NewStyle().Bold(true).Foreground(t.title).Render(legend) + border.Render(strings.Repeat("─", max(0, width-3-lipgloss.Width(legend)))+"╮"))
	boxRow := func(parts ...formPart) {
		content := append([]formPart{plain(border.Render("│ "))}, parts...)
		used := 0
		for _, part := range content {
			used += lipgloss.Width(part.text)
		}
		content = append(content, plain(strings.Repeat(" ", max(0, width-1-used))+border.Render("│")))
		form.addRow(content...)
	}
	labelRow := func(text string) { boxRow(plain(t.fg(t.secondary).Render(text))) }
	note := func(text string) {
		for _, line := range wrapText("※ "+text, inner) {
			boxRow(plain(t.fg(t.faint).Render(line)))
		}
	}
	boxRow()
	labelRow("화면 모드")
	boxRow(field("theme", "select", themeLabels[prefs.Theme], "", inner-1))
	boxRow()
	labelRow("제목 방식")
	boxRow(field("title-mode", "select", titleModeLabels[prefs.TitleMode], "", inner-1))
	boxRow()
	labelRow("노트 목록에 표시할 항목")
	boxRow(check("row-title", "제목", prefs.ListRow.Title), plain("  "), check("row-summary", "요약", prefs.ListRow.Summary), plain("  "),
		check("row-meta", "시간 정보", prefs.ListRow.Meta), plain("  "), check("row-tags", "태그", prefs.ListRow.Tags))
	boxRow()
	half := (inner - 2) / 2
	boxRow(plain(fitLine(t.fg(t.secondary).Render("자동 저장 지연"), half+3)), plain(t.fg(t.secondary).Render("한 번에 불러올 노트 수")))
	boxRow(field("autosave", "text", strconv.Itoa(prefs.AutoSaveSeconds), "", half-3), plain(t.fg(t.muted).Render(" 초 ")),
		field("page-size", "text", strconv.Itoa(prefs.NotesPerPage), "", half-1))
	boxRow()
	labelRow("잠금 숫자 기억 시간 (TUI를 끄면 지워짐)")
	boxRow(field("lock-minutes", "select", lockMinutesLabel(prefs.LockSessionMinutes), "", inner-1))
	note("입력한 잠금 숫자를 다시 묻지 않고 사용할 시간입니다. 시간이 지나면 잠긴 노트를 열 때 다시 입력해야 합니다.")
	boxRow()
	labelRow("잠금 pepper (자체 배포 서버를 쓸 때)")
	boxRow(field("lock-pepper", "text", prefs.LockPepper, "비워 두면 공식 배포 값", inner-1))
	note("직접 배포한 웹에서 잠근 노트를 열려면 그 서버의 VITE_NOTE_LOCK_PEPPER와 같은 값을 넣으세요. 공개되는 값이라 설정 파일에 그대로 저장합니다. 열 때는 공식 값으로도 한 번 더 시도합니다.")
	if ime.Available() {
		boxRow()
		boxRow(check("input-source", "단축키를 쓸 때 영문 자판으로 바꾸기 (터미널 앱 전용)", !prefs.KeepInputSource))
		note("한글 입력기가 켜져 있으면 키가 조합되느라 단축키가 바로 듣지 않습니다. 목록·메뉴에서는 영문 자판으로 바꾸고, 본문·검색 같은 입력칸에 들어가면 쓰던 입력 소스로 되돌립니다.")
	}
	boxRow()
	form.add(border.Render("╰" + strings.Repeat("─", width-2) + "╯"))

	// --- 음성 녹음 (VoiceSettings.svelte) ---
	vd := draft.voice
	legend = " 음성 녹음 "
	form.add("")
	form.add(border.Render("╭─") + lipgloss.NewStyle().Bold(true).Foreground(t.title).Render(legend) + border.Render(strings.Repeat("─", max(0, width-3-lipgloss.Width(legend)))+"╮"))
	boxRow()
	labelRow("OpenAI API 키")
	keyValue := vd.apiKey
	if !focused("voice-key") {
		keyValue = voice.MaskAPIKey(keyValue)
	}
	if !m.voiceKeyLoaded {
		keyValue = ""
	}
	boxRow(field("voice-key", "text", keyValue, "sk-...", inner-1))
	note("녹음과 전사문은 OpenAI로 직접 전송됩니다. 키는 이 기기의 OS 자격 증명 저장소에 보관됩니다. 전용 프로젝트 키·사용 한도·정기 교체를 권장합니다.")
	boxRow()
	boxRow(plain(fitLine(t.fg(t.secondary).Render("음성 전사 모델"), half+3)), plain(t.fg(t.secondary).Render("텍스트 정제 모델")))
	refinement := vd.refinementModel
	if refinement == "" {
		refinement = "없음"
	}
	boxRow(field("voice-transcription", "select", vd.transcriptionModel, "", half+1), plain(" "),
		field("voice-refinement", "select", refinement, "", half))
	refreshLabel := "↻ 모델 목록 새로고침"
	if m.voiceModelsBusy {
		refreshLabel = "모델 목록을 가져오는 중…"
	}
	boxRow(button("voice-refresh", refreshLabel, false, strings.TrimSpace(vd.apiKey) == "" || m.voiceModelsBusy))
	if m.voiceModelsErr != "" {
		for _, line := range wrapText(m.voiceModelsErr, inner) {
			boxRow(plain(t.fg(t.danger).Render(line)))
		}
	}
	boxRow()
	boxRow(check("voice-preserve", "원본 음성 보존", vd.preserve))
	note("녹음이 성공하면 해당 노트의 첨부파일로 원본 음성을 저장합니다.")
	if strings.TrimSpace(vd.refinementModel) != "" {
		boxRow()
		presets := []formPart{plain(fitLine(t.fg(t.secondary).Render("정제 규칙"), inner-22))}
		for index, preset := range voice.RefinementPresets {
			if index > 0 {
				presets = append(presets, plain(t.fg(t.faint).Render(" | ")))
			}
			presets = append(presets, button("voice-preset:"+strconv.Itoa(index), preset.Label, false, false))
		}
		boxRow(presets...)
		promptLines := wrapText(vd.prompt, inner-2)
		if len(promptLines) > 6 {
			promptLines = append(promptLines[:5], "…")
		}
		for _, line := range promptLines {
			boxRow(plain(fillBackground(" "+t.fg(t.muted).Render(line), inner-1, t.bgInput)))
		}
		boxRow(button("voice-prompt", "정제 규칙 편집", false, false))
	}
	boxRow()
	labelRow("자주 쓰는 전사 단어")
	boxRow(field("voice-hints", "text", vd.hints, "Ginote, Svelte, OpenAI, 프로젝트명", inner-1))
	switch {
	case m.voiceHintsLoading:
		boxRow(plain(t.fg(t.faint).Render("저장소에서 불러오는 중…")))
	case m.voiceHintsErr != "":
		boxRow(plain(t.fg(t.danger).Render(m.voiceHintsErr)))
	}
	note("이 저장소에 저장되어 다른 기기와 함께 씁니다.")
	boxRow()
	form.add(border.Render("╰" + strings.Repeat("─", width-2) + "╯"))
	form.add("")
	form.add(t.fg(t.faint).Render(truncate("설정 파일: "+m.tuiConfigPath, width)))
	return form
}

func ansiStripped(text string) string { return stripStyles(text) }

func (m Model) settingsGeometry() (x, y, width, height int) {
	width = min(72, m.width-4)
	height = m.height - 2
	return (m.width - width) / 2, 1, width, height
}

// settingsInner는 시트 안쪽 너비다(테두리 2 + 좌우 여백 2).
func (m Model) settingsInner() int {
	_, _, width, _ := m.settingsGeometry()
	return width - 4
}

func (m Model) renderSettings() (string, int, int, *cursorPos) {
	t := m.th
	x, y, width, height := m.settingsGeometry()
	inner := width - 4
	s := m.settings
	if s.focus == "" {
		if form := m.buildSettings(inner); len(form.controls) > 0 {
			s.focus = form.controls[0].id
		}
	}
	form := m.buildSettings(inner)
	// 테두리 두 줄, 제목 두 줄, 아래 버튼 줄 세 줄(구분선·버튼·빈 줄)을 뺀 높이가 스크롤 영역이다.
	bodyHeight := height - 2 - 2 - 3
	// 포커스가 옮겨졌을 때만 그 항목이 보이게 스크롤한다. 휠로 내린 화면은 그대로 둔다.
	followFocus := s.focus != s.shownFocus
	s.shownFocus = s.focus
	for _, control := range form.controls {
		if followFocus && control.id == s.focus && s.bar.focus < 0 {
			if control.line < s.scroll {
				s.scroll = control.line
			} else if control.line >= s.scroll+bodyHeight {
				s.scroll = control.line - bodyHeight + 1
			}
		}
	}
	s.scroll = max(0, min(s.scroll, len(form.lines)-bodyHeight))

	closeButton := t.button("✕", false)
	title := lipgloss.PlaceHorizontal(inner-lipgloss.Width(closeButton)*2, lipgloss.Center, lipgloss.NewStyle().Bold(true).Foreground(t.title).Render("환경설정"))
	out := []string{closeButton + title, t.fg(t.border).Render(strings.Repeat("─", inner))}
	m.hits.add("settings-sheet", x, y, width, height)
	m.hits.add("settings-close", x+2, y+1, lipgloss.Width(closeButton), 1)
	for row := 0; row < bodyHeight; row++ {
		index := s.scroll + row
		if index < len(form.lines) {
			out = append(out, form.lines[index])
		} else {
			out = append(out, "")
		}
	}
	var cursor *cursorPos
	for _, control := range form.controls {
		row := control.line - s.scroll
		if row < 0 || row >= bodyHeight {
			continue
		}
		screenX, screenY := x+2+control.x, y+3+row
		m.hits.add("set:"+control.id, screenX, screenY, control.width, 1)
		if control.id == s.focus && control.kind == "text" && s.bar.focus < 0 && m.choice == nil {
			if input, ok := s.inputs[control.id]; ok {
				if c := input.Cursor(); c != nil {
					cursor = &cursorPos{x: screenX + 2 + c.X, y: screenY}
				}
			}
		}
	}
	// 버튼 줄(확인·취소)은 스크롤하지 않고 맨 아래에 고정한다.
	hint := "Tab 버튼 · Esc 닫기"
	if s.dirty(m) {
		hint = "● 바꾼 내용이 있습니다 · 확인을 눌러야 저장됩니다"
	}
	row, zones := m.actionRow(inner, s.actions(), s.bar, hint)
	out = append(out, t.fg(t.divider).Render(strings.Repeat("─", inner)))
	for _, zone := range zones {
		m.hits.add(zone.id, x+2+zone.x, y+1+len(out), zone.width, 1)
	}
	out = append(out, row, "")
	return panel(out, inner, t.bgPanel, t.border, 1), x, y, cursor
}

func (m Model) settingsControl(id string) (settingsControl, int, []settingsControl) {
	controls := m.buildSettings(m.settingsInner()).controls
	for index, control := range controls {
		if control.id == id {
			return control, index, controls
		}
	}
	return settingsControl{}, -1, controls
}

// settingsTyping은 설정 시트의 글자 칸에서 입력 중인지다(입력 소스 전환과 재시작 미루기에 쓴다).
func (m Model) settingsTyping() bool {
	if m.settings == nil || m.choice != nil || m.settings.bar.focus >= 0 {
		return false
	}
	control, _, _ := m.settingsControl(m.settings.focus)
	return control.kind == "text"
}

func (m Model) handleSettingsKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	s := m.settings
	if s.focus == "" {
		if _, _, controls := m.settingsControl(""); len(controls) > 0 {
			s.focus = controls[0].id
		}
	}
	control, index, controls := m.settingsControl(s.focus)
	key := msg.String()
	if control.kind != "text" || s.bar.focus >= 0 {
		key = keyName(msg)
	}
	if key == "tab" || key == "shift+tab" {
		// 버튼 줄로 가기 전에 고치던 글자 칸을 초안에 반영한다.
		m.commitSettingsInput(s.focus)
	}
	if pressed, handled := s.bar.barKey(s.actions(), key); handled {
		switch pressed {
		case "apply":
			return m.applySettings()
		case "cancel":
			return m.requestCloseSettings()
		}
		return m, nil
	}
	move := func(delta int) (tea.Model, tea.Cmd) {
		m.commitSettingsInput(s.focus)
		if len(controls) > 0 {
			position := min(len(controls)-1, max(0, max(0, index)+delta))
			s.focus = controls[position].id
		}
		return m, nil
	}
	switch key {
	case "esc":
		m.commitSettingsInput(s.focus)
		return m.requestCloseSettings()
	case "up":
		return move(-1)
	case "down":
		return move(1)
	}
	if control.kind == "text" {
		if key == "enter" {
			m.commitSettingsInput(s.focus)
			if control.id == "tag-new" {
				return m, nil
			}
			return move(1)
		}
		input := s.input(control.id, "", "")
		updated, cmd := input.Update(msg)
		*input = updated
		return m, cmd
	}
	switch key {
	case "k":
		return move(-1)
	case "j":
		return move(1)
	case ",", "q":
		return m.requestCloseSettings()
	case "left", "h", "right", "l":
		if control.kind == "select" {
			step := 1
			if key == "left" || key == "h" {
				step = -1
			}
			m.changeDraftPreference(control.id, step)
		}
		return m, nil
	case "enter", "space":
		return m.activateSettings(control)
	}
	return m, nil
}

// requestCloseSettings는 취소·Esc다. 바꾼 내용이 있으면 버릴지 묻는다.
func (m Model) requestCloseSettings() (tea.Model, tea.Cmd) {
	if m.settings.dirty(m) {
		m.prompt = newConfirmPrompt("confirm:discard-settings", "변경 내용 버리기", "환경설정에서 바꾼 내용을 저장하지 않고 닫을까요?", "")
		return m, nil
	}
	m.settings = nil
	return m, nil
}

// settingsPaste는 설정 시트의 글자 칸에 붙여넣는다.
func (m Model) settingsPaste(msg tea.PasteMsg) (tea.Model, tea.Cmd) {
	control, _, _ := m.settingsControl(m.settings.focus)
	if control.kind != "text" {
		return m, nil
	}
	input := m.settings.input(control.id, "", "")
	updated, cmd := input.Update(msg)
	*input = updated
	return m, cmd
}

// activateSettings는 항목을 누른 것이다(Enter·Space·마우스). 바꾸는 것은 초안에만 반영한다.
func (m Model) activateSettings(control settingsControl) (tea.Model, tea.Cmd) {
	s := m.settings
	d := &s.draft
	id := control.id
	index := -1
	if colon := strings.LastIndex(id, ":"); colon >= 0 {
		index, _ = strconv.Atoi(id[colon+1:])
	}
	switch {
	case strings.HasPrefix(id, "ws-head:"):
		workspace := d.workspaces[index]
		if m.expandedWorkspace() == workspace.ID {
			s.expanded = ""
		} else {
			s.expanded = workspace.ID
		}
	case strings.HasPrefix(id, "ws-up:"), strings.HasPrefix(id, "ws-down:"):
		direction := 1
		if strings.HasPrefix(id, "ws-up:") {
			direction = -1
		}
		target := index + direction
		if target >= 0 && target < len(d.workspaces) && d.workspaces[index].Origin == config.OriginTUI && d.workspaces[target].Origin == config.OriginTUI {
			d.workspaces[index], d.workspaces[target] = d.workspaces[target], d.workspaces[index]
			s.focus = strings.Replace(id, ":"+itoa(index), ":"+itoa(target), 1)
		}
	case strings.HasPrefix(id, "ws-switch:"):
		d.active = d.workspaces[index].ID
		s.expanded = d.active
	case strings.HasPrefix(id, "ws-undo:"):
		if index >= 0 && index < len(d.removed) {
			d.workspaces = append(d.workspaces, d.removed[index])
			d.removed = append(d.removed[:index:index], d.removed[index+1:]...)
		}
	case strings.HasPrefix(id, "ws-more:"):
		workspace := d.workspaces[index]
		key := strconv.Itoa(index)
		var items []menuItem
		if workspace.ID != d.active {
			items = append(items, menuItem{id: "switch:" + key, label: "전환"})
		}
		if workspace.Origin == config.OriginTUI {
			items = append(items, menuItem{id: "rename:" + key, label: "표시 이름 변경"}, menuItem{id: "leave:" + key, label: "연결 해제", danger: true})
		} else {
			items = append(items, menuItem{id: "none", label: "데스크톱 앱 저장소는 앱에서 관리합니다", disabled: true})
		}
		m.choice = newChoice("settings-ws", workspace.Label(), items, 0)
	case id == "ws-add":
		// 웹처럼 환경설정 위에 저장소 추가 창을 겹쳐 띄운다. 그 창의 연결 버튼이 확인이다.
		return m.openSetup()
	case id == "tag-add":
		m.commitSettingsInput("tag-new")
	case strings.HasPrefix(id, "tag-del:"):
		name := strings.TrimPrefix(id, "tag-del:")
		for position, op := range d.tagOps {
			if op.kind == "delete" && op.name == name {
				d.tagOps = append(d.tagOps[:position:position], d.tagOps[position+1:]...)
				return m, nil
			}
			if op.kind == "create" && op.name == name {
				// 아직 만들지 않은 새 태그는 지우면 그냥 없앤다.
				d.tagOps = append(d.tagOps[:position:position], d.tagOps[position+1:]...)
				return m, nil
			}
		}
		d.tagOps = append(d.tagOps, tagOp{kind: "delete", name: name})
	case control.kind == "select":
		var items []menuItem
		selected := 0
		add := func(item menuItem, current bool) {
			if current {
				item.icon = "✓"
				selected = len(items)
			}
			items = append(items, item)
		}
		title := ""
		switch id {
		case "theme":
			title = "화면 모드"
			for _, option := range themeOptions {
				add(menuItem{id: option, label: themeLabels[option]}, d.prefs.Theme == option)
			}
		case "title-mode":
			title = "제목 방식"
			for _, option := range titleModes {
				add(menuItem{id: option, label: titleModeLabels[option]}, d.prefs.TitleMode == option)
			}
		case "lock-minutes":
			title = "잠금 숫자 기억 시간"
			for _, option := range config.LockSessionOptions {
				add(menuItem{id: strconv.Itoa(option), label: lockMinutesLabel(option)}, d.prefs.LockSessionMinutes == option)
			}
		default:
			title, items, selected = m.voiceSelectItems(id)
		}
		m.choice = newChoice("settings:"+id, title, items, selected)
	case control.kind == "check":
		m.changeDraftPreference(id, 1)
	default:
		return m.activateVoiceSetting(id)
	}
	return m, nil
}

// runSettingsChoice는 환경설정에서 띄운 선택 창의 결과다(초안에만 반영).
func (m Model) runSettingsChoice(kind, id string) (tea.Model, tea.Cmd) {
	s := m.settings
	if s == nil {
		return m, nil
	}
	d := &s.draft
	if strings.HasPrefix(kind, "settings:") {
		switch field := strings.TrimPrefix(kind, "settings:"); field {
		case "theme":
			d.prefs.Theme = id
		case "title-mode":
			d.prefs.TitleMode = id
		case "lock-minutes":
			d.prefs.LockSessionMinutes, _ = strconv.Atoi(id)
		default:
			m.chooseVoiceSetting(field, id)
		}
		return m, nil
	}
	action, key, _ := strings.Cut(id, ":")
	index, err := strconv.Atoi(key)
	if err != nil || index < 0 || index >= len(d.workspaces) {
		return m, nil
	}
	workspace := d.workspaces[index]
	switch action {
	case "switch":
		d.active = workspace.ID
		s.expanded = workspace.ID
	case "rename":
		m.prompt = newTextPrompt("settings-rename-workspace", "표시 이름 변경", workspace.Repo+"의 표시 이름입니다. 비우면 저장소 주소가 보입니다. 환경설정에서 확인을 눌러야 저장됩니다.", workspace.Name)
		m.prompt.target = workspace.ID
	case "leave":
		d.removed = append(d.removed, workspace)
		d.workspaces = append(d.workspaces[:index:index], d.workspaces[index+1:]...)
		if d.active == workspace.ID {
			d.active = ""
			if len(d.workspaces) > 0 {
				d.active = d.workspaces[0].ID
			}
		}
		s.focus = ""
	}
	return m, nil
}

// renameDraftWorkspace는 표시 이름 변경 창의 결과다.
func (m Model) renameDraftWorkspace(id, name string) {
	if m.settings == nil {
		return
	}
	for index := range m.settings.draft.workspaces {
		if m.settings.draft.workspaces[index].ID == id {
			m.settings.draft.workspaces[index].Name = strings.TrimSpace(name)
		}
	}
}

// commitSettingsInput은 글자 칸의 값을 초안에 반영한다. 새 태그·태그 이름·숫자·음성 설정.
func (m Model) commitSettingsInput(id string) {
	s := m.settings
	input, ok := s.inputs[id]
	if !ok {
		return
	}
	value := strings.TrimSpace(input.Value())
	delete(s.inputs, id)
	d := &s.draft
	switch {
	case id == "tag-new":
		definition := notes.ParseTagDefinition(value, "")
		name := notes.NormalizeTagName(definition.Name)
		if name == "" || notes.IsPinLabel(name) {
			return
		}
		for _, label := range m.draftLabels() {
			if strings.EqualFold(label.name, name) {
				return
			}
		}
		limited := notes.LimitTagInput(notes.TagInput{Name: name, Description: definition.Description})
		d.tagOps = append(d.tagOps, tagOp{kind: "create", name: limited.Name, description: limited.Description})
	case strings.HasPrefix(id, "tag-name:"):
		original := strings.TrimPrefix(id, "tag-name:")
		var current draftLabel
		for _, label := range m.draftLabels() {
			if label.original == original {
				current = label
			}
		}
		if value == notes.FormatTagDefinition(current.name, current.description) {
			return
		}
		definition := notes.ParseTagDefinition(value, current.name)
		limited := notes.LimitTagInput(notes.TagInput{Name: notes.NormalizeTagName(definition.Name), Description: definition.Description})
		if limited.Name == "" || notes.IsPinLabel(limited.Name) {
			return
		}
		for position, op := range d.tagOps {
			if (op.kind == "create" || op.kind == "rename") && op.name == original {
				if op.kind == "create" {
					d.tagOps[position].name = limited.Name
				}
				d.tagOps[position].newName, d.tagOps[position].description = limited.Name, limited.Description
				return
			}
		}
		d.tagOps = append(d.tagOps, tagOp{kind: "rename", name: original, newName: limited.Name, description: limited.Description})
	case id == "lock-pepper":
		d.prefs.LockPepper = value
	case id == "autosave" || id == "page-size":
		number, err := strconv.Atoi(value)
		if err != nil {
			return
		}
		if id == "autosave" {
			d.prefs.AutoSaveSeconds = min(30, max(3, number))
		} else {
			d.prefs.NotesPerPage = min(100, max(10, number))
		}
	default:
		m.commitVoiceInput(id, value)
	}
}

// changeDraftPreference는 선택 상자를 ←/→로 바꾸거나 체크를 누른 것이다.
func (m Model) changeDraftPreference(id string, step int) {
	d := &m.settings.draft
	switch id {
	case "theme":
		d.prefs.Theme = cycleString(themeOptions, d.prefs.Theme, step)
	case "title-mode":
		d.prefs.TitleMode = cycleString(titleModes, d.prefs.TitleMode, step)
	case "row-title":
		d.prefs.ListRow.Title = !d.prefs.ListRow.Title
	case "row-summary":
		d.prefs.ListRow.Summary = !d.prefs.ListRow.Summary
	case "row-meta":
		d.prefs.ListRow.Meta = !d.prefs.ListRow.Meta
	case "row-tags":
		d.prefs.ListRow.Tags = !d.prefs.ListRow.Tags
	case "lock-minutes":
		d.prefs.LockSessionMinutes = cycleInt(config.LockSessionOptions, d.prefs.LockSessionMinutes, step)
	case "input-source":
		d.prefs.KeepInputSource = !d.prefs.KeepInputSource
	default:
		m.toggleVoiceSetting(id)
	}
}

// applySettings는 확인이다. 초안을 한꺼번에 적용하고 시트를 닫는다.
func (m Model) applySettings() (tea.Model, tea.Cmd) {
	m.commitSettingsInput(m.settings.focus)
	d := m.settings.draft
	m.settings = nil
	var cmds []tea.Cmd

	// 저장소: 순서·이름은 TUI 설정 파일에, 연결 해제한 저장소의 토큰은 지운다.
	for _, workspace := range d.removed {
		workspace := workspace
		cmds = append(cmds, func() tea.Msg { auth.Forget(workspace); return nil })
	}
	previous, _ := m.activeWorkspace()
	m.workspaces = d.workspaces
	m.active = m.workspaceIndex(previous.ID, -1)

	// 태그: 지금 저장소에 차례로 보낸다(같은 이름을 만들고 바꾸는 순서가 섞이지 않게).
	var tagCmds []tea.Cmd
	for _, op := range d.tagOps {
		switch op.kind {
		case "create":
			tagCmds = append(tagCmds, m.createLabelCmd(op.name, op.description))
		case "rename":
			tagCmds = append(tagCmds, m.renameLabelCmd(op.name, op.newName, op.description))
		case "delete":
			tagCmds = append(tagCmds, m.deleteLabelCmd(op.name))
		}
	}
	if len(tagCmds) > 0 {
		cmds = append(cmds, tea.Sequence(tagCmds...))
	}

	// 환경설정·음성 설정.
	pageSizeBefore := m.prefs.NotesPerPage
	m.prefs = d.prefs.Normalize()
	m.prefsCustom = true
	notes.UsePepper(m.prefs.LockPepper)
	m.th = newTheme(m.dark())
	cmds = append(cmds, m.applyVoiceDraft(d.voice))
	m.persist()
	m.layoutNote()

	switch target := m.workspaceIndex(d.active, -1); {
	case len(m.workspaces) == 0:
		m.active = -1
		m.issues, m.pinned, m.note = nil, nil, nil
		m.persist()
		next, cmd := m.openSetup()
		return next, tea.Batch(append(cmds, cmd)...)
	case target >= 0 && target != m.active:
		if m.active < 0 {
			m.active = -1
		}
		next, cmd := m.switchWorkspace(target)
		return next, tea.Batch(append(cmds, cmd)...)
	case m.active < 0:
		next, cmd := m.switchWorkspace(0)
		return next, tea.Batch(append(cmds, cmd)...)
	}
	if m.prefs.NotesPerPage != pageSizeBefore {
		next, cmd := m.reload()
		return next, tea.Batch(append(cmds, cmd)...)
	}
	next, toast := m.showToast("환경설정을 저장했습니다.")
	return next, tea.Batch(append(cmds, toast)...)
}

func cycleInt(options []int, current, step int) int {
	for index, option := range options {
		if option == current {
			return options[(index+step+len(options))%len(options)]
		}
	}
	return options[0]
}

func cycleString(options []string, current string, step int) string {
	for index, option := range options {
		if option == current {
			return options[(index+step+len(options))%len(options)]
		}
	}
	return options[0]
}

func itoa(value int) string { return strconv.Itoa(value) }
