import AppKit
import GinoteCore
import SwiftUI

/// 편집기 글꼴·간격 설정.
struct EditorStyle: Equatable {
    var fontName: String
    var fontSize: CGFloat
    var lineHeight: CGFloat
    var maxWidth: CGFloat

    init(_ preferences: Preferences) {
        fontName = preferences.editorFont
        fontSize = (CGFloat(preferences.editorFontSize) * CGFloat(preferences.uiScale)).rounded()
        lineHeight = CGFloat(preferences.editorLineHeight)
        maxWidth = CGFloat(preferences.editorMaxWidth)
    }

    var font: NSFont {
        let size = fontSize
        switch fontName {
        case "system", "sans": return .systemFont(ofSize: size)
        case "serif":
            let descriptor = NSFont.systemFont(ofSize: size).fontDescriptor.withDesign(.serif)
            return descriptor.flatMap { NSFont(descriptor: $0, size: size) } ?? .systemFont(ofSize: size)
        case "mono": return .monospacedSystemFont(ofSize: size, weight: .regular)
        default:
            let family = fontName.hasPrefix("local:") ? String(fontName.dropFirst(6)) : fontName
            return NSFontManager.shared.font(withFamily: family, traits: [], weight: 5, size: size)
                ?? NSFont(name: family, size: size) ?? .systemFont(ofSize: size)
        }
    }

    var paragraphStyle: NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        let natural = font.ascender - font.descender + font.leading
        style.lineSpacing = max(0, fontSize * lineHeight - natural)
        return style
    }
}

/// 노트 본문 편집기. Markdown 원문을 그대로 고치고, 가벼운 문법 강조만 입힌다.
/// 한글 조합 중(`hasMarkedText`)에는 문자열·속성을 바꾸지 않는다.
struct EditorTextView: NSViewRepresentable {
    @Binding var text: String
    var style: EditorStyle
    var editable: Bool
    /// 잠금 노트(잠김·열림). 본문 배경에 황금빛을 넣는다.
    var lockTinted = false
    var placeholder: String
    var focusRequest: Int = 0
    var onEdit: (String, Bool) -> Void
    var onBlur: () -> Void = {}
    var onSaveShortcut: () -> Void = {}
    var onEscape: () -> Void = {}
    /// 미리보기와 오갈 때 이어 줄 스크롤 위치(0~1). 처음 그릴 때 이 위치로 간다.
    var initialScrollRatio: Double = 0
    var onScroll: (Double) -> Void = { _ in }
    var onFiles: ([URL]) -> Void = { _ in }
    var onImages: ([NSImage]) -> Void = { _ in }
    /// 파일을 편집기 위로 끌어 온 동안 true(노트 칸 끌어 올리기 표시).
    var onDragTargeted: (Bool) -> Void = { _ in }
    /// 본문 위에 붙여 함께 스크롤할 머리(제목·태그·첨부).
    var header: AnyView?
    /// 본문 아래에 이어 붙일 기록(댓글) 영역.
    var footer: AnyView?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = FindBarScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        scrollView.autohidesScrollers = true

        let textView = GinoteTextView()
        textView.delegate = context.coordinator
        textView.coordinator = context.coordinator
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.drawsBackground = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isContinuousSpellCheckingEnabled = false
        textView.isGrammarCheckingEnabled = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticLinkDetectionEnabled = false
        textView.smartInsertDeleteEnabled = false
        textView.isHorizontallyResizable = false
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.lineFragmentPadding = 0
        textView.registerForDraggedTypes([.fileURL, .png, .tiff])
        textView.placeholderString = placeholder
        textView.alphaValue = GinoteTextView.unfocusedAlpha

