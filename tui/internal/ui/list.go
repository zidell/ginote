package ui

import (
	"context"
	"strconv"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/zidell/ginote/tui/internal/auth"
	"github.com/zidell/ginote/tui/internal/config"
	"github.com/zidell/ginote/tui/internal/github"
	"github.com/zidell/ginote/tui/internal/notes"
)

// 목록 동작은 App.svelte의 loadIssues, loadMoreIssues, submitSearch, changeState,
// switchWorkspace, moveIssues, togglePin을 따른다.

const (
	pinnedPageSize = 100
	// deleteDelay는 휴지통으로 옮기기 전 취소할 수 있는 시간이다(DELETE_DELAY_MS).
	deleteDelay = 2 * time.Second
)

type listLoadedMsg struct {
	gen        int
	page       int
	result     github.IssuePage
	pinned     []github.Issue
	searchAll  []github.Issue
	err        error
	background bool
}

type labelsLoadedMsg struct {
	workspaceID string
	labels      []github.Label
	err         error
}

type userLoadedMsg struct{ login string }

type issueMovedMsg struct {
	issue     github.Issue
	nextState string
	err       error
	gen       int
	entryID   int
}

type pinToggledMsg struct {
	issue  github.Issue
	pinned bool
	err    error
	label  *github.Label
}

// client는 지금 워크스페이스의 GitHub 클라이언트를 만든다. 토큰 조회는 키체인 등을 거치므로
// tea.Cmd 안에서만 부른다.
func clientFor(workspace config.Workspace) (*github.Client, error) {
	token, err := auth.For(workspace)
	if err != nil {
		return nil, err
	}
	return github.New(token.Value), nil
}

func requestContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

// listTerm은 본문 검색어다. #태그 검색어는 태그 필터로 처리하므로 빼낸다(snapshotListRequest).
func (m Model) listTerm() string {
	if m.activeLabel != "" && strings.EqualFold(strings.TrimSpace(m.appliedQuery), "#"+m.activeLabel) {
		return ""
	}
	return m.appliedQuery
}

// loadList는 첫 페이지와 고정 노트를 함께 받는다(loadIssues).
func (m Model) loadList(background bool) tea.Cmd {
	workspace, ok := m.activeWorkspace()
	if !ok {
		return nil
	}
	gen, state, label, term, pageSize := m.gen, m.state, m.activeLabel, strings.TrimSpace(m.listTerm()), m.prefs.NotesPerPage
	return func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return listLoadedMsg{gen: gen, err: err, background: background}
		}
		ctx, cancel := requestContext()
		defer cancel()
		type pinResult struct {
			page github.IssuePage
			err  error
		}
		// 고정 노트: 열린 노트는 라벨로 한 번 더 읽고(검색 API 아님), 휴지통은 검색 한도를 아끼려고
		// 따로 검색하지 않고 받은 목록에서 고른다.
		pinnedChan := make(chan pinResult, 1)
		go func() {
			if state == "closed" {
				pinnedChan <- pinResult{}
				return
			}
			page, err := client.ListIssuesPageWithoutCount(ctx, workspace.Repo, state, notes.PinLabelName, 1, time.Now(), pinnedPageSize)
			pinnedChan <- pinResult{page, err}
		}()
		var result github.IssuePage
		var searchAll []github.Issue
		if term != "" {
			result, err = client.SearchIssuesPage(ctx, workspace.Repo, state, term, label, time.Now())
			if err == nil {
				searchAll = result.Items
				result.HasMore = len(searchAll) > pageSize
				if len(result.Items) > pageSize {
					result.Items = result.Items[:pageSize]
				}
			}
		} else {
			result, err = client.ListIssuesPageWithoutCount(ctx, workspace.Repo, state, label, 1, time.Now(), pageSize)
		}
		pinned := <-pinnedChan
		if state == "closed" && err == nil {
			for _, issue := range result.Items {
				if notes.HasIssueLabel(issue.LabelNames(), notes.PinLabelName) {
					pinned.page.Items = append(pinned.page.Items, issue)
				}
			}
		}
		if err == nil {
			err = pinned.err
		}
		return listLoadedMsg{gen: gen, page: 1, result: result, pinned: uniqueIssues(pinned.page.Items), searchAll: searchAll, err: err, background: background}
	}
}

