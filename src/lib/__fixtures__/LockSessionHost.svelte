<script>
  // App처럼 편집기가 알린 잠금 세션 숫자를 같은 갱신 안에서 lockPin으로 내려준다.
  // 테스트의 rerender는 prop을 바꾸기 전에 대기 중인 반응형 코드를 먼저 실행해 버려서
  // 세션이 곧바로 만료된 것처럼 보이므로 이 부모를 거친다.
  import NoteEditor from '../NoteEditor.svelte';

  export let lockPin = '';
  export let editorProps = {};
  export let onSetLockSession = () => {};

  function setLockSession(pin) {
    lockPin = pin;
    onSetLockSession(pin);
  }
</script>

<NoteEditor {...editorProps} {lockPin} onSetLockSession={setLockSession} />
