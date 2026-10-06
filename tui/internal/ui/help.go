package ui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// 도움말(HelpOverlay.svelte): 단축키·보안·MCP·설치 안내. 문구는 웹의 ko 번역을 따르고,
// 터미널에서 다른 점(마우스 대신 키, 브라우저 대신 설정 파일)만 바꿨다.

var helpTitles = map[string]string{
	"keyboard": "단축키 안내",
	"security": "보안 안내",
	"mcp":      "AI 도구에서 MCP로 노트 사용하기",
	"app":      "설치 안내",
}

type helpBlock struct {
	kind string // "p", "li", "h", "code", "key"
	text string
	key  string
}

func (m Model) helpBlocks(topic string) []helpBlock {
	switch topic {
	case "security":
		return []helpBlock{
			{kind: "p", text: "Ginote는 로그인이나 노트 저장을 처리하는 별도 앱 서버가 없습니다. TUI도 GitHub와 직접 통신합니다."},
			{kind: "code", text: "TUI  ←── 직접 통신 ──→  GitHub\nPAT는 OS 자격 증명 저장소에, 설정은 설정 파일에만 보관됩니다"},
			{kind: "li", text: "노트, 태그, 첨부파일은 사용자가 지정한 GitHub 저장소에만 저장됩니다."},
			{kind: "li", text: "GitHub 접근 토큰(PAT)은 OS 자격 증명 저장소에만 저장되며, 인증할 때만 GitHub API로 전송됩니다. 설정 파일에는 토큰을 쓰지 않습니다."},
			{kind: "li", text: "원하면 노트 본문을 AES-GCM 방식으로 암호화한 뒤 GitHub로 보낼 수 있습니다(L 키)."},
			{kind: "li", text: "앱 운영자에게 노트·PAT·설정을 보내는 API가 없으며, 분석이나 추적 서비스도 사용하지 않습니다."},
			{kind: "p", text: "GitHub 이외의 서버로 데이터가 전송되지 않습니다. 실제 노트 데이터는 이 기기와 사용자가 선택한 GitHub 저장소에만 있습니다."},
			{kind: "p", text: "자세한 설명: https://github.com/zidell/ginote#readme"},
		}
	case "mcp":
		repo := m.repo()
		prompt := repo + " 저장소의 GitHub Issues를 노트로 사용하세요. 열린 이슈는 노트, 닫힌 이슈는 휴지통이며 GitHub 라벨은 태그입니다. 첨부파일은 .issue-note-assets/issues/{issueNumber}/ 폴더에 저장되고, 이슈 본문에 일반 이미지·파일 링크로 연결되어 있습니다. 노트 본문을 수정할 때 이 링크를 반드시 그대로 유지하세요. 링크를 지우면 해당 첨부파일 연결도 끊깁니다."
		return []helpBlock{
			{kind: "p", text: "MCP는 AI 도구가 GitHub 같은 외부 서비스를 다루게 해주는 연결 방식입니다. MCP를 지원하는 AI 도구에 GitHub 공식 MCP Server를 설치하면, 여기서 노트로 쓰는 것과 같은 GitHub Issues를 AI 도구에서도 읽고 쓸 수 있습니다."},
			{kind: "p", text: "이 앱 전용 MCP 서버는 필요하지 않습니다. MCP를 지원하는 AI 도구에 GitHub 공식 MCP Server를 연결하면, 같은 저장소의 이슈를 여기의 노트처럼 읽고 수정할 수 있습니다."},
			{kind: "h", text: "대상 저장소"},
			{kind: "code", text: repo},
			{kind: "li", text: "MCP를 지원하는 AI 도구에 GitHub 공식 MCP Server를 추가하세요. 원격 연결 주소는 https://api.githubcopilot.com/mcp/입니다. 원격 연결을 지원하지 않는 AI 도구는 로컬 서버를 사용할 수 있습니다."},
			{kind: "li", text: "GitHub와 저장소 연결을 허용하세요. 노트를 읽고 저장하려면 Issues 권한을 읽기 및 쓰기로, 첨부파일을 사용하려면 Contents 권한도 읽기 및 쓰기로 설정하세요."},
			{kind: "li", text: "issues와 repos 도구를 사용합니다. 노트 본문과 라벨은 이슈에, 첨부파일은 저장소 파일과 전용 댓글에 저장됩니다. 이 기기의 PAT는 AI 도구와 공유되지 않으므로, AI 도구에는 별도 OAuth 또는 PAT로 연결해야 합니다."},
			{kind: "p", text: "첨부파일은 노트 본문에 들어 있는 이미지·파일 링크입니다. AI 도구로 노트 본문을 수정할 때는 이 링크를 그대로 두세요. 링크를 지우면 첨부파일 연결도 끊깁니다."},
			{kind: "h", text: "AI에게 처음 전달할 안내 (C 키로 복사)"},
			{kind: "code", text: prompt},
		}
	case "app":
		return []helpBlock{
			{kind: "p", text: "Ginote는 브라우저, 데스크톱 앱, 모바일 앱, 그리고 이 터미널 앱으로 쓸 수 있습니다. 모두 같은 GitHub 저장소를 노트로 씁니다."},
			{kind: "h", text: "데스크톱 앱"},
			{kind: "p", text: "macOS·Windows·Linux용 데스크톱 앱도 제공됩니다. 웹 버전과 마찬가지로 별도 앱 서버 없이 GitHub API에 직접 연결합니다. macOS는 Homebrew로도 설치할 수 있습니다:"},
			{kind: "code", text: "brew tap zidell/ginote https://github.com/zidell/ginote\nbrew install --cask ginote"},
			{kind: "p", text: "GitHub Releases에서 내려받기: https://github.com/zidell/ginote/releases"},
			{kind: "h", text: "터미널 앱"},
			{kind: "p", text: "데스크톱 앱에서 연결한 저장소를 그대로 읽어 씁니다. 터미널에서 추가한 저장소와 환경설정은 따로 저장됩니다: " + m.tuiConfigPath},
		}
	}
	return []helpBlock{
		{kind: "p", text: "대부분의 단축키는 노트 목록에서 사용할 수 있습니다. 마우스로도 모든 버튼을 누를 수 있습니다."},
		{kind: "key", key: "↑ ↓ (k j)", text: "노트 목록에서 위·아래로 이동. 첫 노트에서 ↑를 더 누르면 새 노트 → 검색 → 노트/휴지통 탭(←/→로 바꿈) → 저장소 선택·설정(←/→로 오가고 Enter로 엶)으로 올라감"},
		{kind: "key", key: "Enter", text: "현재 노트 열기 · 한 번 더 누르면 편집"},
		{kind: "key", key: "Tab / Shift+Tab", text: "열린 노트의 편집기로 이동 / 목록으로 돌아가기"},
		{kind: "key", key: "N", text: "새 노트 만들기"},
		{kind: "key", key: "Ctrl+R / Cmd+R / R", text: "앱 전체 새로고침 (설정·토큰·목록을 처음부터 다시 읽음). Cmd+R은 키를 앱에 넘겨주는 터미널(Ghostty 등)에서만 됩니다"},
		{kind: "key", key: "`", text: "저장소 선택창 열기 · ↑/↓로 이동하고 Enter로 선택"},
		{kind: "key", key: "1~9", text: "저장소 전환 (노트 목록에서만 · 등록된 순서 1~9)"},
		{kind: "key", key: "Esc", text: "선택 해제 · 삭제 취소 · 입력 끝내기 · 노트 닫기 · 안내 닫기"},
		{kind: "key", key: "Space", text: "현재 노트 선택"},
		{kind: "key", key: "Shift + ↑ ↓", text: "Shift와 ↑/↓로 여러 노트 선택"},
		{kind: "key", key: "Delete / Backspace", text: "선택한 노트를 휴지통으로 이동 (2초 안에 Esc로 취소)"},
		{kind: "key", key: "S T A P L X G M E", text: "노트를 열고 입력창에 포커스가 없을 때: S 저장 · T 태그 추가 · A 파일 첨부 · P 상단고정 · L 잠금/잠금 해제 · X 치환창 열기 · G GitHub에서 보기 · M MD뷰어 열기·닫기 · E 음성 녹음(TUI 미지원)"},
		{kind: "h", text: "터미널 앱에만 있는 키"},
		{kind: "key", key: "/", text: "검색칸으로 이동 (#태그를 입력하면 태그 목록)"},
		{kind: "key", key: "[  ]", text: "노트 / 휴지통 탭"},
		{kind: "key", key: ",", text: "환경설정"},
		{kind: "key", key: "PgUp PgDn", text: "노트 본문 스크롤 (마우스 휠도 됩니다)"},
		{kind: "key", key: "Ctrl+S", text: "입력 중 바로 저장"},
		{kind: "key", key: "? / q", text: "이 안내 · 종료"},
		{kind: "p", text: "입력창에 글을 쓰는 동안에는 대부분의 단축키가 동작하지 않습니다. macOS에서는 목록·메뉴에 있을 때 입력 소스를 영문 자판으로 바꾸고, 본문·검색 같은 입력칸에 들어가면 쓰던 입력 소스(한글 등)로 되돌려 단일 키 단축키가 바로 듣게 합니다(환경설정에서 끌 수 있음)."},
	}
}

