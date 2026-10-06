// Package merge는 여러 노트를 시간순 기록 하나로 합친다. src/lib/merge-notes.js(흐름)와
// note-merge.js(본문 조립)를 옮긴 것이다. GitHub 호출은 API 인터페이스로 받아 github
// 패키지에 의존하지 않는다.
package merge

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/zidell/ginote/tui/internal/notes"
)

// MaxIssueBodyLength는 github-limits.js의 MAX_ISSUE_BODY_LENGTH(GitHub 한도 65,536의 90%)다.
// 길이는 웹처럼 UTF-16 단위로 센다.
const MaxIssueBodyLength = 65536 * 9 / 10

// DefaultTitle은 가장 이른 노트에 제목이 없을 때 쓰는 제목이다(i18n ko의 dynamic.mergedNoteTitle).
const DefaultTitle = "병합 노트"

const (
	placeholderBody   = "> 병합 기록을 준비하는 중입니다."
	emptyEntryBody    = "_내용 없음_"
	unknownTimestamp  = "알 수 없는 시각"
	attachmentBranch  = "ginote-assets"
	defaultMediaType  = "application/octet-stream"
	closedState       = "closed"
	maxSafeIntegerMil = 1<<53 - 1
)

// Issue는 병합에 필요한 이슈 필드다. CreatedAt이 영값이면 시각을 모르는 것으로 본다.
type Issue struct {
	ID        int64
	Number    int
	Title     string
	Body      string
	Author    string // user.login
	CreatedAt time.Time
	Labels    []string
}

// Comment는 listIssueComments의 항목 중 병합에 쓰는 필드다.
type Comment struct {
	ID        int64
	Body      string
	Author    string
	CreatedAt time.Time
}

// Attachment는 listAllIssueAttachmentFiles·uploadAttachment의 항목이다.
type Attachment struct {
	Name string
	Path string
	Type string
}

// API는 병합이 쓰는 GitHub 호출이다. 한 저장소에 묶인 클라이언트를 넘긴다(github.js의 같은
// 이름 함수에 해당).
type API interface {
	GetIssue(ctx context.Context, number int) (Issue, error)
	ListIssueComments(ctx context.Context, number int) ([]Comment, error)
	// ListAllIssueAttachmentFiles는 하위 폴더(댓글 첨부)까지 포함한 이슈의 첨부 파일이다.
	ListAllIssueAttachmentFiles(ctx context.Context, number int) ([]Attachment, error)
	// DownloadAttachment는 파일 내용과 Content-Type(모르면 "")을 낸다.
	DownloadAttachment(ctx context.Context, attachment Attachment) (data []byte, contentType string, err error)
	// UploadAttachment는 이슈 number의 첨부로 올리고, 올린 파일(Path 포함)을 낸다.
	UploadAttachment(ctx context.Context, number int, name, contentType string, data []byte) (Attachment, error)
	CreateIssue(ctx context.Context, title, body string, labels []string) (Issue, error)
	UpdateIssue(ctx context.Context, number int, title, body string, labels []string) (Issue, error)
	SetIssueState(ctx context.Context, number int, state string) error
}

// Error는 병합 결과를 완성하지 못했을 때의 오류다(웹의 MergeError). DraftNumber는 휴지통으로
// 보낸 임시 이슈 번호이며, 임시 이슈를 만들기 전에 실패했으면 0이다. 원본 노트는 그대로다.
type Error struct {
	Err         error
	DraftNumber int
}

func (e *Error) Error() string { return e.Err.Error() }
func (e *Error) Unwrap() error { return e.Err }

// TooLongError는 합친 본문이 MaxIssueBodyLength를 넘을 때의 원인이다.
type TooLongError struct{ Limit int }

func (e *TooLongError) Error() string {
	return fmt.Sprintf("병합 기록이 노트 최대 길이(%d자)를 초과합니다.", e.Limit)
}

// Result는 병합 결과다. 원본을 닫는 일은 병합 노트를 완성한 뒤에 하므로, 일부를 닫지 못해도
// 병합은 끝난 것이다. ClosedSourceIDs는 닫은 원본의 ID(닫은 순서), CloseFailures는 닫지 못한
// 원본 번호다.
type Result struct {
	Merged          Issue
	ClosedSourceIDs []int64
	CloseFailures   []int
}

// Source는 최신 원본 이슈와 그 댓글·첨부다.
type Source struct {
	Issue
	Comments    []Comment
	Attachments []Attachment
}

// Entry는 병합 본문의 한 절(원본 본문 또는 댓글)이다.
type Entry struct {
	Comment     bool
	CreatedAt   time.Time
	Author      string
	Body        string
	IssueNumber int
	IssueTitle  string
}

// comparableDate는 Date.parse 결과를 밀리초로 낸다. 시각을 모르면 가장 뒤로 보낸다.
func comparableDate(value time.Time) int64 {
	if value.IsZero() {
		return maxSafeIntegerMil
	}
	return value.UnixMilli()
}

