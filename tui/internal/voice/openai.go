package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"slices"
	"strings"
	"time"
)

// DefaultBaseURL은 OPENAI_API_ROOT다. 테스트는 OPENAI_BASE_URL로 바꾼다.
const DefaultBaseURL = "https://api.openai.com/v1"

// 응답 본문은 이 크기까지만 읽는다. 전사·정제·모델 목록 응답은 이보다 훨씬 작다.
const maxResponseBytes = 16 << 20

// refinementResponseFormat은 REFINEMENT_RESPONSE_SCHEMA를 담은 response_format을
// JSON.stringify한 글자 그대로다.
const refinementResponseFormat = `{"type":"json_schema","json_schema":{"name":"voice_transcript_refinement","strict":true,"schema":{"type":"object","additionalProperties":false,"properties":{"title":{"type":"string"},"body":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["title","body","tags"]}}}`

// Client는 OpenAI 음성 API(전사·정제·모델 목록) 호출기다.
type Client struct {
	APIKey  string
	BaseURL string
	HTTP    *http.Client
}

// NewClient는 기본 주소(OPENAI_BASE_URL이 있으면 그 값)를 쓰는 호출기다. 긴 녹음의 전사가
// 오래 걸릴 수 있어 전체 시간 제한을 넉넉히 두고, 취소는 ctx로 한다.
func NewClient(apiKey string) *Client {
	base := DefaultBaseURL
	if custom := strings.TrimRight(os.Getenv("OPENAI_BASE_URL"), "/"); custom != "" {
		base = custom
	}
	return &Client{APIKey: apiKey, BaseURL: base, HTTP: &http.Client{Timeout: 3 * time.Minute}}
}

// APIError는 OpenAI가 실패 상태로 답한 요청이다. Message는 웹이 보여 주는 문구와 같다.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return e.Message }

func (c *Client) do(ctx context.Context, method, path, contentType string, body io.Reader) (map[string]any, error) {
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.BaseURL, "/")+path, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+c.APIKey)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	client := c.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("OpenAI에 연결하지 못했습니다. (%w)", err)
	}
	defer response.Body.Close()
	return readResponse(response)
}

