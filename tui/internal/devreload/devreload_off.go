//go:build !dev || !unix

package devreload

import tea "charm.land/bubbletea/v2"

const Enabled = false

type BuildingMsg struct{}

type FailedMsg struct{ Output string }

type ReadyMsg struct{}

func Watch() tea.Cmd { return nil }

func Handle(tea.Msg) (tea.Msg, tea.Cmd, bool) { return nil, nil, false }

func Binary() string { return "" }
