/* ============================================================
   生成卡面主题图标 PNG（血瓶/怪物/武器 各3档，150x150 透明背景）
   ============================================================ */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'assets', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function grad(id, from, to, vertical) {
  const x1 = '0', y1 = '0', x2 = vertical ? '0' : '1', y2 = vertical ? '1' : '0';
  return '<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' +
    '<stop offset="0" stop-color="' + from + '"/><stop offset="1" stop-color="' + to + '"/></linearGradient>';
}
function hl(cx, cy, rx, ry, op) {
  return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="#fff" opacity="' + (op || 0.12) + '"/>';
}
function svg(body) {
  return '<svg width="150" height="150" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>';
}

const ICONS = {};

/* ---------- 血瓶（红桃） ---------- */
ICONS['potion-1'] = [
  '<defs>',
  grad('glass', '#f2f5f9', '#c0cadb'),
  grad('liq', '#e2574e', '#9c2218', true),
  '<clipPath id="cl"><path d="M52 32 L68 32 L70 44 C 82 50 88 62 88 72 C 88 90 74 98 60 98 C 46 98 32 90 32 72 C 32 62 38 50 50 44 Z"/></clipPath>',
  '</defs>',
  '<path d="M52 32 L68 32 L70 44 C 82 50 88 62 88 72 C 88 90 74 98 60 98 C 46 98 32 90 32 72 C 32 62 38 50 50 44 Z" fill="url(#glass)"/>',
  '<g clip-path="url(#cl)"><rect x="30" y="60" width="60" height="42" fill="url(#liq)"/><ellipse cx="46" cy="66" rx="6" ry="4" fill="#fff" opacity=".35"/></g>',
  hl(46, 46, 8, 11, 0.28),
  '<rect x="54" y="32" width="12" height="9" fill="#d9e0ea"/>',
  '<rect x="52" y="20" width="16" height="12" rx="3" fill="#a5713f"/>',
  '<rect x="50" y="18" width="20" height="4" rx="2" fill="#b8864d"/>'
].join('');

ICONS['potion-2'] = [
  '<defs>',
  grad('glass', '#f2f5f9', '#c0cadb'),
  grad('liq', '#e2574e', '#9c2218', true),
  '<clipPath id="cl"><path d="M50 30 L70 30 L70 40 C 84 46 90 60 90 74 C 90 92 76 100 60 100 C 44 100 30 92 30 74 C 30 60 36 46 50 40 Z"/></clipPath>',
  '</defs>',
  '<path d="M50 30 L70 30 L70 40 C 84 46 90 60 90 74 C 90 92 76 100 60 100 C 44 100 30 92 30 74 C 30 60 36 46 50 40 Z" fill="url(#glass)"/>',
  '<g clip-path="url(#cl)"><rect x="28" y="58" width="64" height="48" fill="url(#liq)"/><circle cx="48" cy="80" r="3" fill="#fff" opacity=".35"/><circle cx="66" cy="86" r="2" fill="#fff" opacity=".3"/></g>',
  hl(44, 42, 9, 13, 0.28),
  '<rect x="54" y="30" width="12" height="10" fill="#d9e0ea"/>',
  '<rect x="50" y="18" width="20" height="12" rx="3" fill="#a5713f"/>',
  '<rect x="48" y="16" width="24" height="4" rx="2" fill="#b8864d"/>'
].join('');

ICONS['potion-3'] = [
  '<defs>',
  grad('glass', '#f4f7fb', '#bfc9da'),
  grad('liq', '#ea5f55', '#8f1f15', true),
  '<clipPath id="cl"><path d="M48 30 L72 30 L72 42 C 88 48 94 64 94 78 C 94 94 80 102 60 102 C 40 102 26 94 26 78 C 26 64 32 48 48 42 Z"/></clipPath>',
  '</defs>',
  '<path d="M48 30 L72 30 L72 42 C 88 48 94 64 94 78 C 94 94 80 102 60 102 C 40 102 26 94 26 78 C 26 64 32 48 48 42 Z" fill="url(#glass)"/>',
  '<g clip-path="url(#cl)">',
  '<rect x="24" y="62" width="72" height="46" fill="url(#liq)"/>',
  '<rect x="53.5" y="66" width="13" height="30" rx="3" fill="#fff" opacity=".5"/>',
  '<rect x="45" y="74.5" width="30" height="13" rx="3" fill="#fff" opacity=".5"/>',
  '</g>',
  hl(42, 40, 10, 14, 0.3),
  '<rect x="54" y="30" width="12" height="11" fill="#d9e0ea"/>',
  '<rect x="50" y="18" width="20" height="12" rx="3" fill="#a5713f"/>',
  '<rect x="48" y="16" width="24" height="4" rx="2" fill="#b8864d"/>'
].join('');

