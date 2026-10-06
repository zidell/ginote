package voice

import (
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/zidell/ginote/tui/internal/notes"
)

// voice-notes.js의 제안 제목 최대 길이와 기본 제목이다.
const (
	suggestedTitleMaxLength = 50
	FallbackTitle           = "음성 기록"
)

// 노트 제목 방식(preferences.titleMode)이다.
const (
	TitleModeFirstLine = "first-line"
	TitleModeSeparate  = "separate"
)

var (
	lineBreaks        = regexp.MustCompile(`\r\n?`)
	newlineRuns       = regexp.MustCompile(`\n+`)
	threeOrMoreBreaks = regexp.MustCompile(`\n{3,}`)
	// VOICE_AUDIO_MARKUP(NoteEditor.svelte). \s는 JS 공백 목록으로 바꿨다.
	voiceAudioMarkup = regexp.MustCompile(`<audio[` + jsSpaceChars + `]+controls[` + jsSpaceChars + `]+preload="metadata"[` + jsSpaceChars + `]+src="([^"]+)"[^>]*>[\s\S]*?</audio>`)
)

// NormalizeParagraphs는 normalizeVoiceParagraphs다: 줄바꿈을 문단 단위로 맞추고 앞뒤 공백을 뺀다.
func NormalizeParagraphs(body string) string {
	return jsTrim(newlineRuns.ReplaceAllString(lineBreaks.ReplaceAllString(body, "\n"), "\n\n"))
}

// NormalizeSuggestedTitle은 normalizeSuggestedTitle이다: 한 줄로 합치고 50자(UTF-16 단위)까지.
func NormalizeSuggestedTitle(title string) string {
	return sliceUTF16(collapseSpaces(title), suggestedTitleMaxLength)
}

// KnownTagNames는 knownTagNames다. 정제 모델이 고른 태그 중 저장소에 실제로 있는 것만 남긴다.
// 이름은 고른 쪽의 표기를 그대로 둔다.
func KnownTagNames(selected, labelNames []string) []string {
	known := []string{}
	for _, name := range selected {
		key := localeLower(name)
		for _, label := range labelNames {
			if localeLower(label) == key {
				known = append(known, name)
				break
			}
		}
	}
	return known
}

// ComposeIssue는 composeVoiceIssue다. 음성으로 새 노트를 만들 때의 제목과 본문이며, 첫 줄
// 제목 방식이면 제안 제목을 본문 첫 줄로 넣는다.
func ComposeIssue(titleMode, body, suggestedTitle string) (title, issueBody string) {
	issueBody = body
	if titleMode == TitleModeFirstLine && body != "" && suggestedTitle != "" {
		issueBody = suggestedTitle + "\n\n" + body
	}
	if titleMode == TitleModeSeparate {
		title = suggestedTitle
		if title == "" {
			title = notes.AutomaticTitle(body)
		}
	} else {
		title = notes.AutomaticTitle(issueBody)
	}
	if title == "" {
		title = FallbackTitle
	}
	return title, issueBody
}

// AudioFile은 voiceAudioFile이 만드는 첨부 파일의 이름과 형식이다. 이름은 녹음 시각(UTC)과
// 녹음 형식의 확장자로 만들고, 형식이 비면 audio/webm으로 둔다.
func AudioFile(contentType string, now time.Time) (name, fileType string) {
	stamp := now.UTC().Format("2006-01-02T15-04-05.000Z")
	name = "voice-" + strings.ReplaceAll(stamp, ".", "-") + "." + RecordingExtension(contentType)
	fileType = contentType
	if fileType == "" {
		fileType = "audio/webm"
	}
	return name, fileType
}

// AttachmentLink는 voiceAttachmentLink다. 원본 음성 첨부의 재생 태그이며, 첨부가 없으면(경로가
// 비면) 빈 문자열이다.
func AttachmentLink(repo, path string) string {
	if path == "" {
		return ""
	}
	link := notes.AttachmentRawURL(repo, path)
	return `<audio controls preload="metadata" src="` + link + `"><a href="` + link + `">🎙 원본 음성 다운로드</a></audio>`
}

