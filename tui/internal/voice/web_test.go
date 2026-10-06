package voice

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

// testdata/web.json은 testdata/gen.mjs가 원본 JS 함수(src/lib의 음성 모듈과 NoteEditor.svelte의
// 음성 도우미)를 node로 실행해 만든 기대값이다. JS를 고치면 gen.mjs를 다시 실행한다.
type webTag struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type webRefinement struct {
	Title string   `json:"title"`
	Body  string   `json:"body"`
	Tags  []string `json:"tags"`
}

type webField struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Filename string `json:"filename"`
	Type     string `json:"type"`
}

type webLists struct {
	Transcription []string `json:"transcription"`
	Refinement    []string `json:"refinement"`
}

type webData struct {
	RefineRequests []struct {
		Transcript, Prompt, Model, URL, Method, Body string
		Tags                                         []webTag
		Headers                                      map[string]string
	}
	RefineResponses []struct {
		Transcript string
		Tags       []webTag
		Payload    json.RawMessage
		Result     webRefinement
	}
	TranscribeRequests []struct {
		Type, Model, Language, Hints, URL, Method, Result string
		Payload                                           json.RawMessage
		Headers                                           map[string]string
		Fields                                            []webField
	}
	ListModels []struct {
		Payload json.RawMessage
		Result  []string
	}
	Errors []struct {
		Status int
		Body   string
		Result struct{ Error string }
	}
	Upgrade  []struct{ Input, Result string }
	Classify struct {
		Input  []string
		Result webLists
	}
	WithSelected []struct {
		Lists    webLists
		Selected struct{ TranscriptionModel, RefinementModel string }
		Result   webLists
	}
	Dated []struct {
		Input  string
		Result bool
	}
	Unique   struct{ Input, Result []string }
	Mask     []struct{ Input, Result string }
	Defaults struct {
		TranscriptionModel, RefinementModel, RefinementPrompt string
		Presets                                               []string
		ModelLists                                            webLists
		Legacy                                                struct{ Typo, Written, Conclusion []string }
	}
	Paragraphs      []struct{ Input, Result string }
	SuggestedTitles []struct{ Input, Result string }
	KnownTags       []struct{ Selected, Labels, Result []string }
	Compose         []struct {
		TitleMode, Body, SuggestedTitle string
		Result                          struct{ Title, Body string }
	}
	AudioFiles      []struct{ Type, ISO, Name, FileType string }
	AttachmentLinks []struct{ Repo, Path, Link, Appended string }
	AppendText      []struct{ Source, Transcript, Result string }
	CommentHelpers  []struct {
		Body, Markup, Editing string
		Sources, Paths        []string
	}
	RawPaths     []struct{ Input, Result string }
	CommentEdits []struct {
		Body, Transcript, AttachmentLink, Result string
		Edited, Updated                          *string
	}
}

func loadWeb(t *testing.T) webData {
	t.Helper()
	data, err := os.ReadFile("testdata/web.json")
	if err != nil {
		t.Fatal(err)
	}
	var web webData
	if err := json.Unmarshal(data, &web); err != nil {
		t.Fatal(err)
	}
	if len(web.RefineRequests) == 0 || len(web.RefineResponses) == 0 || len(web.TranscribeRequests) == 0 || len(web.CommentEdits) == 0 || len(web.Upgrade) == 0 || len(web.Classify.Result.Refinement) == 0 {
		t.Fatal("testdata/web.json is incomplete")
	}
	return web
}

func tagsOf(tags []webTag) []Tag {
	converted := make([]Tag, len(tags))
	for index, tag := range tags {
		converted[index] = Tag{Name: tag.Name, Description: tag.Description}
	}
	return converted
}

// fakeOpenAI는 OPENAI_BASE_URL로 가리키는 가짜 서버다. 받은 요청을 기록하고 정해 둔 응답을 낸다.
type fakeOpenAI struct {
	requests []*http.Request
	bodies   [][]byte
	replies  []fakeReply
}

type fakeReply struct {
	status int
	body   string
}

