/* 潮汐延迟结算 + 水花动画视觉验证：node test-tide-splash.js */
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
  await new Promise(r => server.listen(8208, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  try {
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    await page.goto('http://localhost:8208/abyss-echo/index.html');
    await page.waitForSelector('.menu-screen');
    await page.click('.class-card:nth-child(2) input'); // 潮汐学者
    await page.click('.start-btn');
    await page.evaluate(() => act('dismiss-intro'));
    await page.waitForSelector('.map-screen');
    await page.evaluate(() => {
      const node = state.map.nodes.find(n => n.state === 'available');
      selectNode(node.id);
    });
    await page.waitForSelector('.combat-screen');

    // 打出3张攻击牌触发潮汐（此时潮汐未结算）；先抬高敌人血量避免3刀打死导致无水花
    await page.evaluate(() => {
      state.combat.enemyGroup.forEach(e => { if (Number(e.hp) < 60) e.hp = 60; });
      const p = state.party[0];
      p.hand = [{ uid: state.nextUid++, id: 'scholar_strike' }, { uid: state.nextUid++, id: 'scholar_strike' }, { uid: state.nextUid++, id: 'scholar_strike' }];
      p.energy = 3;
      playCard(0, 0, 0);
      playCard(0, 0, 0);
      playCard(0, 0, 0);
    });
    await sleep(120);
    const diag = await page.evaluate(() => ({
      pending: !!state.combat.pendingTide,
      spells: state.combat.spellsPlayed.slice(),
      sub: state.subPhase,
      hp: state.combat.enemyGroup.map(e => e.hp),
    }));
    console.log('诊断(3张后):', JSON.stringify(diag));
    const earlyErrors = errors.filter(e => !e.includes('favicon'));
    if (earlyErrors.length) { console.error('潮汐触发前 JS 错误:\n' + earlyErrors.join('\n')); }
    const pendingSet = diag.pending;
    const totalBefore = diag.hp.reduce((a, b) => a + b, 0);

    // 等待潮汐结算 + 水花出现的瞬间截图
    const hasFn = await page.evaluate(() => typeof window.resolveTide);
    console.log('window.resolveTide:', hasFn);
    try {
      await page.waitForFunction(() => !!state.combat.tideSplash, null, { timeout: 4000 });
    } catch (e) {
      console.error('等待水花超时。当前:', await page.evaluate(() => JSON.stringify({
        pendingTide: state.combat.pendingTide,
        tideSplash: state.combat.tideSplash,
        phase: state.phase,
        sub: state.subPhase,
        hp: state.combat.enemyGroup.map(x => x.hp),
      })));
      const all = errors.filter(x => !x.includes('favicon'));
      if (all.length) console.error('JS 错误:\n' + all.join('\n'));
      throw e;
    }
    // 检测到水花的瞬间立即确认 class（900ms 后标记会清除，不能在最后断言）
    const splashClass = await page.evaluate(() => !!document.querySelector('.enemy-card.tide-splash'));
    await sleep(80);
    const anim = await page.evaluate(() => {
      const card = document.querySelector('.enemy-card.tide-splash');
      if (!card) return null;
      const ring = card.querySelector('.tide-ring');
      return {
        before: getComputedStyle(card, '::before').animationName,
        ring: ring ? getComputedStyle(ring).animationName : 'MISSING',
        img: getComputedStyle(card.querySelector('.enemy-img'), null).animationName,
      };
    });
    console.log('水花动画:', JSON.stringify(anim));
    await page.screenshot({ path: path.join(__dirname, 'shots', 't1-tide-splash.png'), fullPage: true });
    // 动画中段（约+120ms）：裁剪第一个敌人卡片放大看水环
    const box = await page.locator('.enemy-card').first().boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(__dirname, 'shots', 't4-enemy-card-zoom.png'),
        clip: { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 },
        scale: 'css',
      });
    }
    await sleep(150);
    const ringTransform = await page.evaluate(() => {
      const card = document.querySelector('.enemy-card.tide-splash');
      const ring = card && card.querySelector('.tide-ring');
      return ring ? getComputedStyle(ring).transform : 'NO-RING';
    });
    console.log('水环 transform(+150ms):', ringTransform);
    await page.screenshot({ path: path.join(__dirname, 'shots', 't2-tide-splash-mid.png'), fullPage: true });
    await sleep(150);
    await page.screenshot({ path: path.join(__dirname, 'shots', 't3-tide-splash-late.png'), fullPage: true });

    const hpAfter = await page.evaluate(() => state.combat.enemyGroup.map(x => x.hp));
    const totalAfter = hpAfter.reduce((a, b) => a + b, 0);
    console.log('pendingTide(3张后):', pendingSet, '| 总HP:', totalBefore, '->', totalAfter, '| 水花class存在:', splashClass);

    const errs = errors.filter(e => !e.includes('favicon'));
    if (!pendingSet) { console.log('FAIL: 第3张攻击牌后未设置 pendingTide'); process.exitCode = 1; }
    else if (totalAfter !== totalBefore - 6) { console.log('FAIL: 潮汐伤害未结算 (6点)'); process.exitCode = 1; }
    else if (!splashClass) { console.log('FAIL: 水花 class 未渲染'); process.exitCode = 1; }
    else if (errs.length) { console.error('JS 错误:\n' + errs.join('\n')); process.exitCode = 1; }
    else console.log('TIDE-SPLASH OK');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
