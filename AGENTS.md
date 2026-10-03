# Ginote 저장소 지침

- 이 저장소 루트에 `AGENTS.local.md`가 있으면 작업 전에 먼저 읽는다. 특정 개발 기기에만 해당하는
  내용(로컬 빌드 도구 경로, 서명 키 위치, 설치·확인 절차 등)을 담으며 커밋하지 않는다(`.gitignore`).
  그 기기에서만 의미 있는 내용은 이 파일이 아니라 거기에 적는다.
- 문서는 `docs/`에 있다. 시작점은 `docs/DEVELOPMENT.md`이고, 앱 프론트엔드 자동 교체는
  `docs/APP_OTA.md`, 모바일은 `docs/MOBILE.md`, 데스크톱 릴리스는 `docs/DESKTOP.md`, 설치형 앱의
  설정 파일·자격 증명은 `docs/CONFIG.md`를 본다. 설정 항목을 추가·변경하면 `src/lib/app-config.js`의
  스키마도 함께 고친다.
- 배포 흐름: `main`에 push하면 CI가 테스트를 통과한 웹 빌드에 서명해 `note.gitools.net`에 올리고,
  설치된 앱도 그 빌드로 바뀐다. 같은 push에 네이티브(`src-tauri`, Windows 패키징, 릴리스 워크플로)
  변경이 있으면 데스크톱 앱도 바로 릴리스된다. `release` 브랜치는 쓰지 않는다.
- 네이티브 표면(command·플러그인·권한)을 늘리면 `src-tauri/src/ota.rs`의 `NATIVE_API`와
  `src/lib/native-api.js`의 `MIN_NATIVE_API`를 함께 올린다.
- 아이콘은 `src-tauri/icons/source/`의 SVG 두 장만 고치고 `npm run icons`로 모두 다시 만든다.
- 확인: `npm test`, `npm run check`, `(cd src-tauri && cargo test --lib)`.