        let document = NoteDocumentView(textView: textView)
        scrollView.documentView = document
        document.setHeader(header)
        document.setFooter(footer)
        context.coordinator.textView = textView
        scrollView.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(context.coordinator, selector: #selector(Coordinator.didScroll(_:)),
                                               name: NSView.boundsDidChangeNotification, object: scrollView.contentView)
        let ratio = initialScrollRatio
        if ratio > 0 {
            DispatchQueue.main.async { ScrollRatio.apply(ratio, to: scrollView) }
        }
        apply(style, to: textView)
        textView.string = text
        MarkdownStyler.restyle(textView, style: style)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = context.coordinator.textView else { return }
        (scrollView.documentView as? NoteDocumentView)?.setHeader(header)
        (scrollView.documentView as? NoteDocumentView)?.setFooter(footer)
        textView.isEditable = editable
        textView.placeholderString = placeholder
        if textView.lockTinted != lockTinted {
            textView.lockTinted = lockTinted
            textView.refreshBackground()
        }
        if context.coordinator.style != style {
            context.coordinator.style = style
            apply(style, to: textView)
            MarkdownStyler.restyle(textView, style: style)
        }
        // 조합 중이거나 방금 입력한 내용이면 덮어쓰지 않는다. 원격 갱신 등으로 바뀐 경우에만 넣는다.
        if textView.string != text && !textView.hasMarkedText() {
            let selection = textView.selectedRange()
            textView.string = text
            let length = (text as NSString).length
            textView.setSelectedRange(NSRange(location: min(selection.location, length), length: 0))
            MarkdownStyler.restyle(textView, style: style)
            textView.undoManager?.removeAllActions(withTarget: textView.textStorage as Any)
        }
        if focusRequest != context.coordinator.focusRequest {
            context.coordinator.focusRequest = focusRequest
            // 키보드로 본문에 들어가면 이어 쓰기 좋게 내용 맨 끝에 커서를 둔다(클릭은 누른 자리).
            DispatchQueue.main.async {
                guard textView.window?.makeFirstResponder(textView) == true else { return }
                let end = NSRange(location: (textView.string as NSString).length, length: 0)
                textView.setSelectedRange(end)
                textView.scrollRangeToVisible(end)
            }
        }
    }

    private func apply(_ style: EditorStyle, to textView: GinoteTextView) {
        textView.font = style.font
        textView.defaultParagraphStyle = style.paragraphStyle
        textView.typingAttributes = [.font: style.font, .paragraphStyle: style.paragraphStyle, .foregroundColor: NSColor.textColor]
        textView.maxContentWidth = style.maxWidth
        textView.updateInsets()
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: EditorTextView
        var style: EditorStyle
        var focusRequest: Int
        weak var textView: GinoteTextView?

        init(_ parent: EditorTextView) {
            self.parent = parent
            self.style = parent.style
            self.focusRequest = parent.focusRequest
        }

        func textDidChange(_ notification: Notification) {
            guard let textView else { return }
            let composing = textView.hasMarkedText()
            parent.text = textView.string
            parent.onEdit(textView.string, composing)
            if !composing { MarkdownStyler.restyleEditedParagraphs(textView, style: style) }
        }

        func textDidEndEditing(_ notification: Notification) {
            parent.onBlur()
        }

        /// GitHub 본문 상한(65,536)의 90%를 넘는 입력은 받지 않는다(웹 `maxlength`와 같음).
        func textView(_ textView: NSTextView, shouldChangeTextIn range: NSRange, replacementString text: String?) -> Bool {
            guard let text else { return true }
            let next = (textView.string as NSString).length - range.length + (text as NSString).length
            if next > NoteText.maxBodyLength && next > (textView.string as NSString).length { NSSound.beep(); return false }
            return true
        }

        @objc func didScroll(_ notification: Notification) {
            guard let scrollView = textView?.enclosingScrollView else { return }
            parent.onScroll(ScrollRatio.current(of: scrollView))
        }
    }
}

