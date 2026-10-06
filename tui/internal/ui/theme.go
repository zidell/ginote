package ui

import (
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
)

// theme은 웹 앱의 색 토큰(src/app.css의 --ui-*)을 그대로 옮긴 것이다.
type theme struct {
	bgApp, bgSidebar, bgSelected, bgHover, bgInput, bgOverlay, bgPanel color.Color
	text, title, secondary, muted, faint, placeholder, disabled, link  color.Color
	accent, accentBright, shortcut, danger, warning, border            color.Color
	selectedRow                                                        color.Color
	divider                                                            color.Color // 구분선보다 옅은 선
	tagAdd                                                             color.Color // muted를 본문 배경에 50% 합성
}

func newTheme(dark bool) theme {
	if dark {
		return theme{
			bgApp: hex("#171717"), bgSidebar: hex("#191919"), bgSelected: hex("#1b302e"), bgHover: hex("#313f3d"),
			bgInput: hex("#222222"), bgOverlay: hex("#242424"), bgPanel: hex("#202020"),
			text: hex("#e6e6e6"), title: hex("#e8e8e8"), secondary: hex("#bbbbbb"), muted: hex("#999999"),
			faint: hex("#777777"), placeholder: hex("#5f5f5f"), disabled: hex("#555555"), link: hex("#7dd3c8"),
			accent: hex("#0f766e"), accentBright: hex("#14b8a6"), shortcut: hex("#f59e0b"),
			danger: hex("#e05252"), warning: hex("#c7a43a"), border: hex("#383838"),
			selectedRow: hex("#3a3a3a"), divider: hex("#262626"), tagAdd: hex("#585858"),
		}
	}
	return theme{
		bgApp: hex("#ffffff"), bgSidebar: hex("#f8fafc"), bgSelected: hex("#e6f6f4"), bgHover: hex("#effaf8"),
		bgInput: hex("#ffffff"), bgOverlay: hex("#ffffff"), bgPanel: hex("#f8fafc"),
		text: hex("#1f2937"), title: hex("#1e293b"), secondary: hex("#475569"), muted: hex("#64748b"),
		faint: hex("#64748b"), placeholder: hex("#94a3b8"), disabled: hex("#94a3b8"), link: hex("#0f766e"),
		accent: hex("#0f766e"), accentBright: hex("#0f766e"), shortcut: hex("#d97706"),
		danger: hex("#dc2626"), warning: hex("#b45309"), border: hex("#d8dee8"),
		selectedRow: hex("#e2e8f0"), divider: hex("#eef2f6"), tagAdd: hex("#b2bac5"),
	}
}

func hex(value string) color.Color { return lipgloss.Color(value) }

func (t theme) fg(c color.Color) lipgloss.Style { return lipgloss.NewStyle().Foreground(c) }

// key는 버튼 옆 단축키 표시다(웹의 .shortcut-key, 주황색).
func (t theme) key(text string) string {
	return lipgloss.NewStyle().Foreground(t.shortcut).Bold(true).Render(text)
}

// button은 테두리 버튼 모양이다. 터미널 한 줄에 맞게 대괄호 대신 여백과 배경으로 그린다.
func (t theme) button(label string, active bool) string {
	background, foreground := t.bgInput, t.text
	if active {
		background, foreground = t.bgHover, t.title
	}
	return fillBackground(" "+lipgloss.NewStyle().Foreground(foreground).Render(label)+" ", 0, background)
}

// disabledButton은 누를 수 없는 버튼이다.
func (t theme) disabledButton(label string) string {
	return fillBackground(" "+lipgloss.NewStyle().Foreground(t.disabled).Render(label)+" ", 0, t.bgInput)
}

func (t theme) primaryButton(label string, width int) string {
	gap := max(0, width-lipgloss.Width(label))
	text := strings.Repeat(" ", gap/2) + lipgloss.NewStyle().Foreground(hex("#ffffff")).Bold(true).Render(label) + strings.Repeat(" ", gap-gap/2)
	return fillBackground(text, width, t.accent)
}
