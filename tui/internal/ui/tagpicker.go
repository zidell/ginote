package ui

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/notes"
)

// tagPicker는 태그 선택 창이다. 노트의 태그(TagPicker.svelte, T 키)와 다중 선택의 태그
// 패널(SelectionTagPanel.svelte)이 함께 쓴다. 웹은 누를 때마다 바로 바꾸지만, TUI 모달은 체크만
// 해 두었다가 확인을 눌러야 적용한다(modal.go).
type tagPicker struct {
	mode   string // "note" 또는 "selection"
	input  textinput.Model
	labels []github.Label
	counts map[string]int // selection: 고른 노트 중 그 태그가 붙은 수(키는 소문자 이름)
	total  int            // selection: 고른 노트 수
	cursor int            // -1이면 입력칸
	bar    actionBar
	busy   bool

	// note: 확인하면 노트에 붙어 있을 태그. 새로 만들 태그의 설명은 descriptions에 둔다.
	staged       []string
	descriptions map[string]string
	// selection: 태그마다 "add"(모두에 붙임)·"remove"(모두에서 뗌)
	changes map[string]string
}

type tagOption struct {
	name        string
	description string
	count       int
	isNew       bool
}

func newTagPicker(labels []github.Label, mode string) *tagPicker {
	input := textinput.New()
	input.Prompt = ""
	input.Placeholder = "태그명: 분류 설명"
	if mode == "selection" {
		input.Placeholder = "태그 검색 또는 새로 만들기"
	}
	input.CharLimit = 101
	input.SetVirtualCursor(false)
	input.Focus()
	return &tagPicker{mode: mode, input: input, labels: labels, cursor: -1, bar: newActionBar(),
		descriptions: map[string]string{}, changes: map[string]string{}}
}

// openNoteTags는 노트의 태그 선택 창을 연다.
func (m Model) openNoteTags() Model {
	picker := newTagPicker(m.visibleLabels(), "note")
	picker.staged = append([]string{}, m.note.labels...)
	m.picker = picker
	return m
}

// openSelectionTags는 고른 노트들의 태그 창을 연다.
func (m Model) openSelectionTags() Model {
	picker := newTagPicker(m.visibleLabels(), "selection")
	picker.counts = m.issueLabelCounts()
	picker.total = len(m.selected)
	m.picker = picker
	return m
}

func (p *tagPicker) has(name string) bool {
	for _, label := range p.staged {
		if strings.EqualFold(label, name) {
			return true
		}
	}
	return false
}

// options는 보일 항목이다. 노트 모드는 이름에 검색어가 든 태그 12개와 새 태그 만들기,
// 선택 모드는 tagOptions(issue-labels.js) 순서를 따른다.
func (p *tagPicker) options() []tagOption {
	search := p.input.Value()
	var options []tagOption
	if p.mode == "selection" {
		var labels []notes.Label
		for _, label := range p.labels {
			labels = append(labels, notes.Label{ID: label.ID, Name: label.Name, Color: label.Color, Description: label.Description})
		}
		for _, option := range notes.TagOptions(labels, p.counts, search, "ko") {
			options = append(options, tagOption{name: option.Name, count: option.Count})
		}
		name := notes.NormalizeTagName(search)
		exists := false
		for _, option := range options {
			exists = exists || strings.EqualFold(option.name, name)
		}
		if name != "" && !exists && !notes.IsPinLabel(name) {
			options = append(options, tagOption{name: name, isNew: true})
		}
		return options
	}
	term := strings.ToLower(strings.TrimSpace(search))
	seen := map[string]bool{}
	add := func(name, description string) {
		key := strings.ToLower(name)
		if seen[key] || notes.IsPinLabel(name) || !strings.Contains(key, term) || len(options) >= 12 {
			return
		}
		seen[key] = true
		options = append(options, tagOption{name: name, description: description})
	}
	for _, label := range p.labels {
		add(label.Name, label.Description)
	}
	for _, name := range p.staged {
		add(name, p.descriptions[name])
	}
	definition := notes.ParseTagDefinition(search, "")
	name := notes.NormalizeTagName(definition.Name)
	exists := false
	for _, label := range p.labels {
		exists = exists || strings.EqualFold(label.Name, name)
	}
	if name != "" && !exists && !p.has(name) && !notes.IsPinLabel(name) {
		options = append(options, tagOption{name: name, description: definition.Description, isNew: true})
	}
	return options
}

func (p *tagPicker) actions() []modalAction {
	return []modalAction{{id: "apply", label: "확인", primary: true, disabled: p.busy}, {id: "cancel", label: "취소"}}
}

