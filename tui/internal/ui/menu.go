package ui

import "strings"

// menuItem은 선택 창(choiceModal)의 항목이다. 노트 ⋮ 메뉴, 댓글 ⋯ 메뉴, 저장소 전환, 환경설정의
// 선택 상자가 함께 쓴다.
type menuItem struct {
	id       string
	icon     string
	label    string
	detail   string // 이름 옆에 옅게 보이는 설명(저장소 주소 등)
	key      string
	disabled bool
	divider  bool // 이 항목 앞에 구분선
	danger   bool
}

// byKey는 단축키 글자로 항목을 찾는다(선택 창이 열린 채로 M, L 등을 눌렀을 때).
func (c *choiceModal) byKey(key string) (menuItem, bool) {
	for _, item := range c.items {
		if !item.disabled && item.key != "" && strings.EqualFold(item.key, key) {
			return item, true
		}
	}
	return menuItem{}, false
}
