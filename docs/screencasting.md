# 미리보기 GIF 만들기

README의 [미리보기 GIF](preview.gif)는 실시간 화면 녹화가 아닙니다. 더미
저장소를 연결한 앱을 대본대로 조작하면서 **화면이 바뀔 때마다 한 장씩** 캡처하고,
프레임마다 재생 시간을 직접 지정해 GIF로 합칩니다.

일정 간격으로 스크린샷을 찍는 방식은 캡처 한 장에 100ms 안팎이 걸리는 동안
앱이 계속 움직이기 때문에 동작이 툭툭 끊깁니다. 대신 동작 하나가 끝날 때마다
찍고 그 프레임을 몇 밀리초 보여줄지 따로 적어 두면, 캡처가 느려도 결과물의
속도는 대본에 적은 그대로 나옵니다.

## 준비물

- Node.js와 `npm install`로 설치되는 `playwright`
- Chromium: 처음 한 번 `npx playwright install chromium`
- `ffmpeg`: GIF 인코딩에 사용합니다(macOS는 `brew install ffmpeg`)

GitHub API 요청은 전부 가로채 더미 데이터로 응답하므로 실제 저장소나 PAT는
필요 없습니다.

## 빠른 시작

```bash
npm run preview:gif
```

미리 띄워 둔 미리보기 서버가 없으면 스크립트가 `vite preview`를 직접 실행하고
(`dist`가 없으면 빌드까지) 작업이 끝나면 정리합니다. 결과물은
`docs/preview.gif`에 덮어씁니다.

이미 서버를 띄워 둔 경우에는 주소만 알려주면 됩니다.

```bash
npm run preview -- --host 127.0.0.1 --port 4173

# 다른 터미널에서
npm run preview:gif -- --url=http://127.0.0.1:4173
```

## 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `--url`, `--port` | `http://127.0.0.1:4173` | 이미 띄워 둔 미리보기 서버 주소 |
| `--width`, `--height` | `1280`×`800` | 브라우저 캡처 해상도 |
| `--gif-width` | `960` | 출력 GIF 가로 크기(세로는 비율 유지) |
| `--lang` | `en` | 앱 표시 언어(`en`, `ko`, `zh-CN`, `ja`, `de`, `fr`, `it`) |
| `--output` | `docs/preview.gif` | 출력 GIF 경로 |
| `--frames-dir` | `docs/preview/frames` | 프레임 PNG 저장 경로 |
| `--keep-frames` | 끄기 | GIF 생성 후에도 PNG 프레임 보존 |
| `--no-encode` | 끄기 | ffmpeg 없이 프레임만 저장 |
| `--headful` | 끄기 | 브라우저 창을 띄운 채로 캡처 |

환경 변수(`PREVIEW_URL`, `PREVIEW_GIF_WIDTH`, `PREVIEW_LANG` 등)로도 같은 값을
줄 수 있습니다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `scripts/capture-preview-gif.mjs` | 진입점. 옵션 처리, 미리보기 서버 준비, 브라우저 실행, ffmpeg 인코딩 |
| `scripts/preview/fixture.mjs` | 더미 노트·라벨과 `api.github.com` 모의 응답 |
| `scripts/preview/recorder.mjs` | 프레임 레코더와 화면에 그리는 가짜 마우스 커서 |
| `scripts/preview/scenario.mjs` | 장면 대본 |

동작 순서는 이렇습니다.

1. `localStorage`에 더미 저장소와 PAT를 심어 두고 앱을 연다. 설정 화면을 건너뛰고
   노트 목록부터 시작한다.
2. `context.route()`로 GitHub API를 가로채 더미 저장소로 응답한다. 생성·수정·라벨
   추가가 메모리에 남으므로 새 노트를 쓰면 목록과 검색 결과에도 반영된다.
3. 대본을 실행하며 프레임을 쌓고, 프레임별 재생 시간을 `frames.json`과 ffmpeg
   concat 목록으로 적는다.
4. `palettegen`/`paletteuse`로 두 번 돌려 GIF를 만든다.

## 대본 쓰기

`scripts/preview/scenario.mjs`의 `runScenario(page, recorder)`가 전부입니다.
`recorder`가 제공하는 도구는 다음과 같습니다.

