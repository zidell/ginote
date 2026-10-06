package github

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"
)

// NoteInput은 createIssue·updateIssue에 넘기는 note다. State가 비어 있으면 보내지 않는다
// (JS의 note.state === undefined).
type NoteInput struct {
	Title  string
	Body   string
	Labels []string
	State  string
}

type issueRequest struct {
	Title  string   `json:"title"`
	Body   string   `json:"body"`
	Labels []string `json:"labels"`
	State  string   `json:"state,omitempty"`
}

func (n NoteInput) payload() issueRequest {
	labels := n.Labels
	if labels == nil {
		labels = []string{}
	}
	return issueRequest{Title: n.Title, Body: n.Body, Labels: labels, State: n.State}
}

// issueOnly는 PR을 뺀다(github.js의 issueOnly).
func issueOnly(items []Issue) []Issue {
	issues := make([]Issue, 0, len(items))
	for _, item := range items {
		if len(item.PullRequest) == 0 || string(item.PullRequest) == "null" {
			issues = append(issues, item)
		}
	}
	return issues
}

// sortIssuesForState는 닫힌 노트를 닫은 시각의 최신순으로 둔다. closed_at이 없으면 맨 뒤.
func sortIssuesForState(items []Issue, state string) []Issue {
	if state != "closed" {
		return items
	}
	sorted := append([]Issue(nil), items...)
	sort.SliceStable(sorted, func(a, b int) bool {
		left, right := sorted[a].ClosedAt, sorted[b].ClosedAt
		if right == nil {
			return left != nil
		}
		return left != nil && left.After(*right)
	})
	return sorted
}

// closedIssueCutoff는 보관 기간이 시작되는 UTC 날짜("YYYY-MM-DD")다.
func closedIssueCutoff(now time.Time) string {
	return now.UTC().AddDate(0, 0, -ClosedIssueRetentionDays).Format("2006-01-02")
}

func labelQuery(label string) string {
	if label == "" {
		return ""
	}
	return " label:" + jsString(label)
}

type searchResult struct {
	TotalCount int     `json:"total_count"`
	Items      []Issue `json:"items"`
}

// ListOpenIssues는 열린 노트를 최근 수정 순으로 한 쪽 가져온다. label이 있으면 그 라벨만.
// ListIssuesPage와 같은 목록 요청이지만 개수를 세는 검색 요청은 보내지 않는다.
func (c *Client) ListOpenIssues(ctx context.Context, repoInput, label string, pageSize int) ([]Issue, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return nil, err
	}
	items, _, err := c.listIssues(ctx, repo, "open", label, 1, pageSize)
	return items, err
}

func (c *Client) listIssues(ctx context.Context, repo, state, label string, page, pageSize int) ([]Issue, bool, error) {
	pairs := [][2]string{
		{"state", state},
		{"sort", "updated"},
		{"direction", "desc"},
		{"per_page", strconv.Itoa(pageSize)},
		{"page", strconv.Itoa(page)},
	}
	if label != "" {
		pairs = append(pairs, [2]string{"labels", label})
	}
	var items []Issue
	response, err := c.request(ctx, http.MethodGet, "/repos/"+repo+"/issues?"+formEncode(pairs...), nil, &items)
	if err != nil {
		return nil, false, err
	}
	return issueOnly(items), nextPagePath(response.Header.Get("Link")) != "", nil
}

// ListIssuesPage는 listIssuesPage다. 닫힌 노트는 보관 기간 안의 것만 보이도록 검색으로
// 가져오고, 그 밖에는 이슈 목록 API를 쓴다. 1쪽이면 전체 개수를 검색 API로 함께 센다.
func (c *Client) ListIssuesPage(ctx context.Context, repoInput, state, label string, page int, now time.Time, pageSize int) (IssuePage, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return IssuePage{}, err
	}
	if state == "closed" {
		return c.SearchIssuesPage(ctx, repo, state, "", label, now)
	}

	type countResult struct {
		total int
		err   error
	}
	var counted chan countResult
	if page == 1 {
		// Promise.all처럼 목록과 개수를 동시에 요청한다.
		counted = make(chan countResult, 1)
		countQuery := "repo:" + repo + " is:issue is:" + state + labelQuery(label)
		go func() {
			var result searchResult
			err := c.get(ctx, "/search/issues?q="+encodeURIComponent(countQuery)+"&per_page=1", &result)
			counted <- countResult{result.TotalCount, err}
		}()
	}

	items, hasMore, err := c.listIssues(ctx, repo, state, label, page, pageSize)
	var total *int
	if counted != nil {
		count := <-counted
		if err == nil && count.err != nil {
			err = count.err
		}
		total = &count.total
	}
	if err != nil {
		return IssuePage{}, err
	}
	return IssuePage{Items: items, HasMore: hasMore, TotalCount: total}, nil
}