/* ---------- 怪物（黑桃/梅花：2-5 史莱姆 / 6-9 魔狼 / 10-A 恶龙） ---------- */
ICONS['monster-1'] = [
  '<defs>',
  grad('g1', '#7ccf6b', '#3e7a33', true),
  '</defs>',
  '<path d="M60 28 C 82 24 103 40 100 63 C 97 88 81 103 60 103 C 39 103 23 88 20 63 C 17 40 38 24 60 28 Z" fill="url(#g1)"/>',
  '<circle cx="47" cy="62" r="7.5" fill="#243d1c"/>',
  '<circle cx="73" cy="62" r="7.5" fill="#243d1c"/>',
  '<circle cx="49" cy="60" r="2.8" fill="#fff"/>',
  '<circle cx="75" cy="60" r="2.8" fill="#fff"/>',
  '<path d="M52 84 Q 60 90 68 84" stroke="#243d1c" stroke-width="3" fill="none" stroke-linecap="round"/>',
  hl(38, 40, 13, 8, 0.14)
].join('');

ICONS['monster-2'] = [
  '<defs>',
  grad('g1', '#8f74dd', '#4a358f', true),
  '</defs>',
  '<path d="M42 42 L36 16 L62 32 Z" fill="url(#g1)"/>',
  '<path d="M78 42 L84 16 L58 32 Z" fill="url(#g1)"/>',
  '<path d="M44 38 L41 24 L56 32 Z" fill="#3a2b6e"/>',
  '<path d="M76 38 L79 24 L64 32 Z" fill="#3a2b6e"/>',
  '<path d="M28 50 C 28 28 92 28 92 50 C 92 76 78 98 60 98 C 42 98 28 76 28 50 Z" fill="url(#g1)"/>',
  '<rect x="36" y="50" width="17" height="6.5" rx="3.2" fill="#241a45" transform="rotate(-10 44.5 53)"/>',
  '<rect x="67" y="50" width="17" height="6.5" rx="3.2" fill="#241a45" transform="rotate(10 75.5 53)"/>',
  '<circle cx="41" cy="52.5" r="1.6" fill="#fff"/>',
  '<circle cx="80" cy="52.5" r="1.6" fill="#fff"/>',
  '<ellipse cx="60" cy="74" rx="17" ry="12" fill="#241a45" opacity=".5"/>',
  '<ellipse cx="60" cy="72" rx="6" ry="4" fill="#241a45"/>',
  '<path d="M47 78 L51 88 L55 78 Z" fill="#fff"/>',
  '<path d="M65 78 L69 88 L73 78 Z" fill="#fff"/>',
  hl(42, 42, 12, 7, 0.12)
].join('');

ICONS['monster-3'] = [
  '<defs>',
  grad('g1', '#ea5b38', '#932a18', true),
  '</defs>',
  '<path d="M40 44 C 33 26 20 18 12 22 C 19 32 23 42 27 52 Z" fill="url(#g1)"/>',
  '<path d="M80 44 C 87 26 100 18 108 22 C 101 32 97 42 93 52 Z" fill="url(#g1)"/>',
  '<path d="M26 50 C 28 28 92 28 94 50 C 96 70 86 84 72 90 C 64 93 56 93 48 90 C 34 84 24 70 26 50 Z" fill="url(#g1)"/>',
  '<path d="M42 80 Q 60 96 78 80 L78 88 Q 60 104 42 88 Z" fill="#6e1707"/>',
  '<path d="M44 82 L46 90 L50 82 Z" fill="#fff"/>',
  '<path d="M55 84 L57 92 L61 84 Z" fill="#fff"/>',
  '<path d="M66 84 L68 92 L72 84 Z" fill="#fff"/>',
  '<rect x="34" y="52" width="15" height="7" rx="3.5" fill="#2a0a04" transform="rotate(-8 41.5 55.5)"/>',
  '<rect x="71" y="52" width="15" height="7" rx="3.5" fill="#2a0a04" transform="rotate(8 78.5 55.5)"/>',
  '<circle cx="40" cy="54.5" r="1.7" fill="#fff"/>',
  '<circle cx="80" cy="54.5" r="1.7" fill="#fff"/>',
  '<circle cx="52" cy="64" r="2.6" fill="#2a0a04"/>',
  '<circle cx="68" cy="64" r="2.6" fill="#2a0a04"/>',
  hl(40, 40, 12, 7, 0.13)
].join('');

