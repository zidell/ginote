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
        <article><h3><i class="bi bi-windows" aria-hidden="true"></i> Windows</h3><p>GitHub Releases에서 Windows 설치 프로그램을 받아 실행하세요. Microsoft Store 등록은 필요하지 않습니다.</p><a href="https://github.com/zidell/ginote/releases/latest">Windows 다운로드 ↗</a></article>
        <article><h3><i class="bi bi-laptop" aria-hidden="true"></i> Linux</h3><p>배포판에 맞는 deb 또는 rpm을 설치하거나, AppImage에 실행 권한을 주고 실행하세요.</p><a href="https://github.com/zidell/ginote/releases/latest">Linux 다운로드 ↗</a></article>
        <article><h3><i class="bi bi-terminal" aria-hidden="true"></i> TUI</h3><p>Go 1.27 이상이 필요합니다. 소스를 내려받은 뒤 <code>./tui/build-local.sh</code>를 실행하면 <code>~/.local/bin/ginote-tui</code>에 설치됩니다.</p><a href="https://github.com/zidell/ginote/blob/main/docs/TUI.md">TUI 설치 안내 ↗</a></article>
      </div>
      <p class="landing-pwa">브라우저에서도 설치할 수 있습니다. 이 페이지를 브라우저의 “앱 설치” 메뉴로 추가하면 다음부터 저장소 설정 화면으로 바로 열립니다.</p>
    </section>
  </div>
  <footer class="landing-footer">Ginote · <a href="https://github.com/zidell/ginote">소스 코드</a> · GPLv3</footer>
</main>
