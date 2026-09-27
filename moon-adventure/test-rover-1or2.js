/**
 * 月球车1AP走1格或2格测试（单机 index.html）：
 * 1. 坐车后退：1格/2格目标成对出现，均1AP，超预算不渲染
 * 2. 点1格落点 → 只走1格花1AP
 * 3. 点2格落点 → 走2格花1AP
 * 4. 被玩家占用的格跳过（1格落点顺延）
 * 5. 加速标记跳过且不可停留
 * 6. 起点附近：pos2 → 1格(1AP)/0格(1AP)/返回基地(2AP)
 * 7. 登车流程回归：走到月球车弹确认，上车清AP
 * 8. 撤回1格月球车移动 → 位置与AP恢复
 */
const { chromium } = require('playwright');

const URL = 'http://localhost:8123/index.html';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

  const step = m => console.log('STEP:', m);
  const st = () => page.evaluate(() => ({
    pos: S.players[0].pos,
    ap: S.ap,
    onRover: S.players[0].onRover,
    roverUsed: S.roverUsed,
  }));
  const overlays = () => page.evaluate(() =>
    [...document.querySelectorAll('.move-target')].map(el => {
      const m = (el.getAttribute('onclick') || '').match(/\((-?\d+)\)/);
      return { pos: m ? +m[1] : null, cost: +(el.getAttribute('data-cost') || 0) };
    })
  );
  const clickOverlay = pos => page.evaluate(p =>
    [...document.querySelectorAll('.move-target')]
      .find(el => (el.getAttribute('onclick') || '').includes(`(${p})`)).click(), pos);
  const waitMoveSettled = () => page.waitForFunction(
    () => !S._moveSteps && !document.querySelector('.token-ghost'), null, { timeout: 5000 });

  const expectSet = (os, expect, label) => {
    const byPos = Object.fromEntries(os.filter(o => o.pos !== -1).map(o => [o.pos, o.cost]));
    console.log(label, JSON.stringify(byPos));
    for (const [pos, cost] of Object.entries(expect)) {
      if (byPos[pos] !== cost) throw new Error(`${label}: pos ${pos} must be ${cost}AP, got ${byPos[pos]}`);
    }
  };

  // 月球车状态：玩家A坐车，可选放置玩家B
  const setupRover = (riderPos, ap, blockerPos) => page.evaluate(({ riderPos, ap, blockerPos }) => {
    dealGame(['A', 'B']);
    S.roverUsed = true;
    const p = S.players[0];
    p.role.id = 'veteran';
    p.onRover = true;
    p.pos = riderPos;
    p.returned = false;
    const b = S.players[1];
    b.returned = blockerPos === null;
    b.pos = blockerPos === null ? -1 : blockerPos;
    S.ap = ap;
    S.turnPhase = 'spent';
    S.dice = [ap];
    S.diceTotal = ap;
    S.accelMarks = [];
    S.hasEngineer = false;
    S.robotPos = -1;
    moveMode = null;
    closeSheet();
    render();
  }, { riderPos, ap, blockerPos });

  await page.goto(URL);
  await page.waitForFunction(() => typeof dealGame === 'function');
  const moveBtn = page.locator('.action-btns button').filter({ hasText: '移动' });

  const roverPos = await page.evaluate(() => { dealGame(['A']); return tilePathIdx(S.roverPos); });
  console.log('roverPathPos:', roverPos);
  if (roverPos !== 21) throw new Error('rover path pos unexpected');

  step('1. 坐车后退：1格/2格目标成对出现，均1AP');
  await setupRover(roverPos, 3, null);
  await moveBtn.click();
  let os = await overlays();
  expectSet(os, { 20: 1, 19: 1, 18: 2, 17: 2, 16: 3, 15: 3 }, 'overlays A');
  if (os.some(o => o.cost > 3)) throw new Error('over-budget rendered');
  if (os.some(o => o.pos > roverPos)) throw new Error('unexpected forward target');

  step('2. 点1格落点 → 只走1格花1AP');
  await clickOverlay(20);
  await waitMoveSettled();
  let s = await st();
  console.log('after 1-cell move:', JSON.stringify(s));
  if (s.pos !== 20 || s.ap !== 2) throw new Error('1-cell move fail');

  step('3. 从20点18（2格）→ 花1AP走2格');
  await moveBtn.click();
  os = await overlays();
  expectSet(os, { 19: 1, 18: 1, 17: 2, 16: 2, 21: 1 }, 'overlays B');
  if (os.some(o => o.cost > 2)) throw new Error('over-budget rendered (B)');
  await clickOverlay(18);
  await waitMoveSettled();
  s = await st();
  console.log('after 2-cell move:', JSON.stringify(s));
  if (s.pos !== 18 || s.ap !== 1) throw new Error('2-cell move from 20 fail');

  step('4. 被玩家占用的格跳过（20被B占 → 1格落在19）');
  await setupRover(roverPos, 1, 20);
  await moveBtn.click();
  os = await overlays();
  expectSet(os, { 19: 1, 18: 1 }, 'overlays C(blocked)');
  if (os.some(o => o.pos === 20)) throw new Error('occupied cell must not be a target');
  await clickOverlay(19);
  await waitMoveSettled();
  s = await st();
  console.log('after skip-occupied move:', JSON.stringify(s));
  if (s.pos !== 19 || s.ap !== 0) throw new Error('skip blocked cell fail');

  step('5. 加速标记跳过且不可停留（20有标记 → 1格落在19）');
  await setupRover(roverPos, 1, null);
  await page.evaluate(() => { S.accelMarks = [20]; render(); });
  await moveBtn.click();
  os = await overlays();
  expectSet(os, { 19: 1, 18: 1 }, 'overlays D(accel)');
  if (os.some(o => o.pos === 20)) throw new Error('accel mark must not be a rover stop');

  step('6. 起点附近：pos2 → 1格(1)/0格(2)? 应为 1:1, 0:1, base:2');
  await setupRover(2, 2, null);
  await moveBtn.click();
  os = await overlays();
  expectSet(os, { 3: 1, 4: 1, 1: 1, 0: 1 }, 'overlays E');
  const baseCost = await page.evaluate(() =>
    +(document.querySelector('.move-target.move-base').getAttribute('data-cost') || 0));
  console.log('base cost from pos2:', baseCost);
  if (baseCost !== 2) throw new Error('base cost from pos2 must be 2AP');
  await clickOverlay(1);
  await waitMoveSettled();
  s = await st();
  console.log('after 1-cell move to pos1:', JSON.stringify(s));
  if (s.pos !== 1 || s.ap !== 1) throw new Error('1-cell stop near start fail');

  step('7. 登车流程回归：非坐车玩家走到月球车弹确认，上车清AP');
  await page.evaluate(() => {
    dealGame(['A']);
    const p = S.players[0];
    p.role.id = 'veteran';
    p.pos = 20;
    p.returned = false;
    p.onRover = false;
    S.roverUsed = false;
    S.ap = 2;
    S.turnPhase = 'spent';
    S.dice = [2];
    S.diceTotal = 2;
    S.accelMarks = [];
    S.hasEngineer = false;
    S.robotPos = -1;
    moveMode = null;
    closeSheet();
    render();
  });
  await moveBtn.click();
  os = await overlays();
  expectSet(os, { 21: 1 }, 'overlays F(board)');
  await clickOverlay(21);
  const modal = await page.evaluate(() => {
    const m = document.getElementById('roverConfirmModal');
    return {
      visible: m && m.style.display !== 'none' && !m.classList.contains('hidden'),
      remain: document.getElementById('roverRemainAp').textContent,
    };
  });
  console.log('rover modal:', JSON.stringify(modal));
  if (!modal.visible || modal.remain !== '1') throw new Error('rover confirm modal fail');
  await page.evaluate(() => confirmRoverBoard());
  await waitMoveSettled();
  s = await st();
  console.log('after boarding:', JSON.stringify(s));
  if (!s.onRover || s.pos !== 21 || s.ap !== 0 || !s.roverUsed) throw new Error('boarding fail');

  step('8. 撤回1格月球车移动 → 位置与AP恢复');
  await setupRover(roverPos, 2, null);
  await moveBtn.click();
  await clickOverlay(20);
  await waitMoveSettled();
  s = await st();
  if (s.pos !== 20 || s.ap !== 1) throw new Error('pre-undo move fail');
  await page.click('#moreBtn');
  await page.locator('#moreSheet button').filter({ hasText: '撤回移动' }).click();
  s = await st();
  console.log('after undo:', JSON.stringify(s));
  if (s.pos !== 21 || s.ap !== 2) throw new Error('undo rover 1-cell move fail');

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  console.log('\nALL ROVER TESTS PASSED');
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
