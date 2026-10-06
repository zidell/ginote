package github

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// AttachmentBranch는 첨부를 담는 브랜치다(src/lib/attachments.js의 ATTACHMENT_BRANCH).
const AttachmentBranch = "ginote-assets"

const (
	attachmentStorageMarker        = ".issue-note-assets/.ginote-storage"
	attachmentStorageMarkerContent = "Ginote attachment storage. Do not delete this branch.\n"
	voiceHintsPath                 = ".issue-note-assets/voice-hints.json"
)

// AttachmentFile은 첨부 파일 하나다. Type은 올릴 때만 채운다(uploadAttachment의 type).
type AttachmentFile struct {
	Name string
	Type string
	Path string
	SHA  string
	Size int64
	URL  string
}

type Attachment = AttachmentFile

type contentEntry struct {
	Type    string `json:"type"`
	Name    string `json:"name"`
	Path    string `json:"path"`
	SHA     string `json:"sha"`
	Size    int64  `json:"size"`
	HTMLURL string `json:"html_url"`
}

func (e contentEntry) file() AttachmentFile {
	return AttachmentFile{Name: e.Name, Path: e.Path, SHA: e.SHA, Size: e.Size, URL: e.HTMLURL}
}

// SafeFileName은 safeFileName이다. 경로·URL에서 문제 되는 글자와 공백을 -로 바꾼다.
func SafeFileName(name string) string {
	var builder strings.Builder
	for _, character := range norm.NFC.String(name) {
		switch {
		case strings.ContainsRune(`\/:*?"<>|#%`, character), isJSSpace(character):
			builder.WriteByte('-')
		default:
			builder.WriteRune(character)
		}
	}
	// 연속한 -를 하나로 줄이고 양 끝의 -를 뗀다.
	collapsed := builder.String()
	for strings.Contains(collapsed, "--") {
		collapsed = strings.ReplaceAll(collapsed, "--", "-")
	}
	collapsed = strings.TrimPrefix(collapsed, "-")
	collapsed = strings.TrimSuffix(collapsed, "-")
	if collapsed == "" {
		return "attachment"
	}
	return collapsed
}

// jsTrim은 String.prototype.trim이다.
func jsTrim(value string) string {
	return strings.TrimFunc(value, isJSSpace)
}

// isJSSpace는 JS 정규식의 \s(trim이 지우는 공백과 같다)다. Go의 unicode.IsSpace와 달리 U+FEFF를 넣고 U+0085는 뺀다.
func isJSSpace(character rune) bool {
	if character == '\uFEFF' {
		return true
	}
	return character != '\u0085' && unicode.IsSpace(character)
}

// IssueAttachmentDirectory는 issueAttachmentDirectory다. commentID가 0이면 본문 첨부
// 폴더, 아니면 그 댓글 전용 하위 폴더다.
func IssueAttachmentDirectory(number int, commentID int64) (string, error) {
	if number <= 0 {
		return "", errors.New(msgIssueNumberRequired)
	}
	directory := fmt.Sprintf(".issue-note-assets/issues/%d", number)
	if commentID == 0 {
		return directory, nil
	}
	if commentID < 0 {
		return "", errors.New("A comment ID is required for comment attachments.")
	}
	return fmt.Sprintf("%s/comments/%d", directory, commentID), nil
}

// attachmentContentsPath는 첨부 브랜치에서 path를 읽는 Contents API 주소다.
func attachmentContentsPath(repo, path string) string {
	return "/repos/" + repo + "/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(AttachmentBranch)
}

func isMissingRef(err error) bool {
	status := StatusOf(err)
	return status == http.StatusNotFound || status == http.StatusConflict
}

func (c *Client) attachmentBranchExists(ctx context.Context, repo string) (bool, error) {
	err := c.get(ctx, "/repos/"+repo+"/git/ref/heads/"+AttachmentBranch, nil)
	if err == nil {
		return true, nil
	}
	if isMissingRef(err) {
		return false, nil
	}
	return false, err
}

func (c *Client) repositoryHasNoBranches(ctx context.Context, repo string) (bool, error) {
	var repository struct {
		DefaultBranch string `json:"default_branch"`
	}
	if err := c.get(ctx, "/repos/"+repo, &repository); err != nil {
		return false, err
	}
	branch := repository.DefaultBranch
	if branch == "" {
		branch = "main"
	}
	err := c.get(ctx, "/repos/"+repo+"/git/ref/heads/"+encodePath(branch), nil)
	if err == nil {
		return false, nil
	}
	if isMissingRef(err) {
		return true, nil
	}
	return false, err
}

