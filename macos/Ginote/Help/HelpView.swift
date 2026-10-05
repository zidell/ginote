import AppKit
import GinoteCore
import SwiftUI

/// 도움말 창: 보안·데이터 흐름, AI 도구(MCP), 단축키, 정보.
struct HelpView: View {
    enum Topic: String, CaseIterable, Identifiable {
        case security = "보안과 데이터"
        case mcp = "AI 도구에서 쓰기"
        case keyboard = "단축키"
        case about = "정보"
        var id: String { rawValue }
        var title: LocalizedStringResource {
            switch self {
            case .security: return "보안과 데이터"
            case .mcp: return "AI 도구에서 쓰기"
            case .keyboard: return "단축키"
            case .about: return "정보"
            }
        }
        var icon: String {
            switch self {
            case .security: return "lock.shield"
            case .mcp: return "sparkles"
            case .keyboard: return "keyboard"
            case .about: return "info.circle"
            }
        }
    }

    @State var topic: Topic? = AppModel.shared.helpTopic

    var body: some View {
        NavigationSplitView {
            List(Topic.allCases, selection: $topic) { item in
                Label { Text(item.title) } icon: { Image(systemName: item.icon) }.tag(item)
            }
            .navigationSplitViewColumnWidth(180)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    switch topic ?? .security {
                    case .security: SecurityHelp()
                    case .mcp: McpHelp()
                    case .keyboard: KeyboardHelp()
                    case .about: AboutHelp()
                    }
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            }
        }
        .onChange(of: AppModel.shared.helpTopic) { _, value in topic = value }
    }
}

struct SecurityHelp: View {
    var body: some View {
        Text("보안과 데이터").font(.title2.bold())
        Text("Ginote에는 앱 서버가 없습니다. 이 앱은 GitHub API에 직접 연결하고, 음성 기능을 켠 경우에만 OpenAI에 연결합니다.")
        GroupBox {
            Text("이 Mac ⇄ GitHub (노트·태그·첨부) · 이 Mac → OpenAI (음성, 켰을 때만)").font(.callout.monospaced())
        }
        VStack(alignment: .leading, spacing: 6) {
            Text("• 노트·태그·첨부파일은 고른 GitHub 저장소에만 저장됩니다.")
            Text("• PAT와 OpenAI 키는 macOS 키체인에, 나머지 설정은 config.toml에 둡니다.")
            Text("• 저장 전 초안은 이 Mac의 앱 상태 폴더에만 남습니다. 잠금 노트의 평문은 남기지 않습니다.")
            Text("• 노트 잠금은 6자리 숫자로 본문과 기록을 AES-GCM으로 한 번 더 암호화합니다. 숫자는 저장하지 않습니다.")
            Text("• 분석·추적 서비스를 쓰지 않습니다.")
        }
        Text("잠금은 강력한 비밀번호를 대신하지 않습니다. 제목·태그·첨부파일은 암호화하지 않습니다.").foregroundStyle(.secondary)
        Link("자세한 설명(README)", destination: URL(string: "https://github.com/zidell/ginote#readme")!)
    }
}

struct McpHelp: View {
    private var app: AppModel { .shared }

    var body: some View {
        let repo = app.workspace?.repo ?? ""
        Text("AI 도구에서 MCP로 노트 사용하기").font(.title2.bold())
        Text("이 앱 전용 MCP 서버는 필요하지 않습니다. MCP를 지원하는 AI 도구에 GitHub 공식 MCP Server를 연결하면, 같은 저장소의 이슈를 여기의 노트처럼 읽고 수정할 수 있습니다.")
        LabeledContent("대상 저장소") {
            HStack {
                Text(repo).font(.body.monospaced())
                Button("복사") { copy(repo) }.disabled(repo.isEmpty)
            }
        }
        VStack(alignment: .leading, spacing: 6) {
            Text("1. MCP를 지원하는 AI 도구에 GitHub 공식 MCP Server를 추가하세요. 원격 연결 주소는 https://api.githubcopilot.com/mcp/입니다.")
            Text("2. Issues 권한은 읽기 및 쓰기로, 첨부파일을 쓰려면 Contents 권한도 읽기 및 쓰기로 허용하세요.")
            Text("3. issues와 repos 도구를 사용합니다. 이 Mac의 PAT는 AI 도구와 공유되지 않으니 따로 연결하세요.")
        }
        Text("첨부파일은 노트 본문의 이미지·파일 링크이고, 실제 파일은 .issue-note-assets/issues/{번호}/ 에 있습니다. AI 도구로 본문을 고칠 때 이 링크를 그대로 두세요.")
            .foregroundStyle(.secondary)
        Text("AI에게 처음 전달할 안내").font(.headline)
        let prompt = String(localized: "\(repo) 저장소의 GitHub Issues를 노트로 사용하세요. 열린 이슈는 노트, 닫힌 이슈는 휴지통이며 GitHub 라벨은 태그입니다. 첨부파일은 .issue-note-assets/issues/{issueNumber}/ 폴더에 저장되고, 이슈 본문에 일반 이미지·파일 링크로 연결되어 있습니다. 노트 본문을 수정할 때 이 링크를 반드시 그대로 유지하세요. 링크를 지우면 해당 첨부파일 연결도 끊깁니다.")
        GroupBox { Text(prompt).font(.callout) }
        Button("안내 복사") { copy(prompt) }
        Link("GitHub MCP Server", destination: URL(string: "https://github.com/github/github-mcp-server")!)
    }

