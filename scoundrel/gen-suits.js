/* ============================================================
   生成四花色图标 PNG（150x150 透明背景，与牌面风格一致）
   node gen-suits.js
   ============================================================ */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'assets', 'suits');
const RED = { from: '#e0534a', to: '#a82820' };
const BLACK = { from: '#454e66', to: '#1c2130' };

function grad(id, c) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${c.from}"/>
    <stop offset="1" stop-color="${c.to}"/>
  </linearGradient>`;
}
function highlight(cy, rx) {
  return `<ellipse cx="60" cy="${cy}" rx="${rx}" ry="${(rx * 0.62).toFixed(1)}" fill="#fff" opacity=".15"/>`;
}

const SUITS = {
  heart: {
    colors: RED,
    parts: [
      '<path d="M60 96 C 16 66 6 38 28 20 C 44 8 60 20 60 20 C 60 20 76 8 92 20 C 114 38 104 66 60 96 Z"/>'
    ],
    hl: highlight(40, 24)
  },
  diamond: {
    colors: RED,
    parts: [
      '<rect x="32" y="32" width="56" height="56" rx="9" transform="rotate(45 60 60)"/>'
    ],
    hl: highlight(44, 17)
  },
  spade: {
    colors: BLACK,
    parts: [
      '<path d="M60 28 C 16 56 6 82 28 100 C 42 112 60 102 60 102 C 60 102 78 112 92 100 C 114 82 104 56 60 28 Z"/>',
      '<path d="M57 100 L63 100 L61.5 110 L58.5 110 Z"/>',
      '<circle cx="60" cy="113" r="4.5"/>'
    ],
    hl: highlight(42, 21)
  },
  club: {
    colors: BLACK,
    parts: [
      '<circle cx="42" cy="44" r="16"/>',
      '<circle cx="78" cy="44" r="16"/>',
      '<circle cx="60" cy="62" r="18"/>',
      '<path d="M58 80 L62 80 L61 108 L59 108 Z"/>',
      '<circle cx="60" cy="110" r="4.5"/>'
    ],
    hl: highlight(40, 20)
  }
};

function svg(name, s) {
  const gid = 'g-' + name;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 120 120">
  <defs>${grad(gid, s.colors)}</defs>
  <g fill="url(#${gid})">${s.parts.join('')}</g>
  ${s.hl}
</svg>`;
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
  for (const [name, s] of Object.entries(SUITS)) {
    await page.setContent(svg(name, s), { waitUntil: 'load' });
    const p = path.join(OUT, name + '.png');
    await page.locator('svg').screenshot({ path: p, omitBackground: true });
    console.log('生成:', p);
  }
  await browser.close();
  console.log('完成');
})().catch(e => { console.error(e); process.exit(1); });
