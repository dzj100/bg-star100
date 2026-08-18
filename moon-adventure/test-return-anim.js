/**
 * 返回基地逐格动画测试（单机 index.html）：
 * 1. 确认返回后 ghost 从当前位置逐格走回，动画期间不提交 returned
 * 2. ghost 最终落点 ≈ 动画后基地token的位置（不是瞬移）
 * 3. 动画期间结束回合被守卫拦截；落定后"下一位玩家"可用
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

  await page.evaluate(() => {
    dealGame(['A', 'B']);
    const p = S.players[0];
    p.role = { ...ROLES.find(r => r.id === 'veteran') };
    p.pos = 3;
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

  // ---- 1. 动画期间：ghost 存在、状态未提交、结束回合被拦截 ----
  step('1. return animation in progress');
  // 期望落点 = 动画开始时 baseSlotPos 计算的槽位中心（ghost 27px，center = left+13.5）；
  // 必须在动画期间（布局未变）捕获，提交后的布局会随骰子区高度变化而移动
  const expected = await page.evaluate(() => {
    confirmReturnBase();
    const board = document.querySelector('.path-board');
    const br = board.getBoundingClientRect();
    const { bl, bt } = baseSlotPos();
    return {
      l: br.left + parseFloat(bl) / 100 * br.width - 21 + 13.5,
      t: br.top + parseFloat(bt) / 100 * br.height - 10 + 13.5,
    };
  });
  await page.waitForSelector('.token-ghost', { timeout: 1000 });
  const mid = await page.evaluate(() => {
    endTurn();
    return {
      ghost: !!document.querySelector('.token-ghost'),
      pos: S.players[0].pos,
      returned: S.players[0].returned,
      cp: S.currentPlayer,
      anim: document.body.classList.contains('anim-moving'),
      steps: !!S._returnSteps,
      ghostLeft: document.querySelector('.token-ghost').getBoundingClientRect().left,
      ghostTop: document.querySelector('.token-ghost').getBoundingClientRect().top,
    };
  });
  ok('ghost visible during return anim', mid.ghost);
  ok('pos unchanged during anim', mid.pos === 3);
  ok('returned not committed during anim', !mid.returned);
  ok('endTurn blocked during anim', mid.cp === 0);
  ok('anim-moving class active', mid.anim);
  ok('_returnSteps pending', mid.steps === true);

  // ---- 2. 采样 ghost 轨迹：应从 tiles 走到基地区域 ----
  step('2. ghost walks to base area');
  const trail = await page.evaluate(() => new Promise(resolve => {
    const pts = [];
    const iv = setInterval(() => {
      const g = document.querySelector('.token-ghost');
      if (g) {
        const r = g.getBoundingClientRect();
        pts.push({ l: r.left + r.width / 2, t: r.top + r.height / 2 });
      }
    }, 40);
    setTimeout(() => { clearInterval(iv); resolve(pts); }, 2500);
  }));
  ok('ghost trail sampled', trail.length > 3);
  const last = trail[trail.length - 1];
  const dist = last ? Math.hypot(last.l - expected.l, last.t - expected.t) : Infinity;
  ok(`ghost final hop lands on base slot (dist=${dist.toFixed(0)}px < 25px)`, dist < 25);
  // 轨迹应覆盖多个位置（逐格移动而非单次瞬移）
  const spread = Math.hypot(trail[0].l - last.l, trail[0].t - last.t);
  ok(`ghost actually traveled (${spread.toFixed(0)}px)`, spread > 60);

  // ---- 3. 落定后：状态提交、下一位玩家可点击 ----
  step('3. after settle');
  const after = await page.evaluate(() => ({
    pos: S.players[0].pos,
    returned: S.players[0].returned,
    ap: S.ap,
    anim: document.body.classList.contains('anim-moving'),
  }));
  ok('returned committed after anim', after.returned && after.pos === -1);
  ok('AP deducted (5-1)', after.ap === 4);
  ok('anim class cleared', !after.anim);
  await page.evaluate(() => endTurn());
  const cp2 = await page.evaluate(() => S.currentPlayer);
  ok('next player reachable after anim', cp2 === 1);

  // ---- 4. 跳过被占格：玩家B站在路径1，返回时ghost应跳过该格 ----
  step('4. walk-back skips occupied tiles');
  await page.evaluate(() => {
    dealGame(['A', 'B']);
    const p = S.players[0];
    p.role = { ...ROLES.find(r => r.id === 'veteran') };
    p.pos = 3;
    p.returned = false;
    S.players[1].pos = 1;
    S.players[1].returned = false;
    S.ap = 5;
    S.turnPhase = 'spent';
    S.dice = [5];
    S.diceTotal = 5;
    moveMode = null;
    render();
  });
  const stepsVal = await page.evaluate(() => {
    confirmReturnBase();
    return JSON.parse(JSON.stringify(S._returnSteps));
  });
  ok('return steps skip occupied tile 1', JSON.stringify(stepsVal) === JSON.stringify([3, 2, 0, -1]));
  await page.waitForFunction(() => !S._returnSteps && !document.querySelector('.token-ghost'), null, { timeout: 5000 });

  if (errors.length) {
    console.log('PAGE ERRORS:', errors.join(' | '));
    process.exitCode = 1;
  } else {
    console.log('ALL CHECKS PASSED');
  }
  await browser.close();
})();