/// 본문 NSTextView. 최대 폭 가운데 정렬, 여러 줄 들여쓰기, ⌘클릭 링크, 파일 붙여넣기·끌어놓기.
final class GinoteTextView: NSTextView {
    /// 포커스가 없을 때의 본문 밝기. 보는 중인지 고치는 중인지 한눈에 구분되게 한다.
    static let unfocusedAlpha: CGFloat = 0.72
    weak var coordinator: EditorTextView.Coordinator?
    var lockTinted = false
    private var isFocusedForEditing = false
    var maxContentWidth: CGFloat = 840
    var placeholderString = ""

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        updateInsets()
    }

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted { setFocusAppearance(true) }
        return accepted
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned { setFocusAppearance(false) }
        return resigned
    }

    private func setFocusAppearance(_ focused: Bool) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.15
            animator().alphaValue = focused ? 1 : Self.unfocusedAlpha
        }
        isFocusedForEditing = focused
        refreshBackground()
    }

    /// 편집 중이면 노트 칸(본문과 기록) 배경을 편집 배경색(다크: 더 어둡게, 라이트: 흰색)으로, 읽는 중이면 창 배경
    /// 그대로. 잠금 노트는 두 경우 모두 황금빛을 더한다.
    func refreshBackground() {
        guard let scrollView = enclosingScrollView else { return }
        if isFocusedForEditing {
            scrollView.backgroundColor = lockTinted
                ? (NSColor.textBackgroundColor.blended(withFraction: 0.08, of: .systemOrange) ?? .textBackgroundColor)
                : .textBackgroundColor
            scrollView.drawsBackground = true
        } else {
            scrollView.backgroundColor = LockTint.body
            scrollView.drawsBackground = lockTinted
        }
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        refreshBackground()
    }

    func updateInsets() {
        let horizontal = max(24, (bounds.width - maxContentWidth) / 2)
        let inset = NSSize(width: horizontal, height: 20)
        if textContainerInset != inset { textContainerInset = inset }
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty, !placeholderString.isEmpty, !hasMarkedText() else { return }
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font ?? NSFont.systemFont(ofSize: 17),
            .foregroundColor: NSColor.placeholderTextColor
        ]
        (placeholderString as NSString).draw(at: NSPoint(x: textContainerInset.width, y: textContainerInset.height), withAttributes: attributes)
    }

    // MARK: - 단축키

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if let save = AppModel.shared.shortcut(.saveNow), KeyShortcut(event: event) == save {
            coordinator?.parent.onSaveShortcut()
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    /// ⎋: 조합 중이 아니면 목록으로 포커스를 돌린다(웹에서 ⎋가 입력칸을 벗어나는 것과 같다).
    override func cancelOperation(_ sender: Any?) {
        guard !hasMarkedText() else { return super.cancelOperation(sender) }
        coordinator?.parent.onEscape()
    }

    /// 글을 고른 채 Tab을 누르면 줄마다 들여쓴다.
    override func insertTab(_ sender: Any?) {
        if !Self.indentLines(of: self, outdent: false) { super.insertTab(sender) }
    }

    override func insertBacktab(_ sender: Any?) {
        if !Self.indentLines(of: self, outdent: true) { super.insertBacktab(sender) }
    }

    /// 고른 줄들을 들여쓰거나(Tab) 내어 쓴다(⇧Tab). 고른 글이 없으면 false. 본문과 기록 입력칸이 함께 쓴다(웹과 같음).
    @discardableResult
    static func indentLines(of textView: NSTextView, outdent: Bool) -> Bool {
        guard !textView.hasMarkedText() else { return false }
        var selection = textView.selectedRange()
        guard selection.length > 0 else { return false }
        let text = textView.string as NSString
        if text.substring(with: selection).hasSuffix("\n"), selection.length > 1 { selection.length -= 1 }
        let range = text.lineRange(for: selection)
        var block = text.substring(with: range)
        let trailingNewline = block.hasSuffix("\n")
        if trailingNewline { block.removeLast() }
        var replaced = block.components(separatedBy: "\n").map { line -> String in
            guard outdent else { return "\t" + line }
            if line.hasPrefix("\t") { return String(line.dropFirst()) }
            let spaces = line.prefix(4).prefix { $0 == " " }.count
            return String(line.dropFirst(spaces))
        }.joined(separator: "\n")
        if trailingNewline { replaced += "\n" }
        guard textView.shouldChangeText(in: range, replacementString: replaced) else { return true }
        textView.replaceCharacters(in: range, with: replaced)
        textView.didChangeText()
        textView.setSelectedRange(NSRange(location: range.location, length: (replaced as NSString).length - (trailingNewline ? 1 : 0)))
        return true
    }

    // MARK: - 끌어 올리기 표시

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if sender.draggingPasteboard.availableType(from: [.fileURL, .png, .tiff]) != nil { coordinator?.parent.onDragTargeted(true) }
        return super.draggingEntered(sender)
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        coordinator?.parent.onDragTargeted(false)
        super.draggingExited(sender)
    }

    override func draggingEnded(_ sender: NSDraggingInfo) {
        coordinator?.parent.onDragTargeted(false)
        super.draggingEnded(sender)
    }

    // MARK: - 링크

    override func mouseDown(with event: NSEvent) {
        if event.modifierFlags.contains(.command), let url = link(at: event) {
            NSWorkspace.shared.open(url)
            return
        }
        super.mouseDown(with: event)
    }

    func link(at event: NSEvent) -> URL? {
        let point = convert(event.locationInWindow, from: nil)
        let index = characterIndexForInsertion(at: point)
        guard let found = NoteText.linkAtCursor(string, cursor: index) else { return nil }
        return URL(string: found.url)
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()
        if let url = link(at: event) {
            menu.insertItem(.separator(), at: 0)
            let copy = NSMenuItem(title: String(localized: "링크 복사"), action: #selector(copyLink(_:)), keyEquivalent: "")
            copy.representedObject = url
            copy.target = self
            menu.insertItem(copy, at: 0)
            let open = NSMenuItem(title: String(localized: "링크 열기"), action: #selector(openLink(_:)), keyEquivalent: "")
            open.representedObject = url
            open.target = self
            menu.insertItem(open, at: 0)
        }
        return menu
    }

    @objc private func openLink(_ sender: NSMenuItem) {
        if let url = sender.representedObject as? URL { NSWorkspace.shared.open(url) }
    }

    @objc private func copyLink(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url.absoluteString, forType: .string)
    }

    // MARK: - 파일 붙여넣기·끌어놓기

    /// 평문 편집기는 기본으로 글만 붙여넣을 수 있다고 알려, 클립보드에 이미지(스크린샷)나 파일만 있으면 편집 메뉴의
    /// 붙여넣기가 꺼진다. 이미지·파일도 받는다고 알려 ⌘V가 첨부로 이어지게 한다.
    override var readablePasteboardTypes: [NSPasteboard.PasteboardType] {
        super.readablePasteboardTypes + [.fileURL, .png, .tiff]
    }

    override func paste(_ sender: Any?) {
        if handleFiles(from: NSPasteboard.general) { return }
        super.paste(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if handleFiles(from: sender.draggingPasteboard) { return true }
        return super.performDragOperation(sender)
    }

    /// 파일·이미지면 첨부로 넘기고 true. 글이면 false(기본 동작).
    private func handleFiles(from pasteboard: NSPasteboard) -> Bool {
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            coordinator?.parent.onFiles(urls)
            return true
        }
        let hasText = pasteboard.availableType(from: [.string]) != nil
        if !hasText, let images = pasteboard.readObjects(forClasses: [NSImage.self]) as? [NSImage], !images.isEmpty {
            coordinator?.parent.onImages(images)
            return true
        }
        return false
    }
}

