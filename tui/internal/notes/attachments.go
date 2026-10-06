package notes

import (
	"net/url"
	"regexp"
	"strings"
)

// 첨부 링크 규약(src/lib/attachments.js, docs/ATTACHMENTS.md). 이미 저장된 노트를 다시 읽는
// 형식이므로 웹과 글자 하나까지 같아야 한다.

// AttachmentBranch는 첨부파일 전용 브랜치다(ATTACHMENT_BRANCH).
const AttachmentBranch = "ginote-assets"

const (
	ManagedAttachmentStart = "<!-- ginote:attachments:start -->"
	ManagedAttachmentEnd   = "<!-- ginote:attachments:end -->"
	// AttachmentLinkPlaceholder는 편집기에서 긴 첨부 주소 대신 보이는 접두사다.
	AttachmentLinkPlaceholder = "{repo}/"
)

var (
	imageName           = regexp.MustCompile(`(?i)\.(avif|gif|jpe?g|png|svg|webp)$`)
	rawAttachmentLink   = regexp.MustCompile(`!?\[(?:\\.|[^\]\n])*\]\(https://github\.com/[^/)\s]+/[^/)\s]+/raw/ginote-assets/([^)\s]+)\)`)
	managedBlock        = regexp.MustCompile(`(?:^|\n)<!-- ginote:attachments:start -->\s*[\s\S]*?\s*<!-- ginote:attachments:end -->`)
	edgeNewlines        = regexp.MustCompile(`^\n+|\n+$`)
	threeOrMoreNewlines = regexp.MustCompile(`\n{3,}`)
)

// EncodeURIComponent는 JS의 같은 이름 함수다.
func EncodeURIComponent(value string) string {
	const hexDigits = "0123456789ABCDEF"
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		c := value[index]
		if 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || '0' <= c && c <= '9' || strings.IndexByte("-_.!~*'()", c) >= 0 {
			builder.WriteByte(c)
			continue
		}
		builder.WriteByte('%')
		builder.WriteByte(hexDigits[c>>4])
		builder.WriteByte(hexDigits[c&15])
	}
	return builder.String()
}

func encodedPath(path string) string {
	segments := strings.Split(path, "/")
	for index, segment := range segments {
		segments[index] = EncodeURIComponent(segment)
	}
	return strings.Join(segments, "/")
}

// IsImageAttachment는 이미지 첨부인지다(이름의 확장자나 형식으로 본다).
func IsImageAttachment(name, contentType string) bool { return isImageAttachment(name, contentType) }

func isImageAttachment(name, contentType string) bool {
	return strings.HasPrefix(contentType, "image/") || imageName.MatchString(name)
}

// AttachmentRawURL은 첨부파일의 GitHub raw 주소다(attachmentRawUrl).
func AttachmentRawURL(repo, path string) string {
	return "https://github.com/" + repo + "/raw/" + AttachmentBranch + "/" + encodedPath(path)
}

// ComposeAttachmentLink는 본문에 넣는 첨부 링크다. 이미지는 ![](), 그 밖은 []()(composeAttachmentLink).
func ComposeAttachmentLink(repo, name, contentType, path string) string {
	link := "(" + AttachmentRawURL(repo, path) + ")"
	if isImageAttachment(name, contentType) {
		return "![]" + link
	}
	return "[]" + link
}

// ParseAttachmentPaths는 본문에 링크된 첨부 경로다(parseAttachmentPaths).
func ParseAttachmentPaths(body string) []string {
	var paths []string
	for _, match := range rawAttachmentLink.FindAllStringSubmatch(body, -1) {
		segments := strings.Split(match[1], "/")
		for index, segment := range segments {
			if decoded, err := url.PathUnescape(segment); err == nil {
				segments[index] = decoded
			}
		}
		paths = append(paths, strings.Join(segments, "/"))
	}
	return paths
}

// managedBlocks는 관리 블록을 찾는다. JS 정규식의 (?=\n|$) 뒤 조건은 RE2에 없어 직접 확인한다.
func managedBlocks(body string) [][]int {
	var blocks [][]int
	for _, match := range managedBlock.FindAllStringIndex(body, -1) {
		if match[1] == len(body) || body[match[1]] == '\n' {
			blocks = append(blocks, match)
		}
	}
	return blocks
}

// StripManagedAttachmentBlocks는 자동 관리 블록을 뺀 본문이다(stripManagedAttachmentBlocks).
func StripManagedAttachmentBlocks(body string) string {
	if !strings.Contains(body, ManagedAttachmentStart) {
		return body
	}
	var builder strings.Builder
	last := 0
	for _, block := range managedBlocks(body) {
		builder.WriteString(body[last:block[0]])
		last = block[1]
	}
	builder.WriteString(body[last:])
	text := edgeNewlines.ReplaceAllString(builder.String(), "")
	return threeOrMoreNewlines.ReplaceAllString(text, "\n\n")
}

// ManagedAttachmentLinks는 관리 블록 안의 링크다(managedAttachmentLinks).
func ManagedAttachmentLinks(body string) []string {
	var links []string
	for _, block := range managedBlocks(body) {
		links = append(links, rawAttachmentLink.FindAllString(body[block[0]:block[1]], -1)...)
	}
	return links
}

// WithManagedAttachmentBlock은 본문 맨 위에 관리 블록을 붙인다(withManagedAttachmentBlock).
func WithManagedAttachmentBlock(body string, links []string) string {
	clean := StripManagedAttachmentBlocks(body)
	if len(links) == 0 {
		return clean
	}
	block := strings.Join([]string{ManagedAttachmentStart, strings.Join(links, "\n\n"), ManagedAttachmentEnd}, "\n\n")
	if clean != "" {
		return block + "\n\n" + clean
	}
	return block
}

func attachmentURLPrefix(repo string) string {
	return "https://github.com/" + repo + "/raw/" + AttachmentBranch + "/"
}

// CompressAttachmentLinks는 편집기에 보일 본문이다(compressAttachmentLinks).
func CompressAttachmentLinks(body, repo string) string {
	if repo == "" {
		return body
	}
	return strings.ReplaceAll(body, attachmentURLPrefix(repo), AttachmentLinkPlaceholder)
}

// ExpandAttachmentLinks는 저장할 본문이다(expandAttachmentLinks).
func ExpandAttachmentLinks(body, repo string) string {
	if repo == "" {
		return body
	}
	return strings.ReplaceAll(body, AttachmentLinkPlaceholder, attachmentURLPrefix(repo))
}
