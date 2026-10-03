// 설치형 앱의 설정 메모리 사본이다(docs/CONFIG.md). settings-backend.js가 시작할 때 config.toml과
// 자격 증명 저장소에서 읽어 채우고, 아래 update가 바꾸면 파일에 다시 쓴다. 웹에서는 비어 있어서
// 각 저장 함수가 지금처럼 localStorage를 쓴다. 다른 설정 모듈이 서로를 불러오지 않도록 이 파일은
// 아무것도 import하지 않는다.
let snapshot = null;
let onUpdate = null;

export function installedSnapshot() {
  return snapshot;
}

export function useInstalledSnapshot(next, persist) {
  snapshot = next;
  onUpdate = persist;
}

// 설치형 앱이면 사본을 고치고 저장을 예약한 뒤 true를 돌려준다. 웹이면 false.
export function updateInstalledSnapshot(mutate) {
  if (!snapshot) return false;
  mutate(snapshot);
  onUpdate?.();
  return true;
}
