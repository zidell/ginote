package config

import "testing"

func TestParseRepoMatchesWeb(t *testing.T) {
	cases := map[string]string{
		"owner/name":                          "owner/name",
		" HTTPS://github.com/owner/name.git ": "owner/name",
		"/owner/name/":                        "owner/name",
		"owner":                               "",
		"owner/name/extra":                    "",
		"own er/name":                         "",
	}
	for input, want := range cases {
		got, ok := ParseRepo(input)
		if got != want || ok != (want != "") {
			t.Errorf("ParseRepo(%q) = %q, %v", input, got, ok)
		}
	}
}

// 기대값은 makePatCreationUrl(src/lib/repo-address.js)을 node로 실행해 얻은 값이다.
func TestPATCreationURLMatchesWeb(t *testing.T) {
	cases := map[string]string{
		"owner/notes": "https://github.com/settings/personal-access-tokens/new?name=Ginote+-+notes&description=Ginote+access+for+owner%2Fnotes&expires_in=none&issues=write&contents=write&target_name=owner",
		"":            "https://github.com/settings/personal-access-tokens/new?name=Ginote&description=Ginote+repository+access&expires_in=none&issues=write&contents=write",
	}
	for input, want := range cases {
		if got := PATCreationURL(input); got != want {
			t.Errorf("PATCreationURL(%q)\n got %s\nwant %s", input, got, want)
		}
	}
}
