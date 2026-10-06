package ui

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/config"
)

// fakeGitHub는 테스트용 가짜 GitHub API다. TUI가 보내는 요청만 흉내 낸다.
type fakeGitHub struct {
	mu       sync.Mutex
	issues   map[int]map[string]any
	labels   []map[string]any
	comments map[int][]map[string]any
	nextID   int
	requests []string
	// files는 첨부 브랜치의 폴더별 파일 이름이다. 있으면 첨부 브랜치도 있는 것으로 본다.
	files  map[string][]string
	data   map[string][]byte
	server *httptest.Server
}

func newFakeGitHub(t *testing.T) *fakeGitHub {
	t.Helper()
	fake := &fakeGitHub{issues: map[int]map[string]any{}, comments: map[int][]map[string]any{}, nextID: 200}
	fake.server = httptest.NewServer(http.HandlerFunc(fake.handle))
	t.Cleanup(fake.server.Close)
	t.Setenv("GINOTE_GITHUB_API_URL", fake.server.URL)
	t.Setenv("GINOTE_GITHUB_TOKEN", "test-token")
	return fake
}

func (f *fakeGitHub) addLabel(name string) {
	f.labels = append(f.labels, map[string]any{"id": len(f.labels) + 1, "name": name, "color": "aaaaaa", "description": ""})
}

func (f *fakeGitHub) addIssue(number int, title, body string, labels []string, updated time.Time) {
	var labelObjects []map[string]any
	for _, name := range labels {
		labelObjects = append(labelObjects, map[string]any{"name": name})
	}
	f.issues[number] = map[string]any{
		"id": 1000 + number, "number": number, "title": title, "body": body, "state": "open",
		"labels": labelObjects, "created_at": updated.Format(time.RFC3339), "updated_at": updated.Format(time.RFC3339),
		"html_url": fmt.Sprintf("https://github.com/o/notes/issues/%d", number), "user": map[string]any{"login": "octocat"},
	}
}

func (f *fakeGitHub) issue(number int) map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.issues[number]
}

func (f *fakeGitHub) saw(prefix string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, request := range f.requests {
		if strings.HasPrefix(request, prefix) {
			return true
		}
	}
	return false
}

func fakeLabelNames(issue map[string]any) []string {
	var names []string
	for _, label := range issue["labels"].([]map[string]any) {
		names = append(names, label["name"].(string))
	}
	return names
}

func (f *fakeGitHub) list(state, label, term string) []map[string]any {
	var items []map[string]any
	for _, issue := range f.issues {
		if issue["state"] != state {
			continue
		}
		if label != "" {
			found := false
			for _, name := range fakeLabelNames(issue) {
				found = found || strings.EqualFold(name, label)
			}
			if !found {
				continue
			}
		}
		if term != "" && !strings.Contains(strings.ToLower(issue["title"].(string)+" "+issue["body"].(string)), strings.ToLower(term)) {
			continue
		}
		items = append(items, issue)
	}
	sort.Slice(items, func(i, j int) bool { return items[i]["updated_at"].(string) > items[j]["updated_at"].(string) })
	return items
}

