package ui

import tea "charm.land/bubbletea/v2"

// 한글 입력 상태에서도 단축키가 듣도록 두벌식 자모를 같은 자리의 영문 키로 바꾼다.
// 웹이 event.code(물리 키 위치)로 단축키를 판단하는 것과 같은 목적이다(keyboard-shortcuts.js).
var dubeolsik = map[string]string{
	"ㅂ": "q", "ㅈ": "w", "ㄷ": "e", "ㄱ": "r", "ㅅ": "t", "ㅛ": "y", "ㅕ": "u", "ㅑ": "i", "ㅐ": "o", "ㅔ": "p",
	"ㅁ": "a", "ㄴ": "s", "ㅇ": "d", "ㄹ": "f", "ㅎ": "g", "ㅗ": "h", "ㅓ": "j", "ㅏ": "k", "ㅣ": "l",
	"ㅋ": "z", "ㅌ": "x", "ㅊ": "c", "ㅍ": "v", "ㅠ": "b", "ㅜ": "n", "ㅡ": "m",
	"ㅃ": "Q", "ㅉ": "W", "ㄸ": "E", "ㄲ": "R", "ㅆ": "T", "ㅒ": "O", "ㅖ": "P",
}

// keyName은 단축키 비교에 쓰는 이름이다("up", "enter", "ctrl+r", "j" 등).
// 한글 같은 다른 자판의 글자가 오면 같은 자리의 영문 키로 본다. 터미널이 물리 키를 알려 주면
// (kitty 키보드 프로토콜의 BaseCode) 자판 종류와 상관없이 그것을 쓰고, 아니면 두벌식으로 바꾼다.
func keyName(msg tea.KeyPressMsg) string {
	if msg.Text != "" && msg.Text[0] >= 0x80 && msg.Mod == 0 {
		if base := msg.BaseCode; base >= 'a' && base <= 'z' {
			return string(base)
		}
	}
	if mapped, ok := dubeolsik[msg.Text]; ok {
		return mapped
	}
	return msg.String()
}
