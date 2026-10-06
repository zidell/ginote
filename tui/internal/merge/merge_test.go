package merge

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
	_ "time/tzdata"
)

// note-merge.js의 기대값은 TZ=Asia/Seoul로 node에서 실행해 얻었다. merge-notes.js는 node에서
// 바로 불러올 수 없어(i18n의 JSON import) merge-notes.test.js의 사례를 그대로 옮겼다.

func useSeoul(t *testing.T) {
	t.Helper()
	location, err := time.LoadLocation("Asia/Seoul")
	if err != nil {
		t.Fatal(err)
	}
	previous := time.Local
	time.Local = location
	t.Cleanup(func() { time.Local = previous })
}

func at(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return parsed
}

var (
	firstSource = Source{
		Issue:    Issue{Number: 9, Title: "첫 노트", Body: "첫 본문", Author: "alice", CreatedAt: at("2026-01-01T09:00:00Z")},
		Comments: []Comment{{ID: 1, Body: "나중 댓글", Author: "bob", CreatedAt: at("2026-01-02T09:00:00Z")}},
	}
	secondSource = Source{
		Issue: Issue{Number: 4, Title: "둘째 노트", Body: "  둘째 본문 \n", Author: "carol", CreatedAt: at("2026-01-01T10:00:00Z")},
		Comments: []Comment{
			{ID: 2, Body: "중간 댓글", Author: "dave", CreatedAt: at("2026-01-01T11:00:00Z")},
			{ID: 3, Body: "   ", CreatedAt: at("2026-01-01T10:00:00Z")},
		},
	}
	undatedSource = Source{Issue: Issue{Number: 2}}
)

func TestEarliestIssue(t *testing.T) {
	if earliest, _ := EarliestIssue([]Source{secondSource, firstSource, undatedSource}); earliest.Number != 9 {
		t.Errorf("earliest = %d", earliest.Number)
	}
	if earliest, _ := EarliestIssue([]Source{undatedSource}); earliest.Number != 2 {
		t.Errorf("earliest undated = %d", earliest.Number)
	}
	if _, ok := EarliestIssue(nil); ok {
		t.Error("earliest of none")
	}
}

func TestMergeTimelineMatchesWeb(t *testing.T) {
	var got []string
	for _, entry := range MergeTimeline([]Source{secondSource, firstSource, undatedSource}) {
		kind := "body"
		if entry.Comment {
			kind = "comment"
		}
		got = append(got, fmt.Sprintf("%s %d %q", kind, entry.IssueNumber, entry.Body))
	}
	want := []string{
		`body 9 "첫 본문"`,
		`body 4 "  둘째 본문 \n"`,
		`comment 4 "   "`,
		`comment 4 "중간 댓글"`,
		`comment 9 "나중 댓글"`,
		`body 2 ""`,
	}
	if !slices.Equal(got, want) {
		t.Errorf("MergeTimeline =\n%s", strings.Join(got, "\n"))
	}
}

func TestFormatMergedBodyMatchesWeb(t *testing.T) {
	useSeoul(t)
	got := FormatMergedBody(MergeTimeline([]Source{secondSource, firstSource}))
	want := "## 2026-01-01 18:00:00 @alice\n\n첫 본문\n\n## 2026-01-01 19:00:00 @carol\n\n둘째 본문\n\n" +
		"## 2026-01-01 19:00:00\n\n_내용 없음_\n\n## 2026-01-01 20:00:00 @dave\n\n중간 댓글\n\n" +
		"## 2026-01-02 18:00:00 @bob\n\n나중 댓글"
	if got != want {
		t.Errorf("FormatMergedBody =\n%s", got)
	}
	if got := FormatMergeTimestamp(at("2026-12-31T23:59:59.999Z")); got != "2027-01-01 08:59:59" {
		t.Errorf("FormatMergeTimestamp = %q", got)
	}
	if got := FormatMergeTimestamp(time.Time{}); got != "알 수 없는 시각" {
		t.Errorf("FormatMergeTimestamp(zero) = %q", got)
	}
}

func TestAttachmentRawURLMatchesWeb(t *testing.T) {
	got := AttachmentRawURL("o/r", ".issue-note-assets/issues/9/한 글 (1)!*'~@:+&=$,;#?.png")
	want := "https://github.com/o/r/raw/ginote-assets/.issue-note-assets/issues/9/%ED%95%9C%20%EA%B8%80%20(1)!*'~%40%3A%2B%26%3D%24%2C%3B%23%3F.png"
	if got != want {
		t.Errorf("AttachmentRawURL = %s", got)
	}
}