// toggle은 항목 하나를 체크하거나 푼다(아직 적용하지 않음).
func (p *tagPicker) toggle(option tagOption) {
	if p.mode == "selection" {
		if _, ok := p.changes[option.name]; ok {
			delete(p.changes, option.name)
			return
		}
		applied := p.counts[strings.ToLower(option.name)]
		// 고른 노트 전부에 붙어 있을 때만 떼고, 일부만 붙어 있으면 나머지에 마저 붙인다.
		if applied > 0 && applied == p.total {
			p.changes[option.name] = "remove"
		} else {
			p.changes[option.name] = "add"
		}
		return
	}
	for index, label := range p.staged {
		if strings.EqualFold(label, option.name) {
			p.staged = append(p.staged[:index:index], p.staged[index+1:]...)
			return
		}
	}
	p.staged = append(p.staged, option.name)
	if option.isNew && option.description != "" {
		p.descriptions[option.name] = option.description
	}
}

func (m Model) issueLabelCounts() map[string]int {
	var labelSets [][]string
	for _, issue := range m.selectedIssues() {
		labelSets = append(labelSets, issue.LabelNames())
	}
	return notes.CountIssueLabels(labelSets)
}

func (m Model) handlePickerKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	p := m.picker
	if p.busy {
		return m, nil
	}
	options := p.options()
	if pressed, handled := p.bar.barKey(p.actions(), msg.String()); handled {
		switch pressed {
		case "apply":
			return m.applyPicker()
		case "cancel":
			m.picker = nil
		}
		return m, nil
	}
	switch msg.String() {
	case "esc":
		m.picker = nil
		return m, nil
	case "down":
		if p.cursor < len(options)-1 {
			p.cursor++
		}
		return m, nil
	case "up":
		if p.cursor >= 0 {
			p.cursor--
		}
		return m, nil
	case "space":
		if p.cursor >= 0 && p.cursor < len(options) {
			p.toggle(options[p.cursor])
			return m, nil
		}
	case "enter":
		// 목록에서 Enter는 체크를 바꾸고, 입력칸에서 Enter는 첫 항목(새 태그 포함)을 체크한다.
		// 입력칸이 비어 있으면 확인으로 본다.
		index := p.cursor
		if index < 0 {
			if strings.TrimSpace(p.input.Value()) == "" {
				return m.applyPicker()
			}
			index = 0
		}
		if index < len(options) {
			p.toggle(options[index])
			if p.cursor < 0 {
				p.input.SetValue("")
			}
		}
		return m, nil
	}
	if p.cursor >= 0 {
		return m, nil
	}
	var cmd tea.Cmd
	p.input, cmd = p.input.Update(msg)
	return m, cmd
}

// applyPicker는 체크한 대로 적용하고 창을 닫는다.
func (m Model) applyPicker() (tea.Model, tea.Cmd) {
	p := m.picker
	if p.mode == "selection" {
		return m.applySelectionTags()
	}
	m.picker = nil
	n := m.note
	if n == nil {
		return m, nil
	}
	var cmds []tea.Cmd
	for name, description := range p.descriptions {
		if p.has(name) {
			m.labels = append(m.labels, github.Label{Name: name, Description: description})
			cmds = append(cmds, m.createLabelCmd(name, description))
		}
	}
	n.labels = p.staged
	n.changed()
	m.layoutNote()
	next, save := m.saveNote(false)
	return next, tea.Sequence(append(cmds, save)...)
}

func (m Model) renderPicker() modalBox {
	t := m.th
	p := m.picker
	width := m.modalWidth(52)
	options := p.options()
	var content modalContent
	p.input.SetWidth(width - 3)
	background := t.bgInput
	if p.cursor < 0 && p.bar.focus < 0 {
		background = t.bgHover
	}
	content.addRow(hit("picker-input", fillBackground(" "+p.input.View(), width, background)))
	var cursor *cursorPos
	if p.cursor < 0 && p.bar.focus < 0 {
		if c := p.input.Cursor(); c != nil {
			cursor = &cursorPos{x: 1 + c.X, y: 3}
		}
	}
	content.add("")
	for index, option := range options {
		color := lipgloss.NewStyle().Foreground(hex("#" + notes.TagColor(option.name)))
		box := "[ ]"
		suffix := ""
		if p.mode == "note" && p.has(option.name) {
			box = t.fg(t.accentBright).Render("[✓]")
		}
		if p.mode == "selection" {
			switch p.changes[option.name] {
			case "add":
				box = t.fg(t.accentBright).Render("[+]")
			case "remove":
				box = t.fg(t.danger).Render("[−]")
			}
			if option.count > 0 {
				suffix = t.fg(t.faint).Render(fmt.Sprintf("%d/%d", option.count, p.total))
			}
		}
		label := color.Render("#" + option.name)
		if option.isNew {
			label = color.Render(fmt.Sprintf("#%s 태그 만들기", option.name))
		}
		if option.description != "" && !option.isNew {
			label += t.fg(t.faint).Render("  " + option.description)
		}
		line := fitLine(" "+box+" "+label, width-lipgloss.Width(suffix)-1) + suffix + " "
		if index == p.cursor && p.bar.focus < 0 {
			line = fillBackground(t.fg(t.shortcut).Render("▌")+line[1:], width, t.bgHover)
		}
		content.addRow(hit("pick:"+strconv.Itoa(index), line))
	}
	if len(options) == 0 {
		empty := "추가할 태그가 없습니다."
		if p.mode == "selection" {
			empty = "이 저장소에는 태그가 없습니다."
		}
		content.add(" " + t.fg(t.faint).Render(empty))
	}
	content.add("")
	content.add(t.fg(t.faint).Render("↑/↓ 이동 · Space·Enter 체크 · 확인을 눌러야 적용"))
	if p.busy {
		content.add(t.fg(t.faint).Render("⠋ 적용하는 중…"))
	}
	title := "태그"
	if p.mode == "selection" {
		title = fmt.Sprintf("선택한 노트 %d개의 태그", p.total)
	}
	box := m.buildModal(title, content, width, p.actions(), p.bar)
	if cursor != nil {
		// buildModal은 제목 세 줄 뒤에 본문을 둔다.
		box.cursor = &cursorPos{x: cursor.x, y: cursor.y}
	}
	return box
}