func uniqueIssues(issues []github.Issue) []github.Issue {
	seen := map[int64]bool{}
	var unique []github.Issue
	for _, issue := range issues {
		if !seen[issue.ID] {
			seen[issue.ID] = true
			unique = append(unique, issue)
		}
	}
	return unique
}

func (m Model) loadLabels() tea.Cmd {
	workspace, ok := m.activeWorkspace()
	if !ok {
		return nil
	}
	return func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return labelsLoadedMsg{workspaceID: workspace.ID, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		labels, err := client.ListLabels(ctx, workspace.Repo)
		return labelsLoadedMsg{workspaceID: workspace.ID, labels: labels, err: err}
	}
}

func (m Model) loadUser() tea.Cmd {
	workspace, ok := m.activeWorkspace()
	if !ok {
		return nil
	}
	return func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return nil
		}
		ctx, cancel := requestContext()
		defer cancel()
		login, _, err := client.VerifyConnection(ctx, workspace.Repo)
		if err != nil {
			return nil
		}
		return userLoadedMsg{login}
	}
}

func (m Model) applyList(msg listLoadedMsg) (Model, tea.Cmd) {
	if msg.gen != m.gen {
		return m, nil
	}
	m.loading = false
	if msg.err != nil {
		if !msg.background {
			m.listErr = describeError(msg.err)
		}
		return m, nil
	}
	m.listErr = ""
	m.pinned = msg.pinned
	pinnedIDs := map[int64]bool{}
	for _, issue := range m.pinned {
		pinnedIDs[issue.ID] = true
	}
	var issues []github.Issue
	for _, issue := range msg.result.Items {
		if !pinnedIDs[issue.ID] {
			issues = append(issues, issue)
		}
	}
	m.issues = issues
	m.page = 1
	m.hasMore = msg.result.HasMore
	m.searchAll = msg.searchAll
	m.reconcileSelection()
	if m.focusListOnLoad {
		m.focusListOnLoad = false
		if ordered := m.orderedIssues(); len(ordered) > 0 {
			m.kbFocus = ordered[0].ID
		}
	}
	if m.kbFocus != 0 && m.indexOfID(m.kbFocus) < 0 {
		m.kbFocus = 0
	}
	// 열린 노트가 목록에서 새 내용을 받았으면(편집 중이 아니면) 반영한다.
	if m.note != nil && !m.note.dirty && !m.note.saving && m.note.issue.ID != 0 {
		if issue, ok := m.issueByID(m.note.issue.ID); ok && issue.UpdatedAt.After(m.note.issue.UpdatedAt) && m.focus != focusBody && m.focus != focusTitle {
			m.note.load(issue)
		}
	}
	if restore := m.restore; restore != nil {
		m.restore = nil
		if restore.OpenNumber != 0 {
			for _, issue := range m.orderedIssues() {
				if issue.Number == restore.OpenNumber {
					next, cmd := m.openNote(issue, false)
					next.detailScroll = restore.DetailScroll
					if restore.Settings {
						next.settings = next.newSettingsState()
					}
					return next, cmd
				}
			}
		}
		if restore.Settings {
			m.settings = m.newSettingsState()
		}
	}
	m.clampListScroll()
	return m, nil
}

