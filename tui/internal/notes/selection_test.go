package notes

import (
	"slices"
	"testing"
)

// issue-selection.test.js의 사례를 옮겼다. 웹의 로컬 초안('draft')은 0 이하의 ID로 둔다.
var selectionIDs = []int64{-1, 1, 2, 3, 4}

func TestToggleSelectionFlipsAndMovesAnchor(t *testing.T) {
	selected, on := ToggleSelection(Selection{}, selectionIDs, 2, false)
	if !slices.Equal(selected.IDs.Sorted(), []int64{2}) || selected.Anchor != 2 || !on {
		t.Fatalf("select = %+v %v", selected.IDs.Sorted(), on)
	}
	deselected, on := ToggleSelection(Selection{IDs: selected.IDs, Anchor: 2}, selectionIDs, 2, false)
	if deselected.IDs.Len() != 0 || deselected.Anchor != NoAnchor || on {
		t.Fatalf("deselect = %+v %v", deselected, on)
	}
	// 받은 집합은 바꾸지 않는다.
	if !selected.IDs.Has(2) {
		t.Fatal("input selection was mutated")
	}
}

func TestToggleSelectionRangeSkipsLocalDrafts(t *testing.T) {
	next, _ := ToggleSelection(Selection{IDs: NewIDSet(1), Anchor: 1}, selectionIDs, 3, true)
	if !slices.Equal(next.IDs.Sorted(), []int64{1, 2, 3}) || next.Anchor != 1 {
		t.Fatalf("range = %v anchor %d", next.IDs.Sorted(), next.Anchor)
	}
}

func TestToggleSelectionRangeWithMissingAnchorAddsTarget(t *testing.T) {
	next, _ := ToggleSelection(Selection{IDs: NewIDSet(9), Anchor: 9}, selectionIDs, 4, true)
	if !slices.Equal(next.IDs.Sorted(), []int64{4, 9}) {
		t.Fatalf("range = %v", next.IDs.Sorted())
	}
}

func TestToggleSelectionRangeWithoutAnchorActsAsSingle(t *testing.T) {
	next, _ := ToggleSelection(Selection{}, selectionIDs, 1, true)
	if !slices.Equal(next.IDs.Sorted(), []int64{1}) || next.Anchor != NoAnchor {
		t.Fatalf("range = %v anchor %d", next.IDs.Sorted(), next.Anchor)
	}
}

func TestRangeSelectionIgnoresDirection(t *testing.T) {
	if got := RangeSelection(selectionIDs, 4, 1).Sorted(); !slices.Equal(got, []int64{1, 2, 3, 4}) {
		t.Errorf("RangeSelection(4, 1) = %v", got)
	}
	if got := RangeSelection(selectionIDs, 0, 2).Sorted(); !slices.Equal(got, []int64{1, 2}) {
		t.Errorf("RangeSelection(0, 2) = %v", got)
	}
}

func TestReconcileSelection(t *testing.T) {
	if _, changed := ReconcileSelection(Selection{}, selectionIDs); changed {
		t.Error("empty selection changed")
	}
	if _, changed := ReconcileSelection(Selection{IDs: NewIDSet(1, 2), Anchor: 1}, selectionIDs); changed {
		t.Error("intact selection changed")
	}
	next, changed := ReconcileSelection(Selection{IDs: NewIDSet(7, 2, 3), Anchor: 7}, selectionIDs)
	if !changed || !slices.Equal(next.IDs.IDs(), []int64{2, 3}) || next.Anchor != 2 {
		t.Errorf("reconcile = %v anchor %d", next.IDs.IDs(), next.Anchor)
	}
	next, changed = ReconcileSelection(Selection{IDs: NewIDSet(7), Anchor: 7}, selectionIDs)
	if !changed || next.IDs.Len() != 0 || next.Anchor != NoAnchor {
		t.Errorf("reconcile all gone = %+v", next)
	}
}

func TestIDSetKeepsInsertionOrder(t *testing.T) {
	set := NewIDSet(3, 1, 3, 2)
	set.remove(1)
	set.add(1)
	if !slices.Equal(set.IDs(), []int64{3, 2, 1}) {
		t.Errorf("IDs = %v", set.IDs())
	}
}
