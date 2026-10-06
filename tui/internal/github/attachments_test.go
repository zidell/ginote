package github

import (
	"context"
	"encoding/base64"
	"regexp"
	"strings"
	"testing"
)

const (
	branchRef     = "/repos/o/n/git/ref/heads/ginote-assets"
	hintsContents = "/repos/o/n/contents/.issue-note-assets/voice-hints.json?ref=ginote-assets"
)

func TestAttachmentPathHelpers(t *testing.T) {
	cases := map[string]string{
		"내 사진 (1).png":     "내-사진-(1).png",
		`a\b/c:d*e?f"g<h>`: "a-b-c-d-e-f-g-h",
		"  #%  ":           "attachment",
		"x\u3000y\uFEFFz":  "x-y-z",
		"--a--":            "a",
		"e\u0301.txt":      "\u00e9.txt",
	}
	for input, want := range cases {
		if got := SafeFileName(input); got != want {
			t.Errorf("SafeFileName(%q) = %q, want %q", input, got, want)
		}
	}
	if got, _ := IssueAttachmentDirectory(12, 0); got != ".issue-note-assets/issues/12" {
		t.Fatalf("directory = %q", got)
	}
	if got, _ := IssueAttachmentDirectory(12, 345); got != ".issue-note-assets/issues/12/comments/345" {
		t.Fatalf("comment directory = %q", got)
	}
	if _, err := IssueAttachmentDirectory(0, 0); err == nil || err.Error() != msgIssueNumberRequired {
		t.Fatalf("err = %v", err)
	}
	if _, err := IssueAttachmentDirectory(1, -1); err == nil {
		t.Fatal("negative comment id must fail")
	}
	if got := attachmentContentsPath("o/n", ".issue-note-assets/issues/1/a b#.png"); got != "/repos/o/n/contents/.issue-note-assets/issues/1/a%20b%23.png?ref=ginote-assets" {
		t.Fatalf("contents path = %q", got)
	}
}

func TestUploadAttachmentToExistingBranch(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", branchRef, 200, `{"ref":"refs/heads/ginote-assets"}`)
	var uploadURI string
	// 경로에 UUID가 들어가므로 정규식으로 받아 응답을 그때 정한다.
	uploadPattern := regexp.MustCompile(`^/repos/o/n/contents/\.issue-note-assets/issues/3/comments/9/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-%EB%82%B4-%EC%82%AC%EC%A7%84\.png$`)
	fake.before = func(method, uri string) {
		if method == "PUT" && uploadPattern.MatchString(uri) {
			uploadURI = uri
			fake.on("PUT", uri, 201, `{"content":{"sha":"s1","size":4,"html_url":"h"}}`)
		}
	}

	file, err := client.UploadAttachment(context.Background(), "o/n", 3, "내 사진.png", "image/png", []byte{0x89, 'P', 'N', 'G'}, 9)
	if err != nil {
		t.Fatal(err)
	}
	if uploadURI == "" || file.SHA != "s1" || file.Size != 4 || file.URL != "h" || file.Type != "image/png" || file.Name != "내 사진.png" {
		t.Fatalf("file = %+v uri = %q", file, uploadURI)
	}
	if !strings.HasPrefix(file.Path, ".issue-note-assets/issues/3/comments/9/") || !strings.HasSuffix(file.Path, "-내-사진.png") {
		t.Fatalf("path = %q", file.Path)
	}
	assertBody(t, fake.find("PUT", uploadURI), map[string]any{
		"message": "Add Ginote attachment: 내 사진.png",
		"content": base64.StdEncoding.EncodeToString([]byte{0x89, 'P', 'N', 'G'}),
		"branch":  "ginote-assets",
	})
}