func newFakeOpenAI(t *testing.T, replies ...fakeReply) (*fakeOpenAI, *Client) {
	t.Helper()
	fake := &fakeOpenAI{replies: replies}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		fake.requests = append(fake.requests, r)
		fake.bodies = append(fake.bodies, body)
		reply := fake.replies[0]
		if len(fake.replies) > 1 {
			fake.replies = fake.replies[1:]
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(reply.status)
		_, _ = io.WriteString(w, reply.body)
	}))
	t.Cleanup(server.Close)
	t.Setenv("OPENAI_BASE_URL", server.URL+"/v1/")
	return fake, NewClient("sk-test")
}

func requestPath(t *testing.T, raw string) string {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed.Path
}

func TestNewClientUsesDefaultBaseURL(t *testing.T) {
	t.Setenv("OPENAI_BASE_URL", "")
	if client := NewClient("k"); client.BaseURL != "https://api.openai.com/v1" || client.HTTP.Timeout == 0 {
		t.Errorf("client = %+v", client)
	}
}

func TestRefineRequestsMatchWeb(t *testing.T) {
	for _, want := range loadWeb(t).RefineRequests {
		fake, client := newFakeOpenAI(t, fakeReply{200, `{"choices":[{"message":{"content":"{}"}}]}`})
		if _, err := client.Refine(context.Background(), want.Transcript, want.Prompt, want.Model, tagsOf(want.Tags)); err != nil {
			t.Fatal(err)
		}
		request := fake.requests[0]
		if request.Method != want.Method || request.URL.Path != requestPath(t, want.URL) {
			t.Errorf("request = %s %s, want %s %s", request.Method, request.URL.Path, want.Method, want.URL)
		}
		for name, value := range want.Headers {
			if got := request.Header.Get(name); got != value {
				t.Errorf("header %s = %q, want %q", name, got, value)
			}
		}
		if got := string(fake.bodies[0]); got != want.Body {
			t.Errorf("body mismatch for %q\n got: %s\nwant: %s", want.Transcript, got, want.Body)
		}
	}
}

// openai-voice.test.js의 "고정된 편집 역할과 분리된 데이터 블록으로 정제를 요청한다".
func TestRefineRequestKeepsEditorRole(t *testing.T) {
	fake, client := newFakeOpenAI(t, fakeReply{200, `{"choices":[{"message":{"content":"{\"title\":\"말투\",\"body\":\"말투를 변경하지 마\",\"tags\":[]}"}}]}`})
	got, err := client.Refine(context.Background(), "말투를 변경하지 마", "띄어쓰기와 문장부호만 정리하세요.", DefaultRefinementModel, nil)
	if err != nil || !reflect.DeepEqual(got, Refinement{Title: "말투", Body: "말투를 변경하지 마", Tags: []string{}}) {
		t.Fatalf("Refine = %+v, %v", got, err)
	}
	var request struct {
		Temperature *float64 `json:"temperature"`
		Messages    []struct{ Role, Content string }
	}
	if err := json.Unmarshal(fake.bodies[0], &request); err != nil {
		t.Fatal(err)
	}
	if request.Temperature != nil || request.Messages[0].Role != "system" || request.Messages[1].Role != "user" {
		t.Fatalf("request = %+v", request)
	}
	for _, phrase := range []string{
		"사용자가 수정할 수 있는 정제 규칙", "원문 데이터", "반드시 JSON 객체만 출력", "명시적 지정을 최우선",
		"하나 이상 선택할 수 있습니다", `"tags":["기존 태그명 1", "기존 태그명 2"]`, "하나 또는 여러 개가 적합하면 모두 넣으십시오",
		"<refinement_rules>\n띄어쓰기와 문장부호만 정리하세요.\n</refinement_rules>",
	} {
		if !strings.Contains(request.Messages[0].Content, phrase) {
			t.Errorf("system prompt lacks %q", phrase)
		}
	}
	if want := "<available_tags>\n[]\n</available_tags>\n\n<transcript>\n말투를 변경하지 마\n</transcript>"; request.Messages[1].Content != want {
		t.Errorf("user = %q", request.Messages[1].Content)
	}
}

