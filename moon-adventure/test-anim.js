/**
 * 动效系统测试（单机 index.html）：
 * 1. 移动：token FLIP（.flipping 出现并归位）+ AP飘字 "-1 AP"
 * 2. 拾取：板块 collect-flash + 飘字 "📦 回收" + 槽位 chip-pop
 * 3. 磁暴：OGS die-anim 闪烁，弹窗延迟700ms出现
 * 4. 无状态变化时不播动画（防误触发）
 * 5. 丢弃后建立OGS不会误触发"📦 回收"飘字
 */
const { chromium } = require('playwright');

const URL = 'http://localhost:8123/index.html';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

  const step = m => console.log('STEP:', m);
  const ok = (name, cond) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`);
    if (!cond) process.exitCode = 1;
  };

  await page.goto(URL);
  await page.waitForFunction(() => typeof dealGame === 'function');

  // 重置到可控状态：p0=老兵 站在路径0，AP5
  const setup = () => page.evaluate(() => {
    dealGame(['A', 'B']);
    const p = S.players[0];
    p.role = { ...ROLES.find(r => r.id === 'veteran') };
    p.pos = 0;
    p.onRover = false;
    p.returned = false;
    S.ap = 5;
    S.turnPhase = 'spent';
    S.dice = [5];
    S.diceTotal = 5;
    S.accelMarks = [];
    moveMode = null;
    render();
  });

  // ---- 1. 移动：逐格 ghost + AP 飘字 ----
  step('1. move: ghost token + AP float');
  await setup();
  await page.evaluate(() => moveStep('forward'));
  // AP飘字立即出现（AP在首次渲染时已扣除）
  await page.waitForSelector('.float-text', { timeout: 1000 });
  const floatTexts = await page.evaluate(() =>
    [...document.querySelectorAll('.float-text')].map(e => e.textContent));
  ok('AP float text shows "-1 AP"', floatTexts.includes('-1 AP'));
  // ghost token 出现在路径上，原始token隐藏
  await page.waitForSelector('.token-ghost', { timeout: 1000 });
  ok('ghost token appears during animation', true);
  const origHidden = await page.evaluate(() => {
    const el = document.querySelector('#app [data-pid="0"]');
    return el ? el.style.display === 'none' : false;
  });
  ok('original token hidden during animation', origHidden);
  // ghost token 有正确的翻转（steps[0]=0, row=0, 偶数行 scaleX(-1)）
  const ghostFlip = await page.evaluate(() => {
    const g = document.querySelector('.token-ghost');
    return g ? g.style.transform : null;
  });
  ok('ghost token has scaleX(-1) on even row', ghostFlip === 'scaleX(-1)');
  // 等待动画完成（约 steps * 360ms）
  await page.waitForTimeout(1200);
  // ghost token 应已移除
  const ghostGone = await page.evaluate(() => !document.querySelector('.token-ghost'));
  ok('ghost token removed after animation', ghostGone);
  // 位置已更新，原始token恢复显示
  const posAfter = await page.evaluate(() => S.players[0].pos);
  ok('player moved to position 1', posAfter === 1);
  ok('AP decreased to 4', await page.evaluate(() => S.ap) === 4);

  // ---- 2. 拾取：板块闪光 + 槽位pop ----
  step('2. collect: tile flash + chip pop');
  await setup();
  await page.evaluate(() => {
    // 玩家站在路径0（tile0上），拾取相邻的tile1
    const tileIdx = S.path[1].tileIdx;
    collectSupply(tileIdx);
  });
  await page.waitForSelector('.tile[data-tileidx="1"].collect-flash', { timeout: 1000 });
  ok('tile has .collect-flash', true);
  const collectFloats = await page.evaluate(() =>
    [...document.querySelectorAll('.float-text')].map(e => e.textContent));
  ok('collect float text shows "📦 回收"', collectFloats.includes('📦 回收'));
  const chipPop = await page.evaluate(() =>
    !!document.querySelector('.player-strip .ps-slot.slot-pop'));
  ok('new supply slot has .slot-pop', chipPop);
  ok('AP decreased by 2 (veteran)', await page.evaluate(() => S.ap) === 3);

  // ---- 3. 磁暴：OGS闪烁 + 延迟弹窗 ----
  step('3. storm: OGS die-anim + delayed modal');
  await setup();
  await page.evaluate(() => {
    // 初始路径无OGS（游戏内建立）：先插入活跃OGS并让玩家站上去（模拟已建立的OGS）
    const p = S.players[0];
    S.path.splice(1, 0, { type: 'ogs', active: true });
    shiftPositions(1, 1);
    p.pos = 1;
    render();
  });
  await page.evaluate(() => {
    S.drawPile = [{ type: 'storm' }];
    S.drawnThisTurn = [];
    S.isDrawing = true;
    drawFromOGS();
  });
  await page.waitForSelector('.ogs-chip.die-anim', { timeout: 1000 });
  ok('OGS chip has .die-anim', true);
  const modalHiddenEarly = await page.evaluate(() =>
    !document.getElementById('stormModal').classList.contains('show'));
  ok('storm modal NOT shown immediately', modalHiddenEarly);
  await page.waitForTimeout(900);
  const modalShown = await page.evaluate(() =>
    document.getElementById('stormModal').classList.contains('show'));
  ok('storm modal shown after delay', modalShown);
  const chipDead = await page.evaluate(() => {
    const idx = S.path.findIndex(el => el.type === 'ogs');
    const chip = document.querySelector(`.ogs-chip[data-ogspos="${idx}"]`);
    return chip ? chip.classList.contains('dead') : false;
  });
  ok('OGS chip rendered as dead', chipDead);

  // ---- 4. 无变化渲染不播动画 ----
  step('4. no-op render plays nothing');
  await setup();
  await page.waitForFunction(() =>
    document.querySelectorAll('.token-anim.flipping').length === 0, null, { timeout: 2000 });
  await page.evaluate(() => render());
  await page.waitForTimeout(200);
  const noOp = await page.evaluate(() => ({
    floats: document.querySelectorAll('.float-text').length,
    flipping: document.querySelectorAll('.token-anim.flipping').length,
    flashes: document.querySelectorAll('.collect-flash').length,
  }));
  ok('no float text on no-op render', noOp.floats === 0);
  ok('no flip on no-op render', noOp.flipping === 0);
  ok('no collect flash on no-op render', noOp.flashes === 0);

  console.log('JS errors:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
  console.log(process.exitCode ? 'HAS FAILURES' : 'ALL PASS');

  // ================================================
  // 5. Bug验证：丢弃后建立OGS不应出现"📦 回收"飘字
  // ================================================
  {
    const browser2 = await chromium.launch({ headless: true });
    const page2 = await browser2.newPage();
    page2.on('pageerror', e => console.error('pageerror:', e.message));
    await page2.goto(URL);
    await page2.waitForFunction(() => typeof dealGame === 'function');

    step('5. discard -> OGS build should NOT show 回收 float');
    await page2.evaluate(() => {
      dealGame(['A', 'B']);
      const p = S.players[0];
      p.role = { ...ROLES.find(r => r.id === 'veteran') };
      p.pos = 0;
      p.onRover = false;
      p.returned = false;
      S.ap = 5;
      S.turnPhase = 'spent';
      S.dice = [5];
      S.diceTotal = 5;
      S.accelMarks = [];
      moveMode = null;
      render();
    });

    // 给玩家一个物资以便丢弃
    await page2.evaluate(() => {
      const p = S.players[0];
      if (p.supplies.length === 0) {
        p.supplies.push({ uid: nextUid(), zone: 0, intact: true });
      }
    });

    // 丢弃物资到路径位置1
    await page2.evaluate(() => discardSupply(0, 1));
    await page2.waitForTimeout(200);

    // 确保丢弃后没有"📦 回收"飘字，也没有AP飘字
    const floatsAfterDiscard = await page2.evaluate(() =>
      [...document.querySelectorAll('.float-text')].map(e => e.textContent));
    const hasRecycleAfterDiscard = floatsAfterDiscard.some(t => t.includes('回收'));
    ok('no 回收 float after discard', !hasRecycleAfterDiscard);
    const hasAPAfterDiscard = floatsAfterDiscard.some(t => t.includes('AP'));
    ok('no AP float after discard', !hasAPAfterDiscard);

    // 现在建立OGS在路径位置0
    await page2.evaluate(() => {
      // 重置AP足够
      S.ap = 5;
      placeOGS(0);
    });
    await page2.waitForTimeout(400);

    // 检查OGS建立后是否有"📦 回收"飘字
    const floatsAfterOGS = await page2.evaluate(() =>
      [...document.querySelectorAll('.float-text')].map(e => e.textContent));
    const hasRecycleAfterOGS = floatsAfterOGS.some(t => t.includes('回收'));
    ok('no 回收 float after OGS build (bug #4)', !hasRecycleAfterOGS);

    // 验证OGS确实建立了
    const ogsExists = await page2.evaluate(() =>
      S.path.some(el => el.type === 'ogs'));
    ok('OGS was actually built', ogsExists);

    await browser2.close();
  }

  // ================================================
  // 6. Bug验证：回收丢弃物资后建立OGS不会误触发"📦 回收"飘字
  // ================================================
  {
    const browser3 = await chromium.launch({ headless: true });
    const page3 = await browser3.newPage();
    page3.on('pageerror', e => console.error('pageerror:', e.message));
    await page3.goto(URL);
    await page3.waitForFunction(() => typeof dealGame === 'function');

    step('6. collect discard -> OGS build should NOT show 回收 float');
    await page3.evaluate(() => {
      dealGame(['A', 'B']);
      const p = S.players[0];
      p.role = { ...ROLES.find(r => r.id === 'veteran') };
      p.pos = 0;
      p.onRover = false;
      p.returned = false;
      S.ap = 5;
      S.turnPhase = 'spent';
      S.accelMarks = [];
      moveMode = null;
      render();
    });

    // 给玩家一个物资，丢弃到路径位置1
    await page3.evaluate(() => {
      const p = S.players[0];
      if (p.supplies.length === 0) {
        p.supplies.push({ uid: nextUid(), zone: 0, intact: true });
      }
    });
    await page3.evaluate(() => discardSupply(0, 1));
    await page3.waitForTimeout(200);

    // 拾取该丢弃物资（回收）
    await page3.evaluate(() => {
      const pathIdx = S.path.findIndex(el => el.type === 'discarded');
      if (pathIdx >= 0) {
        S.ap = 5; // 保证有AP
        collectDiscardedSupply(pathIdx);
      }
    });
    // 等回收飘字消失（950ms）后再建OGS
    await page3.waitForTimeout(1100);

    // 此时丢弃物资已被拾取（picked=true），在刚拾取的位置建立OGS
    await page3.evaluate(() => {
      S.ap = 5;
      placeOGS(0);
    });
    await page3.waitForTimeout(400);

    // 检查是否有"📦 回收"飘字（应仅来自本次OGS建立，不应有）
    const floats = await page3.evaluate(() =>
      [...document.querySelectorAll('.float-text')].map(e => e.textContent));
    const hasRecycle = floats.some(t => t.includes('回收'));
    ok('no 回收 float after collect-discard then OGS build', !hasRecycle);

    await browser3.close();
  }

  // ================================================
  // 7. 联机观战端：收到带_moveSteps的状态→播逐格动画；收到最终状态→抑制FLIP
  // ================================================
  {
    const browser4 = await chromium.launch({ headless: true });
    const page4 = await browser4.newPage();
    page4.on('pageerror', e => console.error('pageerror:', e.message));
    await page4.goto(URL);
    await page4.waitForFunction(() => typeof dealGame === 'function');

    step('7. observer: steps sync + FLIP suppressed');
    await page4.evaluate(() => {
      dealGame(['A', 'B']);
      const p = S.players[0];
      p.role = { ...ROLES.find(r => r.id === 'veteran') };
      p.pos = 0;
      p.onRover = false;
      p.returned = false;
      S.ap = 5;
      S.turnPhase = 'spent';
      S.dice = [5];
      S.diceTotal = 5;
      S.accelMarks = [];
      moveMode = null;
      render();
      // 模拟观战端：非当前玩家（不执行行动提交）
      window._olIsActor = () => false;
    });

    // 收到状态A：AP已扣、pos未变、携带_moveSteps
    await page4.evaluate(() => {
      S.ap = 4;
      S._moveSteps = [0, 1, 2];
      render();
    });
    await page4.waitForSelector('.token-ghost', { timeout: 1000 });
    ok('observer: ghost appears after receiving state A', true);
    const obsHidden = await page4.evaluate(() => {
      const el = document.querySelector('#app [data-pid="0"]');
      return el ? el.style.display === 'none' : false;
    });
    ok('observer: original token hidden during anim', obsHidden);

    // 收到状态B：位置已提交、_moveSteps已清 → 应抑制FLIP、动画继续
    await page4.evaluate(() => {
      S.players[0].pos = 2;
      delete S._moveSteps;
      render();
    });
    await page4.waitForTimeout(100);
    const obsNoFlip = await page4.evaluate(() =>
      document.querySelectorAll('.token-anim.flipping').length === 0);
    ok('observer: FLIP suppressed on final state', obsNoFlip);
    const obsStillHidden = await page4.evaluate(() => {
      const el = document.querySelector('#app [data-pid="0"]');
      return el ? el.style.display === 'none' : false;
    });
    ok('observer: token stays hidden while anim continues', obsStillHidden);

    // 等动画完成：ghost移除、token可见在目标位、位置未被重复提交
    await page4.waitForTimeout(900);
    const obsGhostGone = await page4.evaluate(() => !document.querySelector('.token-ghost'));
    ok('observer: ghost removed after anim', obsGhostGone);
    const obsPos = await page4.evaluate(() => S.players[0].pos);
    ok('observer: pos stays at target', obsPos === 2);
    const obsVisible = await page4.evaluate(() => {
      const el = document.querySelector('#app [data-pid="0"]');
      return el ? el.style.display !== 'none' : false;
    });
    ok('observer: token visible again after anim', obsVisible);

    await browser4.close();
  }

  // ================================================
  // 8. 从基地出发：ghost 降落到第一格，再逐格走到目标（不闪现、不飞入）
  // ================================================
  {
    const browser5 = await chromium.launch({ headless: true });
    const page5 = await browser5.newPage();
    page5.on('pageerror', e => console.error('pageerror:', e.message));
    await page5.goto(URL);
    await page5.waitForFunction(() => typeof dealGame === 'function');

    step('8. base departure: ghost lands on first tile then walks');
    await page5.evaluate(() => {
      dealGame(['A', 'B']);
      const p = S.players[0];
      p.role = { ...ROLES.find(r => r.id === 'veteran') };
      p.pos = -1; // 在基地
      p.onRover = false;
      p.returned = false;
      S.ap = 10;
      S.turnPhase = 'spent';
      S.dice = [5];
      S.diceTotal = 5;
      S.accelMarks = [];
      moveMode = null;
      render();
    });

    // 模拟移动模式点击可达格2（从基地出发）
    await page5.evaluate(() => {
      moveMode = getMoveReach(-1);
      onMoveTargetClick(2);
    });
    await page5.waitForSelector('.token-ghost', { timeout: 1000 });
    ok('base departure: ghost appears', true);
    // 立即检查：ghost 中心在棋盘内（非屏幕外飞入）+ 基地token隐藏
    const early = await page5.evaluate(() => {
      const g = document.querySelector('.token-ghost');
      const board = document.querySelector('.path-board');
      if (!g || !board) return { inBoard: false, baseHidden: false };
      const gr = g.getBoundingClientRect();
      const br = board.getBoundingClientRect();
      const cx = gr.left + gr.width / 2, cy = gr.top + gr.height / 2;
      const inBoard = cx >= br.left && cx <= br.right && cy >= br.top && cy <= br.bottom;
      const base = document.querySelector('.base-token[data-pid="0"]');
      return { inBoard, baseHidden: base ? base.style.display === 'none' : false };
    });
    ok('base departure: ghost inside board (no fly-in)', early.inBoard);
    ok('base departure: base token hidden during anim', early.baseHidden);
    // 逐格移动：动态计算各格中心x，轮询验证 ghost 依次到达位置1、位置2
    const ghostMovedTo = n => page5.evaluate(n => {
      const board = document.querySelector('.path-board');
      const br = board.getBoundingClientRect();
      const { x } = tilePos(n);
      return br.left + x / 100 * br.width - 7.5; // ghost 中心x（left偏移-21px+半宽13.5px）
    }, n).then(t => page5.waitForFunction(threshold => {
      const g = document.querySelector('.token-ghost');
      if (!g) return false;
      return g.getBoundingClientRect().left > threshold;
    }, t, { timeout: 900 }).then(() => true).catch(() => false));
    const moved = (await ghostMovedTo(1)) && (await ghostMovedTo(2));
    ok('base departure: ghost moves step by step', moved);
    // 等动画完成：位置更新、ghost移除、token恢复
    await page5.waitForTimeout(1200);
    const posAfter = await page5.evaluate(() => S.players[0].pos);
    ok('base departure: player ended at position 2', posAfter === 2);
    const ghostGone = await page5.evaluate(() => !document.querySelector('.token-ghost'));
    ok('base departure: ghost removed', ghostGone);

    await browser5.close();
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