func (f *fakeGitHub) handle(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	data, _ := io.ReadAll(r.Body)
	var body map[string]any
	json.Unmarshal(data, &body)
	f.requests = append(f.requests, r.Method+" "+r.URL.Path)
	write := func(status int, value any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(value)
	}
	path := r.URL.Path
	now := time.Now().UTC().Format(time.RFC3339)
	switch {
	case path == "/repos/o/notes/git/ref/heads/ginote-assets":
		if f.files == nil {
			write(404, map[string]any{"message": "Not Found"})
			return
		}
		write(200, map[string]any{"ref": "refs/heads/ginote-assets", "object": map[string]any{"sha": "abc"}})
	case strings.HasPrefix(path, "/repos/o/notes/contents/") && r.Method == "PUT":
		// 첨부 올리기: 폴더 목록에 더한다.
		file, _ := url.PathUnescape(strings.TrimPrefix(path, "/repos/o/notes/contents/"))
		directory, name := file[:strings.LastIndex(file, "/")], file[strings.LastIndex(file, "/")+1:]
		f.files[directory] = append(f.files[directory], name)
		write(201, map[string]any{"content": map[string]any{"sha": "s", "size": 10, "path": file}})
	case strings.HasPrefix(path, "/repos/o/notes/contents/"):
		directory, _ := url.PathUnescape(strings.TrimPrefix(path, "/repos/o/notes/contents/"))
		names, ok := f.files[directory]
		if parent := directory[:max(0, strings.LastIndex(directory, "/"))]; !ok && r.Method == "GET" {
			// 파일 하나를 내려받는다.
			for _, name := range f.files[parent] {
				if parent+"/"+name == directory {
					if data, ok := f.data[directory]; ok {
						w.Write(data)
						return
					}
					w.Write([]byte("file:" + name))
					return
				}
			}
		}
		if !ok || r.Method != "GET" {
			write(404, map[string]any{"message": "Not Found"})
			return
		}
		var entries []map[string]any
		for _, name := range names {
			entries = append(entries, map[string]any{"type": "file", "name": name, "path": directory + "/" + name, "sha": "s", "size": 10})
		}
		write(200, entries)
	case path == "/user":
		write(200, map[string]any{"login": "octocat"})
	case path == "/repos/o/notes":
		write(200, map[string]any{"full_name": "o/notes"})
	case path == "/repos/o/notes/labels" && r.Method == "GET":
		write(200, f.labels)
	case path == "/repos/o/notes/labels" && r.Method == "POST":
		f.addLabel(body["name"].(string))
		write(201, f.labels[len(f.labels)-1])
	case strings.HasPrefix(path, "/repos/o/notes/labels/"):
		name, _ := url.PathUnescape(strings.TrimPrefix(path, "/repos/o/notes/labels/"))
		for index, label := range f.labels {
			if label["name"] == name {
				if r.Method == "DELETE" {
					f.labels = append(f.labels[:index], f.labels[index+1:]...)
					w.WriteHeader(204)
					return
				}
				label["name"] = body["new_name"]
				write(200, label)
				return
			}
		}
		write(404, map[string]any{"message": "Not Found"})
	case path == "/repos/o/notes/issues" && r.Method == "GET":
		write(200, f.list(r.URL.Query().Get("state"), r.URL.Query().Get("labels"), ""))
	case path == "/repos/o/notes/issues" && r.Method == "POST":
		f.nextID++
		var labels []string
		for _, name := range body["labels"].([]any) {
			labels = append(labels, name.(string))
		}
		f.addIssue(f.nextID, body["title"].(string), fmt.Sprint(body["body"]), labels, time.Now())
		write(201, f.issues[f.nextID])
	case path == "/search/issues":
		query := r.URL.Query().Get("q")
		state := "open"
		if strings.Contains(query, "is:closed") {
			state = "closed"
		}
		label := ""
		var terms []string
		for _, part := range strings.Fields(query) {
			switch {
			case strings.HasPrefix(part, "label:"):
				label = strings.Trim(strings.TrimPrefix(part, "label:"), `"`)
			case strings.Contains(part, ":"):
			default:
				terms = append(terms, part)
			}
		}
		items := f.list(state, label, strings.Join(terms, " "))
		write(200, map[string]any{"total_count": len(items), "items": items})
	default:
		parts := strings.Split(strings.TrimPrefix(path, "/repos/o/notes/issues/"), "/")
		if strings.HasPrefix(path, "/repos/o/notes/issues/comments/") {
			id, _ := strconv.Atoi(parts[1])
			for number, list := range f.comments {
				for index, comment := range list {
					if comment["id"] == id {
						if r.Method == "DELETE" {
							f.comments[number] = append(list[:index], list[index+1:]...)
							w.WriteHeader(204)
							return
						}
						comment["body"] = body["body"]
						write(200, comment)
						return
					}
				}
			}
			write(404, map[string]any{"message": "Not Found"})
			return
		}
		if strings.HasPrefix(path, "/repos/o/notes/issues/") {
			number, _ := strconv.Atoi(parts[0])
			issue := f.issues[number]
			if issue == nil {
				write(404, map[string]any{"message": "Not Found"})
				return
			}
			if len(parts) == 2 && parts[1] == "comments" {
				if r.Method == "POST" {
					f.nextID++
					comment := map[string]any{"id": f.nextID, "body": body["body"], "user": map[string]any{"login": "octocat"}, "created_at": now, "updated_at": now}
					f.comments[number] = append(f.comments[number], comment)
					write(201, comment)
					return
				}
				list := f.comments[number]
				if list == nil {
					list = []map[string]any{}
				}
				write(200, list)
				return
			}
			if r.Method == "PATCH" {
				for key, value := range body {
					if key == "labels" {
						var labels []map[string]any
						for _, name := range value.([]any) {
							labels = append(labels, map[string]any{"name": name})
						}
						issue["labels"] = labels
						continue
					}
					issue[key] = value
				}
				issue["updated_at"] = now
			}
			write(200, issue)
			return
		}
		write(404, map[string]any{"message": "Not Found"})
	}
}

// --- 모델 구동 도우미 ---

// drive는 메시지를 보내고, 돌아온 명령을 끝까지(빨리 끝나는 것만) 실행해 반영한다.
func drive(t *testing.T, m Model, msg tea.Msg) Model {
	t.Helper()
	next, cmd := m.Update(msg)
	return runCmd(t, next.(Model), cmd)
}

