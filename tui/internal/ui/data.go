package ui

import (
	"errors"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/auth"
	"github.com/zidell/ginote/tui/internal/github"
)

// handleData는 GitHub 응답 같은 비동기 결과를 반영한다.
func (m Model) handleData(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case listLoadedMsg:
		return m.applyList(msg)
	case moreLoadedMsg:
		return m.applyMore(msg)
	case labelsLoadedMsg:
		if workspace, ok := m.activeWorkspace(); ok && workspace.ID == msg.workspaceID && msg.err == nil {
			m.labels = msg.labels
		}
		return m, nil
	case userLoadedMsg:
		m.user = msg.login
		return m, nil
	case issueMovedMsg:
		return m.applyMoved(msg)
	case pinToggledMsg:
		return m.applyPin(msg)
	case noteRefreshedMsg:
		return m.applyRefreshed(msg)
	case noteCreatedMsg:
		return m.applyCreated(msg)
	case noteSavedMsg:
		next, cmd := m.applySaved(msg)
		restarted, restart := next.afterTyping()
		return restarted, tea.Batch(cmd, restart)
	case autosaveMsg:
		if m.note != nil && m.note.issue.ID == msg.id && m.note.revision == msg.revision && m.note.dirty {
			return m.saveNote(false)
		}
		return m, nil
	case commentsLoadedMsg:
		return m.applyComments(msg)
	case commentsDecryptedMsg:
		return m.applyDecryptedComments(msg)
	case commentSavedMsg:
		return m.applyCommentSaved(msg)
	case attachmentsLoadedMsg:
		if m.note != nil && m.note.number() == msg.number && m.note.lock != lockLocked {
			m.note.reconcileAttachments(msg.attachments)
			m.layoutNote()
			return m, m.loadThumbnails()
		}
		return m, nil
	case thumbLoadedMsg:
		return m.applyThumbLoaded(msg)
	case thumbUploadedMsg:
		return m.applyThumbUploaded(msg)
	case attachmentUploadedMsg:
		return m.applyUploaded(msg)
	case attachmentDeletedMsg:
		return m.applyAttachmentDeleted(msg)
	case lockResultMsg:
		return m.applyLockResult(msg)
	case toastMsg:
		return m.showToast(msg.text)
	case selectionTaggedMsg:
		return m.applySelectionTagged(msg)
	case mergedMsg:
		return m.applyMerged(msg)
	case labelChangedMsg:
		return m.applyLabelChanged(msg)
	}
	return m, nil
}

// describeError는 GitHub 오류를 사람이 읽을 문장으로 바꾼다(error-messages.js의 friendlyError).
func describeError(err error) string {
	var apiErr *github.Error
	switch {
	case err == nil:
		return ""
	case errors.Is(err, auth.ErrNoToken):
		return "GitHub 토큰이 없습니다. ` 키로 저장소를 다시 추가해 토큰을 넣거나, `gh auth login` 또는 GINOTE_GITHUB_TOKEN을 쓰세요."
	case errors.As(err, &apiErr):
		switch {
		case apiErr.Status == 401:
			return "PAT가 올바르지 않거나 폐기되었습니다."
		case apiErr.Status == 404:
			return "저장소를 찾지 못했습니다. 저장소 이름과 PAT 권한을 확인하세요."
		case apiErr.Status == 403 && apiErr.Remaining == "0":
			return "GitHub API 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요."
		case apiErr.Status == 403:
			return "이 작업에 필요한 저장소 권한이 없습니다."
		}
		if apiErr.Message != "" {
			return apiErr.Message
		}
	}
	if text := err.Error(); text != "" {
		return text
	}
	return "알 수 없는 오류가 발생했습니다."
}
