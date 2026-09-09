function hslToHex(hue, saturation, lightness) {
  const saturationRatio = saturation / 100;
  const lightnessRatio = lightness / 100;
  const chroma = (1 - Math.abs(2 * lightnessRatio - 1)) * saturationRatio;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs(section % 2 - 1));
  const [red, green, blue] = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
      : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
          : section < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const offset = lightnessRatio - chroma / 2;
  return [red, green, blue]
    .map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0'))
    .join('');
}

export function tagColorForName(value) {
  let hash = 0;
  for (const character of String(value || '').normalize('NFC')) {
    hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  }
  return hslToHex(hash % 360, 64, 58);
}
