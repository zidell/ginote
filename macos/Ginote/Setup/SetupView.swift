import GinoteCore
import SwiftUI

/// 시작 마법사(소개·계정·저장소·토큰). 저장소 추가는 3단계부터 시트로 쓴다.
struct SetupView: View {
    enum Mode { case firstRun, addWorkspace }

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    @State private var step = 0
    @State private var repo = ""
    @State private var token = ""
    @State private var remember = true
    @State private var verifying = false
    @State private var errorMessage: String?

    private var steps: [Int] { mode == .firstRun ? [0, 1, 2, 3] : [2, 3] }
    private var current: Int { steps[min(step, steps.count - 1)] }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text(mode == .firstRun ? "Ginote 시작하기" : "저장소 추가").font(.title2.bold())
                Spacer()
                Text("\(step + 1) / \(steps.count)").foregroundStyle(.secondary)
            }
            ProgressView(value: Double(step + 1), total: Double(steps.count))
            Group {
                switch current {
                case 0: intro
                case 1: account
                case 2: repository
                default: tokenStep
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            if let errorMessage, current == 3 {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
            }
            HStack {
                if mode == .addWorkspace { Button("취소") { dismiss() }.keyboardShortcut(.cancelAction) }
                Spacer()
                if step > 0 { Button("이전") { step -= 1 } }
                if current == 3 {
                    Button(verifying ? "확인하는 중…" : "연결하고 시작") { Task { await connect() } }
                        .keyboardShortcut(.defaultAction)
                        .disabled(verifying || RepoAddress.normalizeToken(token).isEmpty)
                } else {
                    Button("다음") { step += 1 }
                        .keyboardShortcut(.defaultAction)
                        .disabled(current == 2 && RepoAddress.parse(repo) == nil)
                }
            }
        }
        .padding(28)
        .frame(minWidth: 520, minHeight: 460)
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("GitHub Issues를 노트앱 속도로.").font(.title3)
            Text("노트는 직접 만든 비공개 GitHub 저장소의 이슈로 저장됩니다. 태그는 라벨, 덧붙인 기록은 댓글, 휴지통은 닫힌 이슈입니다.")
            Text("앱 서버가 없습니다. 이 앱은 GitHub API(음성 기능을 켜면 OpenAI)에만 접속하고, 토큰은 macOS 키체인에 둡니다.")
            Text("개인이 만들어 공개하는 앱이라 기능 제안·지원은 받지 않습니다. 필요한 기능은 MIT 라이선스에 따라 포크해서 고쳐 쓰세요.")
                .foregroundStyle(.secondary)
        }
    }

    private var account: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("GitHub 계정").font(.title3)
            Text("GitHub에 로그인하세요. 계정이 없으면 무료로 만들 수 있습니다.")
            Link("github.com/signup", destination: URL(string: "https://github.com/signup")!)
        }
    }

    private var repository: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("노트 저장소").font(.title3)
            Text("노트를 담을 저장소를 `소유자/저장소이름` 형식이나 GitHub 주소로 입력하세요. 반드시 비공개(Private)로 만드세요.")
            TextField("https://github.com/owner/repository", text: $repo).textFieldStyle(.roundedBorder)
                // 주소 형식이 틀리면 빨갛게 표시한다(웹과 같음).
                .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Color.red, lineWidth: 1)
                    .opacity(!repo.trimmingCharacters(in: .whitespaces).isEmpty && RepoAddress.parse(repo) == nil ? 1 : 0))
            Link(mode == .firstRun ? "비공개 저장소 만들기" : "새 저장소 만들기",
                 destination: URL(string: mode == .firstRun ? "https://github.com/new?visibility=private" : "https://github.com/new")!)
        }
    }

    private var tokenStep: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("액세스 토큰").font(.title3)
            Text("Fine-grained 개인 액세스 토큰(PAT)을 만드세요. Repository access는 이 저장소만, 권한은 Issues: Read and write(필수)와 Contents: Read and write(첨부파일)입니다.")
            Link("\(RepoAddress.parse(repo)?.name ?? "Ginote")용 PAT 만들기", destination: URL(string: RepoAddress.patCreationURL(repo))!)
            SecureField("github_pat_…", text: $token).textFieldStyle(.roundedBorder)
            Toggle("이 Mac의 키체인에 토큰 기억", isOn: $remember)
        }
    }

    private func connect() async {
        guard let address = RepoAddress.parse(repo) else { return }
        let normalized = RepoAddress.normalizeToken(token)
        verifying = true
        errorMessage = nil
        defer { verifying = false }
        do {
            _ = try await GitHubClient(token: normalized, repo: address.fullName).verify()
            app.addWorkspace(repo: address.fullName, token: normalized, remember: remember)
            if mode == .addWorkspace { dismiss() }
        } catch let error as GitHubError {
            errorMessage = error.status == 401 ? String(localized: "PAT가 올바르지 않거나 폐기되었습니다.")
                : error.status == 404 ? String(localized: "저장소를 찾을 수 없습니다. 주소와 토큰의 저장소 범위를 확인하세요.")
                : error.message
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// 토큰을 기억하지 않았거나 만료된 저장소를 열 때 토큰을 다시 받는다.
struct TokenPromptView: View {
    @Environment(AppModel.self) private var app
    let workspace: Workspace
    @State private var token = ""
    @State private var remember = true
    @State private var verifying = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(workspace.title) 토큰").font(.headline)
            Text("이 저장소에 연결할 PAT를 입력하세요.").foregroundStyle(.secondary)
            Link("PAT 만들기", destination: URL(string: RepoAddress.patCreationURL(workspace.repo))!)
            SecureField("github_pat_…", text: $token).textFieldStyle(.roundedBorder)
            Toggle("이 Mac의 키체인에 토큰 기억", isOn: $remember)
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            HStack {
                Button("다른 저장소…") { app.tokenPromptWorkspace = nil; app.showingAddWorkspace = true }
                Spacer()
                Button("나중에") { app.tokenPromptWorkspace = nil }.keyboardShortcut(.cancelAction)
                Button(verifying ? "확인하는 중…" : "연결") { Task { await connect() } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(verifying || RepoAddress.normalizeToken(token).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 440)
        .onAppear { remember = workspace.rememberToken }
    }

    private func connect() async {
        let normalized = RepoAddress.normalizeToken(token)
        verifying = true
        defer { verifying = false }
        do {
            _ = try await GitHubClient(token: normalized, repo: workspace.repo).verify()
            app.setToken(normalized, for: workspace, remember: remember)
        } catch {
            errorMessage = (error as? GitHubError)?.status == 401 ? String(localized: "PAT가 올바르지 않거나 폐기되었습니다.") : error.localizedDescription
        }
    }
}
