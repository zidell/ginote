package notes

import (
	"strings"
	"testing"
)

// 기대값은 src/lib/notes.js의 원본 함수를 node로 실행해 얻은 값이다(notes.test.js의 사례 포함).
func TestAutomaticTitleMatchesWeb(t *testing.T) {
	cases := []struct{ input, want string }{
		{"  첫 줄이 제목  \n두 번째 줄", "첫 줄이 제목"},
		{strings.Repeat("가", 60), strings.Repeat("가", 50)},
		{strings.Repeat("📝", 51), strings.Repeat("📝", 50)},
		{"", ""},
		{"   \n두 번째 줄", ""},
		{"a\r\nb", "a"},
		{"　제목 \r\n둘", "제목"},
		{"line\rstill", "line\rstill"},
	}
	for _, c := range cases {
		if got := AutomaticTitle(c.input); got != c.want {
			t.Errorf("AutomaticTitle(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}

func TestLinkAtCursorMatchesWeb(t *testing.T) {
	type want struct {
		url        string
		start, end int
	}
	none := want{}
	cases := []struct {
		body   string
		cursor int
		want   want
	}{
		{"앞 [GitHub](https://github.com/example/repo) 뒤", 2, want{"https://github.com/example/repo", 2, 43}},
		{"앞 [GitHub](https://github.com/example/repo) 뒤", 5, want{"https://github.com/example/repo", 2, 43}},
		{"앞 [GitHub](https://github.com/example/repo) 뒤", 20, want{"https://github.com/example/repo", 2, 43}},
		{"앞 [GitHub](https://github.com/example/repo) 뒤", 46, none},
		{"앞 [GitHub](https://github.com/example/repo) 뒤", 47, none},
		{"문서: https://example.com/guide?q=note.", 4, want{"https://example.com/guide?q=note", 4, 36}},
		{"문서: https://example.com/guide?q=note.", 36, want{"https://example.com/guide?q=note", 4, 36}},
		{"문서: https://example.com/guide?q=note.", 37, none},
		{"문서: https://example.com/guide?q=note.", 3, none},
		{"![사진](https://example.com/a.png) 일반 텍스트", 3, none},
		{"![사진](https://example.com/a.png) 일반 텍스트", 0, none},
		{"![사진](https://example.com/a.png) 일반 텍스트", 10, want{"https://example.com/a.png", 6, 31}},
		{"![사진](https://example.com/a.png) 일반 텍스트", 38, none},
		{"![a[b](http://x.y) z", 1, none},
		{"![a[b](http://x.y) z", 3, want{"http://x.y", 3, 18}},
		{"![a[b](http://x.y) z", 18, want{"http://x.y", 3, 18}},
		{`[t](HTTPS://Ex.com/p "title") x`, 0, want{"HTTPS://Ex.com/p", 0, 29}},
		{`[t](HTTPS://Ex.com/p "title") x`, 29, want{"HTTPS://Ex.com/p", 0, 29}},
		{`[t](HTTPS://Ex.com/p "title") x`, 30, none},
		{"see (https://a.b/c).", 5, want{"https://a.b/c", 5, 18}},
		{"see (https://a.b/c).", 19, none},
		{"[x]( http://a.b/c )", 19, want{"http://a.b/c", 0, 19}},
		{"a https://x.y/))]", 14, want{"https://x.y/", 2, 14}},
		{"a https://x.y/))]", 15, none},
		{"[a](http://x) http://y", -1, none},
		{"[a](http://x) http://y", 0, want{"http://x", 0, 13}},
		{"[a](http://x) http://y", 100, none},
		{"[a](http://x) http://y", 14, want{"http://y", 14, 22}},
		{"[a](http://x) http://y", 23, none},
	}
	for _, c := range cases {
		link, ok := LinkAtCursor(c.body, c.cursor)
		got := want{link.URL, link.Start, link.End}
		if ok != (c.want != none) || got != c.want {
			t.Errorf("LinkAtCursor(%q, %d) = %+v %v, want %+v", c.body, c.cursor, got, ok, c.want)
		}
	}
}

func TestShortenMiddleMatchesWeb(t *testing.T) {
	cases := []struct {
		input string
		max   int
		want  string
	}{
		{"1234567890", 7, "123…890"},
		{"https://example.com", 30, "https://example.com"},
		{"abcdef", 1, "a…f"},
		{"abcdef", 2, "a…f"},
		{"abc", 0, "a…c"},
		{"a", 0, "a…a"},
		{"😀😀😀😀😀", 4, "😀😀…😀"},
		{"12345", 5, "12345"},
	}
	for _, c := range cases {
		if got := ShortenMiddle(c.input, c.max); got != c.want {
			t.Errorf("ShortenMiddle(%q, %d) = %q, want %q", c.input, c.max, got, c.want)
		}
	}
}

func TestFirstLinePreviewMatchesWeb(t *testing.T) {
	cases := []struct{ input, want string }{
		{"**" + strings.Repeat("가", 60) + "**\n둘째 줄", strings.Repeat("가", 50)},
		{"한\n아주 긴 둘째 줄", "한"},
		{"# 제목 *강조*\r\n둘", "제목 강조"},
		{"", ""},
	}
	for _, c := range cases {
		if got := FirstLinePreview(c.input); got != c.want {
			t.Errorf("FirstLinePreview(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}

func TestNormalizeTagNameMatchesWeb(t *testing.T) {
	cases := []struct{ input, want string }{
		{"  ##일간 기록 ", "일간-기록"},
		{strings.Repeat("가", 60), strings.Repeat("가", 50)},
		{"  #  ", ""},
		{"# a b", "-a-b"},
		{"a　b\tc", "a-b-c"},
		{"#a#b", "a#b"},
	}
	for _, c := range cases {
		if got := NormalizeTagName(c.input); got != c.want {
			t.Errorf("NormalizeTagName(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}