func (m Model) loadMore() (Model, tea.Cmd) {
	if m.loading || m.loadingMore || !m.hasMore {
		return m, nil
	}
	if term := strings.TrimSpace(m.listTerm()); term != "" {
		all := m.searchAll
		shown := len(m.issues) + len(m.pinned)
		next := min(len(all), shown+m.prefs.NotesPerPage)
		known := map[int64]bool{}
		for _, issue := range m.orderedIssues() {
			known[issue.ID] = true
		}
		for _, issue := range all[min(shown, len(all)):next] {
			if !known[issue.ID] {
				m.issues = append(m.issues, issue)
			}
		}
		m.page++
		m.hasMore = next < len(all)
		return m, nil
	}
	workspace, ok := m.activeWorkspace()
	if !ok {
		return m, nil
	}
	m.loadingMore = true
	gen, state, label, page, pageSize := m.gen, m.state, m.activeLabel, m.page+1, m.prefs.NotesPerPage
	return m, func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return moreLoadedMsg{gen: gen, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		result, err := client.ListIssuesPageWithoutCount(ctx, workspace.Repo, state, label, page, time.Now(), pageSize)
		return moreLoadedMsg{gen: gen, page: page, result: result, err: err}
	}
}

type moreLoadedMsg struct {
	gen    int
	page   int
	result github.IssuePage
	err    error
}

func (m Model) applyMore(msg moreLoadedMsg) (Model, tea.Cmd) {
	if msg.gen != m.gen {
		return m, nil
	}
	m.loadingMore = false
	if msg.err != nil {
		m.listErr = describeError(msg.err)
		return m, nil
	}
	known := map[int64]bool{}
	for _, issue := range m.orderedIssues() {
		known[issue.ID] = true
	}
	for _, issue := range msg.result.Items {
		if !known[issue.ID] {
			m.issues = append(m.issues, issue)
		}
	}
	m.page = msg.page
	m.hasMore = msg.result.HasMore
	return m, nil
}

// reload는 목록을 처음부터 다시 받는다. 화면 상태(커서·열린 노트)는 둔다.
func (m Model) reload() (Model, tea.Cmd) {
	m.gen++
	m.loading = true
	cmds := []tea.Cmd{m.loadList(false), m.loadLabels()}
	if m.note != nil && m.note.number() != 0 && !m.note.dirty {
		cmds = append(cmds, m.refreshNote(m.note.number()))
	}
	return m, tea.Batch(cmds...)
}

// submitSearch는 검색어를 적용한다. "#태그"가 저장소 태그와 같으면 태그 필터로 바꾼다.
func (m Model) submitSearch() (Model, tea.Cmd) {
	query := strings.TrimSpace(m.search.Value())
	m.suggestion = -1
	if query == "" {
		m.search.SetValue("")
		m.appliedQuery = ""
		m.activeLabel = ""
		return m.restartList()
	}
	if strings.HasPrefix(query, "#") {
		tag := strings.TrimSpace(query[1:])
		for _, label := range m.visibleLabels() {
			if strings.EqualFold(label.Name, tag) {
				return m.openLabel(label.Name)
			}
		}
	}
	m.search.SetValue(query)
	m.appliedQuery = query
	m.activeLabel = ""
	return m.restartList()
}

// openLabel은 태그로 걸러 본다(openLabel). 검색칸에는 #태그가 남는다.
func (m Model) openLabel(name string) (Model, tea.Cmd) {
	m.activeLabel = name
	m.search.SetValue("#" + name)
	m.appliedQuery = "#" + name
	m.focus = focusNone
	m.search.Blur()
	return m.restartList()
}

func (m Model) restartList() (Model, tea.Cmd) {
	m.gen++
	m.loading = true
	m.issues = nil
	m.pinned = nil
	m.hasMore = false
	m.listScroll = 0
	m.clearSelection()
	return m, m.loadList(false)
}

// changeState는 노트/휴지통 탭을 바꾼다(changeState). 검색어와 열린 노트는 비운다.
func (m Model) changeState(state string) (Model, tea.Cmd) {
	if m.state == state || m.selectionMode() {
		return m, nil
	}
	m, flush := m.closeNote()
	m.state = state
	m.search.SetValue("")
	m.appliedQuery = ""
	m.activeLabel = ""
	m.kbFocus = 0
	m.entered = 0
	next, cmd := m.restartList()
	return next, tea.Batch(flush, cmd)
}

