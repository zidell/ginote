package github

import (
	"context"
	"testing"
	"time"
)

var testNow = time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)

// 기대 쿼리 문자열은 같은 입력으로 github.js(URLSearchParams·encodeURIComponent·
// JSON.stringify)를 node에서 돌린 결과다.
func TestListIssuesPageMatchesWebRequests(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", "/repos/o/n/issues?state=open&sort=updated&direction=desc&per_page=30&page=1&labels=%ED%95%A0+%EC%9D%BC*%7E", 200,
		`[{"number":1,"title":"노트","html_url":"https://github.com/o/n/issues/1","comments":2,"user":{"login":"me"},
		   "labels":[{"id":5,"name":"할 일*~","color":"4fd858","description":"d"}]},{"number":2,"pull_request":{}}]`,
		"Link", `<https://api.github.com/repositories/1/issues?page=2>; rel="next", <https://api.github.com/repositories/1/issues?page=9>; rel="last"`)
	fake.on("GET", "/search/issues?q=repo%3Ao%2Fn%20is%3Aissue%20is%3Aopen%20label%3A%22%ED%95%A0%20%EC%9D%BC*~%22&per_page=1", 200,
		`{"total_count":41,"items":[]}`)
	page, err := client.ListIssuesPage(context.Background(), "https://github.com/o/n.git", "open", "할 일*~", 1, testNow, DefaultIssuePageSize)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || !page.HasMore || page.TotalCount == nil || *page.TotalCount != 41 {
		t.Fatalf("page = %+v", page)
	}
	issue := page.Items[0]
	if issue.HTMLURL != "https://github.com/o/n/issues/1" || issue.Comments != 2 || issue.User.Login != "me" ||
		issue.Labels[0] != (Label{ID: 5, Name: "할 일*~", Color: "4fd858", Description: "d"}) || issue.ClosedAt != nil {
		t.Fatalf("issue = %+v", issue)
	}
}

func TestListIssuesPageLaterPagesSkipCount(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", "/repos/o/n/issues?state=open&sort=updated&direction=desc&per_page=10&page=2", 200, `[{"number":3}]`)
	page, err := client.ListIssuesPage(context.Background(), "o/n", "open", "", 2, testNow, 10)
	if err != nil {
		t.Fatal(err)
	}
	if page.HasMore || page.TotalCount != nil || len(page.Items) != 1 {
		t.Fatalf("page = %+v", page)
	}
	assertURIs(t, fake, "GET /repos/o/n/issues?state=open&sort=updated&direction=desc&per_page=10&page=2")
}

func TestListIssuesPageFailsWhenCountFails(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", "/repos/o/n/issues?state=open&sort=updated&direction=desc&per_page=30&page=1", 200, `[]`)
	fake.on("GET", "/search/issues?q=repo%3Ao%2Fn%20is%3Aissue%20is%3Aopen&per_page=1", 403, `{"message":"rate limited"}`,
		"x-ratelimit-remaining", "0", "x-ratelimit-reset", "1700000000")
	_, err := client.ListIssuesPage(context.Background(), "o/n", "open", "", 1, testNow, 30)
	apiErr, ok := err.(*Error)
	if !ok || apiErr.Status != 403 || apiErr.Message != "rate limited" || apiErr.Remaining != "0" || apiErr.Reset != "1700000000" {
		t.Fatalf("err = %#v", err)
	}
}

func TestClosedListUsesRetentionSearchSortedByClosedAt(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", "/search/issues?q=repo%3Ao%2Fn%20is%3Aissue%20is%3Aclosed%20closed%3A%3E%3D2026-09-04%20label%3A%22a%5C%22b%22&search_type=hybrid&per_page=100&page=1", 200,
		`{"total_count":4,"items":[
		  {"number":1,"closed_at":"2026-09-10T00:00:00Z"},
		  {"number":2,"closed_at":null},
		  {"number":3,"closed_at":"2026-10-01T00:00:00Z"},
		  {"number":4,"closed_at":"2026-10-02T00:00:00Z","pull_request":{"url":"x"}}]}`)
	page, err := client.ListIssuesPage(context.Background(), "o/n", "closed", `a"b`, 3, testNow, 30)
	if err != nil {
		t.Fatal(err)
	}
	if page.HasMore || *page.TotalCount != 4 || len(page.Items) != 3 {
		t.Fatalf("page = %+v", page)
	}
	if page.Items[0].Number != 3 || page.Items[1].Number != 1 || page.Items[2].Number != 2 {
		t.Fatalf("order = %d %d %d", page.Items[0].Number, page.Items[1].Number, page.Items[2].Number)
	}
}

func TestSearchIssuesPageKeepsOpenOrderAndTrimsTerm(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", "/search/issues?q=%EB%A9%94%EB%AA%A8%20(%EC%B4%88%EC%95%88)%20repo%3Ao%2Fn%20is%3Aissue%20is%3Aopen&search_type=hybrid&per_page=100&page=1", 200,
		`{"total_count":2,"items":[{"number":1,"closed_at":"2026-01-01T00:00:00Z"},{"number":2,"closed_at":"2026-02-01T00:00:00Z"}]}`)
	page, err := client.SearchIssuesPage(context.Background(), "o/n", "open", "  메모 (초안) ", "", testNow)
	if err != nil {
		t.Fatal(err)
	}
	if page.Items[0].Number != 1 || page.Items[1].Number != 2 {
		t.Fatalf("open results must keep GitHub order: %+v", page.Items)
	}
}

