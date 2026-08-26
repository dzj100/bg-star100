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
    // 拖拽第一张手牌到区域1
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
    await page.waitForTimeout(400);
    // 确认抽屉弹层出现（拖拽松手后的确认放置）
    await page.waitForSelector('#playSheet.show', { timeout: 5000 });
    await page.click('text=确认放置');
    await page.waitForTimeout(900);
    console.log(name, '拖拽出了一张牌');
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
  const checkTurn = async (page) => {
    for (let t = 0; t < 10; t++) {
      const isTurn = await page.evaluate(() => {
        const s = window._getOnlineState();
        return s && s.phase === 'play' && !s.allPlaced && s.currentSeat === window._olSeatIndex();
      });
      if (isTurn) return true;
      await page.waitForTimeout(400); // Realtime 同步延迟容忍
    }
    return false;
  };
  for (let i = 0; i < 11; i++) {
    if (await checkTurn(p1)) {
      await playTurn(p1, '房主');
    } else if (await checkTurn(p2)) {
      await playTurn(p2, '小明');
    } else {
      break;
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

  // ── 结算（仅房主：P2 成员侧看不到按钮，P1 房主点击）──
  const settleBtnP2 = await p2.locator('button:has-text("翻开所有牌")').count();
  if (settleBtnP2 !== 0) throw new Error('成员侧仍显示结算按钮');
  const waitTextP2 = await p2.evaluate(() => document.querySelector('.action-box')?.textContent || '');
  if (!waitTextP2.includes('等待房主')) throw new Error('成员侧缺少「等待房主」提示');
  await p1.click('button:has-text("翻开所有牌")');
  await p1.waitForTimeout(2000);
  await p2.waitForTimeout(2000);
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

  // ── 成员退出 → 房主接管 → 代打（轮到离席玩家时房主操作其手牌）──
  await p1.click('button:has-text("看牌")');
  await p1.waitForTimeout(1200);
  await p2.waitForTimeout(1200);
  await p1.click('text=启动聚光灯');
  await p1.waitForTimeout(4500); // 3圈自动停止
  await p2.waitForTimeout(4500);

  // 当前先手出 1 张（此后 P2 退出）
  const cur1b = await p1.evaluate(() => {
    const chips = [...document.querySelectorAll('.p-chip')];
    return chips.findIndex(c => c.classList.contains('active'));
  });
  const me1b = await p1.evaluate(() => window._olSeatIndex());
  if (cur1b === me1b) {
    await playTurn(p1, '房主');
  } else {
    await playTurn(p2, '小明');
  }
  await p1.waitForTimeout(800);
  await p2.waitForTimeout(800);

  // P2 退出房间 → P1 收到「玩家离开」弹窗
  await p2.click('#exitRoomBtn');
  await p2.waitForTimeout(500);
  await p2.click('button:has-text("确认退出")');
  await p1.waitForTimeout(4000);
  await p2.waitForTimeout(1000);
  await p1.waitForSelector('#modalOverlay.show', { timeout: 15000 });
  await p1.screenshot({ path: SHOTS + '/e2e-20-depart-dialog.png' });
  await p1.click('button:has-text("接管操作")');
  await p1.waitForTimeout(1500);
  const depState = await p1.evaluate(() => {
    const s = window._getOnlineState();
    return { departed: s.departedPlayers || [], phase: s.phase, players: s.players.length };
  });
  console.log('接管后状态:', JSON.stringify(depState));
  if (depState.departed.indexOf(1) < 0) throw new Error('接管后 departedPlayers 未记录座位1');
  if (depState.phase !== 'play' || depState.players !== 2) throw new Error('接管后游戏状态异常');

  // 剩余手牌全部由 P1 打出（自己 + 代打小明），轮到离席玩家时验证接管 UI 与归属
  let takeoverSeen = false;
  const checkTurnHost = async (page) => {
    for (let t = 0; t < 12; t++) {
      const ok = await page.evaluate(() => {
        const s = window._getOnlineState();
        if (!s || s.phase !== 'play' || s.allPlaced) return false;
        const me = window._olSeatIndex();
        if (s.currentSeat === me) return true;
        return window._olIsHost() && (s.departedPlayers || []).includes(s.currentSeat);
      });
      if (ok) return true;
      await page.waitForTimeout(400);
    }
    return false;
  };
  for (let i = 0; i < 11 && (await checkTurnHost(p1)); i++) {
    const before = await p1.evaluate(() => {
      const s = window._getOnlineState();
      return s.players.map(p => p.hand.length);
    });
    const taking = await p1.evaluate(() => document.body.textContent.includes('接管 小明 的手牌'));
    if (taking) takeoverSeen = true;
    await playTurn(p1, taking ? '房主(代打小明)' : '房主');
    const after = await p1.evaluate(() => {
      const s = window._getOnlineState();
      return s.players.map(p => p.hand.length);
    });
    // 手牌差异判定哪一座位打出了牌
    let diff = -1;
    for (let k = 0; k < 2; k++) if (after[k] !== before[k]) diff = k;
    if (diff < 0) throw new Error('接管代打未消耗任何手牌');
    console.log('第', i + 1, '手 座位', diff, '打出，剩余:', JSON.stringify(after), taking ? '(接管)' : '');
    await p1.waitForTimeout(400);
  }
  if (!takeoverSeen) throw new Error('接管 UI（⚑ 接管 小明 的手牌）未出现');
  const finalState = await p1.evaluate(() => {
    const s = window._getOnlineState();
    return { allPlaced: s.allPlaced, hands: s.players.map(p => p.hand.length), bySeat1: s.segments.reduce((a, seg) => a + seg.cards.filter(c => c.by === 1).length, 0) };
  });
  console.log('代打完成后:', JSON.stringify(finalState));
  if (!finalState.allPlaced) throw new Error('接管代打未打完所有牌');
  if (finalState.bySeat1 <= 0) throw new Error('代打的牌未归属座位1');
  await p1.screenshot({ path: SHOTS + '/e2e-21-takeover-done.png' });
  console.log('接管代打: OK');

  console.log('E2E 完成');
  await browser.close();
})().catch(e => { console.error('E2E FAIL:', e); process.exit(1); });
