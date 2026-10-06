package notes

import "testing"

// 기대값은 src/lib의 원본 JS 함수를 node로 실행해 얻은 값이다.
func TestTagColorMatchesWeb(t *testing.T) {
	cases := map[string]string{
		"업무":         "d84fd2",
		"todo":       "4fafd8",
		"ginote:pin": "d84fad",
		"Café":       "bf4fd8",
		"":           "d84f4f",
	}
	for name, want := range cases {
		if got := TagColor(name); got != want {
			t.Errorf("TagColor(%q) = %s, want %s", name, got, want)
		}
	}
}

func TestMarkdownToPlainTextMatchesWeb(t *testing.T) {
	cases := map[string]string{
		"# 제목\n- [x] 할 일 **굵게**":            "제목 할 일 굵게",
		"see [link](http://a.b) and `code`": "see link and code",
		"<b>hi</b>\n\n> quote\n1. one":      "hi quote one",
	}
	for input, want := range cases {
		if got := MarkdownToPlainText(input); got != want {
			t.Errorf("MarkdownToPlainText(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestExcerptDropsLeadingTitle(t *testing.T) {
	if got := Excerpt("장보기\n\n우유, 계란", "장보기"); got != "우유, 계란" {
		t.Errorf("Excerpt = %q", got)
	}
}

func TestLockTitle(t *testing.T) {
	if !IsLockedTitle("🔒 비밀") || IsLockedTitle("비밀") {
		t.Fatal("IsLockedTitle")
	}
	if got := RemoveLockFromTitle("🔒 비밀"); got != "비밀" {
		t.Errorf("RemoveLockFromTitle = %q", got)
	}
}

func TestVisibleLabelNamesHidesPin(t *testing.T) {
	got := VisibleLabelNames([]string{"GINOTE:PIN", "업무"})
	if len(got) != 1 || got[0] != "업무" {
		t.Errorf("VisibleLabelNames = %v", got)
	}
}
