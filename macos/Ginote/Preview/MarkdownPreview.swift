import AppKit
import GinoteCore
import Markdown
import SwiftUI

/// Markdown 미리보기(⇧⌘M). WebView 없이 swift-markdown으로 파싱해 글자 속성으로 그린다.
/// GFM, 한 줄 바꿈은 줄바꿈(웹 `breaks: true`와 같음). HTML은 앱이 쓰는 `<audio>`만 바꾸고 나머지는 원문으로 보인다.
struct MarkdownPreview: View {
    private var app: AppModel { .shared }
    let markdown: String
    let title: String?
    let maxWidth: CGFloat
    var initialScrollRatio: Double = 0
    var onScroll: (Double) -> Void = { _ in }
    /// 본문 아래에 이어 붙일 기록(댓글) 영역.
    var header: AnyView?
    var footer: AnyView?
    @State var images: [String: NSImage] = [:]

    var body: some View {
        PreviewTextView(attributed: render(), maxWidth: maxWidth, initialScrollRatio: initialScrollRatio, onScroll: onScroll, header: header, footer: footer)
            .task(id: markdown) { await loadImages() }
    }

    private func render() -> NSAttributedString {
        let style = EditorStyle(app.settings.preferences)
        var source = markdown.trimmingCharacters(in: .whitespacesAndNewlines)
        if let title, !title.isEmpty { source = "# \(title)\n\n\(source)" }
        guard !source.isEmpty else {
            return NSAttributedString(string: String(localized: "내용이 없습니다."), attributes: [.font: style.font, .foregroundColor: NSColor.secondaryLabelColor])
        }
        var renderer = AttributedRenderer(base: style.font, paragraph: style.paragraphStyle, images: images)
        return renderer.render(Document(parsing: source))
    }

    /// 첨부 이미지(ginote-assets)는 토큰으로 받아 온다. 다른 외부 이미지는 불러오지 않는다(웹과 같은 범위).
    private func loadImages() async {
        guard let workspace = app.workspace else { return }
        var collector = ImageCollector()
        collector.visit(Document(parsing: markdown))
        for source in collector.sources where images[source] == nil {
            guard let path = CommentStore.path(fromRawURL: source) else { continue }
            let item = Attachment(path: path)
            if let url = try? await AttachmentStore.localFile(item, client: workspace.client), let image = NSImage(contentsOf: url) {
                images[source] = image
            }
        }
    }
}

private struct ImageCollector: MarkupWalker {
    var sources: [String] = []
    mutating func visitImage(_ image: Markdown.Image) { if let source = image.source { sources.append(source) } }
}

private struct PreviewTextView: NSViewRepresentable {
    let attributed: NSAttributedString
    let maxWidth: CGFloat
    let initialScrollRatio: Double
    let onScroll: (Double) -> Void
    let header: AnyView?
    let footer: AnyView?

    func makeCoordinator() -> Coordinator { Coordinator(onScroll: onScroll) }

    final class Coordinator: NSObject {
        let onScroll: (Double) -> Void
        var applied = false
        init(onScroll: @escaping (Double) -> Void) { self.onScroll = onScroll }
        @MainActor @objc func didScroll(_ notification: Notification) {
            guard applied, let clip = notification.object as? NSClipView, let scrollView = clip.enclosingScrollView else { return }
            onScroll(ScrollRatio.current(of: scrollView))
        }
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        // 미리보기임을 알아보게 옅은 회색 바탕을 깐다(웹 markdown-preview).
        scrollView.drawsBackground = true
        scrollView.backgroundColor = NSColor.secondaryLabelColor.withAlphaComponent(0.07)
        let storage = NSTextStorage()
        let layout = InlineCodeLayoutManager()
        let container = NSTextContainer()
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        let textView = DocumentTextView(frame: .zero, textContainer: container)
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.isHorizontallyResizable = false
        textView.textContainer?.widthTracksTextView = true
        textView.textContainerInset = NSSize(width: 24, height: 20)
        textView.textContainer?.lineFragmentPadding = 0
        let document = NoteDocumentView(textView: textView)
        scrollView.documentView = document
        document.setHeader(header)
        document.setFooter(footer)
        scrollView.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(context.coordinator, selector: #selector(Coordinator.didScroll(_:)),
                                               name: NSView.boundsDidChangeNotification, object: scrollView.contentView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        // makeNSView가 만든 문서 뷰다.
        let document = scrollView.documentView as! NoteDocumentView
        let textView = document.textView
        document.setHeader(header)
        document.setFooter(footer)
        let ratio = scrollView.contentView.bounds.minY / max(1, document.bounds.height)
        textView.textStorage?.setAttributedString(attributed)
        let horizontal = max(24, (scrollView.bounds.width - maxWidth) / 2)
        textView.textContainerInset = NSSize(width: horizontal, height: 20)
        textView.layoutManager?.ensureLayout(for: textView.textContainer!)
        if context.coordinator.applied {
            document.relayout()
            scrollView.contentView.scroll(to: NSPoint(x: 0, y: ratio * document.bounds.height))
        } else {
            // 처음 그릴 때는 편집기에서 보던 위치로 간다(웹과 같음).
            let start = initialScrollRatio
            DispatchQueue.main.async {
                ScrollRatio.apply(start, to: scrollView)
                context.coordinator.applied = true
            }
        }
    }
}

/// swift-markdown 문서 → 글자 속성.
private struct AttributedRenderer: MarkupVisitor {
    typealias Result = NSMutableAttributedString

