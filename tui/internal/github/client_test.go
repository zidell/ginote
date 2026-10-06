package github

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListOpenIssuesSkipsPullRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("authorization header missing")
		}
		if got := r.URL.Query().Get("labels"); got != "ginote:pin" {
			t.Errorf("labels = %q", got)
		}
		w.Write([]byte(`[{"number":1,"title":"노트","labels":[{"name":"ginote:pin"}]},{"number":2,"pull_request":{}}]`))
	}))
	defer server.Close()
	client := New("secret")
	client.Root = server.URL
	issues, err := client.ListOpenIssues(context.Background(), "o/n", "ginote:pin", 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 || issues[0].Number != 1 || issues[0].LabelNames()[0] != "ginote:pin" {
		t.Fatalf("issues = %+v", issues)
	}
}

func TestErrorsCarryGitHubMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"message":"Not Found"}`))
	}))
	defer server.Close()
	client := New("secret")
	client.Root = server.URL
	_, err := client.GetIssue(context.Background(), "o/n", 9)
	if err == nil || err.Error() != "GitHub 404: Not Found" {
		t.Fatalf("err = %v", err)
	}
}

func TestVerifyConnectionReadsUserAndRepository(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/user":
			w.Write([]byte(`{"login":"me"}`))
		case "/repos/o/notes":
			w.Write([]byte(`{"full_name":"O/Notes"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	client := New("secret")
	client.Root = server.URL
	login, fullName, err := client.VerifyConnection(context.Background(), "o/notes")
	if err != nil || login != "me" || fullName != "O/Notes" {
		t.Fatalf("login = %q fullName = %q err = %v", login, fullName, err)
	}
}
