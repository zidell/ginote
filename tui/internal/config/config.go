// Package config는 TUI의 설정 파일(tui.go)과 워크스페이스·환경설정 형식을 다룬다.
// 데스크톱 앱의 config.toml은 읽지 않는다. 저장소·토큰·환경설정은 TUI에서 따로 설정한다.
package config

import (
	"net/url"
	"regexp"
	"strings"
)

type Workspace struct {
	ID   string
	Repo string
	Name string
	// Origin은 이 워크스페이스를 어디서 읽었는지다. OriginTUI는 TUI에서 추가해 설정 파일에 둔 것이고,
	// OriginFlag는 --repo로 이번 실행에만 연 것이다(저장하지 않는다).
	Origin string
	// TokenSource는 TUI 워크스페이스의 토큰 출처다(TokenKeychain, TokenGH).
	TokenSource string
}

const (
	OriginTUI     = "tui"
	OriginFlag    = "flag"
	TokenKeychain = "keychain"
	TokenGH       = "gh"
)

// Label은 화면에 보일 이름이다. 이름이 비어 있으면 저장소 주소를 쓴다(웹과 같음).
func (w Workspace) Label() string {
	if w.Name != "" {
		return w.Name
	}
	return w.Repo
}

const (
	defaultNotesPerPage = 30
	TitleFirstLine      = "first-line"
	TitleSeparate       = "separate"
)

var (
	githubURLPrefix = regexp.MustCompile(`(?i)^https?://github\.com/`)
	gitSuffix       = regexp.MustCompile(`(?i)\.git$`)
	edgeSlashes     = regexp.MustCompile(`^/+|/+$`)
	repoPattern     = regexp.MustCompile(`^[^/\s]+/[^/\s]+$`)
)

// ParseRepo는 parseRepositoryAddress(src/lib/repo-address.js)와 같은 규칙으로
// "owner/name"을 꺼낸다.
func ParseRepo(value string) (string, bool) {
	cleaned := githubURLPrefix.ReplaceAllString(strings.TrimSpace(value), "")
	cleaned = gitSuffix.ReplaceAllString(cleaned, "")
	cleaned = edgeSlashes.ReplaceAllString(cleaned, "")
	if !repoPattern.MatchString(cleaned) {
		return "", false
	}
	return cleaned, true
}

// PATCreationURL은 makePatCreationUrl(src/lib/repo-address.js)과 같은 주소다. 이 저장소에
// Issues·Contents 쓰기 권한만 가진 fine-grained PAT 만들기 화면을 연다.
func PATCreationURL(value string) string {
	repo, ok := ParseRepo(value)
	name := "Ginote"
	description := "Ginote repository access"
	owner := ""
	if ok {
		parts := strings.SplitN(repo, "/", 2)
		owner = parts[0]
		name = "Ginote - " + parts[1]
		description = "Ginote access for " + repo
	}
	if runes := []rune(name); len(runes) > 40 {
		name = string(runes[:40])
	}
	query := []string{
		"name=" + url.QueryEscape(name),
		"description=" + url.QueryEscape(description),
		"expires_in=none",
		"issues=write",
		"contents=write",
	}
	if owner != "" {
		query = append(query, "target_name="+url.QueryEscape(owner))
	}
	return "https://github.com/settings/personal-access-tokens/new?" + strings.Join(query, "&")
}