    let base: NSFont
    let paragraph: NSParagraphStyle
    let images: [String: NSImage]
    var traits: NSFontTraitMask = []
    var color: NSColor = .textColor
    var indent: CGFloat = 0
    var linkURL: URL?

    init(base: NSFont, paragraph: NSParagraphStyle, images: [String: NSImage]) {
        self.base = base
        self.paragraph = paragraph
        self.images = images
    }

    mutating func render(_ document: Document) -> NSAttributedString {
        let result = visit(document)
        while result.string.hasSuffix("\n") { result.deleteCharacters(in: NSRange(location: result.length - 1, length: 1)) }
        return result
    }

    private func font(size scale: CGFloat = 1, mono: Bool = false) -> NSFont {
        var font = mono ? NSFont.monospacedSystemFont(ofSize: base.pointSize * 0.92, weight: .regular) : base.withSize(base.pointSize * scale)
        if !traits.isEmpty { font = NSFontManager.shared.convert(font, toHaveTrait: traits) }
        return font
    }

    private func paragraphStyle(spacing: CGFloat = 0.6) -> NSParagraphStyle {
        let style = (paragraph.mutableCopy() as! NSMutableParagraphStyle)
        style.paragraphSpacing = base.pointSize * spacing
        style.firstLineHeadIndent = indent
        style.headIndent = indent
        return style
    }

    private func text(_ string: String, mono: Bool = false, scale: CGFloat = 1) -> NSMutableAttributedString {
        var attributes: [NSAttributedString.Key: Any] = [.font: font(size: scale, mono: mono), .foregroundColor: color]
        if let linkURL { attributes[.link] = linkURL }
        if mono { attributes[.backgroundColor] = NSColor.quaternaryLabelColor }
        return NSMutableAttributedString(string: string, attributes: attributes)
    }

    mutating func defaultVisit(_ markup: Markup) -> NSMutableAttributedString {
        let result = NSMutableAttributedString()
        for child in markup.children { result.append(visit(child)) }
        return result
    }

    mutating func visitText(_ text: Markdown.Text) -> NSMutableAttributedString { self.text(text.string) }
    mutating func visitSoftBreak(_ softBreak: SoftBreak) -> NSMutableAttributedString { text("\n") }
    mutating func visitLineBreak(_ lineBreak: LineBreak) -> NSMutableAttributedString { text("\n") }
    mutating func visitInlineCode(_ inlineCode: InlineCode) -> NSMutableAttributedString {
        let result = text(inlineCode.code, mono: true)
        result.removeAttribute(.backgroundColor, range: NSRange(location: 0, length: result.length))
        result.addAttribute(.ginoteInlineCode, value: true, range: NSRange(location: 0, length: result.length))
        return result
    }

    mutating func visitEmphasis(_ emphasis: Emphasis) -> NSMutableAttributedString {
        traits.insert(.italicFontMask); defer { traits.remove(.italicFontMask) }
        return defaultVisit(emphasis)
    }

    mutating func visitStrong(_ strong: Strong) -> NSMutableAttributedString {
        traits.insert(.boldFontMask); defer { traits.remove(.boldFontMask) }
        return defaultVisit(strong)
    }

    mutating func visitStrikethrough(_ strikethrough: Strikethrough) -> NSMutableAttributedString {
        let result = defaultVisit(strikethrough)
        result.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: NSRange(location: 0, length: result.length))
        return result
    }

    mutating func visitLink(_ link: Markdown.Link) -> NSMutableAttributedString {
        let previous = linkURL
        linkURL = link.destination.flatMap(URL.init(string:))
        defer { linkURL = previous }
        let result = defaultVisit(link)
        if result.length == 0, let destination = link.destination {
            // 글자 없는 첨부 링크(`[](…/ginote-assets/…)`)는 긴 주소 대신 📎 파일 이름으로 보인다.
            if let path = CommentStore.path(fromRawURL: destination) {
                result.append(text("📎 " + AttachmentLinks.displayName(fromPath: path)))
            } else {
                result.append(text(destination))
            }
        }
        return result
    }

    mutating func visitImage(_ image: Markdown.Image) -> NSMutableAttributedString {
        guard let source = image.source, let loaded = images[source] else {
            return text("🖼 \(image.plainText.isEmpty ? (image.source ?? "") : image.plainText)")
        }
        let attachment = NSTextAttachment()
        let width = min(loaded.size.width, 640)
        let scale = width / max(loaded.size.width, 1)
        attachment.image = loaded
        attachment.bounds = CGRect(x: 0, y: 0, width: width, height: loaded.size.height * scale)
        return NSMutableAttributedString(attachment: attachment)
    }

