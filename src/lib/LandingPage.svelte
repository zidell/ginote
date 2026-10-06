<script>
  import { onMount, tick } from 'svelte';

  export let onStart = () => {};

  const homebrewInstallCommand = 'brew tap zidell/ginote https://github.com/zidell/ginote\nbrew install --cask ginote';
  const tuiInstallCommand = 'curl -fsSL https://raw.githubusercontent.com/zidell/ginote/main/tui/install.sh | bash';
  let selectedDownload = '';
  let copyMessage = '';

  async function showDownload(platform) {
    selectedDownload = selectedDownload === platform ? '' : platform;
    copyMessage = '';
    if (!selectedDownload) return;
    await tick();
    document.getElementById('download-details')?.scrollIntoView?.({ block: 'start' });
  }

  async function copyCommand(command) {
    try {
      await navigator.clipboard.writeText(command);
      copyMessage = '명령을 복사했습니다.';
    } catch {
      copyMessage = '복사하지 못했습니다. 위 명령을 직접 복사해 주세요.';
    }
  }

  onMount(async () => {
    if (location.hash !== '#windows-install') return;
    selectedDownload = 'windows';
    await tick();
    document.getElementById('windows-install')?.scrollIntoView?.({ block: 'start' });
  });
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
      <h1 id="landing-title" aria-label="GitHub Issues, as notes">GitHub Issues,<br /><em>as notes</em></h1>
      <p class="landing-lead">가볍고 심플한 나만의 노트 앱. GitHub Issues와 연동되어 개발 공간과 MCP 도구에서도 같은 노트를 사용할 수 있습니다.</p>
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
      <div><strong>MCP와 완전 통합</strong><p>노트가 GitHub Issues에 저장되어 GitHub API와 공식 MCP Server에서 그대로 읽고 쓸 수 있습니다. <a href="https://github.com/github/github-mcp-server" target="_blank" rel="noreferrer">MCP 사용 방법 ↗</a></p></div>
      <div><strong>한 번 더 잠금</strong><p>비공개 저장소에 보관한 노트라도, 원한다면 본문에 잠금을 걸어 암호화할 수 있습니다.</p></div>
      <div><strong>웹과 앱, 터미널</strong><p>브라우저와 설치형 앱, TUI에서 같은 저장소를 사용할 수 있습니다.</p></div>
    </section>

    <section id="downloads" class="landing-downloads" aria-labelledby="downloads-title">
      <p class="landing-eyebrow">INSTALL GINOTE</p>
      <h2 id="downloads-title">원하는 곳에서 쓰세요</h2>
      <div class="landing-download-grid" class:has-selection={Boolean(selectedDownload)}>
        <article class:is-selected={selectedDownload === 'macos'}><h3><i class="bi bi-apple" aria-hidden="true"></i> macOS</h3><p>DMG 설치 파일 또는 Homebrew로 설치합니다.</p><button type="button" aria-expanded={selectedDownload === 'macos'} on:click={() => showDownload('macos')}>설치 방법 {selectedDownload === 'macos' ? '접기 ↑' : '보기 ↓'}</button></article>
        <article class:is-selected={selectedDownload === 'windows'}><h3><i class="bi bi-windows" aria-hidden="true"></i> Windows</h3><p>Microsoft Store 없이 설치 파일을 내려받아 설치합니다.</p><button type="button" aria-expanded={selectedDownload === 'windows'} on:click={() => showDownload('windows')}>설치 방법 {selectedDownload === 'windows' ? '접기 ↑' : '보기 ↓'}</button></article>
        <article class:is-selected={selectedDownload === 'linux'}><h3><i class="bi bi-laptop" aria-hidden="true"></i> Linux</h3><p>AppImage, deb, rpm 중에서 선택합니다.</p><button type="button" aria-expanded={selectedDownload === 'linux'} on:click={() => showDownload('linux')}>설치 방법 {selectedDownload === 'linux' ? '접기 ↑' : '보기 ↓'}</button></article>
        <article class:is-selected={selectedDownload === 'tui'}><h3><i class="bi bi-terminal" aria-hidden="true"></i> TUI</h3><p>터미널에서 한 줄 명령으로 빌드하고 설치합니다.</p><button type="button" aria-expanded={selectedDownload === 'tui'} on:click={() => showDownload('tui')}>설치 방법 {selectedDownload === 'tui' ? '접기 ↑' : '보기 ↓'}</button></article>
      </div>
      {#if selectedDownload}
      <div id="download-details" class="landing-install-guide">
      {#if selectedDownload === 'macos'}
        <p class="landing-eyebrow">MACOS INSTALL GUIDE</p>
        <h3>macOS에서 설치하기</h3>
        <p>아래 두 방법 중 하나를 선택하세요.</p>
        <div class="landing-install-options">
          <section class="landing-install-option" aria-labelledby="macos-dmg-title">
            <h4 id="macos-dmg-title">DMG 파일로 설치</h4>
            <ol>
              <li><a href="https://github.com/zidell/ginote/releases/latest">최신 릴리스</a>의 Assets에서 <code>universal.dmg</code>로 끝나는 파일을 받으세요.</li>
              <li>DMG를 열어 <strong>Ginote</strong>를 <strong>Applications</strong> 폴더로 옮기고 앱을 실행하세요.</li>
            </ol>
          </section>
          <span class="landing-install-or" aria-hidden="true">OR</span>
          <section class="landing-install-option" aria-labelledby="macos-homebrew-title">
            <h4 id="macos-homebrew-title">Homebrew로 설치</h4>
            <p>명령을 복사해 터미널에서 실행하세요.</p>
            <div class="landing-command"><code>{homebrewInstallCommand}</code><button type="button" on:click={() => copyCommand(homebrewInstallCommand)}>명령 복사</button></div>
            {#if copyMessage}<p class="landing-copy-message" role="status">{copyMessage}</p>{/if}
          </section>
        </div>
      {:else if selectedDownload === 'linux'}
        <p class="landing-eyebrow">LINUX INSTALL GUIDE</p>
        <h3>Linux에서 설치하기</h3>
        <p><a href="https://github.com/zidell/ginote/releases/latest">최신 릴리스</a>의 Assets에서 배포판에 맞는 파일을 받으세요.</p>
        <ul>
          <li><strong>AppImage</strong> · 파일에 실행 권한을 주고 실행합니다: <code>chmod +x Ginote_*.AppImage && ./Ginote_*.AppImage</code></li>
          <li><strong>Debian / Ubuntu</strong> · <code>sudo apt install ./Ginote_*_amd64.deb</code></li>
          <li><strong>Fedora / RHEL</strong> · <code>sudo dnf install ./Ginote-*.x86_64.rpm</code></li>
        </ul>
      {:else if selectedDownload === 'tui'}
        <p class="landing-eyebrow">TERMINAL INSTALL GUIDE</p>
        <h3>터미널에서 TUI 설치하기</h3>
        <p>Go 1.27.1 이상과 C 컴파일러가 필요합니다. 다음 명령을 터미널에 붙여 넣으면 소스를 내려받아 <code>~/.local/bin/ginote-tui</code>에 설치합니다.</p>
        <div class="landing-command"><code>{tuiInstallCommand}</code><button type="button" on:click={() => copyCommand(tuiInstallCommand)}>명령 복사</button></div>
        {#if copyMessage}<p class="landing-copy-message" role="status">{copyMessage}</p>{/if}
        <p>설치 후 <code>ginote-tui</code>를 실행하세요. 명령을 찾지 못하면 <code>~/.local/bin</code>을 PATH에 추가하세요. <a href="https://github.com/zidell/ginote/blob/main/tui/install.sh">설치 스크립트 보기</a> · <a href="https://github.com/zidell/ginote/blob/main/docs/TUI.md">TUI 상세 문서</a></p>
      {:else if selectedDownload === 'windows'}
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
      {/if}
      </div>
      {/if}
      <p class="landing-pwa">브라우저에서도 설치할 수 있습니다. 이 페이지를 브라우저의 “앱 설치” 메뉴로 추가하면 다음부터 저장소 설정 화면으로 바로 열립니다.</p>
    </section>
  </div>
  <footer class="landing-footer">Ginote · <a href="https://github.com/zidell/ginote">소스 코드</a> · GPLv3</footer>
</main>
