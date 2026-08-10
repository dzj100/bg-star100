/**
 * 撤回移动功能测试（单机）：
 * 1. 前进2步 → 更多悬浮窗"撤回移动"可用
 * 2. 撤回1次 → 位置回退、AP+1；撤回2次 → 按钮disabled
 * 3. 再次移动 → 可撤回；执行其他行动（放置加速标记）→ 阻断撤回
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
    hist: S.moveHistory.map(h => h.type),
  }));

  step('open game');
  await page.goto(URL);
  await page.waitForFunction(() => typeof dealGame === 'function');
  await page.evaluate(() => {
    dealGame(['A']);
    S.ap = 5;
    S.turnPhase = 'spent';
    S.dice = [5];
    S.diceTotal = 5;
    render();
  });

  step('move forward x2');
  await page.evaluate(() => moveStep('forward'));
  await page.evaluate(() => moveStep('forward'));
  let s = await st();
  console.log('after 2 moves:', JSON.stringify(s));
  if (s.pos !== 1 || s.ap !== 3 || s.hist.join(',') !== 'move,move') throw new Error('move record fail');

  step('open more sheet, check undo enabled');
  await page.click('#moreBtn');
  const undoBtn = page.locator('#moreSheet button').filter({ hasText: '撤回移动' });
  let disabled = await undoBtn.isDisabled();
  console.log('undo disabled (expect false):', disabled);
  if (disabled) throw new Error('undo should be enabled');

  step('undo 1');
  await undoBtn.click();
  s = await st();
  console.log('after undo1:', JSON.stringify(s));
  if (s.pos !== 0 || s.ap !== 4 || s.hist.join(',') !== 'move') throw new Error('undo1 fail');

  step('undo 2');
  await page.click('#moreBtn'); // undo 后悬浮窗自动收起，重新打开
  await undoBtn.click();
  s = await st();
  console.log('after undo2:', JSON.stringify(s));
  if (s.pos !== -1 || s.ap !== 5 || s.hist.length !== 0) throw new Error('undo2 fail');
  disabled = await undoBtn.isDisabled();
  console.log('undo disabled after all undone (expect true):', disabled);
  if (!disabled) throw new Error('undo should be disabled after undoing all');

  step('move again -> undo enabled');
  await page.evaluate(() => moveStep('forward'));
  disabled = await undoBtn.isDisabled();
  console.log('undo disabled after fresh move (expect false):', disabled);
  if (disabled) throw new Error('undo should be enabled after fresh move');

  step('place accel mark -> undo blocked');
  await page.evaluate(() => doPlaceAccelMark(0));
  disabled = await undoBtn.isDisabled();
  console.log('undo disabled after accel mark (expect true):', disabled);
  if (!disabled) throw new Error('other action must block undo');

  console.log('JS errors:', errors.length ? errors : 'none');
  await browser.close();
  console.log('ALL PASS');
})().catch(e => { console.error('TEST FAIL:', e); process.exit(1); });