    private func copy(_ text: String) {
        SystemActions.copy(text)
    }
}

struct KeyboardHelp: View {
    private var app: AppModel { .shared }

    /// 설정 → 단축키에서 바꾼 값을 그대로 보인다. 여러 명령을 한 줄에 묶으면 " / "로 잇는다.
    private func keys(_ commands: ShortcutCommand...) -> String {
        commands.map { app.shortcut($0)?.symbol ?? "–" }.joined(separator: " / ")
    }

    private var rows: [(String, String)] {
        [
            (keys(.newNote), String(localized: "새 노트")), (keys(.newVoiceNote), String(localized: "음성으로 새 노트")),
            (keys(.openInNewWindow), String(localized: "새 창에서 열기")), (keys(.saveNow), String(localized: "지금 저장")),
            ("⌘Z", String(localized: "실행 취소 (휴지통 이동·첨부/기록 삭제 포함)")),
            (keys(.find, .replace), String(localized: "노트 안에서 찾기 / 찾아 바꾸기")),
            (keys(.preview), String(localized: "Markdown 미리보기")), (keys(.refresh), String(localized: "새로고침")),
            (keys(.tags), String(localized: "태그")), (keys(.attachFiles), String(localized: "파일 첨부")),
            (keys(.voiceRecording), String(localized: "음성 녹음(본문에 추가)")),
            (keys(.lock), String(localized: "잠금 / 잠금 열기 / 잠금 풀기")), (keys(.pin), String(localized: "고정 / 고정 해제")),
            (keys(.copyIssueNumber), String(localized: "이슈 번호 복사")), (keys(.openOnGitHub), String(localized: "GitHub에서 보기")),
            (keys(.moveToTrash), String(localized: "휴지통으로 이동 / 복원")),
            ("⌘1–⌘9", String(localized: "저장소 전환")), (keys(.searchNotes), String(localized: "노트 검색(#태그)")),
            ("↑ ↓", String(localized: "커서 이동(열지 않음)")), (String(localized: "↑(목록 맨 위)"), String(localized: "검색칸 → 새 노트 → 음성으로 새 노트")),
            ("⏎", String(localized: "열기 · 한 번 더 누르면 본문으로")),
            ("← →", String(localized: "사이드바 ⇄ 목록 ⇄ 본문")), (String(localized: "⎋(본문)"), String(localized: "목록으로 돌아가기")),
            (keys(.zoomIn, .zoomOut, .actualSize), String(localized: "글자 확대 / 축소 / 실제 크기")),
            (String(localized: "⌘클릭 · ⇧클릭"), String(localized: "여러 노트 선택")), (String(localized: "⌘클릭(본문 링크)"), String(localized: "링크 열기")),
            (String(localized: "Space(첨부)"), "Quick Look"), ("⎋", String(localized: "시트 닫기·선택 해제"))
        ]
    }

    var body: some View {
        Text("단축키").font(.title2.bold())
        Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
            ForEach(rows.indices, id: \.self) { index in
                let row = rows[index]
                GridRow {
                    Text(row.0).font(.body.monospaced()).foregroundStyle(.secondary)
                    Text(row.1)
                }
            }
        }
    }
}

struct AboutHelp: View {
    private var app: AppModel { .shared }

    var body: some View {
        Text("Ginote Native").font(.title2.bold())
        Text("버전 \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
        Text("macOS 전용 시험 앱입니다. 웹·데스크톱(Tauri) 앱과 같은 저장소를 그대로 씁니다.").foregroundStyle(.secondary)
        LabeledContent("설정 파일") {
            Button(app.configStore.configURL.path) { SystemActions.reveal([app.configStore.configURL]) }
                .buttonStyle(.link)
        }
        Text("터미널에서 `Ginote --config-path`로 위치를 확인할 수 있습니다. 실행 중에 고쳐도 1초 안에 반영되고, 결과는 같은 폴더의 config-status.txt에 남습니다.")
            .font(.callout).foregroundStyle(.secondary)
    }
}
