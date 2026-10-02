<script>
  import SetupWizard from './SetupWizard.svelte';
  import { friendlyError } from './error-messages.js';
  import { makePatCreationUrl, normalizeToken } from './repo-address.js';

  // 이미 연결한 저장소 외에 다른 저장소를 추가한다. 계정 준비 단계는 건너뛰고 저장소 주소부터 묻는다.
  export let onAdd = async () => {};
  export let onClose = () => {};

  let repo = '';
  let tokenInputValue = '';
  let rememberToken = true;
  let busy = false;
  let error = '';

  function cancel() {
    if (!busy) onClose();
  }

  async function submit() {
    busy = true;
    error = '';
    try {
      await onAdd({ repo, token: normalizeToken(tokenInputValue), rememberToken });
      onClose();
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      busy = false;
    }
  }
</script>

<div class="workspace-wizard-overlay">
  <SetupWizard
    bind:repo
    bind:tokenInputValue
    bind:rememberToken
    {busy}
    {error}
    patCreationUrl={makePatCreationUrl(repo)}
    initialStep={3}
    allowCancel
    onCancel={cancel}
    onConnect={submit}
  />
</div>
