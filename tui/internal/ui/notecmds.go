package ui

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/notes"
)

// 노트 동작은 NoteEditor.svelte(저장·잠금·댓글·첨부)와 App.svelte(selectNote, newNote,
// noteSaved)를 따른다.

type noteRefreshedMsg struct {
	gen   int
	issue github.Issue
	err   error
}

type noteSavedMsg struct {
	id        int64 // 저장을 시작할 때의 이슈 ID(새 노트는 0)
	revision  int
	signature string
	issue     github.Issue
	created   []github.Label
	err       error
}

type noteCreatedMsg struct {
	issue github.Issue
	err   error
}

type autosaveMsg struct {
	id       int64
	revision int
}

type commentsLoadedMsg struct {
	number   int
	comments []github.Comment
	err      error
}

type commentSavedMsg struct {
	number  int
	index   int
	comment github.Comment
	err     error
	deleted bool
}

type attachmentsLoadedMsg struct {
	number      int
	attachments []github.Attachment
}

type attachmentUploadedMsg struct {
	number     int
	attachment github.Attachment
	err        error
}

type lockResultMsg struct {
	number int
	body   string
	pin    string
	err    error
	locked bool // true면 잠금 처리, false면 잠금 열기
}

// openNote는 목록에서 노트를 연다(selectNote). 키보드 커서는 그 노트로 옮긴다.
func (m Model) openNote(issue github.Issue, focusEditor bool) (Model, tea.Cmd) {
	var flush tea.Cmd
	if m.note != nil && m.note.issue.ID != issue.ID {
		m, flush = m.closeNote()
	}
	if m.note == nil || m.note.issue.ID != issue.ID {
		m.note = newNoteState(issue, m.prefs.TitleMode, m.repo())
		m.detailScroll = 0
	}
	m.kbFocus = issue.ID
	m.scrollListTo(issue.ID)
	m.choice = nil
	m.picker = nil
	cmds := []tea.Cmd{flush, m.refreshNote(issue.Number), m.loadComments(issue.Number)}
	if m.note.lock != lockLocked {
		cmds = append(cmds, m.loadAttachments(issue.Number), m.loadThumbnails())
	}
	if m.note.lock == lockLocked && m.lockPin != "" {
		cmds = append(cmds, m.unlockNote(m.lockPin))
	}
	if focusEditor {
		m = m.focusEditor()
	} else {
		m.blurInputs()
	}
	m.layoutNote()
	return m, tea.Batch(cmds...)
}

// focusEditor는 본문(별도 제목 방식에서 제목이 비었으면 제목)에 포커스를 둔다.
func (m Model) focusEditor() Model {
	if m.note == nil || !m.note.editable(m.state == "closed") || m.note.preview || m.selectionMode() {
		return m
	}
	m.blurInputs()
	if m.prefs.TitleMode == config.TitleSeparate && strings.TrimSpace(m.note.title.Value()) == "" {
		m.focus = focusTitle
		m.note.title.Focus()
	} else {
		m.focus = focusBody
		m.note.body.Focus()
	}
	m.keepCursorVisible()
	return m
}

func (m *Model) blurInputs() {
	m.focus = focusNone
	m.search.Blur()
	if m.note != nil {
		m.note.title.Blur()
		m.note.body.Blur()
		for index := range m.note.comments {
			m.note.comments[index].editor.Blur()
		}
	}
}

// closeNote는 노트를 닫는다. 저장하지 않은 내용은 바로 저장을 보낸다(returnToList).
func (m Model) closeNote() (Model, tea.Cmd) {
	if m.note == nil {
		return m, nil
	}
	var cmd tea.Cmd
	if m.note.dirty {
		m, cmd = m.saveNote(true)
	}
	if cmd == nil {
		cmd = m.saveDirtyComments()
	}
	m.blurInputs()
	m.note = nil
	m.choice = nil
	m.picker = nil
	m.replace = nil
	m.detailScroll = 0
	return m, cmd
}

func (m Model) refreshNote(number int) tea.Cmd {
	workspace, ok := m.activeWorkspace()
	if !ok || number == 0 {
		return nil
	}
	gen := m.gen
	return func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return noteRefreshedMsg{gen: gen, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		issue, err := client.GetIssue(ctx, workspace.Repo, number)
		return noteRefreshedMsg{gen: gen, issue: issue, err: err}
	}
}

