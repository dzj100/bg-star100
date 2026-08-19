/* 长描述卡完整展示验证：node test-desc-long.js */
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
  await new Promise(r => server.listen(8205, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8205/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.click('.class-card:nth-child(4) input'); // 圣汐医者
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');

    // 进入战斗，把手牌替换为长描述卡
    await page.evaluate(() => {
      const node = state.map.nodes.find(n => n.state === 'available');
      selectNode(node.id);
    });
    await page.waitForSelector('.combat-screen');
    await page.evaluate(() => {
      const p = state.party[0];
      p.hand = [
        { uid: state.nextUid++, id: 'healer_purify' },
        { uid: state.nextUid++, id: 'healer_verdict' },
        { uid: state.nextUid++, id: 'healer_wash' },
        { uid: state.nextUid++, id: 'healer_redemption' },
      ];
      render();
    });
    await sleep(300);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'd1-desc-long-hand.png'), fullPage: true });

    // 校验：每个 .card-desc 都没有溢出裁剪
    const overflow = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.hand .card').forEach((c, i) => {
        const d = c.querySelector('.card-desc');
        if (!d) return;
        if (d.scrollHeight > d.clientHeight + 1) {
          bad.push({ i, cls: c.className, text: d.textContent.trim(), sh: d.scrollHeight, ch: d.clientHeight });
        }
      });
      return bad;
    });
    console.log(JSON.stringify(overflow, null, 1));

    // 奖励界面长卡
    await page.evaluate(() => {
      state.party[0].hand = [];
      state.combat.enemyGroup.forEach(e => { e.hp = 1; e.block = 0; dealDamage(e, 999, { playerIdx: 0 }); });
      if (allEnemiesDead()) combatWon();
      render();
    });
    await page.waitForSelector('.reward-screen');
    await sleep(300);
    await page.screenshot({ path: path.join(__dirname, 'shots', 'd2-reward-long.png'), fullPage: true });
    const rewardOverflow = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.reward-card .card').forEach((c, i) => {
        const d = c.querySelector('.card-desc');
        if (!d) return;
        if (d.scrollHeight > d.clientHeight + 1) bad.push({ i, text: d.textContent.trim(), sh: d.scrollHeight, ch: d.clientHeight });
      });
      return bad;
    });
    console.log('reward overflow:', JSON.stringify(rewardOverflow));

    const errs = errors.filter(e => !e.includes('favicon'));
    const total = overflow.length + rewardOverflow.length;
    if (total > 0) { console.log('FAIL: ' + total + ' 张卡片文案被裁剪'); process.exitCode = 1; }
    else if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('DESC-LONG OK: 所有卡片文案完整展示');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
