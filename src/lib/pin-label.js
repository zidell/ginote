export const PIN_LABEL_NAME = 'ginote:pin';

function labelName(value) {
  return typeof value === 'string' ? value : value?.name;
}

export function isPinLabel(value) {
  return String(labelName(value) || '').toLocaleLowerCase() === PIN_LABEL_NAME;
}

export function hasPinLabel(issue) {
  return Boolean(issue?.labels?.some((label) => isPinLabel(label)));
}

export function withPinState(issue, pinned) {
  if (!issue) return issue;
  const labels = (issue.labels || []).filter((label) => !isPinLabel(label));
  return {
    ...issue,
    labels: pinned ? [...labels, { name: PIN_LABEL_NAME }] : labels
  };
}

export function visibleLabels(labels = []) {
  return labels.filter((label) => !isPinLabel(label));
}

export function visibleLabelNames(names = []) {
  return names.filter((name) => !isPinLabel(name));
}
