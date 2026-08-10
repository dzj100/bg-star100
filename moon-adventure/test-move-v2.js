/**
 * 移动V2测试（单机 index.html）：
 * 1. 发明家关键场景：pos1 + accelMarks[2,3] + ap1 → 第2/3/4格高亮且均1AP → 点第4格直达
 * 2. 超预算置灰：普通玩家 ap1 → 后续格 disabled 不可点
 * 3. 多步支付：ap3 点第3格(2AP) → pos3/ap1；撤回恢复 apBefore
 * 4. 返回基地：pos0 → 基地高亮 → 确认弹窗 → returned
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
    returned: S.players[0].returned,
  }));
  // 读取所有移动覆盖层（排除基地），解析路径位置/成本
  const overlays = () => page.evaluate(() =>
    [...document.querySelectorAll('.move-target')].map(el => {
      const m = (el.getAttribute('onclick') || '').match(/\((-?\d+)\)/);
      return {
        pos: m ? +m[1] : null,
        cost: +(el.getAttribute('data-cost') || 0),
      };
    }).filter(o => o.pos !== -1)
  );
  const clickOverlay = pos => page.evaluate(p =>
    [...document.querySelectorAll('.move-target')]
      .find(el => (el.getAttribute('onclick') || '').includes(`(${p})`))
      .click(), pos);
  // 重置单机状态
  const setup = (pos, ap, roleId, accelMarks) => page.evaluate(({ pos, ap, roleId, accelMarks }) => {
    dealGame(['A']);
    const p = S.players[0];
    p.role.id = roleId;
    p.pos = pos;
    p.onRover = false;
    p.returned = false;
    S.ap = ap;
    S.turnPhase = 'spent';
    S.dice = [ap];
    S.diceTotal = ap;
    S.accelMarks = accelMarks;
    S.roverUsed = false;
    S.hasEngineer = false;
    S.robotPos = -1;
    moveMode = null;
    render();
  }, { pos, ap, roleId, accelMarks });

  const moveBtn = page.locator('.action-btns button').filter({ hasText: '移动' });

  step('1. inventor key scenario');
  await page.goto(URL);
  await page.waitForFunction(() => typeof dealGame === 'function');
  await setup(1, 1, 'inventor', [2, 3]);
  await moveBtn.click();
  let os = await overlays();
  console.log('overlays:', JSON.stringify(os));
  // ap=1：仅显示费用≤1的格 —— 第2/3/4格（发明家越过标记）+ 第0格，均1AP
  const byPos = Object.fromEntries(os.map(o => [o.pos, o.cost]));
  const expect = { 2: 1, 3: 1, 4: 1, 0: 1 };
  for (const [pos, cost] of Object.entries(expect)) {
    if (byPos[pos] !== cost) throw new Error(`pos ${pos} must be highlighted with ${cost}AP`);
  }
  if (os.some(o => o.cost > 1)) throw new Error('over-budget targets must not be rendered');
  await clickOverlay(4);
  let s = await st();
  console.log('after click pos4:', JSON.stringify(s));
  if (s.pos !== 4 || s.ap !== 0) throw new Error('move to pos4 fail');
  const left = await page.evaluate(() => document.querySelectorAll('.move-target').length);
  if (left !== 0) throw new Error('move mode should exit after one move');
  const mvDisabled = await moveBtn.isDisabled();
  console.log('move btn disabled after ap0 (expect true):', mvDisabled);
  if (!mvDisabled) throw new Error('move btn should disable at ap0');

  step('2. over-budget targets hidden');
  await setup(0, 1, 'veteran', []);
  await moveBtn.click();
  os = await overlays();
  console.log('overlays:', JSON.stringify(os));
  if (os.some(o => o.pos === 2 || o.pos === 3)) throw new Error('pos2/3 must not render (over budget)');
  if (!os.some(o => o.pos === 1 && o.cost === 1)) throw new Error('pos1 must be highlighted 1AP');
  // 防御守卫：直接调用也不应移动
  const guard = await page.evaluate(() => { onMoveTargetClick(3); return { pos: S.players[0].pos, ap: S.ap }; });
  console.log('after guard click pos3:', JSON.stringify(guard));
  if (guard.pos !== 0 || guard.ap !== 1) throw new Error('guard must reject over-budget target');

  step('3. multi-AP pay + undo');
  await setup(1, 3, 'veteran', []);
  await moveBtn.click();
  await clickOverlay(3); // 2AP 直达
  s = await st();
  console.log('after click pos3 (2AP):', JSON.stringify(s));
  if (s.pos !== 3 || s.ap !== 1) throw new Error('2AP move fail');
  const hist = await page.evaluate(() => S.moveHistory[S.moveHistory.length - 1]);
  console.log('last hist:', JSON.stringify(hist));
  if (!hist || hist.type !== 'move' || hist.apBefore !== 3) throw new Error('move hist apBefore fail');
  await page.click('#moreBtn');
  await page.locator('#moreSheet button').filter({ hasText: '撤回移动' }).click();
  s = await st();
  console.log('after undo:', JSON.stringify(s));
  if (s.pos !== 1 || s.ap !== 3) throw new Error('undo restore apBefore fail');

  step('4. return base from pos0');
  await setup(0, 3, 'veteran', []);
  await moveBtn.click();
  const baseOverlay = await page.evaluate(() => {
    const el = document.querySelector('.move-target.move-base');
    if (!el) return null;
    const tokens = document.querySelector('.base-tokens');
    return {
      cost: +(el.getAttribute('data-cost') || 0),
      text: el.textContent.trim(),
      html: el.innerHTML,
      isSibling: el.parentElement === tokens.parentElement,
      noEmoji: !el.textContent.includes('⬆️'),
    };
  });
  console.log('base overlay:', JSON.stringify(baseOverlay));
  if (!baseOverlay || baseOverlay.cost !== 1) throw new Error('base overlay fail');
  if (!baseOverlay.text.includes('返回基地') || !baseOverlay.text.includes('1AP')) {
    throw new Error('base overlay text fail');
  }
  if (!baseOverlay.html.includes('<br>')) throw new Error('base overlay must line-break cost');
  if (baseOverlay.noEmoji === false || !baseOverlay.isSibling) {
    throw new Error('base overlay structure fail');
  }
  await page.evaluate(() => document.querySelector('.move-target.move-base').click());
  const modalVisible = await page.evaluate(() => {
    const m = document.getElementById('returnModal');
    return m && m.style.display !== 'none' && !m.classList.contains('hidden');
  });
  console.log('return modal visible:', modalVisible);
  if (!modalVisible) throw new Error('return modal must open');
  await page.evaluate(() => confirmReturnBase());
  s = await st();
  console.log('after confirm return:', JSON.stringify(s));
  if (!s.returned || s.pos !== -1 || s.ap !== 2) throw new Error('return base fail');

  step('5. return base from pos2 costs 3AP');
  await setup(2, 4, 'veteran', []);
  await moveBtn.click();
  const baseCost = await page.evaluate(() => +(document.querySelector('.move-target.move-base').getAttribute('data-cost') || 0));
  console.log('base cost from pos2:', baseCost);
  if (baseCost !== 3) throw new Error('base cost from pos2 must be 3AP');
  await page.evaluate(() => document.querySelector('.move-target.move-base').click());
  await page.evaluate(() => confirmReturnBase());
  s = await st();
  console.log('after return from pos2:', JSON.stringify(s));
  if (!s.returned || s.ap !== 1) throw new Error('return from pos2 must cost 3AP');

  step('6. base hidden when over budget');
  await setup(2, 2, 'veteran', []); // 返回基地需3AP，剩2AP → 不显示
  await moveBtn.click();
  const baseExists = await page.evaluate(() => !!document.querySelector('.move-target.move-base'));
  console.log('base overlay exists (expect false):', baseExists);
  if (baseExists) throw new Error('base overlay must hide when over budget');

  step('7. occupied cell behind accel mark not highlighted');
  await page.evaluate(() => {
    dealGame(['A', 'B']);
    const a = S.players[0];
    a.role.id = 'inventor';
    a.pos = 1;
    a.onRover = false;
    a.returned = false;
    S.players[1].pos = 3;   // B 站在第3格
    S.players[1].returned = false;
    S.ap = 2;
    S.turnPhase = 'spent';
    S.dice = [2];
    S.diceTotal = 2;
    S.accelMarks = [2];
    S.roverUsed = false;
    S.hasEngineer = false;
    S.robotPos = -1;
    moveMode = null;
    render();
  });
  await moveBtn.click();
  os = await overlays();
  console.log('overlays:', JSON.stringify(os));
  if (os.some(o => o.pos === 3)) throw new Error('occupied cell must not be highlighted');
  if (!os.some(o => o.pos === 2 && o.cost === 1)) throw new Error('accel mark stop must be highlighted');
  if (!os.some(o => o.pos === 4 && o.cost === 1)) throw new Error('cell past occupied must be highlighted');

  step('8. move click closes more sheet');
  await setup(0, 2, 'veteran', []);
  await page.click('#moreBtn');
  let sheetVisible = await page.evaluate(() =>
    document.getElementById('moreSheet').style.display !== 'none');
  console.log('more sheet visible (expect true):', sheetVisible);
  if (!sheetVisible) throw new Error('more sheet should open');
  await moveBtn.click();
  sheetVisible = await page.evaluate(() =>
    document.getElementById('moreSheet').style.display !== 'none');
  console.log('more sheet visible after move click (expect false):', sheetVisible);
  if (sheetVisible) throw new Error('move click must close more sheet');

  step('9. more sheet action closes the sheet');
  await setup(0, 2, 'veteran', []);
  await page.evaluate(() => { S.players[0].supplies.push({ type: 'rock' }); render(); });
  await page.click('#moreBtn');
  await page.locator('#moreSheet button').filter({ hasText: '丢弃物资' }).click();
  sheetVisible = await page.evaluate(() =>
    document.getElementById('moreSheet').style.display !== 'none');
  console.log('more sheet visible after discard click (expect false):', sheetVisible);
  if (sheetVisible) throw new Error('more sheet action must close the sheet');

  console.log('JS errors:', errors.length ? errors : 'none');
  await browser.close();
  console.log('ALL PASS');
})().catch(e => { console.error('TEST FAIL:', e); process.exit(1); });
