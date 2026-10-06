package github

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
)

// call은 가짜 서버가 받은 요청 하나다. URI는 인코딩된 그대로의 경로+쿼리다.
type call struct {
	Method string
	URI    string
	Accept string
	Body   map[string]any
}

type reply struct {
	status  int
	body    string
	headers map[string]string
}

// fakeGitHub는 "METHOD URI"별로 정한 응답을 돌려주고 받은 요청을 기록한다.
type fakeGitHub struct {
	t       *testing.T
	mu      sync.Mutex
	routes  map[string][]reply
	calls   []call
	server  *httptest.Server
	missing int
	// before는 경로를 미리 알 수 없는 요청(UUID 경로)의 응답을 정하는 데 쓴다.
	before func(method, uri string)
}

func newFake(t *testing.T) (*fakeGitHub, *Client) {
	fake := &fakeGitHub{t: t, routes: map[string][]reply{}}
	fake.server = httptest.NewServer(http.HandlerFunc(fake.serve))
	t.Cleanup(fake.server.Close)
	client := New("secret")
	client.Root = fake.server.URL
	return fake, client
}

// on은 응답을 차례로 쌓는다. 마지막 응답은 그 뒤 요청에도 계속 쓴다.
func (f *fakeGitHub) on(method, uri string, status int, body string, headers ...string) {
	headerMap := map[string]string{}
	for index := 0; index+1 < len(headers); index += 2 {
		headerMap[headers[index]] = headers[index+1]
	}
	key := method + " " + uri
	f.routes[key] = append(f.routes[key], reply{status, body, headerMap})
}

func (f *fakeGitHub) serve(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("X-GitHub-Api-Version") != "2022-11-28" {
		f.t.Errorf("%s %s: headers = %v", r.Method, r.RequestURI, r.Header)
	}
	raw, _ := io.ReadAll(r.Body)
	recorded := call{Method: r.Method, URI: r.RequestURI, Accept: r.Header.Get("Accept")}
	if len(raw) > 0 {
		if r.Header.Get("Content-Type") != "application/json" {
			f.t.Errorf("%s %s: content-type = %q", r.Method, r.RequestURI, r.Header.Get("Content-Type"))
		}
		if err := json.Unmarshal(raw, &recorded.Body); err != nil {
			f.t.Errorf("%s %s: body %q: %v", r.Method, r.RequestURI, raw, err)
		}
	}
	if f.before != nil {
		f.before(r.Method, r.RequestURI)
	}
	f.mu.Lock()
	f.calls = append(f.calls, recorded)
	key := r.Method + " " + r.RequestURI
	replies := f.routes[key]
	var chosen reply
	switch {
	case len(replies) == 0:
		f.missing++
		f.mu.Unlock()
		f.t.Errorf("unexpected request %s", key)
		w.WriteHeader(http.StatusTeapot)
		return
	case len(replies) == 1:
		chosen = replies[0]
	default:
		chosen = replies[0]
		f.routes[key] = replies[1:]
	}
	f.mu.Unlock()
	for name, value := range chosen.headers {
		w.Header().Set(name, value)
	}
	if chosen.status != 0 {
		w.WriteHeader(chosen.status)
	}
	io.WriteString(w, chosen.body)
}

// uris는 받은 요청을 "METHOD URI" 순서로 낸다.
func (f *fakeGitHub) uris() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	keys := make([]string, len(f.calls))
	for index, recorded := range f.calls {
		keys[index] = recorded.Method + " " + recorded.URI
	}
	return keys
}

func (f *fakeGitHub) find(method, uri string) call {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, recorded := range f.calls {
		if recorded.Method == method && recorded.URI == uri {
			return recorded
		}
	}
	f.t.Fatalf("no request %s %s; got %v", method, uri, f.calls)
	return call{}
}

func assertBody(t *testing.T, got call, want map[string]any) {
	t.Helper()
	wantJSON, _ := json.Marshal(want)
	var normalized map[string]any
	json.Unmarshal(wantJSON, &normalized)
	if !reflect.DeepEqual(got.Body, normalized) {
		t.Fatalf("%s %s body = %v, want %v", got.Method, got.URI, got.Body, normalized)
	}
}

func assertURIs(t *testing.T, fake *fakeGitHub, want ...string) {
	t.Helper()
	if got := fake.uris(); !reflect.DeepEqual(got, want) {
		t.Fatalf("requests =\n%v\nwant\n%v", got, want)
	}
}
