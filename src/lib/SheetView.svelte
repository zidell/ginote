<script>
  // 설정·도움말처럼 목록 위에 여는 화면의 공통 틀이다. 노트 화면처럼 위쪽에 헤더 바가 있고
  // 왼쪽 위 버튼으로 닫는다. 휴대폰 폭에서는 화면을 꽉 채운 채 오른쪽에서 밀려 들어오고(버튼은
  // 뒤로 가기), 태블릿 이상에서는 가운데 모달로 뜬다(버튼은 닫기). 폭 기준은 app.css와 같다.
  export let title = '';
  export let closeLabel = '';
  export let onClose = () => {};
  export let layer = 0;

  const PHONE_QUERY = '(max-width: 767.98px)';
  const LEAVE_MS = 200;
  const titleId = `sheet-title-${Math.random().toString(36).slice(2, 8)}`;
  let leaving = false;

  function matches(query) {
    return globalThis.matchMedia?.(query)?.matches === true;
  }

  // 휴대폰에서는 오른쪽으로 밀려 나간 뒤 닫는다. 그 밖의 폭이나 동작 줄이기 설정에서는 바로 닫는다.
  function close() {
    if (leaving) return;
    if (!matches(PHONE_QUERY) || matches('(prefers-reduced-motion: reduce)')) {
      onClose();
      return;
    }
    leaving = true;
    setTimeout(onClose, LEAVE_MS);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="sheet-overlay"
  class:is-leaving={leaving}
  style:--sheet-layer={layer}
  on:click={(event) => { if (event.target === event.currentTarget) close(); }}
>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header class="sheet-header">
      <button
        type="button"
        class="btn btn-outline-secondary sheet-close"
        aria-label={closeLabel}
        title={closeLabel}
        on:click={close}
      >
        <i class="bi bi-arrow-left sheet-close-back" aria-hidden="true"></i>
        <i class="bi bi-x-lg sheet-close-dismiss" aria-hidden="true"></i>
      </button>
      <h2 class="sheet-title" id={titleId}>{title}</h2>
    </header>
    <div class="sheet-body">
      <slot />
    </div>
  </div>
</div>
