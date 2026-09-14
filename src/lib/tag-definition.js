export function formatTagDefinition(label) {
  if (!label) return '';
  return label.description ? `${label.name}: ${label.description}` : label.name;
}

export function parseTagDefinition(value, currentLabel = null) {
  const source = String(value || '').trim();
  // 기존 라벨명에 :가 있더라도, 화면이 만든 "기존 이름: 설명" 형식은
  // 원래 이름을 보존해 해석한다. 새 입력은 첫 :를 구분자로 쓴다.
  const currentName = String(currentLabel?.name || '').trim();
  if (currentName && source === currentName) return { name: currentName, description: '' };
  if (currentName && source.startsWith(`${currentName}:`)) {
    return { name: currentName, description: source.slice(currentName.length + 1).trim() };
  }
  const separator = source.indexOf(':');
  return {
    name: (separator < 0 ? source : source.slice(0, separator)).trim(),
    description: (separator < 0 ? '' : source.slice(separator + 1)).trim()
  };
}