func (m Model) switchWorkspace(index int) (Model, tea.Cmd) {
	if index < 0 || index >= len(m.workspaces) || index == m.active {
		return m, nil
	}
	m, flush := m.closeNote()
	m.blurInputs()
	m.tool = ""
	m.active = index
	m.persist()
	m.state = "open"
	m.search.SetValue("")
	m.appliedQuery = ""
	m.activeLabel = ""
	m.labels = nil
	m.kbFocus = 0
	m.focusListOnLoad = true
	m.entered = 0
	m.listErr = ""
	m.lockPin = ""
	m.lockPinUntil = time.Time{}
	next, cmd := m.restartList()
	return next, tea.Batch(flush, cmd, next.loadLabels(), next.loadUser())
}

func (m Model) visibleLabels() []github.Label {
	var labels []github.Label
	for _, label := range m.labels {
		if !notes.IsPinLabel(label.Name) {
			labels = append(labels, label)
		}
	}
	return labels
}

// moveKeyboardFocus는 ↑/↓로 목록 커서를 옮긴다(moveNoteRowFocus). 처음이면 열린 노트나 첫 행에서 시작한다.
func (m *Model) moveKeyboardFocus(direction int) {
	issues := m.orderedIssues()
	if len(issues) == 0 {
		if direction < 0 && !m.selectionMode() {
			m.tool = "new"
		}
		return
	}
	// 첫 행에서 더 위로 가면 목록 위 도구(새 노트)로 올라간다.
	if direction < 0 && !m.selectionMode() && (m.indexOfID(m.kbFocus) == 0 || (m.kbFocus == 0 && m.note == nil)) {
		m.kbFocus = 0
		m.entered = 0
		m.tool = "new"
		m.listScroll = 0
		return
	}
	index := m.indexOfID(m.kbFocus)
	switch {
	case index >= 0:
		index += direction
	case m.note != nil && m.indexOfID(m.note.issue.ID) >= 0:
		index = m.indexOfID(m.note.issue.ID) + direction
	default:
		index = 0
	}
	if index < 0 || index >= len(issues) {
		return
	}
	m.kbFocus = issues[index].ID
	m.entered = 0
	m.scrollListTo(m.kbFocus)
}

// scrollListTo는 행이 보이도록 목록을 최소한만 움직인다(scrollIntoView block: nearest).
func (m *Model) scrollListTo(id int64) {
	rows := m.listRows(m.sidebarWidth())
	key := "row:" + strconv.FormatInt(id, 10)
	first, last := -1, -1
	for index, row := range rows {
		if row.id == key {
			if first < 0 {
				first = index
			}
			last = index + 1 // 구분선까지
		}
	}
	if first < 0 {
		return
	}
	height := m.listBodyHeight()
	if first < m.listScroll {
		m.listScroll = first
	} else if last >= m.listScroll+height {
		m.listScroll = last - height + 1
	}
}

func (m *Model) clampListScroll() {
	rows := len(m.listRows(m.sidebarWidth()))
	m.listScroll = max(0, min(m.listScroll, rows-m.listBodyHeight()))
}

// --- 다중 선택 (issue-selection.js) ---

func (m *Model) clearSelection() {
	m.selected = map[int64]bool{}
	m.anchor = 0
}

func (m *Model) orderedIDs() []int64 {
	issues := m.orderedIssues()
	ids := make([]int64, len(issues))
	for index, issue := range issues {
		ids[index] = issue.ID
	}
	return ids
}

func (m *Model) toggleSelection(id int64, rangeSelect bool) {
	m.kbFocus = id
	m.entered = 0
	next, _ := notes.ToggleSelection(m.currentSelection(), m.orderedIDs(), id, rangeSelect)
	m.setSelection(next)
}