func (m Model) applyRefreshed(msg noteRefreshedMsg) (Model, tea.Cmd) {
	if msg.err != nil || m.note == nil || m.note.issue.ID != msg.issue.ID {
		return m, nil
	}
	m.replaceIssue(msg.issue)
	if m.note.dirty || m.note.saving || m.focus == focusBody || m.focus == focusTitle {
		m.note.issue = msg.issue
		return m, nil
	}
	if msg.issue.UpdatedAt.After(m.note.issue.UpdatedAt) || m.note.issue.Body != msg.issue.Body {
		wasUnlocked := m.note.lock == lockUnlocked
		m.note.load(msg.issue)
		m.layoutNote()
		if wasUnlocked && m.lockPin != "" {
			return m, m.unlockNote(m.lockPin)
		}
	}
	return m, nil
}

// newNote는 새 노트를 만든다(newNote, allocatePendingIssue). 번호를 먼저 받아 두고,
// 받는 동안 쓴 내용은 번호가 생기면 저장한다.
func (m Model) newNote(body string) (Model, tea.Cmd) {
	workspace, ok := m.activeWorkspace()
	if !ok || m.selectionMode() || (m.note != nil && m.note.pending) {
		return m, nil
	}
	m, flush := m.closeNote()
	var reset tea.Cmd
	if m.state != "open" || (m.appliedQuery != "" && m.activeLabel == "") {
		m.state = "open"
		m.search.SetValue("")
		m.appliedQuery = ""
		m, reset = m.restartList()
	}
	var labels []string
	if m.activeLabel != "" {
		labels = []string{m.activeLabel}
	}
	issue := github.Issue{Title: "새 노트", Body: body}
	for _, name := range labels {
		issue.Labels = append(issue.Labels, github.Label{Name: name})
	}
	m.note = newNoteState(issue, m.prefs.TitleMode, m.repo())
	m.note.pending = true
	m.note.lastSignature = ""
	if body != "" {
		m.note.changed()
	}
	m = m.focusEditor()
	m.layoutNote()
	return m, tea.Batch(flush, reset, func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return noteCreatedMsg{err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		created, err := client.CreateIssue(ctx, workspace.Repo, github.NoteInput{Title: "새 노트", Labels: labels})
		return noteCreatedMsg{issue: created, err: err}
	})
}

func (m Model) repo() string {
	if workspace, ok := m.activeWorkspace(); ok {
		return workspace.Repo
	}
	return ""
}

func (m Model) applyCreated(msg noteCreatedMsg) (Model, tea.Cmd) {
	if m.note == nil || !m.note.pending {
		return m, nil
	}
	m.note.pending = false
	if msg.err != nil {
		m.note.err = "새 노트를 준비하지 못했습니다. " + describeError(msg.err)
		return m, nil
	}
	m.note.issue = msg.issue
	m.issues = append([]github.Issue{msg.issue}, removeIssue(m.issues, msg.issue.ID)...)
	m.kbFocus = msg.issue.ID
	m.entered = msg.issue.ID
	if m.note.dirty || strings.TrimSpace(m.note.body.Value()) != "" {
		m.note.dirty = true
		return m.saveNote(false)
	}
	return m, nil
}

// scheduleAutosave는 입력이 멈추고 auto_save_seconds가 지나면 저장한다.
func (m Model) scheduleAutosave() tea.Cmd {
	if m.note == nil || !m.note.dirty {
		return nil
	}
	id, revision := m.note.issue.ID, m.note.revision
	return tea.Tick(time.Duration(m.prefs.AutoSaveSeconds)*time.Second, func(time.Time) tea.Msg {
		return autosaveMsg{id: id, revision: revision}
	})
}