func TestReplaceAttachmentURLsOnlyRewritesRawURLs(t *testing.T) {
	from := ".issue-note-assets/issues/9/old.png"
	to := ".issue-note-assets/issues/20/new.png"
	body := "![](" + AttachmentRawURL("o/r", from) + ") " + from
	want := "![](" + AttachmentRawURL("o/r", to) + ") " + from
	if got := ReplaceAttachmentURLs(body, "o/r", []PathReplacement{{from, to}}); got != want {
		t.Errorf("ReplaceAttachmentURLs = %s", got)
	}
}

// fakeAPI는 merge-notes.test.js의 vi.mock과 같은 가짜 GitHub다.
type fakeAPI struct {
	issues       map[int]Issue
	comments     map[int][]Comment
	attachments  map[int][]Attachment
	getErr       map[int]error
	uploadErr    error
	updateErr    error
	stateErr     map[int]error
	created      []string // "title|labels"
	uploads      []string // "number|name|type"
	updated      []Issue
	stateChanges []string // "number state"
}

func newFakeAPI() *fakeAPI {
	photo := ".issue-note-assets/issues/2/photo.png"
	return &fakeAPI{
		issues: map[int]Issue{
			1: {ID: 10, Number: 1, Title: "먼저 쓴 노트", Body: "첫 본문", Labels: []string{"work", "ginote:pin"}, CreatedAt: at("2026-09-01T00:00:00Z")},
			2: {ID: 20, Number: 2, Title: "나중 노트", Body: "![사진](" + AttachmentRawURL("octo/notes", photo) + ")", Labels: []string{"Work", "home"}, CreatedAt: at("2026-09-02T00:00:00Z")},
		},
		comments:    map[int][]Comment{1: {{ID: 5, Body: "첫 댓글", CreatedAt: at("2026-09-03T00:00:00Z")}}},
		attachments: map[int][]Attachment{2: {{Name: "photo.png", Path: photo, Type: "image/png"}}},
		getErr:      map[int]error{},
		stateErr:    map[int]error{},
	}
}

func (f *fakeAPI) GetIssue(_ context.Context, number int) (Issue, error) {
	if err := f.getErr[number]; err != nil {
		return Issue{}, err
	}
	return f.issues[number], nil
}

func (f *fakeAPI) ListIssueComments(_ context.Context, number int) ([]Comment, error) {
	return f.comments[number], nil
}

func (f *fakeAPI) ListAllIssueAttachmentFiles(_ context.Context, number int) ([]Attachment, error) {
	return f.attachments[number], nil
}

func (f *fakeAPI) DownloadAttachment(context.Context, Attachment) ([]byte, string, error) {
	return []byte("png"), "", nil
}

func (f *fakeAPI) UploadAttachment(_ context.Context, number int, name, contentType string, _ []byte) (Attachment, error) {
	if f.uploadErr != nil {
		return Attachment{}, f.uploadErr
	}
	f.uploads = append(f.uploads, fmt.Sprintf("%d|%s|%s", number, name, contentType))
	return Attachment{Name: name, Path: fmt.Sprintf(".issue-note-assets/issues/%d/copied-%s", number, name)}, nil
}

func (f *fakeAPI) CreateIssue(_ context.Context, title, _ string, labels []string) (Issue, error) {
	f.created = append(f.created, title+"|"+strings.Join(labels, ","))
	return Issue{ID: 900, Number: 90}, nil
}

func (f *fakeAPI) UpdateIssue(_ context.Context, number int, title, body string, labels []string) (Issue, error) {
	if f.updateErr != nil {
		return Issue{}, f.updateErr
	}
	issue := Issue{ID: 900, Number: number, Title: title, Body: body, Labels: labels}
	f.updated = append(f.updated, issue)
	return issue, nil
}

func (f *fakeAPI) SetIssueState(_ context.Context, number int, state string) error {
	f.stateChanges = append(f.stateChanges, strconv.Itoa(number)+" "+state)
	if err := f.stateErr[number]; err != nil {
		delete(f.stateErr, number) // mockRejectedValueOnce
		return err
	}
	return nil
}

