package github

import (
	"context"
	"testing"
)

func TestPermanentlyDeleteIssue(t *testing.T) {
	for _, scenario := range []struct {
		name, state, graph string
		cleanupStatus      int
		deleted, wantError bool
	}{
		{"success", "closed", `{"data":{"deleteIssue":{"clientMutationId":null}}}`, 200, true, false},
		{"permission", "closed", `{"errors":[{"message":"Forbidden"}],"data":{"deleteIssue":null}}`, 200, false, true},
		{"open", "open", `{}`, 200, false, true},
		{"cleanup", "closed", `{"data":{"deleteIssue":{"clientMutationId":null}}}`, 403, true, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fake, client := newFake(t)
			fake.on("GET", "/repos/o/n/issues/5", 200, `{"state":"`+scenario.state+`","node_id":"I_5"}`)
			fake.on("POST", "/graphql", 200, scenario.graph)
			fake.on("GET", "/repos/o/n/git/ref/heads/ginote-assets", scenario.cleanupStatus, `{}`)
			fake.on("GET", "/repos/o/n/contents/.issue-note-assets/issues/5?ref=ginote-assets", 200, `[]`)
			deleted, err := client.PermanentlyDeleteIssue(context.Background(), "o/n", 5)
			if deleted != scenario.deleted || (err != nil) != scenario.wantError {
				t.Fatalf("deleted=%v err=%v", deleted, err)
			}
			for _, call := range fake.calls {
				if call.URI == "/graphql" && call.Body["variables"].(map[string]any)["issueId"] != "I_5" {
					t.Fatal("wrong node ID")
				}
				if !scenario.deleted && call.Method == "DELETE" {
					t.Fatal("deleted attachments before issue deletion")
				}
			}
		})
	}
}