| 메서드 | 설명 |
| --- | --- |
| `capture(ms)` | 지금 화면을 한 장 찍고 `ms`만큼 보여준다 |
| `hold(ms)` | 새 프레임 없이 마지막 프레임의 재생 시간만 늘린다 |
| `track(ms, { fps })` | 앱이 스스로 바뀌는 구간을 짧게 연속 캡처한다 |
| `moveTo(선택자)` | 가짜 커서를 대상까지 보간해 옮기며 매 단계 캡처한다 |
| `click(선택자, { settleMs })` | 이동 → 클릭 효과 → 실제 클릭 → 반응 캡처 |
| `type(선택자, 문자열, { charMs })` | 필요하면 커서를 옮긴 뒤 한 글자씩 입력하며 캡처한다 |
| `waitFor(선택자)` | 요소가 보일 때까지 기다린다(프레임을 쌓지 않는다) |
| `placeCursor(x, y)` | 커서를 이동 없이 특정 좌표에 둔다 |

같은 화면이 이어지는 구간은 `capture()`를 반복하지 말고 `hold()`로 늘리세요.
GIF 용량은 프레임 수에 따라 늘어납니다.

기다림이 필요할 때는 두 가지를 구분합니다. 보여줄 값이 있는 변화(저장 중 표시
같은)는 `track()`으로 담고, 화면이 사실상 그대로인 대기는 Playwright의
`waitFor`로 프레임 없이 넘깁니다.

## 더미 데이터 바꾸기

`scripts/preview/fixture.mjs`의 `SEED_ISSUES`가 노트 목록입니다. 목록 미리보기는
본문 첫 줄을 제목으로 쓰므로 첫 줄을 또렷하게 적습니다. `state: 'closed'`와
`closedAt`을 주면 휴지통에 들어갑니다. 태그 색은 앱과 같은 `tagColorForName()`으로
계산하므로 따로 지정하지 않습니다.

모의 서버는 목록·검색·이슈 생성/수정·라벨 생성까지 처리합니다. 첨부파일
관련 요청은 빈 목록이나 404로 답합니다.

## 알아 둘 점

- **저장이 끝난 뒤에 다음 동작을 시킵니다.** 새 노트는 저장이 끝나는 순간 라우트가
  `new`에서 `note.<번호>`로 바뀌고 에디터 컴포넌트가 새로 만들어집니다. 저장 중에
  태그 드롭다운을 열면 그 사이에 닫혀 버립니다. 대본의 `waitForSaved()`가 이
  시점을 잡아 줍니다.
- **Escape로 드롭다운을 닫지 마세요.** 태그 목록뿐 아니라 노트까지 닫힙니다. 본문을
  다시 클릭해서 닫습니다.
- **선택자 위치는 그 순간의 레이아웃입니다.** 저장 상태 표시가 나타나고 사라지면서
  툴바 버튼 위치가 움직입니다. 화면이 바뀌는 중이라면 먼저 `waitFor`로 안정된
  상태를 기다린 뒤 클릭하세요.
- **노트가 목록 필터에서 빠지면 저장이 멈춘 채 "Saving..."이 남습니다.** 앱 쪽
  엣지 케이스입니다. 대본에서는 태그를 붙인 뒤 저장이 끝나는 것을 확인하고 검색으로
  넘어가 피했습니다.
- **프레임별 딜레이는 concat 디먹서로 넘깁니다.** `-fps_mode vfr`을 지우거나 `fps=`
  필터를 넣으면 고정 프레임레이트로 리샘플되어 길이와 용량이 함께 늘어납니다.
  GIF 딜레이 단위가 1/100초라 프레임 시간은 10ms 단위로 반올림됩니다.

## 문제가 생기면

프레임만 남겨 두고 어디서 어긋났는지 눈으로 확인하는 게 가장 빠릅니다.

```bash
npm run preview:gif -- --no-encode --keep-frames
open docs/preview/frames/frame-00001.png
```

`--headful`을 붙이면 브라우저 창에서 대본이 도는 모습을 그대로 볼 수 있습니다.
`docs/preview/frames/frames.json`에는 프레임마다 재생 시간이 들어 있어, 어느
구간이 길고 짧은지 확인할 때 쓸 수 있습니다.

## 현재 결과물

960×600, 374프레임, 약 30초, 약 490KB입니다. 장면 순서는 노트 목록 → 노트 열기 →
새 노트 작성과 자동 저장 → 태그 추가 → 검색 → 태그로 걸러 보기 → 휴지통 →
목록 복귀입니다.
