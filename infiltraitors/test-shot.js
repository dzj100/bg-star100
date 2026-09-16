/* ============================================================
   渗透因子 Infiltraitors · 截图走查（node test-shot.js）
   覆盖：菜单/配置/难度条 / 开局布控演出 / 通讯判定印章 / 推论板 /
        潜伏摸牌抽屉 / 铲除指认与开枪演出（命中·落空）/ 拾牌抽屉 /
        日志·弃牌·情报抽屉 / 弹药告急 / 夜枭整回合 / 胜负结算 /
        存档续玩（重载恢复 / 回菜单清档 / AI 回合断点续跑）/ 桌面横排 /
        金路径：脚本代打到终局
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

  console.log('■ 1 菜单：配置面板 + 难度读数');
  {
    const menu = await page.evaluate(() => ({
      visible: !document.getElementById('screen-menu').classList.contains('hidden'),
      colors: document.querySelectorAll('#cfgPanel .seg[data-k="colors"] button').length,
      one: document.querySelectorAll('#cfgPanel .seg[data-k="one"] button').length,
      traitors: [...document.querySelectorAll('#cfgPanel .seg[data-k="traitors"] button')].map(b => b.textContent),
      extra: [...document.querySelectorAll('#cfgPanel .seg[data-k="extra"] button')].map(b => b.textContent),
      read: document.getElementById('cfgRead').textContent,
    }));
    expect('封面可见 · 颜色/数字 1 各 2 段', menu.visible && menu.colors === 2 && menu.one === 2);
    expect('叛徒 7~11 段', JSON.stringify(menu.traitors) === JSON.stringify(['7', '8', '9', '10', '11']));
    expect('额外子弹 0~3 段', JSON.stringify(menu.extra) === JSON.stringify(['0', '1', '2', '3']));
    expect('默认读数：牌库 39 · 叛徒 7 · 子弹 10 · 标准', menu.read.includes('39') && menu.read.includes('10') && menu.read.includes('标准'));
    await shot('m1-menu.png');
  }

  console.log('■ 2 配置联动：叛徒 8 → 牌库 38 · 难度紧张');
  {
    await page.click('#cfgPanel .seg[data-k="traitors"] button:nth-child(2)');
    await page.waitForTimeout(150);
    const read = await page.evaluate(() => document.getElementById('cfgRead').textContent);
    expect('叛徒 8 → 牌库 38 · 紧张', read.includes('38') && read.includes('紧张'));
    await shot('m2-cfg-8.png');
    await page.click('#cfgPanel .seg[data-k="traitors"] button:nth-child(1)');   // 回 7
    await page.waitForTimeout(120);
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

  console.log('■ 4 开局：布控演出 + 桌面读数');
  {
    await page.evaluate(() => { Math.random = () => 0.37; });    // 确定性发牌与布控
    await page.click('#btnStart');
    await idle();
    const s = await st();
    expect('开局轮到玩家 · 夜枭已布控', s.turn === 0 && s.watch !== null);
    expect('牌库 39-1（布控暗弃）= 38', s.deck === 38 && s.down === 1);
    const dom = await page.evaluate(() => ({
      deck: document.getElementById('dcount').textContent,
      trait: document.getElementById('tcount').textContent,
      b: document.getElementById('bcount').textContent,
      pips: document.querySelectorAll('#pips i').length,
      pipsOn: document.querySelectorAll('#pips i:not(.spent)').length,
      caught: document.getElementById('caughtTag').textContent,
      watch: document.getElementById('watchTag').textContent,
      turn: document.getElementById('turnsign').textContent,
      aiHand: document.getElementById('aiHandN').textContent,
    }));
    expect('顶栏读数：牌库 38 / 叛徒 7 / 子弹 10 发 10 芯', dom.deck === '38' && dom.trait === '7' && dom.b === '10' && dom.pips === 10 && dom.pipsOn === 10);
    expect('已铲除 0/7 · 已布控 · 夜枭手牌 5', dom.caught.includes('0/7') && dom.watch === '已布控' && dom.aiHand === '5');
    expect('回合指示为玩家', dom.turn.includes('你的回合'));
    await shot('m4-open.png');
  }

  console.log('■ 5 选牌 + 通讯（判定印章演出）');
  {
    await page.click('#hand .card:nth-child(2)');
    await page.waitForTimeout(160);
    expect('选中的手牌抬起（.pick）', await page.evaluate(() => !!document.querySelector('#hand .card.pick')));
    await shot('m5-select.png');
    await page.click('#btnProbe');
    await page.waitForTimeout(430);                       // 截在飞行途中/印章将落
    await shot('m6-probe-fx.png');
    await idle();
    const s = await st();
    expect('通讯后情报 +1（含夜枭随后的情报）', s.intel === 2);
    expect('通讯摸 1 张：手牌仍 5', s.hand === 5);
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
    await page.waitForSelector('#fx .banner', { timeout: 5000 });
    await page.waitForTimeout(300);                       // 横幅缩放到全尺寸
    await shot('m13b-banner.png');
    await page.waitForFunction(() => window.INFIL_UI.state().pending === 'reward' && !window.INFIL_UI.busy(), null, { timeout: 9000 });
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
    }));
    expect('拾牌抽屉自动弹出：明弃可选 · 盲抽可用', rw.open && rw.cards >= 4 && !rw.blind);
    await page.mouse.click(12, 40);                       // 点遮罩空白
    await page.waitForTimeout(180);
    expect('拾牌是必选阶段：点遮罩不收起', await page.evaluate(() => !document.getElementById('rewardMask').classList.contains('hidden')));
    await shot('m14-reward.png');
    const before = await st();
    await page.click('#rewardUp .card[data-i="0"]');
    await idle();
    const after = await st();
    expect('拾取明弃 1 张 → 手牌 +1 · 阶段结束', after.hand === before.hand + 1 && after.pending === null);
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
    }));
    expect('夜枭行动中：提示条点名', dom.vis && dom.txt.includes('夜枭正在行动') && dom.turn.includes('夜枭'));
    await shot('m18-ai-turn.png');
    await page.waitForFunction(() => {
      const S = window.INFIL_UI.state();
      return !window.INFIL_UI.busy() && S.turn === 0;
    }, null, { timeout: 12000 });
    const s = await st();
    expect('AI 打出一张情报后交还回合', s.turn === 0 && s.turnNo === 4 && s.aiHand === 2 && s.intel === 3);
    expect('夜枭手牌计数随出牌更新为 2', await page.evaluate(() => document.getElementById('aiHandN').textContent === '2'));
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

  console.log('■ 14 牌堆点击提示（吐司）');
  {
    await page.click('#pileDeck');
    await page.waitForTimeout(180);
    expect('点牌库 → 提示条警告态 + 文案', await page.evaluate(() =>
      document.getElementById('notebar').classList.contains('warn') &&
      document.getElementById('nbText').textContent.includes('牌库剩')));
    await shot('m23-toast.png');
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
    await shot('m24-win.png');

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
  }

  console.log('■ 16 存档续玩：重载恢复 / 回菜单清档');
  {
    await page.evaluate(() => { window.INFIL_UI.clear(); window.INFIL_UI.goMenu(); });
    await page.evaluate(() => { Math.random = () => 0.37; });
    await setFx(false);
    await page.click('#btnStart');
    await page.waitForFunction(() => !window.INFIL_UI.busy(), null, { timeout: 8000 });
    await page.evaluate(async () => { await window.INFIL_UI.doAct({ act: 'probe', idx: 0 }); });
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
    await page.evaluate(() => window.INFIL_UI.goMenu());
    expect('回菜单即清档', await page.evaluate(() => localStorage.getItem(window.INFIL_UI.saveKey) === null));
    await page.reload();
    await page.waitForTimeout(420);
    expect('无存档 → 回封面', await page.evaluate(() => !document.getElementById('screen-menu').classList.contains('hidden')));
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

  console.log('\n断言: ' + ok + '/' + total);
  await browser.close();
  if (errors.length) { console.log('\n页面错误:\n' + errors.join('\n')); process.exit(1); }
  if (ok < total) { console.log('部分断言未通过'); process.exit(1); }
  console.log('ALL OK');
}
main().catch(e => { console.error(e); process.exit(1); });