func TestEnsureAttachmentBranchCreatesRootCommit(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", branchRef, 404, `{"message":"Not Found"}`)
	fake.on("POST", "/repos/o/n/git/trees", 201, `{"sha":"tree1"}`)
	fake.on("POST", "/repos/o/n/git/commits", 201, `{"sha":"commit1"}`)
	fake.on("POST", "/repos/o/n/git/refs", 201, `{}`)
	if err := client.EnsureAttachmentBranch(context.Background(), "o/n"); err != nil {
		t.Fatal(err)
	}
	assertBody(t, fake.find("POST", "/repos/o/n/git/trees"), map[string]any{"tree": []map[string]string{{
		"path": ".issue-note-assets/.ginote-storage", "mode": "100644", "type": "blob",
		"content": "Ginote attachment storage. Do not delete this branch.\n",
	}}})
	assertBody(t, fake.find("POST", "/repos/o/n/git/commits"), map[string]any{
		"message": "Initialize Ginote attachment storage", "tree": "tree1", "parents": []string{},
	})
	assertBody(t, fake.find("POST", "/repos/o/n/git/refs"), map[string]any{"ref": "refs/heads/ginote-assets", "sha": "commit1"})
}

func TestEnsureAttachmentBranchAcceptsConcurrentCreation(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", branchRef, 404, `{}`)
	fake.on("GET", branchRef, 200, `{}`)
	fake.on("POST", "/repos/o/n/git/trees", 201, `{"sha":"t"}`)
	fake.on("POST", "/repos/o/n/git/commits", 201, `{"sha":"c"}`)
	fake.on("POST", "/repos/o/n/git/refs", 422, `{"message":"Reference already exists"}`)
	if err := client.EnsureAttachmentBranch(context.Background(), "o/n"); err != nil {
		t.Fatal(err)
	}
}

// 브랜치가 하나도 없는 빈 저장소는 marker로 기본 브랜치를 만든 뒤 ref를 다시 만든다.
func TestEnsureAttachmentBranchInitializesEmptyRepository(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", branchRef, 409, `{"message":"Git Repository is empty."}`)
	fake.on("POST", "/repos/o/n/git/trees", 201, `{"sha":"t"}`)
	fake.on("POST", "/repos/o/n/git/commits", 201, `{"sha":"c"}`)
	fake.on("POST", "/repos/o/n/git/refs", 422, `{}`)
	fake.on("POST", "/repos/o/n/git/refs", 201, `{}`)
	fake.on("GET", "/repos/o/n", 200, `{"default_branch":"feature/x y"}`)
	fake.on("GET", "/repos/o/n/git/ref/heads/feature/x%20y", 409, `{}`)
	fake.on("PUT", "/repos/o/n/contents/.issue-note-assets/.ginote-storage", 201, `{}`)
	if err := client.EnsureAttachmentBranch(context.Background(), "o/n"); err != nil {
		t.Fatal(err)
	}
	assertURIs(t, fake,
		"GET "+branchRef,
		"POST /repos/o/n/git/trees",
		"POST /repos/o/n/git/commits",
		"POST /repos/o/n/git/refs",
		"GET "+branchRef,
		"GET /repos/o/n",
		"GET /repos/o/n/git/ref/heads/feature/x%20y",
		"PUT /repos/o/n/contents/.issue-note-assets/.ginote-storage",
		"POST /repos/o/n/git/refs")
	assertBody(t, fake.find("PUT", "/repos/o/n/contents/.issue-note-assets/.ginote-storage"), map[string]any{
		"message": "Initialize empty repository for Ginote attachment storage",
		"content": base64.StdEncoding.EncodeToString([]byte("Ginote attachment storage. Do not delete this branch.\n")),
	})
}

