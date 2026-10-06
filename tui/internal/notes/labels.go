package notes

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// src/lib/issue-labels.js를 옮긴 것이다. 노트의 태그는 이름 목록([]string), 여러 노트는
// 노트마다의 이름 목록([][]string), 저장소 태그는 Label로 다룬다.

const tagDescriptionMaxLength = 100

// Label은 저장소 태그(GitHub 라벨)다.
type Label struct {
	ID          int64
	Name        string
	Color       string
	Description string
}

// localeLower는 toLocaleLowerCase()와 같다(어말 시그마, İ 등 특수 규칙 포함).
func localeLower(value string) string {
	return cases.Lower(language.Und).String(value)
}

func sameName(left, right string) bool {
	return localeLower(left) == localeLower(right)
}

// newCollator는 localeCompare(…, locale)에 쓰는 정렬 규칙이다. locale이 비었거나 읽을 수
// 없으면 한국어로 정렬한다.
func newCollator(locale string) *collate.Collator {
	tag := language.Korean
	if locale != "" {
		if parsed, err := language.Parse(locale); err == nil {
			tag = parsed
		}
	}
	return collate.New(tag)
}

// x/text의 CJK 문자 체계 순서는 브라우저 Intl.Collator와 다르다. 각 locale의
// 문자 체계 묶음만 먼저 맞추고, 묶음 안의 읽기순은 x/text에 맡긴다.
func compareLabelNames(collator *collate.Collator, locale, left, right string) int {
	if locale == "" || strings.HasPrefix(strings.ToLower(locale), "ko") || strings.HasPrefix(strings.ToLower(locale), "zh") {
		leftRank, rightRank := labelScriptRank(locale, left), labelScriptRank(locale, right)
		if leftRank != rightRank {
			return leftRank - rightRank
		}
		// 한국어 정렬에서는 같은 라틴 접두어 다음의 한글도 라틴 글자보다 앞선다.
		if locale == "" || strings.HasPrefix(strings.ToLower(locale), "ko") {
			lr, rr := []rune(left), []rune(right)
			for index := 0; index < len(lr) && index < len(rr); index++ {
				if unicode.ToLower(lr[index]) == unicode.ToLower(rr[index]) {
					continue
				}
				l, r := labelScriptRank(locale, string(lr[index])), labelScriptRank(locale, string(rr[index]))
				if l != r {
					return l - r
				}
				break
			}
		}
	}
	return collator.CompareString(left, right)
}

func labelScriptRank(locale, value string) int {
	r, _ := utf8.DecodeRuneInString(value)
	if !unicode.IsLetter(r) {
		return 0
	}
	if strings.HasPrefix(strings.ToLower(locale), "zh") {
		switch {
		case unicode.Is(unicode.Han, r):
			return 1
		case unicode.Is(unicode.Hangul, r):
			return 3
		default:
			return 2
		}
	}
	if unicode.Is(unicode.Hangul, r) || unicode.Is(unicode.Han, r) {
		return 1
	}
	return 2
}

// HasIssueLabel은 hasIssueLabel과 같다: 대소문자 구분 없이 태그가 붙었는지.
func HasIssueLabel(names []string, labelName string) bool {
	for _, name := range names {
		if sameName(name, labelName) {
			return true
		}
	}
	return false
}

// ReplaceIssueLabel은 replaceIssueLabel과 같다. nextName이 비었으면 태그를 떼고, 있으면 그
// 이름으로 바꾼다. 받은 슬라이스는 바꾸지 않는다.
func ReplaceIssueLabel(labels []Label, currentName, nextName string) []Label {
	next := make([]Label, 0, len(labels))
	for _, label := range labels {
		if sameName(label.Name, currentName) {
			if nextName == "" {
				continue
			}
			label.Name = nextName
		}
		next = append(next, label)
	}
	return next
}

// ReplaceLabelName은 replaceLabelName과 같은 규칙을 이름 목록에 적용한다.
func ReplaceLabelName(names []string, currentName, nextName string) []string {
	next := make([]string, 0, len(names))
	for _, name := range names {
		if sameName(name, currentName) {
			if nextName == "" {
				continue
			}
			name = nextName
		}
		next = append(next, name)
	}
	return next
}

