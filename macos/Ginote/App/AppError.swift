import Foundation

/// 앱 안에서 막힌 이유(빈 태그 이름, 번호 없는 새 노트, 너무 긴 병합 본문 등). GitHub 오류(GitHubError)가 아니므로
/// 화면에 네트워크 문구("GitHub에 연결하지 못했습니다")로 바뀌지 않고, 다시 시도할 오류로 보지도 않는다.
struct AppError: LocalizedError, Equatable {
    var message: String
    var errorDescription: String? { message }
}