func (c *Client) createAttachmentBranchRef(ctx context.Context, repo, sha string) error {
	_, err := c.request(ctx, http.MethodPost, "/repos/"+repo+"/git/refs", map[string]string{
		"ref": "refs/heads/" + AttachmentBranch,
		"sha": sha,
	}, nil)
	return err
}

// raceLost는 다른 창이 같은 브랜치를 먼저 만들어 ref 생성이 실패한 경우인지 본다.
func (c *Client) raceLost(ctx context.Context, repo string, err error) (bool, error) {
	status := StatusOf(err)
	if status != http.StatusConflict && status != http.StatusUnprocessableEntity {
		return false, nil
	}
	return c.attachmentBranchExists(ctx, repo)
}

// EnsureAttachmentBranch는 ensureAttachmentBranch다. 첨부 브랜치가 없으면 marker 파일
// 하나만 든 root commit으로 만든다(기본 브랜치 이력과 섞지 않는다).
func (c *Client) EnsureAttachmentBranch(ctx context.Context, repo string) error {
	exists, err := c.attachmentBranchExists(ctx, repo)
	if err != nil || exists {
		return err
	}

	var tree struct {
		SHA string `json:"sha"`
	}
	if _, err := c.request(ctx, http.MethodPost, "/repos/"+repo+"/git/trees", map[string]any{
		"tree": []map[string]string{{
			"path":    attachmentStorageMarker,
			"mode":    "100644",
			"type":    "blob",
			"content": attachmentStorageMarkerContent,
		}},
	}, &tree); err != nil {
		return err
	}
	var commit struct {
		SHA string `json:"sha"`
	}
	if _, err := c.request(ctx, http.MethodPost, "/repos/"+repo+"/git/commits", map[string]any{
		"message": "Initialize Ginote attachment storage",
		"tree":    tree.SHA,
		"parents": []string{},
	}, &commit); err != nil {
		return err
	}

	err = c.createAttachmentBranchRef(ctx, repo, commit.SHA)
	if err == nil {
		return nil
	}
	// 다른 창이 동시에 초기화한 경우 그 창이 만든 브랜치를 사용한다.
	if lost, checkErr := c.raceLost(ctx, repo, err); checkErr != nil {
		return checkErr
	} else if lost {
		return nil
	}
	// GitHub는 브랜치가 하나도 없는 빈 저장소에는 root commit ref도 만들지 못하게 한다.
	// 이 경우에만 marker로 기본 브랜치를 한 번 초기화한다.
	if StatusOf(err) != http.StatusUnprocessableEntity {
		return err
	}
	empty, checkErr := c.repositoryHasNoBranches(ctx, repo)
	if checkErr != nil {
		return checkErr
	}
	if !empty {
		return err
	}
	if _, putErr := c.request(ctx, http.MethodPut, "/repos/"+repo+"/contents/"+encodePath(attachmentStorageMarker), map[string]string{
		"message": "Initialize empty repository for Ginote attachment storage",
		"content": base64.StdEncoding.EncodeToString([]byte(attachmentStorageMarkerContent)),
	}, nil); putErr != nil {
		return putErr
	}
	retryErr := c.createAttachmentBranchRef(ctx, repo, commit.SHA)
	if retryErr == nil {
		return nil
	}
	if lost, checkErr := c.raceLost(ctx, repo, retryErr); checkErr != nil {
		return checkErr
	} else if lost {
		return nil
	}
	return retryErr
}

// randomUUID는 crypto.randomUUID()와 같은 v4 UUID 문자열이다.
func randomUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}

// UploadAttachment는 uploadAttachment다. commentID가 0이면 본문 첨부, 아니면 그 댓글의
// 첨부로 올린다. 같은 이름이 겹치지 않게 UUID를 앞에 붙인다.
func (c *Client) UploadAttachment(ctx context.Context, repoInput string, number int, name, contentType string, data []byte, commentID int64) (AttachmentFile, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return AttachmentFile{}, err
	}
	unique, err := randomUUID()
	if err != nil {
		return AttachmentFile{}, err
	}
	directory, err := IssueAttachmentDirectory(number, commentID)
	if err != nil {
		return AttachmentFile{}, err
	}
	path := directory + "/" + unique + "-" + SafeFileName(name)
	if err := c.EnsureAttachmentBranch(ctx, repo); err != nil {
		return AttachmentFile{}, err
	}
	var result struct {
		Content contentEntry `json:"content"`
	}
	if _, err := c.request(ctx, http.MethodPut, "/repos/"+repo+"/contents/"+encodePath(path), map[string]string{
		"message": "Add Ginote attachment: " + name,
		"content": base64.StdEncoding.EncodeToString(data),
		"branch":  AttachmentBranch,
	}, &result); err != nil {
		return AttachmentFile{}, err
	}
	return AttachmentFile{
		Name: name, Type: contentType, Path: path,
		SHA: result.Content.SHA, Size: result.Content.Size, URL: result.Content.HTMLURL,
	}, nil
}

