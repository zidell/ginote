// Package notes는 웹 앱의 순수 계산 함수(src/lib/notes.js, colors.js, pin-label.js,
// note-lock.js의 제목 부분)를 옮긴 것이다. 결과가 웹과 같아야 하므로 고칠 때는 원본과 함께
// 고치고, 테스트의 기대값은 원본 JS 함수가 내는 값으로 둔다.
package notes

import (
	"fmt"
	"math"
	"regexp"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// PinLabelName은 고정 노트에 붙는 라벨이다(src/lib/pin-label.js).
const PinLabelName = "ginote:pin"

const lockPrefix = "🔒"

type plainRule struct {
	pattern *regexp.Regexp
	replace string
}

// markdownToPlainText(src/lib/notes.js)의 치환 순서를 그대로 따른다.
var plainRules = []plainRule{
	{regexp.MustCompile("```[^\\n]*\\n?"), ""},
	{regexp.MustCompile("~~~[^\\n]*\\n?"), ""},
	{regexp.MustCompile(`!\[([^\]]*)\]\([^)]*\)`), "$1"},
	{regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`), "$1"},
	{regexp.MustCompile(`(?m)^\s*\[[^\]]+\]:\s+\S+.*$`), ""},
	{regexp.MustCompile(`<[^>]+>`), ""},
	{regexp.MustCompile(`(?m)^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)`), ""},
	{regexp.MustCompile(`(?m)^\s*[-*_]{3,}\s*$`), ""},
	{regexp.MustCompile(`\[([ xX])\]\s*`), ""},
	{regexp.MustCompile("`([^`]*)`"), "$1"},
	{regexp.MustCompile(`[*~_]`), ""},
	{regexp.MustCompile("\\\\([\\\\`*{}\\[\\]()#+\\-.!_>])"), "$1"},
	{regexp.MustCompile(`\s+`), " "},
}

func MarkdownToPlainText(value string) string {
	for _, rule := range plainRules {
		value = rule.pattern.ReplaceAllString(value, rule.replace)
	}
	return strings.TrimSpace(value)
}

// Excerpt는 목록 행의 요약이다. 본문이 제목으로 시작하면 제목 부분을 뺀다(NoteListRow.svelte).
func Excerpt(body, title string) string {
	plainBody := MarkdownToPlainText(body)
	plainTitle := MarkdownToPlainText(title)
	if plainTitle != "" && strings.HasPrefix(plainBody, plainTitle) {
		return strings.TrimLeft(plainBody[len(plainTitle):], " \t\r\n")
	}
	return plainBody
}

func IsLockedTitle(title string) bool {
	return strings.HasPrefix(title, lockPrefix)
}

var lockTitlePrefix = regexp.MustCompile(`^🔒\s*`)

func RemoveLockFromTitle(title string) string {
	return lockTitlePrefix.ReplaceAllString(title, "")
}

func IsPinLabel(name string) bool {
	return strings.ToLower(name) == PinLabelName
}

// VisibleLabelNames는 고정 라벨을 뺀 태그 이름이다.
func VisibleLabelNames(names []string) []string {
	visible := make([]string, 0, len(names))
	for _, name := range names {
		if !IsPinLabel(name) {
			visible = append(visible, name)
		}
	}
	return visible
}

// TagColor는 tagColorForName(src/lib/colors.js)과 같은 "rrggbb"를 낸다.
func TagColor(name string) string {
	var hash uint32
	for _, character := range norm.NFC.String(name) {
		hash = hash*31 + uint32(character)
	}
	return hslToHex(float64(hash%360), 64, 58)
}

func hslToHex(hue, saturation, lightness float64) string {
	saturationRatio := saturation / 100
	lightnessRatio := lightness / 100
	chroma := (1 - math.Abs(2*lightnessRatio-1)) * saturationRatio
	section := hue / 60
	secondary := chroma * (1 - math.Abs(math.Mod(section, 2)-1))
	var red, green, blue float64
	switch {
	case section < 1:
		red, green, blue = chroma, secondary, 0
	case section < 2:
		red, green, blue = secondary, chroma, 0
	case section < 3:
		red, green, blue = 0, chroma, secondary
	case section < 4:
		red, green, blue = 0, secondary, chroma
	case section < 5:
		red, green, blue = secondary, 0, chroma
	default:
		red, green, blue = chroma, 0, secondary
	}
	offset := lightnessRatio - chroma/2
	channel := func(value float64) int { return int(math.Floor((value+offset)*255 + 0.5)) }
	return fmt.Sprintf("%02x%02x%02x", channel(red), channel(green), channel(blue))
}