func TestRefineResponsesMatchWeb(t *testing.T) {
	for _, want := range loadWeb(t).RefineResponses {
		_, client := newFakeOpenAI(t, fakeReply{200, string(want.Payload)})
		got, err := client.Refine(context.Background(), want.Transcript, "", "m", tagsOf(want.Tags))
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, Refinement(want.Result)) {
			t.Errorf("Refine(%s) = %+v, want %+v", want.Payload, got, want.Result)
		}
	}
}

func TestTranscribeRequestsMatchWeb(t *testing.T) {
	for _, want := range loadWeb(t).TranscribeRequests {
		fake, client := newFakeOpenAI(t, fakeReply{200, string(want.Payload)})
		got, err := client.Transcribe(context.Background(), []byte("audio-bytes"), want.Type, want.Model, want.Language, want.Hints)
		if err != nil || got != want.Result {
			t.Fatalf("Transcribe = %q, %v, want %q", got, err, want.Result)
		}
		request := fake.requests[0]
		if request.Method != want.Method || request.URL.Path != requestPath(t, want.URL) {
			t.Errorf("request = %s %s", request.Method, request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != want.Headers["Authorization"] {
			t.Errorf("Authorization = %q", got)
		}
		mediaType, params, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
		if err != nil || mediaType != "multipart/form-data" {
			t.Fatalf("content type = %q", request.Header.Get("Content-Type"))
		}
		reader := multipart.NewReader(strings.NewReader(string(fake.bodies[0])), params["boundary"])
		var fields []webField
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
			value, _ := io.ReadAll(part)
			field := webField{Name: part.FormName(), Value: string(value), Filename: part.FileName()}
			if field.Filename != "" {
				field.Type = part.Header.Get("Content-Type")
			}
			fields = append(fields, field)
		}
		expected := append([]webField{}, want.Fields...)
		for index := range expected {
			// 브라우저 FormData는 형식이 빈 Blob을 application/octet-stream으로 보낸다.
			if expected[index].Filename != "" && expected[index].Type == "" {
				expected[index].Type = "application/octet-stream"
			}
		}
		if !reflect.DeepEqual(fields, expected) {
			t.Errorf("fields = %+v\nwant %+v", fields, expected)
		}
	}
}

func TestListModelsAndErrorsMatchWeb(t *testing.T) {
	web := loadWeb(t)
	for _, want := range web.ListModels {
		fake, client := newFakeOpenAI(t, fakeReply{200, string(want.Payload)})
		got, err := client.ListModels(context.Background())
		if err != nil || !reflect.DeepEqual(got, want.Result) {
			t.Errorf("ListModels(%s) = %q, %v, want %q", want.Payload, got, err, want.Result)
		}
		if request := fake.requests[0]; request.Method != http.MethodGet || request.URL.Path != "/v1/models" || request.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("request = %s %s %v", request.Method, request.URL.Path, request.Header)
		}
	}
	for _, want := range web.Errors {
		_, client := newFakeOpenAI(t, fakeReply{want.Status, want.Body})
		_, err := client.ListModels(context.Background())
		apiError, ok := err.(*APIError)
		if !ok || apiError.Error() != want.Result.Error || apiError.Status != want.Status {
			t.Errorf("error for %d %s = %v, want %q", want.Status, want.Body, err, want.Result.Error)
		}
	}
}

func TestOKResponseThatIsNotJSONFails(t *testing.T) {
	_, client := newFakeOpenAI(t, fakeReply{200, "<html>"})
	if _, err := client.ListModels(context.Background()); err == nil || err.Error() != "OpenAI 응답을 읽지 못했습니다. (200)" {
		t.Errorf("err = %v", err)
	}
}