// saveNote는 노트를 GitHub에 저장한다(saveRemote). force면 서명이 같아도 보낸다.
func (m Model) saveNote(force bool) (Model, tea.Cmd) {
	n := m.note
	workspace, ok := m.activeWorkspace()
	if n == nil || !ok || m.state == "closed" || n.pending || n.saving {
		return m, nil
	}
	if !force && !n.dirty {
		return m, nil
	}
	title := n.currentTitle(m.prefs.TitleMode)
	if title == "" {
		return m, nil
	}
	signature := n.signature()
	if !force && signature == n.lastSignature {
		n.dirty = false
		return m, nil
	}
	n.saving = true
	n.saveFailed = false
	n.err = ""
	body := n.remoteBody()
	labels := append([]string{}, n.labels...)
	for _, name := range n.issue.LabelNames() {
		if notes.IsPinLabel(name) {
			labels = append(labels, name)
		}
	}
	known := map[string]bool{}
	for _, label := range m.labels {
		known[strings.ToLower(label.Name)] = true
	}
	var missing []string
	for _, name := range n.labels {
		if !known[strings.ToLower(name)] {
			missing = append(missing, name)
		}
	}
	lock, encrypted, pin := n.lock, n.encryptedBody, m.lockPin
	id, number, revision := n.issue.ID, n.issue.Number, n.revision
	return m, func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return noteSavedMsg{id: id, revision: revision, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		var created []github.Label
		for _, name := range missing {
			label, err := client.CreateLabel(ctx, workspace.Repo, name, "")
			if err != nil && github.StatusOf(err) != 422 {
				return noteSavedMsg{id: id, revision: revision, err: err}
			}
			if err == nil {
				created = append(created, label)
			}
		}
		input := github.NoteInput{Title: title, Body: body, Labels: labels}
		switch lock {
		case lockLocked:
			input.Title = notes.AddLockToTitle(title)
			input.Body = encrypted
		case lockUnlocked:
			if pin == "" {
				return noteSavedMsg{id: id, revision: revision, err: fmt.Errorf("잠금 세션이 만료되었습니다.")}
			}
			sealed, err := notes.EncryptLockedBody(body, pin, number)
			if err != nil {
				return noteSavedMsg{id: id, revision: revision, err: err}
			}
			input.Title = notes.AddLockToTitle(title)
			input.Body = sealed
		}
		saved, err := client.UpdateIssue(ctx, workspace.Repo, number, input)
		return noteSavedMsg{id: id, revision: revision, signature: signature, issue: saved, created: created, err: err}
	}
}

func (m Model) applySaved(msg noteSavedMsg) (Model, tea.Cmd) {
	if len(msg.created) > 0 {
		m.labels = append(m.labels, msg.created...)
	}
	if msg.err == nil {
		m.replaceIssue(msg.issue)
	}
	n := m.note
	if n == nil || n.issue.ID != msg.id {
		if msg.err != nil {
			return m.showToast("GitHub에 저장하지 못했습니다. " + describeError(msg.err))
		}
		return m, nil
	}
	n.saving = false
	if msg.err != nil {
		n.saveFailed = true
		switch github.StatusOf(msg.err) {
		case 401:
			n.err = "PAT가 올바르지 않거나 폐기되었습니다."
		case 403:
			n.err = "저장 권한이 없습니다."
		default:
			n.err = "GitHub에 저장하지 못했습니다. " + describeError(msg.err)
		}
		id, revision := n.issue.ID, n.revision
		return m, tea.Tick(15*time.Second, func(time.Time) tea.Msg { return autosaveMsg{id: id, revision: revision} })
	}
	n.issue = msg.issue
	if n.lock != lockPlain {
		n.encryptedBody = msg.issue.Body
	}
	n.lastSignature = msg.signature
	n.saveFailed = false
	if n.revision == msg.revision {
		n.dirty = false
		n.savedFlash = true
		return m, nil
	}
	n.dirty = n.signature() != n.lastSignature
	return m, m.scheduleAutosave()
}

// --- 잠금 (requestLock, lockNote, revealLockedNote, removeLock) ---

// requestLock은 L 키다. 잠금이 없으면 잠그고, 잠겨 있으면 열거나 잠금을 푼다.
func (m Model) requestLock() (Model, tea.Cmd) {
	n := m.note
	if n == nil || n.number() == 0 {
		return m, nil
	}
	switch n.lock {
	case lockPlain:
		if m.lockPin != "" {
			return m, m.lockWithPin(m.lockPin)
		}
		m.prompt = newPinPrompt("lock")
	case lockLocked:
		m.prompt = newPinPrompt("unlock")
	case lockUnlocked:
		n.lock = lockPlain
		n.encryptedBody = ""
		n.changed()
		return m.saveNote(true)
	}
	return m, nil
}

func (m Model) lockWithPin(pin string) tea.Cmd {
	n := m.note
	body, number := n.remoteBody(), n.number()
	return func() tea.Msg {
		sealed, err := notes.EncryptLockedBody(body, pin, number)
		return lockResultMsg{number: number, body: sealed, pin: pin, err: err, locked: true}
	}
}

