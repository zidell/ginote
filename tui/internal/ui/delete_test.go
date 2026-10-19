package ui

import (
	"testing"
)

func TestTrashPermanentDeletionConfirmsAndRemovesNote(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	fake.issues[2]["state"] = "closed"
	m := startApp(t, fake)
	m = press(t, m, "]", "down", "enter")
	m = click(t, m, "tb:more")
	for _, item := range m.choice.items {
		if item.id == "move" && item.key != "" {
			t.Fatal("restore must not show Delete")
		}
	}
	m = clickChoice(t, m, "permanently-delete")
	if m.prompt == nil || fake.issue(2) == nil {
		t.Fatal("confirmation required")
	}
	m = press(t, m, "esc")
	if fake.issue(2) == nil {
		t.Fatal("cancel removed note")
	}
	m = click(t, m, "tb:more")
	m = clickChoice(t, m, "permanently-delete")
	m = press(t, m, "enter")
	if fake.issue(2) != nil || m.note != nil || len(m.issues) != 0 {
		t.Fatal("deleted note remains")
	}
}

func TestPermanentDeletionFailureAndWorkspaceChange(t *testing.T) {
	fake := newFakeGitHub(t)
	seed(fake)
	m := startApp(t, fake)
	m = press(t, m, "down", "enter")
	original := m.note.issue
	workspace, _ := m.activeWorkspace()
	m = drive(t, m, issueDeletedMsg{issue: original, workspaceID: "other", deleted: true})
	if m.note == nil {
		t.Fatal("changed workspace result removed current note")
	}
	m = drive(t, m, issueDeletedMsg{issue: original, workspaceID: workspace.ID, deleted: true})
	if m.note != nil {
		t.Fatal("deleted note stayed open")
	}
}