func TestSettingsMatchWeb(t *testing.T) {
	web := loadWeb(t)
	defaults := web.Defaults
	if DefaultTranscriptionModel != defaults.TranscriptionModel || DefaultRefinementModel != defaults.RefinementModel || DefaultRefinementPrompt != defaults.RefinementPrompt {
		t.Error("defaults differ from voice-settings.js")
	}
	if got := []string{RefinementPresets[0].Prompt, RefinementPresets[1].Prompt, RefinementPresets[2].Prompt}; !reflect.DeepEqual(got, defaults.Presets) {
		t.Error("presets differ from voice-settings.js")
	}
	if !reflect.DeepEqual(SupersededTypoPrompts, defaults.Legacy.Typo) || !reflect.DeepEqual(SupersededWrittenPrompts, defaults.Legacy.Written) || !reflect.DeepEqual(SupersededConclusionPrompts, defaults.Legacy.Conclusion) {
		t.Error("legacy prompts differ from voice-refinement-legacy-prompts.js")
	}
	if got := DefaultModelLists(); !reflect.DeepEqual(webLists{got.Transcription, got.Refinement}, defaults.ModelLists) {
		t.Errorf("DefaultModelLists = %+v", got)
	}
	for _, want := range web.Upgrade {
		if got := UpgradeRefinementPrompt(want.Input); got != want.Result {
			t.Errorf("UpgradeRefinementPrompt(%.40q) = %.40q, want %.40q", want.Input, got, want.Result)
		}
	}
	if got := ClassifyModels(web.Classify.Input); !reflect.DeepEqual(webLists{got.Transcription, got.Refinement}, web.Classify.Result) {
		t.Errorf("ClassifyModels = %+v\nwant %+v", got, web.Classify.Result)
	}
	for _, want := range web.WithSelected {
		original := ModelLists{Transcription: want.Lists.Transcription, Refinement: want.Lists.Refinement}
		snapshot := append([]string{}, original.Transcription...)
		got := WithSelectedModels(original, want.Selected.TranscriptionModel, want.Selected.RefinementModel)
		if !reflect.DeepEqual(webLists{got.Transcription, got.Refinement}, want.Result) {
			t.Errorf("WithSelectedModels = %+v, want %+v", got, want.Result)
		}
		if !reflect.DeepEqual(original.Transcription, snapshot) {
			t.Error("WithSelectedModels changed its input")
		}
	}
	for _, want := range web.Dated {
		if got := IsDatedModelSnapshot(want.Input); got != want.Result {
			t.Errorf("IsDatedModelSnapshot(%q) = %v", want.Input, got)
		}
	}
	if got := UniqueModels(web.Unique.Input); !reflect.DeepEqual(got, web.Unique.Result) {
		t.Errorf("UniqueModels = %q, want %q", got, web.Unique.Result)
	}
	for _, want := range web.Mask {
		if got := MaskAPIKey(want.Input); got != want.Result {
			t.Errorf("MaskAPIKey(%q) = %q, want %q", want.Input, got, want.Result)
		}
	}
}

// voice-settings.test.js의 저장값 정리 사례.
func TestSettingsNormalize(t *testing.T) {
	got := Settings{APIKey: " sk-test ", RefinementPrompt: "  용어를 유지하세요.  ", TranscriptionModel: "  ", RefinementModel: " future-text-model ", PreserveOriginalAudio: true}.Normalize()
	want := Settings{APIKey: "sk-test", RefinementPrompt: "용어를 유지하세요.", TranscriptionModel: "", RefinementModel: "future-text-model", PreserveOriginalAudio: true}
	if got != want {
		t.Errorf("Normalize = %+v", got)
	}
	if got := (Settings{}).Normalize().RefinementPrompt; got != DefaultRefinementPrompt {
		t.Errorf("empty prompt = %.30q", got)
	}
	edited := SupersededWrittenPrompts[len(SupersededWrittenPrompts)-1] + "\n- 숫자는 아라비아 숫자로 씁니다."
	if got := (Settings{RefinementPrompt: edited}).Normalize().RefinementPrompt; got != edited {
		t.Error("edited prompt was replaced")
	}
	if got := (Settings{RefinementPrompt: SupersededConclusionPrompts[len(SupersededConclusionPrompts)-1]}).Normalize().RefinementPrompt; got != ConclusionFocusedRefinementPrompt {
		t.Error("superseded preset was not upgraded")
	}
	if got := DefaultSettings(); got.TranscriptionModel != "gpt-transcribe" || got.RefinementModel != "gpt-5.6-luna" || got.PreserveOriginalAudio || got.APIKey != "" {
		t.Errorf("DefaultSettings = %+v", got)
	}
	if labels := []string{RefinementPresets[0].Label, RefinementPresets[1].Label, RefinementPresets[2].Label}; !reflect.DeepEqual(labels, []string{"약함", "중간", "강함"}) {
		t.Errorf("labels = %q", labels)
	}
}

