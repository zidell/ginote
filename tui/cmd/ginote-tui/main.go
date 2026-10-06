// ginote-tui는 Ginote의 터미널 버전이다. 워크스페이스는 데스크톱 앱의 config.toml과 TUI에서
// 추가한 것(TUI 설정 파일)을 함께 쓰고, --repo로 저장소 하나를 바로 열 수도 있다.
// 개발 방법은 docs/TUI.md에 있다.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/auth"
	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/devreload"
	"github.com/zidell/ginote/tui/internal/ime"
	"github.com/zidell/ginote/tui/internal/relaunch"
	"github.com/zidell/ginote/tui/internal/ui"
)

func main() {
	if ime.Main(os.Args) {
		return
	}
	repoFlag := flag.String("repo", "", `열 저장소("owner/name"). 데스크톱 앱 설정에 있으면 그 워크스페이스로 연다`)
	configFlag := flag.String("config", "", "config.toml 경로(기본: 데스크톱 앱의 설정 파일, GINOTE_CONFIG)")
	flag.Parse()

	path := *configFlag
	if path == "" {
		path = config.Path()
	}
	settings, err := config.Load(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ginote-tui: %s을 읽지 못했습니다: %v\n", path, err)
		os.Exit(1)
	}
	tuiPath := config.TUIPath()
	tuiSettings, err := config.LoadTUI(tuiPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ginote-tui: %s을 읽지 못했습니다: %v\n", tuiPath, err)
		os.Exit(1)
	}

	// 데스크톱 앱의 워크스페이스 뒤에 TUI에서 추가한 워크스페이스를 붙인다. 시작 워크스페이스는
	// TUI가 마지막으로 연 것, 없으면 데스크톱 앱의 active_workspace다.
	options := ui.Options{
		Workspaces:    append(settings.Workspaces, tuiSettings.Workspaces...),
		Preferences:   settings.Preferences,
		TUIConfigPath: tuiPath,
		DesktopVoice:  &settings.Voice,
		TUIVoice:      tuiSettings.Voice,
		SidebarWidth:  config.LoadState(config.StatePath(tuiPath)).SidebarWidth,
	}
	// TUI에서 바꾼 환경설정이 있으면 그것을, 없으면 데스크톱 앱의 값을 쓴다.
	if tuiSettings.Preferences != nil {
		options.Preferences = *tuiSettings.Preferences
		options.TUIPreferences = true
	}
	for _, id := range []string{settings.ActiveWorkspace, tuiSettings.ActiveWorkspace} {
		for index, workspace := range options.Workspaces {
			if id != "" && workspace.ID == id {
				options.Active = index
			}
		}
	}
	if *repoFlag != "" {
		repo, ok := config.ParseRepo(*repoFlag)
		if !ok {
			fmt.Fprintf(os.Stderr, "ginote-tui: --repo는 \"owner/name\" 형식이어야 합니다: %q\n", *repoFlag)
			os.Exit(2)
		}
		options.Active = -1
		for index, workspace := range options.Workspaces {
			if strings.EqualFold(workspace.Repo, repo) {
				options.Active = index
			}
		}
		if options.Active < 0 {
			options.Workspaces = append([]config.Workspace{{Repo: repo, Origin: config.OriginFlag}}, options.Workspaces...)
			options.Active = 0
		}
	}
	if data := relaunch.Restore(); data != nil {
		var snapshot ui.Snapshot
		if json.Unmarshal(data, &snapshot) == nil {
			options.Restore = &snapshot
		}
	}

	final, err := tea.NewProgram(ui.New(options), tea.WithFilter(ui.QuitFilter)).Run()
	// 단축키용으로 바꿔 둔 입력 소스(영문 자판)를 원래대로 돌린다.
	ime.Restore()
	if err != nil {
		fmt.Fprintf(os.Stderr, "ginote-tui: %v\n", err)
		os.Exit(1)
	}
	model, ok := final.(ui.Model)
	if !ok || model.Restart() == "" {
		return
	}
	// 개발 모드 재빌드는 새 바이너리로, 전체 새로고침은 같은 바이너리로 다시 시작한다.
	// 재빌드 때는 찾아 둔 토큰을 넘겨 키체인 확인 창이 다시 뜨지 않게 하고, 전체 새로고침은
	// 설정과 토큰을 처음부터 다시 읽는다(웹의 location.reload).
	binary, _ := os.Executable()
	var env []string
	if model.Restart() == "dev" {
		binary = devreload.Binary()
		env = append(env, auth.HandoffEnv())
	}
	state, _ := json.Marshal(model.Snapshot())
	if err := relaunch.Exec(binary, state, env...); err != nil {
		fmt.Fprintf(os.Stderr, "ginote-tui: 다시 시작하지 못했습니다: %v\n", err)
		os.Exit(1)
	}
}