func TestListExpiredClosedIssues(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", "/search/issues?q=repo%3Ao%2Fn%20is%3Aissue%20is%3Aclosed%20closed%3A%3C2026-09-04&sort=updated&order=asc&per_page=100&page=1", 200,
		`{"items":[{"number":8},{"number":9,"pull_request":{}}]}`)
	issues, err := client.ListExpiredClosedIssues(context.Background(), "o/n", testNow, 100)
	if err != nil || len(issues) != 1 || issues[0].Number != 8 {
		t.Fatalf("issues = %+v err = %v", issues, err)
	}
}

func TestIssueWrites(t *testing.T) {
	fake, client := newFake(t)
	ctx := context.Background()
	fake.on("POST", "/repos/o/n/issues", 201, `{"number":5}`)
	fake.on("PATCH", "/repos/o/n/issues/5", 200, `{"number":5}`)
	fake.on("POST", "/repos/o/n/issues/5/labels", 200, `[{"name":"a"},{"name":"b"}]`)
	fake.on("DELETE", "/repos/o/n/issues/5/labels/%ED%95%A0%20%EC%9D%BC%2Fx", 200, `[{"name":"a"}]`)

	if issue, err := client.CreateIssue(ctx, "o/n", NoteInput{Title: "t", Body: "<b>", State: "closed"}); err != nil || issue.Number != 5 {
		t.Fatalf("create: %+v %v", issue, err)
	}
	assertBody(t, fake.find("POST", "/repos/o/n/issues"), map[string]any{"title": "t", "body": "<b>", "labels": []string{}})

	if _, err := client.UpdateIssue(ctx, "o/n", 5, NoteInput{Title: "t", Body: "b", Labels: []string{"x"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UpdateIssue(ctx, "o/n", 5, NoteInput{Title: "t", Body: "b", State: "open"}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.SetIssueLabels(ctx, "o/n", 5, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := client.SetIssueState(ctx, "o/n", 5, "closed"); err != nil {
		t.Fatal(err)
	}
	patches := []map[string]any{
		{"title": "t", "body": "b", "labels": []string{"x"}},
		{"title": "t", "body": "b", "labels": []string{}, "state": "open"},
		{"labels": []string{}},
		{"state": "closed"},
	}
	index := 0
	for _, recorded := range fake.calls {
		if recorded.Method == "PATCH" {
			assertBody(t, recorded, patches[index])
			index++
		}
	}
	if index != len(patches) {
		t.Fatalf("patches = %d", index)
	}

	labels, err := client.AddIssueLabel(ctx, "o/n", 5, "b")
	if err != nil || len(labels) != 2 {
		t.Fatalf("add: %+v %v", labels, err)
	}
	assertBody(t, fake.find("POST", "/repos/o/n/issues/5/labels"), map[string]any{"labels": []string{"b"}})
	labels, err = client.RemoveIssueLabel(ctx, "o/n", 5, "할 일/x")
	if err != nil || len(labels) != 1 {
		t.Fatalf("remove: %+v %v", labels, err)
	}
}

func TestRejectsMalformedRepository(t *testing.T) {
	_, client := newFake(t)
	_, err := client.GetIssue(context.Background(), "not-a-repo", 1)
	if err == nil || err.Error() != msgRepositoryFormat {
		t.Fatalf("err = %v", err)
	}
}

func TestErrorFallsBackToStatusText(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", "/repos/o/n/issues/1", 502, ``)
	_, err := client.GetIssue(context.Background(), "o/n", 1)
	if err == nil || err.Error() != "GitHub 502: Bad Gateway" || StatusOf(err) != 502 {
		t.Fatalf("err = %v", err)
	}
}

func TestEncodingHelpersMatchJavaScript(t *testing.T) {
	if got := encodeURIComponent("a b/한!'()*~"); got != "a%20b%2F%ED%95%9C!'()*~" {
		t.Fatalf("encodeURIComponent = %q", got)
	}
	if got := formEncode([2]string{"labels", "할 일*~"}); got != "labels=%ED%95%A0+%EC%9D%BC*%7E" {
		t.Fatalf("formEncode = %q", got)
	}
	if got := jsString("a\"b\\c\n\x01<&>"); got != `"a\"b\\c\n\u0001<&>"` {
		t.Fatalf("jsString = %q", got)
	}
	if got := nextPagePath(`<https://api.github.com/x?page=3>; rel="last", <https://api.github.com/repositories/1/issues/2/comments?per_page=100&page=2>; rel="next"`); got != "/repositories/1/issues/2/comments?per_page=100&page=2" {
		t.Fatalf("nextPagePath = %q", got)
	}
	if got := nextPagePath(`<https://api.github.com/x?page=1>; rel="prev"`); got != "" {
		t.Fatalf("nextPagePath = %q", got)
	}
}
