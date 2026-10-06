<script>
  export let onStart = () => {};
</script>

<svelte:head>
  <title>Ginote — 내 GitHub 저장소에 남는 노트</title>
</svelte:head>

<main class="landing">
  <header class="landing-nav">
    <a class="landing-brand" href="./"><img src="./icon.svg" alt="" /> Ginote</a>
    <a href="https://github.com/zidell/ginote" target="_blank" rel="noreferrer">GitHub <i class="bi bi-arrow-up-right" aria-hidden="true"></i></a>
  </header>

  <div class="landing-content">
    <section class="landing-hero" aria-labelledby="landing-title">
      <p class="landing-eyebrow">GITHUB ISSUES, AS NOTES</p>
      <h1 id="landing-title">내 노트는<br /><em>내 GitHub 저장소에.</em></h1>
      <p class="landing-lead">Ginote는 GitHub Issues를 빠르고 편한 개인 노트로 바꿉니다. 별도 계정이나 노트 서버 없이, 내가 고른 저장소에 바로 기록합니다.</p>
      <div class="landing-preview">
        <img src="./landing-preview.gif" alt="Ginote에서 노트를 열고 편집하는 화면" />
      </div>
      <div class="landing-actions">
        <button type="button" class="landing-primary" on:click={onStart}>바로 시작 <i class="bi bi-arrow-right" aria-hidden="true"></i></button>
        <a class="landing-secondary" href="#downloads">다운로드 <i class="bi bi-arrow-down" aria-hidden="true"></i></a>
      </div>
      <p class="landing-caption">GitHub 계정, 개인 저장소, 접근 토큰이 필요합니다. 시작 단계에서 차례로 안내합니다.</p>
    </section>

    <section class="landing-details" aria-label="Ginote 특징">
      <div><strong>내가 소유한 데이터</strong><p>노트는 평범한 GitHub 이슈입니다. github.com에서도 그대로 읽고 수정할 수 있습니다.</p></div>
      <div><strong>서버 없는 연결</strong><p>브라우저가 GitHub API에 직접 연결합니다. Ginote 서버에 노트나 토큰을 보내지 않습니다.</p></div>
      <div><strong>웹과 앱, 터미널</strong><p>브라우저와 설치형 앱, TUI에서 같은 저장소를 사용할 수 있습니다.</p></div>
    </section>

    <section id="downloads" class="landing-downloads" aria-labelledby="downloads-title">
      <p class="landing-eyebrow">INSTALL GINOTE</p>
      <h2 id="downloads-title">원하는 곳에서 쓰세요</h2>
      <div class="landing-download-grid">
        <article><h3><i class="bi bi-apple" aria-hidden="true"></i> macOS</h3><p>GitHub Releases에서 Universal DMG를 받아 열고 Ginote를 Applications 폴더로 옮기세요.</p><a href="https://github.com/zidell/ginote/releases/latest">macOS 다운로드 ↗</a></article>
        <article><h3><i class="bi bi-windows" aria-hidden="true"></i> Windows</h3><p>GitHub Releases에서 <code>x64-setup.exe</code> 설치 파일을 받아 실행하세요. 경고 화면이 나오면 아래 순서대로 진행할 수 있습니다.</p><a href="https://github.com/zidell/ginote/releases/latest">Windows 다운로드 ↗</a> <a class="landing-card-secondary" href="#windows-install">설치 방법 ↓</a></article>
        <article><h3><i class="bi bi-laptop" aria-hidden="true"></i> Linux</h3><p>배포판에 맞는 deb 또는 rpm을 설치하거나, AppImage에 실행 권한을 주고 실행하세요.</p><a href="https://github.com/zidell/ginote/releases/latest">Linux 다운로드 ↗</a></article>
        <article><h3><i class="bi bi-terminal" aria-hidden="true"></i> TUI</h3><p>Go 1.27 이상이 필요합니다. 소스를 내려받은 뒤 <code>./tui/build-local.sh</code>를 실행하면 <code>~/.local/bin/ginote-tui</code>에 설치됩니다.</p><a href="https://github.com/zidell/ginote/blob/main/docs/TUI.md">TUI 설치 안내 ↗</a></article>
      </div>
      <div id="windows-install" class="landing-windows-guide">
        <div>
          <p class="landing-eyebrow">WINDOWS INSTALL GUIDE</p>
          <h3>Windows에서 설치하기</h3>
          <p>Microsoft Store 등록 없이 GitHub Releases에서 직접 설치합니다. 설치 파일에 Windows 코드 서명이 없어 처음 실행할 때 확인 화면이 나타날 수 있습니다.</p>
          <ol>
            <li><a href="https://github.com/zidell/ginote/releases/latest">최신 릴리스</a>의 <strong>Assets</strong>에서 이름이 <code>x64-setup.exe</code>로 끝나는 파일을 받으세요.</li>
            <li>다운로드한 설치 파일을 실행하세요. <strong>“Windows의 PC 보호”</strong> 화면이 나오면 <strong>“추가 정보”</strong>를 누르세요.</li>
            <li>파일 이름이 받은 Ginote 설치 파일과 같은지 확인하고 <strong>“실행”</strong>을 눌러 설치를 마치세요.</li>
          </ol>
          <p class="landing-guide-note">브라우저 자체가 다운로드를 막으면 다운로드 목록에서 파일의 메뉴를 열어 <strong>“유지”</strong>를 선택해야 할 수 있습니다. 출처가 <code>github.com/zidell/ginote</code>인지 먼저 확인하세요. Windows의 Smart App Control이 파일을 완전히 차단하면 “추가 정보” 버튼이 없을 수 있습니다.</p>
        </div>
        <div class="landing-warning-example" aria-label="Windows 보호 화면 예시">
          <span class="landing-example-label">화면 예시 · Windows 버전에 따라 다를 수 있습니다</span>
          <div class="landing-warning-panel" aria-hidden="true">
            <span class="landing-warning-icon">⊘</span>
            <strong>Windows의 PC 보호</strong>
            <p>Microsoft Defender SmartScreen에서 인식할 수 없는 앱의 시작을 차단했습니다.</p>
            <span class="landing-warning-link">① 추가 정보</span>
            <div class="landing-warning-publisher">앱: Ginote_x64-setup.exe<br />게시자: 알 수 없는 게시자</div>
            <span class="landing-warning-run">② 실행</span>
          </div>
        </div>
      </div>
      <p class="landing-pwa">브라우저에서도 설치할 수 있습니다. 이 페이지를 브라우저의 “앱 설치” 메뉴로 추가하면 다음부터 저장소 설정 화면으로 바로 열립니다.</p>
    </section>
  </div>
  <footer class="landing-footer">Ginote · <a href="https://github.com/zidell/ginote">소스 코드</a> · GPLv3</footer>
</main>
