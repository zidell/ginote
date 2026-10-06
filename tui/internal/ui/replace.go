package ui

import (
	"fmt"
	"regexp"
	"strings"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/zidell/ginote/tui/internal/notes"
)

// replaceState는 치환 창이다(NoteEditor.svelte의 replace-panel, X 키).
type replaceState struct {
	inputs [2]textinput.Model
	field  int
	bar    actionBar
}

func newReplaceState() *replaceState {
	state := &replaceState{bar: newActionBar()}
	for index := range state.inputs {
		input := textinput.New()
		input.Prompt = ""
		state.inputs[index] = input
	}
	state.inputs[0].Focus()
	return state
}

type replaceAnalysis struct {
	count   int
	err     string
	regex   *regexp.Regexp
	isRegex bool
	match   string
	result  string
}

var regexLiteral = regexp.MustCompile(`^/([\s\S]*)/([a-z]*)$`)

// analyzeReplacement는 웹의 같은 이름 함수다. "/패턴/플래그"면 정규식, 아니면 일반 문자열이다.
// Go 정규식(RE2)은 뒤보기(lookbehind) 같은 일부 JS 문법을 모르므로 그때는 오류로 보인다.
func analyzeReplacement(text, pattern, replacement string) replaceAnalysis {
	if pattern == "" {
		return replaceAnalysis{}
	}
	source, isRegex := regexp.QuoteMeta(pattern), false
	prefix := ""
	if match := regexLiteral.FindStringSubmatch(pattern); match != nil {
		source, isRegex = match[1], true
		for _, flag := range match[2] {
			switch flag {
			case 'i', 'm', 's':
				prefix += string(flag)
			}
		}
		if source == "" {
			return replaceAnalysis{err: "정규식이 올바르지 않습니다."}
		}
	}
	if prefix != "" {
		source = "(?" + prefix + ")" + source
	}
	regex, err := regexp.Compile(source)
	if err != nil {
		return replaceAnalysis{err: "정규식이 올바르지 않습니다."}
	}
	analysis := replaceAnalysis{regex: regex, isRegex: isRegex, match: pattern, result: replacement}
	for _, segment := range strings.Split(text, notes.AttachmentLinkPlaceholder) {
		analysis.count += len(regex.FindAllStringIndex(segment, -1))
	}
	if analysis.count > 0 {
		for _, segment := range strings.Split(text, notes.AttachmentLinkPlaceholder) {
			location := regex.FindStringSubmatchIndex(segment)
			if location == nil {
				continue
			}
			analysis.match = segment[location[0]:location[1]]
			if isRegex {
				analysis.result = string(regex.ExpandString(nil, jsReplacement(replacement), segment, location))
			}
			break
		}
	}
	return analysis
}

// jsReplacement는 JS 치환문($1, $&, $$)을 Go 형식(${1}, ${0}, $)으로 바꾼다.
func jsReplacement(value string) string {
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		if value[index] != '$' || index+1 >= len(value) {
			builder.WriteByte(value[index])
			continue
		}
		next := value[index+1]
		switch {
		case next == '$':
			builder.WriteString("$$")
			index++
		case next == '&':
			builder.WriteString("${0}")
			index++
		case next >= '0' && next <= '9':
			end := index + 2
			if end < len(value) && value[end] >= '0' && value[end] <= '9' {
				end++
			}
			builder.WriteString("${" + value[index+1:end] + "}")
			index = end - 1
		default:
			builder.WriteString("$$")
		}
	}
	return builder.String()
}

// replaceOutsidePlaceholders는 {repo}/ 첨부 주소는 건드리지 않고 바꾼다.
func replaceOutsidePlaceholders(text string, analysis replaceAnalysis, replacement string) string {
	segments := strings.Split(text, notes.AttachmentLinkPlaceholder)
	for index, segment := range segments {
		if analysis.isRegex {
			segments[index] = analysis.regex.ReplaceAllString(segment, jsReplacement(replacement))
		} else {
			segments[index] = analysis.regex.ReplaceAllLiteralString(segment, replacement)
		}
	}
	return strings.Join(segments, notes.AttachmentLinkPlaceholder)
}

