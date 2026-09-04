/* ============================================================
   煞有其时 · 截图走查（node test-shot.js）
   覆盖：菜单 / 选子 / 行动提示 / 推挤演出 / 穿越分身 / 结束行动 /
        焦点面板 / 结算 / 金路径 / AI 应手 / 日志抽屉 / 桌面横排
   ============================================================ */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const SHOTS = path.join(ROOT, 'shots');
const MOBILE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 820 };
const URL = 'file://' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?debug';

const G = require('./game.js');

function scene(patch) {
  const S = G.newGame('local2p', () => 0);
  for (const b of S.boards) b.cell.fill(null);
  S.turn = 0; S.turnNo = 1; S.focus = [0, 2];
  S.spares = [4, 4]; S.dead = [0, 0];
  S.stage = 'select'; S.sel = null; S.acted = 0; S.over = null; S.log.length = 0;
  Object.assign(S, patch);
  return JSON.parse(JSON.stringify(S));
}
const put = (S, e, i, c) => { S.boards[e].cell[i] = { c }; };
function growthScene(patch) {
  const S = G.newGame('local2p', () => 0, ['growth']);
  for (const b of S.boards) { b.cell.fill(null); b.pl.fill(null); b.sd.fill(0); }
  S.turn = 0; S.turnNo = 1; S.focus = [0, 2];
  S.spares = [4, 4]; S.dead = [0, 0];
  S.stage = 'select'; S.sel = null; S.acted = 0; S.over = null; S.log.length = 0;
  S.seeds = 5;
  Object.assign(S, patch);
  return JSON.parse(JSON.stringify(S));
}