func runCmd(t *testing.T, m Model, cmd tea.Cmd) Model {
	t.Helper()
	if cmd == nil {
		return m
	}
	result := make(chan tea.Msg, 1)
	go func() { result <- cmd() }()
	var msg tea.Msg
	select {
	case msg = <-result:
	case <-time.After(150 * time.Millisecond):
		return m // 타이머(자동 저장·알림 지우기 등)는 기다리지 않는다
	}
	if msg == nil {
		return m
	}
	if batch, ok := msg.(tea.BatchMsg); ok {
		for _, inner := range batch {
			m = runCmd(t, m, inner)
		}
		return m
	}
	if value := reflect.ValueOf(msg); value.Kind() == reflect.Slice && value.Type().Elem() == reflect.TypeOf((tea.Cmd)(nil)) {
		for index := 0; index < value.Len(); index++ {
			m = runCmd(t, m, value.Index(index).Interface().(tea.Cmd))
		}
		return m
	}
	next, nextCmd := m.Update(msg)
	return runCmd(t, next.(Model), nextCmd)
}

func key(text string) tea.KeyPressMsg {
	switch text {
	case "enter":
		return tea.KeyPressMsg{Code: tea.KeyEnter}
	case "esc":
		return tea.KeyPressMsg{Code: tea.KeyEscape}
	case "up":
		return tea.KeyPressMsg{Code: tea.KeyUp}
	case "down":
		return tea.KeyPressMsg{Code: tea.KeyDown}
	case "shift+down":
		return tea.KeyPressMsg{Code: tea.KeyDown, Mod: tea.ModShift}
	case "tab":
		return tea.KeyPressMsg{Code: tea.KeyTab}
	case "shift+tab":
		return tea.KeyPressMsg{Code: tea.KeyTab, Mod: tea.ModShift}
	case "space":
		return tea.KeyPressMsg{Code: tea.KeySpace, Text: " "}
	case "delete":
		return tea.KeyPressMsg{Code: tea.KeyDelete}
	case "backspace":
		return tea.KeyPressMsg{Code: tea.KeyBackspace}
	case "ctrl+s":
		return tea.KeyPressMsg{Code: 's', Mod: tea.ModCtrl}
	}
	r := []rune(text)[0]
	return tea.KeyPressMsg{Code: r, Text: text}
}

func press(t *testing.T, m Model, keys ...string) Model {
	t.Helper()
	for _, name := range keys {
		m = drive(t, m, key(name))
	}
	return m
}

func typeText(t *testing.T, m Model, text string) Model {
	t.Helper()
	for _, r := range text {
		if r == '\n' {
			m = drive(t, m, tea.KeyPressMsg{Code: tea.KeyEnter})
			continue
		}
		m = drive(t, m, tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	return m
}

func init() {
	// 테스트는 OS 자격 증명 저장소를 읽지 않는다.
	readVoiceKey = func() string { return "" }
}

// clickChoice는 떠 있는 선택 창에서 id 항목을 누른다.
func clickChoice(t *testing.T, m Model, id string) Model {
	t.Helper()
	if m.choice == nil {
		t.Fatalf("no choice modal for %q", id)
	}
	for index, item := range m.choice.items {
		if item.id == id {
			return click(t, m, "choice:"+strconv.Itoa(index))
		}
	}
	t.Fatalf("choice %q not in %+v", id, m.choice.items)
	return m
}

// click은 화면을 그린 뒤 id 영역의 왼쪽 위를 누른다.
func click(t *testing.T, m Model, id string) Model {
	t.Helper()
	m.View()
	zone, ok := m.hits.lookup(id)
	if !ok {
		t.Fatalf("no clickable %q on screen\n%s", id, screenText(m))
	}
	return drive(t, m, tea.MouseClickMsg{X: zone.x0, Y: zone.y0 + topMargin, Button: tea.MouseLeft})
}

func screenText(m Model) string {
	content, _ := m.render()
	return stripANSI(content)
}

// startApp은 가짜 저장소 하나로 TUI를 띄워 첫 목록까지 받는다.
func startApp(t *testing.T, fake *fakeGitHub) Model {
	t.Helper()
	m := New(Options{
		Workspaces:    []config.Workspace{{ID: "w1", Repo: "o/notes", Origin: config.OriginApp}},
		Preferences:   config.DefaultPreferences(),
		TUIConfigPath: t.TempDir() + "/tui.toml",
	})
	m = drive(t, m, tea.WindowSizeMsg{Width: 140, Height: 40})
	m = runCmd(t, m, m.Init())
	return m
}

func seed(fake *fakeGitHub) {
	base := time.Date(2026, 9, 4, 9, 0, 0, 0, time.UTC)
	fake.addLabel("work")
	fake.addLabel("ginote:pin")
	fake.addIssue(1, "고정 노트", "고정 노트\n\n중요", []string{"ginote:pin"}, base.Add(-time.Hour))
	fake.addIssue(2, "장보기", "장보기\n\n- 우유", []string{"work"}, base)
	fake.addIssue(3, "여행 계획", "<!-- ginote:attachments:start -->\n\n![](https://github.com/o/notes/raw/ginote-assets/.issue-note-assets/issues/3/a-photo.png)\n\n<!-- ginote:attachments:end -->\n\n여행 계획\n\n교토", nil, base.Add(-2*time.Hour))
}
