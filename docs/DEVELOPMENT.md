# 개발·운영 안내

이 문서는 Ginote 웹 앱을 개발·검증·배포하는 기본 절차를 모읍니다. 첨부파일,
암호화, 데스크톱 앱처럼 별도 데이터 형식이나 배포 흐름을 가지는 기능은 이 문서에
중복해서 적지 않고 해당 문서를 기준으로 합니다.

## 개발 환경

CI는 Node.js 22와 `npm ci`를 사용합니다. 의존성을 변경할 때는 `package.json`과
`package-lock.json`을 함께 커밋하세요.

```bash
npm ci              # 잠금 파일 기준 설치
npm run dev         # 개발 서버
npm run check       # Svelte 정적 검사
npm test            # Vitest 전체 테스트
npm run test:watch  # 변경 감지 테스트
npm run build       # 프로덕션 빌드
npm run preview     # 빌드 결과 확인
```

변경을 마치기 전에는 최소한 다음 명령을 모두 통과시켜야 합니다.

```bash
npm run check
npm test
npm run build
```

`main` 브랜치 푸시와 pull request에서도 같은 검사를 GitHub Actions가 수행합니다.

## 웹 배포

프로덕션 빌드는 `dist/`에 생성하며 GitHub Pages 등 정적 호스팅에 배포합니다. PAT,
개인 저장소 이름, 개인 배포 설정, 실제 노트 데이터는 커밋하지 마세요. 노트 잠금의
배포 설정은 [노트 잠금과 암호화 방식](ENCRYPTION.md)을 따릅니다.

## 데이터와 기능별 운영 문서

- [첨부파일 저장 방식](ATTACHMENTS.md): 저장 규약, 권한, 보관과 호환성
- [노트 잠금과 암호화 방식](ENCRYPTION.md): 보호 경계와 배포 설정
- [데스크톱 앱 문서](DESKTOP.md): 로컬 실행, 패키징, 릴리스
- [코드 서명 정책](CODE_SIGNING.md): Windows 서명과 개인정보 처리 범위

## 미리보기 갱신

README의 미리보기 GIF를 변경할 때는 [미리보기 GIF 만들기](screencasting.md)의
준비물과 생성 절차를 따릅니다.