func (r *replaceState) actions(m Model) []modalAction {
	analysis := analyzeReplacement(m.note.body.Value(), r.inputs[0].Value(), r.inputs[1].Value())
	return []modalAction{{id: "apply", label: "치환", primary: true, disabled: analysis.count == 0}, {id: "cancel", label: "취소"}}
}

func (r *replaceState) focusField(field int) {
	r.inputs[r.field].Blur()
	r.field = field
	r.inputs[field].Focus()
}

func (m Model) handleReplaceKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	r := m.replace
	key := msg.String()
	if r.bar.focus >= 0 {
		key = keyName(msg)
	}
	if pressed, handled := r.bar.barKey(r.actions(m), key); handled {
		switch pressed {
		case "apply":
			return m.applyReplacement()
		case "cancel":
			m.replace = nil
			return m.afterTyping()
		}
		return m, nil
	}
	switch key {
	case "esc":
		m.replace = nil
		return m.afterTyping()
	case "down", "up":
		r.focusField(1 - r.field)
		return m, nil
	case "enter":
		if r.field == 0 {
			r.focusField(1)
			return m, nil
		}
		return m.applyReplacement()
	}
	var cmd tea.Cmd
	r.inputs[r.field], cmd = r.inputs[r.field].Update(msg)
	return m, cmd
}

func (m Model) applyReplacement() (tea.Model, tea.Cmd) {
	n := m.note
	if n == nil {
		return m, nil
	}
	analysis := analyzeReplacement(n.body.Value(), m.replace.inputs[0].Value(), m.replace.inputs[1].Value())
	if analysis.err != "" || analysis.regex == nil || analysis.count == 0 {
		return m, nil
	}
	next := replaceOutsidePlaceholders(n.body.Value(), analysis, m.replace.inputs[1].Value())
	m.replace = nil
	if next != n.body.Value() {
		n.body.SetValue(next)
		n.changed()
		m.layoutNote()
		return m, m.scheduleAutosave()
	}
	return m, nil
}

func (m Model) renderReplace() modalBox {
	t := m.th
	r := m.replace
	width := m.modalWidth(60)
	var content modalContent
	for _, line := range wrapText("기본값은 일반 문자열 검색·치환입니다. 정규식을 사용하려면 /패턴/플래그 형식(예: /foo-(\\d+)/gi)으로 입력하세요. 이때 치환문의 $1, $2…는 캡처 그룹을 뜻합니다.", width) {
		content.add(t.fg(t.faint).Render(line))
	}
	content.add("")
	labels := []string{"검색할 내용", "치환할 내용"}
	var cursor *cursorPos
	for index := range r.inputs {
		r.inputs[index].SetWidth(width - 2)
		style := t.fg(t.muted)
		if index == r.field && r.bar.focus < 0 {
			style = lipgloss.NewStyle().Foreground(t.accentBright).Bold(true)
			if c := r.inputs[index].Cursor(); c != nil {
				cursor = &cursorPos{x: 1 + c.X, y: 3 + len(content.lines) + 1}
			}
		}
		content.add(style.Render(labels[index]))
		content.addRow(hit("replace-field:"+itoa(index), fillBackground(" "+r.inputs[index].View(), width, t.bgInput)))
	}
	content.add("")
	analysis := analyzeReplacement(m.note.body.Value(), r.inputs[0].Value(), r.inputs[1].Value())
	switch {
	case analysis.err != "":
		content.add(t.fg(t.danger).Render(analysis.err))
		content.add("")
	case r.inputs[0].Value() != "":
		content.add(t.fg(t.secondary).Render(fmt.Sprintf("%d개 일치", analysis.count)))
		content.add(t.fg(t.faint).Render(truncate(fmt.Sprintf("예: “%s” → “%s”", analysis.match, analysis.result), width)))
	default:
		content.add("")
		content.add("")
	}
	box := m.buildModal("치환", content, width, r.actions(m), r.bar)
	box.cursor = cursor
	return box
}
