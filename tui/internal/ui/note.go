package ui

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"charm.land/bubbles/v2/textarea"
	"charm.land/bubbles/v2/textinput"
	"charm.land/lipgloss/v2"

	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/notes"
)

// lockState는 NoteEditor.svelte의 lockState다.
const (
	lockPlain    = "plain"    // 잠금 없음
	lockLocked   = "locked"   // 잠겨 있고 아직 못 엶
	lockUnlocked = "unlocked" // 잠금 숫자로 열어 본문을 보는 중
)

// noteState는 열린 노트 하나다(NoteEditor.svelte의 상태).
type noteState struct {
	issue   github.Issue // 마지막으로 받은 원격 이슈. 새 노트는 번호가 생기기 전까지 0
	pending bool         // 새 노트의 번호를 받는 중(allocatePendingIssue)
	repo    string

	// preservedLinks는 본문 맨 위 관리 블록에 있던 첨부 링크다. 편집기에는 보이지 않고
	// 저장할 때 다시 붙인다(preservedManagedAttachmentLinks).
	preservedLinks []string

	title  textinput.Model
	body   textarea.Model
	labels []string

	dirty         bool
	revision      int
	saving        bool
	saveFailed    bool
	savedFlash    bool
	lastSignature string
	err           string

	lock          string
	encryptedBody string

	preview bool

	comments        []commentState
	commentsLoading bool
	commentFocus    int // focusComment일 때 편집 중인 댓글 위치

	attachments       []github.Attachment
	attachmentsLoaded bool
}

type commentState struct {
	comment        github.Comment
	editor         textarea.Model
	preservedLinks []string
	isNew          bool
	saving         bool
	failed         bool
}

func newEditorArea(placeholder string) textarea.Model {
	area := textarea.New()
	area.ShowLineNumbers = false
	area.Prompt = ""
	area.Placeholder = placeholder
	area.DynamicHeight = true
	area.MinHeight = 1
	area.MaxHeight = 0
	area.CharLimit = 65536
	area.SetVirtualCursor(false)
	styles := area.Styles()
	styles.Focused.CursorLine = lipgloss.NewStyle()
	styles.Focused.Base = lipgloss.NewStyle()
	styles.Blurred.Base = lipgloss.NewStyle()
	area.SetStyles(styles)
	area.KeyMap.InsertNewline.SetEnabled(true)
	return area
}

func newNoteState(issue github.Issue, titleMode, repo string) *noteState {
	title := textinput.New()
	title.Prompt = ""
	title.Placeholder = "제목"
	title.CharLimit = 256
	title.SetVirtualCursor(false)

	placeholder := "첫 줄이 제목이 됩니다…"
	if titleMode == config.TitleSeparate {
		placeholder = "내용을 입력하세요…"
	}
	n := &noteState{issue: issue, repo: repo, title: title, body: newEditorArea(placeholder), lock: lockPlain}
	n.load(issue)
	return n
}

// load는 원격 이슈 내용을 편집기에 넣는다(applyRemoteIssue).
func (n *noteState) load(issue github.Issue) {
	n.issue = issue
	n.labels = notes.VisibleLabelNames(issue.LabelNames())
	n.title.SetValue(notes.RemoveLockFromTitle(issue.Title))
	n.err = ""
	if notes.IsLockedTitle(issue.Title) || notes.IsLockedPayload(issue.Body) {
		n.lock = lockLocked
		n.encryptedBody = issue.Body
		n.body.SetValue("")
	} else {
		n.lock = lockPlain
		n.encryptedBody = ""
		n.setPlainBody(issue.Body)
	}
	n.dirty = false
	n.lastSignature = n.signature()
}

// setPlainBody는 GitHub 본문을 편집기에 넣는다. 관리 블록은 떼어 두고 첨부 주소는
// {repo}/로 줄여 보인다(applyRemoteIssue, displayBody).
func (n *noteState) setPlainBody(body string) {
	n.preservedLinks = notes.ManagedAttachmentLinks(body)
	n.body.SetValue(notes.CompressAttachmentLinks(notes.StripManagedAttachmentBlocks(body), n.repo))
}

// bodyText는 편집기 내용을 완전한 주소로 되돌린 본문이다(관리 블록 없음).
func (n *noteState) bodyText() string {
	return notes.ExpandAttachmentLinks(strings.TrimSpace(n.body.Value()), n.repo)
}

// remoteBody는 GitHub에 저장할 본문이다(noteForRemote의 bodyWithManagedAttachmentLinks).
// 본문이나 댓글에 직접 링크하지 않은 첨부는 맨 위 관리 블록으로 연결한다.
func (n *noteState) remoteBody() string {
	clean := notes.StripManagedAttachmentBlocks(n.bodyText())
	if !n.attachmentsLoaded {
		return notes.WithManagedAttachmentBlock(clean, n.preservedLinks)
	}
	linked := map[string]bool{}
	for _, path := range notes.ParseAttachmentPaths(clean) {
		linked[path] = true
	}
	for _, comment := range n.comments {
		for _, path := range notes.ParseAttachmentPaths(comment.comment.Body) {
			linked[path] = true
		}
		for _, link := range comment.preservedLinks {
			for _, path := range notes.ParseAttachmentPaths(link) {
				linked[path] = true
			}
		}
	}
	var links []string
	for _, attachment := range n.attachments {
		if !linked[attachment.Path] {
			links = append(links, notes.ComposeAttachmentLink(n.repo, attachment.Name, attachment.Type, attachment.Path))
		}
	}
	return notes.WithManagedAttachmentBlock(clean, links)
}