func TestVoiceNotesMatchWeb(t *testing.T) {
	web := loadWeb(t)
	for _, want := range web.Paragraphs {
		if got := NormalizeParagraphs(want.Input); got != want.Result {
			t.Errorf("NormalizeParagraphs(%q) = %q, want %q", want.Input, got, want.Result)
		}
	}
	for _, want := range web.SuggestedTitles {
		if got := NormalizeSuggestedTitle(want.Input); got != want.Result {
			t.Errorf("NormalizeSuggestedTitle(%q) = %q, want %q", want.Input, got, want.Result)
		}
	}
	for _, want := range web.KnownTags {
		if got := KnownTagNames(want.Selected, want.Labels); !reflect.DeepEqual(got, want.Result) {
			t.Errorf("KnownTagNames(%q) = %q, want %q", want.Selected, got, want.Result)
		}
	}
	for _, want := range web.Compose {
		title, body := ComposeIssue(want.TitleMode, want.Body, want.SuggestedTitle)
		if title != want.Result.Title || body != want.Result.Body {
			t.Errorf("ComposeIssue(%q, %q, %q) = %q, %q, want %+v", want.TitleMode, want.Body, want.SuggestedTitle, title, body, want.Result)
		}
	}
	for _, want := range web.AudioFiles {
		now, err := time.Parse(time.RFC3339Nano, want.ISO)
		if err != nil {
			t.Fatal(err)
		}
		if name, fileType := AudioFile(want.Type, now.In(time.FixedZone("KST", 9*3600))); name != want.Name || fileType != want.FileType {
			t.Errorf("AudioFile(%q) = %q, %q, want %q, %q", want.Type, name, fileType, want.Name, want.FileType)
		}
	}
	for _, want := range web.AttachmentLinks {
		if got := AttachmentLink(want.Repo, want.Path); got != want.Link {
			t.Errorf("AttachmentLink = %q, want %q", got, want.Link)
		}
		if got := AppendAttachmentLink("본문", want.Repo, want.Path); got != want.Appended {
			t.Errorf("AppendAttachmentLink = %q, want %q", got, want.Appended)
		}
	}
	if AttachmentLink("o/n", "") != "" || AppendAttachmentLink("본문", "o/n", "") != "본문" {
		t.Error("link without attachment")
	}
}

func TestEditorHelpersMatchWeb(t *testing.T) {
	web := loadWeb(t)
	for _, want := range web.AppendText {
		if got := AppendText(want.Source, want.Transcript); got != want.Result {
			t.Errorf("AppendText(%q, %q) = %q, want %q", want.Source, want.Transcript, got, want.Result)
		}
	}
	for _, want := range web.CommentHelpers {
		if got := AudioMarkup(want.Body); got != want.Markup {
			t.Errorf("AudioMarkup(%q) = %q, want %q", want.Body, got, want.Markup)
		}
		if got := CommentTextForEditing(want.Body); got != want.Editing {
			t.Errorf("CommentTextForEditing(%q) = %q, want %q", want.Body, got, want.Editing)
		}
		if got := CommentAudioSources(want.Body); !reflect.DeepEqual(got, want.Sources) {
			t.Errorf("CommentAudioSources(%q) = %q, want %q", want.Body, got, want.Sources)
		}
		for index, source := range want.Sources {
			if got := AttachmentPathFromRawURL(source); got != want.Paths[index] {
				t.Errorf("AttachmentPathFromRawURL(%q) = %q, want %q", source, got, want.Paths[index])
			}
		}
	}
	for _, want := range web.RawPaths {
		if got := AttachmentPathFromRawURL(want.Input); got != want.Result {
			t.Errorf("AttachmentPathFromRawURL(%q) = %q, want %q", want.Input, got, want.Result)
		}
	}
	if got := AttachmentPathFromRawURL("https://github.com/o/n/raw/ginote-assets/a%ZZ"); got != "" {
		t.Errorf("malformed escape = %q", got)
	}
	for _, want := range web.CommentEdits {
		if want.Updated != nil {
			if got := CommentBodyFromEditing(want.Body, *want.Edited); got != *want.Updated {
				t.Errorf("CommentBodyFromEditing(%q, %q) = %q, want %q", want.Body, *want.Edited, got, *want.Updated)
			}
			continue
		}
		if got := AppendToComment(want.Body, want.Transcript, want.AttachmentLink); got != want.Result {
			t.Errorf("AppendToComment(%q, %q, %q) = %q, want %q", want.Body, want.Transcript, want.AttachmentLink, got, want.Result)
		}
	}
}