async function main() {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const errors = [];
  let ok = 0, total = 0;
  const expect = (msg, cond) => { total++; if (cond) ok++; else console.log('  ✗ 断言失败: ' + msg); };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: MOBILE });
  page.on('pageerror', e => errors.push('PAGE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const shot = async name => { await page.screenshot({ path: path.join(SHOTS, name) }); console.log('  shot:', name); };
  const setState = async s => { await page.evaluate(x => window.TTYKM_UI.setState(x), s); await page.waitForTimeout(220); };
  const clickCell = (e, i) => page.click('.era[data-e="' + e + '"] .cell[data-i="' + i + '"]');
  const st = () => page.evaluate(() => {
    const S = window.TTYKM_UI.state();
    return { stage: S.stage, turn: S.turn, acted: S.acted, over: !!S.over, sel: S.sel, dead: S.dead, spares: S.spares, seeds: S.seeds, mods: S.mods.slice() };
  });
  /* 模组弹窗确认（默认不勾选 = 经典规则；行为与旧版一致） */
  const modConfirm = async (pg, wait = 350) => { await pg.click('#btnModStart'); await pg.waitForTimeout(wait); };
  const nbTxt = () => page.evaluate(() => document.querySelector('#notebar .nb-t') ? document.querySelector('#notebar .nb-t').textContent : '');

  await page.goto(URL);
  await page.waitForTimeout(500);

  console.log('■ 1 菜单（封面风）');
  await shot('m1-menu.png');

  console.log('■ 2 开局选子（AI 模式，随机分色；先经模组弹窗默认不勾选）');
  await page.evaluate(() => { Math.random = () => 0.1; });  // aiSide=1（AI 白方）且 first=0（玩家执黑先手）→ 确定性
  await page.click('#btnAI');
  await page.waitForTimeout(300);
  {
    const pop = await page.evaluate(() => ({
      open: !document.getElementById('modMask').classList.contains('hidden'),
      items: document.querySelectorAll('#modList .mod-item').length,
      checked: document.querySelector('#modList input').checked,
      desc: document.querySelector('#modList .mod-desc').textContent,
    }));
    expect('模组弹窗：1 项默认不勾选', pop.open && pop.items === 1 && !pop.checked);
    expect('模组说明含种子规则', pop.desc.indexOf('种子') >= 0 && pop.desc.indexOf('推倒') >= 0);
  }
  await shot('g1-modpop.png');
  await modConfirm(page, 450);                       // 不勾选 → 经典规则开局
  await shot('m2-open.png');
  expect('开局 select', (await st()).stage === 'select');
  expect('玩家执黑（turn=0）', (await st()).turn === 0);
  {
    const spare = await page.evaluate(() => {
      const fl = document.getElementById('spareFloat');
      const chip = document.querySelector('#topbar .spare-cnt');
      const metaText = document.querySelector('#turnstrip .meta').textContent;
      return {
        flText: fl ? fl.textContent : '',
        flShow: fl ? getComputedStyle(fl).display !== 'none' : false,
        flLines: fl ? fl.querySelectorAll('b').length : 0,
        flLabel: fl ? !!fl.querySelector('.fl-t') : false,
        chipHide: chip ? getComputedStyle(chip).display === 'none' : false,
        metaClean: metaText.indexOf('分身') < 0,
      };
    });
    expect('手机端悬浮窗竖排 3 行（分身/黑×4/白×4），横幅 meta 与顶栏角标不再重复',
      spare.flShow && spare.chipHide && spare.metaClean && spare.flLines === 2 && spare.flLabel &&
      spare.flText.indexOf('黑×4') >= 0 && spare.flText.indexOf('白×4') >= 0);
    expect('经典规则：无种子托盘、无模式行', await page.evaluate(() =>
      !document.getElementById('seedCnt') && !document.querySelector('.am-btn') && !document.querySelector('.fl-seed')));
  }

  console.log('■ 3 选子后行动提示');
  await clickCell(2, 15);                                 // 黑方焦点在未来：选 16 号格黑子
  await page.waitForTimeout(160);
  await shot('m3-select.png');
  let s = await st();
  expect('act 阶段 & 尚未行动', s.stage === 'act' && s.acted === 0);

  console.log('■ 4 推挤撞墙演出（中途帧）');
  // 场景测试改在双人模式跑：AI 模式在玩家回合结束后会自动接管（分色已随机）
  await page.evaluate(() => window.TTYKM_UI.goMenu());
  await page.click('#btn2P');
  await page.waitForTimeout(250);
  await modConfirm(page);
  {
    const S = scene({});
    put(S, 0, 0, 0); put(S, 0, 1, 1); put(S, 0, 2, 0);   // 黑1白2黑3 → 3推入
    put(S, 1, 10, 0); put(S, 1, 5, 1);                   // 双方另有时空 → 不触发终局
    await setState(S);
    await clickCell(0, 2);
    await page.waitForTimeout(120);
    await page.evaluate(() => { window.TTYKM_UI.fire({ op: 'act', act: { t: 'move', d: 'left', to: 1 } }); });
    await page.waitForTimeout(430);
    await shot('m4-push-fx.png');
    await page.waitForTimeout(1500);
    s = await st();
    expect('推后 stage=act acted=1', s.acted === 1 && s.stage === 'act');
    expect('己黑撞墙死', s.dead[0] === 1 && s.dead[1] === 0);
    await clickCell(0, 2);                                 // 第2次行动回 3号格
    await page.waitForTimeout(900);
    s = await st();
    expect('两次行动后进入 focus', s.stage === 'focus');
    await shot('m4b-focus.png');
  }

  console.log('■ 5 穿越分身演出');
  {
    const S = scene({ turn: 1, focus: [0, 2] });
    put(S, 2, 5, 1);                                       // 白方未来6号
    put(S, 0, 10, 0); put(S, 1, 10, 0);                    // 黑两时空有子 → 不触发终局
    await setState(S);
    await clickCell(2, 5);
    await page.waitForTimeout(120);
    await shot('m5a-travel-hint.png');
    await clickCell(1, 5);                                 // 穿越到 现在6号
    await page.waitForTimeout(150);
    await shot('m5b-travel-fx.png');
    await page.waitForTimeout(1500);
    s = await st();
    expect('穿越后 spares 3 & acted=1', s.spares[1] === 3 && s.acted === 1);
    const flAfter = await page.evaluate(() => {
      const fl = document.getElementById('spareFloat');
      return { text: fl ? fl.textContent : '', show: fl ? getComputedStyle(fl).display !== 'none' : false };
    });
    expect('悬浮窗随穿越实时更新（白×3）', flAfter.show && flAfter.text.indexOf('白×3') >= 0);
    await clickCell(1, 9);                                 // 第2次行动下移
    await page.waitForTimeout(900);
    s = await st();
    expect('白方两次行动后 focus', s.stage === 'focus');
    await shot('m5c-focus.png');
  }

  console.log('■ 5d 结束行动按钮');
  {
    const S = scene({ stage: 'act', acted: 1, sel: { era: 1, i: 0 },
      log: [{ no: 1, p: 0, text: '黑子3→2，黑1 撞墙出局' }] });
    S.turn = 0; S.focus[0] = 1;
    put(S, 1, 0, 0); put(S, 1, 1, 0); put(S, 1, 4, 0);     // 角落黑子：右/下己方
    put(S, 0, 0, 1); put(S, 2, 0, 1);                      // 穿越目标被敌占
    put(S, 0, 5, 0); put(S, 2, 5, 0);                      // 黑仍占其它时空
    await setState(S);
    const hasEnd = await page.evaluate(() => !!document.getElementById('btnEnd'));
    expect('canEnd 局面显示结束按钮', hasEnd);
    await shot('m5d-end-btn.png');
  }

  console.log('■ 6 焦点选择');
  {
    const S = scene({ stage: 'focus', acted: 2,
      log: [{ no: 1, p: 0, text: '黑子2→1，白2 撞墙出局' }] });
    put(S, 0, 0, 0); put(S, 1, 5, 0); put(S, 2, 5, 1);
    put(S, 0, 5, 1);                                            // 白方需在 ≥2 时空有子，否则移焦点即判黑胜
    S.focus[0] = 0; S.turn = 0;
    await setState(S);
    const fb = await page.evaluate(() => {
      const all = [...document.querySelectorAll('.fbtn')];
      return {
        n: all.length,
        cur: all.filter(b => b.classList.contains('cur')).map(b => b.dataset.e),
        dis: all.filter(b => b.disabled).map(b => b.dataset.e),
      };
    });
    expect('焦点面板恒显 3 时空按钮', fb.n === 3);
    expect('当前时空按钮置灰不可点', fb.dis.length === 1 && fb.dis[0] === '0' && fb.cur.length === 1 && fb.cur[0] === '0');
    await shot('m6-focus.png');
    await page.click('.fbtn[data-e="1"]');
    await page.waitForTimeout(1300);
    s = await st();
    expect('移焦点后换手', s.turn === 1 && !s.over);
  }

  console.log('■ 6b FX 演出期间输入缓冲（未演完先点下一步，收尾采纳）');
  {
    const S = scene({});
    put(S, 0, 0, 0); put(S, 0, 1, 1); put(S, 0, 2, 0);   // 黑3推左：白2→0 幸存、黑1撞墙出局
    put(S, 1, 10, 0); put(S, 1, 5, 1); put(S, 2, 5, 1);  // 双方另有时空 → 不触发终局
    await setState(S);
    await clickCell(0, 2);
    await page.waitForTimeout(120);
    await page.evaluate(() => { window.TTYKM_UI.fire({ op: 'act', act: { t: 'move', d: 'left', to: 1 } }); });
    await page.waitForTimeout(320);                      // 推挤演出进行中（busy）
    expect('演出中途 busy=true', await page.evaluate(() => window.TTYKM_UI.busy()));
    await clickCell(0, 0);                               // 撞墙黑1原格 → 演出后是白2，可推挤回该格
    await page.waitForFunction(() => {
      const S = window.TTYKM_UI.state();
      return S.stage === 'focus' && S.acted === 2;
    }, null, { timeout: 6000 });
    await page.waitForTimeout(1500);                     // 等第 2 次行动的演出收尾（引擎先于画面到 focus）
    s = await st();
    expect('缓冲点选被采纳为第 2 次行动', s.stage === 'focus' && s.acted === 2);
    const fin = await page.evaluate(() => {
      const S = window.TTYKM_UI.state();
      const c0 = S.boards[0].cell;
      return { own: c0[0] ? c0[0].c : -1, empty: !c0[1], dead: S.dead };
    });
    expect('推链终局正确（黑1、白2 出局；黑3 落 1 号格）', fin.own === 0 && fin.empty && fin.dead[0] === 1 && fin.dead[1] === 1);
    await shot('m6b-buffer.png');
  }

  console.log('■ 6c 焦点按钮连点：越界缓冲被丢弃，不替对方做决定');
  {
    const S = scene({ stage: 'focus', acted: 2 });
    put(S, 0, 0, 0); put(S, 1, 5, 0); put(S, 2, 5, 1);
    put(S, 0, 5, 1);
    S.focus[0] = 0; S.turn = 0;
    await setState(S);
    await page.evaluate(() => {                          // 同一事件循环连点两个焦点按钮
      document.querySelector('.fbtn[data-e="1"]').click();
      document.querySelector('.fbtn[data-e="2"]').click();
    });
    await page.waitForTimeout(900);
    s = await st();
    expect('第 2 个缓冲点击被引擎拦下（局面停在白方 select）', s.turn === 1 && s.stage === 'select' && !s.over);
  }

  console.log('■ 7 胜利结算');
  {
    const S = scene({ turn: 1, over: { winner: 0 }, stage: 'over',
      log: [{ no: 3, p: 0, text: '黑方获胜｜白方在 ≥2 个时空已无棋子' }] });
    put(S, 0, 0, 0); put(S, 1, 1, 0); put(S, 2, 2, 0);
    put(S, 2, 3, 1);
    S.dead = [0, 3];
    await setState(S);
    await shot('m7-win.png');
    expect('结算面板可见', await page.evaluate(() => !document.getElementById('overlay-win').classList.contains('hidden')));
  }

  console.log('■ 8 金路径：双人完整一回合（纯点击）');
  await page.evaluate(() => window.TTYKM_UI.goMenu());
  await page.evaluate(() => { Math.random = () => 0.1; });  // 锁定黑方先手
  await page.click('#btn2P');
  await page.waitForTimeout(250);
  await modConfirm(page);
  await clickCell(2, 15);                              // 黑方家：未来 16 号格
  await page.waitForTimeout(150);
  await clickCell(2, 11);                              // 上移 → 12 号格
  await page.waitForTimeout(1000);
  s = await st();
  expect('第1次行动后 acted=1', s.acted === 1 && s.stage === 'act');
  await clickCell(2, 7);                               // 再上移 → 8 号格
  await page.waitForTimeout(1000);
  s = await st();
  expect('两次行动进入 focus', s.stage === 'focus');
  await page.click('.fbtn[data-e="1"]');               // 焦点移到「现在」（黑当前在「未来」）
  await page.waitForTimeout(500);
  s = await st();
  expect('换白方回合 select', s.turn === 1 && s.stage === 'select');
  await shot('m8-turn2.png');

  console.log('■ 9 AI 应手（白方整回合自动）');
  await page.evaluate(() => window.TTYKM_UI.goMenu());
  await page.click('#btnAI');
  await page.waitForTimeout(250);
  await modConfirm(page);
  await clickCell(2, 15);
  await page.waitForTimeout(150);
  await clickCell(2, 11);
  await page.waitForTimeout(1000);
  await clickCell(2, 7);
  await page.waitForTimeout(1000);
  s = await st();
  if (s.stage === 'focus') { await page.click('.fbtn[data-e="1"]'); await page.waitForTimeout(600); }
  await page.waitForFunction(() => {
    const S = window.TTYKM_UI.state();
    return S.over || (S.turn === 0 && S.stage === 'select');
  }, null, { timeout: 30000 });
  s = await st();
  expect('AI 回合后回到黑方', s.over || (s.turn === 0 && s.stage === 'select'));
  await shot('m9-ai-done.png');

  console.log('■ 10 日志抽屉（点击提示条展开倒序列表）');
  {
    await page.evaluate(() => window.TTYKM_UI.goMenu());   // 清掉可能残留的结算遮罩
    const S = scene({ stage: 'select' });
    S.turn = 0; S.focus = [0, 2];
    put(S, 0, 15, 0); put(S, 1, 15, 0); put(S, 2, 15, 0);  // 黑 16 号格
    put(S, 0, 0, 1); put(S, 1, 0, 1); put(S, 2, 0, 1);     // 白 1 号格
    S.log.push(
      { no: 1, p: 0, text: '黑子16→12，白16 撞墙出局' },
      { no: 1, p: 0, text: '黑子12→11，白1 悖论出局' },
      { no: 1, p: 1, text: '白子1→2，白子穿越→现在2格（分身留过去）' },
      { no: 2, p: 1, text: '白方焦点时空无子可行动，本回合空过' },
    );
    await setState(S);
    await page.click('#notebar');
    await page.waitForTimeout(320);
    expect('日志抽屉可见', await page.evaluate(() => !document.getElementById('logMask').classList.contains('hidden')));
    const first = await page.evaluate(() => {
      const rows = document.querySelectorAll('#logList .log-item');
      return rows.length ? rows[0].querySelector('.log-t').textContent : '';
    });
    expect('抽屉倒序（最新在上）', first === '白方焦点时空无子可行动，本回合空过');
    await shot('m10-log.png');
    await page.click('#btnCloseLog');
    await page.waitForTimeout(200);
    expect('关闭后隐藏', await page.evaluate(() => document.getElementById('logMask').classList.contains('hidden')));
  }

  console.log('■ 11 桌面横排');
  {
    const dpage = await browser.newPage({ viewport: DESK });
    dpage.on('pageerror', e => errors.push('DPAGE: ' + e.message));
    await dpage.goto(URL);
    await dpage.waitForTimeout(400);
    await dpage.evaluate(() => { Math.random = () => 0.1; });  // 玩家执黑先手，确定性
    await dpage.click('#btnAI');
    await dpage.waitForTimeout(250);
    await modConfirm(dpage, 400);
    await dpage.click('.era[data-e="2"] .cell[data-i="15"]');
    await dpage.waitForTimeout(180);
    await dpage.screenshot({ path: path.join(SHOTS, 'd1-landscape.png') });
    console.log('  shot: d1-landscape.png');
    const dspare = await dpage.evaluate(() => {
      const chip = document.querySelector('#topbar .spare-cnt');
      const fl = document.getElementById('spareFloat');
      return {
        chipShow: chip ? getComputedStyle(chip).display !== 'none' : false,
        floatHide: fl ? getComputedStyle(fl).display === 'none' : true,
      };
    });
    expect('桌面端保留顶栏角标、无悬浮窗', dspare.chipShow && dspare.floatHide);
    await dpage.close();
  }

  console.log('■ 12 断点续玩：localStorage 存档 → 重载自动恢复');
  {
    const stFull = () => page.evaluate(() => {
      const S = window.TTYKM_UI.state();
      return { stage: S.stage, turn: S.turn, turnNo: S.turnNo, over: !!S.over, sel: S.sel };
    });
    // 12a 双人同屏：真实操作入档，重载自动续局
    await page.evaluate(() => { localStorage.removeItem(window.TTYKM_UI.saveKey); window.TTYKM_UI.clear(); });
    await page.evaluate(() => window.TTYKM_UI.goMenu());
    await page.evaluate(() => { Math.random = () => 0.1; });
    await page.click('#btn2P');
    await page.waitForTimeout(250);
    await modConfirm(page);
    await clickCell(2, 15); await page.waitForTimeout(180);    // 黑 16→12 行动1
    await clickCell(2, 11); await page.waitForTimeout(1100);
    await clickCell(2, 7); await page.waitForTimeout(1100);    // 行动2 → focus
    s = await stFull();
    expect('行动后自动写入存档', s.stage === 'focus' && await page.evaluate(() => !!localStorage.getItem(window.TTYKM_UI.saveKey)));
    const saved1 = await page.evaluate(() => JSON.parse(localStorage.getItem(window.TTYKM_UI.saveKey)));
    expect('存档含模式+引擎局面', saved1.mode === 'local2p' && saved1.S.turn === 0 && saved1.S.stage === 'focus' && saved1.S.turnNo === 1);
    await page.click('.fbtn[data-e="1"]');
    await page.waitForTimeout(700);
    s = await stFull();
    expect('移焦点换手后存档', s.turn === 1 && s.stage === 'select' && s.turnNo === 2);
    await page.reload();
    await page.waitForTimeout(700);
    expect('重载后直接进对局（跳过封面）', await page.evaluate(() =>
      document.getElementById('screen-menu').classList.contains('hidden') &&
      document.getElementById('screen-game').classList.contains('on')));
    s = await stFull();
    expect('局面完整恢复（白方第2回合 select，黑子已到8号格）', s.turn === 1 && s.stage === 'select' && s.turnNo === 2 &&
      await page.evaluate(() => { const c = window.TTYKM_UI.state().boards[2].cell; return c[7] && c[7].c === 0 && !c[11]; }));
    await clickCell(0, 0);                                      // 恢复后白方 1 号格可下
    await page.waitForTimeout(250);
    s = await stFull();
    expect('恢复后交互可用（选中白子进 act）', s.stage === 'act' && s.sel && s.sel.era === 0);
    await shot('m12-resume.png');

    // 12b 返回菜单 = 清档 → 下次进封面
    await page.evaluate(() => window.TTYKM_UI.goMenu());
    expect('返回菜单即清除存档', await page.evaluate(() => localStorage.getItem(window.TTYKM_UI.saveKey) === null));
    await page.reload();
    await page.waitForTimeout(500);
    expect('无存档 → 回封面', await page.evaluate(() => !document.getElementById('screen-menu').classList.contains('hidden')));

    // 12c AI 回合 act 中途断点：重载后 AI 自动续完该回合
    await page.evaluate(() => {
      const S = window.TTYKM.newGame('ai', () => 0);
      for (const b of S.boards) b.cell.fill(null);
      S.turn = 1; S.turnNo = 2; S.focus = [0, 2];               // 白方（AI）第2回合
      S.stage = 'act'; S.sel = { era: 2, i: 15 }; S.acted = 0;  // 断点：AI 已选未来16号未行动
      S.spares = [4, 4]; S.dead = [0, 0]; S.over = null; S.log.length = 0;
      S.boards[0].cell[0] = { c: 0 }; S.boards[1].cell[0] = { c: 0 }; S.boards[2].cell[0] = { c: 0 };
      S.boards[2].cell[15] = { c: 1 };
      localStorage.setItem(window.TTYKM_UI.saveKey, JSON.stringify({ v: 1, mode: 'ai', S }));
    });
    await page.reload();
    await page.waitForFunction(() => {
      const S = window.TTYKM_UI.state();
      return !!S && S.turn === 0 && S.stage === 'select' && S.turnNo === 3;
    }, null, { timeout: 25000 });
    const afterAI = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem(window.TTYKM_UI.saveKey));
      return { savedTurn: d.S.turnNo };
    });
    expect('AI 自动走完回合并同步存档', afterAI.savedTurn === 3);
    await page.evaluate(() => window.TTYKM_UI.clear());
    expect('测试收尾清档', await page.evaluate(() => localStorage.getItem(window.TTYKM_UI.saveKey) === null));
  }

  console.log('■ 13 生长模组：勾选开局 → 模式行/托盘/播种/拨除全点击流');
  {
    await page.evaluate(() => window.TTYKM_UI.goMenu());
    await page.evaluate(() => { Math.random = () => 0.1; });  // 黑方先手
    await page.click('#btn2P');
    await page.waitForTimeout(250);
    await page.evaluate(() => { document.querySelector('#modList input').checked = true; });
    await modConfirm(page, 450);
    {
      const s = await st();
      expect('生长开局 mods/seeds', JSON.stringify(s.mods) === JSON.stringify(['growth']) && s.seeds === 5 &&
        s.stage === 'select' && s.turn === 0);
      const tray = await page.evaluate(() => ({
        chip: document.querySelectorAll('#seedCnt i').length,
        chipOn: document.querySelectorAll('#seedCnt i.on').length,
        fl: document.querySelectorAll('#spareFloat .fl-seed i.on').length,
        hasPl: !!document.querySelector('.pl'),
      }));
      expect('种子托盘 5 粒（顶栏 + 窄屏悬浮行），无植物', tray.chip === 5 && tray.chipOn === 5 && tray.fl === 5 && !tray.hasPl);
      await shot('g13-open.png');
    }
    await clickCell(2, 15);                              // 黑未来 16 号格
    await page.waitForTimeout(300);
    {
      const row = await page.evaluate(() => [...document.querySelectorAll('.am-btn')]
        .map(b => ({ c: b.dataset.cat, on: b.classList.contains('on'), dis: b.disabled })));
      expect('模式行 3 按钮：move 默认选中，pluck 无种子置灰',
        row.length === 3 && row[0].c === 'move' && row[0].on && row[1].c === 'sow' && !row[1].dis &&
        row[2].c === 'pluck' && row[2].dis);
      await shot('g13-mode.png');
    }
    await page.click('.am-btn[data-cat="sow"]');
    await page.waitForTimeout(250);
    {
      const hints = await page.evaluate(() => [...document.querySelectorAll('.cell.hint-sow')].map(c => +c.dataset.i).sort());
      expect('播种高亮 = 己子格 + 邻格（16/15/12 号）', JSON.stringify(hints) === JSON.stringify([11, 14, 15]));
      const sub = await page.evaluate(() => document.querySelector('#panel .phint small').textContent);
      expect('播种提示副行讲生长', sub.indexOf('种子沿时间线生长') >= 0);
      await shot('g13-sow-hints.png');
    }
    await clickCell(2, 14);                              // 播在 15 号格（空格）
    await page.waitForTimeout(800);
    s = await st();
    expect('播种后 seeds=4 acted=1', s.seeds === 4 && s.acted === 1 && s.stage === 'act');
    expect('日志记播种', (await nbTxt()).indexOf('在15号格播下种子') >= 0);
    {
      const dom = await page.evaluate(() => ({
        dot: !!document.querySelector('.era[data-e="2"] .cell[data-i="14"] .pl.k-seed'),
        chipOn: document.querySelectorAll('#seedCnt i.on').length,
      }));
      expect('种子点已绘 + 托盘减至 4', dom.dot && dom.chipOn === 4);
      await shot('g13-seed.png');
    }
    await page.click('.am-btn[data-cat="pluck"]');
    await page.waitForTimeout(250);
    {
      const sub = await page.evaluate(() => document.querySelector('#panel .phint small').textContent);
      expect('拨除提示副行讲回收级联、不再讲生长', sub.indexOf('拨除：回收') >= 0 && sub.indexOf('随之消逝') >= 0 && sub.indexOf('种子沿时间线生长') < 0);
    }
    await clickCell(2, 14);                              // 拨回同一粒
    await page.waitForTimeout(800);
    s = await st();
    expect('拨除后 seeds=5 acted=2 → focus', s.seeds === 5 && s.acted === 2 && s.stage === 'focus');
    {
      const dot = await page.evaluate(() => !!document.querySelector('.era[data-e="2"] .cell[data-i="14"] .pl.k-seed'));
      expect('种子点清除', !dot);
    }
  }

  console.log('■ 14 生长摆景：三时空 灌木/立树/倒树/种子（含叠棋子种子）');
  {
    const S = growthScene({ focus: [0, 2] });
    put(S, 0, 5, 0); put(S, 0, 9, 1); put(S, 1, 12, 0); put(S, 1, 6, 1);
    put(S, 2, 15, 0); put(S, 2, 0, 1);
    S.boards[0].pl[1] = { k: 'tree', down: 0 }; S.boards[0].pl[8] = { k: 'bush' }; S.boards[0].pl[13] = { k: 'tree', down: 1 };
    S.boards[1].pl[2] = { k: 'tree', down: 0 }; S.boards[1].pl[10] = { k: 'bush' };
    S.boards[2].pl[11] = { k: 'tree', down: 0 }; S.boards[2].pl[6] = { k: 'bush' };
    S.boards[0].sd[5] = 1; S.boards[0].sd[14] = 1; S.boards[2].sd[15] = 1;   // 含 2 处叠在己子格
    S.seeds = 2;
    await setState(S);
    const pl = await page.evaluate(() => ({
      tree: document.querySelectorAll('.pl.k-tree:not(.down)').length,
      down: document.querySelectorAll('.pl.k-tree.down').length,
      bush: document.querySelectorAll('.pl.k-bush').length,
      seed: document.querySelectorAll('.pl.k-seed').length,
      stack: document.querySelectorAll('.era[data-e="0"] .cell[data-i="5"] .pl.k-seed').length +
        document.querySelectorAll('.era[data-e="2"] .cell[data-i="15"] .pl.k-seed').length,
    }));
    expect('植物静态渲染：3 立树 1 倒树 3 灌木 3 种子（2 叠棋子）',
      pl.tree === 3 && pl.down === 1 && pl.bush === 3 && pl.seed === 3 && pl.stack === 2);
    await shot('g14-plants.png');
  }

  console.log('■ 15 生长推倒 + 压垮演出（黑推 2 连树压死白）');
  {
    const S = growthScene({ focus: [0, 2] });
    put(S, 0, 0, 0); S.boards[0].pl[1] = { k: 'tree', down: 0 }; S.boards[0].pl[2] = { k: 'tree', down: 0 };
    put(S, 0, 3, 1); S.boards[0].sd[4] = 1; S.seeds = 4;     // 白4 号被压；5 号格种子随树倒保留
    put(S, 1, 10, 0); put(S, 2, 10, 0); put(S, 1, 5, 1); put(S, 2, 5, 1);
    await setState(S);
    await shot('g15-pose.png');
    await clickCell(0, 0);
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.TTYKM_UI.fire({ op: 'act', act: { t: 'move', d: 'right', to: 1 } }); });
    await page.waitForTimeout(330);
    await shot('g15-mid.png');
    await page.waitForTimeout(2300);
    s = await st();
    const fin = await page.evaluate(() => {
      const S = window.TTYKM_UI.state(), b0 = S.boards[0];
      return {
        blackAt1: b0.cell[1] ? b0.cell[1].c : -1,
        t1: b0.pl[2] ? b0.pl[2].k + (b0.pl[2].down ? 'd' : 'u') : 'none',
        t2: b0.pl[3] ? b0.pl[3].k + (b0.pl[3].down ? 'd' : 'u') : 'none',
        whiteCell: b0.cell[3] ? b0.cell[3].c : 'empty',
        seed: b0.sd[4], seeds: S.seeds,
        art1: !!document.querySelector('.era[data-e="0"] .cell[data-i="2"] .pl.k-tree.down'),
        art2: !!document.querySelector('.era[data-e="0"] .cell[data-i="3"] .pl.k-tree.down'),
        art0: !!document.querySelector('.era[data-e="0"] .cell[data-i="1"] .pl'),
      };
    });
    expect('压垮结算：白4 出局、黑落 2 号格、双树卧倒、种子保留',
      fin.blackAt1 === 0 && fin.t1 === 'treed' && fin.t2 === 'treed' && fin.whiteCell === 'empty' &&
      fin.seed === 1 && fin.seeds === 4 && s.dead[1] === 1 && s.dead[0] === 0);
    expect('倒树躺倒造型（落点树 down、原格空）', fin.art1 && fin.art2 && !fin.art0);
    expect('日志记压垮出局', (await nbTxt()).indexOf('压垮出局') >= 0);
    await shot('g15-done.png');
  }

  console.log('■ 16 存档 v1→v2 迁移 & 生长档 round-trip & 重开保模组不弹窗');
  {
    // 16a 手写 v1 经典档（无 mods 字段）→ 恢复为 mods=[]，操作后重写 v2
    await page.evaluate(() => {
      const S = window.TTYKM.newGame('local2p', () => 0);
      for (const b of S.boards) b.cell.fill(null);
      S.turn = 0; S.turnNo = 1; S.focus = [0, 2];
      S.stage = 'select'; S.sel = null; S.acted = 0; S.over = null; S.log.length = 0;
      S.boards[0].cell[0] = { c: 0 }; S.boards[1].cell[5] = { c: 0 };
      S.boards[0].cell[5] = { c: 1 }; S.boards[2].cell[5] = { c: 1 };
      delete S.mods;                                        // v1 档没有该字段
      localStorage.setItem(window.TTYKM_UI.saveKey, JSON.stringify({ v: 1, mode: 'local2p', S }));
    });
    await page.reload();
    await page.waitForTimeout(700);
    s = await st();
    expect('v1 档恢复为经典规则（select、无模组）', s.stage === 'select' && s.turn === 0 &&
      await page.evaluate(() => window.TTYKM_UI.state().mods.length === 0 && !document.getElementById('seedCnt')));
    await clickCell(0, 0);                                  // 操作一次触发重写存档
    await page.waitForTimeout(400);
    const savedV = await page.evaluate(() => JSON.parse(localStorage.getItem(window.TTYKM_UI.saveKey)));
    expect('操作后存档升 v2 且 mods=[]', savedV.v === 2 && Array.isArray(savedV.S.mods) && savedV.S.mods.length === 0);

    // 16b 手写 v2 生长档 → 恢复保模组/保池/保植物；重开沿用模组且不再弹窗
    await page.evaluate(() => {
      const S = window.TTYKM.newGame('local2p', () => 0, ['growth']);
      for (const b of S.boards) { b.cell.fill(null); b.pl.fill(null); b.sd.fill(0); }
      S.turn = 0; S.turnNo = 2; S.focus = [0, 2];
      S.stage = 'select'; S.sel = null; S.acted = 0; S.over = null; S.log.length = 0;
      S.boards[0].cell[0] = { c: 0 }; S.boards[0].pl[1] = { k: 'tree', down: 0 };
      S.boards[0].sd[3] = 1; S.seeds = 4;                   // 盘 1 + 池 4 = 5
      S.boards[1].cell[10] = { c: 0 }; S.boards[2].cell[10] = { c: 0 };
      S.boards[1].cell[5] = { c: 1 }; S.boards[2].cell[5] = { c: 1 };
      localStorage.setItem(window.TTYKM_UI.saveKey, JSON.stringify({ v: 2, mode: 'local2p', aiSide: 1, S }));
    });
    await page.reload();
    await page.waitForTimeout(700);
    s = await st();
    const restored = await page.evaluate(() => {
      const S = window.TTYKM_UI.state();
      return {
        mods: S.mods.slice(), seeds: S.seeds, turnNo: S.turnNo,
        treeUp: !!document.querySelector('.era[data-e="0"] .cell[data-i="1"] .pl.k-tree:not(.down)'),
        dot: !!document.querySelector('.era[data-e="0"] .cell[data-i="3"] .pl.k-seed'),
        chipOn: document.querySelectorAll('#seedCnt i.on').length,
      };
    });
    expect('生长档恢复：模组/池守恒/植物/种子点全保留',
      JSON.stringify(restored.mods) === JSON.stringify(['growth']) && restored.seeds === 4 &&
      restored.turnNo === 2 && restored.treeUp && restored.dot && restored.chipOn === 4);
    await clickCell(0, 0);                                  // 黑推树（可行动）→ act
    await page.waitForTimeout(400);
    s = await st();
    expect('恢复后交互可用（act + 模式行）', s.stage === 'act' &&
      await page.evaluate(() => document.querySelectorAll('.am-btn').length === 3));
    await page.click('#btnRestart');                        // 重开：沿用模组
    await page.waitForTimeout(500);
    s = await st();
    const again = await page.evaluate(() => ({
      chipOn: document.querySelectorAll('#seedCnt i.on').length,
      popHidden: document.getElementById('modMask').classList.contains('hidden'),
    }));
    expect('重开保模组：seeds=5 新局、托盘满、弹窗不再出现',
      s.seeds === 5 && JSON.stringify(s.mods) === JSON.stringify(['growth']) && again.chipOn === 5 && again.popHidden);
    await shot('g16-restart.png');
  }

  console.log('■ 17 播种级联演出：种子 → 灌木 → 大树；拨除让未来植物消逝');
  {
    const S = growthScene({ focus: [0, 2] });
    put(S, 0, 15, 0); put(S, 1, 10, 0); put(S, 2, 10, 0);
    put(S, 1, 5, 1); put(S, 2, 5, 1);
    await setState(S);
    await clickCell(0, 15);                                 // 黑过去 16 号格
    await page.waitForTimeout(250);
    await page.click('.am-btn[data-cat="sow"]');
    await page.waitForTimeout(250);
    await clickCell(0, 11);                                 // 12 号格播：12 号列未来两时空全空 → 级联
    await page.waitForTimeout(320);                         // 生长演出中途帧（灌木/大树弹入）
    await shot('g17-cascade-mid.png');
    await page.waitForTimeout(800);
    s = await st();
    const grown = await page.evaluate(() => ({
      bush: !!document.querySelector('.era[data-e="1"] .cell[data-i="11"] .pl.k-bush'),
      tree: !!document.querySelector('.era[data-e="2"] .cell[data-i="11"] .pl.k-tree:not(.down)'),
      seed: !!document.querySelector('.era[data-e="0"] .cell[data-i="11"] .pl.k-seed'),
    }));
    expect('播种级联：灌木@现在12 + 大树@未来12 + 种子@过去12', grown.bush && grown.tree && grown.seed && s.seeds === 4);
    expect('日志记长出灌木/大树', (await nbTxt()).indexOf('长出灌木丛') >= 0 && (await nbTxt()).indexOf('长出大树') >= 0);
    await page.click('.am-btn[data-cat="pluck"]');
    await page.waitForTimeout(250);
    await clickCell(0, 11);                                 // 拨除 → 未来植物随之消逝
    await page.waitForTimeout(160);
    const poofing = await page.evaluate(() => {
      const fx = document.getElementById('fx');
      return {
        n: fx ? fx.querySelectorAll('.fxpl').length : 0,
        fading: fx ? fx.querySelectorAll('.pl.poofOut').length : 0,
      };
    });
    expect('演出中 3 粒种子/植物正在消散', poofing.n === 3 && poofing.fading >= 1);
    await shot('g17-poof-mid.png');
    await page.waitForTimeout(900);
    s = await st();
    const gone = await page.evaluate(() => ({
      any: !!document.querySelector('.era[data-e="1"] .cell[data-i="11"] .pl') ||
        !!document.querySelector('.era[data-e="2"] .cell[data-i="11"] .pl') ||
        !!document.querySelector('.era[data-e="0"] .cell[data-i="11"] .pl'),
    }));
    expect('拨除后三时空 12 号格全净、池回 5、入 focus', !gone.any && s.seeds === 5 && s.acted === 2 && s.stage === 'focus');
    expect('日志记随之消逝', (await nbTxt()).indexOf('随之消逝') >= 0);
  }

  console.log('■ 17b 拨除追消已被推倒的大树（下推离开原列 → 循原列 o 消逝）');
  {
    const S = growthScene({ focus: [0, 2] });
    put(S, 0, 4, 0); put(S, 1, 10, 0); put(S, 2, 10, 0);
    put(S, 1, 5, 1); put(S, 2, 5, 1);
    S.boards[0].sd[4] = 1; S.seeds = 4;
    S.boards[1].pl[4] = { k: 'bush' };
    S.boards[2].pl[8] = { k: 'tree', down: 1, o: 4 };   // 过去5号格种子长的大树被向下推倒 → 倒未来9号格
    await setState(S);
    await clickCell(0, 4);                                 // 黑子站种子格（过去 5 号格）
    await page.waitForTimeout(250);
    await page.click('.am-btn[data-cat="pluck"]');
    await page.waitForTimeout(250);
    await clickCell(0, 4);                                 // 拨除自己脚下的种子
    await page.waitForTimeout(160);
    const poof2 = await page.evaluate(() => {
      const fx = document.getElementById('fx');
      return {
        n: fx ? fx.querySelectorAll('.fxpl').length : 0,
        fading: fx ? fx.querySelectorAll('.pl.poofOut').length : 0,
        at9Still: !!document.querySelector('.era[data-e="2"] .cell[data-i="8"] .pl'),
      };
    });
    expect('3 处消散演出（种子/灌木/9 号格倒树），棋盘倒树已移入幽灵层', poof2.n === 3 && poof2.fading >= 1 && !poof2.at9Still);
    await shot('g17b-poof-fallen.png');
    await page.waitForTimeout(900);
    s = await st();
    const gone2 = await page.evaluate(() => ({
      any: !!document.querySelector('.era[data-e="2"] .cell[data-i="8"] .pl'),
    }));
    expect('拨除后 9 号格倒树消失、池回 5', !gone2.any && s.seeds === 5);
    expect('日志记未来9号格大树随之消逝', (await nbTxt()).indexOf('随之消逝') >= 0);
  }

  console.log('■ 18 桌面端生长：种子托盘顶栏角标 + 模式行');
  {
    const dpage = await browser.newPage({ viewport: DESK });
    dpage.on('pageerror', e => errors.push('DPAGE: ' + e.message));
    await dpage.goto(URL);
    await dpage.waitForTimeout(400);
    await dpage.evaluate(() => { Math.random = () => 0.1; });
    await dpage.click('#btn2P');
    await dpage.waitForTimeout(250);
    await dpage.evaluate(() => { document.querySelector('#modList input').checked = true; });
    await modConfirm(dpage, 450);
    const dtray = await dpage.evaluate(() => {
      const chip = document.getElementById('seedCnt');
      const fl = document.getElementById('spareFloat');
      return {
        chipShow: chip ? getComputedStyle(chip).display !== 'none' : false,
        dots: chip ? chip.querySelectorAll('i.on').length : -1,
        floatHide: fl ? getComputedStyle(fl).display === 'none' : true,
      };
    });
    expect('桌面：顶栏角标 5 粒可见、无悬浮行', dtray.chipShow && dtray.dots === 5 && dtray.floatHide);
    await dpage.click('.era[data-e="2"] .cell[data-i="15"]');
    await dpage.waitForTimeout(300);
    const dam = await dpage.evaluate(() => document.querySelectorAll('.am-btn').length === 3);
    expect('桌面模式行 3 按钮', dam);
    await dpage.screenshot({ path: path.join(SHOTS, 'd-growth.png') });
    console.log('  shot: d-growth.png');
    await dpage.close();
  }

  console.log('\n断言: ' + ok + '/' + total);
  await browser.close();
  if (errors.length) { console.log('\n页面错误:\n' + errors.join('\n')); process.exit(1); }
  if (ok < total) { console.log('部分断言未通过'); process.exit(1); }
  console.log('ALL OK');
}
main().catch(e => { console.error(e); process.exit(1); });
