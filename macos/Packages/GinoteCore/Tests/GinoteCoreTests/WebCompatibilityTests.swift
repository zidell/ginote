import Foundation
import XCTest
@testable import GinoteCore

/// 웹 코드(src/lib)가 만든 기대값과 Swift 구현의 결과를 비교한다. 기대값은
/// `node macos/scripts/make-fixtures.mjs`가 만든다(macos/DESIGN.md §9).
final class WebCompatibilityTests: XCTestCase {
    static let fixture: [String: Any] = {
        let url = Bundle.module.url(forResource: "web", withExtension: "json", subdirectory: "Fixtures")!
        return try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    }()

    var rules: [String: Any] { Self.fixture["deterministic"] as! [String: Any] }
    var seoul: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return calendar
    }

    func testNoteText() {
        for case let item as [String: Any] in rules["notes"] as! [Any] {
            let input = item["input"] as! String
            XCTAssertEqual(NoteText.automaticTitle(input), item["automaticTitle"] as? String, input)
            XCTAssertEqual(NoteText.automaticTitle(input, maxLength: 10), item["automaticTitle10"] as? String, input)
            XCTAssertEqual(NoteText.markdownToPlainText(input), item["plainText"] as? String, input)
            XCTAssertEqual(NoteText.firstLinePreview(input), item["firstLinePreview"] as? String, input)
            XCTAssertEqual(NoteText.shortenMiddle(input, maxLength: 12), item["shortenMiddle12"] as? String, input)
            XCTAssertEqual(NoteText.normalizeTagName(input), item["normalizeTagName"] as? String, input)

            let due = DueDate.parse(input, calendar: seoul).map { "\($0.year!)-\($0.month!)-\($0.day!)" }
            XCTAssertEqual(due, item["dueDate"] as? String, input)
            let now = seoul.date(from: DateComponents(year: 2026, month: 10, day: 4, hour: 15, minute: 30))!
            let badge = DueDate.badge(input, now: now, calendar: seoul)
            if let expected = item["dueBadge"] as? [String: Any] {
                XCTAssertEqual(badge?.days, expected["days"] as? Int, input)
                XCTAssertEqual(badge?.label, expected["label"] as? String, input)
                XCTAssertEqual(badge?.date, expected["date"] as? String, input)
            } else {
                XCTAssertNil(badge, input)
            }
        }
        for case let item as [String: Any] in rules["dueLabels"] as! [Any] {
            XCTAssertEqual(DueDate.label(days: item["days"] as! Int), item["label"] as? String)
        }
    }

    func testLinkAtCursor() {
        for case let item as [String: Any] in rules["linkAtCursor"] as! [Any] {
            let body = item["body"] as! String
            let cursor = item["cursor"] as! Int
            let link = NoteText.linkAtCursor(body, cursor: cursor)
            if let expected = item["link"] as? [String: Any] {
                XCTAssertEqual(link, NoteText.Link(url: expected["url"] as! String, start: expected["start"] as! Int, end: expected["end"] as! Int), "\(body) @\(cursor)")
            } else {
                XCTAssertNil(link, "\(body) @\(cursor)")
            }
        }
    }

    func testTags() {
        for case let item as [String: Any] in rules["tagColors"] as! [Any] {
            XCTAssertEqual(TagColor.hex(for: item["name"] as! String), item["color"] as? String, item["name"] as! String)
        }
        for case let item as [String: Any] in rules["tagDefinitions"] as! [Any] {
            let parsed = TagDefinition.parse(item["value"] as! String, currentName: item["current"] as? String)
            let expected = item["parsed"] as! [String: String]
            XCTAssertEqual(parsed.name, expected["name"])
            XCTAssertEqual(parsed.description, expected["description"])
        }
        for case let item as [String: Any] in rules["tagLimits"] as! [Any] {
            let tag = item["tag"] as! [String: String]
            let expected = item["limited"] as! [String: String]
            let limited = TagDefinition.limit(name: tag["name"]!, description: tag["description"]!)
            XCTAssertEqual(limited.name, expected["name"])
            XCTAssertEqual(limited.description, expected["description"])
        }
    }

    func testRepositoryAddress() {
        for case let item as [String: Any] in rules["repoAddresses"] as! [Any] {
            let parsed = RepoAddress.parse(item["input"] as! String)
            if let expected = item["parsed"] as? [String: String] {
                XCTAssertEqual(parsed?.owner, expected["owner"])
                XCTAssertEqual(parsed?.name, expected["name"])
                XCTAssertEqual(parsed?.fullName, expected["fullName"])
            } else {
                XCTAssertNil(parsed, item["input"] as! String)
            }
        }
        for case let item as [String: String] in rules["tokens"] as! [Any] {
            XCTAssertEqual(RepoAddress.normalizeToken(item["input"]!), item["normalized"])
        }
        for case let item as [String: String] in rules["patURLs"] as! [Any] {
            XCTAssertEqual(RepoAddress.patCreationURL(item["input"]!), item["url"])
        }
    }

    func testAttachmentLinks() {
        let section = rules["attachments"] as! [String: Any]
        let repo = section["repo"] as! String
        let links = section["links"] as! [String]
        XCTAssertEqual(AttachmentLinks.rawURL(repo: repo, path: ".issue-note-assets/issues/9/a b#c/한글.png"), section["rawURL"] as? String)
        XCTAssertEqual(AttachmentLinks.composeLink(repo: repo, path: ".issue-note-assets/issues/31/0f1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f5-사진.png", name: "사진.png"), links[0])
        XCTAssertEqual(AttachmentLinks.composeLink(repo: repo, path: ".issue-note-assets/issues/31/0f1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f6-plan 1.pdf", name: "plan 1.pdf"), links[1])
        for case let item as [String: Any] in section["isImageCases"] as! [Any] {
            let name = item["name"] as! String
            XCTAssertEqual(AttachmentLinks.composeLink(repo: repo, path: "p/\(name)", name: name, type: item["type"] as? String), item["link"] as? String)
        }

        for case let item as [String: Any] in section["bodies"] as! [Any] {
            let body = item["body"] as! String
            XCTAssertEqual(AttachmentLinks.parsePaths(body), item["paths"] as? [String], body)
            XCTAssertEqual(AttachmentLinks.stripManagedBlocks(body), item["stripped"] as? String, body)
            XCTAssertEqual(AttachmentLinks.managedLinks(body), item["managedLinks"] as? [String], body)
            XCTAssertEqual(AttachmentLinks.withManagedBlock(body, links: Array(links.prefix(2))), item["withBlock"] as? String, body)
            XCTAssertEqual(AttachmentLinks.withManagedBlock(body, links: []), item["withoutBlock"] as? String, body)
            let compressed = AttachmentLinks.compress(body, repo: repo)
            XCTAssertEqual(compressed, item["compressed"] as? String, body)
            XCTAssertEqual(AttachmentLinks.expand(compressed, repo: repo), item["roundTrip"] as? String, body)
            XCTAssertEqual(AttachmentLinks.removeLink(body, link: links[0]), item["removedFirst"] as? String, body)
            for case let insertion as [String: Any] in item["inserted"] as! [Any] {
                let position = insertion["position"] as? Int
                XCTAssertEqual(AttachmentLinks.insertLinks(body, links: Array(links.dropFirst()), position: position),
                               insertion["result"] as? String, "\(body) @\(String(describing: position))")
            }
        }
    }

    func testLockTitlesAndPins() {
        for case let item as [String: Any] in rules["lockTitles"] as! [Any] {
            let title = item["title"] as! String
            XCTAssertEqual(NoteLock.isLockedTitle(title), item["locked"] as? Bool, title)
            XCTAssertEqual(NoteLock.addLock(to: title), item["added"] as? String, title)
            XCTAssertEqual(NoteLock.removeLock(from: title), item["removed"] as? String, title)
        }
        for case let item as [String: Any] in rules["lockPins"] as! [Any] {
            let expected = item["pin"] as! String
            XCTAssertEqual(NoteLock.normalizePin(item["value"] as! String) ?? "", expected, item["value"] as! String)
        }
    }

    func testMergedBody() {
        let section = rules["merge"] as! [String: Any]
        let repo = section["repo"] as! String
        let zone = TimeZone(identifier: section["timeZone"] as! String)!
        let replacements = (section["replacements"] as! [[String]]).map { ($0[0], $0[1]) }
        let sources = (section["issues"] as! [[String: Any]]).map { issue in
            NoteMerge.Source(
                number: issue["number"] as! Int,
                title: issue["title"] as! String,
                createdAt: issue["created_at"] as! String,
                author: (issue["user"] as? [String: Any])?["login"] as? String ?? "",
                body: NoteMerge.replaceAttachmentURLs(issue["body"] as! String, repo: repo, replacements: replacements),
                comments: (issue["comments"] as! [[String: String]]).map {
                    .init(createdAt: $0["createdAt"]!, author: $0["author"]!, body: $0["body"]!)
                }
            )
        }
        XCTAssertEqual(NoteMerge.earliest(sources)?.number, section["earliest"] as? Int)
        let timeline = NoteMerge.timeline(sources)
        let expected = (section["timeline"] as! [[String: Any]]).map { "\($0["kind"]!)#\($0["issueNumber"]!)" }
        XCTAssertEqual(timeline.map { "\($0.kind.rawValue)#\($0.issueNumber)" }, expected)
        XCTAssertEqual(NoteMerge.formatBody(timeline, timeZone: zone), section["body"] as? String)
        let comments = (section["comments"] as! [[String: Any]]).map { "\($0["issueNumber"]!):\($0["body"]!)" }
        XCTAssertEqual(NoteMerge.comments(sources).map { "\($0.issueNumber):\($0.body)" }, comments)
    }

    // MARK: - 잠금 암호문

    func testDecryptsWebPayloads() throws {
        let lock = Self.fixture["lock"] as! [String: Any]
        let testPepper = lock["testPepper"] as! String
        for (key, pepper) in [("defaultPepper", nil as String?), ("customPepper", testPepper)] {
            for case let item as [String: Any] in lock[key] as! [Any] {
                let body = try NoteLock(pepper: pepper).decrypt(item["payload"] as! String, pin: item["pin"] as! String, issueNumber: item["issue"] as! Int)
                XCTAssertEqual(body, item["body"] as? String, key)
            }
        }
        // 빌드 pepper가 달라도 기본값으로 잠근 노트는 열린다(웹과 같은 대체 순서).
        let fallback = (lock["defaultPepper"] as! [[String: Any]])[0]
        XCTAssertEqual(try NoteLock(pepper: testPepper).decrypt(fallback["payload"] as! String, pin: fallback["pin"] as! String, issueNumber: fallback["issue"] as! Int),
                       fallback["body"] as? String)
        // 기본값 빌드는 다른 pepper로 잠근 노트를 열지 못한다.
        let custom = (lock["customPepper"] as! [[String: Any]])[0]
        XCTAssertThrowsError(try NoteLock().decrypt(custom["payload"] as! String, pin: custom["pin"] as! String, issueNumber: custom["issue"] as! Int))
        // 다른 이슈 번호나 틀린 PIN으로는 열리지 않는다.
        XCTAssertThrowsError(try NoteLock().decrypt(fallback["payload"] as! String, pin: "111111", issueNumber: fallback["issue"] as! Int))
        XCTAssertThrowsError(try NoteLock().decrypt(fallback["payload"] as! String, pin: fallback["pin"] as! String, issueNumber: 999))
    }

    func testWebDecryptsSwiftPayloads() throws {
        guard let node = Self.findNode() else { throw XCTSkip("node not found") }
        let testPepper = (Self.fixture["lock"] as! [String: Any])["testPepper"] as! String
        var cases: [[String: Any]] = []
        for (pepper, body, pin, issue) in [("", "스위프트 본문 😀\n줄", "123456", 5), (testPepper, "custom", "654321", 77)] {
            let payload = try NoteLock(pepper: pepper).encrypt(body, pin: pin, issueNumber: issue)
            XCTAssertTrue(NoteLock.isLockedPayload(payload))
            cases.append(["pepper": pepper, "body": body, "pin": pin, "issue": issue, "payload": payload])
        }
        let output = try Self.runNode(node, script: "verify-lock.mjs", input: JSONSerialization.data(withJSONObject: cases))
        XCTAssertEqual(output.status, 0, output.text)
    }

    func testFixturesMatchCurrentWebCode() throws {
        guard let node = Self.findNode() else { throw XCTSkip("node not found") }
        let output = try Self.runNode(node, script: "make-fixtures.mjs", arguments: ["--check"])
        XCTAssertEqual(output.status, 0, output.text)
    }

    // MARK: - Node

    static let scriptsDirectory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("scripts")

    static func findNode() -> URL? {
        let environment = ProcessInfo.processInfo.environment
        let candidates = [environment["GINOTE_NODE"]].compactMap { $0 }
            + (environment["PATH"] ?? "").split(separator: ":").map { String($0) + "/node" }
            + ["/opt/homebrew/bin", "/usr/local/bin"]
        for candidate in candidates {
            let url = URL(fileURLWithPath: candidate.hasSuffix("/node") ? candidate : candidate + "/node")
            guard FileManager.default.isExecutableFile(atPath: url.path) else { continue }
            let process = Process()
            process.executableURL = url
            process.arguments = ["--version"]
            let output = Pipe()
            process.standardOutput = output
            process.standardError = Pipe()
            guard (try? process.run()) != nil else { continue }
            process.waitUntilExit()
            let version = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            guard let major = Int(version.dropFirst().split(separator: ".").first ?? ""), major >= 22 else { continue }
            return url
        }
        return nil
    }

    static func runNode(_ node: URL, script: String, arguments: [String] = [], input: Data? = nil) throws -> (status: Int32, text: String) {
        let process = Process()
        process.executableURL = node
        process.arguments = [scriptsDirectory.appendingPathComponent(script).path] + arguments
        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = stdout
        let stdin = Pipe()
        process.standardInput = stdin
        try process.run()
        if let input { stdin.fileHandleForWriting.write(input) }
        stdin.fileHandleForWriting.closeFile()
        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}