// UniqueIssueLabelNames는 uniqueIssueLabelNames와 같다. 여러 노트의 태그를 대소문자 구분 없이
// 합치고(처음 나온 순서, 표기는 마지막 것), 고정 라벨과 빈 이름은 뺀다.
func UniqueIssueLabelNames(issues [][]string) []string {
	var keys []string
	names := map[string]string{}
	for _, labels := range issues {
		for _, label := range labels {
			if IsPinLabel(label) {
				continue
			}
			name := jsTrim(label)
			if name == "" {
				continue
			}
			key := localeLower(name)
			if _, seen := names[key]; !seen {
				keys = append(keys, key)
			}
			names[key] = name
		}
	}
	unique := make([]string, len(keys))
	for i, key := range keys {
		unique[i] = names[key]
	}
	return unique
}

// SortLabels는 sortLabels와 같다: 이름의 locale 순서로 정렬한 복사본.
func SortLabels(labels []Label, locale string) []Label {
	collator := newCollator(locale)
	sorted := append([]Label(nil), labels...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return compareLabelNames(collator, locale, sorted[i].Name, sorted[j].Name) < 0
	})
	return sorted
}

// MergeLabels는 mergeLabels와 같다. 대소문자만 다른 이름은 nextLabels 쪽 값으로 덮어쓰고 정렬한다.
func MergeLabels(currentLabels, nextLabels []Label, locale string) []Label {
	var keys []string
	byName := map[string]Label{}
	for _, list := range [][]Label{currentLabels, nextLabels} {
		for _, label := range list {
			key := localeLower(label.Name)
			if _, seen := byName[key]; !seen {
				keys = append(keys, key)
			}
			byName[key] = label
		}
	}
	merged := make([]Label, len(keys))
	for i, key := range keys {
		merged[i] = byName[key]
	}
	return SortLabels(merged, locale)
}

// CountIssueLabels는 countIssueLabels와 같다. 키는 소문자 태그 이름, 값은 붙은 노트 수다.
func CountIssueLabels(issues [][]string) map[string]int {
	counts := map[string]int{}
	for _, labels := range issues {
		for _, label := range labels {
			if IsPinLabel(label) {
				continue
			}
			counts[localeLower(label)]++
		}
	}
	return counts
}

// TagOption은 다중 선택 태그 패널의 항목이다. Count는 선택한 노트 중 그 태그가 붙은 수다.
type TagOption struct {
	Name  string
	Count int
}

// TagOptions는 tagOptions와 같다. 이미 붙은 태그를 먼저, 그다음 이름순으로 두고 검색어로 거른다.
func TagOptions(labels []Label, counts map[string]int, search, locale string) []TagOption {
	term := localeLower(strings.TrimLeft(jsTrim(search), "#"))
	options := []TagOption{}
	for _, label := range labels {
		if !strings.Contains(localeLower(label.Name), term) {
			continue
		}
		options = append(options, TagOption{Name: label.Name, Count: counts[localeLower(label.Name)]})
	}
	collator := newCollator(locale)
	sort.SliceStable(options, func(i, j int) bool {
		left, right := options[i].Count > 0, options[j].Count > 0
		if left != right {
			return left
		}
		return compareLabelNames(collator, locale, options[i].Name, options[j].Name) < 0
	})
	return options
}

// TagInput은 태그를 만들거나 고칠 때 받는 이름과 설명이다.
type TagInput struct {
	Name        string
	Description string
}

// LimitTagInput은 limitTagInput과 같다. GitHub 라벨 제한에 맞춰 앞뒤 공백을 빼고 이름 50자,
// 설명 100자(코드 포인트)로 자른다.
func LimitTagInput(tag TagInput) TagInput {
	return TagInput{
		Name:        takeRunes(jsTrim(tag.Name), tagNameMaxLength),
		Description: takeRunes(jsTrim(tag.Description), tagDescriptionMaxLength),
	}
}