// AppendAttachmentLink는 appendVoiceAttachmentLink다. 첨부가 있을 때만 재생 태그를 붙인다.
func AppendAttachmentLink(body, repo, path string) string {
	if link := AttachmentLink(repo, path); link != "" {
		return body + "\n\n" + link
	}
	return body
}

// AppendText는 appendVoiceText(NoteEditor.svelte)다. 기존 본문 끝 공백을 빼고 빈 줄 하나를
// 사이에 두어 전사문을 붙인다.
func AppendText(source, transcript string) string {
	value := jsTrimEnd(source)
	text := jsTrim(transcript)
	if value != "" {
		return value + "\n\n" + text
	}
	return text
}

// AudioMarkup은 voiceAudioMarkup(NoteEditor.svelte)이다. 댓글의 음성 재생 태그를 빈 줄로 잇는다.
func AudioMarkup(value string) string {
	return strings.Join(voiceAudioMarkup.FindAllString(value, -1), "\n\n")
}

// CommentTextForEditing은 commentTextForEditing(NoteEditor.svelte)이다. 편집기에 보일 댓글
// 본문으로, 음성 재생 태그를 뺀다.
func CommentTextForEditing(value string) string {
	return jsTrimEnd(threeOrMoreBreaks.ReplaceAllString(voiceAudioMarkup.ReplaceAllString(value, ""), "\n\n"))
}

// CommentAudioSources는 commentAudioSources(NoteEditor.svelte)다. 댓글 음성 태그의 src 주소들이다.
func CommentAudioSources(value string) []string {
	sources := []string{}
	for _, match := range voiceAudioMarkup.FindAllStringSubmatch(value, -1) {
		sources = append(sources, match[1])
	}
	return sources
}

// AttachmentPathFromRawURL은 attachmentPathFromRawUrl(NoteEditor.svelte)이다. 첨부 raw 주소의
// 저장소 안 경로이며, 첨부 주소가 아니면 빈 문자열이다. JS는 잘못된 %-인코딩에서 예외를 던지지만
// 여기서는 빈 문자열을 돌려준다.
func AttachmentPathFromRawURL(rawURL string) string {
	marker := "/raw/" + notes.AttachmentBranch + "/"
	index := strings.Index(rawURL, marker)
	if index < 0 {
		return ""
	}
	segments := strings.Split(rawURL[index+len(marker):], "/")
	for index, segment := range segments {
		decoded, err := url.PathUnescape(segment)
		if err != nil {
			return ""
		}
		segments[index] = decoded
	}
	return strings.Join(segments, "/")
}

// CommentBodyFromEditing은 updateCommentBody(NoteEditor.svelte)의 본문 조립이다. 편집한 글
// (첨부 주소를 펼친 값) 뒤에 기존 댓글의 음성 태그를 다시 붙인다.
func CommentBodyFromEditing(commentBody, edited string) string {
	markup := AudioMarkup(commentBody)
	if markup == "" {
		return edited
	}
	if jsTrimEnd(edited) != "" {
		return edited + "\n\n" + markup
	}
	return edited + markup
}

// AppendToComment는 기존 댓글에 음성을 덧붙일 때(voiceCommentEdit, NoteEditor.svelte)의 새
// 댓글 본문이다. 글 부분 끝에 전사문을 붙이고, 기존 음성 태그와 새 음성 태그(attachmentLink,
// 없으면 빈 문자열)를 그 뒤에 둔다.
func AppendToComment(commentBody, transcript, attachmentLink string) string {
	nextBody := AppendText(CommentTextForEditing(commentBody), transcript)
	existing := AudioMarkup(commentBody)
	if attachmentLink != "" {
		separator := ""
		if existing != "" {
			separator = "\n\n"
		}
		return jsTrimEnd(nextBody) + separator + existing + separator + attachmentLink
	}
	if existing != "" {
		return nextBody + "\n\n" + existing
	}
	return nextBody
}
