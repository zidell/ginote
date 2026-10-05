import AppKit
import GinoteCore
import XCTest
@testable import Ginote_Native

/// 단축키 설정이 메뉴와 키 입력에 반영되는지. 창을 띄우지 않는다.
@MainActor
final class ShortcutTests: XCTestCase {
    func testMenuShortcutsFollowSettings() {
        let menu = NSMenu()
        let noteMenu = NSMenu(title: "노트")
        let tags = NSMenuItem(title: ShortcutCommand.tags.title, action: nil, keyEquivalent: "t")
        tags.keyEquivalentModifierMask = [.command, .shift]
        let pin = NSMenuItem(title: "고정 해제", action: nil, keyEquivalent: "p")
        noteMenu.addItem(tags)
        noteMenu.addItem(pin)
        let top = NSMenuItem(title: "노트", action: nil, keyEquivalent: "")
        top.submenu = noteMenu
        menu.addItem(top)

        var settings = AppSettings()
        settings.shortcuts[.tags] = "option+t"
        settings.shortcuts[.pin] = ""
        MenuShortcuts.apply(settings, to: menu)

        XCTAssertEqual(tags.keyEquivalent, "t")
        XCTAssertEqual(tags.keyEquivalentModifierMask, [.option])
        XCTAssertEqual(pin.keyEquivalent, "", "비운 단축키는 상태에 따라 바뀐 제목(고정 해제)에서도 지운다")
    }

    func testKeyShortcutReadsKeyPositionNotInputMethodCharacter() throws {
        // 세벌식에서 T 자리는 한글을 내지만 단축키는 자판 위치(key code 17)로 읽는다.
        let event = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [.option], timestamp: 0,
                                                   windowNumber: 0, context: nil, characters: "ㅌ", charactersIgnoringModifiers: "ㅌ",
                                                   isARepeat: false, keyCode: 17))
        XCTAssertEqual(KeyShortcut(event: event)?.spec, "option+t")
    }
}