func TestTranscriptionHintHelpers(t *testing.T) {
	if got := TranscriptionPrompt("  Ginote, 지델\n"); got != "Ginote, 지델" {
		t.Errorf("TranscriptionPrompt = %q", got)
	}
	cases := map[string]string{"zh-CN": "zh", " KO ": "ko", "": "", "en-US-x": "en"}
	for input, want := range cases {
		if got := LanguageHint(input); got != want {
			t.Errorf("LanguageHint(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestProcessRetriesOnceAndRefines(t *testing.T) {
	fake, client := newFakeOpenAI(t,
		fakeReply{500, `{"error":{"message":"일시 오류"}}`},
		fakeReply{200, `{"text":" 회의 일정을 정리했다. "}`},
		fakeReply{200, `{"choices":[{"message":{"content":"{\"title\":\"회의\",\"body\":\"회의 일정을 정리했다.\",\"tags\":[\"업무\"]}"}}]}`},
	)
	var statuses []string
	settings := DefaultSettings()
	got, err := client.Process(context.Background(), []byte("a"), "audio/webm", settings, "ko", "", []Tag{{Name: "업무"}}, func(status string) { statuses = append(statuses, status) })
	if err != nil || !reflect.DeepEqual(got, Refinement{Title: "회의", Body: "회의 일정을 정리했다.", Tags: []string{"업무"}}) {
		t.Fatalf("Process = %+v, %v", got, err)
	}
	if want := []string{StatusTranscribing, "음성 전사에 실패해 한 번 더 시도하는 중…", StatusRefining}; !reflect.DeepEqual(statuses, want) {
		t.Errorf("statuses = %q", statuses)
	}
	if len(fake.requests) != 3 || fake.requests[2].URL.Path != "/v1/chat/completions" {
		t.Errorf("requests = %d", len(fake.requests))
	}
}

func TestProcessWithoutRefinementModel(t *testing.T) {
	fake, client := newFakeOpenAI(t, fakeReply{200, `{"text":"원문"}`})
	settings := DefaultSettings()
	settings.RefinementModel = "  "
	got, err := client.Process(context.Background(), []byte("a"), "", settings, "", "", nil, nil)
	if err != nil || got.Body != "원문" || got.Title != "" || len(got.Tags) != 0 || len(fake.requests) != 1 {
		t.Fatalf("Process = %+v, %v", got, err)
	}
}

func TestProcessErrors(t *testing.T) {
	_, client := newFakeOpenAI(t, fakeReply{200, `{"text":"  "}`})
	if _, err := client.Process(context.Background(), nil, "", DefaultSettings(), "", "", nil, nil); err == nil || err.Error() != NoTranscriptMessage {
		t.Errorf("empty transcript err = %v", err)
	}
	_, client = newFakeOpenAI(t, fakeReply{200, `{"text":"태그로 해줘"}`}, fakeReply{200, `{"choices":[{"message":{"content":"{\"title\":\"\",\"body\":\"\",\"tags\":[]}"}}]}`})
	if _, err := client.Process(context.Background(), nil, "", DefaultSettings(), "", "", nil, nil); err == nil || err.Error() != EmptyRefinementMessage {
		t.Errorf("empty refinement err = %v", err)
	}
	fake, client := newFakeOpenAI(t, fakeReply{401, `{"error":{"message":"Incorrect API key provided"}}`})
	if _, err := client.Process(context.Background(), nil, "", DefaultSettings(), "", "", nil, nil); err == nil || err.Error() != "Incorrect API key provided" || len(fake.requests) != 2 {
		t.Errorf("api error = %v after %d requests", err, len(fake.requests))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.Process(ctx, nil, "", DefaultSettings(), "", "", nil, nil); err != context.Canceled {
		t.Errorf("canceled err = %v", err)
	}
}