func (m *Model) extendSelection(direction int) {
	ids := m.orderedIDs()
	current := m.indexOfID(m.kbFocus)
	target := current + direction
	if current < 0 || target < 0 || target >= len(ids) {
		return
	}
	if m.anchor == 0 {
		m.anchor = ids[current]
	}
	anchorIndex := m.indexOfID(m.anchor)
	if anchorIndex < 0 {
		m.anchor = ids[current]
		return
	}
	m.selected = idSetToMap(notes.RangeSelection(ids, anchorIndex, target))
	m.kbFocus = ids[target]
	m.entered = 0
	m.scrollListTo(m.kbFocus)
}

// currentSelection은 m.selected를 notes.Selection으로 바꾼다(화면 순서로 넣는다).
func (m *Model) currentSelection() notes.Selection {
	var ids []int64
	for _, id := range m.orderedIDs() {
		if m.selected[id] {
			ids = append(ids, id)
		}
	}
	return notes.Selection{IDs: notes.NewIDSet(ids...), Anchor: m.anchor}
}

func (m *Model) setSelection(selection notes.Selection) {
	m.selected = idSetToMap(selection.IDs)
	m.anchor = selection.Anchor
}

func idSetToMap(set notes.IDSet) map[int64]bool {
	selected := map[int64]bool{}
	for _, id := range set.IDs() {
		selected[id] = true
	}
	return selected
}

func (m *Model) reconcileSelection() {
	if len(m.selected) == 0 {
		return
	}
	if next, changed := notes.ReconcileSelection(m.currentSelection(), m.orderedIDs()); changed {
		m.setSelection(next)
	}
}

// --- 휴지통 이동 (deletion-queue.js, moveIssues, moveIssue) ---

func newDeletionQueue() *notes.DeletionQueue[github.Issue] {
	return notes.NewDeletionQueue(deleteDelay, func(issue github.Issue) int64 { return issue.ID })
}

func (m Model) pendingDeletion(id int64) bool {
	_, found := m.deletions.FindEntryForIssue(id)
	return found
}

// moveIssues는 노트를 휴지통으로 옮기거나(2초 유예) 휴지통에서 바로 복원한다.
func (m Model) moveIssues(issues []github.Issue) (Model, tea.Cmd) {
	var targets []github.Issue
	for _, issue := range issues {
		if issue.ID != 0 && !m.pendingDeletion(issue.ID) {
			targets = append(targets, issue)
		}
	}
	m.clearSelection()
	if len(targets) == 0 {
		return m, nil
	}
	if m.state == "open" {
		var flush tea.Cmd
		if m.note != nil && m.note.dirty {
			for _, issue := range targets {
				if issue.ID == m.note.issue.ID {
					m, flush = m.saveNote(true)
				}
			}
		}
		m.deletions.Add(targets, "closed", time.Now())
		return m, flush
	}
	return m, m.moveIssuesNow(targets, "open", 0)
}

// cancelLatestDeletion은 Esc로 가장 최근 휴지통 이동을 취소한다(cancelMostRecent).
func (m *Model) cancelLatestDeletion() bool {
	return m.deletions.CancelMostRecent()
}

// moveIssuesNow는 이슈 상태를 바로 바꾼다. entryID는 삭제 유예 항목이며 끝나면 정리한다.
func (m Model) moveIssuesNow(issues []github.Issue, nextState string, entryID int) tea.Cmd {
	workspace, ok := m.activeWorkspace()
	if !ok {
		return nil
	}
	gen := m.gen
	var cmds []tea.Cmd
	for _, issue := range issues {
		issue := issue
		cmds = append(cmds, func() tea.Msg {
			client, err := clientFor(workspace)
			if err != nil {
				return issueMovedMsg{issue: issue, nextState: nextState, err: err, gen: gen, entryID: entryID}
			}
			ctx, cancel := requestContext()
			defer cancel()
			moved, err := client.SetIssueState(ctx, workspace.Repo, issue.Number, nextState)
			if err == nil {
				issue = moved
			}
			return issueMovedMsg{issue: issue, nextState: nextState, err: err, gen: gen, entryID: entryID}
		})
	}
	return tea.Batch(cmds...)
}