/// 찾기 막대(⌘F)가 뜨면 막대 높이만큼 본문을 아래로 민다. 그냥 두면 막대가 본문 첫 줄을 덮는다.
final class FindBarScrollView: NSScrollView {
    override var isFindBarVisible: Bool {
        didSet { adjustForFindBar() }
    }

    override func findBarViewDidChangeHeight() {
        super.findBarViewDidChangeHeight()
        adjustForFindBar()
    }

    /// 찾기 막대는 본문 위에 겹쳐 뜨고, AppKit은 그만큼 위쪽 여백(contentInsets)만 늘린다. 맨 위를 보고 있었으면
    /// 그 여백만큼 내려 첫 줄이 막대에 가리지 않게 한다. 막대를 닫으면 다시 맨 위로 맞춘다.
    private func adjustForFindBar() {
        DispatchQueue.main.async { [self] in
            let barHeight = isFindBarVisible ? (findBarView?.frame.height ?? 0) : 0
            let target = -(contentView.contentInsets.top + barHeight - (automaticallyAdjustsContentInsets ? 0 : 0))
            let top = -max(contentView.contentInsets.top, barHeight)
            #if DEBUG
            DebugTrace.log("findbar visible=\(isFindBarVisible) bar=\(barHeight) clipInsets=\(contentView.contentInsets.top) minY=\(contentView.bounds.minY) target=\(target)")
            #endif
            if contentView.bounds.minY <= 1 {
                contentView.scroll(to: NSPoint(x: 0, y: top))
                reflectScrolledClipView(contentView)
            }
        }
    }
}

