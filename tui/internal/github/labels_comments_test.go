package github

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/zidell/ginote/tui/internal/notes"
)

func TestCreateLabelUsesWebColor(t *testing.T) {
	fake, client := newFake(t)
	fake.on("POST", "/repos/o/n/labels", 201, `{"id":1,"name":"할 일","color":"4fd858"}`)
	label, err := client.CreateLabel(context.Background(), "o/n", "할 일", "")
	if err != nil || label.Name != "할 일" {
		t.Fatalf("label = %+v err = %v", label, err)
	}
	// 4fd858은 tagColorForName("할 일")의 결과다.
	if notes.TagColor("할 일") != "4fd858" {
		t.Fatalf("TagColor = %q", notes.TagColor("할 일"))
	}
	assertBody(t, fake.find("POST", "/repos/o/n/labels"), map[string]any{"name": "할 일", "color": "4fd858"})
}

func TestCreateLabelReusesExistingOnConflict(t *testing.T) {
	fake, client := newFake(t)
	fake.on("POST", "/repos/o/n/labels", 422, `{"message":"Validation Failed"}`)
	fake.on("GET", "/repos/o/n/labels/a%2Fb", 200, `{"id":7,"name":"a/b","color":"ffffff"}`)
	label, err := client.CreateLabel(context.Background(), "o/n", "a/b", "설명")
	if err != nil || label.ID != 7 {
		t.Fatalf("label = %+v err = %v", label, err)
	}
	assertBody(t, fake.find("POST", "/repos/o/n/labels"), map[string]any{"name": "a/b", "color": notes.TagColor("a/b"), "description": "설명"})
}

func TestLabelReadsRenamesAndRemoves(t *testing.T) {
	fake, client := newFake(t)
	ctx := context.Background()
	fake.on("GET", "/repos/o/n/labels?per_page=100", 200, `[{"name":"a","color":"000000"}]`)
	fake.on("PATCH", "/repos/o/n/labels/old%20name", 200, `{"name":"new"}`)
	fake.on("DELETE", "/repos/o/n/labels/%EC%9E%84%EC%8B%9C", 204, ``)

	labels, err := client.ListLabels(ctx, "o/n")
	if err != nil || len(labels) != 1 || labels[0].Color != "000000" {
		t.Fatalf("labels = %+v err = %v", labels, err)
	}
	if _, err := client.RenameLabel(ctx, "o/n", "old name", "new", nil); err != nil {
		t.Fatal(err)
	}
	empty := ""
	if _, err := client.RenameLabel(ctx, "o/n", "old name", "new", &empty); err != nil {
		t.Fatal(err)
	}
	if err := client.RemoveLabel(ctx, "o/n", "임시"); err != nil {
		t.Fatal(err)
	}
	var patches []call
	for _, recorded := range fake.calls {
		if recorded.Method == "PATCH" {
			patches = append(patches, recorded)
		}
	}
	assertBody(t, patches[0], map[string]any{"new_name": "new"})
	assertBody(t, patches[1], map[string]any{"new_name": "new", "description": ""})
}

func commentsJSON(from, count int) string {
	items := make([]string, count)
	for index := range items {
		items[index] = fmt.Sprintf(`{"id":%d,"body":"c","user":{"login":"me","avatar_url":"a"},"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z","html_url":"u"}`, from+index)
	}
	return "[" + strings.Join(items, ",") + "]"
}

// Link 헤더로 2쪽을 읽고, 2쪽에 Link가 없지만 100개가 꽉 찼으니 3쪽을 직접 만들어 읽는다.
func TestListIssueCommentsFollowsLinkThenFullPages(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", "/repos/o/n/issues/4/comments?per_page=100", 200, commentsJSON(1, 1),
		"Link", `<https://api.github.com/repositories/9/issues/4/comments?per_page=100&page=2>; rel="next"`)
	fake.on("GET", "/repositories/9/issues/4/comments?per_page=100&page=2", 200, commentsJSON(2, 100))
	fake.on("GET", "/repos/o/n/issues/4/comments?per_page=100&page=3", 200, `[{"id":500,"body":null,"user":null}]`)
	comments, err := client.ListIssueComments(context.Background(), "o/n", 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 102 {
		t.Fatalf("len = %d", len(comments))
	}
	first, last := comments[0], comments[101]
	if first.ID != 1 || first.Author != "me" || first.AvatarURL != "a" || first.URL != "u" || first.UpdatedAt.Day() != 2 {
		t.Fatalf("first = %+v", first)
	}
	if last.ID != 500 || last.Body != "" || last.Author != "" {
		t.Fatalf("last = %+v", last)
	}
	assertURIs(t, fake,
		"GET /repos/o/n/issues/4/comments?per_page=100",
		"GET /repositories/9/issues/4/comments?per_page=100&page=2",
		"GET /repos/o/n/issues/4/comments?per_page=100&page=3")
}

func TestListIssueCommentsStopsOnRepeatedLink(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", "/repos/o/n/issues/4/comments?per_page=100", 200, commentsJSON(1, 1),
		"Link", `<https://api.github.com/repos/o/n/issues/4/comments?per_page=100>; rel="next"`)
	comments, err := client.ListIssueComments(context.Background(), "o/n", 4)
	if err != nil || len(comments) != 1 {
		t.Fatalf("comments = %d err = %v", len(comments), err)
	}
}

func TestCommentWrites(t *testing.T) {
	fake, client := newFake(t)
	ctx := context.Background()
	fake.on("POST", "/repos/o/n/issues/4/comments", 201, commentsJSON(11, 1)[1:len(commentsJSON(11, 1))-1])
	fake.on("PATCH", "/repos/o/n/issues/comments/11", 200, commentsJSON(11, 1)[1:len(commentsJSON(11, 1))-1])
	fake.on("DELETE", "/repos/o/n/issues/comments/11", 204, ``)

	created, err := client.CreateIssueComment(ctx, "o/n", 4, "hello")
	if err != nil || created.ID != 11 || created.Author != "me" {
		t.Fatalf("created = %+v err = %v", created, err)
	}
	assertBody(t, fake.find("POST", "/repos/o/n/issues/4/comments"), map[string]any{"body": "hello"})
	if _, err := client.UpdateIssueComment(ctx, "o/n", 11, "edited"); err != nil {
		t.Fatal(err)
	}
	assertBody(t, fake.find("PATCH", "/repos/o/n/issues/comments/11"), map[string]any{"body": "edited"})
	if err := client.DeleteIssueComment(ctx, "o/n", 11); err != nil {
		t.Fatal(err)
	}
}