func (m Model) unlockNote(pin string) tea.Cmd {
	n := m.note
	if n == nil || n.lock != lockLocked {
		return nil
	}
	encrypted, number := n.encryptedBody, n.number()
	return func() tea.Msg {
		body, err := notes.DecryptLockedBody(encrypted, pin, number)
		return lockResultMsg{number: number, body: body, pin: pin, err: err}
	}
}

func (m Model) applyLockResult(msg lockResultMsg) (Model, tea.Cmd) {
	n := m.note
	if n == nil || n.number() != msg.number {
		return m, nil
	}
	if msg.err != nil {
		text := msg.err.Error()
		if errors.Is(msg.err, notes.ErrWrongPin) {
			text += " 직접 배포한 웹에서 잠갔다면 환경설정의 잠금 pepper를 그 서버 값으로 맞추세요."
		}
		if m.prompt != nil {
			m.prompt.err = text
			m.prompt.input.SetValue("")
			return m, nil
		}
		m.lockPin = ""
		m.prompt = newPinPrompt("unlock")
		m.prompt.err = text
		return m, nil
	}
	m.prompt = nil
	m.lockPin = msg.pin
	m.lockPinUntil = time.Now().Add(time.Duration(m.prefs.LockSessionMinutes) * time.Minute)
	if msg.locked {
		n.encryptedBody = msg.body
		n.lock = lockUnlocked
		n.changed()
		return m.saveNote(true)
	}
	n.lock = lockUnlocked
	n.setPlainBody(msg.body)
	n.lastSignature = n.signature()
	n.dirty = false
	m.layoutNote()
	return m, tea.Batch(m.decryptComments(), m.loadAttachments(n.number()))
}

// --- 댓글 (loadIssueComments, saveComment, addComment, removeComment) ---

func (m Model) loadComments(number int) tea.Cmd {
	workspace, ok := m.activeWorkspace()
	if !ok || number == 0 {
		return nil
	}
	if m.note != nil {
		m.note.commentsLoading = true
	}
	return func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return commentsLoadedMsg{number: number, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		comments, err := client.ListIssueComments(ctx, workspace.Repo, number)
		return commentsLoadedMsg{number: number, comments: comments, err: err}
	}
}

func (m Model) applyComments(msg commentsLoadedMsg) (Model, tea.Cmd) {
	n := m.note
	if n == nil || n.number() != msg.number {
		return m, nil
	}
	n.commentsLoading = false
	if msg.err != nil {
		return m, nil
	}
	editing := m.focus == focusComment
	if editing {
		return m, nil
	}
	n.comments = nil
	for _, comment := range msg.comments {
		n.comments = append(n.comments, newCommentState(comment, n.repo))
	}
	m.layoutNote()
	if n.lock == lockUnlocked {
		return m, m.decryptComments()
	}
	return m, nil
}

// newCommentState는 댓글 칸이다. 관리 블록은 떼어 두고 첨부 주소는 줄여 보인다
// (normalizeCommentAttachmentBody).
func newCommentState(comment github.Comment, repo string) commentState {
	editor := newEditorArea("댓글을 입력하세요…")
	state := commentState{comment: comment, editor: editor}
	state.setBody(comment.Body, repo)
	return state
}

func (c *commentState) setBody(body, repo string) {
	c.preservedLinks = notes.ManagedAttachmentLinks(body)
	c.comment.Body = notes.StripManagedAttachmentBlocks(body)
	c.editor.SetValue(notes.CompressAttachmentLinks(c.comment.Body, repo))
}

// remoteBody는 저장할 댓글 본문이다(commentBodyWithManagedAttachmentLinks).
func (c *commentState) remoteBody(repo string) string {
	clean := notes.StripManagedAttachmentBlocks(notes.ExpandAttachmentLinks(strings.TrimSpace(c.editor.Value()), repo))
	linked := map[string]bool{}
	for _, path := range notes.ParseAttachmentPaths(clean) {
		linked[path] = true
	}
	var links []string
	for _, link := range c.preservedLinks {
		paths := notes.ParseAttachmentPaths(link)
		if len(paths) == 0 || linked[paths[0]] {
			continue
		}
		linked[paths[0]] = true
		links = append(links, link)
	}
	return notes.WithManagedAttachmentBlock(clean, links)
}

type commentsDecryptedMsg struct {
	number int
	bodies map[int64]string
}

