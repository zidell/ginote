package ui

import (
	"context"
	"errors"
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/merge"
)

// 다중 선택의 병합(mergeSelectedIssues)과 첨부 삭제다.

type mergedMsg struct {
	result merge.Result
	err    error
}

type attachmentDeletedMsg struct {
	number int
	path   string
	err    error
}

// mergeAPI는 merge 패키지가 쓰는 GitHub 호출을 한 저장소의 클라이언트로 잇는다.
type mergeAPI struct {
	client *github.Client
	repo   string
}

func toMergeIssue(issue github.Issue) merge.Issue {
	return merge.Issue{ID: issue.ID, Number: issue.Number, Title: issue.Title, Body: issue.Body,
		Author: issue.User.Login, CreatedAt: issue.CreatedAt, Labels: issue.LabelNames()}
}

func (a mergeAPI) GetIssue(ctx context.Context, number int) (merge.Issue, error) {
	issue, err := a.client.GetIssue(ctx, a.repo, number)
	return toMergeIssue(issue), err
}

func (a mergeAPI) ListIssueComments(ctx context.Context, number int) ([]merge.Comment, error) {
	comments, err := a.client.ListIssueComments(ctx, a.repo, number)
	var converted []merge.Comment
	for _, comment := range comments {
		converted = append(converted, merge.Comment{ID: comment.ID, Body: comment.Body, Author: comment.Author, CreatedAt: comment.CreatedAt})
	}
	return converted, err
}

func (a mergeAPI) ListAllIssueAttachmentFiles(ctx context.Context, number int) ([]merge.Attachment, error) {
	files, err := a.client.ListAllIssueAttachmentFiles(ctx, a.repo, number)
	var converted []merge.Attachment
	for _, file := range files {
		converted = append(converted, merge.Attachment{Name: file.Name, Path: file.Path, Type: file.Type})
	}
	return converted, err
}

func (a mergeAPI) DownloadAttachment(ctx context.Context, attachment merge.Attachment) ([]byte, string, error) {
	data, err := a.client.DownloadAttachment(ctx, a.repo, attachment.Path)
	return data, attachment.Type, err
}

func (a mergeAPI) UploadAttachment(ctx context.Context, number int, name, contentType string, data []byte) (merge.Attachment, error) {
	file, err := a.client.UploadAttachment(ctx, a.repo, number, name, contentType, data, 0)
	return merge.Attachment{Name: file.Name, Path: file.Path, Type: file.Type}, err
}

func (a mergeAPI) CreateIssue(ctx context.Context, title, body string, labels []string) (merge.Issue, error) {
	issue, err := a.client.CreateIssue(ctx, a.repo, github.NoteInput{Title: title, Body: body, Labels: labels})
	return toMergeIssue(issue), err
}

func (a mergeAPI) UpdateIssue(ctx context.Context, number int, title, body string, labels []string) (merge.Issue, error) {
	issue, err := a.client.UpdateIssue(ctx, a.repo, number, github.NoteInput{Title: title, Body: body, Labels: labels})
	return toMergeIssue(issue), err
}

func (a mergeAPI) SetIssueState(ctx context.Context, number int, state string) error {
	_, err := a.client.SetIssueState(ctx, a.repo, number, state)
	return err
}

// mergeSelected는 고른 노트를 하나로 합친다. 원본은 휴지통으로 옮긴다.
func (m Model) mergeSelected() (tea.Model, tea.Cmd) {
	workspace, ok := m.activeWorkspace()
	selected := m.selectedIssues()
	if !ok || m.state != "open" || len(selected) < 2 {
		return m, nil
	}
	var numbers []int
	for _, issue := range selected {
		numbers = append(numbers, issue.Number)
	}
	next, toast := m.showToast("병합하는 중…")
	return next, tea.Batch(toast, func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return mergedMsg{err: err}
		}
		result, err := merge.MergeIssues(context.Background(), mergeAPI{client: client, repo: workspace.Repo}, workspace.Repo, numbers, merge.DefaultTitle)
		return mergedMsg{result: result, err: err}
	})
}

func (m Model) applyMerged(msg mergedMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		var mergeErr *merge.Error
		if errors.As(msg.err, &mergeErr) && mergeErr.DraftNumber != 0 {
			return m.showToast(fmt.Sprintf("병합하지 못했습니다(임시 노트 #%d). %s", mergeErr.DraftNumber, describeError(mergeErr.Err)))
		}
		return m.showToast("병합하지 못했습니다. " + describeError(msg.err))
	}
	m.clearSelection()
	closed := map[int64]bool{}
	for _, id := range msg.result.ClosedSourceIDs {
		closed[id] = true
	}
	var issues []github.Issue
	for _, issue := range m.issues {
		if !closed[issue.ID] {
			issues = append(issues, issue)
		}
	}
	m.issues = issues
	text := fmt.Sprintf("#%d 노트로 병합했습니다.", msg.result.Merged.Number)
	if len(msg.result.CloseFailures) > 0 {
		var numbers []string
		for _, number := range msg.result.CloseFailures {
			numbers = append(numbers, fmt.Sprintf("#%d", number))
		}
		text = "병합했지만 원본 " + strings.Join(numbers, ", ") + "을 휴지통으로 옮기지 못했습니다."
	}
	next, cmd := m.reload()
	next.restore = &Snapshot{OpenNumber: msg.result.Merged.Number}
	toast, toastCmd := next.showToast(text)
	return toast, tea.Batch(cmd, toastCmd)
}

// deleteAttachment는 첨부 목록에서 지운 파일을 저장소에서도 지운다(removeAttachment).
func (m Model) deleteAttachment(path string) (tea.Model, tea.Cmd) {
	workspace, ok := m.activeWorkspace()
	n := m.note
	if !ok || n == nil {
		return m, nil
	}
	var target github.Attachment
	for _, attachment := range n.attachments {
		if attachment.Path == path {
			target = attachment
		}
	}
	number := n.number()
	return m, func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return attachmentDeletedMsg{number: number, path: path, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		return attachmentDeletedMsg{number: number, path: path, err: client.DeleteAttachment(ctx, workspace.Repo, target)}
	}
}

func (m Model) applyAttachmentDeleted(msg attachmentDeletedMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		return m.showToast("첨부 파일을 삭제하지 못했습니다.")
	}
	n := m.note
	if n == nil || n.number() != msg.number {
		return m, nil
	}
	var kept []github.Attachment
	for _, attachment := range n.attachments {
		if attachment.Path != msg.path {
			kept = append(kept, attachment)
		}
	}
	n.attachments = kept
	// 본문에 직접 넣은 링크도 지운다(removeAttachmentLink).
	var links []string
	for _, link := range n.preservedLinks {
		if !strings.Contains(link, msg.path) {
			links = append(links, link)
		}
	}
	n.preservedLinks = links
	n.changed()
	n.dirty = true
	m.layoutNote()
	return m.saveNote(true)
}
