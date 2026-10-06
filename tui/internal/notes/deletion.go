package notes

import "time"

// src/lib/deletion-queue.js를 옮긴 것이다. 휴지통 이동을 잠시 미뤄 두는 대기열로, 유예 시간
// 안에는 취소할 수 있다. 웹의 setTimeout 대신 시각을 받는 상태 기계로 두고, UI가 틱마다
// Expired(now)를 불러 처리할 항목을 받는다. 처리 중(InFlight)인 항목은 취소할 수 없다.

// DeletionEntry는 한 번에 휴지통으로 보낼 노트 묶음이다. ID는 1부터 늘어난다.
type DeletionEntry[T any] struct {
	ID        int
	Items     []T
	NextState string
	InFlight  bool
	Deadline  time.Time
}

// DeletionQueue는 웹의 createDeletionQueue다. issueID는 항목의 노트 ID를 꺼낸다.
type DeletionQueue[T any] struct {
	delay    time.Duration
	issueID  func(T) int64
	entries  []DeletionEntry[T]
	sequence int
}

func NewDeletionQueue[T any](delay time.Duration, issueID func(T) int64) *DeletionQueue[T] {
	return &DeletionQueue[T]{delay: delay, issueID: issueID}
}

// Entries는 넣은 순서대로의 항목 복사본이다.
func (q *DeletionQueue[T]) Entries() []DeletionEntry[T] {
	return append([]DeletionEntry[T](nil), q.entries...)
}

func (q *DeletionQueue[T]) Len() int { return len(q.entries) }

// QueuedIssueIDs는 queuedIssueIds와 같다: 대기열에 든 모든 노트 ID.
func (q *DeletionQueue[T]) QueuedIssueIDs() map[int64]bool {
	ids := map[int64]bool{}
	for _, entry := range q.entries {
		for _, item := range entry.Items {
			ids[q.issueID(item)] = true
		}
	}
	return ids
}

// FindEntryForIssue는 findEntryForIssue와 같다: 그 노트가 든 첫 항목.
func (q *DeletionQueue[T]) FindEntryForIssue(issueID int64) (DeletionEntry[T], bool) {
	for _, entry := range q.entries {
		for _, item := range entry.Items {
			if q.issueID(item) == issueID {
				return entry, true
			}
		}
	}
	return DeletionEntry[T]{}, false
}

func (q *DeletionQueue[T]) find(entryID int) int {
	for i, entry := range q.entries {
		if entry.ID == entryID {
			return i
		}
	}
	return -1
}

// Add는 enqueue와 같다. 이미 대기 중인 노트는 다시 넣지 않고, 넣은 노트가 없으면 false다.
// nextState는 웹 기본값처럼 보통 "closed"다. 항목은 now+delay에 만료된다.
func (q *DeletionQueue[T]) Add(items []T, nextState string, now time.Time) (DeletionEntry[T], bool) {
	queued := q.QueuedIssueIDs()
	var unique []T
	for _, item := range items {
		if !queued[q.issueID(item)] {
			unique = append(unique, item)
		}
	}
	if len(unique) == 0 {
		return DeletionEntry[T]{}, false
	}
	q.sequence++
	entry := DeletionEntry[T]{ID: q.sequence, Items: unique, NextState: nextState, Deadline: now.Add(q.delay)}
	q.entries = append(q.entries, entry)
	return entry, true
}

// Cancel은 처리 전인 항목을 뺀다. 없거나 처리 중이면 false다.
func (q *DeletionQueue[T]) Cancel(entryID int) bool {
	index := q.find(entryID)
	if index < 0 || q.entries[index].InFlight {
		return false
	}
	q.Remove(entryID)
	return true
}

// CancelMostRecent는 가장 최근에 넣은, 아직 처리 전인 항목을 취소한다.
func (q *DeletionQueue[T]) CancelMostRecent() bool {
	for i := len(q.entries) - 1; i >= 0; i-- {
		if !q.entries[i].InFlight {
			return q.Cancel(q.entries[i].ID)
		}
	}
	return false
}

// CancelAll은 처리 전인 항목을 모두 뺀다. force면 처리 중인 항목까지 뺀다(워크스페이스 전환·종료).
func (q *DeletionQueue[T]) CancelAll(force bool) {
	kept := q.entries[:0:0]
	if !force {
		for _, entry := range q.entries {
			if entry.InFlight {
				kept = append(kept, entry)
			}
		}
	}
	q.entries = kept
}

// Remove는 처리 중이어도 항목을 뺀다.
func (q *DeletionQueue[T]) Remove(entryID int) {
	index := q.find(entryID)
	if index < 0 {
		return
	}
	q.entries = append(q.entries[:index:index], q.entries[index+1:]...)
}

// Expired는 now에 유예 시간이 끝난 처리 전 항목을 처리 중으로 바꿔 넣은 순서대로 돌려준다.
// 웹에서 onExpire(entry)가 불리는 시점에 해당한다. 같은 항목은 한 번만 나온다.
func (q *DeletionQueue[T]) Expired(now time.Time) []DeletionEntry[T] {
	var expired []DeletionEntry[T]
	for i := range q.entries {
		entry := &q.entries[i]
		if entry.InFlight || now.Before(entry.Deadline) {
			continue
		}
		entry.InFlight = true
		expired = append(expired, *entry)
	}
	return expired
}

// NextDeadline은 처리 전 항목 중 가장 이른 만료 시각이다. UI가 다음 틱을 정할 때 쓴다.
func (q *DeletionQueue[T]) NextDeadline() (time.Time, bool) {
	var next time.Time
	found := false
	for _, entry := range q.entries {
		if !entry.InFlight && (!found || entry.Deadline.Before(next)) {
			next, found = entry.Deadline, true
		}
	}
	return next, found
}

// IsInFlight는 항목이 처리 중이고 그 노트를 담고 있는지다.
func (q *DeletionQueue[T]) IsInFlight(entryID int, issueID int64) bool {
	index := q.find(entryID)
	if index < 0 || !q.entries[index].InFlight {
		return false
	}
	for _, item := range q.entries[index].Items {
		if q.issueID(item) == issueID {
			return true
		}
	}
	return false
}

// Settle은 처리가 끝난 노트를 항목에서 빼고, 남은 노트가 없으면 항목을 지운다.
func (q *DeletionQueue[T]) Settle(entryID int, issueID int64) {
	index := q.find(entryID)
	if index < 0 {
		return
	}
	var remaining []T
	for _, item := range q.entries[index].Items {
		if q.issueID(item) != issueID {
			remaining = append(remaining, item)
		}
	}
	if len(remaining) == 0 {
		q.Remove(entryID)
		return
	}
	q.entries[index].Items = remaining
}
