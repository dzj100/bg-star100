/* 休息界面验证：node test-rest-shot.js */
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
  await new Promise(r => server.listen(8202, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const shot = name => page.screenshot({ path: path.join(__dirname, 'shots', name), fullPage: true });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8202/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.click('.class-card:nth-child(1) input');
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');

    // 走到休息节点：通过 evaluate 直接跳到休息界面（简化为进入第一个 rest 节点）
    const restNode = await page.evaluate(() => {
      const n = state.map.nodes.find(n => n.type === 'rest');
      if (n && n.state !== 'locked') { act('select-node', n.id); return true; }
      return false;
    });
    if (!restNode) {
      // 找不到休息节点，直接手动注入 rest 界面验证
      await page.evaluate(() => {
        state.phase = 'rest';
        state.rest = { upgradeMode: false, confirmCard: null, lastUpgrade: '' };
        render();
      });
    }
    await page.waitForSelector('.rest-screen');
    await shot('r1-rest.png');

    // 进入锻造升级
    await page.click('.rest-upg-btn');
    await page.waitForSelector('.rest-rm-title');
    await shot('r2-upgrade-mode.png');

    // 选择第一张可升级卡 → 弹出确认弹窗
    await page.click('.deck-chip.upg');
    await page.waitForSelector('.shop-confirm-overlay');
    await sleep(200);
    await shot('r2b-upgrade-confirm.png');

    // 确认锻造
    await page.click('text=确认锻造');
    await sleep(300);
    await page.waitForSelector('.rest-screen');
    await shot('r3-after-forge.png');

    // 验证提示存在 + 离开按钮位置
    const result = await page.$eval('.rest-result', el => el.textContent).catch(() => null);
    const leaveBox = await page.$eval('.rest-leave .btn', el => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth, center: Math.round(r.left + r.width / 2) };
    });
    console.log('锻造提示:', result);
    console.log('离开按钮:', JSON.stringify(leaveBox), '居中:', Math.abs(leaveBox.center - leaveBox.vw / 2) <= 2);

    // 回归：同层第二个休息点应可用（每节点一次，非每层一次）
    await page.evaluate(() => {
      state.run.restUsed = true; // 模拟本层已在别处用过休息/锻造
      state.party[0].hp = Math.round(state.party[0].maxHp * 0.5); // 制造受伤
      const n = { id: 99001, type: 'rest', row: 1, col: 0, state: 'available' };
      state.map.nodes.push(n);
      state.phase = 'map';
      act('select-node', n.id);
    });
    await page.waitForSelector('.rest-screen');
    const locked2 = await page.$eval('.rest-heal-btn', el => el.disabled);
    console.log(locked2 ? 'FAIL: 同层第二个休息点被错误锁定' : 'PASS: 同层第二个休息点可用（每节点一次）');
    if (locked2) process.exitCode = 1;
    const hp0 = await page.evaluate(() => state.party[0].hp);
    await page.click('.rest-heal-btn');
    await sleep(300);
    const hp1 = await page.evaluate(() => state.party[0].hp);
    console.log(hp1 > hp0 ? `PASS: 第二个休息点点击回血 ${hp0}→${hp1}` : 'FAIL: 第二个休息点点击未回血');
    if (hp1 <= hp0) process.exitCode = 1;

    // 回归：同一节点不可无限使用——恢复后（无石板）锻造必须被锁定
    const upgLocked = await page.$eval('.rest-upg-btn', el => el.disabled);
    console.log(upgLocked ? 'PASS: 恢复后锻造被锁定（无石板二选一）' : 'FAIL: 恢复后锻造仍可点击');
    if (!upgLocked) process.exitCode = 1;
    const healLocked = await page.$eval('.rest-heal-btn', el => el.disabled);
    console.log(healLocked ? 'PASS: 恢复后不可再次恢复' : 'FAIL: 恢复后可重复恢复');
    if (!healLocked) process.exitCode = 1;

    // 回归：有远古石板时同节点可选两次（恢复+锻造各一次），之后全部锁定
    await page.evaluate(() => {
      if (!state.run.relicIds.includes('ancient_tablet')) state.run.relicIds.push('ancient_tablet');
      state.party[0].hp = Math.round(state.party[0].maxHp * 0.5);
      const n3 = { id: 99003, type: 'rest', row: 1, col: 2, state: 'available' };
      state.map.nodes.push(n3);
      state.phase = 'map';
      act('select-node', n3.id);
    });
    await page.waitForSelector('.rest-screen');
    await page.click('.rest-heal-btn');
    await sleep(300);
    const upgOk = await page.$eval('.rest-upg-btn', el => !el.disabled);
    console.log(upgOk ? 'PASS: 有石板时恢复后仍可锻造' : 'FAIL: 有石板时恢复后锻造被锁');
    if (!upgOk) process.exitCode = 1;
    await page.click('.rest-upg-btn');
    await page.waitForSelector('.rest-rm-title');
    await page.evaluate(() => {
      const p = state.party[0];
      const t = p.deck.find(c => !c.upg);
      if (t) act('rest-upgrade', 0, t.id);
    });
    await page.waitForSelector('.shop-confirm-overlay');
    await page.click('text=确认锻造');
    await sleep(300);
    const bothLocked = await page.evaluate(() => {
      const h = document.querySelector('.rest-heal-btn').disabled;
      const u = document.querySelector('.rest-upg-btn').disabled;
      return h && u;
    });
    console.log(bothLocked ? 'PASS: 石板两次用完后全部锁定' : 'FAIL: 石板两次用完后仍有按钮可用');
    if (!bothLocked) process.exitCode = 1;
    const hint2 = await page.$eval('.rest-hint', el => el.innerText).catch(() => '(无)');
    console.log('次数用尽提示:', hint2);

    const errs = errors.filter(e => !e.includes('favicon'));
    if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('REST SHOT OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