// --- 다중 선택 태그 일괄 적용 (applySelectionTag) ---

type selectionTaggedMsg struct {
	issue   github.Issue
	created *github.Label
	err     error
	done    bool
}

// applySelectionTags는 체크한 태그를 고른 노트에 붙이거나 뗀다. 노트마다 차례로 보내 GitHub의
// 연속 쓰기 제한을 피한다.
func (m Model) applySelectionTags() (tea.Model, tea.Cmd) {
	workspace, ok := m.activeWorkspace()
	p := m.picker
	if !ok || len(p.changes) == 0 {
		m.picker = nil
		return m, nil
	}
	p.busy = true
	names := make([]string, 0, len(p.changes))
	for name := range p.changes {
		names = append(names, name)
	}
	sort.Strings(names)
	current := map[int64][]string{}
	selected := m.selectedIssues()
	for _, issue := range selected {
		current[issue.ID] = issue.LabelNames()
	}
	var sequence []tea.Cmd
	for _, name := range names {
		name, mode := name, p.changes[name]
		exists := false
		for _, label := range m.labels {
			exists = exists || strings.EqualFold(label.Name, name)
		}
		if mode == "add" && !exists {
			sequence = append(sequence, func() tea.Msg {
				client, err := clientFor(workspace)
				if err != nil {
					return selectionTaggedMsg{err: err}
				}
				ctx, cancel := requestContext()
				defer cancel()
				label, err := client.CreateLabel(ctx, workspace.Repo, name, "")
				if err != nil {
					return selectionTaggedMsg{err: err}
				}
				return selectionTaggedMsg{created: &label}
			})
		}
		for _, issue := range selected {
			if notes.HasIssueLabel(current[issue.ID], name) == (mode == "remove") {
				labels := current[issue.ID]
				if mode == "add" {
					labels = append(append([]string{}, labels...), name)
				} else {
					var kept []string
					for _, label := range labels {
						if !strings.EqualFold(label, name) {
							kept = append(kept, label)
						}
					}
					labels = kept
				}
				current[issue.ID] = labels
			}
		}
	}
	for _, issue := range selected {
		issue, labels := issue, current[issue.ID]
		if strings.Join(labels, "\x00") == strings.Join(issue.LabelNames(), "\x00") {
			continue
		}
		sequence = append(sequence, func() tea.Msg {
			client, err := clientFor(workspace)
			if err != nil {
				return selectionTaggedMsg{err: err}
			}
			ctx, cancel := requestContext()
			defer cancel()
			saved, err := client.SetIssueLabels(ctx, workspace.Repo, issue.Number, labels)
			if err != nil {
				return selectionTaggedMsg{err: err}
			}
			issue.Labels = saved.Labels
			return selectionTaggedMsg{issue: issue}
		})
	}
	sequence = append(sequence, func() tea.Msg { return selectionTaggedMsg{done: true} })
	return m, tea.Sequence(sequence...)
}

func (m Model) applySelectionTagged(msg selectionTaggedMsg) (tea.Model, tea.Cmd) {
	if msg.created != nil {
		m.labels = append(m.labels, *msg.created)
	}
	if msg.err != nil {
		if m.picker != nil {
			m.picker.busy = false
		}
		return m.showToast(describeError(msg.err))
	}
	if msg.issue.ID != 0 {
		m.replaceIssue(msg.issue)
		if m.note != nil && m.note.issue.ID == msg.issue.ID && !m.note.dirty {
			m.note.issue.Labels = msg.issue.Labels
			m.note.labels = notes.VisibleLabelNames(msg.issue.LabelNames())
		}
	}
	if msg.done {
		removedActive := false
		if m.picker != nil {
			for name, mode := range m.picker.changes {
				removedActive = removedActive || (mode == "remove" && strings.EqualFold(m.activeLabel, name))
			}
		}
		m.picker = nil
		if removedActive {
			return m.reload()
		}
		return m.showToast("태그를 적용했습니다.")
	}
	return m, nil
}
