/**
 * 回归测试：前一玩家的 ghost 兜底清理定时器不得误删后一玩家的位移动画
 * 复现原bug：A 移动结束（3s 兜底定时器已安排）→ 立即结束回合 → B 开始长移动，
 * A 的旧定时器触发 _removeMoveGhost() 删掉了 B 正在播放的 ghost，动画中途中断。
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

  const waitMoveSettled = () => page.waitForFunction(
    () => !S._moveSteps && !S._returnSteps && !document.querySelector('.token-ghost'),
    null, { timeout: 8000 });

  step('1. A moves 1 tile & ends turn; stale A cleanup timer must not kill B ghost');
  await page.evaluate(() => {
    dealGame(['A', 'B']);
    const p = S.players[0];
    p.role = { ...ROLES.find(r => r.id === 'veteran') };
    p.pos = 1;
    p.onRover = false;
    p.returned = false;
    S.ap = 1;
    S.turnPhase = 'spent';
    S.dice = [1];
    S.diceTotal = 1;
    S.accelMarks = [];
    moveMode = null;
    render();
  });
  // A 移动 1 格（2 步动画约0.7s）
  await page.evaluate(() => executePlayerMove(2, 'forward'));
  await page.waitForSelector('.token-ghost', { timeout: 1000 });
  await waitMoveSettled();
  const aPos = await page.evaluate(() => S.players[0].pos);
  ok('A moved to position 2', aPos === 2);
  // 修复：A 提交后兜底定时器必须已清除（修复前此处仍 pending 3s）
  await page.waitForTimeout(200);
  const timerAfterA = await page.evaluate(() => _ghostCleanupTimer);
  ok('A cleanup timer cleared after commit', timerAfterA === null);
  // A 立即结束回合 → B 接棒
  await page.evaluate(() => { S.ap = 0; endTurn(); });
  const cp = await page.evaluate(() => S.currentPlayer);
  ok('turn passed to B', cp === 1);
  // 等待接近 A 的 3s 兜底窗口，让旧定时器（若未清除）在 B 动画中途触发
  await page.waitForTimeout(2200);
  // B 从 0 走 6 格（跳过 A 占的 2 号格，6 步动画约2.5s）
  await page.evaluate(() => {
    const p = S.players[1];
    p.pos = 0;
    p.onRover = false;
    p.returned = false;
    S.ap = 5;
    S.turnPhase = 'spent';
    S.dice = [5];
    S.diceTotal = 5;
    moveMode = null;
    executePlayerMove(6, 'forward');
  });
  await page.waitForSelector('.token-ghost', { timeout: 1000 });
  // 此刻已过 A 旧定时器触发点（settle+~3.3s）：断言 B 动画仍完好
  await page.waitForTimeout(1100);
  const mid = await page.evaluate(() => ({
    ghost: !!document.querySelector('.token-ghost'),
    anim: !!_moveAnim,
    animClass: document.body.classList.contains('anim-moving'),
  }));
  ok('B ghost still playing after A stale timer window', mid.ghost);
  ok('B move anim still active', mid.anim && mid.animClass);
  // 等 B 动画完成：位置提交、ghost 移除
  await waitMoveSettled();
  const bPos = await page.evaluate(() => S.players[1].pos);
  ok('B committed at position 6', bPos === 6);
  const ghostGone = await page.evaluate(() => !document.querySelector('.token-ghost'));
  ok('B ghost removed after settle', ghostGone);

  if (errors.length) {
    console.log('PAGE ERRORS:', errors.join(' | '));
    process.exitCode = 1;
  } else {
    console.log('ALL CHECKS PASSED');
  }
  await browser.close();
})();