func TestMergeIssuesCreatesNoteCopiesAttachmentsAndClosesSources(t *testing.T) {
	api := newFakeAPI()
	result, err := MergeIssues(context.Background(), api, "octo/notes", []int{2, 1}, "")
	if err != nil {
		t.Fatal(err)
	}
	// 대소문자만 다른 태그는 뒤에 나온 표기를 쓴다. 고정 라벨은 빠진다.
	if !slices.Equal(api.created, []string{"먼저 쓴 노트|work,home"}) {
		t.Errorf("created = %v", api.created)
	}
	if !slices.Equal(api.uploads, []string{"90|photo.png|image/png"}) {
		t.Errorf("uploads = %v", api.uploads)
	}
	saved := api.updated[0]
	if saved.Number != 90 || !strings.Contains(saved.Body, "첫 본문") || !strings.Contains(saved.Body, "첫 댓글") ||
		!strings.Contains(saved.Body, "issues/90/copied-photo.png") || strings.Contains(saved.Body, "issues/2/photo.png") {
		t.Errorf("saved = %+v", saved)
	}
	if !slices.Equal(api.stateChanges, []string{"2 closed", "1 closed"}) {
		t.Errorf("state changes = %v", api.stateChanges)
	}
	if result.Merged.Number != 90 || !slices.Equal(result.ClosedSourceIDs, []int64{20, 10}) || len(result.CloseFailures) != 0 {
		t.Errorf("result = %+v", result)
	}
}

func TestMergeIssuesReportsSourcesItCouldNotClose(t *testing.T) {
	api := newFakeAPI()
	api.stateErr[1] = errors.New("403")
	result, err := MergeIssues(context.Background(), api, "octo/notes", []int{1, 2}, "")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(result.CloseFailures, []int{1}) || !slices.Equal(result.ClosedSourceIDs, []int64{20}) {
		t.Errorf("result = %+v", result)
	}
}

func TestMergeIssuesStopsBeforeCreatingWhenSourceLoadFails(t *testing.T) {
	api := newFakeAPI()
	notFound := errors.New("Not Found")
	api.getErr[1] = notFound
	_, err := MergeIssues(context.Background(), api, "octo/notes", []int{1, 2}, "")
	var mergeErr *Error
	if !errors.As(err, &mergeErr) || mergeErr.DraftNumber != 0 || !errors.Is(err, notFound) {
		t.Fatalf("err = %v", err)
	}
	if len(api.created) != 0 || len(api.stateChanges) != 0 {
		t.Errorf("created %v, state %v", api.created, api.stateChanges)
	}
}

func TestMergeIssuesStopsBeforeCreatingWhenBodyTooLong(t *testing.T) {
	api := newFakeAPI()
	for number, issue := range api.issues {
		issue.Body = strings.Repeat("x", MaxIssueBodyLength)
		api.issues[number] = issue
	}
	_, err := MergeIssues(context.Background(), api, "octo/notes", []int{1, 2}, "")
	var tooLong *TooLongError
	var mergeErr *Error
	if !errors.As(err, &tooLong) || !errors.As(err, &mergeErr) || mergeErr.DraftNumber != 0 {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(err.Error(), strconv.Itoa(MaxIssueBodyLength)) || MaxIssueBodyLength != 58982 {
		t.Errorf("message = %q", err.Error())
	}
	if len(api.created) != 0 {
		t.Errorf("created %v", api.created)
	}
}

func TestMergeIssuesTrashesDraftWhenLaterStepFails(t *testing.T) {
	api := newFakeAPI()
	api.uploadErr = errors.New("upload failed")
	_, err := MergeIssues(context.Background(), api, "octo/notes", []int{1, 2}, "")
	var mergeErr *Error
	if !errors.As(err, &mergeErr) || mergeErr.DraftNumber != 90 || err.Error() != "upload failed" {
		t.Fatalf("err = %v", err)
	}
	if !slices.Equal(api.stateChanges, []string{"90 closed"}) || len(api.updated) != 0 {
		t.Errorf("state %v, updated %v", api.stateChanges, api.updated)
	}
}

func TestMergeIssuesKeepsOriginalCauseWhenDraftCannotClose(t *testing.T) {
	api := newFakeAPI()
	api.updateErr = errors.New("save failed")
	api.stateErr[90] = errors.New("close failed")
	_, err := MergeIssues(context.Background(), api, "octo/notes", []int{1, 2}, "")
	var mergeErr *Error
	if !errors.As(err, &mergeErr) || mergeErr.DraftNumber != 90 || err.Error() != "save failed" {
		t.Fatalf("err = %v", err)
	}
}

func TestMergeIssuesUsesFallbackTitle(t *testing.T) {
	api := newFakeAPI()
	issue := api.issues[1]
	issue.Title = ""
	api.issues[1] = issue
	if _, err := MergeIssues(context.Background(), api, "octo/notes", []int{1, 2}, ""); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(api.created[0], DefaultTitle+"|") {
		t.Errorf("created = %v", api.created)
	}
}

func TestMaxIssueBodyLengthCountsUTF16(t *testing.T) {
	if utf16Length("😀가a") != 4 {
		t.Error("utf16Length")
	}
}
