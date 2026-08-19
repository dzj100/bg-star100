/* 敌人 debuff 左侧竖排验证：node test-enemy-debuffs.js */
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
  await new Promise(r => server.listen(8206, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8206/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.click('.class-card:nth-child(1) input');
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');

    await page.evaluate(() => {
      const node = state.map.nodes.find(n => n.state === 'available');
      selectNode(node.id);
    });
    await page.waitForSelector('.combat-screen');
    await page.evaluate(() => {
      // 给第一个敌人加 3 个 debuff + 1 个 buff
      const e = state.combat.enemyGroup[0];
      e.buffs.poison = 3;
      e.buffs.weak = 2;
      e.buffs.vulnerable = 2;
      e.buffs.strength = 2;
      render();
    });
    await sleep(300);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'e1-enemy-debuffs-left.png'), fullPage: true });

    // 校验：debuff 在 .enemy-debuffs 列中，buff 不在其中
    const check = await page.evaluate(() => {
      const card = document.querySelector('.enemy-card');
      const col = card.querySelector('.enemy-debuffs');
      const colTexts = col ? Array.from(col.querySelectorAll('.buff-chip')).map(c => c.textContent.trim()) : [];
      const flowChips = Array.from(card.querySelectorAll(':scope > .buff-chip')).map(c => c.textContent.trim());
      const colRect = col.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const leftAligned = Math.abs(colRect.left - cardRect.left) < 6;
      const colBelow = Array.from(col.querySelectorAll('.buff-chip')).every((c, i, arr) =>
        i === 0 || c.getBoundingClientRect().top > arr[i - 1].getBoundingClientRect().top + 4
      );
      const intent = card.querySelector('.intent');
      const intentBelow = intent.getBoundingClientRect().top > colRect.bottom;
      return { colTexts, flowChips, leftAligned, colBelow, intentBelow };
    });
    console.log(JSON.stringify(check, null, 1));

    const errs = errors.filter(e => !e.includes('favicon'));
    if (check.colTexts.length !== 3 || !check.colTexts.every(t => ['中毒 3', '虚弱 2', '易伤 2'].includes(t))) {
      console.log('FAIL: debuff 列内容不正确'); process.exitCode = 1;
    } else if (!check.leftAligned) { console.log('FAIL: debuff 未贴左'); process.exitCode = 1; }
    else if (!check.colBelow) { console.log('FAIL: debuff 未竖排'); process.exitCode = 1; }
    else if (!check.intentBelow) { console.log('FAIL: 意图不在 debuff 下方'); process.exitCode = 1; }
    else if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('ENEMY-DEBUFFS OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