func compareInt64(left, right int64) int {
	switch {
	case left < right:
		return -1
	case left > right:
		return 1
	}
	return 0
}

// EarliestIssue는 earliestIssue와 같다: 가장 먼저 만든(같으면 번호가 작은) 이슈.
func EarliestIssue(sources []Source) (Source, bool) {
	if len(sources) == 0 {
		return Source{}, false
	}
	sorted := append([]Source(nil), sources...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if c := compareInt64(comparableDate(sorted[i].CreatedAt), comparableDate(sorted[j].CreatedAt)); c != 0 {
			return c < 0
		}
		return sorted[i].Number < sorted[j].Number
	})
	return sorted[0], true
}

// MergeTimeline은 mergeTimeline과 같다. 원본 본문과 댓글을 시각, 이슈 번호, 본문 먼저 순으로
// 섞는다.
func MergeTimeline(sources []Source) []Entry {
	var entries []Entry
	for _, source := range sources {
		entries = append(entries, Entry{
			CreatedAt:   source.CreatedAt,
			Author:      source.Author,
			Body:        source.Body,
			IssueNumber: source.Number,
			IssueTitle:  source.Title,
		})
		for _, comment := range source.Comments {
			entries = append(entries, Entry{
				Comment:     true,
				CreatedAt:   comment.CreatedAt,
				Author:      comment.Author,
				Body:        comment.Body,
				IssueNumber: source.Number,
				IssueTitle:  source.Title,
			})
		}
	}
	sort.SliceStable(entries, func(i, j int) bool {
		left, right := entries[i], entries[j]
		if c := compareInt64(comparableDate(left.CreatedAt), comparableDate(right.CreatedAt)); c != 0 {
			return c < 0
		}
		if left.IssueNumber != right.IssueNumber {
			return left.IssueNumber < right.IssueNumber
		}
		return !left.Comment && right.Comment
	})
	return entries
}

// FormatMergeTimestamp는 formatMergeTimestamp와 같다: time.Local 기준 "YYYY-MM-DD HH:MM:SS".
func FormatMergeTimestamp(value time.Time) string {
	if value.IsZero() {
		return unknownTimestamp
	}
	return value.In(time.Local).Format("2006-01-02 15:04:05")
}

// FormatMergedBody는 formatMergedBody와 같다. 절마다 원래 시각과 작성자를 헤딩으로 둔다.
func FormatMergedBody(entries []Entry) string {
	sections := make([]string, len(entries))
	for i, entry := range entries {
		content := strings.TrimFunc(entry.Body, isJSSpace)
		if content == "" {
			content = emptyEntryBody
		}
		author := ""
		if entry.Author != "" {
			author = " @" + entry.Author
		}
		sections[i] = fmt.Sprintf("## %s%s\n\n%s", FormatMergeTimestamp(entry.CreatedAt), author, content)
	}
	return strings.Join(sections, "\n\n")
}

// PathReplacement는 복사한 첨부의 원래 경로와 새 경로다.
type PathReplacement struct {
	From string
	To   string
}

// ReplaceAttachmentURLs는 replaceAttachmentUrls와 같다: 첨부의 raw URL만 순서대로 바꾼다.
func ReplaceAttachmentURLs(body, repo string, replacements []PathReplacement) string {
	for _, replacement := range replacements {
		body = strings.ReplaceAll(body, AttachmentRawURL(repo, replacement.From), AttachmentRawURL(repo, replacement.To))
	}
	return body
}

// AttachmentRawURL은 attachments.js의 attachmentRawUrl과 같다.
func AttachmentRawURL(repo, path string) string {
	return notes.AttachmentRawURL(repo, path)
}

// isJSSpace는 String.prototype.trim이 공백으로 보는 문자다.
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

func utf16Length(value string) int {
	length := 0
	for _, r := range value {
		length += utf16.RuneLen(r)
	}
	return length
}

func assertWithinLimit(body string) error {
	if utf16Length(body) > MaxIssueBodyLength {
		return &TooLongError{Limit: MaxIssueBodyLength}
	}
	return nil
}

func labelLists(sources []Source) [][]string {
	lists := make([][]string, len(sources))
	for i, source := range sources {
		lists[i] = source.Labels
	}
	return lists
}

// loadSources는 목록 항목 대신 본문·댓글·첨부의 최신 원본을 다시 읽는다. 원본은 바꾸지 않는다.
func loadSources(ctx context.Context, api API, numbers []int) ([]Source, error) {
	sources := make([]Source, 0, len(numbers))
	for _, number := range numbers {
		issue, err := api.GetIssue(ctx, number)
		if err != nil {
			return nil, err
		}
		comments, err := api.ListIssueComments(ctx, number)
		if err != nil {
			return nil, err
		}
		attachments, err := api.ListAllIssueAttachmentFiles(ctx, number)
		if err != nil {
			return nil, err
		}
		sources = append(sources, Source{Issue: issue, Comments: comments, Attachments: attachments})
	}
	return sources, nil
}

