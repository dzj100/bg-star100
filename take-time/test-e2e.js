/**
 * 时序谜局 端到端测试（Playwright）
 * 覆盖：着陆页 → 创建房间 → 加入房间 → 开始游戏 → 看牌 → 聚光灯 → 出牌 → 结算
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
  p1.on('console', m => console.log('[P1]', m.type(), m.text().slice(0, 200)));
  p1.on('requestfailed', r => console.log('[P1 requestfailed]', r.url().slice(0, 120), r.failure() && r.failure().errorText));

  await p1.goto(BASE);
  await p1.waitForSelector('text=联机模式', { timeout: 20000 });
  await p1.waitForTimeout(500);
  await p1.screenshot({ path: SHOTS + '/e2e-1-landing.png' });

  // 首页规则弹层
  await p1.click('button:has-text("规则")');
  await p1.waitForSelector('#modalOverlay.show', { timeout: 5000 });
  console.log('规则弹层打开: OK');
  await p1.click('button:has-text("知道了")');
  await p1.waitForTimeout(300);

  await p1.click('text=联机模式');
  await p1.waitForTimeout(500);
  await p1.screenshot({ path: SHOTS + '/e2e-2-online-lobby.png' });

  await p1.click('text=创建房间');
  await p1.waitForTimeout(2000);
  await p1.screenshot({ path: SHOTS + '/e2e-3-waiting.png' });
  const roomTitle = await p1.textContent('.setup-header h1');
  const code = roomTitle.match(/\d{4}/)[0];
  console.log('房间号:', code);

  // ── 第二名玩家 ──
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => console.log('[P2 error]', e.message));
  p2.on('console', m => console.log('[P2]', m.type(), m.text().slice(0, 200)));
  p2.on('requestfailed', r => console.log('[P2 requestfailed]', r.url().slice(0, 120), r.failure() && r.failure().errorText));
  await p2.goto(BASE);
  await p2.waitForSelector('text=联机模式', { timeout: 20000 });
  await p2.waitForTimeout(300);
  await p2.click('text=联机模式');
  await p2.fill('#joinRoomInput', code);
  await p2.fill('#joinNameInput', '小明');
  await p2.click('text=加入房间');
  await p2.waitForTimeout(2500);
  await p1.waitForTimeout(1500);
  await p1.screenshot({ path: SHOTS + '/e2e-4-waiting-2p.png' });
  await p2.screenshot({ path: SHOTS + '/e2e-5-waiting-2p-p2.png' });

  // ── 开始游戏（房主）──
  await p1.click('text=开始游戏');
  await p1.waitForTimeout(2500);
  await p2.waitForTimeout(2500);
  await p1.screenshot({ path: SHOTS + '/e2e-6-discuss-host.png' });
  await p2.screenshot({ path: SHOTS + '/e2e-7-discuss-p2.png' });

  // ── 游戏页头部布局：标题在左，退出+规则在右 ──
  const p1Header = await p1.evaluate(() => {
    const h = document.querySelector('.game-header');
    const t = h.querySelector('.header-title').getBoundingClientRect();
    const b = h.querySelector('.header-btns').getBoundingClientRect();
    return {
      buttons: [...h.querySelectorAll('.header-btns button')].map(x => x.textContent.trim()),
      titleLeft: Math.round(t.left),
      btnsRight: Math.round(b.right),
    };
  });
  console.log('P1 头部:', JSON.stringify(p1Header));
  if (p1Header.titleLeft > p1Header.btnsRight) throw new Error('头部布局错误：标题应在左、按钮应在右');
  if (!p1Header.buttons.some(x => x.includes('退出')) || !p1Header.buttons.some(x => x.includes('规则'))) {
    throw new Error('头部按钮缺失: ' + JSON.stringify(p1Header.buttons));
  }

  // ── 看牌 ──
  await p1.click('button:has-text("看牌")');
  await p1.waitForTimeout(1200);
  await p2.waitForTimeout(1200);
  await p1.screenshot({ path: SHOTS + '/e2e-8-reveal-host.png' });
  await p2.screenshot({ path: SHOTS + '/e2e-9-reveal-p2.png' });

  // 2人局特殊规则：看牌仅展示前4张，后2张为背面（背面牌带 sun/moon 类，需排除 .back）
  const p2Vis = await p2.evaluate(() => document.querySelectorAll('.hand-row .card.sun:not(.back), .hand-row .card.moon:not(.back)').length);
  const p2Backs = await p2.evaluate(() => document.querySelectorAll('.hand-row .card.back').length);
  console.log('P2 看牌后可见手牌:', p2Vis, '背面:', p2Backs);
  if (p2Vis !== 4 || p2Backs !== 2) throw new Error(`2人局锁定异常: 可见${p2Vis} 背面${p2Backs}`);

  // 禁止交流提示
  const forbidText = await p2.evaluate(() => document.body.textContent.includes('禁止交流'));
  console.log('P2 禁止交流提示:', forbidText);
  if (!forbidText) throw new Error('看牌后缺少禁止交流提示');

  // ── 聚光灯（房主启动，等自动停止）──
  await p1.click('text=启动聚光灯');
  await p1.waitForTimeout(350);
  await p1.screenshot({ path: SHOTS + '/e2e-10-spin.png' });
  // 等待 3 圈自动停止（2人局 170ms*6 tick ≈ 1s，多等留余量）
  await p1.waitForTimeout(4000);
  await p1.screenshot({ path: SHOTS + '/e2e-11-play-host.png' });
  await p2.waitForTimeout(4000);
  await p2.screenshot({ path: SHOTS + '/e2e-12-play-p2.png' });

  // 出牌：谁先手谁操作；先手由聚光灯随机。通过截图判断，让先手玩家出牌。
  // 简化：两个页面都尝试——只有当前回合玩家能操作。
  const cur1 = await p1.evaluate(() => {
    const chips = [...document.querySelectorAll('.p-chip')];
    const active = chips.findIndex(c => c.classList.contains('active'));
    return active;
  });
  console.log('当前回合座位(房主视角):', cur1);

  const playTurn = async (page, name) => {
    // 点第一张手牌
    const card = page.locator('.card.sun, .card.moon').first();
    const n = await card.count();
    if (!n) { console.log(name, '无手牌'); return; }
    await card.click();
    await page.waitForTimeout(400);
    // 选择扇区1
    await page.locator('.seg-btn').nth(0).click();
    await page.waitForTimeout(300);
    // 确认放置
    await page.click('text=确认放置');
    await page.waitForTimeout(900);
    console.log(name, '出了一张牌');
  };

  // 先手玩家出牌（active chip 所在页）
  const me1 = await p1.evaluate(() => window._olSeatIndex && window._olSeatIndex());
  if (cur1 === me1) {
    await playTurn(p1, '房主');
  } else {
    await playTurn(p2, '小明');
  }
  await p1.waitForTimeout(1000);
  await p2.waitForTimeout(1000);
  await p1.screenshot({ path: SHOTS + '/e2e-13-after-1card.png' });

  // 轮流把剩余手牌打完（最多 11 次：2人局共12张）
  for (let i = 0; i < 11; i++) {
    const isP1Turn = await p1.evaluate(() => {
      const s = window._getOnlineState();
      return s && s.phase === 'play' && !s.allPlaced && s.currentSeat === window._olSeatIndex();
    });
    if (!isP1Turn) {
      const isP2Turn = await p2.evaluate(() => {
        const s = window._getOnlineState();
        return s && s.phase === 'play' && !s.allPlaced && s.currentSeat === window._olSeatIndex();
      });
      if (!isP2Turn) break;
      await playTurn(p2, '小明');
    } else {
      await playTurn(p1, '房主');
    }
    // 双方各打出2张（共4张）后，后2张解锁
    if (i === 3) {
      await p2.waitForTimeout(600);
      const backsAfter4 = await p2.evaluate(() => document.querySelectorAll('.hand-row .card.back').length);
      const visAfter4 = await p2.evaluate(() => document.querySelectorAll('.hand-row .card.sun:not(.back), .hand-row .card.moon:not(.back)').length);
      console.log('P2 出4张后可见手牌:', visAfter4, '背面:', backsAfter4);
      if (backsAfter4 !== 0) throw new Error('双方各出2张后后2张未解锁');
    }
  }
  await p1.waitForTimeout(1200);
  await p2.waitForTimeout(1200);
  await p1.screenshot({ path: SHOTS + '/e2e-14-all-placed.png' });
  await p2.screenshot({ path: SHOTS + '/e2e-15-all-placed-p2.png' });

  // ── 结算（任意玩家：P2 结算，currentSeat 变为 P2）──
  await p2.click('button:has-text("翻开所有牌")');
  await p2.waitForTimeout(2000);
  await p1.waitForTimeout(2000);
  await p1.screenshot({ path: SHOTS + '/e2e-16-result-host.png' });
  await p2.screenshot({ path: SHOTS + '/e2e-17-result-p2.png' });

  // ── 再来一局（房主 P1，此时 currentSeat=P2，回归测试）──
  const curSeatAfterSettle = await p1.evaluate(() => {
    const s = window._getOnlineState();
    return { seat: s.currentSeat, hostSeat: window._olSeatIndex(), phase: s.phase };
  });
  console.log('结算后 currentSeat:', curSeatAfterSettle.seat, '房主座位:', curSeatAfterSettle.hostSeat);
  await p1.click('button:has-text("重试本关")');
  await p1.waitForTimeout(2500);
  await p2.waitForTimeout(2500);
  const restartP1 = await p1.evaluate(() => {
    const s = window._getOnlineState();
    return { phase: s.phase, hand: s.players[0].hand.length };
  });
  const restartP2 = await p2.evaluate(() => {
    const s = window._getOnlineState();
    return { phase: s.phase, hand: s.players[1].hand.length, eye: s.eyeBonus };
  });
  console.log('再来一局后 P1:', JSON.stringify(restartP1), 'P2:', JSON.stringify(restartP2));
  if (restartP1.phase !== 'discuss' || restartP2.phase !== 'discuss') throw new Error('再来一局未回到讨论阶段');
  if (restartP1.hand !== 6 || restartP2.hand !== 6) throw new Error('再来一局未重新发牌 6 张');
  if (restartP2.eye !== 1) throw new Error('再来一局未继承失败赠送的眼标记');
  await p1.screenshot({ path: SHOTS + '/e2e-18-restart-host.png' });
  await p2.screenshot({ path: SHOTS + '/e2e-19-restart-p2.png' });
  console.log('再来一局: OK');

  console.log('E2E 完成');
  await browser.close();
})().catch(e => { console.error('E2E FAIL:', e); process.exit(1); });
