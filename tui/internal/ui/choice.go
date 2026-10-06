package ui

import (
	"strconv"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/github"
)

// 선택 창의 키와 항목 실행. 드롭다운 대신 가운데 뜨는 목록이다(모달 공통 규칙은 modal.go).

func (m Model) handleChoiceKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	c := m.choice
	key := keyName(msg)
	if pressed, handled := c.bar.barKey(c.actions(), key); handled {
		switch pressed {
		case "choose":
			return m.chooseCurrent()
		case "cancel":
			return m.closeChoice()
		}
		return m, nil
	}
	switch key {
	case "esc", "`":
		return m.closeChoice()
	case "up", "k":
		c.move(-1)
	case "down", "j":
		c.move(1)
	case "enter", "space":
		return m.chooseCurrent()
	default:
		if item, ok := c.byKey(msg.String()); ok {
			return m.runChoice(item.id)
		}
		if item, ok := c.byKey(key); ok {
			return m.runChoice(item.id)
		}
		// 저장소 전환은 1~9로 바로 고른다.
		if number, err := strconv.Atoi(key); err == nil && c.kind == "switcher" && number >= 1 && number <= len(m.workspaces) {
			return m.runChoice("switch:" + strconv.Itoa(number-1))
		}
	}
	return m, nil
}

func (m Model) closeChoice() (tea.Model, tea.Cmd) {
	m.choice = nil
	return m, nil
}

func (m Model) chooseCurrent() (tea.Model, tea.Cmd) {
	c := m.choice
	if c.cursor < 0 || c.cursor >= len(c.items) || c.items[c.cursor].disabled {
		return m, nil
	}
	return m.runChoice(c.items[c.cursor].id)
}

// runChoice는 고른 항목을 실행한다. 선택 창은 먼저 닫는다.
func (m Model) runChoice(id string) (tea.Model, tea.Cmd) {
	c := m.choice
	m.choice = nil
	switch {
	case c.kind == "switcher":
		if id == "add" {
			return m.openSetup()
		}
		index, _ := strconv.Atoi(strings.TrimPrefix(id, "switch:"))
		return m.switchWorkspace(index)
	case strings.HasPrefix(c.kind, "comment:"):
		index, _ := strconv.Atoi(strings.TrimPrefix(c.kind, "comment:"))
		switch id {
		case "comment-delete":
			return m.deleteComment(index)
		case "comment-voice":
			if m.note != nil && index < len(m.note.comments) {
				if target, ok := m.voiceTargetForNote("comment-edit", m.note.comments[index].comment.ID); ok {
					return m.openVoice(target)
				}
			}
		}
		return m, nil
	case strings.HasPrefix(c.kind, "settings"):
		return m.runSettingsChoice(c.kind, id)
	}
	if m.note == nil {
		return m, nil
	}
	switch id {
	case "preview":
		return m.noteShortcut("m")
	case "lock":
		return m.requestLock()
	case "pin":
		return m.togglePin(m.note.issue)
	case "replace":
		return m.noteShortcut("x")
	case "github":
		return m.noteShortcut("g")
	case "voice":
		return m.noteShortcut("e")
	case "move":
		return m.moveIssues([]github.Issue{m.note.issue})
	}
	return m, nil
}

// switcherChoice는 저장소 전환 창이다(WorkspaceSwitcher.svelte).
func (m Model) switcherChoice() *choiceModal {
	var items []menuItem
	for index, workspace := range m.workspaces {
		icon := "  "
		if index == m.active {
			icon = "✓ "
		}
		detail := ""
		if workspace.Name != "" {
			detail = workspace.Repo
		}
		key := ""
		if index < 9 {
			key = strconv.Itoa(index + 1)
		}
		items = append(items, menuItem{id: "switch:" + strconv.Itoa(index), icon: icon, label: workspace.Label(), detail: detail, key: key})
	}
	items = append(items, menuItem{id: "add", label: "+ 다른 저장소 추가", divider: true})
	return newChoice("switcher", "저장소 전환", items, max(0, m.active))
}

// noteMenu는 노트 툴바 ⋮ 메뉴다(detail-toolbar-more).
func (m Model) noteMenu() *choiceModal {
	n := m.note
	archived := m.state == "closed"
	editable := n.editable(archived) && !m.selectionMode()
	var items []menuItem
	if !n.preview {
		items = append(items, menuItem{id: "preview", label: "MD뷰어", key: "M"})
	} else {
		items = append(items, menuItem{id: "preview", label: "편집으로", key: "M"})
	}
	if n.editable(archived) || n.lock == lockLocked {
		label := "잠금"
		switch n.lock {
		case lockLocked:
			label = "잠금 열기"
		case lockUnlocked:
			label = "잠금 풀기"
		}
		items = append(items, menuItem{id: "lock", icon: "🔒", label: label, key: "L", disabled: archived || n.number() == 0})
	}
	if n.number() != 0 {
		label := "상단고정"
		if m.isPinned(n.issue) {
			label = "고정 해제"
		}
		items = append(items, menuItem{id: "pin", icon: "📌", label: label, key: "P", disabled: m.pinBusy || archived})
	}
	if editable {
		items = append(items,
			menuItem{id: "voice", icon: "🎤", label: "음성 녹음", key: "E", disabled: n.number() == 0},
			menuItem{id: "replace", label: "치환", key: "X"})
	}
	if n.number() != 0 {
		items = append(items, menuItem{id: "github", label: "GitHub에서 보기", key: "G"})
		if !m.selectionMode() {
			if archived {
				items = append(items, menuItem{id: "move", label: "복원", key: "Delete", divider: true})
			} else {
				items = append(items, menuItem{id: "move", label: "삭제", key: "Delete", divider: true, danger: true})
			}
		}
	}
	choice := newChoice("note", "노트 추가 작업", items, 0)
	if n.number() != 0 {
		choice.footer = []string{"생성됨: " + timestamp(n.issue.CreatedAt), "수정됨: " + timestamp(n.issue.UpdatedAt)}
	}
	return choice
}

func (m Model) commentMenu(index int) *choiceModal {
	return newChoice("comment:"+strconv.Itoa(index), "댓글 추가 작업", []menuItem{
		{id: "comment-voice", icon: "🎤", label: "음성 녹음"},
		{id: "comment-delete", label: "삭제", danger: true},
	}, 0)
}
