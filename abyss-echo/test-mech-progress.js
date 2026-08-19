/* 学者潮汐进度点 + 猎手连击徽章视觉验证：node test-mech-progress.js */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await new Promise(r => server.listen(8207, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8207/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.click('.class-card:nth-child(2) input'); // 潮汐学者
    await page.click('.class-card:nth-child(3) input'); // 深渊猎手
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');

    await page.evaluate(() => {
      const node = state.map.nodes.find(n => n.state === 'available');
      selectNode(node.id);
    });
    await page.waitForSelector('.combat-screen');

    // 学者打出1张攻击牌 → 1/3 点；猎手打出2张牌 → ×2
    await page.evaluate(() => {
      const s = state.party[0]; // 学者
      s.hand = [{ uid: state.nextUid++, id: 'scholar_strike' }];
      playCard(0, 0, 0);
      const h = state.party[1]; // 猎手
      h.hand = [{ uid: state.nextUid++, id: 'hunter_step' }, { uid: state.nextUid++, id: 'hunter_twin' }];
      playCard(1, 0, 0);
      playCard(1, 0, 0); // hunter_step 是技能抽牌，无目标；hunter_twin 攻击需要目标
    });
    await sleep(300);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'm1-mech-progress.png'), fullPage: true });

    const check = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('.party-card').forEach((c, i) => {
        const m = c.querySelector('.party-mechanic');
        if (!m) return;
        const dots = Array.from(m.querySelectorAll('.mech-dot')).map(d => d.classList.contains('on'));
        const combo = m.querySelector('.combo-badge');
        out['p' + i] = {
          text: m.textContent.trim(),
          dots: dots.length ? dots : null,
          combo: combo ? combo.textContent.trim() : null,
        };
      });
      return out;
    });
    console.log(JSON.stringify(check, null, 1));

    const errs = errors.filter(e => !e.includes('favicon'));
    const p0 = check.p0 || {}, p1 = check.p1 || {};
    const okScholar = p0.dots && p0.dots.length === 3 && p0.dots.filter(Boolean).length === 1;
    const okHunter = p1.combo === '×2';
    if (!okScholar) { console.log('FAIL: 学者潮汐进度点异常'); process.exitCode = 1; }
    else if (!okHunter) { console.log('FAIL: 猎手连击徽章异常'); process.exitCode = 1; }
    else if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('MECH-PROGRESS OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
