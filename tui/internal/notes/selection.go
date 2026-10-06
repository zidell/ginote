package notes

import "sort"

// src/lib/issue-selection.js를 옮긴 것이다. 목록의 다중 선택 상태를 계산한다.
//
// 목록은 화면 순서대로 이슈 ID를 담은 []int64로 넘긴다. 0 이하의 ID는 로컬 초안(웹의
// issue.local)으로 보고 선택 대상에서 뺀다. GitHub 이슈 ID는 항상 양수다.

// NoAnchor는 선택 기준점이 없다는 뜻이다(웹의 anchorId === null).
const NoAnchor int64 = 0

func isLocalID(id int64) bool { return id <= 0 }

// IDSet은 넣은 순서를 기억하는 ID 집합이다(웹의 Set). 영값은 빈 집합이고, 이 파일의
// 함수는 받은 집합을 바꾸지 않고 새 집합을 낸다.
type IDSet struct {
	order []int64
	index map[int64]bool
}

func NewIDSet(ids ...int64) IDSet {
	var set IDSet
	for _, id := range ids {
		set.add(id)
	}
	return set
}

func (s IDSet) Has(id int64) bool { return s.index[id] }
func (s IDSet) Len() int          { return len(s.order) }

// IDs는 넣은 순서대로의 복사본이다.
func (s IDSet) IDs() []int64 { return append([]int64(nil), s.order...) }

// Sorted는 오름차순 복사본이다.
func (s IDSet) Sorted() []int64 {
	ids := s.IDs()
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func (s IDSet) clone() IDSet { return NewIDSet(s.order...) }

func (s *IDSet) add(id int64) {
	if s.index[id] {
		return
	}
	if s.index == nil {
		s.index = map[int64]bool{}
	}
	s.index[id] = true
	s.order = append(s.order, id)
}

func (s *IDSet) remove(id int64) {
	if !s.index[id] {
		return
	}
	delete(s.index, id)
	for i, item := range s.order {
		if item == id {
			s.order = append(s.order[:i:i], s.order[i+1:]...)
			break
		}
	}
}

// Selection은 선택된 ID와 범위 선택의 기준점이다.
type Selection struct {
	IDs    IDSet
	Anchor int64
}

func indexOfID(ids []int64, id int64) int {
	for i, item := range ids {
		if item == id {
			return i
		}
	}
	return -1
}

// ToggleSelection은 toggleSelection과 같다. ids는 화면의 목록, target은 누른 노트다.
// rangeMode면 기준점에서 target까지를 더한다. selected는 target이 선택된 상태인지다.
func ToggleSelection(current Selection, ids []int64, target int64, rangeMode bool) (next Selection, selected bool) {
	nextSelected := current.IDs.clone()
	if rangeMode && current.Anchor != NoAnchor {
		selectable := make([]int64, 0, len(ids))
		for _, id := range ids {
			if !isLocalID(id) {
				selectable = append(selectable, id)
			}
		}
		anchorIndex := indexOfID(selectable, current.Anchor)
		targetIndex := indexOfID(selectable, target)
		if anchorIndex >= 0 && targetIndex >= 0 {
			start, end := min(anchorIndex, targetIndex), max(anchorIndex, targetIndex)
			for _, id := range selectable[start : end+1] {
				nextSelected.add(id)
			}
		} else {
			nextSelected.add(target)
		}
	} else if nextSelected.Has(target) {
		nextSelected.remove(target)
	} else {
		nextSelected.add(target)
	}

	anchor := current.Anchor
	if nextSelected.Len() == 0 {
		anchor = NoAnchor
	} else if !rangeMode {
		anchor = target
	}
	return Selection{IDs: nextSelected, Anchor: anchor}, nextSelected.Has(target)
}

// RangeSelection은 rangeSelection과 같다. 화면 순서(고정 노트 → 일반 노트)의 ids에서 두 위치
// 사이(양 끝 포함)의 노트를 고른다. 범위를 벗어난 위치는 목록 끝으로 맞춘다.
func RangeSelection(ids []int64, anchorIndex, targetIndex int) IDSet {
	start, end := min(anchorIndex, targetIndex), max(anchorIndex, targetIndex)+1
	start = min(max(start, 0), len(ids))
	end = min(max(end, start), len(ids))
	var set IDSet
	for _, id := range ids[start:end] {
		if !isLocalID(id) {
			set.add(id)
		}
	}
	return set
}

// ReconcileSelection은 reconcileSelection과 같다. 목록 ids에서 사라진 노트를 선택에서 빼고,
// 기준점이 사라졌으면 남은 첫 노트로 옮긴다. 바뀐 것이 없으면 changed가 false다.
func ReconcileSelection(current Selection, ids []int64) (next Selection, changed bool) {
	if current.IDs.Len() == 0 {
		return current, false
	}
	available := map[int64]bool{}
	for _, id := range ids {
		if !isLocalID(id) {
			available[id] = true
		}
	}
	var nextSelected IDSet
	for _, id := range current.IDs.order {
		if available[id] {
			nextSelected.add(id)
		}
	}
	if nextSelected.Len() == current.IDs.Len() {
		return current, false
	}
	anchor := NoAnchor
	if nextSelected.Has(current.Anchor) {
		anchor = current.Anchor
	} else if nextSelected.Len() > 0 {
		anchor = nextSelected.order[0]
	}
	return Selection{IDs: nextSelected, Anchor: anchor}, true
}