// readDirectory는 첨부 브랜치의 폴더 하나를 읽는다. 없으면(404) 빈 목록, 파일이면 nil이다.
func (c *Client) readDirectory(ctx context.Context, repo, directory string) ([]contentEntry, error) {
	var raw json.RawMessage
	err := c.get(ctx, attachmentContentsPath(repo, directory), &raw)
	if StatusOf(err) == http.StatusNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !bytes.HasPrefix(bytes.TrimSpace(raw), []byte("[")) {
		return nil, nil
	}
	var entries []contentEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func (c *Client) listAttachmentDirectory(ctx context.Context, repo, directory string) ([]AttachmentFile, error) {
	entries, err := c.readDirectory(ctx, repo, directory)
	if err != nil {
		return nil, err
	}
	files := []AttachmentFile{}
	for _, entry := range entries {
		if entry.Type == "file" {
			files = append(files, entry.file())
		}
	}
	return files, nil
}

// ListIssueAttachmentFiles는 본문 첨부만 읽는다(댓글 하위 폴더 제외).
func (c *Client) ListIssueAttachmentFiles(ctx context.Context, repoInput string, number int) ([]AttachmentFile, error) {
	return c.listOwnedAttachments(ctx, repoInput, number, 0)
}

// ListIssueCommentAttachmentFiles는 댓글 하나의 첨부만 읽는다. 본문 첨부 목록에 댓글
// 파일이 섞이지 않도록 소유 댓글 단위로 폴더를 나눈다.
func (c *Client) ListIssueCommentAttachmentFiles(ctx context.Context, repoInput string, number int, commentID int64) ([]AttachmentFile, error) {
	if commentID == 0 {
		return nil, errors.New("A comment ID is required for comment attachments.")
	}
	return c.listOwnedAttachments(ctx, repoInput, number, commentID)
}

func (c *Client) listOwnedAttachments(ctx context.Context, repoInput string, number int, commentID int64) ([]AttachmentFile, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return nil, err
	}
	if err := c.EnsureAttachmentBranch(ctx, repo); err != nil {
		return nil, err
	}
	directory, err := IssueAttachmentDirectory(number, commentID)
	if err != nil {
		return nil, err
	}
	return c.listAttachmentDirectory(ctx, repo, directory)
}

// ListAllIssueAttachmentFiles는 댓글 하위 폴더까지 포함한 노트의 첨부 전체다(보관 정리·
// 노트 병합용). 순서는 웹과 같이 한 폴더의 파일 다음에 하위 폴더 순이다.
func (c *Client) ListAllIssueAttachmentFiles(ctx context.Context, repoInput string, number int) ([]AttachmentFile, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return nil, err
	}
	if err := c.EnsureAttachmentBranch(ctx, repo); err != nil {
		return nil, err
	}
	root, err := IssueAttachmentDirectory(number, 0)
	if err != nil {
		return nil, err
	}
	var visit func(directory string) ([]AttachmentFile, error)
	visit = func(directory string) ([]AttachmentFile, error) {
		entries, err := c.readDirectory(ctx, repo, directory)
		if err != nil {
			return nil, err
		}
		files := []AttachmentFile{}
		for _, entry := range entries {
			if entry.Type == "file" {
				files = append(files, entry.file())
			}
		}
		for _, entry := range entries {
			if entry.Type != "dir" {
				continue
			}
			nested, err := visit(entry.Path)
			if err != nil {
				return nil, err
			}
			files = append(files, nested...)
		}
		return files, nil
	}
	return visit(root)
}