func (n *noteState) number() int { return n.issue.Number }

var attachmentUUIDPrefix = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-`)

// inferAttachment는 저장 파일 이름에서 UUID를 떼고 확장자로 종류를 정한다
// (inferredAttachmentName, inferredAttachmentType).
func inferAttachment(file github.Attachment) github.Attachment {
	file.Name = attachmentUUIDPrefix.ReplaceAllString(file.Name, "")
	extension := strings.ToLower(file.Name[strings.LastIndex(file.Name, ".")+1:])
	types := map[string]string{"avif": "image/avif", "gif": "image/gif", "jpeg": "image/jpeg", "jpg": "image/jpeg",
		"png": "image/png", "svg": "image/svg+xml", "webp": "image/webp"}
	file.Type = types[extension]
	if file.Type == "" {
		file.Type = "application/octet-stream"
	}
	return file
}

// reconcileAttachments는 노트 폴더의 파일을 첨부 목록으로 맞춘다(reconcileIssueAttachments).
// 본문에 링크된 것을 먼저, 링크가 없는 파일(고아 첨부)은 뒤에 둔다. 목록을 받은 뒤에는
// 관리 블록을 이 목록으로 다시 만든다.
func (n *noteState) reconcileAttachments(files []github.Attachment) {
	byPath := map[string]github.Attachment{}
	for _, file := range files {
		byPath[file.Path] = file
	}
	connected := map[string]bool{}
	var linked, orphaned []github.Attachment
	for _, path := range notes.ParseAttachmentPaths(n.bodyText()) {
		if file, ok := byPath[path]; ok && !connected[path] {
			connected[path] = true
			linked = append(linked, inferAttachment(file))
		}
	}
	for _, file := range files {
		if !connected[file.Path] {
			orphaned = append(orphaned, inferAttachment(file))
		}
	}
	n.attachments = append(linked, orphaned...)
	n.attachmentsLoaded = true
	n.preservedLinks = nil
}

// currentTitle은 저장할 제목이다(currentNote). 첫 줄 방식이면 본문 첫 줄 50자다.
func (n *noteState) currentTitle(titleMode string) string {
	if n.lock == lockLocked {
		return strings.TrimSpace(n.title.Value())
	}
	if titleMode == config.TitleFirstLine {
		title := notes.AutomaticTitle(n.bodyText())
		if title == "" && len(n.attachments) > 0 {
			title = "첨부 노트"
		}
		return title
	}
	return strings.TrimSpace(n.title.Value())
}

func (n *noteState) signature() string {
	data, _ := json.Marshal([]any{n.title.Value(), strings.TrimSpace(n.body.Value()), n.labels})
	return string(data)
}

// changed는 편집 뒤 부른다. 서명이 같으면(되돌린 경우) 저장하지 않는다.
func (n *noteState) changed() {
	n.revision++
	n.dirty = n.signature() != n.lastSignature
	n.savedFlash = false
}

func (n *noteState) relock() {
	if n.lock == lockUnlocked && !n.dirty {
		n.lock = lockLocked
		n.body.SetValue("")
	}
}

func (n *noteState) editable(archived bool) bool {
	return !archived && n.lock != lockLocked
}

func (n *noteState) hasLabel(name string) bool {
	for _, label := range n.labels {
		if strings.EqualFold(label, name) {
			return true
		}
	}
	return false
}

func (n *noteState) toggleLabel(name string) {
	for index, label := range n.labels {
		if strings.EqualFold(label, name) {
			n.labels = append(n.labels[:index:index], n.labels[index+1:]...)
			n.changed()
			return
		}
	}
	n.labels = append(n.labels, name)
	n.changed()
}

// statusText는 툴바의 저장 상태다(save-status).
func (n *noteState) statusText() string {
	switch {
	case n.saving:
		return "⠋ 저장 중"
	case n.saveFailed:
		return "저장 실패"
	case n.pending:
		return "⠋ 준비 중"
	case n.dirty:
		return "수정됨"
	case n.savedFlash:
		return "✓ 저장됨"
	}
	return ""
}

func nowFunc() time.Time { return time.Now() }

// listDate는 목록 행의 시각이다(Intl, ko: "9월 4일 오후 06:12").
func listDate(issue github.Issue) string {
	value := issue.UpdatedAt
	if value.IsZero() {
		value = issue.CreatedAt
	}
	if value.IsZero() {
		return ""
	}
	local := value.Local()
	return local.Format("1월 2일 ") + koreanClock(local)
}

func koreanClock(value time.Time) string {
	period := "오전"
	hour := value.Hour()
	if hour >= 12 {
		period = "오후"
	}
	hour %= 12
	if hour == 0 {
		hour = 12
	}
	return fmt.Sprintf("%s %02d:%02d", period, hour, value.Minute())
}

// dateTime은 댓글 시각이다(formatDateTime: 2026-09-04 06:40).
func dateTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Local().Format("2006-01-02 15:04")
}

// dateOnly는 툴바의 날짜다(formatDateOnly: 2026-09-04).
func dateOnly(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Local().Format("2006-01-02")
}

// timestamp는 더보기 메뉴의 생성·수정 시각이다(formatTimestamp: 2026년 9월 4일 오전 06:40).
func timestamp(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	local := value.Local()
	return local.Format("2006년 1월 2일 ") + koreanClock(local)
}
