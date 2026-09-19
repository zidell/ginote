import { isPinLabel } from './pin-label.js';

const TAG_NAME_MAX_LENGTH = 50;
const TAG_DESCRIPTION_MAX_LENGTH = 100;

function sameName(left, right) {
  return String(left).toLocaleLowerCase() === String(right).toLocaleLowerCase();
}

function limitCodePoints(value, maxLength) {
  return Array.from(String(value || '').trim()).slice(0, maxLength).join('');
}

export function hasIssueLabel(issue, labelName) {
  return issue?.labels?.some((label) => sameName(label.name, labelName));
}

// nextName이 없으면 태그를 떼고, 있으면 그 이름으로 바꾼다.
export function replaceIssueLabel(issue, currentName, nextName = '') {
  if (!issue) return issue;
  const nextLabels = (issue.labels || [])
    .filter((label) => nextName || !sameName(label.name, currentName))
    .map((label) => sameName(label.name, currentName) ? { ...label, name: nextName } : label);
  return { ...issue, labels: nextLabels };
}

export function replaceLabelName(names, currentName, nextName = '') {
  return names
    .filter((name) => nextName || !sameName(name, currentName))
    .map((name) => sameName(name, currentName) ? nextName : name);
}

// 여러 노트의 태그를 대소문자 구분 없이 합친다. 고정용 내부 라벨은 뺀다.
export function uniqueIssueLabelNames(issues) {
  const names = new Map();
  for (const issue of issues) {
    for (const label of issue.labels || []) {
      if (isPinLabel(label)) continue;
      const name = String(label.name || '').trim();
      if (name) names.set(name.toLocaleLowerCase(), name);
    }
  }
  return [...names.values()];
}

export function sortLabels(labels, locale) {
  return [...labels].sort((a, b) => a.name.localeCompare(b.name, locale));
}

export function mergeLabels(currentLabels, nextLabels, locale) {
  const labelsByName = new Map(
    [...currentLabels, ...nextLabels].map((label) => [label.name.toLocaleLowerCase(), label])
  );
  return sortLabels([...labelsByName.values()], locale);
}

export function countIssueLabels(issues) {
  const counts = new Map();
  for (const issue of issues) {
    for (const label of issue.labels || []) {
      if (isPinLabel(label)) continue;
      const key = label.name.toLocaleLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

export function tagOptions(labels, counts, search, locale) {
  const term = search.trim().replace(/^#+/, '').toLocaleLowerCase();
  return labels
    .map((label) => ({ name: label.name, count: counts.get(label.name.toLocaleLowerCase()) || 0 }))
    .filter((option) => option.name.toLocaleLowerCase().includes(term))
    // 선택에 이미 붙은 태그를 위로 올려, 떼는 조작을 먼저 만나게 한다.
    .sort((a, b) => (b.count > 0) - (a.count > 0) || a.name.localeCompare(b.name, locale));
}

// GitHub 라벨 이름·설명 길이 제한에 맞춘다. 이모지 등 서로게이트 쌍을 자르지 않도록 코드 포인트로 센다.
export function limitTagInput(tag) {
  return {
    name: limitCodePoints(tag?.name, TAG_NAME_MAX_LENGTH),
    description: limitCodePoints(tag?.description, TAG_DESCRIPTION_MAX_LENGTH)
  };
}
