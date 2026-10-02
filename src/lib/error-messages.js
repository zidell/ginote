import { translate } from './i18n.js';

// GitHub API 오류를 사용자에게 보여줄 문장으로 바꾼다.
export function friendlyError(reason) {
  if (reason?.status === 401) return translate('m.faea518485');
  if (reason?.status === 404) return translate('m.ff34a34522');
  if (reason?.status === 403 && reason?.remaining === '0') return translate('m.27ef201e27');
  if (reason?.status === 403) return translate('m.26096781ad');
  return reason?.message || translate('m.285cc7fd9a');
}