func (m Model) applyMoved(msg issueMovedMsg) (Model, tea.Cmd) {
	if msg.entryID != 0 {
		m.deletions.Settle(msg.entryID, msg.issue.ID)
	}
	if msg.err != nil {
		return m.showToast(describeError(msg.err))
	}
	m.issues = removeIssue(m.issues, msg.issue.ID)
	m.pinned = removeIssue(m.pinned, msg.issue.ID)
	if m.kbFocus == msg.issue.ID {
		m.kbFocus = 0
	}
	var cmd tea.Cmd
	if m.note != nil && m.note.issue.ID == msg.issue.ID {
		m.note = nil
		m.focus = focusNone
	}
	if msg.nextState == "open" {
		m, cmd = m.showToast("노트를 복원했습니다.")
	}
	m.clampListScroll()
	return m, cmd
}

func removeIssue(issues []github.Issue, id int64) []github.Issue {
	var kept []github.Issue
	for _, issue := range issues {
		if issue.ID != id {
			kept = append(kept, issue)
		}
	}
	return kept
}

// replaceIssue는 목록과 고정 목록의 같은 노트를 새 내용으로 바꾼다.
func (m *Model) replaceIssue(updated github.Issue) {
	for index := range m.issues {
		if m.issues[index].ID == updated.ID {
			m.issues[index] = updated
		}
	}
	for index := range m.pinned {
		if m.pinned[index].ID == updated.ID {
			m.pinned[index] = updated
		}
	}
}

// --- 상단고정 (togglePin) ---

func (m Model) togglePin(issue github.Issue) (Model, tea.Cmd) {
	workspace, ok := m.activeWorkspace()
	if !ok || issue.Number == 0 || m.pinBusy {
		return m, nil
	}
	pinned := !m.isPinned(issue)
	m.pinBusy = true
	hasLabel := false
	for _, label := range m.labels {
		hasLabel = hasLabel || notes.IsPinLabel(label.Name)
	}
	return m, func() tea.Msg {
		client, err := clientFor(workspace)
		if err != nil {
			return pinToggledMsg{issue: issue, err: err}
		}
		ctx, cancel := requestContext()
		defer cancel()
		var created *github.Label
		if pinned && !hasLabel {
			label, err := client.CreateLabel(ctx, workspace.Repo, notes.PinLabelName, "")
			if err != nil && github.StatusOf(err) != 422 {
				return pinToggledMsg{issue: issue, err: err}
			}
			created = &label
		}
		var names []string
		for _, name := range issue.LabelNames() {
			if !notes.IsPinLabel(name) {
				names = append(names, name)
			}
		}
		if pinned {
			names = append(names, notes.PinLabelName)
		}
		saved, err := client.SetIssueLabels(ctx, workspace.Repo, issue.Number, names)
		if err != nil {
			return pinToggledMsg{issue: issue, err: err}
		}
		issue.Labels = saved.Labels
		return pinToggledMsg{issue: issue, pinned: pinned, label: created}
	}
}

func (m Model) applyPin(msg pinToggledMsg) (Model, tea.Cmd) {
	m.pinBusy = false
	if msg.err != nil {
		return m.showToast(describeError(msg.err))
	}
	if msg.label != nil && msg.label.Name != "" {
		m.labels = append(m.labels, *msg.label)
	}
	m.pinned = removeIssue(m.pinned, msg.issue.ID)
	m.issues = removeIssue(m.issues, msg.issue.ID)
	if msg.pinned {
		m.pinned = append([]github.Issue{msg.issue}, m.pinned...)
	} else {
		m.issues = append([]github.Issue{msg.issue}, m.issues...)
	}
	if m.note != nil && m.note.issue.ID == msg.issue.ID {
		m.note.issue.Labels = msg.issue.Labels
	}
	if msg.pinned {
		return m.showToast("상단에 고정했습니다.")
	}
	return m.showToast("고정을 해제했습니다.")
}