/// 본문(편집기·미리보기) 글 상자 위에 머리(제목·태그·첨부)를, 아래에 기록(댓글)을 붙여 한 스크롤로 보이는 문서 뷰.
/// 웹처럼 글 상자는 최소 300pt에서 내용만큼 늘고, 기록은 그 바로 아래에 이어진다. 머리는 따로 바탕을 칠하지 않아
/// 본문과 같은 바탕(편집 중·잠금 빛)을 쓴다.
final class NoteDocumentView: NSView {
    static let minimumTextHeight: CGFloat = 300
    /// 기록 추가 직후 새 빈 입력칸에 포커스를 줄 때 보낸다.
    static let focusNewCommentNotification = Notification.Name("GinoteFocusNewComment")
    let textView: NSTextView
    private let footer = NSHostingView(rootView: AnyView(EmptyView()))
    private var footerHeight: CGFloat = 0
    private var hasFooter = false
    private let header = NSHostingView(rootView: AnyView(EmptyView()))
    private var headerHeight: CGFloat = 0
    private var hasHeader = false

    override var isFlipped: Bool { true }

    init(textView: NSTextView) {
        self.textView = textView
        super.init(frame: NSRect(x: 0, y: 0, width: 400, height: Self.minimumTextHeight))
        autoresizingMask = [.width]
        textView.autoresizingMask = [.width]
        textView.isVerticallyResizable = true
        textView.minSize = NSSize(width: 0, height: Self.minimumTextHeight)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
        textView.frame = NSRect(x: 0, y: 0, width: 400, height: Self.minimumTextHeight)
        addSubview(textView)
        footer.sizingOptions = []
        footer.isHidden = true
        // 높이를 다시 재기 전 한 순간에도 기록 영역이 본문 위로 넘쳐 그려지지 않게 자른다.
        footer.wantsLayer = true
        footer.layer?.masksToBounds = true
        addSubview(footer)
        header.sizingOptions = []
        header.isHidden = true
        addSubview(header)
        textView.postsFrameChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(textFrameChanged), name: NSView.frameDidChangeNotification, object: textView)
        NotificationCenter.default.addObserver(self, selector: #selector(focusNewComment), name: Self.focusNewCommentNotification, object: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    /// 기록 영역에서 비어 있는 마지막 입력칸(방금 추가한 기록)을 찾아 포커스를 주고 보이게 스크롤한다.
    @objc private func focusNewComment() {
        guard let window, window.isKeyWindow || window.isMainWindow else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.layoutSubtreeIfNeeded()
            var editors: [NSTextView] = []
            func collect(_ view: NSView) {
                if let text = view as? NSTextView, text.isEditable { editors.append(text) }
                view.subviews.forEach(collect)
            }
            collect(self.footer)
            let target = editors
                .filter { $0.string.isEmpty }
                .max { $0.convert($0.bounds, to: self).minY < $1.convert($1.bounds, to: self).minY }
            guard let target else { return }
            window.makeFirstResponder(target)
            target.scrollToVisible(target.bounds)
        }
    }

    /// 아래에 붙일 SwiftUI 화면. nil이면 기록 영역을 숨긴다.
    func setFooter(_ view: AnyView?) {
        hasFooter = view != nil
        footer.isHidden = !hasFooter
        guard let view else { footerHeight = 0; relayout(); return }
        footer.rootView = AnyView(
            view
                .fixedSize(horizontal: false, vertical: true)
                .background(GeometryReader { proxy in Color.clear.preference(key: FooterHeightKey.self, value: proxy.size.height) })
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .onPreferenceChange(FooterHeightKey.self) { [weak self] height in
                    MainActor.assumeIsolated {
                        guard let self, abs(self.footerHeight - height) > 0.5 else { return }
                        self.footerHeight = height
                        self.relayout()
                    }
                }
                .environment(AppModel.shared)
        )
        relayout()
    }

    /// 위에 붙일 SwiftUI 화면. nil이면 머리를 숨긴다.
    func setHeader(_ view: AnyView?) {
        hasHeader = view != nil
        header.isHidden = !hasHeader
        guard let view else { headerHeight = 0; relayout(); return }
        header.rootView = AnyView(
            view
                .fixedSize(horizontal: false, vertical: true)
                .background(GeometryReader { proxy in Color.clear.preference(key: FooterHeightKey.self, value: proxy.size.height) })
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .onPreferenceChange(FooterHeightKey.self) { [weak self] height in
                    MainActor.assumeIsolated {
                        guard let self, abs(self.headerHeight - height) > 0.5 else { return }
                        self.headerHeight = height
                        self.relayout()
                    }
                }
                .environment(AppModel.shared)
        )
        relayout()
    }