func TestListAttachmentsSeparatesCommentFolders(t *testing.T) {
	fake, client := newFake(t)
	ctx := context.Background()
	fake.on("GET", branchRef, 200, `{}`)
	fake.on("GET", "/repos/o/n/contents/.issue-note-assets/issues/2?ref=ginote-assets", 200, `[
	  {"type":"file","name":"a.png","path":".issue-note-assets/issues/2/a.png","sha":"sa","size":1,"html_url":"ha"},
	  {"type":"dir","name":"comments","path":".issue-note-assets/issues/2/comments"},
	  {"type":"file","name":"b.txt","path":".issue-note-assets/issues/2/b.txt","sha":"sb","size":2,"html_url":"hb"}]`)
	fake.on("GET", "/repos/o/n/contents/.issue-note-assets/issues/2/comments?ref=ginote-assets", 200, `[
	  {"type":"dir","name":"7","path":".issue-note-assets/issues/2/comments/7"}]`)
	fake.on("GET", "/repos/o/n/contents/.issue-note-assets/issues/2/comments/7?ref=ginote-assets", 200, `[
	  {"type":"file","name":"c.png","path":".issue-note-assets/issues/2/comments/7/c.png","sha":"sc","size":3,"html_url":"hc"}]`)
	fake.on("GET", "/repos/o/n/contents/.issue-note-assets/issues/5?ref=ginote-assets", 404, `{}`)

	body, err := client.ListIssueAttachmentFiles(ctx, "o/n", 2)
	if err != nil || len(body) != 2 || body[0] != (AttachmentFile{Name: "a.png", Path: ".issue-note-assets/issues/2/a.png", SHA: "sa", Size: 1, URL: "ha"}) {
		t.Fatalf("body = %+v err = %v", body, err)
	}
	comment, err := client.ListIssueCommentAttachmentFiles(ctx, "o/n", 2, 7)
	if err != nil || len(comment) != 1 || comment[0].Name != "c.png" {
		t.Fatalf("comment = %+v err = %v", comment, err)
	}
	all, err := client.ListAllIssueAttachmentFiles(ctx, "o/n", 2)
	if err != nil || len(all) != 3 || all[0].Name != "a.png" || all[1].Name != "b.txt" || all[2].Name != "c.png" {
		t.Fatalf("all = %+v err = %v", all, err)
	}
	missing, err := client.ListAllIssueAttachmentFiles(ctx, "o/n", 5)
	if err != nil || len(missing) != 0 {
		t.Fatalf("missing = %+v err = %v", missing, err)
	}
}

func TestPurgeIssueAttachmentsDeletesEachFile(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", branchRef, 200, `{}`)
	fake.on("GET", "/repos/o/n/contents/.issue-note-assets/issues/2?ref=ginote-assets", 200, `[
	  {"type":"file","name":"a b.png","path":".issue-note-assets/issues/2/a b.png","sha":"sa"},
	  {"type":"file","name":"c.png","path":".issue-note-assets/issues/2/c.png","sha":"sc"}]`)
	fake.on("DELETE", "/repos/o/n/contents/.issue-note-assets/issues/2/a%20b.png", 200, `{}`)
	fake.on("DELETE", "/repos/o/n/contents/.issue-note-assets/issues/2/c.png", 200, `{}`)
	deleted, err := client.PurgeIssueAttachments(context.Background(), "o/n", 2)
	if err != nil || deleted != 2 {
		t.Fatalf("deleted = %d err = %v", deleted, err)
	}
	assertBody(t, fake.find("DELETE", "/repos/o/n/contents/.issue-note-assets/issues/2/a%20b.png"), map[string]any{
		"message": "Delete Ginote attachment: a b.png", "sha": "sa", "branch": "ginote-assets",
	})
}

