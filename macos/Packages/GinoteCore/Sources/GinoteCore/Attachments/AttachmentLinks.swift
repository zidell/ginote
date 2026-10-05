import Foundation

/// 첨부파일 경로·링크 규약. 웹 `src/lib/attachments.js`와 `github.js`의 같은 이름 함수를 옮겼다.
/// docs/ATTACHMENTS.md의 호환성 규약이 원본이며, 형식을 바꾸면 기존 노트를 읽지 못한다.
public enum AttachmentLinks {
    public static let branch = "ginote-assets"
    public static let managedStart = "<!-- ginote:attachments:start -->"
    public static let managedEnd = "<!-- ginote:attachments:end -->"
    public static let placeholder = "{repo}/"
    public static let maxPerNote = 30
    public static let maxFileBytes = 10 * 1024 * 1024

    static let rawLinkPattern = #"!?\[(?:\\.|[^\]\n])*\]\(https://github\.com/[^/)\s]+/[^/)\s]+/raw/ginote-assets/([^)\s]+)\)"#
    static let managedBlockPattern = #"(?:^|\n)<!-- ginote:attachments:start -->\s*[\s\S]*?\s*<!-- ginote:attachments:end -->(?=\n|$)"#

    public static func isImage(name: String, type: String? = nil) -> Bool {
        if let type, type.hasPrefix("image/") { return true }
        return JSText.firstMatch(name, #"\.(avif|gif|jpe?g|png|svg|webp)$"#, options: .caseInsensitive) != nil
    }

    public static func encodedPath(_ path: String) -> String {
        path.split(separator: "/", omittingEmptySubsequences: false)
            .map { JSText.encodeURIComponent(String($0)) }
            .joined(separator: "/")
    }

    public static func rawURL(repo: String, path: String) -> String {
        "https://github.com/\(repo)/raw/\(branch)/\(encodedPath(path))"
    }

    public static func composeLink(repo: String, path: String, name: String, type: String? = nil) -> String {
        let url = rawURL(repo: repo, path: path)
        return isImage(name: name, type: type) ? "![](\(url))" : "[](\(url))"
    }

    public static func parsePaths(_ body: String) -> [String] {
        JSText.matches(body, rawLinkPattern).compactMap { match in
            JSText.group(match, 1, in: body).map { encoded in
                encoded.split(separator: "/", omittingEmptySubsequences: false)
                    .map { JSText.decodeURIComponent(String($0)) }
                    .joined(separator: "/")
            }
        }
    }

    public static func removeLink(_ body: String, link: String) -> String {
        let removed = body.components(separatedBy: link).joined()
        return JSText.trim(JSText.replace(removed, #"\n{3,}"#, "\n\n"))
    }

    /// `position`은 JavaScript와 같은 UTF-16 위치다. nil이면 끝에 넣는다.
    public static func insertLinks(_ body: String, links: [String], position: Int? = nil) -> String {
        let units = Array(body.utf16)
        let cursor = position.map { min(max($0, 0), units.count) } ?? units.count
        let before = String(decoding: units[..<cursor], as: UTF16.self)
        let after = String(decoding: units[cursor...], as: UTF16.self)
        let block = links.joined(separator: "\n\n")
        let leading = before.isEmpty ? "" : before.hasSuffix("\n\n") ? "" : before.hasSuffix("\n") ? "\n" : "\n\n"
        let trailing = after.isEmpty ? "" : after.hasPrefix("\n\n") ? "" : after.hasPrefix("\n") ? "\n" : "\n\n"
        return before + leading + block + trailing + after
    }

    /// 편집할 때 숨기는 자동 관리 블록을 지운다.
    public static func stripManagedBlocks(_ body: String) -> String {
        guard body.contains(managedStart) else { return body }
        var text = JSText.replace(body, managedBlockPattern, "")
        text = JSText.replace(text, #"^\n+|\n+$"#, "")
        return JSText.replace(text, #"\n{3,}"#, "\n\n")
    }

    public static func managedLinks(_ body: String) -> [String] {
        JSText.matches(body, managedBlockPattern).flatMap { block -> [String] in
            guard let blockText = JSText.group(block, 0, in: body) else { return [] }
            return JSText.matches(blockText, rawLinkPattern).compactMap { JSText.group($0, 0, in: blockText) }
        }
    }

    public static func withManagedBlock(_ body: String, links: [String]) -> String {
        let stripped = stripManagedBlocks(body)
        guard !links.isEmpty else { return stripped }
        let block = [managedStart, links.joined(separator: "\n\n"), managedEnd].joined(separator: "\n\n")
        return stripped.isEmpty ? block : "\(block)\n\n\(stripped)"
    }

    static func urlPrefix(repo: String) -> String {
        "https://github.com/\(repo)/raw/\(branch)/"
    }

    /// 편집 화면에서 긴 첨부 주소를 `{repo}/`로 줄인다.
    public static func compress(_ body: String, repo: String) -> String {
        guard !repo.isEmpty else { return body }
        return body.components(separatedBy: urlPrefix(repo: repo)).joined(separator: placeholder)
    }

    /// 저장 전에 `{repo}/`를 완전한 주소로 되돌린다. 원격에는 항상 이 결과만 저장한다.
    public static func expand(_ body: String, repo: String) -> String {
        guard !repo.isEmpty else { return body }
        return body.components(separatedBy: placeholder).joined(separator: urlPrefix(repo: repo))
    }

    // MARK: - 저장소 경로

    public static func safeFileName(_ name: String) -> String {
        var text = name.precomposedStringWithCanonicalMapping
        text = JSText.replace(text, #"[\\/:*?"<>|#%]"#, "-")
        text = JSText.replace(text, #"\s+"#, "-")
        text = JSText.replace(text, "-+", "-")
        text = JSText.replace(text, "^-|-$", "")
        return text.isEmpty ? "attachment" : text
    }

    public static func directory(issueNumber: Int, commentId: Int? = nil) -> String {
        let base = ".issue-note-assets/issues/\(issueNumber)"
        guard let commentId else { return base }
        return "\(base)/comments/\(commentId)"
    }

    public static func path(issueNumber: Int, commentId: Int? = nil, fileName: String, uuid: UUID = UUID()) -> String {
        "\(directory(issueNumber: issueNumber, commentId: commentId))/\(uuid.uuidString.lowercased())-\(safeFileName(fileName))"
    }

    /// 저장 경로의 파일 이름에서 UUID 접두사를 뗀 표시 이름.
    public static func displayName(fromPath path: String) -> String {
        let fileName = path.split(separator: "/").last.map(String.init) ?? path
        return JSText.replace(fileName, #"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-"#, "", options: .caseInsensitive)
    }

    /// 확장자로 짐작한 MIME 형식. 이미지가 아니면 `application/octet-stream`.
    public static func inferredType(name: String) -> String {
        let ext = name.split(separator: ".").last.map { $0.lowercased() } ?? ""
        return [
            "avif": "image/avif", "gif": "image/gif", "jpeg": "image/jpeg", "jpg": "image/jpeg",
            "png": "image/png", "svg": "image/svg+xml", "webp": "image/webp"
        ][ext] ?? "application/octet-stream"
    }
}
