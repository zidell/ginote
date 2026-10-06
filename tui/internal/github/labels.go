package github

import (
	"context"
	"net/http"

	"github.com/zidell/ginote/tui/internal/notes"
)

// ListLabels는 저장소 라벨을 한 쪽(최대 100개) 읽는다. 웹도 다음 쪽은 읽지 않는다.
func (c *Client) ListLabels(ctx context.Context, repoInput string) ([]Label, error) {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return nil, err
	}
	var labels []Label
	err = c.get(ctx, "/repos/"+repo+"/labels?per_page=100", &labels)
	return labels, err
}

type createLabelRequest struct {
	Name        string `json:"name"`
	Color       string `json:"color"`
	Description string `json:"description,omitempty"`
}

// CreateLabel은 createLabel이다. 색은 웹과 같은 notes.TagColor로 정한다. 라벨 목록이
// 오래된 동안 다른 창에서 같은 라벨을 만들었으면(422) 기존 라벨을 읽어 돌려준다.
func (c *Client) CreateLabel(ctx context.Context, repoInput, name, description string) (Label, error) {
	var label Label
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return label, err
	}
	body := createLabelRequest{Name: name, Color: notes.TagColor(name), Description: description}
	_, err = c.request(ctx, http.MethodPost, "/repos/"+repo+"/labels", body, &label)
	if StatusOf(err) == http.StatusUnprocessableEntity {
		label = Label{}
		err = c.get(ctx, "/repos/"+repo+"/labels/"+encodeURIComponent(name), &label)
	}
	return label, err
}

// RenameLabel은 라벨 이름을 바꾼다. description이 nil이면 설명은 그대로 둔다
// (JS의 description === undefined).
func (c *Client) RenameLabel(ctx context.Context, repoInput, currentName, newName string, description *string) (Label, error) {
	var label Label
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return label, err
	}
	body := map[string]any{"new_name": newName}
	if description != nil {
		body["description"] = *description
	}
	_, err = c.request(ctx, http.MethodPatch, "/repos/"+repo+"/labels/"+encodeURIComponent(currentName), body, &label)
	return label, err
}

func (c *Client) RemoveLabel(ctx context.Context, repoInput, name string) error {
	repo, err := NormalizeRepo(repoInput)
	if err != nil {
		return err
	}
	_, err = c.request(ctx, http.MethodDelete, "/repos/"+repo+"/labels/"+encodeURIComponent(name), nil, nil)
	return err
}
