package notes

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// 자동 제목·첫 줄 미리보기·태그 이름의 최대 길이(코드 포인트)다(src/lib/notes.js의 기본값).
const (
	titleMaxLength   = 50
	previewMaxLength = 50
	tagNameMaxLength = 50
)

// jsSpaceChars는 JS 정규식 \s와 String.prototype.trim이 공백으로 보는 문자다.
// Go 정규식의 \s는 ASCII 공백만 보므로 웹과 같은 결과를 내려면 이 목록을 쓴다.
const jsSpaceChars = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// jsTrim은 String.prototype.trim과 같다.
func jsTrim(value string) string {
	return strings.TrimFunc(value, isJSSpace)
}

// firstLine은 String(value).split(/\r?\n/, 1)[0]과 같다.
func firstLine(value string) string {
	index := strings.IndexByte(value, '\n')
	if index < 0 {
		return value
	}
	return strings.TrimSuffix(value[:index], "\r")
}

// takeRunes는 Array.from(value).slice(0, n).join(”)처럼 코드 포인트 단위로 자른다.
func takeRunes(value string, n int) string {
	count := 0
	for index := range value {
		if count == n {
			return value[:index]
		}
		count++
	}
	return value
}

// AutomaticTitle은 automaticTitle(src/lib/notes.js)과 같다: 첫 줄의 앞뒤 공백을 빼고 50자까지.
func AutomaticTitle(value string) string {
	return takeRunes(jsTrim(firstLine(value)), titleMaxLength)
}

// Link는 linkAtCursor가 돌려주는 링크다. Start·End는 rune 단위 위치다.
type Link struct {
	URL   string
	Start int
	End   int
}

var (
	// JS 원본의 (?<!!) 뒤돌아보기는 RE2에 없으므로 LinkAtCursor에서 따로 거른다.
	markdownLinkPattern = regexp.MustCompile(`(?i)\[[^\]\n]*\]\([` + jsSpaceChars + `]*(https?://[^` + jsSpaceChars + `)]+)(?:[` + jsSpaceChars + `]+["'][^"']*["'])?[` + jsSpaceChars + `]*\)`)
	plainLinkPattern    = regexp.MustCompile("(?i)https?://[^" + jsSpaceChars + "<>\"'`]+")
)

// LinkAtCursor는 linkAtCursor(src/lib/notes.js)와 같다. 커서 위치(cursor)와 결과의 Start·End는
// rune 단위다(웹은 UTF-16 단위라 BMP 밖 문자가 앞에 있으면 값이 다르다). 링크가 없으면 false다.
func LinkAtCursor(value string, cursor int) (Link, bool) {
	runePos := func(byteIndex int) int { return utf8.RuneCountInString(value[:byteIndex]) }
	if cursor < 0 || cursor > utf8.RuneCountInString(value) {
		return Link{}, false
	}

	for offset := 0; offset < len(value); {
		loc := markdownLinkPattern.FindStringSubmatchIndex(value[offset:])
		if loc == nil {
			break
		}
		start, end := offset+loc[0], offset+loc[1]
		if start > 0 && value[start-1] == '!' {
			// 이미지 문법이다. JS처럼 바로 다음 위치부터 다시 찾는다.
			offset = start + 1
			continue
		}
		startRune, endRune := runePos(start), runePos(end)
		if cursor >= startRune && cursor <= endRune {
			return Link{URL: value[offset+loc[2] : offset+loc[3]], Start: startRune, End: endRune}, true
		}
		offset = end
	}

	for _, loc := range plainLinkPattern.FindAllStringIndex(value, -1) {
		url := strings.TrimRight(value[loc[0]:loc[1]], "].,;:!?)}")
		startRune := runePos(loc[0])
		endRune := startRune + utf8.RuneCountInString(url)
		if cursor >= startRune && cursor <= endRune {
			return Link{URL: url, Start: startRune, End: endRune}, true
		}
	}
	return Link{}, false
}

// ShortenMiddle은 shortenMiddle(src/lib/notes.js)과 같다(웹 기본값은 maxLength 64).
func ShortenMiddle(value string, maxLength int) string {
	characters := []rune(value)
	if len(characters) <= maxLength {
		return value
	}
	available := max(2, maxLength-1)
	leading := min((available+1)/2, len(characters))
	trailing := min(available/2, len(characters))
	return string(characters[:leading]) + "…" + string(characters[len(characters)-trailing:])
}

// FirstLinePreview는 firstLinePreview(src/lib/notes.js)와 같다: 첫 줄을 일반 텍스트로 50자까지.
func FirstLinePreview(value string) string {
	return takeRunes(MarkdownToPlainText(firstLine(value)), previewMaxLength)
}

var jsSpaceRun = regexp.MustCompile(`[` + jsSpaceChars + `]+`)

// NormalizeTagName은 normalizeTagName(src/lib/notes.js)과 같다.
func NormalizeTagName(value string) string {
	name := strings.TrimLeft(jsTrim(value), "#")
	return takeRunes(jsSpaceRun.ReplaceAllString(name, "-"), tagNameMaxLength)
}