    @objc private func textFrameChanged() { relayout() }

    override func resizeSubviews(withOldSize oldSize: NSSize) {
        super.resizeSubviews(withOldSize: oldSize)
        relayout()
    }

    override func viewDidMoveToSuperview() {
        super.viewDidMoveToSuperview()
        guard let clip = superview as? NSClipView else { return }
        // 자동 크기 조정은 처음 폭에 차이만 더하므로, 폭은 늘 스크롤 영역에 맞춘다.
        clip.postsFrameChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(textFrameChanged), name: NSView.frameDidChangeNotification, object: clip)
        relayout()
    }

    /// 기록 입력칸도 본문처럼 자동 따옴표·대시·맞춤법 고침을 끈다(웹 textarea와 같게, Markdown 원문 보존).
    private func configureFooterEditors(_ view: NSView) {
        if let text = view as? NSTextView, text.isEditable, text.isAutomaticQuoteSubstitutionEnabled || text.isAutomaticSpellingCorrectionEnabled {
            text.isAutomaticQuoteSubstitutionEnabled = false
            text.isAutomaticDashSubstitutionEnabled = false
            text.isAutomaticTextReplacementEnabled = false
            text.isAutomaticSpellingCorrectionEnabled = false
            text.isContinuousSpellCheckingEnabled = false
        }
        view.subviews.forEach(configureFooterEditors)
    }

    func relayout() {
        if hasFooter { configureFooterEditors(footer) }
        let width = enclosingScrollView?.contentSize.width ?? bounds.width
        guard width > 0 else { return }
        if abs(frame.width - width) > 0.5 { setFrameSize(NSSize(width: width, height: frame.height)) }
        let headerSpace = hasHeader ? headerHeight : 0
        let headerFrame = NSRect(x: 0, y: 0, width: width, height: headerSpace)
        if header.frame != headerFrame { header.frame = headerFrame }
        if textView.frame.origin != NSPoint(x: 0, y: headerSpace) { textView.setFrameOrigin(NSPoint(x: 0, y: headerSpace)) }
        if textView.frame.width != width { textView.setFrameSize(NSSize(width: width, height: textView.frame.height)) }
        // 글 배치를 지금 끝내 글 상자 높이를 맞춘 뒤 그 아래에 기록을 놓는다(배치가 늦으면 기록이 글과 겹친다).
        if let container = textView.textContainer, let layout = textView.layoutManager {
            layout.ensureLayout(for: container)
            let used = layout.usedRect(for: container).height + textView.textContainerInset.height * 2
            let height = max(Self.minimumTextHeight, ceil(used))
            if abs(textView.frame.height - height) > 0.5 { textView.setFrameSize(NSSize(width: width, height: height)) }
        }
        let top = textView.frame.maxY
        let height = hasFooter ? max(footerHeight, 1) : 0
        let footerFrame = NSRect(x: 0, y: top, width: width, height: height)
        if footer.frame != footerFrame { footer.frame = footerFrame }
        let visible = enclosingScrollView?.contentSize.height ?? 0
        let total = max(top + (hasFooter ? footerHeight : 0), visible)
        if abs(frame.height - total) > 0.5 { setFrameSize(NSSize(width: width, height: total)) }
    }
}

private struct FooterHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// 스크롤 위치를 비율(0~1)로 읽고 쓴다. 편집기와 미리보기의 글 높이가 달라도 같은 자리를 가리킨다.
@MainActor
enum ScrollRatio {
    static func current(of scrollView: NSScrollView) -> Double {
        guard let document = scrollView.documentView else { return 0 }
        let range = document.bounds.height - scrollView.contentView.bounds.height
        return range > 0 ? Double(scrollView.contentView.bounds.minY / range) : 0
    }

    static func apply(_ ratio: Double, to scrollView: NSScrollView) {
        guard let document = scrollView.documentView else { return }
        let textView = (document as? NoteDocumentView)?.textView ?? document as? NSTextView
        if let textView, let container = textView.textContainer {
            textView.layoutManager?.ensureLayout(for: container)
        }
        let range = document.bounds.height - scrollView.contentView.bounds.height
        guard range > 0 else { return }
        scrollView.contentView.scroll(to: NSPoint(x: 0, y: CGFloat(ratio) * range))
        scrollView.reflectScrolledClipView(scrollView.contentView)
    }
}
