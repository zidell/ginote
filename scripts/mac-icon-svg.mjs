// macOS 앱 아이콘 틀: 1024 캔버스 가운데에 824 둥근판, 둘레 여백과 옅은 그림자(Apple 아이콘 규격).
// 꽉 찬 그림을 그대로 쓰면 Dock·Finder에서 다른 앱보다 커 보인다.
// Tauri 데스크톱(icon.icns, scripts/generate-icons.mjs)과 맥 네이티브 앱(macos/scripts/app-icon.mjs)이 함께 쓴다.

const CANVAS = 1024;
const BODY = 824;
const RADIUS = 185;
const OFFSET = (CANVAS - BODY) / 2;

// art: 512 기준 viewBox의 SVG 본문(배경·전경 원본을 이은 것)
export function macIconSvg(art) {
  const scale = BODY / 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">
<defs>
  <clipPath id="body"><rect x="${OFFSET}" y="${OFFSET}" width="${BODY}" height="${BODY}" rx="${RADIUS}"/></clipPath>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
    <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.28"/>
  </filter>
</defs>
<rect x="${OFFSET}" y="${OFFSET}" width="${BODY}" height="${BODY}" rx="${RADIUS}" fill="#0f766e" filter="url(#shadow)"/>
<g clip-path="url(#body)">
  <g transform="translate(${OFFSET} ${OFFSET}) scale(${scale})">
${art}
  </g>
</g>
</svg>
`;
}