// decryptComments는 잠금을 연 노트의 댓글 본문을 푼다(decryptCommentBodies).
func (m Model) decryptComments() tea.Cmd {
	n := m.note
	if n == nil || m.lockPin == "" {
		return nil
	}
	pin, number := m.lockPin, n.number()
	encrypted := map[int64]string{}
	for _, comment := range n.comments {
		if notes.IsLockedPayload(comment.comment.Body) {
			encrypted[comment.comment.ID] = comment.comment.Body
		}
	}
	if len(encrypted) == 0 {
		return nil
	}
	return func() tea.Msg {
		bodies := map[int64]string{}
		for id, body := range encrypted {
			if plain, err := notes.DecryptLockedBody(body, pin, number); err == nil {
				bodies[id] = plain
			}
		}
		return commentsDecryptedMsg{number: number, bodies: bodies}
	}
}

func (m Model) applyDecryptedComments(msg commentsDecryptedMsg) (Model, tea.Cmd) {
	n := m.note
	if n == nil || n.number() != msg.number {
		return m, nil
	}
	for index := range n.comments {
		if body, ok := msg.bodies[n.comments[index].comment.ID]; ok {
			n.comments[index].setBody(body, n.repo)
		}
	}
	m.layoutNote()
	return m, nil
}

// addComment는 "+ 댓글 추가"다. 빈 댓글 칸을 만들고 포커스를 둔다. 저장은 칸을 벗어날 때 한다.
func (m Model) addComment() Model {
	n := m.note
	if n == nil || n.number() == 0 || !n.editable(m.state == "closed") {
		return m
	}
	state := newCommentState(github.Comment{Author: m.user, CreatedAt: time.Now(), UpdatedAt: time.Now()}, n.repo)
	state.isNew = true
	n.comments = append(n.comments, state)
	return m.focusComment(len(n.comments) - 1)
}

func (m Model) focusComment(index int) Model {
	m.blurInputs()
	m.focus = focusComment
	m.note.commentFocus = index
	m.note.comments[index].editor.Focus()
	m.keepCursorVisible()
	return m
}

// saveComment는 댓글 칸을 벗어날 때 바뀐 댓글을 저장한다. 비운 새 댓글은 버린다.
func (m Model) saveComment(index int) (Model, tea.Cmd) {
	n := m.note
	workspace, ok := m.activeWorkspace()
	if n == nil || !ok || index < 0 || index >= len(n.comments) {
		return m, nil
	}
	comment := &n.comments[index]
	body := strings.TrimSpace(comment.editor.Value())
	remote := comment.remoteBody(n.repo)
	if comment.isNew && body == "" {
		n.comments = append(n.comments[:index:index], n.comments[index+1:]...)
		return m, nil
	}
	if !comment.isNew && notes.ExpandAttachmentLinks(body, n.repo) == strings.TrimSpace(comment.comment.Body) {
		return m, nil
	}
	if body == "" {
		return m, nil
	}
	comment.saving = true
	comment.failed = false
	number, isNew, commentID, repo := n.number(), comment.isNew, comment.comment.ID, n.repo
	lock, pin := n.lock, m.lockPin
	return m, func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return commentSavedMsg{number: number, index: index, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		if lock != lockPlain && pin != "" {
			if sealed, err := notes.EncryptLockedBody(body, pin, number); err == nil {
				remote = sealed
			}
		}
		var saved github.Comment
		if isNew {
			saved, err = client.CreateIssueComment(ctx, workspace.Repo, number, remote)
		} else {
			saved, err = client.UpdateIssueComment(ctx, workspace.Repo, commentID, remote)
		}
		if err == nil {
			saved.Body = notes.StripManagedAttachmentBlocks(notes.ExpandAttachmentLinks(body, repo))
		}
		return commentSavedMsg{number: number, index: index, comment: saved, err: err}
	}
}

func (m Model) saveDirtyComments() tea.Cmd {
	if m.note == nil || m.focus != focusComment {
		return nil
	}
	_, cmd := m.saveComment(m.note.commentFocus)
	return cmd
}

func (m Model) deleteComment(index int) (Model, tea.Cmd) {
	n := m.note
	workspace, ok := m.activeWorkspace()
	if n == nil || !ok || index < 0 || index >= len(n.comments) {
		return m, nil
	}
	comment := n.comments[index]
	if comment.isNew {
		n.comments = append(n.comments[:index:index], n.comments[index+1:]...)
		return m, nil
	}
	comment.saving = true
	n.comments[index] = comment
	number, id := n.number(), comment.comment.ID
	return m, func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return commentSavedMsg{number: number, index: index, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		err = client.DeleteIssueComment(ctx, workspace.Repo, id)
		return commentSavedMsg{number: number, index: index, comment: github.Comment{ID: id}, err: err, deleted: true}
	}
}

