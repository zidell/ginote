package github

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// Comment는 웹이 댓글 응답을 옮겨 담는 { id, body, author, avatarUrl, createdAt,
// updatedAt, url }이다.
type Comment struct {
	ID        int64
	Body      string
	Author    string
	AvatarURL string
	CreatedAt time.Time
	UpdatedAt time.Time
	URL       string
}

type commentResponse struct {
	ID        int64     `json:"id"`
	Body      string    `json:"body"`
	User      *User     `json:"user"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	HTMLURL   string    `json:"html_url"`
}

func (r commentResponse) comment() Comment {
	comment := Comment{ID: r.ID, Body: r.Body, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, URL: r.HTMLURL}
	if r.User != nil {
		comment.Author = r.User.Login
		comment.AvatarURL = r.User.AvatarURL
	}
	return comment
}

// ListIssueComments는 listIssueComments다. Link 헤더의 다음 쪽을 따라가고, 헤더가 없어도
// 한 쪽이 꽉 찼으면(100개) page를 늘려 더 읽는다. 같은 주소는 두 번 읽지 않는다.
func (c *Client) ListIssueComments(ctx context.Context, repoInput string, number int) ([]Comment, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return nil, err
	}
	comments := []Comment{}
	visited := map[string]bool{}
	page := 1
	pagePath := fmt.Sprintf("/repos/%s/issues/%d/comments?per_page=100", repo, number)
	for pagePath != "" && !visited[pagePath] {
		visited[pagePath] = true
		var pageComments []commentResponse
		response, err := c.request(ctx, http.MethodGet, pagePath, nil, &pageComments)
		if err != nil {
			return nil, err
		}
		for _, item := range pageComments {
			comments = append(comments, item.comment())
		}
		page++
		pagePath = nextPagePath(response.Header.Get("Link"))
		if pagePath == "" && len(pageComments) == 100 {
			pagePath = fmt.Sprintf("/repos/%s/issues/%d/comments?per_page=100&page=%d", repo, number, page)
		}
	}
	return comments, nil
}

func (c *Client) UpdateIssueComment(ctx context.Context, repoInput string, commentID int64, body string) (Comment, error) {
	return c.commentCall(ctx, repoInput, http.MethodPatch, fmt.Sprintf("/issues/comments/%d", commentID), body)
}

func (c *Client) CreateIssueComment(ctx context.Context, repoInput string, number int, body string) (Comment, error) {
	return c.commentCall(ctx, repoInput, http.MethodPost, fmt.Sprintf("/issues/%d/comments", number), body)
}

func (c *Client) commentCall(ctx context.Context, repoInput, method, suffix, body string) (Comment, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return Comment{}, err
	}
	var response commentResponse
	if _, err := c.request(ctx, method, "/repos/"+repo+suffix, map[string]string{"body": body}, &response); err != nil {
		return Comment{}, err
	}
	return response.comment(), nil
}

func (c *Client) DeleteIssueComment(ctx context.Context, repoInput string, commentID int64) error {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return err
	}
	_, err = c.request(ctx, http.MethodDelete, fmt.Sprintf("/repos/%s/issues/comments/%d", repo, commentID), nil, nil)
	return err
}