func copyAttachments(ctx context.Context, api API, sources []Source, targetNumber int) ([]PathReplacement, error) {
	var replacements []PathReplacement
	seen := map[string]int{}
	for _, source := range sources {
		for _, attachment := range source.Attachments {
			data, contentType, err := api.DownloadAttachment(ctx, attachment)
			if err != nil {
				return nil, err
			}
			if contentType == "" {
				contentType = attachment.Type
			}
			if contentType == "" {
				contentType = defaultMediaType
			}
			copied, err := api.UploadAttachment(ctx, targetNumber, attachment.Name, contentType, data)
			if err != nil {
				return nil, err
			}
			// 웹의 Map.set처럼 같은 경로는 처음 자리를 지키고 값만 바꾼다.
			if index, ok := seen[attachment.Path]; ok {
				replacements[index].To = copied.Path
				continue
			}
			seen[attachment.Path] = len(replacements)
			replacements = append(replacements, PathReplacement{From: attachment.Path, To: copied.Path})
		}
	}
	return replacements, nil
}

func withCopiedAttachmentURLs(sources []Source, repo string, replacements []PathReplacement) []Source {
	rewritten := make([]Source, len(sources))
	for i, source := range sources {
		source.Body = ReplaceAttachmentURLs(source.Body, repo, replacements)
		comments := make([]Comment, len(source.Comments))
		for j, comment := range source.Comments {
			comment.Body = ReplaceAttachmentURLs(comment.Body, repo, replacements)
			comments[j] = comment
		}
		source.Comments = comments
		rewritten[i] = source
	}
	return rewritten
}

// MergeIssues는 mergeIssues와 같다. numbers의 노트를 시간순 기록 하나로 합친 새 노트를 만들고
// 원본을 휴지통으로(닫힘) 보낸다. repo("owner/name")는 본문의 첨부 URL을 바꿀 때 쓴다.
// fallbackTitle이 비었으면 DefaultTitle을 쓴다.
//
// 새 노트가 완성되기 전에는 원본을 닫지 않으므로 어느 단계가 실패해도 원본 기록은 남는다.
// 그 경우 *Error를 내고, 임시 노트를 만들었다면 닫은 뒤 그 번호를 DraftNumber에 담는다.
func MergeIssues(ctx context.Context, api API, repo string, numbers []int, fallbackTitle string) (Result, error) {
	if fallbackTitle == "" {
		fallbackTitle = DefaultTitle
	}
	draftNumber := 0
	var merged Issue
	sources, err := func() ([]Source, error) {
		sources, err := loadSources(ctx, api, numbers)
		if err != nil {
			return nil, err
		}
		earliest, ok := EarliestIssue(sources)
		if !ok {
			return nil, errors.New("병합할 노트가 없습니다.")
		}
		title := earliest.Title
		if title == "" {
			title = fallbackTitle
		}
		labels := notes.UniqueIssueLabelNames(labelLists(sources))
		if err := assertWithinLimit(FormatMergedBody(MergeTimeline(sources))); err != nil {
			return nil, err
		}

		draft, err := api.CreateIssue(ctx, title, placeholderBody, labels)
		if err != nil {
			return nil, err
		}
		draftNumber = draft.Number
		replacements, err := copyAttachments(ctx, api, sources, draft.Number)
		if err != nil {
			return nil, err
		}
		body := FormatMergedBody(MergeTimeline(withCopiedAttachmentURLs(sources, repo, replacements)))
		if err := assertWithinLimit(body); err != nil {
			return nil, err
		}
		merged, err = api.UpdateIssue(ctx, draft.Number, title, body, labels)
		if err != nil {
			return nil, err
		}
		return sources, nil
	}()
	if err != nil {
		// 완성 전의 결과물은 휴지통으로 보낸다. 복사된 첨부는 그 이슈와 함께 휴지통 정리 정책에
		// 따라 지워진다. 닫지 못해도 원래 원인을 알린다(번호는 DraftNumber로 안내).
		if draftNumber != 0 {
			_ = api.SetIssueState(ctx, draftNumber, closedState)
		}
		return Result{}, &Error{Err: err, DraftNumber: draftNumber}
	}

	result := Result{Merged: merged, ClosedSourceIDs: []int64{}, CloseFailures: []int{}}
	closed := map[int64]bool{}
	for _, source := range sources {
		if err := api.SetIssueState(ctx, source.Number, closedState); err != nil {
			result.CloseFailures = append(result.CloseFailures, source.Number)
			continue
		}
		if !closed[source.ID] {
			closed[source.ID] = true
			result.ClosedSourceIDs = append(result.ClosedSourceIDs, source.ID)
		}
	}
	return result, nil
}