func (m Model) applyCommentSaved(msg commentSavedMsg) (Model, tea.Cmd) {
	n := m.note
	if n == nil || n.number() != msg.number {
		return m, nil
	}
	index := msg.index
	if msg.deleted {
		for position, comment := range n.comments {
			if comment.comment.ID == msg.comment.ID {
				index = position
			}
		}
	}
	if index < 0 || index >= len(n.comments) {
		return m, nil
	}
	comment := &n.comments[index]
	comment.saving = false
	if msg.err != nil {
		comment.failed = true
		return m.showToast(describeError(msg.err))
	}
	if msg.deleted {
		n.comments = append(n.comments[:index:index], n.comments[index+1:]...)
		if m.focus == focusComment {
			m.blurInputs()
		}
		m.layoutNote()
		return m, nil
	}
	comment.isNew = false
	comment.failed = false
	comment.comment = msg.comment
	if m.focus != focusComment || n.commentFocus != index {
		comment.editor.SetValue(notes.CompressAttachmentLinks(msg.comment.Body, n.repo))
	}
	return m, nil
}

// --- 첨부 (uploadFiles, reconcileIssueAttachments) ---

func (m Model) loadAttachments(number int) tea.Cmd {
	workspace, ok := m.activeWorkspace()
	if !ok || number == 0 {
		return nil
	}
	return func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return nil
		}
		ctx, cancel := requestContext()
		defer cancel()
		files, err := client.ListIssueAttachmentFiles(ctx, workspace.Repo, number)
		if err != nil {
			return nil
		}
		return attachmentsLoadedMsg{number: number, attachments: files}
	}
}

// uploadAttachment는 A 키로 받은 파일 경로를 저장소에 올리고 본문 끝에 링크를 넣는다.
func (m Model) uploadAttachment(path string) tea.Cmd {
	workspace, ok := m.activeWorkspace()
	n := m.note
	if !ok || n == nil || n.number() == 0 {
		return nil
	}
	number := n.number()
	return func() tea.Msg {
		path = expandHome(strings.Trim(strings.TrimSpace(path), `"'`))
		data, err := os.ReadFile(path)
		if err != nil {
			return attachmentUploadedMsg{number: number, err: err}
		}
		if len(data) > 10<<20 {
			return attachmentUploadedMsg{number: number, err: fmt.Errorf("“%s” 파일은 10MB보다 커서 업로드하지 않았습니다.", filepath.Base(path))}
		}
		client, err := clientFor(workspace)
		if err != nil {
			return attachmentUploadedMsg{number: number, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		attachment, err := client.UploadAttachment(ctx, workspace.Repo, number, filepath.Base(path), "", data, 0)
		return attachmentUploadedMsg{number: number, attachment: attachment, err: err}
	}
}

func expandHome(path string) string {
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[2:])
		}
	}
	return path
}

func (m Model) applyUploaded(msg attachmentUploadedMsg) (Model, tea.Cmd) {
	n := m.note
	if msg.err != nil {
		return m.showToast("파일 업로드에 실패했습니다. " + describeError(msg.err))
	}
	if n == nil || n.number() != msg.number {
		return m, nil
	}
	// 웹처럼 첨부 목록에 더하고, 본문에 직접 넣지 않은 첨부는 저장할 때 관리 블록으로 연결된다.
	n.attachments = append(n.attachments, inferAttachment(msg.attachment))
	n.attachmentsLoaded = true
	n.changed()
	n.dirty = true
	m.layoutNote()
	next, cmd := m.saveNote(false)
	return next, tea.Batch(cmd, next.loadThumbnails(), func() tea.Msg { return toastMsg{"첨부했습니다: " + msg.attachment.Name} })
}

type toastMsg struct{ text string }

// copyIssueNumber는 툴바의 #번호를 누르면 번호를 복사한다(copyIssueNumber).
func (m Model) copyIssueNumber() (Model, tea.Cmd) {
	if m.note == nil || m.note.number() == 0 {
		return m, nil
	}
	text := fmt.Sprintf("#%d", m.note.number())
	return m, copyText(text, text+" 복사했습니다.")
}