/* ---------- 武器（方片：2-4 匕首 / 5-7 长剑 / 8-10 巨剑） ---------- */
ICONS['weapon-1'] = [
  '<defs>',
  grad('g1', '#d3dbe6', '#7c88a2', true),
  '</defs>',
  '<path d="M60 22 L69 52 L60 62 L51 52 Z" fill="url(#g1)"/>',
  '<path d="M57.5 26 L55 50" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".5"/>',
  '<rect x="45" y="60" width="30" height="5.5" rx="2.7" fill="#d8b64c"/>',
  '<rect x="55.5" y="65.5" width="9" height="25" rx="3.5" fill="#8a5a3a"/>',
  '<rect x="55.5" y="71" width="9" height="2.2" fill="#5c3822"/>',
  '<rect x="55.5" y="77" width="9" height="2.2" fill="#5c3822"/>',
  '<circle cx="60" cy="94.5" r="5.5" fill="#d8b64c"/>'
].join('');

ICONS['weapon-2'] = [
  '<defs>',
  grad('g1', '#d3dbe6', '#7c88a2', true),
  '</defs>',
  '<path d="M60 20 L70 54 L60 63 L50 54 Z" fill="url(#g1)"/>',
  '<path d="M59 26 L59 50" stroke="#5f6a80" stroke-width="2" stroke-linecap="round"/>',
  '<path d="M54.5 26 L51.5 50" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".55"/>',
  '<path d="M40 63 Q 60 69 80 63 L80 68 Q 60 74 40 68 Z" fill="#d8b64c"/>',
  '<rect x="55.5" y="70" width="9" height="20" rx="3.5" fill="#8a5a3a"/>',
  '<rect x="55.5" y="75" width="9" height="2.2" fill="#5c3822"/>',
  '<circle cx="60" cy="94" r="6" fill="#d8b64c"/>',
  '<circle cx="60" cy="94" r="2.8" fill="#e8c56a"/>'
].join('');

ICONS['weapon-3'] = [
  '<defs>',
  grad('g1', '#d3dbe6', '#7c88a2', true),
  '</defs>',
  '<path d="M60 16 L75 56 L60 70 L45 56 Z" fill="url(#g1)"/>',
  '<rect x="57.5" y="24" width="5" height="36" rx="2.5" fill="#5f6a80" opacity=".65"/>',
  '<path d="M51 26 L44 52" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".5"/>',
  '<rect x="36" y="66" width="48" height="7" rx="3.5" fill="#d8b64c"/>',
  '<circle cx="38" cy="69.5" r="4.2" fill="#e8c56a"/>',
  '<circle cx="82" cy="69.5" r="4.2" fill="#e8c56a"/>',
  '<rect x="55.5" y="73" width="9" height="18" rx="3.5" fill="#8a5a3a"/>',
  '<rect x="55.5" y="78" width="9" height="2.2" fill="#5c3822"/>',
  '<circle cx="60" cy="95" r="7" fill="#d8b64c"/>',
  '<circle cx="60" cy="95" r="3" fill="#e8c56a"/>'
].join('');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<div id="host"></div>');
  for (const [name, body] of Object.entries(ICONS)) {
    await page.evaluate(({ html }) => {
      document.getElementById('host').innerHTML = html;
    }, { html: svg(body) });
    await page.locator('#host svg').screenshot({ path: path.join(OUT, name + '.png'), omitBackground: true });
    console.log('生成:', name + '.png');
  }
  await browser.close();
  console.log('完成');
})();
