package notes

import (
	"maps"
	"reflect"
	"slices"
	"strings"
	"testing"
)

// 기대값은 src/lib/issue-labels.js를 node로 실행해 얻은 값이다(issue-labels.test.js의 사례 포함).
func labelsNamed(names ...string) []Label {
	labels := make([]Label, len(names))
	for i, name := range names {
		labels[i] = Label{Name: name}
	}
	return labels
}

func labelNames(labels []Label) []string {
	names := make([]string, len(labels))
	for i, label := range labels {
		names[i] = label.Name
	}
	return names
}

func TestHasIssueLabelIgnoresCase(t *testing.T) {
	if !HasIssueLabel([]string{"Work"}, "work") || HasIssueLabel([]string{"Work"}, "home") || HasIssueLabel(nil, "work") {
		t.Fatal("HasIssueLabel")
	}
}

func TestReplaceIssueLabel(t *testing.T) {
	labels := []Label{{Name: "Work", Color: "red"}, {Name: "home"}}
	if got := ReplaceIssueLabel(labels, "work", "job"); !reflect.DeepEqual(got, []Label{{Name: "job", Color: "red"}, {Name: "home"}}) {
		t.Errorf("rename = %+v", got)
	}
	if got := ReplaceIssueLabel(labels, "WORK", ""); !reflect.DeepEqual(got, []Label{{Name: "home"}}) {
		t.Errorf("remove = %+v", got)
	}
	if labels[0].Name != "Work" {
		t.Error("input was mutated")
	}
}

func TestReplaceLabelName(t *testing.T) {
	if got := ReplaceLabelName([]string{"Work", "home", "WORK"}, "work", "job"); !slices.Equal(got, []string{"job", "home", "job"}) {
		t.Errorf("rename = %v", got)
	}
	if got := ReplaceLabelName([]string{"Work", "home"}, "work", ""); !slices.Equal(got, []string{"home"}) {
		t.Errorf("remove = %v", got)
	}
}

var labelIssues = [][]string{{"Work", "ginote:pin", " "}, {"work", "home"}, {}, nil, {" Spaced ", "ΟΣ", "İx"}}

func TestUniqueIssueLabelNamesMatchesWeb(t *testing.T) {
	want := []string{"work", "home", "Spaced", "ΟΣ", "İx"}
	if got := UniqueIssueLabelNames(labelIssues); !slices.Equal(got, want) {
		t.Errorf("UniqueIssueLabelNames = %q, want %q", got, want)
	}
}

func TestCountIssueLabelsMatchesWeb(t *testing.T) {
	// 키는 toLocaleLowerCase 결과다(어말 시그마 ς, İ → i̇).
	want := map[string]int{"work": 2, " ": 1, "home": 1, " spaced ": 1, "ος": 1, "i̇x": 1}
	if got := CountIssueLabels(labelIssues); !maps.Equal(got, want) {
		t.Errorf("CountIssueLabels = %v, want %v", got, want)
	}
}

func TestTagOptionsMatchesWeb(t *testing.T) {
	counts := CountIssueLabels(labelIssues)
	repository := labelsNamed("alpha", "home", "work", "beta")
	want := []TagOption{{"home", 1}, {"work", 2}, {"alpha", 0}, {"beta", 0}}
	if got := TagOptions(repository, counts, "", "en"); !reflect.DeepEqual(got, want) {
		t.Errorf("TagOptions = %+v", got)
	}
	want = []TagOption{{"home", 1}, {"work", 2}}
	if got := TagOptions(repository, counts, " ##O ", "en"); !reflect.DeepEqual(got, want) {
		t.Errorf("TagOptions search = %+v", got)
	}
	want = []TagOption{{"work", 2}, {"가지", 0}, {"나무", 0}, {"ab", 0}, {"Ab", 0}}
	if got := TagOptions(labelsNamed("나무", "가지", "work", "Ab", "ab"), counts, "", "ko"); !reflect.DeepEqual(got, want) {
		t.Errorf("TagOptions ko = %+v", got)
	}
}

