// Package auth는 워크스페이스의 GitHub 토큰을 찾고, TUI에서 입력한 PAT를 OS 자격 증명
// 저장소에 둔다. 토큰은 설정 파일에 쓰지 않는다.
// 찾는 순서: GINOTE_GITHUB_TOKEN → 워크스페이스의 PAT(데스크톱 앱 워크스페이스는 앱이 둔
// net.gitools.note / github-pat:<id>, TUI 워크스페이스는 net.gitools.note.tui / github-pat:<id>)
// → `gh auth token`.
package auth

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/zalando/go-keyring"

	"github.com/zidell/ginote/tui/internal/config"
)

const (
	secretService  = "net.gitools.note"
	tuiService     = "net.gitools.note.tui"
	patPrefix      = "github-pat:"
	overrideEnv    = "GINOTE_GITHUB_TOKEN"
	handoffEnv     = "GINOTE_TUI_TOKEN_HANDOFF"
	sourceOverride = "GINOTE_GITHUB_TOKEN"
)

var ErrNoToken = errors.New("GitHub 토큰을 찾지 못했습니다")

type Token struct {
	Value  string
	Source string
}

var (
	mu    sync.Mutex
	cache = map[string]Token{}
)

func init() {
	// 개발 모드 재시작(devreload)이 넘긴 토큰을 받는다. 자식 프로세스(go build 등)에
	// 이어지지 않게 바로 환경에서 지운다.
	if raw := os.Getenv(handoffEnv); raw != "" {
		os.Unsetenv(handoffEnv)
		json.Unmarshal([]byte(raw), &cache)
	}
}

func cacheKey(workspace config.Workspace) string {
	if workspace.ID != "" {
		return workspace.ID
	}
	return "repo:" + workspace.Repo
}

// For는 워크스페이스의 토큰을 찾는다.
func For(workspace config.Workspace) (Token, error) {
	mu.Lock()
	defer mu.Unlock()
	key := cacheKey(workspace)
	if token, ok := cache[key]; ok {
		return token, nil
	}
	token, err := lookup(workspace)
	if err == nil {
		cache[key] = token
	}
	return token, err
}

func lookup(workspace config.Workspace) (Token, error) {
	if value := strings.TrimSpace(os.Getenv(overrideEnv)); value != "" {
		return Token{value, sourceOverride}, nil
	}
	switch {
	case workspace.Origin == config.OriginApp && workspace.ID != "":
		if value := readSecret(secretService, workspace.ID); value != "" {
			return Token{value, "Ginote 앱 자격 증명"}, nil
		}
	case workspace.Origin == config.OriginTUI && workspace.TokenSource == config.TokenKeychain:
		if value := readSecret(tuiService, workspace.ID); value != "" {
			return Token{value, "TUI에서 입력한 PAT"}, nil
		}
	}
	if value := GHToken(); value != "" {
		return Token{value, "gh auth token"}, nil
	}
	return Token{}, ErrNoToken
}

func readSecret(service, workspaceID string) string {
	value, err := keyring.Get(service, patPrefix+workspaceID)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

// GHToken은 `gh auth token`의 결과다. gh가 없거나 로그인하지 않았으면 "".
func GHToken() string {
	output, err := exec.Command("gh", "auth", "token").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// Use는 확인을 마친 토큰을 이 워크스페이스의 토큰으로 기억한다(저장소에는 쓰지 않음).
func Use(workspace config.Workspace, token Token) {
	mu.Lock()
	defer mu.Unlock()
	cache[cacheKey(workspace)] = token
}

// SavePAT는 TUI 워크스페이스의 PAT를 OS 자격 증명 저장소에 둔다.
func SavePAT(workspaceID, token string) error {
	return keyring.Set(tuiService, patPrefix+workspaceID, token)
}

// Forget은 TUI 워크스페이스의 PAT와 기억한 토큰을 지운다.
func Forget(workspace config.Workspace) {
	mu.Lock()
	delete(cache, cacheKey(workspace))
	mu.Unlock()
	if workspace.Origin == config.OriginTUI {
		keyring.Delete(tuiService, patPrefix+workspace.ID)
	}
}

// HandoffEnv는 지금까지 찾은 토큰을 다음 프로세스에 넘길 환경 변수다. 개발 모드에서
// 다시 시작할 때마다 키체인 확인 창이 뜨지 않게 한다. 파일에는 쓰지 않는다.
func HandoffEnv() string {
	mu.Lock()
	defer mu.Unlock()
	if len(cache) == 0 {
		return ""
	}
	raw, _ := json.Marshal(cache)
	return handoffEnv + "=" + string(raw)
}

// openAISecret은 OpenAI API 키의 자격 증명 이름이다(settings-backend.js의 OPENAI_SECRET).
const openAISecret = "openai-api-key"

// OpenAIKey는 음성 녹음에 쓸 OpenAI API 키다. TUI에서 넣은 키(net.gitools.note.tui)가 먼저이고,
// 없으면 데스크톱 앱이 둔 키(net.gitools.note)를 쓴다. 설정 파일에는 쓰지 않는다.
func OpenAIKey() string {
	for _, service := range []string{tuiService, secretService} {
		if value, err := keyring.Get(service, openAISecret); err == nil && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// SaveOpenAIKey는 TUI의 OpenAI API 키를 OS 자격 증명 저장소에 둔다. 빈 값이면 지운다.
// 데스크톱 앱의 키는 건드리지 않는다.
func SaveOpenAIKey(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		err := keyring.Delete(tuiService, openAISecret)
		if errors.Is(err, keyring.ErrNotFound) {
			return nil
		}
		return err
	}
	return keyring.Set(tuiService, openAISecret, value)
}
