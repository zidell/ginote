import Dropdown from 'bootstrap/js/dist/dropdown';

// Bootstrap은 토글에 만든 Dropdown 인스턴스를 전역 Map에 강하게 붙잡아 두고 dispose()에서만 놓는다.
// 토글이 화면에서 사라질 때 놓지 않으면 그 토글을 품은 노트 편집기 DOM과 상태 전체가 남는다.
export function disposeDropdownOnDestroy(node) {
  return {
    destroy() {
      Dropdown.getInstance(node)?.dispose();
    }
  };
}

// 닫기만 할 때는 인스턴스를 새로 만들지 않는다. 열린 적이 없으면 닫을 것도 없다.
export function hideDropdown(toggleButton) {
  if (toggleButton) Dropdown.getInstance(toggleButton)?.hide();
}