func (m Model) helpLines(width int) []string {
	t := m.th
	var lines []string
	for _, block := range m.helpBlocks(m.help) {
		switch block.kind {
		case "h":
			lines = append(lines, "", lipgloss.NewStyle().Bold(true).Foreground(t.title).Render(block.text))
		case "li":
			for index, line := range wrapText(block.text, width-2) {
				prefix := "• "
				if index > 0 {
					prefix = "  "
				}
				lines = append(lines, t.fg(t.secondary).Render(prefix+line))
			}
		case "code":
			for _, line := range strings.Split(block.text, "\n") {
				for _, wrapped := range wrapText(line, width-2) {
					lines = append(lines, fillBackground(" "+wrapped, width, t.bgInput))
				}
			}
		case "key":
			keyWidth := 20
			wrapped := wrapText(block.text, width-keyWidth)
			for index, line := range wrapped {
				key := strings.Repeat(" ", keyWidth)
				if index == 0 {
					key = fitLine(lipgloss.NewStyle().Foreground(t.shortcut).Bold(true).Render(block.key), keyWidth)
				}
				lines = append(lines, key+t.fg(t.secondary).Render(line))
			}
			lines = append(lines, t.fg(t.border).Render(strings.Repeat("─", width)))
		default:
			lines = append(lines, "")
			for _, line := range wrapText(block.text, width) {
				lines = append(lines, t.fg(t.secondary).Render(line))
			}
		}
	}
	return lines
}

