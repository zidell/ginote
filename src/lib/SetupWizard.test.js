import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import SetupWizard from './SetupWizard.svelte';
import { setAppLocale } from './i18n.js';

beforeAll(() => {
  setAppLocale('en');
});

afterEach(cleanup);

describe('SetupWizard', () => {
  it('기본값(initialStep=1)이면 인트로 화면부터 시작하고 취소 버튼/소스 링크가 없다', () => {
    render(SetupWizard);
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /GitHub repository/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByText('View source code on GitHub')).toBeTruthy();
  });

  it('initialStep=3이면 저장소 입력 화면부터 시작하고 이전 두 단계는 완료 표시된다', () => {
    render(SetupWizard, { initialStep: 3 });
    expect(screen.getByText('Step 3 of 4')).toBeTruthy();
    expect(screen.getByLabelText('Repository address')).toBeTruthy();

    const steps = document.querySelectorAll('.setup-progress li');
    expect(steps[0].classList.contains('complete')).toBe(true);
    expect(steps[1].classList.contains('complete')).toBe(true);
    expect(steps[2].classList.contains('active')).toBe(true);
  });

  it('allowCancel이면 헤더에 닫기 버튼이 보이고 소스 링크는 숨겨지며, 클릭하면 onCancel을 호출한다', async () => {
    const onCancel = vi.fn();
    render(SetupWizard, { initialStep: 3, allowCancel: true, onCancel });

    expect(screen.queryByText('View source code on GitHub')).toBeNull();
    const closeButton = screen.getByRole('button', { name: 'Close' });
    await fireEvent.click(closeButton);
    expect(onCancel).toHaveBeenCalled();
  });

  it('allowCancel이고 initialStep 그대로일 때는 "이전" 대신 하단에 "Cancel" 버튼이 뜨고, 이전 단계로는 갈 수 없다', async () => {
    const onCancel = vi.fn();
    render(SetupWizard, { initialStep: 3, allowCancel: true, onCancel });

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('allowCancel이어도 initialStep 이후로 진행하면 "이전"이 나타나고, initialStep보다 앞으로는 못 간다', async () => {
    render(SetupWizard, { initialStep: 3, allowCancel: true, repo: 'zidell/ginote' });

    await fireEvent.click(screen.getByRole('button', { name: /Repository address entered/ }));
    expect(screen.getByText('Step 4 of 4')).toBeTruthy();

    const backButton = screen.getByRole('button', { name: 'Back' });
    await fireEvent.click(backButton);
    expect(screen.getByText('Step 3 of 4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('저장소 주소가 owner/repo 형식이 아니면 다음 단계로 넘어갈 수 없다', async () => {
    render(SetupWizard, { initialStep: 3 });
    const input = screen.getByLabelText('Repository address');
    const nextButton = screen.getByRole('button', { name: /Repository address entered/ });

    await fireEvent.input(input, { target: { value: 'not-a-valid-repo' } });
    expect(nextButton.disabled).toBe(true);

    await fireEvent.input(input, { target: { value: 'zidell/ginote' } });
    expect(nextButton.disabled).toBe(false);

    await fireEvent.click(nextButton);
    expect(screen.getByText('Step 4 of 4')).toBeTruthy();
    expect(screen.getByLabelText('Fine-grained PAT')).toBeTruthy();
  });

  it('마지막 단계에서 제출하면 onConnect를 호출한다', async () => {
    const onConnect = vi.fn();
    render(SetupWizard, { initialStep: 4, repo: 'zidell/ginote', onConnect });

    const tokenInput = screen.getByLabelText('Fine-grained PAT');
    await fireEvent.input(tokenInput, { target: { value: 'github_pat_abc' } });
    await fireEvent.click(screen.getByRole('button', { name: /Complete setup/ }));

    expect(onConnect).toHaveBeenCalled();
  });
});
