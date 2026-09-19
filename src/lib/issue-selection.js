// 목록의 다중 선택 상태를 계산한다. 로컬 초안은 선택 대상이 아니다.

export function toggleSelection({ selectedIds, anchorId, issues, issue, range = false }) {
  const nextSelected = new Set(selectedIds);
  if (range && anchorId !== null) {
    const selectableIssues = issues.filter((item) => !item.local);
    const anchorIndex = selectableIssues.findIndex((item) => item.id === anchorId);
    const issueIndex = selectableIssues.findIndex((item) => item.id === issue.id);
    if (anchorIndex >= 0 && issueIndex >= 0) {
      const [start, end] = [anchorIndex, issueIndex].sort((a, b) => a - b);
      for (const item of selectableIssues.slice(start, end + 1)) nextSelected.add(item.id);
    } else {
      nextSelected.add(issue.id);
    }
  } else if (nextSelected.has(issue.id)) {
    nextSelected.delete(issue.id);
  } else {
    nextSelected.add(issue.id);
  }

  let nextAnchorId = anchorId;
  if (nextSelected.size === 0) nextAnchorId = null;
  else if (!range) nextAnchorId = issue.id;
  return { selectedIds: nextSelected, anchorId: nextAnchorId, selected: nextSelected.has(issue.id) };
}

// 화면 순서(고정 노트 → 일반 노트)에서 기준점부터 대상까지를 고른다.
export function rangeSelection(orderedIssues, anchorIndex, targetIndex) {
  const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b);
  return new Set(
    orderedIssues
      .slice(start, end + 1)
      .filter((issue) => !issue.local)
      .map((issue) => issue.id)
  );
}

// 목록이 바뀐 뒤 사라진 노트를 선택에서 뺀다. 바뀐 것이 없으면 null이다.
export function reconcileSelection({ selectedIds, anchorId, issues }) {
  if (!selectedIds.size) return null;
  const availableIds = new Set(issues.filter((issue) => !issue.local).map((issue) => issue.id));
  const nextSelected = new Set([...selectedIds].filter((id) => availableIds.has(id)));
  if (nextSelected.size === selectedIds.size) return null;
  return {
    selectedIds: nextSelected,
    anchorId: nextSelected.has(anchorId) ? anchorId : (nextSelected.values().next().value ?? null)
  };
}