// readResponse는 readResponse(src/lib/openai-voice.js)다. 실패 응답이면 error.message를,
// 없으면 상태 코드를 담은 문구를 오류로 돌려준다.
func readResponse(response *http.Response) (map[string]any, error) {
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	ok := response.StatusCode >= 200 && response.StatusCode < 300
	if ok {
		var payload any
		if err != nil || json.Unmarshal(data, &payload) != nil {
			return nil, fmt.Errorf("OpenAI 응답을 읽지 못했습니다. (%d)", response.StatusCode)
		}
		object, _ := payload.(map[string]any)
		return object, nil
	}
	message := ""
	var payload struct {
		Error struct {
			Message any `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(data, &payload) == nil && jsTruthy(payload.Error.Message) {
		message = jsString(payload.Error.Message)
	}
	if message == "" {
		message = fmt.Sprintf("OpenAI 요청에 실패했습니다. (%d)", response.StatusCode)
	}
	return nil, &APIError{Status: response.StatusCode, Message: message}
}

// LanguageHint는 앱 언어를 Transcriptions API의 ISO 639-1 코드로 줄인다("zh-CN" → "zh").
func LanguageHint(language string) string {
	head, _, _ := strings.Cut(jsTrim(language), "-")
	return localeLower(head)
}

// TranscriptionPrompt는 저장소의 전사 힌트를 전사 요청의 prompt로 바꾼다. 앞뒤 공백만 빼고,
// 비면 prompt를 보내지 않는다.
func TranscriptionPrompt(hints string) string { return jsTrim(hints) }

// RecordingExtension은 녹음 형식의 확장자다. 형식에 mp4가 들어 있으면 mp4, 아니면 webm이다.
func RecordingExtension(contentType string) string {
	if strings.Contains(contentType, "mp4") {
		return "mp4"
	}
	return "webm"
}

// Transcribe는 transcribeAudio다. multipart 필드 순서는 model, language(있을 때), prompt(있을
// 때), response_format, file이다. model은 받은 그대로 보낸다.
func (c *Client) Transcribe(ctx context.Context, audio []byte, contentType, model, language, hints string) (string, error) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	fields := [][2]string{{"model", model}}
	if hint := LanguageHint(language); hint != "" {
		fields = append(fields, [2]string{"language", hint})
	}
	if prompt := TranscriptionPrompt(hints); prompt != "" {
		fields = append(fields, [2]string{"prompt", prompt})
	}
	fields = append(fields, [2]string{"response_format", "json"})
	for _, field := range fields {
		if err := form.WriteField(field[0], field[1]); err != nil {
			return "", err
		}
	}
	// 브라우저 FormData처럼 파일 부분의 Content-Type은 녹음 형식이고, 없으면 octet-stream이다.
	partType := contentType
	if partType == "" {
		partType = "application/octet-stream"
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="recording.`+RecordingExtension(contentType)+`"`)
	header.Set("Content-Type", partType)
	part, err := form.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(audio); err != nil {
		return "", err
	}
	if err := form.Close(); err != nil {
		return "", err
	}
	payload, err := c.do(ctx, http.MethodPost, "/audio/transcriptions", form.FormDataContentType(), &body)
	if err != nil {
		return "", err
	}
	text := payload["text"]
	if !jsTruthy(text) {
		return "", nil
	}
	return jsTrim(jsString(text)), nil
}

// ListModels는 listAvailableVoiceModels다. /v1/models는 이 키로 쓸 수 있는 모델의 공식
// 목록이므로 캐시와 별개로 둔다. data의 각 id를 빈 값 없이 돌려준다.
func (c *Client) ListModels(ctx context.Context) ([]string, error) {
	payload, err := c.do(ctx, http.MethodGet, "/models", "", nil)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	data, _ := payload["data"].([]any)
	for _, model := range data {
		object, _ := model.(map[string]any)
		if id := object["id"]; jsTruthy(id) {
			if text := jsString(id); text != "" {
				ids = append(ids, text)
			}
		}
	}
	return ids, nil
}

// Tag는 정제 모델에 넘기는 기존 태그다. Description은 내용 분류를 돕는 설명이다.
type Tag struct {
	Name        string
	Description string
}

// Refinement는 정제 결과다. Tags는 넘긴 태그 중 모델이 고른 것의 원래 이름이다.
type Refinement struct {
	Title string
	Body  string
	Tags  []string
}

// normalizeAvailableTags는 같은 이름의 함수다. 이름·설명의 앞뒤 공백을 빼고, 빈 이름과
// 대소문자만 다른 중복은 뺀다.
func normalizeAvailableTags(tags []Tag) []Tag {
	normalized := []Tag{}
	seen := map[string]bool{}
	for _, tag := range tags {
		name := jsTrim(tag.Name)
		key := localeLower(name)
		if name == "" || seen[key] {
			continue
		}
		seen[key] = true
		normalized = append(normalized, Tag{Name: name, Description: jsTrim(tag.Description)})
	}
	return normalized
}

// tagsJSON은 JSON.stringify(normalizeAvailableTags(...))다. 설명이 없으면 description 키를 뺀다.
func tagsJSON(tags []Tag) string {
	items := make([]string, len(tags))
	for index, tag := range tags {
		item := `{"name":` + jsonString(tag.Name)
		if tag.Description != "" {
			item += `,"description":` + jsonString(tag.Description)
		}
		items[index] = item + "}"
	}
	return "[" + strings.Join(items, ",") + "]"
}

// RefinementSystemPrompt는 refinementSystemPrompt다. 전사문은 믿을 수 없는 내용이라 편집
// 역할은 사용자가 고칠 수 있는 규칙 밖에 고정한다.
func RefinementSystemPrompt(rules string) string {
	return refinementSystemPromptHead + rules + refinementSystemPromptTail
}

// RefinementInput은 refinementInput이다: 사용자 메시지의 태그·전사문 데이터 블록.
func RefinementInput(transcript string, tags []Tag) string {
	return "<available_tags>\n" + tagsJSON(normalizeAvailableTags(tags)) + "\n</available_tags>\n\n<transcript>\n" + transcript + "\n</transcript>"
}

// RefinementRequestBody는 refineTranscript가 /chat/completions에 보내는 JSON 본문 글자 그대로다.
func RefinementRequestBody(transcript, refinementPrompt, model string, tags []Tag) string {
	return `{"model":` + jsonString(model) +
		`,"messages":[{"role":"system","content":` + jsonString(RefinementSystemPrompt(jsTrim(refinementPrompt))) +
		`},{"role":"user","content":` + jsonString(RefinementInput(transcript, tags)) +
		`}],"response_format":` + refinementResponseFormat + `}`
}

// Refine은 refineTranscript다. 응답의 첫 선택지 내용(없으면 전사문)을 ParseRefinement로 읽는다.
func (c *Client) Refine(ctx context.Context, transcript, refinementPrompt, model string, tags []Tag) (Refinement, error) {
	body := RefinementRequestBody(transcript, refinementPrompt, model, tags)
	payload, err := c.do(ctx, http.MethodPost, "/chat/completions", "application/json", strings.NewReader(body))
	if err != nil {
		return Refinement{}, err
	}
	content := any(transcript)
	if choices, _ := payload["choices"].([]any); len(choices) > 0 {
		first, _ := choices[0].(map[string]any)
		message, _ := first["message"].(map[string]any)
		if value := message["content"]; jsTruthy(value) {
			content = value
		}
	}
	text := ""
	if jsTruthy(content) {
		text = jsString(content)
	}
	return ParseRefinement(text, tags), nil
}

// ParseRefinement는 parseRefinementResult다. JSON 객체가 아니거나 body가 문자열이 아니면
// 내용 전체를 본문으로 쓴다. 태그는 넘긴 태그 중 대소문자 무시로 일치하는 것만 원래 이름으로,
// 중복 없이 남긴다. 제목은 본문이 있을 때만 한 줄 50자(UTF-16 단위)로 줄인다.
func ParseRefinement(content string, availableTags []Tag) Refinement {
	fallback := Refinement{Body: jsTrim(content), Tags: []string{}}
	var parsed any
	if json.Unmarshal([]byte(content), &parsed) != nil {
		return fallback
	}
	object, ok := parsed.(map[string]any)
	if !ok {
		return fallback
	}
	body, ok := object["body"].(string)
	if !ok {
		return fallback
	}
	known := map[string]string{}
	for _, tag := range normalizeAvailableTags(availableTags) {
		known[localeLower(tag.Name)] = tag.Name
	}
	tags := []string{}
	if selected, ok := object["tags"].([]any); ok {
		for _, name := range selected {
			if match, ok := known[localeLower(jsString(name))]; ok && match != "" {
				if !slices.Contains(tags, match) {
					tags = append(tags, match)
				}
			}
		}
	}
	result := Refinement{Body: jsTrim(body), Tags: tags}
	if title, ok := object["title"].(string); ok && result.Body != "" {
		result.Title = sliceUTF16(collapseSpaces(title), suggestedTitleMaxLength)
	}
	return result
}
