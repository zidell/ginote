import AppKit
import GinoteCore
import SwiftUI

/// 목록 칸 맨 위의 검색. `#`을 치면 태그 후보가 뜨고 ↑↓·⏎로 고른다. 걸린 태그 필터는 칩으로 보인다.
struct ListSearchBar: View {
    private var app: AppModel { .shared }
    @Bindable var workspace: WorkspaceModel
    var pane: FocusState<PaneFocus?>.Binding
    @State var highlighted = -1

    private var suggestions: [GitHubLabel] {
        let text = workspace.searchText.trimmingCharacters(in: .whitespaces)
        guard text.hasPrefix("#") else { return [] }
        let term = text.drop { $0 == "#" }.lowercased()
        return Array(workspace.visibleLabels.filter { term.isEmpty || $0.name.lowercased().contains(term) }.prefix(8))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SearchField(
                text: $workspace.searchText,
                prompt: String(localized: "검색 또는 #태그"),
                focusRequest: app.searchFocusRequest,
                onMove: { step in
                    guard !suggestions.isEmpty else {
                        // 후보가 없을 때 ↓는 목록으로, ↑는 새 노트 버튼으로 간다.
                        if step > 0 {
                            pane.wrappedValue = .list
                            if workspace.selection.isEmpty, let first = workspace.displayedIssues.first?.id {
                                ListKeyboard.markMoved()
                                workspace.selection = [first]
                            }
                        } else {
                            NSApp.keyWindow?.makeFirstResponder(nil)
                            app.toolbarKeyFocus = .newNote
                        }
                        return true
                    }
                    let count = suggestions.count
                    highlighted = step > 0 ? (highlighted + 1) % count : (highlighted <= 0 ? count - 1 : highlighted - 1)
                    return true
                },
                onSubmit: {
                    if suggestions.indices.contains(highlighted) {
                        pick(suggestions[highlighted])
                    } else {
                        workspace.submitSearch()
                    }
                },
                onCancel: {
                    if workspace.searchText.isEmpty { pane.wrappedValue = .list } else { workspace.searchText = "" }
                }
            )
            .frame(height: 24)
            .onChange(of: workspace.searchText) { _, text in
                highlighted = -1
                if text.isEmpty { workspace.clearSearch() }
            }

            if !suggestions.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(suggestions.enumerated()), id: \.element.name) { index, label in
                        Button { pick(label) } label: {
                            HStack(spacing: 6) {
                                Circle().fill(Color(hex: TagColor.hex(for: label.name))).frame(width: 8, height: 8)
                                Text("#\(label.name)")
                                Spacer()
                            }
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(RoundedRectangle(cornerRadius: 5).fill(index == highlighted ? Color.accentColor.opacity(0.25) : .clear))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(4)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.secondary.opacity(0.25)))
            }

            if let label = workspace.labelFilter {
                HStack(spacing: 4) {
                    Text("#\(label)")
                    Button { workspace.labelFilter = nil } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)) }
                        .buttonStyle(.plain)
                        .help("태그 필터 지우기")
                }
                .font(.callout)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Capsule().fill(Color(hex: TagColor.hex(for: label)).opacity(0.25)))
            }
        }
    }

    private func pick(_ label: GitHubLabel) {
        workspace.searchText = "#\(label.name)"
        workspace.submitSearch()
        pane.wrappedValue = .list
    }
}

/// macOS 검색칸(NSSearchField). 한글 조합은 OS가 처리하고, ↑↓·⏎·⎋만 가로챈다.
struct SearchField: NSViewRepresentable {
    @Binding var text: String
    var prompt: String
    var focusRequest: Int
    /// ↑(-1)·↓(+1). 처리했으면 true.
    var onMove: (Int) -> Bool
    var onSubmit: () -> Void
    var onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSSearchField {
        let field = NSSearchField()
        field.placeholderString = prompt
        field.delegate = context.coordinator
        field.sendsSearchStringImmediately = false
        field.sendsWholeSearchString = true
        field.stringValue = text
        context.coordinator.focusRequest = focusRequest
        return field
    }

    func updateNSView(_ field: NSSearchField, context: Context) {
        context.coordinator.parent = self
        if field.stringValue != text, (field.currentEditor() as? NSTextView)?.hasMarkedText() != true { field.stringValue = text }
        if focusRequest != context.coordinator.focusRequest {
            context.coordinator.focusRequest = focusRequest
            DispatchQueue.main.async { field.window?.makeFirstResponder(field) }
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSSearchFieldDelegate {
        var parent: SearchField
        var focusRequest = 0

        init(_ parent: SearchField) { self.parent = parent }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSSearchField else { return }
            parent.text = field.stringValue
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            // 한글 조합 중에는 입력기가 처리하게 둔다.
            if textView.hasMarkedText() { return false }
            switch selector {
            case #selector(NSResponder.moveUp(_:)): return parent.onMove(-1)
            case #selector(NSResponder.moveDown(_:)): return parent.onMove(1)
            case #selector(NSResponder.insertNewline(_:)): parent.onSubmit(); return true
            case #selector(NSResponder.cancelOperation(_:)): parent.onCancel(); return true
            default: return false
            }
        }
    }
}
