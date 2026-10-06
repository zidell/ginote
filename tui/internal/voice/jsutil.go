package voice

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

// jsSpaceChars는 JS 정규식 \s와 String.prototype.trim이 공백으로 보는 문자다.
// Go 정규식의 \s는 ASCII 공백만 보므로 웹과 같은 결과를 내려면 이 목록을 쓴다.
const jsSpaceChars = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

var jsWhitespaceRun = regexp.MustCompile(`[` + jsSpaceChars + `]+`)

func isJSWhitespace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// jsTrim은 String.prototype.trim과 같다.
func jsTrim(value string) string { return strings.TrimFunc(value, isJSWhitespace) }

// jsTrimEnd는 String.prototype.trimEnd와 같다.
func jsTrimEnd(value string) string { return strings.TrimRightFunc(value, isJSWhitespace) }

// collapseSpaces는 value.replace(/\s+/g, ' ').trim()이다.
func collapseSpaces(value string) string {
	return jsTrim(jsWhitespaceRun.ReplaceAllString(value, " "))
}

// sliceUTF16은 String.prototype.slice(0, n)처럼 UTF-16 코드 단위로 앞에서 n개를 남긴다.
// JS는 서로게이트 쌍 가운데서 자르면 홀로 남은 상위 서로게이트를 남기지만, Go 문자열은 이를
// 담을 수 없어 그 문자를 통째로 뺀다.
func sliceUTF16(value string, n int) string {
	units := 0
	for index, r := range value {
		width := utf16.RuneLen(r)
		if width < 0 {
			width = 1
		}
		if units+width > n {
			return value[:index]
		}
		units += width
	}
	return value
}

// localeLower는 toLocaleLowerCase()와 같다(어말 시그마, İ 등 특수 규칙 포함).
func localeLower(value string) string {
	return cases.Lower(language.Und).String(value)
}

// jsonString은 JSON.stringify(문자열)과 같은 글자를 낸다. encoding/json과 달리 <, >, &,
// U+2028, U+2029를 이스케이프하지 않는다.
func jsonString(value string) string {
	const hexDigits = "0123456789abcdef"
	var builder strings.Builder
	builder.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"':
			builder.WriteString(`\"`)
		case '\\':
			builder.WriteString(`\\`)
		case '\b':
			builder.WriteString(`\b`)
		case '\f':
			builder.WriteString(`\f`)
		case '\n':
			builder.WriteString(`\n`)
		case '\r':
			builder.WriteString(`\r`)
		case '\t':
			builder.WriteString(`\t`)
		default:
			if r < 0x20 {
				builder.WriteString(`\u00`)
				builder.WriteByte(hexDigits[r>>4])
				builder.WriteByte(hexDigits[r&15])
			} else {
				builder.WriteRune(r)
			}
		}
	}
	builder.WriteByte('"')
	return builder.String()
}

// jsString은 JSON에서 읽은 값에 String(value)를 적용한 결과다.
func jsString(value any) string {
	switch typed := value.(type) {
	case nil:
		return "null"
	case string:
		return typed
	case bool:
		return strconv.FormatBool(typed)
	case float64:
		return jsNumber(typed)
	case []any:
		parts := make([]string, len(typed))
		for index, item := range typed {
			if item != nil {
				parts[index] = jsString(item)
			}
		}
		return strings.Join(parts, ",")
	default:
		return "[object Object]"
	}
}

// jsNumber는 Number.prototype.toString()이다.
func jsNumber(value float64) string {
	switch {
	case math.IsNaN(value):
		return "NaN"
	case math.IsInf(value, 1):
		return "Infinity"
	case math.IsInf(value, -1):
		return "-Infinity"
	case value == 0:
		return "0"
	}
	if magnitude := math.Abs(value); magnitude >= 1e-6 && magnitude < 1e21 {
		return strconv.FormatFloat(value, 'f', -1, 64)
	}
	text := strconv.FormatFloat(value, 'e', -1, 64)
	mantissa, exponent, _ := strings.Cut(text, "e")
	exponent = strings.TrimLeft(exponent[1:], "0")
	if text[strings.IndexByte(text, 'e')+1] == '-' {
		return mantissa + "e-" + exponent
	}
	return mantissa + "e+" + exponent
}

// jsTruthy는 JSON에서 읽은 값이 JS에서 참으로 평가되는지다.
func jsTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case string:
		return typed != ""
	case bool:
		return typed
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	default:
		return true
	}
}