// ListIssuesPageWithoutCount는 ListIssuesPage에서 전체 개수 세기(검색 API)를 뺀 것이다. 열린
// 노트는 일반 목록 API 한 번으로 읽는다. 검색 API는 분당 30회 한도라, 개수를 쓰지 않는 TUI는
// 목록을 읽을 때마다 쓰지 않는다. 휴지통은 보관 기간 조건 때문에 검색으로 읽는다.
func (c *Client) ListIssuesPageWithoutCount(ctx context.Context, repoInput, state, label string, page int, now time.Time, pageSize int) (IssuePage, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return IssuePage{}, err
	}
	if state == "closed" {
		return c.SearchIssuesPage(ctx, repo, state, "", label, now)
	}
	items, hasMore, err := c.listIssues(ctx, repo, state, label, page, pageSize)
	if err != nil {
		return IssuePage{}, err
	}
	return IssuePage{Items: items, HasMore: hasMore}, nil
}

// SearchIssuesPage는 searchIssuesPage다. GitHub 웹 이슈 검색과 같은 hybrid 검색을 쓴다
// (REST 기본 lexical 검색은 한글 부분 단어를 놓칠 수 있다). hybrid 검색은 한 페이지만
// 주므로 웹도 page·pageSize를 쓰지 않고 항상 1쪽 100개를 읽는다.
func (c *Client) SearchIssuesPage(ctx context.Context, repoInput, state, term, label string, now time.Time) (IssuePage, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return IssuePage{}, err
	}
	cutoffQuery := ""
	if state == "closed" {
		cutoffQuery = " closed:>=" + closedIssueCutoff(now)
	}
	termQuery := jsTrim(term)
	if termQuery != "" {
		termQuery += " "
	}
	query := termQuery + "repo:" + repo + " is:issue is:" + state + cutoffQuery + labelQuery(label)
	var result searchResult
	path := fmt.Sprintf("/search/issues?q=%s&search_type=hybrid&per_page=%d&page=1",
		encodeURIComponent(query), HybridSearchMaxResults)
	if err := c.get(ctx, path, &result); err != nil {
		return IssuePage{}, err
	}
	total := result.TotalCount
	return IssuePage{
		Items:      sortIssuesForState(issueOnly(result.Items), state),
		HasMore:    false,
		TotalCount: &total,
	}, nil
}

// ListExpiredClosedIssues는 보관 기간이 지난 닫힌 노트를 오래 수정되지 않은 순으로 한 쪽 가져온다.
func (c *Client) ListExpiredClosedIssues(ctx context.Context, repoInput string, now time.Time, pageSize int) ([]Issue, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return nil, err
	}
	query := "repo:" + repo + " is:issue is:closed closed:<" + closedIssueCutoff(now)
	var result searchResult
	path := fmt.Sprintf("/search/issues?q=%s&sort=updated&order=asc&per_page=%d&page=1",
		encodeURIComponent(query), pageSize)
	if err := c.get(ctx, path, &result); err != nil {
		return nil, err
	}
	return issueOnly(result.Items), nil
}

func (c *Client) GetIssue(ctx context.Context, repoInput string, number int) (Issue, error) {
	var issue Issue
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return issue, err
	}
	err = c.get(ctx, fmt.Sprintf("/repos/%s/issues/%d", repo, number), &issue)
	return issue, err
}

func (c *Client) CreateIssue(ctx context.Context, repoInput string, note NoteInput) (Issue, error) {
	note.State = ""
	return c.issueCall(ctx, repoInput, http.MethodPost, "/issues", note.payload())
}

func (c *Client) UpdateIssue(ctx context.Context, repoInput string, number int, note NoteInput) (Issue, error) {
	return c.issueCall(ctx, repoInput, http.MethodPatch, fmt.Sprintf("/issues/%d", number), note.payload())
}

// SetIssueLabels는 노트의 라벨 전체를 labels로 바꾼다.
func (c *Client) SetIssueLabels(ctx context.Context, repoInput string, number int, labels []string) (Issue, error) {
	if labels == nil {
		labels = []string{}
	}
	return c.issueCall(ctx, repoInput, http.MethodPatch, fmt.Sprintf("/issues/%d", number),
		map[string]any{"labels": labels})
}

func (c *Client) SetIssueState(ctx context.Context, repoInput string, number int, state string) (Issue, error) {
	return c.issueCall(ctx, repoInput, http.MethodPatch, fmt.Sprintf("/issues/%d", number),
		map[string]any{"state": state})
}

func (c *Client) issueCall(ctx context.Context, repoInput, method, suffix string, body any) (Issue, error) {
	var issue Issue
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return issue, err
	}
	_, err = c.request(ctx, method, "/repos/"+repo+suffix, body, &issue)
	return issue, err
}

// AddIssueLabel은 라벨 하나를 더하고 GitHub가 돌려준 노트의 라벨 목록을 낸다.
func (c *Client) AddIssueLabel(ctx context.Context, repoInput string, number int, label string) ([]Label, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return nil, err
	}
	var labels []Label
	_, err = c.request(ctx, http.MethodPost, fmt.Sprintf("/repos/%s/issues/%d/labels", repo, number),
		map[string]any{"labels": []string{label}}, &labels)
	return labels, err
}

// RemoveIssueLabel은 라벨 하나를 떼고 남은 라벨 목록을 낸다.
func (c *Client) RemoveIssueLabel(ctx context.Context, repoInput string, number int, label string) ([]Label, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return nil, err
	}
	var labels []Label
	_, err = c.request(ctx, http.MethodDelete,
		fmt.Sprintf("/repos/%s/issues/%d/labels/%s", repo, number, encodeURIComponent(label)), nil, &labels)
	return labels, err
}