    mutating func visitInlineHTML(_ inlineHTML: InlineHTML) -> NSMutableAttributedString { html(inlineHTML.rawHTML) }
    mutating func visitHTMLBlock(_ html: HTMLBlock) -> NSMutableAttributedString {
        let result = self.html(html.rawHTML)
        result.append(text("\n"))
        return result
    }

    private func html(_ raw: String) -> NSMutableAttributedString {
        if raw.lowercased().contains("<audio") || raw.lowercased().hasPrefix("</audio") {
            let sources = VoiceNotes.audioSources(raw)
            return sources.isEmpty ? NSMutableAttributedString() : text(String(localized: "🎙 원본 음성 (기록 패널에서 재생)"))
        }
        if raw.hasPrefix("<!--") { return NSMutableAttributedString() }
        return text(raw)
    }

    mutating func visitParagraph(_ paragraph: Paragraph) -> NSMutableAttributedString {
        let result = defaultVisit(paragraph)
        result.append(text("\n"))
        result.addAttribute(.paragraphStyle, value: paragraphStyle(), range: NSRange(location: 0, length: result.length))
        return result
    }

    mutating func visitHeading(_ heading: Heading) -> NSMutableAttributedString {
        traits.insert(.boldFontMask); defer { traits.remove(.boldFontMask) }
        let scale: CGFloat = [1.6, 1.35, 1.15, 1.05, 1, 1][min(heading.level, 6) - 1]
        let result = NSMutableAttributedString()
        for child in heading.children {
            let part = visit(child)
            part.addAttribute(.font, value: font(size: scale), range: NSRange(location: 0, length: part.length))
            result.append(part)
        }
        result.append(text("\n"))
        result.addAttribute(.paragraphStyle, value: paragraphStyle(spacing: 0.5), range: NSRange(location: 0, length: result.length))
        return result
    }

    mutating func visitBlockQuote(_ blockQuote: BlockQuote) -> NSMutableAttributedString {
        let previousColor = color
        color = .secondaryLabelColor
        indent += 16
        defer { color = previousColor; indent -= 16 }
        return defaultVisit(blockQuote)
    }

    mutating func visitCodeBlock(_ codeBlock: CodeBlock) -> NSMutableAttributedString {
        // 코드 끝 줄바꿈은 하나로 맞춘다.
        let result = text(codeBlock.code.replacingOccurrences(of: "\n*$", with: "\n", options: .regularExpression), mono: true)
        result.addAttribute(.paragraphStyle, value: paragraphStyle(spacing: 0.2), range: NSRange(location: 0, length: result.length))
        return result
    }

    mutating func visitThematicBreak(_ thematicBreak: ThematicBreak) -> NSMutableAttributedString {
        text("──────────\n")
    }

    mutating func visitUnorderedList(_ list: UnorderedList) -> NSMutableAttributedString { listItems(list.children, ordered: false, start: 1) }
    mutating func visitOrderedList(_ list: OrderedList) -> NSMutableAttributedString { listItems(list.children, ordered: true, start: Int(list.startIndex)) }

    private mutating func listItems(_ children: MarkupChildren, ordered: Bool, start: Int) -> NSMutableAttributedString {
        let result = NSMutableAttributedString()
        indent += 22
        defer { indent -= 22 }
        for (offset, child) in children.enumerated() {
            // 목록의 자식은 늘 항목(ListItem)이다.
            let item = child as! ListItem
            var marker = ordered ? "\(start + offset). " : "• "
            if let checkbox = item.checkbox { marker = checkbox == .checked ? "☑ " : "☐ " }
            let content = NSMutableAttributedString()
            for part in item.children { content.append(visit(part)) }
            content.insert(text(marker), at: 0)
            let style = paragraphStyle(spacing: 0.2).mutableCopy() as! NSMutableParagraphStyle
            style.firstLineHeadIndent = indent - 18
            content.addAttribute(.paragraphStyle, value: style, range: NSRange(location: 0, length: min(content.length, (content.string as NSString).range(of: "\n").location == NSNotFound ? content.length : (content.string as NSString).range(of: "\n").location + 1)))
            result.append(content)
        }
        return result
    }

    mutating func visitTable(_ table: Markdown.Table) -> NSMutableAttributedString {
        let result = NSMutableAttributedString()
        var rows: [[String]] = [table.head.cells.map(\.plainText)]
        rows += table.body.rows.map { $0.cells.map(\.plainText) }
        for (index, row) in rows.enumerated() {
            let line = text(row.joined(separator: "  │  ") + "\n")
            if index == 0 { line.addAttribute(.font, value: NSFontManager.shared.convert(base, toHaveTrait: .boldFontMask), range: NSRange(location: 0, length: line.length)) }
            result.append(line)
        }
        result.addAttribute(.paragraphStyle, value: paragraphStyle(spacing: 0.2), range: NSRange(location: 0, length: result.length))
        return result
    }
}
