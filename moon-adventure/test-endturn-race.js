/**
 * 回归测试：移格动画播放中禁止结束回合（endTurn 守卫 + 按钮禁用）
 * 复现原bug：动画中点击结束回合 → 回合交接给下一名玩家 → 动画结束提交位置时移动者错位
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

  // ---- 1. 动画播放中：endTurn 被守卫拦截 ----
  step('1. endTurn blocked during move animation');
  await setup();
  await page.evaluate(() => moveStep('forward'));
  // 动画进行中：ghost 存在
  await page.waitForSelector('.token-ghost', { timeout: 1000 });
  const animating = await page.evaluate(() => document.body.classList.contains('anim-moving'));
  ok('body has .anim-moving during animation', animating);
  // 结束回合按钮被禁用（pointer-events: none）
  const btnDisabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.act-btn.btn-end')].find(b => b.textContent.includes('结束回合'));
    return btn ? getComputedStyle(btn).pointerEvents === 'none' : false;
  });
  ok('end-turn button pointer-events none during animation', btnDisabled);
  // 直接调用 endTurn（模拟点击）：回合不得交接、AP不得被清空（移动已扣1AP → 应为4）
  const race = await page.evaluate(() => {
    endTurn();
    return { cp: S.currentPlayer, ap: S.ap, steps: !!S._moveSteps };
  });
  ok('currentPlayer unchanged after endTurn during animation', race.cp === 0);
  ok('AP not zeroed by endTurn during animation', race.ap === 4);
  ok('move steps still pending', race.steps === true);
  // 确认弹窗不应打开
  const modalOpen = await page.evaluate(() =>
    document.getElementById('endTurnConfirmModal').classList.contains('show'));
  ok('end-turn confirm modal not opened', !modalOpen);

  // ---- 2. 动画结束后：位置正确提交，且 endTurn 恢复正常 ----
  step('2. position committed & endTurn works after animation');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({
    pos: S.players[0].pos,
    cp: S.currentPlayer,
    ghost: !!document.querySelector('.token-ghost'),
    animClass: document.body.classList.contains('anim-moving'),
  }));
  ok('player moved to position 1', after.pos === 1);
  ok('currentPlayer still 0', after.cp === 0);
  ok('ghost removed', !after.ghost);
  ok('anim-moving class removed', !after.animClass);
  const btnEnabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.act-btn.btn-end')].find(b => b.textContent.includes('结束回合'));
    return btn ? getComputedStyle(btn).pointerEvents !== 'none' : false;
  });
  ok('end-turn button enabled after animation', btnEnabled);
  // 此时结束回合正常：确认弹窗打开 → 确认 → 轮到玩家B
  await page.evaluate(() => endTurn());
  const modalOpen2 = await page.evaluate(() =>
    document.getElementById('endTurnConfirmModal').classList.contains('show'));
  ok('end-turn confirm modal opens after animation', modalOpen2);
  await page.evaluate(() => confirmEndTurn());
  const cp2 = await page.evaluate(() => S.currentPlayer);
  ok('turn passed to next player after confirm', cp2 === 1);

  // ---- 3. 下一位玩家按钮（已返回基地）同样被守卫 ----
  step('3. "next player" button guarded for returned player');
  await setup();
  await page.evaluate(() => {
    S.players[0].returned = true;
    render();
  });
  await page.evaluate(() => moveStep('forward'));
  await page.waitForSelector('.token-ghost', { timeout: 1000 });
  const race2 = await page.evaluate(() => {
    endTurn();
    return { cp: S.currentPlayer };
  });
  ok('returned-player endTurn also blocked during animation', race2.cp === 0);
  await page.waitForTimeout(800);
  const after2 = await page.evaluate(() => ({ pos: S.players[0].pos, cp: S.currentPlayer }));
  ok('turn not passed (returned case)', after2.cp === 0);
  await page.evaluate(() => endTurn());
  const cp3 = await page.evaluate(() => S.currentPlayer);
  ok('next player reachable after animation', cp3 === 1);

  if (errors.length) {
    console.log('PAGE ERRORS:', errors.join(' | '));
    process.exitCode = 1;
  } else {
    console.log('ALL CHECKS PASSED');
  }
  await browser.close();
})();