// DownloadAttachment는 첨부 파일의 바이트를 읽는다. raw Accept를 보내도 Contents JSON이
// 오는 경우가 있어 그때는 base64 본문을 풀어 쓴다.
func (c *Client) DownloadAttachment(ctx context.Context, repoInput, path string) ([]byte, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return nil, err
	}
	request, err := c.newRequest(ctx, http.MethodGet, attachmentContentsPath(repo, path), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/vnd.github.raw+json")
	response, err := c.HTTP.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := reasonPhrase(response)
		if message == "" {
			message = msgAttachmentLoad
		}
		return nil, &Error{Status: response.StatusCode, Message: message}
	}
	data, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if strings.Contains(response.Header.Get("Content-Type"), "application/json") {
		var payload struct {
			Content  *string `json:"content"`
			Encoding string  `json:"encoding"`
		}
		if err := json.Unmarshal(data, &payload); err != nil {
			return nil, err
		}
		if payload.Content != nil && payload.Encoding == "base64" {
			return decodeBase64(*payload.Content)
		}
	}
	return data, nil
}

// decodeBase64는 atob처럼 공백을 무시하고 푼다.
func decodeBase64(content string) ([]byte, error) {
	cleaned := strings.Map(func(character rune) rune {
		if isJSSpace(character) {
			return -1
		}
		return character
	}, content)
	return base64.StdEncoding.DecodeString(cleaned)
}

func (c *Client) DeleteAttachment(ctx context.Context, repoInput string, file AttachmentFile) error {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return err
	}
	_, err = c.request(ctx, http.MethodDelete, "/repos/"+repo+"/contents/"+encodePath(file.Path), map[string]string{
		"message": "Delete Ginote attachment: " + file.Name,
		"sha":     file.SHA,
		"branch":  AttachmentBranch,
	}, nil)
	return err
}

// PurgeIssueAttachments는 노트의 첨부를 댓글 첨부까지 하나씩 지우고 지운 개수를 낸다.
func (c *Client) PurgeIssueAttachments(ctx context.Context, repoInput string, number int) (int, error) {
	files, err := c.ListAllIssueAttachmentFiles(ctx, repoInput, number)
	if err != nil {
		return 0, err
	}
	for _, file := range files {
		if err := c.DeleteAttachment(ctx, repoInput, file); err != nil {
			return 0, err
		}
	}
	return len(files), nil
}

// LoadVoiceTranscriptionHints는 음성 받아쓰기 힌트를 읽는다. 힌트는 기기 설정이 아니라
// 저장소 데이터라서, 같은 저장소에 연결한 모든 기기가 같은 어휘를 쓴다. 파일이 없거나
// JSON이 깨졌으면 빈 문자열이다.
func (c *Client) LoadVoiceTranscriptionHints(ctx context.Context, repoInput string) (string, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return "", err
	}
	var file struct {
		Content string `json:"content"`
	}
	err = c.get(ctx, attachmentContentsPath(repo, voiceHintsPath), &file)
	if StatusOf(err) == http.StatusNotFound {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	decoded, err := decodeBase64(file.Content)
	if err != nil {
		return "", err
	}
	var parsed any
	if json.Unmarshal(decoded, &parsed) != nil {
		return "", nil
	}
	if object, ok := parsed.(map[string]any); ok {
		if hints, ok := object["hints"].(string); ok {
			return hints, nil
		}
	}
	return "", nil
}

// SaveVoiceTranscriptionHints는 힌트를 첨부 브랜치의 voice-hints.json에 쓰고, 앞뒤
// 공백을 뗀 저장한 값을 낸다.
func (c *Client) SaveVoiceTranscriptionHints(ctx context.Context, repoInput, hints string) (string, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return "", err
	}
	value := jsTrim(hints)
	if err := c.EnsureAttachmentBranch(ctx, repo); err != nil {
		return "", err
	}
	var current struct {
		SHA string `json:"sha"`
	}
	if err := c.get(ctx, attachmentContentsPath(repo, voiceHintsPath), &current); err != nil && StatusOf(err) != http.StatusNotFound {
		return "", err
	}
	// JSON.stringify({ version: 1, hints }, null, 2) + '\n'과 같은 모양이다.
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(struct {
		Version int    `json:"version"`
		Hints   string `json:"hints"`
	}{1, value}); err != nil {
		return "", err
	}
	body := map[string]string{
		"message": "Update Ginote voice transcription hints",
		"content": base64.StdEncoding.EncodeToString(buffer.Bytes()),
		"branch":  AttachmentBranch,
	}
	if current.SHA != "" {
		body["sha"] = current.SHA
	}
	if _, err := c.request(ctx, http.MethodPut, "/repos/"+repo+"/contents/"+encodePath(voiceHintsPath), body, nil); err != nil {
		return "", err
	}
	return value, nil
}
