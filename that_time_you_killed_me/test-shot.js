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
    return { stage: S.stage, turn: S.turn, acted: S.acted, over: !!S.over, sel: S.sel, dead: S.dead, spares: S.spares };
  });

  await page.goto(URL);
  await page.waitForTimeout(500);

  console.log('■ 1 菜单（封面风）');
  await shot('m1-menu.png');

  console.log('■ 2 开局选子（AI 模式）');
  await page.click('#btnAI');
  await page.waitForTimeout(600);
  await shot('m2-open.png');
  expect('开局 select', (await st()).stage === 'select');
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
  }

  console.log('■ 3 选子后行动提示');
  await clickCell(0, 0);
  await page.waitForTimeout(160);
  await shot('m3-select.png');
  let s = await st();
  expect('act 阶段 & 尚未行动', s.stage === 'act' && s.acted === 0);

  console.log('■ 4 推挤撞墙演出（中途帧）');
  // 场景测试改在双人模式跑：AI 模式会在白方(1号)行动后自动接管回合
  await page.evaluate(() => window.TTYKM_UI.goMenu());
  await page.click('#btn2P');
  await page.waitForTimeout(400);
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
  await page.waitForTimeout(400);
  await clickCell(0, 0);
  await page.waitForTimeout(150);
  await clickCell(0, 1);
  await page.waitForTimeout(1000);
  s = await st();
  expect('第1次行动后 acted=1', s.acted === 1 && s.stage === 'act');
  await clickCell(0, 2);
  await page.waitForTimeout(1000);
  s = await st();
  expect('两次行动进入 focus', s.stage === 'focus');
  await page.click('.fbtn[data-e="2"]');
  await page.waitForTimeout(500);
  s = await st();
  expect('换白方回合 select', s.turn === 1 && s.stage === 'select');
  await shot('m8-turn2.png');

  console.log('■ 9 AI 应手（白方整回合自动）');
  await page.evaluate(() => window.TTYKM_UI.goMenu());
  await page.click('#btnAI');
  await page.waitForTimeout(400);
  await clickCell(0, 0);
  await page.waitForTimeout(150);
  await clickCell(0, 1);
  await page.waitForTimeout(1000);
  await clickCell(0, 2);
  await page.waitForTimeout(1000);
  s = await st();
  if (s.stage === 'focus') { await page.click('.fbtn[data-e="2"]'); await page.waitForTimeout(600); }
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
    put(S, 0, 0, 0); put(S, 1, 0, 0); put(S, 2, 0, 0);
    put(S, 0, 15, 1); put(S, 1, 15, 1); put(S, 2, 15, 1);
    S.log.push(
      { no: 1, p: 0, text: '黑子3→2，黑1 撞墙出局' },
      { no: 1, p: 0, text: '黑子2→1，白1 撞墙出局' },
      { no: 1, p: 1, text: '白子15→14，白子穿越→未来14格（分身留现在）' },
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
    await dpage.click('#btnAI');
    await dpage.waitForTimeout(500);
    await dpage.click('.era[data-e="0"] .cell[data-i="0"]');
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
    await page.waitForTimeout(350);
    await clickCell(0, 0); await page.waitForTimeout(180);     // 黑1→2 行动1
    await clickCell(0, 1); await page.waitForTimeout(1100);
    await clickCell(0, 2); await page.waitForTimeout(1100);    // 行动2 → focus
    s = await stFull();
    expect('行动后自动写入存档', s.stage === 'focus' && await page.evaluate(() => !!localStorage.getItem(window.TTYKM_UI.saveKey)));
    const saved1 = await page.evaluate(() => JSON.parse(localStorage.getItem(window.TTYKM_UI.saveKey)));
    expect('存档含模式+引擎局面', saved1.mode === 'local2p' && saved1.S.turn === 0 && saved1.S.stage === 'focus' && saved1.S.turnNo === 1);
    await page.click('.fbtn[data-e="2"]');
    await page.waitForTimeout(700);
    s = await stFull();
    expect('移焦点换手后存档', s.turn === 1 && s.stage === 'select' && s.turnNo === 2);
    await page.reload();
    await page.waitForTimeout(700);
    expect('重载后直接进对局（跳过封面）', await page.evaluate(() =>
      document.getElementById('screen-menu').classList.contains('hidden') &&
      document.getElementById('screen-game').classList.contains('on')));
    s = await stFull();
    expect('局面完整恢复（白方第2回合 select，黑子已到3号格）', s.turn === 1 && s.stage === 'select' && s.turnNo === 2 &&
      await page.evaluate(() => { const c = window.TTYKM_UI.state().boards[0].cell; return c[2] && c[2].c === 0 && !c[1]; }));
    await clickCell(2, 15);                                     // 恢复后可继续下
    await page.waitForTimeout(250);
    s = await stFull();
    expect('恢复后交互可用（选中白子进 act）', s.stage === 'act' && s.sel && s.sel.era === 2);
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

  console.log('\n断言: ' + ok + '/' + total);
  await browser.close();
  if (errors.length) { console.log('\n页面错误:\n' + errors.join('\n')); process.exit(1); }
  if (ok < total) { console.log('部分断言未通过'); process.exit(1); }
  console.log('ALL OK');
}
main().catch(e => { console.error(e); process.exit(1); });