func TestSortLabelsMatchesWeb(t *testing.T) {
	names := []string{"b", "A", "a", "업무", "가나", "Zeta", "10", "9", "éclair", "eclair", "_x", "일기", "apple", "Apple", "ㄱ", "漢字", "😀"}
	cases := map[string]string{
		"ko": "_x 😀 10 9 ㄱ 가나 업무 일기 漢字 a A apple Apple b eclair éclair Zeta",
		"":   "_x 😀 10 9 ㄱ 가나 업무 일기 漢字 a A apple Apple b eclair éclair Zeta",
		"en": "_x 😀 10 9 a A apple Apple b eclair éclair Zeta ㄱ 가나 업무 일기 漢字",
	}
	for locale, want := range cases {
		original := labelsNamed(names...)
		got := strings.Join(labelNames(SortLabels(original, locale)), " ")
		if got != want {
			t.Errorf("SortLabels(%q) = %s\nwant %s", locale, got, want)
		}
		if original[0].Name != "b" {
			t.Error("input was mutated")
		}
	}
}

// 문자 체계 재배치(ko는 한글·한자, zh는 한자를 라틴 문자보다 앞에)와 한자의 읽기순 정렬.
func TestSortLabelsReorderScriptsLikeICU(t *testing.T) {
	names := []string{"b", "A", "a", "업무", "가나", "Zeta", "10", "9", "_x", "일기", "漢字", "中文", "北京", "阿", "ㄱ", "a가", "ab", "A가", "ex가", "Éa", "ñ"}
	cases := map[string]string{
		"ko":    "_x 10 9 ㄱ 가나 北京 阿 업무 일기 中文 漢字 a A a가 A가 ab b Éa ex가 ñ Zeta",
		"zh-CN": "_x 10 9 阿 北京 漢字 中文 a A ab a가 A가 b Éa ex가 ñ Zeta ㄱ 가나 업무 일기",
		"en":    "_x 10 9 a A ab a가 A가 b Éa ex가 ñ Zeta ㄱ 가나 업무 일기 中文 北京 漢字 阿",
	}
	for locale, want := range cases {
		if got := strings.Join(labelNames(SortLabels(labelsNamed(names...), locale)), " "); got != want {
			t.Errorf("SortLabels(%q) = %s\nwant %s", locale, got, want)
		}
	}
}

func TestMergeLabelsPrefersNextAndSorts(t *testing.T) {
	merged := MergeLabels([]Label{{Name: "b", ID: 1}, {Name: "A", ID: 2}}, []Label{{Name: "a", ID: 3}, {Name: "c", ID: 4}}, "en")
	want := []Label{{Name: "a", ID: 3}, {Name: "b", ID: 1}, {Name: "c", ID: 4}}
	if !reflect.DeepEqual(merged, want) {
		t.Errorf("MergeLabels = %+v", merged)
	}
}

func TestLimitTagInput(t *testing.T) {
	limited := LimitTagInput(TagInput{Name: "  " + strings.Repeat("가", 60) + "  ", Description: strings.Repeat("x", 120)})
	if limited.Name != strings.Repeat("가", 50) || limited.Description != strings.Repeat("x", 100) {
		t.Errorf("LimitTagInput = %+v", limited)
	}
	if got := LimitTagInput(TagInput{Name: strings.Repeat("😀", 51)}); got.Name != strings.Repeat("😀", 50) {
		t.Errorf("emoji = %q", got.Name)
	}
	if got := LimitTagInput(TagInput{}); got != (TagInput{}) {
		t.Errorf("empty = %+v", got)
	}
	if got := LimitTagInput(TagInput{Name: "  a b  ", Description: " 　d "}); got != (TagInput{"a b", "d"}) {
		t.Errorf("trim = %+v", got)
	}
}
