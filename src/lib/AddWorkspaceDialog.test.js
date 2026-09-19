import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AddWorkspaceDialog from './AddWorkspaceDialog.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => setAppLocale('en'));
afterEach(cleanup);

async function fillAndSubmit({ repo = 'octo/work', token = '  github_pat_abc  ', remember = true } = {}) {
  await fireEvent.input(screen.getByLabelText('Repository address'), { target: { value: repo } });
  await fireEvent.click(screen.getByRole('button', { name: /Repository address entered/ }));
  await fireEvent.input(screen.getByLabelText('Fine-grained PAT'), { target: { value: token } });
  if (!remember) await fireEvent.click(screen.getByLabelText('Remember PAT in this browser'));
  await fireEvent.click(screen.getByRole('button', { name: /Complete setup/ }));
}

describe('AddWorkspaceDialog', () => {
  it('저장소 주소 단계부터 시작한다', () => {
    render(AddWorkspaceDialog);
    expect(screen.getByText('Step 3 of 4')).toBeTruthy();
  });

  it('입력한 저장소와 정리한 토큰으로 추가하고, 성공하면 닫는다', async () => {
    const onAdd = vi.fn(async () => {});
    const onClose = vi.fn();
    render(AddWorkspaceDialog, { onAdd, onClose });

    await fillAndSubmit({ remember: false });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({ repo: 'octo/work', token: 'github_pat_abc', rememberToken: false });
  });

  it('추가에 실패하면 닫지 않고 이유를 보여준다', async () => {
    const onAdd = vi.fn(async () => { throw Object.assign(new Error('Not Found'), { status: 404 }); });
    const onClose = vi.fn();
    render(AddWorkspaceDialog, { onAdd, onClose });

    await fillAndSubmit();

    await waitFor(() => expect(document.querySelector('.alert-danger, [role="alert"]')).not.toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('추가하는 동안에는 닫을 수 없다', async () => {
    let finish;
    const onAdd = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    render(AddWorkspaceDialog, { onAdd, onClose });

    await fillAndSubmit();
    const closeButton = screen.getByRole('button', { name: 'Close' });
    expect(closeButton.disabled).toBe(true);
    await fireEvent.click(closeButton);
    expect(onClose).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('취소하면 닫는다', async () => {
    const onClose = vi.fn();
    render(AddWorkspaceDialog, { onClose });

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
