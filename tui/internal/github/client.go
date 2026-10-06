// Package github는 Ginote가 쓰는 GitHub REST 호출이다. src/lib/github.js와 경로·쿼리·
// 헤더·본문이 같은 요청을 보내고, 결과도 같은 규칙으로 거르고 정렬한다.
package github

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/zidell/ginote/tui/internal/config"
)

const apiRoot = "https://api.github.com"

// 웹(github.js)과 같은 값이다.
const (
	DefaultIssuePageSize     = 30
	HybridSearchMaxResults   = 100
	ClosedIssueRetentionDays = 30
)

// 웹 i18n(ko)의 errors.* 문구다.
const (
	msgGitHubRequest       = "GitHub에 요청을 보내지 못했습니다."
	msgRepositoryFormat    = "저장소 주소를 owner/repository 형식으로 입력하세요."
	msgIssueNumberRequired = "파일을 첨부하려면 먼저 노트를 저장하세요."
	msgAttachmentLoad      = "첨부파일을 불러오지 못했습니다."
)

type Label struct {
	ID          int64  `json:"id,omitempty"`
	Name        string `json:"name"`
	Color       string `json:"color,omitempty"`
	Description string `json:"description,omitempty"`
}

type User struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url,omitempty"`
}

type Issue struct {
	ID        int64      `json:"id"`
	Number    int        `json:"number"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	State     string     `json:"state"`
	HTMLURL   string     `json:"html_url"`
	Comments  int        `json:"comments"`
	User      User       `json:"user"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	ClosedAt  *time.Time `json:"closed_at"`
	Labels    []Label    `json:"labels"`
	// PullRequest가 있으면 PR이다. 이슈 목록 API가 PR도 섞어 주므로 걸러 낸다(issueOnly).
	PullRequest json.RawMessage `json:"pull_request,omitempty"`
}

func (i Issue) LabelNames() []string {
	names := make([]string, len(i.Labels))
	for index, label := range i.Labels {
		names[index] = label.Name
	}
	return names
}

// IssuePage는 listIssuesPage·searchIssuesPage의 { items, hasMore, totalCount }다.
// TotalCount가 nil이면 개수를 세지 않은 페이지(2쪽 이후)다.
type IssuePage struct {
	Items      []Issue
	HasMore    bool
	TotalCount *int
}

type Client struct {
	Token string
	HTTP  *http.Client
	Root  string
}

// New는 GitHub API 클라이언트다. GINOTE_GITHUB_API_URL이 있으면 그 주소로 보낸다
// (GitHub Enterprise나 시험용 가짜 서버).
func New(token string) *Client {
	root := apiRoot
	if custom := strings.TrimRight(os.Getenv("GINOTE_GITHUB_API_URL"), "/"); custom != "" {
		root = custom
	}
	return &Client{Token: token, HTTP: &http.Client{Timeout: 20 * time.Second}, Root: root}
}

// Error는 GitHub가 실패로 답한 요청이다. Remaining·Reset은 x-ratelimit-* 헤더 값이다.
type Error struct {
	Status    int
	Message   string
	Remaining string
	Reset     string
}

func (e *Error) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("GitHub %d: %s", e.Status, e.Message)
	}
	return fmt.Sprintf("GitHub %d", e.Status)
}

// StatusOf는 err가 GitHub 응답 오류면 그 상태 코드, 아니면 0이다(JS의 reason?.status).
func StatusOf(err error) int {
	var apiErr *Error
	if errors.As(err, &apiErr) {
		return apiErr.Status
	}
	return 0
}

// NormalizeRepo는 normalizeRepo(github.js)다. 저장소 주소를 "owner/name"으로 바꾼다.
func NormalizeRepo(value string) (string, error) {
	repo, ok := config.ParseRepo(value)
	if !ok {
		return "", errors.New(msgRepositoryFormat)
	}
	return repo, nil
}

func (c *Client) newRequest(ctx context.Context, method, path string, body any) (*http.Request, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := encodeJSON(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.Root+path, reader)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("Authorization", "Bearer "+c.Token)
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	return request, nil
}

// request는 github.js의 request다. body가 nil이 아니면 JSON으로 보내고, 응답은 out에
// 풀어 넣는다(out이 nil이거나 204면 버린다). Link 헤더를 읽도록 응답도 돌려준다.
func (c *Client) request(ctx context.Context, method, path string, body, out any) (*http.Response, error) {
	request, err := c.newRequest(ctx, method, path, body)
	if err != nil {
		return nil, err
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload struct {
			Message string `json:"message"`
		}
		json.NewDecoder(response.Body).Decode(&payload)
		message := payload.Message
		if message == "" {
			message = reasonPhrase(response)
		}
		if message == "" {
			message = msgGitHubRequest
		}
		return response, &Error{
			Status:    response.StatusCode,
			Message:   message,
			Remaining: response.Header.Get("x-ratelimit-remaining"),
			Reset:     response.Header.Get("x-ratelimit-reset"),
		}
	}
	if response.StatusCode == http.StatusNoContent || out == nil {
		io.Copy(io.Discard, response.Body)
		return response, nil
	}
	return response, json.NewDecoder(response.Body).Decode(out)
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	_, err := c.request(ctx, http.MethodGet, path, nil, out)
	return err
}

