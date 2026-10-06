package notes

import "testing"

func TestParseTagDefinitionMatchesWeb(t *testing.T) {
	cases := []struct {
		value, current string
		want           TagDefinition
	}{
		{" 업무 : 회사 일 ", "", TagDefinition{"업무", "회사 일"}},
		{"plain", "", TagDefinition{"plain", ""}},
		{"a:b: c", "a:b", TagDefinition{"a:b", "c"}},
		{"a:b", "a:b", TagDefinition{"a:b", ""}},
		{"x:y", "", TagDefinition{"x", "y"}},
	}
	for _, c := range cases {
		if got := ParseTagDefinition(c.value, c.current); got != c.want {
			t.Errorf("ParseTagDefinition(%q, %q) = %+v", c.value, c.current, got)
		}
	}
	if FormatTagDefinition("a", "b") != "a: b" || FormatTagDefinition("a", "") != "a" {
		t.Error("FormatTagDefinition")
	}
}
