/* ============================================================
   渗透因子 Infiltraitors · 截图走查（node test-shot.js）
   覆盖：菜单（弹孔装饰/读数）/ 配置抽屉（叛徒降档 · 5色恒严于4色联动）/ 开局布控演出 / 通讯判定印章（含摸牌选择）/
        推论板 / 潜伏摸牌抽屉（含牌库约束：摸 k 须牌库 ≥ k+1）/ 铲除指认与开枪演出（命中·落空·情报区揭示后清空）/
        拾牌抽屉 / 日志·弃牌·情报抽屉 / 弹药告急 / 夜枭整回合 / 胜负结算（含死局）/
        对局布局（顶栏·弹药条·日志顺序·贴底行动栏）/ 重置对局 /
        存档续玩（重载恢复 / 回菜单留档 / 继续任务 / 终局清档 / AI 断点续跑 / 演出中途刷新兜底）/
        桌面横排 / 判定飘字收尾不回闪 · 摸牌先飞后亮（虚拟时钟逐帧采样）/ 金路径：脚本代打到终局
   ============================================================ */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const SHOTS = path.join(ROOT, 'shots');
const MOBILE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 820 };
const URL = 'file://' + path.join(ROOT, 'index.html').replace(/\\/g, '/');

const G = require('./game.js');

const seeded = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

