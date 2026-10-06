package notes

import (
	"maps"
	"slices"
	"testing"
	"time"
)

// deletion-queue.test.js의 사례를 옮겼다. 웹의 가짜 타이머 대신 Expired(now)에 시각을 넘긴다.
type queuedIssue struct{ id int64 }

var (
	issueA     = queuedIssue{1}
	issueB     = queuedIssue{2}
	issueC     = queuedIssue{3}
	queueStart = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
)

func newTestQueue() *DeletionQueue[queuedIssue] {
	return NewDeletionQueue(3*time.Second, func(issue queuedIssue) int64 { return issue.id })
}

func at(ms int) time.Time { return queueStart.Add(time.Duration(ms) * time.Millisecond) }

func TestDeletionQueueExpiresAfterDelay(t *testing.T) {
	queue := newTestQueue()
	entry, ok := queue.Add([]queuedIssue{issueA, issueB}, "closed", at(0))
	if !ok || entry.InFlight || entry.NextState != "closed" || len(entry.Items) != 2 {
		t.Fatalf("Add = %+v %v", entry, ok)
	}
	if expired := queue.Expired(at(2999)); len(expired) != 0 {
		t.Fatalf("expired early: %+v", expired)
	}
	expired := queue.Expired(at(3000))
	if len(expired) != 1 || expired[0].ID != entry.ID || !expired[0].InFlight {
		t.Fatalf("Expired = %+v", expired)
	}
	if !queue.Entries()[0].InFlight {
		t.Fatal("entry not in flight")
	}
	if again := queue.Expired(at(9000)); len(again) != 0 {
		t.Fatalf("expired twice: %+v", again)
	}
}

func TestDeletionQueueSkipsQueuedIssues(t *testing.T) {
	queue := newTestQueue()
	queue.Add([]queuedIssue{issueA}, "closed", at(0))
	if _, ok := queue.Add([]queuedIssue{issueA}, "closed", at(0)); ok {
		t.Fatal("re-added queued issue")
	}
	second, _ := queue.Add([]queuedIssue{issueA, issueB}, "closed", at(0))
	if !slices.Equal(second.Items, []queuedIssue{issueB}) {
		t.Fatalf("second = %+v", second.Items)
	}
	if got := queue.QueuedIssueIDs(); !maps.Equal(got, map[int64]bool{1: true, 2: true}) {
		t.Errorf("QueuedIssueIDs = %v", got)
	}
	if found, ok := queue.FindEntryForIssue(2); !ok || found.ID != second.ID {
		t.Errorf("FindEntryForIssue = %+v %v", found, ok)
	}
	if _, ok := queue.FindEntryForIssue(3); ok {
		t.Error("found missing issue")
	}
}

func TestDeletionQueueCancel(t *testing.T) {
	queue := newTestQueue()
	entry, _ := queue.Add([]queuedIssue{issueA}, "closed", at(0))
	if !queue.Cancel(entry.ID) {
		t.Fatal("Cancel = false")
	}
	if expired := queue.Expired(at(3000)); len(expired) != 0 || queue.Len() != 0 {
		t.Fatalf("after cancel: %+v len %d", expired, queue.Len())
	}
	if queue.Cancel(entry.ID) {
		t.Fatal("cancelled twice")
	}
}

func TestDeletionQueueCannotCancelInFlight(t *testing.T) {
	queue := newTestQueue()
	entry, _ := queue.Add([]queuedIssue{issueA}, "closed", at(0))
	queue.Expired(at(3000))
	if queue.Cancel(entry.ID) || queue.Len() != 1 {
		t.Fatal("cancelled in-flight entry")
	}
}

func TestDeletionQueueCancelMostRecentSkipsInFlight(t *testing.T) {
	queue := newTestQueue()
	first, _ := queue.Add([]queuedIssue{issueA}, "closed", at(0))
	queue.Add([]queuedIssue{issueB}, "closed", at(1000))
	queue.Expired(at(3000)) // first는 이제 처리 중이다.
	if !queue.CancelMostRecent() {
		t.Fatal("CancelMostRecent = false")
	}
	if entries := queue.Entries(); len(entries) != 1 || entries[0].ID != first.ID {
		t.Fatalf("entries = %+v", entries)
	}
	if queue.CancelMostRecent() {
		t.Fatal("cancelled in-flight entry")
	}
}

func TestDeletionQueueCancelAll(t *testing.T) {
	queue := newTestQueue()
	queue.Add([]queuedIssue{issueA}, "closed", at(0))
	queue.Expired(at(3000))
	queue.Add([]queuedIssue{issueB}, "closed", at(3000))
	queue.CancelAll(false)
	if entries := queue.Entries(); len(entries) != 1 || !slices.Equal(entries[0].Items, []queuedIssue{issueA}) {
		t.Fatalf("entries = %+v", entries)
	}
	queue.Add([]queuedIssue{issueC}, "closed", at(3000))
	queue.CancelAll(true)
	if queue.Len() != 0 || len(queue.Expired(at(6000))) != 0 {
		t.Fatal("force cancel left entries")
	}
}

func TestDeletionQueueSettle(t *testing.T) {
	queue := newTestQueue()
	entry, _ := queue.Add([]queuedIssue{issueA, issueB}, "closed", at(0))
	queue.Expired(at(3000))
	if !queue.IsInFlight(entry.ID, issueA.id) || queue.IsInFlight(entry.ID, issueC.id) {
		t.Fatal("IsInFlight")
	}
	queue.Settle(entry.ID, issueA.id)
	if items := queue.Entries()[0].Items; !slices.Equal(items, []queuedIssue{issueB}) {
		t.Fatalf("items = %+v", items)
	}
	queue.Settle(entry.ID, issueB.id)
	if queue.Len() != 0 {
		t.Fatal("entry not removed")
	}
	queue.Settle(entry.ID, issueB.id)
}

func TestDeletionQueueRemoveDropsInFlight(t *testing.T) {
	queue := newTestQueue()
	entry, _ := queue.Add([]queuedIssue{issueA}, "closed", at(0))
	queue.Expired(at(3000))
	queue.Remove(entry.ID)
	if queue.Len() != 0 {
		t.Fatal("Remove kept entry")
	}
}

func TestDeletionQueueNextDeadline(t *testing.T) {
	queue := newTestQueue()
	if _, ok := queue.NextDeadline(); ok {
		t.Fatal("empty queue has deadline")
	}
	queue.Add([]queuedIssue{issueA}, "closed", at(0))
	queue.Add([]queuedIssue{issueB}, "closed", at(1000))
	if next, _ := queue.NextDeadline(); !next.Equal(at(3000)) {
		t.Errorf("NextDeadline = %v", next)
	}
	queue.Expired(at(3000))
	if next, _ := queue.NextDeadline(); !next.Equal(at(4000)) {
		t.Errorf("NextDeadline after expire = %v", next)
	}
}