var helpScroll = map[string]int{}

var helpActions = []modalAction{{id: "close", label: "닫기", primary: true}}

func (m Model) handleHelpKey(key string) (tea.Model, tea.Cmd) {
	if pressed, handled := m.helpBar.barKey(helpActions, key); handled {
		if pressed == "close" {
			m.help = ""
			m.helpBar = newActionBar()
		}
		return m, nil
	}
	switch key {
	case "esc", "q", "?", "enter":
		m.help = ""
		m.helpBar = newActionBar()
	case "down", "j":
		helpScroll[m.help]++
	case "up", "k":
		helpScroll[m.help] = max(0, helpScroll[m.help]-1)
	case "c":
		if m.help == "mcp" {
			blocks := m.helpBlocks("mcp")
			text := blocks[len(blocks)-1].text
			return m, copyText(text, "MCP용 노트 안내를 복사했습니다.")
		}
	}
	return m, nil
}

func (m Model) renderHelp() (string, int, int) {
	t := m.th
	width := min(84, m.width-4)
	height := m.height - 2
	inner := width - 4
	lines := m.helpLines(inner)
	bodyHeight := height - 7
	scroll := max(0, min(helpScroll[m.help], len(lines)-bodyHeight))
	helpScroll[m.help] = scroll
	x, y := (m.width-width)/2, 1
	closeButton := t.button("✕", false)
	title := lipgloss.PlaceHorizontal(inner-4, lipgloss.Center, lipgloss.NewStyle().Bold(true).Foreground(t.title).Render(helpTitles[m.help]))
	out := []string{closeButton + " " + title, t.fg(t.border).Render(strings.Repeat("─", inner))}
	for row := 0; row < bodyHeight && scroll+row < len(lines); row++ {
		out = append(out, lines[scroll+row])
	}
	m.hits.add("help-sheet", x, y, width, height)
	m.hits.add("help-close", x+2, y+1, lipgloss.Width(closeButton), 1)
	for len(out) < height-5 {
		out = append(out, "")
	}
	hint := "↑/↓ 스크롤 · Esc 닫기"
	if m.help == "mcp" {
		hint = "↑/↓ 스크롤 · C 안내 복사 · Esc 닫기"
	}
	row, zones := m.actionRow(inner, helpActions, m.helpBar, hint)
	out = append(out, t.fg(t.divider).Render(strings.Repeat("─", inner)))
	for _, zone := range zones {
		m.hits.add(zone.id, x+2+zone.x, y+1+len(out), zone.width, 1)
	}
	out = append(out, row, "")
	return panel(out, inner, t.bgPanel, t.border, 1), x, y
}