/* 摆局面：底稿是确定性 newGame，再覆写为「红3 是盯梢目标」的干净局 */
function scene(patch) {
  const S = G.newGame({ colors: 4, one: false, traitors: 7, extra: 3 }, seeded(11));
  S.turn = 0; S.turnNo = 3; S.round = 2;
  S.pending = null; S.over = null; S.openEvs = [];
  S.log.length = 0;
  S.aiWatch = G.mk(0, 3);                                 // 红 3
  S.traitorPile = [G.mk(1, 5), G.mk(2, 8), G.mk(3, 11), G.mk(0, 14), G.mk(1, 2), G.mk(2, 6)];
  S.hand = [G.mk(0, 9), G.mk(1, 4), G.mk(2, 12), G.mk(3, 7), G.mk(1, 10)];
  S.aiHand = [G.mk(0, 15), G.mk(2, 3), G.mk(3, 5)];
  S.intel = { rel: [G.mk(0, 9)], unrel: [G.mk(1, 4)] };
  S.discardUp = [G.mk(2, 2), G.mk(3, 6)];
  S.discardDown = [G.mk(1, 7)];
  S.bullets = 10; S.bulletsMax = 10; S.caught = 0;
  const used = new Set([...S.hand, ...S.aiHand, ...S.intel.rel, ...S.intel.unrel,
    ...S.traitorPile, S.aiWatch, ...S.discardUp, ...S.discardDown]);
  S.deck = G.combos(S.cfg).filter(id => !used.has(id));
  S.stat = { shots: 1, hits: 0, misses: 1, probes: 2, hints: 2, lurks: 1 };
  G.logPush(S, 'you', '你通讯【红9】：有关');
  G.logPush(S, 'ai', '夜枭情报【黄4】：无关');
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
  const setState2 = async (s, opts) => { await page.evaluate(a => window.INFIL_UI.setState(a.s, a.o), { s, o: opts || null }); await page.waitForTimeout(120); };
  const st = () => page.evaluate(() => {
    const S = window.INFIL_UI.state();
    if (!S) return null;
    return {
      turn: S.turn, turnNo: S.turnNo, round: S.round, pending: S.pending, over: S.over ? S.over.win : null,
      deck: S.deck.length, hand: S.hand.length, aiHand: S.aiHand.length, bullets: S.bullets,
      caught: S.caught, watch: S.aiWatch, intel: S.intel.rel.length + S.intel.unrel.length,
      down: S.discardDown.length, up: S.discardUp.length, left: G.traitorsLeft(S),
    };
  });
  const idle = async (to = 9000) => page.waitForFunction(() =>
    !window.INFIL_UI.busy() && document.getElementById('fx').children.length === 0, null, { timeout: to });
  const setFx = v => page.evaluate(x => window.INFIL_UI.setFx(x), v);

  await page.goto(URL);
  await page.waitForTimeout(420);

  console.log('■ 1 菜单：精简首页 + 弹孔装饰 + 难度读数');
  {
    const menu = await page.evaluate(() => {
      let bbox = -1;
      try { bbox = document.querySelector('#screen-menu .deco use').getBBox().width; } catch (e) { /* 取不到就只留 -1 */ }
      return {
        visible: !document.getElementById('screen-menu').classList.contains('hidden'),
        cfgHidden: document.getElementById('cfgMask').classList.contains('hidden'),
        start: !!document.getElementById('btnStart'),
        decos: document.querySelectorAll('#screen-menu svg.deco use').length,
        decoW: [...document.querySelectorAll('#screen-menu .deco')].map(el => el.getBoundingClientRect().width),
        bbox,
        meta: document.getElementById('menuMeta').textContent,
      };
    });
    expect('封面可见 · 首页不再直接铺配置面板', menu.visible && menu.cfgHidden && menu.start);
    expect('弹孔装饰 4 枚且都有尺寸', menu.decos === 4 && menu.decoW.every(w => w > 20));
    expect('弹孔图形已解析（use 有非零包围盒）', menu.bbox > 50);
    expect('菜单读数：牌库 39 · 叛徒 7 · 子弹 10 · 轻松', menu.meta.includes('39') && menu.meta.includes('10') && menu.meta.includes('轻松'));
    await shot('m1-menu.png');
  }

  console.log('■ 2 配置抽屉：【开始任务】进入 · 叛徒 8 降档 · 5 色恒严一档');
  {
    await page.click('#btnStart');
    await page.waitForTimeout(220);
    const open = await page.evaluate(() => ({
      mask: !document.getElementById('cfgMask').classList.contains('hidden'),
      colors: document.querySelectorAll('#cfgPanel .seg[data-k="colors"] button').length,
      one: document.querySelectorAll('#cfgPanel .seg[data-k="one"] button').length,
      traitors: [...document.querySelectorAll('#cfgPanel .seg[data-k="traitors"] button')].map(b => b.textContent),
      extra: [...document.querySelectorAll('#cfgPanel .seg[data-k="extra"] button')].map(b => b.textContent),
      clipped: [...document.querySelectorAll('#cfgPanel .cfg-row')].some(r => {
        const rb = r.getBoundingClientRect();
        return [...r.querySelectorAll('button')].some(b => {
          const q = b.getBoundingClientRect();
          return q.width <= 0 || q.left < rb.left - 1 || q.right > rb.right + 1;
        });
      }),
    }));
    expect('【开始任务】打开配置抽屉', open.mask);
    expect('颜色 / 数字 1 各 2 段', open.colors === 2 && open.one === 2);
    expect('叛徒 7~11 段', JSON.stringify(open.traitors) === JSON.stringify(['7', '8', '9', '10', '11']));
    expect('额外子弹 0~3 段', JSON.stringify(open.extra) === JSON.stringify(['0', '1', '2', '3']));
    expect('手机端配置行不挤爆、控件都在行内', !open.clipped);
    await shot('m2-cfg-open.png');
    await page.click('#cfgPanel .seg[data-k="traitors"] button:nth-child(2)');
    await page.waitForTimeout(150);
    const read = await page.evaluate(() => document.getElementById('cfgRead').textContent);
    expect('叛徒 8 → 牌库 38 · 标准（自轻松降档）', read.includes('38') && read.includes('标准'));
    await shot('m2-cfg-8.png');
    await page.click('#cfgPanel .seg[data-k="traitors"] button:nth-child(1)');   // 回 7
    await page.waitForTimeout(120);
    await page.click('#cfgPanel .seg[data-k="colors"] button:nth-child(2)');    // 5 色
    await page.waitForTimeout(150);
    const read5 = await page.evaluate(() => document.getElementById('cfgRead').textContent);
    expect('5色 7叛徒+3弹 → 牌库 53 · 标准（同配置 4色 轻松，恒严一档）',
      read5.includes('53') && read5.includes('标准'));
    await shot('m2b-cfg-5color.png');
    await page.click('#cfgPanel .seg[data-k="colors"] button:nth-child(1)');    // 回 4 色
    await page.waitForTimeout(120);
    await page.click('#btnCfgBack');
    await page.waitForTimeout(200);
    expect('返回后抽屉收起 · 留在封面', await page.evaluate(() =>
      document.getElementById('cfgMask').classList.contains('hidden') &&
      !document.getElementById('screen-menu').classList.contains('hidden')));
  }

  console.log('■ 3 规则速览');
  {
    await page.click('#btnRules');
    await page.waitForTimeout(280);
    expect('规则抽屉可见', await page.evaluate(() => !document.getElementById('rulesMask').classList.contains('hidden')));
    await shot('m3-rules.png');
    await page.click('#btnCloseRules');
    await page.waitForTimeout(200);
  }

  console.log('■ 4 开局：抽屉内开始任务 + 布控演出 + 桌面读数');
  {
    await page.evaluate(() => { Math.random = () => 0.37; });    // 确定性发牌与布控
    await page.click('#btnStart');
    await page.waitForTimeout(160);
    await page.click('#btnCfgGo');
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 4000 });
    const opening = await page.evaluate(() => ({
      turn: document.getElementById('turnsign').textContent,
      alert: document.getElementById('alertbar').textContent,
      alertOn: !document.getElementById('alertbar').classList.contains('hidden'),
    }));
    expect('开局布控演出期间顶部即点名夜枭（' + opening.turn + '）',
      opening.turn.includes('夜枭') && opening.alertOn && opening.alert.includes('夜枭正在行动'));
    await idle();
    const s = await st();
    expect('开局轮到玩家 · 夜枭已布控', s.turn === 0 && s.watch !== null);
    expect('牌库 39-1（布控暗弃）= 38', s.deck === 38 && s.down === 1);
    expect('开始后配置抽屉已收起', await page.evaluate(() => document.getElementById('cfgMask').classList.contains('hidden')));
    const dom = await page.evaluate(() => ({
      deck: document.getElementById('dcount').textContent,
      trait: document.getElementById('tcount').textContent,
      b: document.getElementById('bcount').textContent,
      pips: document.querySelectorAll('#pips i').length,
      pipsOn: document.querySelectorAll('#pips i:not(.spent)').length,
      caughtGone: document.getElementById('caughtTag') === null,
      lampOff: !document.getElementById('aiTurnLamp').classList.contains('on'),
      watch: document.getElementById('watchTag').textContent,
      turn: document.getElementById('turnsign').textContent,
      aiHand: document.getElementById('aiHandN').textContent,
    }));
    expect('顶栏读数：牌库 38 / 叛徒 7/7 / 子弹 10 发 10 芯', dom.deck === '38' && dom.trait === '7/7' && dom.b === '10' && dom.pips === 10 && dom.pipsOn === 10);
    expect('已铲除条目已移除 · 已布控 · 夜枭手牌 5', dom.caughtGone && dom.watch === '已布控' && dom.aiHand === '5');
    expect('回合指示为玩家', dom.turn.includes('你的回合'));
    expect('轮到你时夜枭回合标记熄灭', dom.lampOff);
    await shot('m4-open.png');
  }

  console.log('■ 4b 对局布局：顶栏四件套 · 弹药+推论在局内 · 日志在牌桌下 · 行动栏贴底');
  {
    const L = await page.evaluate(() => {
      const g = id => document.getElementById(id);
      const bar = g('topbar'), row = g('gunrow');
      const rect = el => el.getBoundingClientRect();
      const stage = g('screen-game');
      return {
        topIds: [...bar.querySelectorAll('button')].map(b => b.id),
        title: bar.querySelector('.tb-title').textContent,
        gunbarInTop: bar.contains(g('gunbar')), boardInTop: bar.contains(g('btnBoard')),
        gunbarInRow: row.contains(g('gunbar')), boardInRow: row.contains(g('btnBoard')),
        tableTop: rect(g('tablewrap')).top, noteTop: rect(g('notebar')).top, noteBottom: rect(g('notebar')).bottom,
        aiTop: rect(g('aiarea')).top, handTop: rect(g('handwrap')).top, actBottom: rect(g('actbar')).bottom,
        tableBottom: rect(g('tablewrap')).bottom, aiBottom: rect(g('aiarea')).bottom,
        overflow: stage.scrollHeight - stage.clientHeight, vh: innerHeight,
      };
    });
    expect('顶栏 = 菜单 / 游戏名 / 重置 / 规则', JSON.stringify(L.topIds) === JSON.stringify(['btnMenu', 'btnReset', 'btnRulesGame']) && L.title.includes('渗透因子'));
    expect('弹药条与【推论】已移入局内 #gunrow', L.gunbarInRow && L.boardInRow && !L.gunbarInTop && !L.boardInTop);
    expect('顺序：牌桌 → 日志 → 夜枭区 → 手牌', L.tableBottom <= L.noteTop + 1 && L.noteBottom <= L.aiTop + 1 && L.aiBottom <= L.handTop + 1);
    expect('手牌 + 行动栏整体贴底（不留大空隙）', L.vh - L.actBottom < 24);
    expect('对局界面无纵向溢出裁切', L.overflow <= 1);
    await shot('m4b-layout.png');
  }

  console.log('■ 5 选牌 + 通讯 → 摸牌选择（判定印章演出）');
  {
    await page.click('#hand .card:nth-child(2)');
    await page.waitForTimeout(160);
    expect('选中的手牌抬起（.pick）', await page.evaluate(() => !!document.querySelector('#hand .card.pick')));
    await shot('m5-select.png');
    await page.click('#btnProbe');
    await page.waitForTimeout(430);                       // 截在飞行途中/印章将落
    await shot('m6-probe-fx.png');
    await idle();
    const d1 = await page.evaluate(() => ({
      mask: !document.getElementById('drawMask').classList.contains('hidden'),
      info: document.getElementById('drawInfo').textContent,
      hand: window.INFIL_UI.state().hand.length,
      deck: window.INFIL_UI.state().deck.length,
      turn: window.INFIL_UI.state().turn,
      pending: window.INFIL_UI.state().pending,
    }));
    expect('通讯后弹出摸牌选择抽屉（未摸牌：手牌 4 / 牌库 38 / 仍在玩家回合）',
      d1.mask && d1.pending === 'draw' && d1.hand === 4 && d1.deck === 38 && d1.turn === 0);
    expect('抽屉读数含「牌库剩余」与张数', d1.info.includes('牌库剩余') && d1.info.includes('38'));
    await shot('m6b-draw-choose.png');
    await page.mouse.click(12, 40);                       // 摸牌是必选阶段
    await page.waitForTimeout(180);
    expect('摸牌是必选阶段：点遮罩不收起', await page.evaluate(() => !document.getElementById('drawMask').classList.contains('hidden')));
    await page.click('#btnDrawTake');
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 4000 });
    const midDraw = await page.evaluate(() => ({
      turn: document.getElementById('turnsign').textContent,
      engine: window.INFIL_UI.state().turn,
    }));
    expect('摸牌飞行期间顶部仍是你的回合（引擎已换手 ' + midDraw.engine + '，显示不提前交棒）',
      midDraw.engine === 1 && midDraw.turn.includes('你的回合'));
    await idle();
    const s = await st();
    expect('摸 1 张后：情报 +1（含夜枭随后的情报）', s.intel === 2);
    expect('摸 1 张后：手牌回 5 · 牌库 -1', s.hand === 5 && s.deck === 37);
    expect('玩家回合仍在自己手上（AI 已走完）', s.turn === 0);
    const dom = await page.evaluate(() => ({
      rel: document.querySelectorAll('#relCards .card').length,
      unrel: document.querySelectorAll('#unrelCards .card').length,
      nb: document.getElementById('nbText').textContent,
      tip: document.getElementById('handtip').classList.contains('hidden'),
    }));
    expect('情报区两行有牌 · 提示条更新', dom.rel + dom.unrel === 2 && dom.nb.length > 0);
    await shot('m7-probe-done.png');
  }

  console.log('■ 6 推论板：自动分析开关');
  {
    await page.click('#btnBoard');
    await page.waitForTimeout(260);
    const b1 = await page.evaluate(() => ({
      cand: +document.getElementById('candN').textContent,
      cells: document.querySelectorAll('#boardGrid .bcell.cand').length,
      judge: document.querySelectorAll('#boardGrid .bcell.judge').length,
      hand: document.querySelectorAll('#boardGrid .bcell.hand').length,
      auto: document.getElementById('autoChk').checked,
    }));
    expect('自动分析默认开启', b1.auto);
    expect('候选格数与读数一致', b1.cand === b1.cells && b1.cand > 0 && b1.cand < 56);
    expect('手牌 5 格标出 · 存在判定冲突格', b1.hand === 5 && b1.judge > 0);
    await shot('m8-board-auto.png');
    await page.evaluate(() => { const c = document.getElementById('autoChk'); c.checked = false; c.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(220);
    const b2 = await page.evaluate(() => ({
      cand: +document.getElementById('candN').textContent,
      judge: document.querySelectorAll('#boardGrid .bcell.judge').length,
    }));
    expect('关闭自动分析 → 候选变多且无判定冲突', b2.cand > b1.cand && b2.judge === 0);
    await shot('m9-board-manual.png');
    await page.evaluate(() => { const c = document.getElementById('autoChk'); c.checked = true; c.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(160);
    await page.click('#btnCloseBoard');
    await page.waitForTimeout(140);
  }

  console.log('■ 7 潜伏抽屉（摸牌数可选）');
  {
    await page.click('#btnLurk');
    await page.waitForTimeout(240);
    const l = await page.evaluate(() => ({
      open: !document.getElementById('lurkMask').classList.contains('hidden'),
      n: document.querySelectorAll('#lurkOpts .lurk-opt').length,
      txt: document.querySelector('#lurkOpts .lurk-opt').textContent,
    }));
    expect('潜伏抽屉 2 个选项（手牌 5 → 最多补 2）', l.open && l.n === 2 && l.txt.includes('摸 1'));
    await shot('m10-lurk.png');
    const before = await st();
    await page.click('#lurkOpts .lurk-opt:nth-child(2)');
    await idle();
    const after = await st();
    expect('潜伏摸 2 暗弃 1：手牌 5→7 · 牌库 -3', after.hand === 7 && before.deck - after.deck === 3);
    expect('潜伏把回合交给夜枭后收回', after.turn === 0 && after.turnNo === before.turnNo + 2);
    const row = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#hand .card')];
      const rs = cards.map(c => c.getBoundingClientRect());
      const hb = document.getElementById('hand').getBoundingClientRect();
      const top = rs[0].top;
      return {
        n: cards.length,
        oneRow: rs.every(r => Math.abs(r.top - top) < 1),
        inside: rs[0].left >= hb.left - 1 && rs[rs.length - 1].right <= hb.right + 1,
        w: Math.round(rs[0].width),
        z: getComputedStyle(cards[0]).zoom,
      };
    });
    expect('7 张手牌单行放下且不溢出（整行缩放 ' + row.w + 'px · zoom ' + row.z + '）',
      row.n === 7 && row.oneRow && row.inside && row.w < 56 && parseFloat(row.z) < 1);
    await shot('m10b-hand-seven.png');
  }

  console.log('■ 7b 潜伏的牌库约束（必暗弃 1 张）');
  {
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.INFIL_UI.state())));
    /* 牌库剩 2：只能摸 1（摸完必须留 1 张给暗弃） */
    const s2 = scene(); s2.deck = s2.deck.slice(-2);
    await setState2(s2);
    const l2 = await page.evaluate(() => ({
      dis: document.getElementById('btnLurk').disabled,
      label: document.querySelector('#btnLurk span').textContent,
      max: window.INFIL.playerActions(window.INFIL_UI.state()).lurkMax,
    }));
    expect('牌库 2 张：潜伏可用 · 只提供摸 1（不出现摸 2/3）',
      !l2.dis && l2.max === 1 && l2.label.includes('摸 1') && !/摸 1~[23]/.test(l2.label));
    await page.click('#btnLurk');
    await page.waitForTimeout(220);
    const l3 = await page.evaluate(() => ({
      open: !document.getElementById('lurkMask').classList.contains('hidden'),
      n: document.querySelectorAll('#lurkOpts .lurk-opt').length,
      txt: document.querySelector('#lurkOpts .lurk-opt').textContent,
    }));
    expect('抽屉只有 1 个选项（不提供摸 2 / 摸 3）', l3.open && l3.n === 1 && l3.txt.includes('牌库 -2'));
    await shot('m10c-lurk-deck2.png');
    const b2 = await st();
    await page.click('#lurkOpts .lurk-opt');
    await idle();
    const a2 = await st();
    expect('摸 1 暗弃 1：手牌 5→6 · 牌库 2→0 · 暗弃 +1', a2.hand === 6 && a2.deck === 0 && a2.down === b2.down + 1);
    /* 牌库剩 1：潜伏整体不可用 */
    const s1 = scene(); s1.deck = s1.deck.slice(-1);
    await setState2(s1);
    const l1 = await page.evaluate(() => ({
      dis: document.getElementById('btnLurk').disabled,
      label: document.querySelector('#btnLurk span').textContent,
      max: window.INFIL.playerActions(window.INFIL_UI.state()).lurkMax,
    }));
    expect('牌库 1 张：潜伏禁用 · 按钮标「牌库不足」', l1.dis && l1.max === 0 && l1.label.includes('牌库不足'));
    /* 引擎侧钳制（不依赖 UI） */
    const sc = scene(); sc.deck = sc.deck.slice(-2);
    const r = G.playerLurk(sc, 3);
    expect('引擎：牌库 2 传入摸 3 → 钳到摸 1 · 牌库清 0 · 暗弃 +1',
      r.ok && r.evs[0].cards.length === 1 && sc.deck.length === 0 && sc.discardDown.length === 2);
    const sc1 = scene(); sc1.deck = sc1.deck.slice(-1);
    expect('引擎：牌库 1 张 → 潜伏拒绝且牌库不动',
      G.playerLurk(sc1, 1).ok === false && sc1.deck.length === 1);
    await setState2(saved);
  }

  console.log('■ 8 铲除抽屉：色 + 数 指认');
  {
    await page.click('#btnElim');
    await page.waitForTimeout(240);
    const e1 = await page.evaluate(() => ({
      open: !document.getElementById('elimMask').classList.contains('hidden'),
      pc: document.querySelectorAll('#pickColors .pc').length,
      pn: document.querySelectorAll('#pickNums .pn').length,
      fire: document.getElementById('btnFire').disabled,
      state: document.getElementById('pickState').textContent,
    }));
    expect('铲除抽屉：4 色块 · 14 数字格（不含 1）', e1.open && e1.pc === 4 && e1.pn === 14);
    expect('未选完时开枪禁用', e1.fire && e1.state.includes('未选择'));
    await page.click('#pickColors .pc[data-c="0"]');
    await page.click('#pickNums .pn[data-n="3"]');
    await page.waitForTimeout(160);
    const e2 = await page.evaluate(() => ({
      fire: document.getElementById('btnFire').disabled,
      state: document.getElementById('pickState').textContent,
    }));
    expect('选中红 3 → 可开枪 · 显示耗弹', !e2.fire && e2.state.includes('红 3') && e2.state.includes('10'));
    await shot('m11-elim-pick.png');
    await page.click('#btnCancelElim');
    await page.waitForTimeout(160);
    expect('“再想想”取消后抽屉关闭', await page.evaluate(() => document.getElementById('elimMask').classList.contains('hidden')));
  }

  console.log('■ 9 铲除命中：开枪 → 公示 → 冲刷 → 洗回 → 拾牌');
  {
    await setState2(scene({ turn: 0 }), { live: true });
    await page.click('#btnElim');
    await page.waitForTimeout(200);
    await page.click('#pickColors .pc[data-c="0"]');
    await page.click('#pickNums .pn[data-n="3"]');
    await page.evaluate(() => {                           // 记录横幅从出现到消失的完整视觉占位（缩放全过程）
      window.__bp = null;
      const track = el => {
        const acc = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity, w: innerWidth, h: innerHeight };
        window.__bp = acc;
        (function step() {
          const r = el.getBoundingClientRect();
          acc.l = Math.min(acc.l, r.left); acc.t = Math.min(acc.t, r.top);
          acc.r = Math.max(acc.r, r.right); acc.b = Math.max(acc.b, r.bottom);
          if (el.isConnected) requestAnimationFrame(step);
        })();
      };
      new MutationObserver(muts => {
        for (const m of muts) for (const n of m.addedNodes)
          if (n.nodeType === 1 && n.classList.contains('banner')) { track(n); return; }
      }).observe(document.getElementById('fx'), { childList: true });
    });
    await page.click('#btnFire');
    await page.waitForTimeout(560);                       // 手枪滑入 + 枪口火光 + 弹道
    await shot('m12-shot-mid.png');
    await page.waitForTimeout(560);                       // 公示 + 铲除印章
    await shot('m13-kill-stamp.png');
    const ghost = await page.evaluate(() => ({
      frozen: document.querySelectorAll('#fx .intel-ghost').length,
      live: document.querySelectorAll('#relCards .card, #unrelCards .card').length,
    }));
    expect('揭示阶段：情报区副本冻结在 fx 层（2 张）· DOM 行已清空', ghost.frozen === 2 && ghost.live === 0);
    await page.waitForSelector('#fx .banner', { timeout: 5000 });
    await page.waitForTimeout(300);                       // 横幅缩放到全尺寸
    await shot('m13b-banner.png');
    await page.waitForFunction(() => window.INFIL_UI.state().pending === 'reward' && !window.INFIL_UI.busy(), null, { timeout: 9000 });
    const ghostsLeft = await page.evaluate(() => document.querySelectorAll('#fx .intel-ghost').length);
    expect('清扫完成后情报区副本已全部移除', ghostsLeft === 0);
    const bp = await page.evaluate(() => window.__bp);
    expect('「重新混入人群」横幅全程落在视口内', !!bp && bp.l >= -0.5 && bp.t >= -0.5 && bp.r <= bp.w + 0.5 && bp.b <= bp.h + 0.5);
    const s = await st();
    expect('命中：铲除数 1 · 目标清空 · 子弹 9', s.caught === 1 && s.watch === null && s.bullets === 9);
    expect('情报区冲刷进明弃 · 叛徒洗回牌库', s.intel === 0 && s.up >= 4);
    expect('进入拾牌阶段', s.pending === 'reward');
    const rw = await page.evaluate(() => ({
      open: !document.getElementById('rewardMask').classList.contains('hidden'),
      cards: document.querySelectorAll('#rewardUp .card[data-i]').length,
      blind: document.getElementById('btnBlind').disabled,
      handN: document.getElementById('rewardHandN').textContent,
      handCards: document.querySelectorAll('#rewardHand .card').length,
    }));
    expect('拾牌抽屉自动弹出：明弃可选 · 盲抽可用', rw.open && rw.cards >= 4 && !rw.blind);
    expect('抽屉底部独立展示你的手牌（' + rw.handN + '）', rw.handN === s.hand + '/7' && rw.handCards === s.hand);
    await page.mouse.click(12, 40);                       // 点遮罩空白
    await page.waitForTimeout(180);
    expect('拾牌是必选阶段：点遮罩不收起', await page.evaluate(() => !document.getElementById('rewardMask').classList.contains('hidden')));
    await shot('m14-reward.png');
    const before = await st();
    await page.click('#rewardUp .card[data-i="0"]');
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 4000 });
    const picking = await page.evaluate(() => ({
      turn: document.getElementById('turnsign').textContent,
      engine: window.INFIL_UI.state().turn,
    }));
    expect('拾牌飞行期间顶部仍是你的回合（引擎已换手 ' + picking.engine + '，显示不提前交棒）',
      picking.engine === 1 && picking.turn.includes('你的回合'));
    let handover = false;
    try {
      await page.waitForFunction(() => window.INFIL_UI.state().turn === 1 &&
        document.getElementById('turnsign').textContent.includes('夜枭'), null, { timeout: 9000 });
      handover = true;
    } catch (e) { /* 超时即断言失败 */ }
    expect('拾牌演出结束、回合交还后才切换夜枭', handover);
    await idle();
    const after = await st();
    expect('拾取明弃 1 张 → 手牌 +1 · 阶段结束', after.hand === before.hand + 1 && after.pending === null);

    /* 满手牌（无可拾取）命中：结算演出期间也不得提前交棒 */
    const full = [G.mk(0, 9), G.mk(1, 4), G.mk(2, 12), G.mk(3, 7), G.mk(1, 10), G.mk(0, 2), G.mk(2, 5)];
    await setState2(scene({ turn: 0, hand: full }), { live: true });
    await page.click('#btnElim');
    await page.waitForTimeout(200);
    await page.click('#pickColors .pc[data-c="0"]');
    await page.click('#pickNums .pn[data-n="3"]');
    await page.click('#btnFire');
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 4000 });
    const settle = await page.evaluate(() => ({
      turn: document.getElementById('turnsign').textContent,
      engine: window.INFIL_UI.state().turn,
      pending: window.INFIL_UI.state().pending,
    }));
    expect('满手命中结算期间顶部仍是你的回合（引擎已换手 ' + settle.engine + '）',
      settle.engine === 1 && settle.pending === null && settle.turn.includes('你的回合'));
    let backToAi = false;
    try {
      await page.waitForFunction(() => document.getElementById('turnsign').textContent.includes('夜枭'), null, { timeout: 9000 });
      backToAi = true;
    } catch (e) { /* 超时即断言失败 */ }
    expect('结算演出结束后才切换夜枭', backToAi);
  }

  console.log('■ 10 铲除落空：弹道飞偏 + 弹芯变空壳');
  {
    await setState2(scene({ turn: 0 }), { live: true });
    await page.click('#btnElim');
    await page.waitForTimeout(200);
    await page.click('#pickColors .pc[data-c="1"]');
    await page.click('#pickNums .pn[data-n="4"]');
    await page.click('#btnFire');
    await page.waitForTimeout(600);
    await shot('m15-miss-mid.png');
    await idle();
    const s = await st();
    expect('落空：子弹 9 · 目标仍在 · 铲除数 0', s.bullets === 9 && s.watch !== null && s.caught === 0);
    const dom = await page.evaluate(() => ({
      spent: document.querySelectorAll('#pips i.spent').length,
      b: document.getElementById('bcount').textContent,
      logged: window.INFIL_UI.state().log.some(l => l.text.includes('铲除落空')),
    }));
    expect('弹芯点阵少 1 · 读数 9 · 日志记落空', dom.spent === 1 && dom.b === '9' && dom.logged);
    await shot('m16-miss-done.png');
  }

  console.log('■ 11 弹药告急提示条');
  {
    await setState2(scene({ bullets: 5 }));
    const dom = await page.evaluate(() => ({
      vis: !document.getElementById('alertbar').classList.contains('hidden'),
      txt: document.getElementById('alertbar').textContent,
      low: document.getElementById('gunbar').classList.contains('low'),
    }));
    expect('子弹 5 < 7 名叛徒 → 告急条 + 枪栏红闪', dom.vis && dom.txt.includes('弹药告急') && dom.low);
    await shot('m17-alert.png');
  }

  console.log('■ 12 夜枭整回合（真实 AI 驱动）');
  {
    await setState2(scene({ turn: 1, aiHand: [G.mk(0, 15), G.mk(2, 3), G.mk(3, 5)] }), { live: true });
    await page.waitForTimeout(240);
    const dom = await page.evaluate(() => ({
      vis: !document.getElementById('alertbar').classList.contains('hidden'),
      txt: document.getElementById('alertbar').textContent,
      turn: document.getElementById('turnsign').textContent,
      lampOn: document.getElementById('aiTurnLamp').classList.contains('on'),
    }));
    expect('夜枭行动中：提示条点名 · 回合标记亮起', dom.vis && dom.txt.includes('夜枭正在行动') && dom.turn.includes('夜枭') && dom.lampOn);
    await shot('m18-ai-turn.png');
    await page.waitForFunction(() => {
      const S = window.INFIL_UI.state();
      return !window.INFIL_UI.busy() && S.turn === 0;
    }, null, { timeout: 12000 });
    const s = await st();
    expect('AI 打出一张情报后交还回合', s.turn === 0 && s.turnNo === 4 && s.aiHand === 2 && s.intel === 3);
    expect('夜枭手牌计数随出牌更新为 2', await page.evaluate(() => document.getElementById('aiHandN').textContent === '2'));
    expect('交还回合后夜枭标记熄灭', await page.evaluate(() => !document.getElementById('aiTurnLamp').classList.contains('on')));
    await shot('m19-ai-done.png');
  }

  console.log('■ 13 抽屉三连：日志 / 弃牌堆 / 情报明细');
  {
    await page.click('#notebar');
    await page.waitForTimeout(240);
    const log = await page.evaluate(() => ({
      open: !document.getElementById('logMask').classList.contains('hidden'),
      n: document.querySelectorAll('#logList .log-item').length,
      first: document.querySelector('#logList .log-item').textContent,
      who: document.querySelector('#logList .log-item').className,
    }));
    expect('日志抽屉倒序：最新在前', log.open && log.n >= 3 && log.first.includes('夜枭'));
    expect('日志条目带行动方标记', log.who.includes('ai') || log.who.includes('you'));
    await shot('m20-log.png');
    await page.click('#btnCloseLog');
    await page.waitForTimeout(140);

    await setState2(scene({                             // 单色 9 张的拥挤明弃堆
      discardUp: [G.mk(2, 2), G.mk(2, 3), G.mk(2, 5), G.mk(2, 7), G.mk(2, 9), G.mk(2, 11), G.mk(2, 12), G.mk(2, 14), G.mk(2, 15), G.mk(0, 6), G.mk(0, 10)],
      discardDown: [G.mk(1, 7), G.mk(1, 8)],
    }), { live: true });
    await page.click('#pileUp');
    await page.waitForTimeout(220);
    const disc = await page.evaluate(() => {
      const group = [...document.querySelectorAll('#discUp .dgroup')]
        .reduce((a, b) => a.querySelectorAll('.card').length >= b.querySelectorAll('.card').length ? a : b);
      const cards = [...group.querySelectorAll('.card')];
      const sheet = document.querySelector('#discMask .sheet');
      const up = document.getElementById('discUp');
      return {
        open: !document.getElementById('discMask').classList.contains('hidden'),
        groups: document.querySelectorAll('#discUp .dgroup').length,
        nums: [...document.querySelectorAll('#discUp .dgroup')].map(g => [...g.querySelectorAll('.num')].map(x => +x.textContent)),
        down: document.getElementById('discDownN').textContent,
        crowded: cards.length, lines: new Set(cards.map(c => c.offsetTop)).size,
        over: Math.max(sheet.scrollWidth - sheet.clientWidth, up.scrollWidth - up.clientWidth),
      };
    });
    expect('弃牌堆：明弃按色分组', disc.open && disc.groups >= 2);
    expect('组内数字升序', disc.nums.every(a => a.every((v, i) => i === 0 || a[i - 1] <= v)));
    expect('暗弃只报张数', disc.down.includes('张'));
    expect('同色 9 张自动换行（多行且不横向溢出）', disc.crowded >= 9 && disc.lines >= 2 && disc.over <= 1);
    await shot('m21-disc.png');
    await page.click('#discSub');                        // 点抽屉内部不收起
    await page.waitForTimeout(160);
    expect('点抽屉内部不收起', await page.evaluate(() => !document.getElementById('discMask').classList.contains('hidden')));
    await page.mouse.click(12, 40);                      // 点遮罩空白收起
    await page.waitForTimeout(180);
    expect('点遮罩空白收起抽屉', await page.evaluate(() => document.getElementById('discMask').classList.contains('hidden')));
    await page.click('#pileUp');
    await page.waitForTimeout(220);
    await page.click('#btnCloseDisc');
    await page.waitForTimeout(140);

    await page.click('#rowRel');
    await page.waitForTimeout(220);
    expect('情报明细：列出有关牌 + 规则副题', await page.evaluate(() =>
      !document.getElementById('intelMask').classList.contains('hidden') &&
      document.querySelectorAll('#intelBody .zone-cards .card').length > 0 &&
      document.getElementById('intelSub').textContent.includes('同色')));
    await shot('m22-intel.png');
    await page.click('#btnCloseIntel');
    await page.waitForTimeout(140);
  }

  console.log('■ 14 提示改吐司：未选牌点通讯 / 点牌堆');
  {
    const nbBefore = await page.evaluate(() => document.getElementById('nbText').textContent);
    await page.click('#btnProbe');                        // 未选牌 → 吐司提示
    await page.waitForTimeout(200);
    const t1 = await page.evaluate(() => {
      const wrap = document.getElementById('toasts');
      const el = wrap.lastElementChild;
      return {
        n: wrap.children.length, txt: el ? el.textContent : '',
        nb: document.getElementById('nbText').textContent,
        warn: document.getElementById('notebar').classList.contains('warn'),
      };
    });
    expect('未选牌点通讯 → 吐司「先选中一张手牌」', t1.n >= 1 && t1.txt.includes('先选中一张手牌'));
    expect('吐司不劫持日志条（文案与警告态都不变）', t1.nb === nbBefore && !t1.warn);
    await shot('m23-toast.png');
    await page.click('#pileDeck');                        // 不同文案：新吐司接续堆叠
    await page.waitForTimeout(200);
    const t2 = await page.evaluate(() => {
      const wrap = document.getElementById('toasts');
      return { n: wrap.children.length, txt: wrap.lastElementChild ? wrap.lastElementChild.textContent : '' };
    });
    expect('点牌库 → 吐司追加「牌库剩」', t2.n >= 2 && t2.txt.includes('牌库剩'));
    await page.waitForTimeout(2700);                      // 自动消隐 + 淡出移除
    expect('吐司自动消隐不残留', await page.evaluate(() => document.getElementById('toasts').children.length === 0));
  }

  console.log('■ 15 结算：胜利 / 失败');
  {
    const W = scene({ caught: 7, aiWatch: null, traitorPile: [], hand: [], aiHand: [] });
    W.over = { win: true, why: 'done', stats: G.statLine(W) };
    await setState2(W, { live: true });
    await page.waitForTimeout(280);
    const w = await page.evaluate(() => ({
      open: !document.getElementById('overlay-win').classList.contains('hidden'),
      stamp: document.querySelector('.win-stamp') ? document.querySelector('.win-stamp').textContent : '',
      cls: document.querySelector('.win-stamp') ? document.querySelector('.win-stamp').className : '',
      dots: document.querySelectorAll('.vs-dots i.on').length,
      why: document.querySelector('.win-why').textContent,
    }));
    expect('胜利结算：任务成功 + 7 芯全亮', w.open && w.stamp.includes('任务成功') && w.cls.includes('ok') && w.dots === 7);
    expect('终局自动清档（结算后没有可续的对局）', await page.evaluate(() => localStorage.getItem(window.INFIL_UI.saveKey) === null));
    await shot('m24-win.png');

    await page.mouse.click(12, 40);                       // 点结算遮罩空白处
    await page.waitForTimeout(180);
    expect('结算弹窗可点遮罩收起', await page.evaluate(() => document.getElementById('overlay-win').classList.contains('hidden')));
    await page.click('#notebar');
    await page.waitForTimeout(160);
    const logOpen = await page.evaluate(() => !document.getElementById('logMask').classList.contains('hidden'));
    await page.click('#btnCloseLog');
    await page.waitForTimeout(140);
    await page.click('#btnBoard');
    await page.waitForTimeout(160);
    const boardOpen = await page.evaluate(() => !document.getElementById('boardMask').classList.contains('hidden'));
    await page.click('#btnCloseBoard');
    await page.waitForTimeout(140);
    expect('收起结算后日志与推论板可自由查看', logOpen && boardOpen);

    const L = scene({ bullets: 0, aiWatch: G.mk(0, 3), caught: 0 });
    L.over = { win: false, why: 'bullets', stats: G.statLine(L) };
    await page.evaluate(() => document.getElementById('overlay-win').classList.add('hidden'));
    await setState2(L, { live: true });
    await page.waitForTimeout(280);
    const lz = await page.evaluate(() => ({
      stamp: document.querySelector('.win-stamp') ? document.querySelector('.win-stamp').textContent : '',
      cls: document.querySelector('.win-stamp') ? document.querySelector('.win-stamp').className : '',
      why: document.querySelector('.win-why').textContent,
    }));
    expect('失败结算：任务失败 + 说明弹药告急', lz.stamp.includes('任务失败') && lz.cls.includes('no') && lz.why.includes('弹药告急'));
    await shot('m25-lose.png');

    const K = scene({ aiWatch: null, traitorPile: [G.mk(1, 5)], hand: [], aiHand: [], deck: [], caught: 6 });
    K.over = { win: false, why: 'stuck', stats: G.statLine(K) };
    await page.evaluate(() => document.getElementById('overlay-win').classList.add('hidden'));
    await setState2(K, { live: true });
    await page.waitForTimeout(280);
    const kz = await page.evaluate(() => ({
      stamp: document.querySelector('.win-stamp') ? document.querySelector('.win-stamp').textContent : '',
      why: document.querySelector('.win-why').textContent,
    }));
    expect('失败结算：死局（五类行动全不可执行）· 说明剩余叛徒', kz.stamp.includes('任务失败') && kz.why.includes('死局') && kz.why.includes('1 名叛徒'));
    await shot('m25b-stuck.png');
  }

  console.log('■ 16 存档续玩：重载恢复 / 回菜单留档 → 继续任务回到牌局');
  {
    await page.evaluate(() => { window.INFIL_UI.clear(); window.INFIL_UI.goMenu(); });
    await page.evaluate(() => { Math.random = () => 0.37; });
    await setFx(false);
    await page.click('#btnStart');
    await page.waitForTimeout(160);
    await page.click('#btnCfgGo');
    await page.waitForFunction(() => !window.INFIL_UI.busy(), null, { timeout: 8000 });
    await page.evaluate(async () => { await window.INFIL_UI.doAct({ act: 'probe', idx: 0 }); });
    const mid = await page.evaluate(() => ({
      pending: window.INFIL_UI.state().pending,
      saved: JSON.parse(localStorage.getItem(window.INFIL_UI.saveKey)).S.pending,
      mask: !document.getElementById('drawMask').classList.contains('hidden'),
    }));
    expect('待选摸牌时就已落盘（存档含 pending=draw）并弹出选择抽屉', mid.pending === 'draw' && mid.saved === 'draw' && mid.mask);
    await page.evaluate(async () => { await window.INFIL_UI.doAct({ act: 'draw', take: true }); });
    await page.waitForFunction(() => !window.INFIL_UI.busy() && window.INFIL_UI.state().turn === 0, null, { timeout: 9000 });
    const saved = await st();
    const hasSave = await page.evaluate(() => !!localStorage.getItem(window.INFIL_UI.saveKey));
    expect('每次行动后即落盘', hasSave && saved.turnNo >= 3);
    await page.reload();
    await page.waitForTimeout(520);
    const rs = await st();
    expect('重载后直接进对局（跳过封面）', await page.evaluate(() =>
      document.getElementById('screen-menu').classList.contains('hidden') &&
      document.getElementById('screen-game').classList.contains('on')));
    expect('局面完整恢复（回合/牌库/手牌/情报）',
      rs.turn === saved.turn && rs.turnNo === saved.turnNo && rs.deck === saved.deck &&
      rs.hand === saved.hand && rs.intel === saved.intel && rs.caught === saved.caught);
    await page.evaluate(() => window.INFIL_UI.setFx(true));
    await shot('m26-resume.png');

    // 回菜单：档保留 + 入口可见
    await page.evaluate(() => window.INFIL_UI.goMenu());
    await page.waitForTimeout(200);
    const back = await page.evaluate(() => ({
      save: localStorage.getItem(window.INFIL_UI.saveKey) !== null,
      resume: !document.getElementById('btnResume').classList.contains('hidden'),
      sub: document.getElementById('resumeSub').textContent,
      cfgHidden: document.getElementById('cfgMask').classList.contains('hidden'),
      primary: document.getElementById('btnResume').classList.contains('primary') &&
        !document.getElementById('btnStart').classList.contains('primary'),
    }));
    expect('回菜单后存档仍在', back.save);
    expect('【继续任务】入口出现并带进度副标题', back.resume && back.sub.includes('轮') && back.sub.includes('/7'));
    expect('有存档时【继续任务】升为主按钮', back.primary);
    await shot('m27-menu-save.png');

    // 继续任务：原样回到牌局
    await page.click('#btnResume');
    await page.waitForTimeout(420);
    const rs2 = await st();
    const dom2 = await page.evaluate(() => ({
      game: document.getElementById('screen-game').classList.contains('on'),
      menu: document.getElementById('screen-menu').classList.contains('hidden'),
    }));
    expect('【继续任务】原样回到牌局', dom2.game && dom2.menu &&
      rs2.turn === saved.turn && rs2.turnNo === saved.turnNo && rs2.deck === saved.deck &&
      rs2.hand === saved.hand && rs2.intel === saved.intel);
    await shot('m28-resumed.png');
  }

  console.log('■ 16b 重置对局：确认后按当前配置重开（不弹结算）');
  {
    const before = await st();
    await page.click('#btnReset');
    await page.waitForTimeout(220);
    expect('【重置】弹出确认抽屉', await page.evaluate(() => !document.getElementById('resetMask').classList.contains('hidden')));
    await shot('m29-reset.png');
    await page.click('#btnResetBack');
    await page.waitForTimeout(180);
    expect('取消 → 抽屉收起 · 局面不变', await page.evaluate(() => document.getElementById('resetMask').classList.contains('hidden')) &&
      JSON.stringify(await st()) === JSON.stringify(before));
    await page.click('#btnReset');
    await page.waitForTimeout(180);
    await setFx(false);
    await page.click('#btnResetGo');
    await page.waitForFunction(() => !window.INFIL_UI.busy() && window.INFIL_UI.state().turn === 0, null, { timeout: 9000 });
    const after = await st();
    expect('确认 → 全新一局（第 1 轮 · 铲除 0 · 牌库回满）', after.round === 1 && after.caught === 0 && after.deck === 38 && after.turnNo <= 3);
    expect('重置后不弹结算面板', await page.evaluate(() => document.getElementById('overlay-win').classList.contains('hidden')));
    await setFx(true);
    await shot('m30-reset-new.png');
    await page.evaluate(() => window.INFIL_UI.goMenu());
    await page.waitForTimeout(160);
  }

  console.log('■ 17 断点续跑：AI 回合中途存档 → 重载自动走完');
  {
    await page.evaluate(() => {
      const UI = window.INFIL_UI;
      const S = window.INFIL.newGame({ colors: 4, one: false, traitors: 7, extra: 3 }, () => 0.42);
      S.turn = 1; S.turnNo = 4; S.openEvs = [];
      localStorage.setItem(UI.saveKey, JSON.stringify({ v: 1, S, cfg: S.cfg }));
    });
    await page.reload();
    await page.waitForFunction(() => {
      const S = window.INFIL_UI.state();
      return S && !window.INFIL_UI.busy() && S.turn === 0;
    }, null, { timeout: 12000 });
    const rs = await st();
    expect('AI 断点回合被自动续跑并交还玩家', rs.turn === 0 && rs.turnNo === 5);
    const savedTurn = await page.evaluate(() => JSON.parse(localStorage.getItem(window.INFIL_UI.saveKey)).S.turnNo);
    expect('续跑后同步存档', savedTurn === 5);
    await page.evaluate(() => window.INFIL_UI.clear());
  }

  console.log('■ 18 金路径：脚本代打整局（玩家用参考打法，夜枭走真实流程）');
  {
    await setFx(false);
    await page.evaluate(() => { Math.random = () => 0.37; window.INFIL_UI.goMenu(); });
    await page.click('#btnStart');
    await page.waitForTimeout(160);
    await page.click('#btnCfgGo');
    await page.waitForFunction(() => !window.INFIL_UI.busy(), null, { timeout: 9000 });
    const res = await page.evaluate(async () => {
      const G = window.INFIL, UI = window.INFIL_UI;
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 900; i++) {
        const S = UI.state();
        if (!S || S.over) break;
        if (UI.busy()) { await wait(25); continue; }
        if (S.pending === 'reward') { await UI.doAct({ act: 'skip' }); continue; }
        if (S.turn === 0) {
          const a = G.autoPlayerAct(S);
          if (!a) break;
          await UI.doAct(a);
        } else { await wait(30); }
      }
      const S = UI.state();
      return { over: !!S.over, win: S.over ? S.over.win : null, why: S.over ? S.over.why : null, rounds: S.round, caught: S.caught, deck: S.deck.length };
    });
    expect('代打整局跑到终局（无异常中断）', res.over && res.rounds > 3);
    console.log('    → 结果: ' + (res.win ? '任务成功' : '任务失败/' + res.why) + ' · 第 ' + res.rounds + ' 轮 · 铲除 ' + res.caught + '/7 · 牌库余 ' + res.deck);
    const over = await page.evaluate(() => !document.getElementById('overlay-win').classList.contains('hidden'));
    expect('终局结算面板弹出', over);
    await setFx(true);
    await page.evaluate(() => window.INFIL_UI.goMenu());
  }

  console.log('■ 19 桌面横排（1280×820）');
  {
    const dpage = await browser.newPage({ viewport: DESK });
    dpage.on('pageerror', e => errors.push('DPAGE: ' + e.message));
    dpage.on('console', m => { if (m.type() === 'error') errors.push('DCONSOLE: ' + m.text()); });
    await dpage.goto(URL);
    await dpage.waitForTimeout(420);
    await dpage.screenshot({ path: path.join(SHOTS, 'd1-menu.png') });
    console.log('  shot: d1-menu.png');
    await dpage.evaluate(() => { Math.random = () => 0.37; });
    await dpage.click('#btnStart');
    await dpage.waitForTimeout(240);
    await dpage.screenshot({ path: path.join(SHOTS, 'd1b-cfg.png') });
    console.log('  shot: d1b-cfg.png');
    const cfgWide = await dpage.evaluate(() => {
      const sh = document.querySelector('#cfgMask .sheet');
      const b = sh.getBoundingClientRect();
      const rows = [...document.querySelectorAll('#cfgPanel .cfg-row')].map(r => {
        const label = r.querySelector('.cfg-label').textContent;
        const btns = [...r.querySelectorAll('button')];
        return {
          k: r.dataset.k, label, n: btns.length,
          texts: btns.map(x => x.textContent.replace(/\s+/g, '')),
          inside: btns.every(x => { const q = x.getBoundingClientRect(); return q.width > 0 && q.height > 0 && q.left >= 0 && q.right <= innerWidth + 1; }),
          aligned: btns.every(x => x.getBoundingClientRect().top >= r.getBoundingClientRect().top - 1 &&
            x.getBoundingClientRect().bottom <= r.getBoundingClientRect().bottom + 1),
        };
      });
      return { w: b.width, h: b.height, vw: innerWidth, vh: innerHeight, scroll: sh.scrollHeight - sh.clientHeight, rows };
    });
    expect('桌面配置抽屉不横向溢出且完整可见', cfgWide.w <= cfgWide.vw + 1 && cfgWide.h <= cfgWide.vh + 1 && cfgWide.scroll <= 1);
    expect('配置四行：标签与控件同行且不越界', cfgWide.rows.length === 4 && cfgWide.rows.every(r => r.n >= 2) &&
      cfgWide.rows.every(r => r.inside) && cfgWide.rows.every(r => r.aligned));
    expect('【数字 1】行 = 不含 / 含 1 两段', cfgWide.rows.some(r => r.k === 'one' &&
      JSON.stringify(r.texts) === JSON.stringify(['不含数字2~15', '含1只判同色·同数'])));
    await dpage.click('#btnCfgGo');
    await dpage.waitForFunction(() => !window.INFIL_UI.busy() && document.getElementById('fx').children.length === 0, null, { timeout: 9000 });
    await dpage.click('#hand .card:nth-child(3)');
    await dpage.waitForTimeout(200);
    await dpage.screenshot({ path: path.join(SHOTS, 'd2-game.png') });
    console.log('  shot: d2-game.png');
    const wide = await dpage.evaluate(() => {
      const inner = document.querySelector('#tablewrap #table');
      const stage = document.getElementById('screen-game');
      return { tableW: inner.getBoundingClientRect().width, w: window.innerWidth, scrollX: document.documentElement.scrollWidth };
    });
    expect('桌面端不横向溢出', wide.scrollX <= wide.w + 1 && wide.tableW > 300);
    await dpage.close();
  }

  console.log('■ 20 演出收尾不回闪（虚拟时钟逐帧采样判定飘字）');
  {
    /* 真实 rAF 帧太粗（30~60ms）采不到 1 帧级异常；改用虚拟 1ms 时钟驱动 fx 循环逐帧采样。
       收尾回闪（vanish 旧实现用 1ms 补间 1-p 收尾，把已淡出的元素拉回近全亮）在此必被捕获 */
    const vpage = await browser.newPage({ viewport: MOBILE });
    vpage.on('pageerror', e => errors.push('VPAGE: ' + e.message));
    await vpage.addInitScript(() => {
      let vt = 0;
      const q = [];
      window.__vt = () => vt;
      window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
      window.cancelAnimationFrame = () => {};
      performance.now = () => vt;
      window.__step = ms => { vt += ms; const cbs = q.splice(0, q.length); for (const cb of cbs) cb(vt); };
      /* 清掉残留 rAF 回调：上一段动画可能留下一条仍在自续的 fxKick 循环，
         setState 的 clearFx 不会清队列，两条循环并行会让虚拟时钟步进 2× */
      window.__clearQ = () => { q.length = 0; };
    });
    await vpage.goto(URL);
    await vpage.waitForTimeout(300);
    await vpage.evaluate(s => window.INFIL_UI.setState(s, null), scene({}));
    await vpage.evaluate(() => { window.INFIL_UI.doAct({ act: 'probe', idx: 0 }); });
    const vs = await vpage.evaluate(async () => {
      const node = () => [...document.querySelectorAll('#fx .fxc')].find(e => e.querySelector('.floatTxt'));
      const samples = [];
      for (let i = 0; i < 1500; i++) {
        window.__step(1);
        const el = node();
        if (el) samples.push([window.__vt(), +getComputedStyle(el).opacity]);
        if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));   // 让真实定时器（演出里的 sleep）推进
      }
      return { samples, left: [...document.querySelectorAll('#fx .fxc')].filter(e => e.querySelector('.floatTxt')).length };
    });
    let faded = false, maxAfter = 0;
    for (const [, o] of vs.samples) {
      if (!faded && o < 0.05) faded = true;
      else if (faded && o > maxAfter) maxAfter = o;
    }
    expect('判定飘字演出被完整逐帧采样（' + vs.samples.length + ' 帧）', vs.samples.length >= 300);
    expect('飘字淡出到 0 后不再回闪（隐没后峰值 ' + maxAfter.toFixed(2) + '）', faded && maxAfter <= 0.3);
    expect('演出收尾后 fx 层无飘字残留', vs.left === 0);

    /* 摸牌次序：新牌先隐形占位 → 飞行动画 → 落点同帧亮牌。
       同一虚拟时钟逐帧采样手牌新卡（data-id 定位）与 fx 层可见飞牌数。
       透明度由 fx 包装层（.fxc）承载，飞牌可见性以包装层为准 */
    const vd = await vpage.evaluate(async s => {
      window.INFIL_UI.setState(s, null);
      window.__clearQ();
      const S0 = window.INFIL_UI.state();
      const drawId = S0.deck[S0.deck.length - 1];            // 末尾为顶，take 必取此张
      window.INFIL_UI.doAct({ act: 'draw', take: true });
      const fxC = () => [...document.querySelectorAll('#fx .fxc')].filter(n => n.querySelector('.card') && +getComputedStyle(n).opacity > 0.05).length;
      const samples = [];
      for (let i = 0; i < 1200; i++) {
        window.__step(1);
        if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));
        const el = document.querySelector('#hand .card[data-id="' + drawId + '"]');
        if (el) samples.push([getComputedStyle(el).visibility, fxC()]);
      }
      return { drawId, samples };
    }, scene({ pending: 'draw' }));
    const hid = vd.samples.filter(s => s[0] === 'hidden').length;
    const hidFly = vd.samples.filter(s => s[0] === 'hidden' && s[1] > 0).length;
    const early = vd.samples.filter(s => s[0] !== 'hidden' && s[1] > 0).length;
    const tail = vd.samples[vd.samples.length - 1] || ['missing', 0];
    expect('摸牌飞行期间新牌隐形占位（隐形 ' + hid + ' 帧 / 其中可见飞牌 ' + hidFly + ' 帧）', hid >= 250 && hidFly >= 30);
    expect('飞牌退场前手牌新卡始终未亮（越界 ' + early + ' 帧）', early === 0);
    expect('飞行结束新牌亮出在手中（尾帧 ' + tail[0] + '）', tail[0] === 'visible');

    /* 中段定格截图：虚拟时钟停在飞行半程（手牌新格仍空、飞牌悬在空中） */
    await vpage.evaluate(async s => {
      window.INFIL_UI.setState(s, null);
      window.__clearQ();
      window.INFIL_UI.doAct({ act: 'draw', take: true });
      for (let i = 0; i < 150; i++) {
        window.__step(1);
        if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));
      }
    }, scene({ pending: 'draw' }));
    await vpage.screenshot({ path: path.join(SHOTS, 'v7-draw-inflight.png') });
    console.log('  shot:', 'v7-draw-inflight.png');
    await vpage.close();
  }

  console.log('■ 21 演出中途刷新兜底：任意演出中重载 → 从存档点续跑');
  {
    await setFx(true);
    /* A. 开局布控（盯梢+暗弃）演出中途刷新 → 直接回到「已布控、轮到玩家」的安定局面 */
    await page.evaluate(() => {
      Math.random = () => 0.37;
      window.INFIL_UI.cfg({ colors: 4, one: false, traitors: 7, extra: 3 });
      localStorage.removeItem(window.INFIL_UI.saveKey);
      window.INFIL_UI.goMenu();
    });
    await page.click('#btnStart');
    await page.waitForTimeout(160);
    await page.click('#btnCfgGo');
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 4000 });
    const aMid = await page.evaluate(() => {
      const raw = localStorage.getItem(window.INFIL_UI.saveKey);
      const S = raw ? JSON.parse(raw).S : null;
      return S && { turn: S.turn, watch: S.aiWatch, down: S.discardDown.length, deck: S.deck.length };
    });
    expect('布控演出前已落盘（轮到玩家 · 已布控 · 暗弃 1 · 牌库 38）',
      aMid && aMid.turn === 0 && aMid.watch !== null && aMid.down === 1 && aMid.deck === 38);
    await page.reload();
    await page.waitForTimeout(600);
    await idle();
    const a = await page.evaluate(() => ({
      on: document.getElementById('screen-game').classList.contains('on'),
      fx: document.getElementById('fx').children.length,
      turn: window.INFIL_UI.state().turn,
      watch: window.INFIL_UI.state().aiWatch,
      deck: window.INFIL_UI.state().deck.length,
      down: window.INFIL_UI.state().discardDown.length,
      sign: document.getElementById('turnsign').textContent,
    }));
    expect('布控中途刷新 → 直接回到牌局（不重播布控 · 不卡忙态 · 指示你的回合）',
      a.on && a.fx === 0 && a.turn === 0 && a.watch !== null && a.deck === 38 && a.down === 1 && a.sign.includes('你的回合'));

    /* B. 通讯判定印章演出中途刷新 → 摸牌抽屉直接弹出；继续摸牌，再由摸牌飞行中途刷新 → 夜枭续跑 */
    await page.click('#hand .card:nth-child(1)');
    await page.waitForTimeout(140);
    await page.click('#btnProbe');
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 4000 });
    await page.reload();
    await page.waitForTimeout(600);
    const b = await page.evaluate(() => ({
      pending: window.INFIL_UI.state().pending,
      mask: !document.getElementById('drawMask').classList.contains('hidden'),
      busy: window.INFIL_UI.busy(),
    }));
    expect('判定演出中途刷新 → 摸牌抽屉直接弹出（pending=draw · 可继续决策）', b.pending === 'draw' && b.mask && !b.busy);
    await page.click('#btnDrawTake');
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 4000 });
    const bMid = await page.evaluate(() => {
      const S = JSON.parse(localStorage.getItem(window.INFIL_UI.saveKey)).S;
      return { turn: S.turn, hand: S.hand.length, pending: S.pending };
    });
    expect('摸牌飞行前已落盘（通讯出手后手牌 4→5 · 回合已交夜枭）', bMid.turn === 1 && bMid.pending === null && bMid.hand === 5);
    await page.reload();
    await page.waitForFunction(() => !window.INFIL_UI.busy() && window.INFIL_UI.state().turn === 0, null, { timeout: 12000 });
    const b2 = await st();
    expect('摸牌飞行中途刷新 → 夜枭续跑并交还玩家（摸到的牌保留）', b2.turn === 0 && b2.hand === 5 && b2.pending === null);

    /* C. 铲除命中揭示演出中途刷新 → 拾牌抽屉直接弹出（子弹/铲除数/情报区均已结算） */
    await setState2(scene({}), { live: true });
    await page.evaluate(() => { window.INFIL_UI.doAct({ act: 'elim', c: 0, n: 3 }); });
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 4000 });
    const cMid = await page.evaluate(() => {
      const S = JSON.parse(localStorage.getItem(window.INFIL_UI.saveKey)).S;
      return { pending: S.pending, bullets: S.bullets, caught: S.caught, intel: S.intel.rel.length + S.intel.unrel.length };
    });
    expect('命中结算演出前已落盘（pending=reward · 子弹 9 · 已铲除 1 · 情报区已清）',
      cMid.pending === 'reward' && cMid.bullets === 9 && cMid.caught === 1 && cMid.intel === 0);
    await page.reload();
    await page.waitForTimeout(600);
    const c = await page.evaluate(() => ({
      pending: window.INFIL_UI.state().pending,
      mask: !document.getElementById('rewardMask').classList.contains('hidden'),
      caught: window.INFIL_UI.state().caught,
      bullets: window.INFIL_UI.state().bullets,
    }));
    expect('揭示中途刷新 → 拾牌抽屉直接弹出（不重复开枪）', c.pending === 'reward' && c.mask && c.caught === 1 && c.bullets === 9);

    /* D. 拾牌飞行中途刷新 → 夜枭续跑，拾取不重复 */
    const dBefore = await st();
    await page.click('#btnBlind');
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 4000 });
    const dMid = await page.evaluate(() => {
      const S = JSON.parse(localStorage.getItem(window.INFIL_UI.saveKey)).S;
      return { turn: S.turn, hand: S.hand.length, pending: S.pending };
    });
    expect('拾牌飞行前已落盘（手牌 +1 · 回合已交夜枭）', dMid.turn === 1 && dMid.pending === null && dMid.hand === dBefore.hand + 1);
    await page.reload();
    await page.waitForFunction(() => !window.INFIL_UI.busy() && window.INFIL_UI.state().turn === 0, null, { timeout: 12000 });
    const d = await st();
    expect('拾牌飞行中途刷新 → 夜枭续跑并交还玩家（拾取不重复）', d.turn === 0 && d.hand === dBefore.hand + 1 && d.pending === null);

    /* E. 夜枭出牌演出中途刷新 → 玩家回合，AI 动作不重复执行 */
    await setState2(scene({ turn: 1 }), { live: true });
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 8000 });
    const eMid = await page.evaluate(() => {
      const S = JSON.parse(localStorage.getItem(window.INFIL_UI.saveKey)).S;
      return { turnNo: S.turnNo, aiHand: S.aiHand.length };
    });
    await page.reload();
    await page.waitForFunction(() => !window.INFIL_UI.busy() && window.INFIL_UI.state().turn === 0, null, { timeout: 12000 });
    const e = await st();
    expect('夜枭演出中途刷新 → 玩家回合 · AI 动作不重复（turnNo ' + eMid.turnNo + ' · 手牌 ' + eMid.aiHand + '）',
      e.turn === 0 && e.turnNo === eMid.turnNo && e.aiHand === eMid.aiHand);

    /* F. 终局命中演出中途刷新 → 直接落到胜利结算（over 态也先落盘，刷新不回滚最后一枪） */
    await setState2(scene({ caught: 6 }), { live: true });
    await page.evaluate(() => { window.INFIL_UI.doAct({ act: 'elim', c: 0, n: 3 }); });
    await page.waitForFunction(() => {
      const S = window.INFIL_UI.state();
      return S.over && document.getElementById('fx').children.length > 0;
    }, null, { timeout: 4000 });
    const fMid = await page.evaluate(() => {
      const raw = localStorage.getItem(window.INFIL_UI.saveKey);
      return { saved: raw ? JSON.parse(raw).S.over : null };
    });
    expect('终局动作演出前即落盘 over 态', fMid.saved && fMid.saved.win === true);
    await page.reload();
    await page.waitForTimeout(700);
    const f = await page.evaluate(() => ({
      open: !document.getElementById('overlay-win').classList.contains('hidden'),
      stamp: document.querySelector('.win-stamp') ? document.querySelector('.win-stamp').textContent : '',
      caught: window.INFIL_UI.state().caught,
      cleared: localStorage.getItem(window.INFIL_UI.saveKey) === null,
    }));
    expect('终局演出中途刷新 → 直接落结算（任务成功 · 7/7）', f.open && f.stamp.includes('任务成功') && f.caught === 7);
    expect('结算弹出后清档', f.cleared);
    await shot('m31-reload-over.png');

    /* G. 终局落空致负演出中途刷新 → 直接落到失败结算 */
    await setState2(scene({ bullets: 7 }), { live: true });
    await page.evaluate(() => { window.INFIL_UI.doAct({ act: 'elim', c: 1, n: 5 }); });
    await page.waitForFunction(() => {
      const S = window.INFIL_UI.state();
      return S.over && !S.over.win && document.getElementById('fx').children.length > 0;
    }, null, { timeout: 4000 });
    await page.reload();
    await page.waitForTimeout(700);
    const g = await page.evaluate(() => ({
      open: !document.getElementById('overlay-win').classList.contains('hidden'),
      stamp: document.querySelector('.win-stamp') ? document.querySelector('.win-stamp').textContent : '',
      why: document.querySelector('.win-why') ? document.querySelector('.win-why').textContent : '',
    }));
    expect('终局落空（弹药告急）中途刷新 → 直接落失败结算', g.open && g.stamp.includes('任务失败') && g.why.includes('弹药告急'));
  }

  console.log('\n断言: ' + ok + '/' + total);
  await browser.close();
  if (errors.length) { console.log('\n页面错误:\n' + errors.join('\n')); process.exit(1); }
  if (ok < total) { console.log('部分断言未通过'); process.exit(1); }
  console.log('ALL OK');
}
main().catch(e => { console.error(e); process.exit(1); });