func TestDownloadAttachmentRawAndJSONFallback(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", "/repos/o/n/contents/x/raw.bin?ref=ginote-assets", 200, "\x00\x01raw", "Content-Type", "application/octet-stream")
	fake.on("GET", "/repos/o/n/contents/x/json.bin?ref=ginote-assets", 200,
		`{"content":"aGVs\nbG8=\n","encoding":"base64"}`, "Content-Type", "application/json; charset=utf-8")
	fake.on("GET", "/repos/o/n/contents/x/gone.bin?ref=ginote-assets", 404, `{"message":"ignored"}`)
	ctx := context.Background()
	if data, err := client.DownloadAttachment(ctx, "o/n", "x/raw.bin"); err != nil || string(data) != "\x00\x01raw" {
		t.Fatalf("raw = %q err = %v", data, err)
	}
	if fake.find("GET", "/repos/o/n/contents/x/raw.bin?ref=ginote-assets").Accept != "application/vnd.github.raw+json" {
		t.Fatal("raw Accept header missing")
	}
	if data, err := client.DownloadAttachment(ctx, "o/n", "x/json.bin"); err != nil || string(data) != "hello" {
		t.Fatalf("json = %q err = %v", data, err)
	}
	if _, err := client.DownloadAttachment(ctx, "o/n", "x/gone.bin"); err == nil || err.Error() != "GitHub 404: Not Found" {
		t.Fatalf("err = %v", err)
	}
}

func TestVoiceTranscriptionHints(t *testing.T) {
	fake, client := newFake(t)
	ctx := context.Background()
	encoded := base64.StdEncoding.EncodeToString([]byte(`{"version":1,"hints":"Ginote, 깃노트"}`))
	fake.on("GET", hintsContents, 200, `{"sha":"old","content":"`+encoded[:8]+`\n`+encoded[8:]+`"}`)
	if hints, err := client.LoadVoiceTranscriptionHints(ctx, "o/n"); err != nil || hints != "Ginote, 깃노트" {
		t.Fatalf("hints = %q err = %v", hints, err)
	}

	fake.on("GET", branchRef, 200, `{}`)
	fake.on("PUT", "/repos/o/n/contents/.issue-note-assets/voice-hints.json", 200, `{}`)
	saved, err := client.SaveVoiceTranscriptionHints(ctx, "o/n", "  <b>깃노트</b>\n")
	if err != nil || saved != "<b>깃노트</b>" {
		t.Fatalf("saved = %q err = %v", saved, err)
	}
	// JSON.stringify({ version: 1, hints }, null, 2) + '\n'
	content := "{\n  \"version\": 1,\n  \"hints\": \"<b>깃노트</b>\"\n}\n"
	assertBody(t, fake.find("PUT", "/repos/o/n/contents/.issue-note-assets/voice-hints.json"), map[string]any{
		"message": "Update Ginote voice transcription hints",
		"content": base64.StdEncoding.EncodeToString([]byte(content)),
		"branch":  "ginote-assets",
		"sha":     "old",
	})
}

func TestVoiceHintsMissingOrBrokenAreEmpty(t *testing.T) {
	fake, client := newFake(t)
	fake.on("GET", hintsContents, 404, `{}`)
	fake.on("GET", hintsContents, 200, `{"content":"`+base64.StdEncoding.EncodeToString([]byte("not json"))+`"}`)
	fake.on("GET", hintsContents, 200, `{"content":"`+base64.StdEncoding.EncodeToString([]byte(`{"hints":3}`))+`"}`)
	for range 3 {
		if hints, err := client.LoadVoiceTranscriptionHints(context.Background(), "o/n"); err != nil || hints != "" {
			t.Fatalf("hints = %q err = %v", hints, err)
		}
	}
	// 새 파일이면 sha 없이 만든다.
	fake.routes = map[string][]reply{}
	fake.on("GET", branchRef, 200, `{}`)
	fake.on("GET", hintsContents, 404, `{}`)
	fake.on("PUT", "/repos/o/n/contents/.issue-note-assets/voice-hints.json", 201, `{}`)
	if _, err := client.SaveVoiceTranscriptionHints(context.Background(), "o/n", ""); err != nil {
		t.Fatal(err)
	}
	put := fake.find("PUT", "/repos/o/n/contents/.issue-note-assets/voice-hints.json")
	if _, ok := put.Body["sha"]; ok {
		t.Fatalf("body = %v", put.Body)
	}
}
