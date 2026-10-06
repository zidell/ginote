package ui

import (
	"image/color"
	"testing"

	tea "charm.land/bubbletea/v2"
	uv "github.com/charmbracelet/ultraviolet"

	"github.com/zidell/ginote/tui/internal/config"
)

// 터미널이 다크·라이트 바뀜(2031)을 알리면 배경색을 다시 묻고, 그 답으로 테마를 바꾼다. 고정 테마는 따르지 않는다.
func TestColorSchemeChangeFollowsTerminal(t *testing.T) {
	for _, theme := range []string{config.ThemeAuto, config.ThemeDark} {
		prefs := config.DefaultPreferences()
		prefs.Theme = theme
		m := New(Options{Preferences: prefs, TUIConfigPath: t.TempDir() + "/tui.toml"})
		next, cmd := m.Update(uv.LightColorSchemeEvent{})
		if cmd == nil {
			t.Fatalf("%s: color scheme change did not ask for the background color", theme)
		}
		next, _ = next.Update(tea.BackgroundColorMsg{Color: color.White})
		got := next.(Model).th.bgApp
		want := newTheme(theme == config.ThemeDark).bgApp
		if got != want {
			t.Fatalf("%s: bgApp = %v, want %v", theme, got, want)
		}
	}
}