// reasonPhrase는 fetch의 statusText에 해당하는 "Not Found" 부분이다.
func reasonPhrase(response *http.Response) string {
	prefix := strconv.Itoa(response.StatusCode) + " "
	if phrase, ok := strings.CutPrefix(response.Status, prefix); ok {
		return phrase
	}
	return http.StatusText(response.StatusCode)
}

// encodeJSON은 JSON.stringify처럼 <, >, &를 < 등으로 바꾸지 않는다.
func encodeJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), nil
}

// nextPagePath는 nextPagePath(github.js)다. Link 헤더의 rel="next" 주소에서 경로와
// 쿼리만 남긴다.
func nextPagePath(linkHeader string) string {
	for _, link := range strings.Split(linkHeader, ",") {
		if !strings.Contains(link, `rel="next"`) {
			continue
		}
		start := strings.Index(link, "<")
		end := strings.Index(link, ">")
		if start < 0 || end <= start+1 {
			return ""
		}
		parsed, err := url.Parse(link[start+1 : end])
		if err != nil {
			return ""
		}
		path := parsed.EscapedPath()
		if parsed.RawQuery != "" {
			path += "?" + parsed.RawQuery
		}
		return path
	}
	return ""
}

const hexDigits = "0123456789ABCDEF"

// encodeURIComponent는 JS의 같은 이름 함수와 같은 문자만 그대로 둔다.
func encodeURIComponent(value string) string {
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		character := value[index]
		if isAlphaNumeric(character) || strings.IndexByte("-_.!~*'()", character) >= 0 {
			builder.WriteByte(character)
			continue
		}
		builder.WriteByte('%')
		builder.WriteByte(hexDigits[character>>4])
		builder.WriteByte(hexDigits[character&15])
	}
	return builder.String()
}

// encodePath는 path.split('/').map(encodeURIComponent).join('/')다.
func encodePath(path string) string {
	parts := strings.Split(path, "/")
	for index, part := range parts {
		parts[index] = encodeURIComponent(part)
	}
	return strings.Join(parts, "/")
}

// formEncode는 URLSearchParams.toString()이다. url.Values.Encode와 달리 넣은 순서를
// 지키고 공백은 +, *는 그대로 둔다.
func formEncode(pairs ...[2]string) string {
	encoded := make([]string, len(pairs))
	for index, pair := range pairs {
		encoded[index] = formEscape(pair[0]) + "=" + formEscape(pair[1])
	}
	return strings.Join(encoded, "&")
}

func formEscape(value string) string {
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		character := value[index]
		switch {
		case isAlphaNumeric(character) || strings.IndexByte("*-._", character) >= 0:
			builder.WriteByte(character)
		case character == ' ':
			builder.WriteByte('+')
		default:
			builder.WriteByte('%')
			builder.WriteByte(hexDigits[character>>4])
			builder.WriteByte(hexDigits[character&15])
		}
	}
	return builder.String()
}

func isAlphaNumeric(character byte) bool {
	return character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' ||
		character >= '0' && character <= '9'
}

// jsString은 JSON.stringify(문자열)이다. 검색어의 label:"..."를 웹과 같은 글자로 만든다.
func jsString(value string) string {
	var builder strings.Builder
	builder.WriteByte('"')
	for _, character := range value {
		switch character {
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
			if character < 0x20 {
				fmt.Fprintf(&builder, `\u%04x`, character)
			} else {
				builder.WriteRune(character)
			}
		}
	}
	builder.WriteByte('"')
	return builder.String()
}

// VerifyConnection은 토큰과 저장소를 확인한다(github.js의 verifyConnection과 같은 두 요청).
// 돌려주는 값은 로그인 이름과 GitHub가 알려 준 정확한 "owner/name"이다.
func (c *Client) VerifyConnection(ctx context.Context, repoInput string) (login, fullName string, err error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return "", "", err
	}
	var user struct {
		Login string `json:"login"`
	}
	if err = c.get(ctx, "/user", &user); err != nil {
		return "", "", err
	}
	var repository struct {
		FullName string `json:"full_name"`
	}
	if err = c.get(ctx, "/repos/"+repo, &repository); err != nil {
		return "", "", err
	}
	return user.Login, repository.FullName, nil
}
