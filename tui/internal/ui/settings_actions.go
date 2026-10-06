package ui

import (
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/notes"
)

// --- 태그 만들기·이름 바꾸기·삭제 (createRepositoryLabel, renameRepositoryLabel, deleteRepositoryLabel) ---

type labelChangedMsg struct {
	created *github.Label
	renamed *github.Label
	from    string
	deleted string
	err     error
}

func (m Model) createLabelCmd(name, description string) tea.Cmd {
	workspace, ok := m.activeWorkspace()
	if !ok {
		return nil
	}
	limited := notes.LimitTagInput(notes.TagInput{Name: name, Description: description})
	return func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return labelChangedMsg{err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		label, err := client.CreateLabel(ctx, workspace.Repo, limited.Name, limited.Description)
		return labelChangedMsg{created: &label, err: err}
	}
}

// renameLabelCmd는 태그 이름·설명을 바꾼다(renameRepositoryLabel).
func (m Model) renameLabelCmd(current, name, description string) tea.Cmd {
	workspace, ok := m.activeWorkspace()
	limited := notes.LimitTagInput(notes.TagInput{Name: notes.NormalizeTagName(name), Description: description})
	if !ok || limited.Name == "" || notes.IsPinLabel(limited.Name) {
		return nil
	}
	return func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return labelChangedMsg{err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		label, err := client.RenameLabel(ctx, workspace.Repo, current, limited.Name, &limited.Description)
		return labelChangedMsg{renamed: &label, from: current, err: err}
	}
}

func (m Model) deleteLabelCmd(name string) tea.Cmd {
	workspace, ok := m.activeWorkspace()
	if !ok {
		return nil
	}
	return func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return labelChangedMsg{err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		return labelChangedMsg{deleted: name, err: client.RemoveLabel(ctx, workspace.Repo, name)}
	}
}

func (m Model) applyLabelChanged(msg labelChangedMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		return m.showToast(describeError(msg.err))
	}
	switch {
	case msg.created != nil:
		m.labels = append(removeLabel(m.labels, msg.created.Name), *msg.created)
		return m.showToast("#" + msg.created.Name + " 태그를 추가했습니다.")
	case msg.renamed != nil:
		for index := range m.labels {
			if m.labels[index].Name == msg.from {
				m.labels[index] = *msg.renamed
			}
		}
		m.renameLabelInNotes(msg.from, msg.renamed.Name)
		if strings.EqualFold(m.activeLabel, msg.from) {
			m.activeLabel = msg.renamed.Name
			m.search.SetValue("#" + msg.renamed.Name)
			m.appliedQuery = "#" + msg.renamed.Name
		}
		if msg.from != msg.renamed.Name {
			return m.showToast("#" + msg.from + " 태그 이름을 #" + msg.renamed.Name + "로 바꿨습니다.")
		}
		return m, nil
	case msg.deleted != "":
		m.labels = removeLabel(m.labels, msg.deleted)
		m.renameLabelInNotes(msg.deleted, "")
		next, cmd := m.showToast("#" + msg.deleted + " 태그를 삭제했습니다.")
		if strings.EqualFold(m.activeLabel, msg.deleted) {
			next.search.SetValue("")
			restarted, restart := next.submitSearch()
			return restarted, tea.Batch(cmd, restart)
		}
		return next, cmd
	}
	return m, nil
}

func removeLabel(labels []github.Label, name string) []github.Label {
	var kept []github.Label
	for _, label := range labels {
		if label.Name != name {
			kept = append(kept, label)
		}
	}
	return kept
}

// renameLabelInNotes는 목록과 열린 노트의 태그 이름을 바꾸거나(next가 비면) 지운다
// (applyLabelChangeToNotes).
func (m *Model) renameLabelInNotes(current, next string) {
	rename := func(issue *github.Issue) {
		var labels []github.Label
		for _, label := range issue.Labels {
			if strings.EqualFold(label.Name, current) {
				if next == "" {
					continue
				}
				label.Name = next
			}
			labels = append(labels, label)
		}
		issue.Labels = labels
	}
	for index := range m.issues {
		rename(&m.issues[index])
	}
	for index := range m.pinned {
		rename(&m.pinned[index])
	}
	if m.note != nil {
		rename(&m.note.issue)
		m.note.labels = notes.ReplaceLabelName(m.note.labels, current, next)
		m.note.lastSignature = m.note.signature()
	}
}
