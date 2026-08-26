/**
 * 时序谜局 E2E：对局中刷新页面（重连）后，轮到自己出牌仍能推送
 * 场景：P2 出1手 → P1 出1手 → P2 刷新 → 轮到 P2 → P2 出牌 → 验证 P1 收到
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:8123/take-time/index.html';
const SHOTS = 'E:/www_self/bg-star100/take-time/shots';
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch();

  // ── 房主 ──
  const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p1 = await ctx1.newPage();
  p1.on('dialog', d => d.accept('房主'));
  p1.on('pageerror', e => console.log('[P1 error]', e.message));
  p1.on('console', m => { if (m.text().includes('[taketime] place')) console.log('[P1]', m.text().slice(0, 160)); });

  await p1.goto(BASE);
  await p1.waitForSelector('text=联机模式', { timeout: 20000 });
  await p1.click('text=联机模式');
  await p1.waitForTimeout(500);
  await p1.click('text=创建房间');
  await p1.waitForTimeout(2000);
  const roomTitle = await p1.textContent('.setup-header h1');
  const code = roomTitle.match(/\d{4}/)[0];
  console.log('房间号:', code);

  // ── 成员 ──
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => console.log('[P2 error]', e.message));
  p2.on('console', m => { if (m.text().includes('[taketime] place')) console.log('[P2]', m.text().slice(0, 160)); });
  await p2.goto(BASE);
  await p2.waitForSelector('text=联机模式', { timeout: 20000 });
  await p2.click('text=联机模式');
  await p2.fill('#joinRoomInput', code);
  await p2.fill('#joinNameInput', '小明');
  await p2.click('text=加入房间');
  await p2.waitForTimeout(2500);
  await p1.waitForTimeout(1500);

  // ── 开始游戏 → 看牌 ──
  await p1.click('text=开始游戏');
  await p1.waitForTimeout(2500);
  await p2.waitForTimeout(2500);
  await p1.click('button:has-text("看牌")');
  await p1.waitForTimeout(1200);
  await p2.waitForTimeout(1200);

  // ── 聚光灯：固定先手 = 座位1（P2）──
  await p1.click('text=启动聚光灯');
  await p1.waitForTimeout(400);
  await p1.evaluate(() => { S.spin.seat = 1; hostStopSpin(); });
  await p1.waitForTimeout(800);
  await p2.waitForTimeout(800);
  const firstSeat = await p1.evaluate(() => S.firstSeat);
  if (firstSeat !== 1) throw new Error('先手应为 P2(座位1), 实际 ' + firstSeat);

  const playTurn = async (page, name) => {
    const card = page.locator('.hand-row .card').first();
    const n = await card.count();
    if (!n) { console.log(name, '无手牌'); return; }
    const cb = await card.boundingBox();
    const seg = page.locator('.seg').nth(0);
    const sb = await seg.boundingBox();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 15 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForSelector('#playSheet.show', { timeout: 5000 });
    await page.click('text=确认放置');
    await page.waitForTimeout(1000);
    console.log(name, '出牌完成');
  };

  // 手1：P2（先手）出牌 → 轮到 P1
  await playTurn(p2, 'P2(手1)');
  await p1.waitForTimeout(1500);
  // 手2：P1 出牌 → 轮到 P2
  await playTurn(p1, 'P1(手2)');
  await p2.waitForTimeout(1500);

  const before = await p1.evaluate(() => ({
    p2Hand: S.players[1].hand.length,
    placed: S.segments.reduce((a, s) => a + s.cards.length, 0),
    cur: S.currentSeat,
  }));
  console.log('刷新前 P1 视角:', JSON.stringify(before));
  if (before.placed !== 2 || before.cur !== 1) throw new Error('前置状态不对: ' + JSON.stringify(before));

  // ── P2 刷新页面（重连）──
  await p2.reload();
  await p2.waitForTimeout(4000);
  await p2.screenshot({ path: SHOTS + '/refresh-1-reconnect-p2.png' });
  const rec = await p2.evaluate(() => ({
    phase: S.phase,
    hand: S.players[1].hand.length,
    cur: S.currentSeat,
    seat: typeof window._olSeatIndex === 'function' ? window._olSeatIndex() : null,
    started: !!window._olGetStarted,
  }));
  console.log('P2 刷新后恢复:', JSON.stringify(rec));
  if (rec.seat !== 1 || rec.hand !== 5 || rec.cur !== 1) throw new Error('P2 重连恢复异常: ' + JSON.stringify(rec));

  // 手3：P2（刷新后）出牌 → 必须推送到 P1
  await playTurn(p2, 'P2(手3-刷新后)');
  await p1.waitForTimeout(2500);

  const after = await p1.evaluate(() => ({
    p2Hand: S.players[1].hand.length,
    placed: S.segments.reduce((a, s) => a + s.cards.length, 0),
    cur: S.currentSeat,
    lastBy: S.segments.reduce((a, s) => a + s.cards.length, 0) > 0
      ? [...S.segments].map(s => s.cards).flat().slice(-1)[0].by : null,
  }));
  console.log('刷新后 P2 出牌，P1 视角:', JSON.stringify(after));
  if (after.p2Hand !== 4 || after.placed !== 3 || after.lastBy !== 1) {
    throw new Error('P2 刷新后出牌未推送到 P1: ' + JSON.stringify(after));
  }
  await p1.screenshot({ path: SHOTS + '/refresh-2-after-push-p1.png' });

  console.log('刷新重连后推送: OK');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
