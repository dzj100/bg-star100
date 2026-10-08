/* ============================================================
   棕榈岛 Palm Island · 截图走查（node test-shot.js）
   覆盖：封面（装饰/最佳读数/静音开关）/ 规则速览 / 开局 + 新手引导（首见 4 步）/
        对局布局（顶栏·日志条·轮次·资源栏·焦点双卡·行动栏2行·横置资源条 · 无溢出）/
        R13 双卡焦点（点卡换目标 · 再点看全貌〔行态含产出〕 · 跳过仅第 1 张）/
        免费收集（飞牌演出 · 横置资源条 +1 · 卡回牌堆底）/
        付费收集（集市费用方案 or 任选 · 支付抽屉勾选）/
        转 180° / 翻面（支付抽屉 · 行/面变化）/ 资源态顶卡自动复位 /
        R19 资源上限 4（重置选择抽屉 · 原位复位 · 取消不动状态）/
        回合标记自动计数（无离场 · 轮次推进）/ 日志·重置抽屉 / 存档续玩 /
        结算（段位印章 · 清单 · 最佳写入 · 清档）/ 再来一局（引导不再出现）/
        桌面视口 / 金路径：脚本代打到终局
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

/* ---------- 确定性牌局夹具 ---------- */
function mk(id, k, face, row, res) { return { uid: id + '#' + k, id: id, face: face, row: row, res: !!res }; }
const ORDER = [['woodcutter', 0], ['woodcutter', 1], ['woodcutter', 2],
  ['boathouse', 0], ['boathouse', 1], ['boathouse', 2],
  ['quarry', 0], ['quarry', 1], ['quarry', 2], ['market', 0],
  ['storehouse', 0], ['warehouse', 0], ['house', 0], ['house', 1],
  ['temple', 0], ['temple', 1]];

/* top: 置顶的卡列表 [[id,k,face,row,res?], ...]；其余按 ORDER 补齐；markerN 可选覆盖 */
function scene(top, markerN) {
  const used = {};
  const deck = [];
  top.forEach(function (a) {
    used[a[0] + '#' + a[1]] = true;
    deck.push(mk(a[0], a[1], a[2], a[3], a[4]));
  });
  ORDER.forEach(function (o) { if (!used[o[0] + '#' + o[1]]) deck.push(mk(o[0], o[1], 0, 0, false)); });
  deck.push({ id: '#marker', n: markerN == null ? 2 : markerN });
  return { v: 1, seed: 7, deck: deck, phase: 'play', log: [{ k: 'round', s: '第 ' + ((markerN == null ? 2 : markerN) + 1) + ' 轮开始' }] };
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
  const idle = async (to = 9000) => page.waitForFunction(() =>
    !window.PALM_UI.isBusy() && document.getElementById('fx').children.length === 0, null, { timeout: to });
  const st = () => page.evaluate(() => {
    const S = window.PALM_UI.state();
    if (!S) return null;
    const v = window.PALM_UI.view();
    const bank = S.deck.filter(c => window.PALM.isCard(c) && c.res);
    return {
      deck: S.deck.length, cards: v.counts.cards, bank: bank.length, phase: S.phase,
      kind: v.kind, round: v.round, markerN: (window.PALM.markerOf(S) || {}).n,
      deckN: document.getElementById('deckN').textContent,
      roundTxt: document.getElementById('roundTxt').textContent,
      bankN: document.getElementById('bankN').textContent,
      log: document.getElementById('logText').textContent,
      fish: document.getElementById('resFish').textContent,
      wood: document.getElementById('resWood').textContent,
      stone: document.getElementById('resStone').textContent,
    };
  });
  const setScene = async (S, o) => {
    await page.evaluate(a => { localStorage.setItem('palm-island-state', JSON.stringify({ v: 1, S: a })); }, S);
    const okResume = await page.evaluate(() => window.PALM_UI.resume());
    await page.waitForTimeout(150);
    return okResume;
  };
  const lastLog = () => page.evaluate(() => {
    const S = window.PALM_UI.state();
    return S.log[S.log.length - 1];
  });
  const deckUids = () => page.evaluate(() => window.PALM_UI.state().deck.map(c => c.uid || '#marker'));

  await page.goto(URL);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  await page.waitForTimeout(420);

  console.log('■ 1 封面：装饰 / 读数 / 静音开关');
  {
    const m = await page.evaluate(() => ({
      menu: !document.getElementById('screen-menu').classList.contains('hidden'),
      game: document.getElementById('screen-game').classList.contains('on'),
      resumeHidden: document.getElementById('btnResume').classList.contains('hidden'),
      decos: document.querySelectorAll('#screen-menu svg.deco').length,
      fan: document.querySelectorAll('.hero-fan .pcard').length,
      meta: document.getElementById('menuMeta').textContent,
      credit: document.querySelector('.credit').textContent,
    }));
    expect('封面可见 · 对局屏未开 · 无「继续」按钮', m.menu && !m.game && m.resumeHidden);
    expect('装饰 4 件（椰树×2 / 海星 / 贝壳）· 样板卡扇已移除 · 落款 @imStar100',
      m.decos === 4 && m.fan === 0 && m.credit.includes('@imStar100'));
    expect('首次航程读数', m.meta.includes('首次航程'));
    await shot('m1-menu.png');
    await page.click('#btnMuteMenu');
    await page.waitForTimeout(120);
    const on = await page.evaluate(() => ({
      cls: document.getElementById('btnMuteMenu').classList.contains('muted'),
      key: localStorage.getItem('palm-island-muted'),
    }));
    await page.click('#btnMuteMenu');
    await page.waitForTimeout(120);
    const off = await page.evaluate(() => ({
      cls: document.getElementById('btnMuteMenu').classList.contains('muted'),
      key: localStorage.getItem('palm-island-muted'),
    }));
    expect('静音开关：点击加斜杠 + 落盘（key=1）· 再点恢复', on.cls && on.key === '1' && !off.cls && off.key === '0');
  }

  console.log('■ 2 规则速览');
  {
    await page.click('#btnRules');
    await page.waitForTimeout(260);
    const r = await page.evaluate(() => ({
      open: !document.getElementById('rulesMask').classList.contains('hidden'),
      txt: document.getElementById('rulesMask').textContent,
    }));
    expect('规则抽屉打开且覆盖新口径', r.open && r.txt.includes('16 张岛卡') && r.txt.includes('收集费用')
      && r.txt.includes('可见最上') && r.txt.includes('最多同时 4 张') && r.txt.includes('仅第 1 张') && r.txt.includes('横置资源'));
    await shot('m2-rules.png');
    await page.click('#btnCloseRules');
    await page.waitForTimeout(180);
    expect('关闭规则', await page.evaluate(() => document.getElementById('rulesMask').classList.contains('hidden')));
  }

  console.log('■ 3 开局 + 新手引导（首见 4 步）');
  {
    await page.click('#btnStart');
    await page.waitForFunction(() => window.PALM_UI.coachActive(), null, { timeout: 4000 });
    await page.waitForTimeout(420);                              // 等高亮框过渡到位
    const c1 = await page.evaluate(() => ({
      step: window.PALM_UI.coachStep(),
      title: document.getElementById('coachTitle').textContent,
      hole: (() => {
        const h = document.getElementById('coachHole').getBoundingClientRect();
        const f = document.getElementById('focusCardArea').getBoundingClientRect();
        return h.left <= f.left + 2 && h.top <= f.top + 2 && h.right >= f.right - 2 && h.bottom >= f.bottom - 2;
      })(),
    }));
    expect('首局自动开始引导（第 1 步 · 高亮焦点区）', c1.step === 0 && c1.title.includes('可见 2 张') && c1.hole);
    await shot('m3-coach.png');
    for (let i = 0; i < 3; i++) await page.click('#coachNext');
    await page.waitForTimeout(160);
    const c2 = await page.evaluate(() => ({
      step: window.PALM_UI.coachStep(),
      btn: document.getElementById('coachNext').textContent,
      title: document.getElementById('coachTitle').textContent,
    }));
    expect('第 4 步高亮日志条 · 按钮变「开始航程」', c2.step === 3 && c2.btn.includes('开始航程') && c2.title.includes('日志'));
    await page.click('#coachNext');
    await page.waitForTimeout(160);
    const c3 = await page.evaluate(() => ({
      active: window.PALM_UI.coachActive(),
      seen: localStorage.getItem('palm-island-coach'),
    }));
    expect('引导收尾并落「已看」标记', !c3.active && c3.seen === '1');
    const s = await st();
    expect('开局：牌堆 16 张 · 第 1 / 8 轮 · 资源 0 张', s.deckN === '16' && s.roundTxt.includes('第 1') && s.bankN === '0 / 4');
  }

  console.log('■ 4 对局布局（手机 390×844）');
  {
    const L = await page.evaluate(() => {
      const g = id => document.getElementById(id);
      const rect = el => el.getBoundingClientRect();
      const slots = [...document.querySelectorAll('#focusCardArea .fslot')].map(rect);
      const tags = [...document.querySelectorAll('#focusCardArea .fslot-tag')].map(t => t.textContent);
      const stage = g('screen-game');
      return {
        topIds: [...g('topbar').querySelectorAll('button')].map(b => b.id),
        slots: slots.length, sameTop: Math.abs(slots[0].top - slots[1].top) < 1,
        sideBySide: slots[0].right <= slots[1].left + 1,
        inView: slots[0].left >= 0 && slots[1].right <= innerWidth + 1,
        tags: tags,
        acts: [...g('actbar').querySelectorAll('button')].map(b => b.id),
        note: g('focusNote').textContent, hint: g('resHint').textContent,
        topBottom: rect(g('topbar')).bottom,
        logTop: rect(g('logbar')).top, logBottom: rect(g('logbar')).bottom,
        roundTop: rect(g('roundbar')).top,
        actCols: getComputedStyle(g('actbar')).gridTemplateColumns.split(' ').length,
        actBottom: rect(g('actbar')).bottom,
        deckItems: document.querySelectorAll('#decklist .dkitem').length,
        deckEmpty: (document.querySelector('#decklist .empty') || { textContent: '' }).textContent,
        stripTop: rect(document.querySelector('.stripwrap')).top,
        overflow: stage.scrollHeight - stage.clientHeight, vh: innerHeight,
      };
    });
    expect('顶栏 = 菜单 / 静音 / 规则 / 重置', JSON.stringify(L.topIds) === JSON.stringify(['btnMenu', 'btnMute', 'btnRulesGame', 'btnReset']));
    expect('日志条紧贴顶栏下方（轮次条之前）', L.logTop >= L.topBottom - 1 && L.logBottom <= L.roundTop + 1);
    expect('焦点双卡并排同高 · 未溢出屏宽', L.slots === 2 && L.sameTop && L.sideBySide && L.inView);
    expect('槽位标签：✓ 目标 / 第 2 张 · 点选', L.tags[0].includes('目标') && L.tags[1].includes('第 2 张'));
    expect('行动四键 2 行网格 · 贴底', JSON.stringify(L.acts) === JSON.stringify(['btnCollect', 'btnSpin180', 'btnFlip', 'btnSkip']) && L.actCols === 2 && L.actBottom >= L.stripTop && L.vh - L.actBottom < 24);
    expect('资源栏提示上限', L.hint.includes('上限 4 张'));
    expect('横置资源条开局为空态（不展示整副牌序）· 提示收集后标注位置', L.deckItems === 0 && L.deckEmpty.includes('暂无资源卡'));
    expect('对局屏无纵向溢出', L.overflow <= 1);
    await shot('m4-layout.png');
  }

  console.log('■ 5 R13 双卡焦点：换目标 / 看全貌 / 跳过仅第 1 张');
  {
    expect('夹具装载', await setScene(scene([['woodcutter', 0, 0, 0], ['boathouse', 1, 0, 0]])));
    const a = await page.evaluate(() => ({
      target: window.PALM_UI.target(),
      sel: [...document.querySelectorAll('#focusCardArea .fslot')].map(s => s.classList.contains('sel')),
      tags: [...document.querySelectorAll('.fslot-tag')].map(t => t.textContent),
      skip: document.getElementById('btnSkip').querySelector('.cost').textContent,
      note: document.getElementById('focusNote').textContent,
    }));
    expect('默认目标为第 1 张 · 跳过标注「第 1 张」', a.target === 0 && a.sel[0] && !a.sel[1] && a.skip.includes('第 1 张') && a.note.includes('点卡可换目标'));
    await page.click('#focusCardArea .fslot:nth-child(2) .pcard');
    await page.waitForTimeout(150);
    const b = await page.evaluate(() => ({
      target: window.PALM_UI.target(),
      sel: [...document.querySelectorAll('#focusCardArea .fslot')].map(s => s.classList.contains('sel')),
      tags: [...document.querySelectorAll('.fslot-tag')].map(t => t.textContent),
      skip: document.getElementById('btnSkip').querySelector('.cost').textContent,
    }));
    expect('点第 2 张 → 目标切换（✓ 目标 移过去）· 跳过标注「仅第 1 张」',
      b.target === 1 && !b.sel[0] && b.sel[1] && b.tags[0].includes('第 1 张') && b.skip.includes('仅第 1 张'));
    await shot('m5-target.png');
    await page.click('#focusCardArea .fslot:nth-child(2) .pcard');   // 再点当前目标 → 看全貌
    await page.waitForTimeout(200);
    const c = await page.evaluate(() => ({
      open: !document.getElementById('inspectMask').classList.contains('hidden'),
      rows: document.querySelectorAll('#inspectRows .insrow').length,
      cur: document.querySelectorAll('#inspectRows .insrow.cur').length,
      prod: [...document.querySelectorAll('#inspectRows .insrow .pr')].map(el => el.querySelectorAll('.ic').length),
    }));
    expect('再点目标 → 打开卡牌全貌（4 行态 · 当前行高亮）', c.open && c.rows === 4 && c.cur === 1);
    expect('每行标注右转 90° 产出（船屋 1/2/2/3 图标）', c.prod.join(',') === '1,2,2,3');
    await shot('m6-inspect.png');
    await page.click('#btnCloseInspect');
    await page.waitForTimeout(160);
    /* 空行态：产出位为「—」（樵夫背0°） */
    await page.click('#focusCardArea .fslot:nth-child(1) .pcard');   // 切目标回第 1 张
    await page.waitForTimeout(140);
    await page.click('#focusCardArea .fslot:nth-child(1) .pcard');   // 再点 → 看全貌
    await page.waitForTimeout(200);
    const cn = await page.evaluate(() => ({
      rows: document.querySelectorAll('#inspectRows .insrow').length,
      none: document.querySelectorAll('#inspectRows .insrow .pr.none').length,
      txt: (document.querySelector('#inspectRows .insrow .pr.none') || { textContent: '' }).textContent,
    }));
    expect('空行态产出位显示「—」（樵夫仅背0° 无产出）', cn.rows === 4 && cn.none === 1 && cn.txt === '—');
    await page.click('#btnCloseInspect');
    await page.waitForTimeout(160);
    /* 跳过：目标在第 2 张时按下，仍作用于第 1 张 */
    const before = await deckUids();
    await page.click('#btnSkip');
    await idle();
    const after = await deckUids();
    expect('跳过只作用于第 1 张（原第 2 张顶上 · 原第 1 张沉到标记卡之下）',
      after[0] === before[1] && after[16] === before[0] && after[15] === '#marker');
    const lg = await lastLog();
    expect('日志记录跳过', lg.s.includes('跳过') && lg.s.includes('回牌堆底'));
  }

  console.log('■ 6 免费收集（飞牌演出 → 横置资源条 +1）');
  {
    await setScene(scene([['woodcutter', 0, 0, 0], ['boathouse', 1, 0, 0]]));
    await page.click('#btnCollect');
    await page.waitForFunction(() => document.getElementById('fx').children.length > 0, null, { timeout: 4000 });
    await page.waitForTimeout(150); /* 起步时克隆与原卡重叠，稍等片刻截到弧线飞行中段 */
    await shot('m7-collect-fly.png');
    await idle();
    const s = await st();
    expect('收集后：牌堆仍 16 · 资源 1 / 4 · 卡沉到标记卡之下且横置',
      s.deckN === '16' && s.bankN === '1 / 4' && (await page.evaluate(() => {
        const S = window.PALM_UI.state();
        return S.deck[16].uid === 'woodcutter#0' && S.deck[16].res === true;
      })) === true);
    expect('资源合计 1🪵（船屋未收集）', s.wood === '1' && s.fish === '0' && s.stone === '0');
    expect('日志与资源带联动', s.log.includes('右转收集'));
    const dk = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#decklist .dkitem')];
      const last = items[items.length - 1];
      const el = last.querySelector('.pcard');
      return {
        n: items.length,
        resN: document.querySelectorAll('#decklist .dkitem.isres').length,
        resUid: (document.querySelector('#decklist .dkitem.isres') || { dataset: {} }).dataset.uid,
        lastUid: last.dataset.uid, lastNo: last.querySelector('.dk-no').textContent,
        lastRes: last.classList.contains('isres'),
        lastQ: (el && el.style.getPropertyValue('--q')) || '',
        lastTag: (el && el.title) || '',
      };
    });
    expect('横置资源条：只列横置卡（1 张 · 樵夫）· 标注它在牌堆第 17 张',
      dk.n === 1 && dk.resN === 1 && dk.resUid === 'woodcutter#0' && dk.lastUid === 'woodcutter#0' && dk.lastNo === '第 17 张' && dk.lastRes);
    expect('横置卡保持牌堆原位 · 旋转展示（--q=1 即右转 90°）· 悬浮标注行态', dk.lastQ === '1' && dk.lastTag.includes('横置'));
    await shot('m7b-bank.png');
  }

  console.log('■ 7 付费收集（集市：费用 or 任选其一 + 支付勾选）');
  {
    await setScene(scene([['market', 0, 0, 0], ['woodcutter', 0, 0, 0], ['woodcutter', 1, 0, 1, true], ['boathouse', 2, 0, 1, true]]));
    /* 全貌核对：集市背180° 收集费三方案全显示（此前写死两档 · 回归） */
    await page.click('#focusCardArea .fslot:nth-child(1) .pcard');
    await page.waitForTimeout(200);
    const mi = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#inspectRows .insrow')];
      const chip = rows[3].querySelector('.ops .pc-op.free');
      return {
        ors: chip.querySelectorAll('.or').length,
        nums: chip.querySelectorAll('b').length,
        icons: [...chip.querySelectorAll('svg.ic use')].map(u => u.getAttribute('href')).join(','), /* 含开头 ↻ 图标 */
        cur: rows.filter(r => r.classList.contains('cur')).length,
      };
    });
    expect('集市背180° 收集费三方案全显示（1🪵/1🐟/1🪨 · 两个 or）',
      mi.ors === 2 && mi.nums === 3 && mi.icons === '#ic-rot,#ic-wood,#ic-fish,#ic-stone' && mi.cur === 1);
    await page.click('#btnCloseInspect');
    await page.waitForTimeout(160);
    await page.click('#btnCollect');
    await page.waitForTimeout(260);
    const p1 = await page.evaluate(() => ({
      open: !document.getElementById('payMask').classList.contains('hidden'),
      title: document.getElementById('payTitle').textContent,
      opts: [...document.querySelectorAll('#payOpts .payopt')].map(b => ({ t: b.textContent, on: b.classList.contains('on') })),
      optsHidden: document.getElementById('payOpts').classList.contains('hidden'),
      need: document.getElementById('payNeed').textContent,
      rows: document.querySelectorAll('#payRows .payrow').length,
      goDis: document.getElementById('btnPayGo').disabled,
    }));
    expect('集市收集弹出支付抽屉（标题=收集 · 支付费用）', p1.open && p1.title.includes('收集'));
    expect('费用方案 chips 2 枚（or 任选其一）· 默认选可覆盖方案 · 2 张资源可选',
      !p1.optsHidden && p1.opts.length === 2 && p1.opts[0].on && p1.rows === 2 && p1.goDis === true);
    await shot('m8-pay-collect.png');
    await page.click('#payOpts .payopt:nth-child(2)');
    await page.waitForTimeout(140);
    const p2 = await page.evaluate(() => ({
      need: document.getElementById('payNeed').textContent,
      on2: document.querySelectorAll('#payOpts .payopt')[1].classList.contains('on'),
    }));
    expect('切到方案 2 → 需 1🐟', p2.on2 && p2.need.length > 0);
    await page.evaluate(() => window.PALM_UI.payToggle(2));      // 只选 1🪵 的樵夫 → 不满足 1🐟
    await page.waitForTimeout(120);
    const p3 = await page.evaluate(() => document.getElementById('btnPayGo').disabled);
    expect('方案不匹配时「确认支付」保持禁用', p3 === true);
    await page.evaluate(() => window.PALM_UI.payToggle(2));      // 取消樵夫
    await page.evaluate(() => window.PALM_UI.payToggle(3));      // 选船屋 2🐟
    await page.waitForTimeout(120);
    const p4 = await page.evaluate(() => ({
      dis: document.getElementById('btnPayGo').disabled,
      got: document.getElementById('payGot').textContent,
    }));
    expect('选船屋（2🐟 覆盖 1🐟）→ 可确认', p4.dis === false);
    await page.click('#btnPayGo');
    await idle();
    const s = await st();
    expect('支付后：船屋复位 · 集市横置为资源（s1）· 资源 2 / 4',
      s.bankN === '2 / 4' && s.stone === '1' && s.wood === '1' && s.fish === '0');
    expect('集市沉底且为资源态', await page.evaluate(() => {
      const S = window.PALM_UI.state();
      return S.deck[16].uid === 'market#0' && S.deck[16].res === true;
    }));
    const lg = await lastLog();
    expect('日志含收集费用', lg.s.includes('右转收集') && lg.cost && lg.cost.f === 1);
  }

  console.log('■ 7b 资源态顶卡自动复位');
  {
    await setScene(scene([['woodcutter', 1, 0, 1, true], ['boathouse', 0, 0, 0]]));
    const pre = await page.evaluate(() => ({
      kind: window.PALM_UI.view().kind,
      note: document.getElementById('focusNote').textContent,
      cm: document.querySelector('#focusCardArea .fslot.viewonly') !== null,
    }));
    expect('顶卡为资源态：仅展示不可操作 · 提示自动复位', pre.kind === 'res' && pre.cm && pre.note.includes('自动复位'));
    await page.waitForFunction(() => window.PALM_UI.view().kind === 'card', null, { timeout: 4000 });
    await idle();
    const s = await st();
    expect('自动左转复位：回到非资源态 · 沉到标记卡之下 · 牌堆仍 16',
      s.kind === 'card' && s.deckN === '16' && (await lastLog()).s.includes('资源复位'));
  }

  console.log('■ 8 转 180° / 翻面（支付抽屉）');
  {
    await setScene(scene([['quarry', 0, 0, 0], ['woodcutter', 0, 0, 0], ['woodcutter', 1, 0, 1, true], ['woodcutter', 2, 1, 1, true]]));
    await page.click('#btnSpin180');
    await page.waitForTimeout(240);
    const q1 = await page.evaluate(() => ({
      open: !document.getElementById('payMask').classList.contains('hidden'),
      title: document.getElementById('payTitle').textContent,
      optsHidden: document.getElementById('payOpts').classList.contains('hidden'),
      need: document.getElementById('payNeed').textContent,
    }));
    expect('转 180° 支付抽屉（无费用方案 chips · 需 2🪵）', q1.open && q1.title.includes('180') && q1.optsHidden && q1.need.length > 0);
    await page.evaluate(() => window.PALM_UI.payToggle(2));      // 樵夫 w1 → 不够
    await page.waitForTimeout(120);
    const q2 = await page.evaluate(() => document.getElementById('btnPayGo').disabled);
    expect('1🪵 不足抵 2🪵：保持禁用', q2 === true);
    await page.evaluate(() => window.PALM_UI.payToggle(3));      // + 樵夫背180° w2
    await page.waitForTimeout(120);
    await page.click('#btnPayGo');
    await idle();
    expect('转 180° 后：仍正面 · 行翻到 180° · 沉底', await page.evaluate(() => {
      const S = window.PALM_UI.state();
      const c = S.deck.find(x => x.uid === 'quarry#0');
      return c.face === 0 && c.row === 1 && S.deck[16].uid === 'quarry#0';
    }));
    /* 翻面：保持行 · 正 → 背 */
    await setScene(scene([['quarry', 0, 0, 0], ['woodcutter', 0, 0, 0], ['woodcutter', 1, 0, 1, true], ['boathouse', 2, 0, 1, true]]));
    await page.click('#btnFlip');
    await page.waitForTimeout(240);
    expect('翻面支付抽屉', await page.evaluate(() => !document.getElementById('payMask').classList.contains('hidden')
      && document.getElementById('payTitle').textContent.includes('翻面')));
    await page.evaluate(() => window.PALM_UI.payToggle(3));      // 船屋 2🐟 抵 2🐟
    await page.waitForTimeout(120);
    await page.click('#btnPayGo');
    await idle();
    expect('翻面后：面翻到背面 · 行保持 0° · 沉底', await page.evaluate(() => {
      const S = window.PALM_UI.state();
      const c = S.deck.find(x => x.uid === 'quarry#0');
      return c.face === 1 && c.row === 0 && S.deck[16].uid === 'quarry#0';
    }));
  }

  console.log('■ 9 R19 资源上限 4：重置选择抽屉');
  {
    await setScene(scene([['woodcutter', 0, 0, 0], ['boathouse', 0, 0, 0],
      ['woodcutter', 1, 0, 1, true], ['boathouse', 2, 0, 1, true], ['quarry', 1, 1, 0, true], ['quarry', 2, 1, 1, true]]));
    const b0 = await st();
    expect('满仓夹具：资源 4 / 4（w1 f2 s3）', b0.bankN === '4 / 4' && b0.wood === '1' && b0.fish === '2' && b0.stone === '3');
    await page.click('#btnCollect');
    await page.waitForTimeout(260);
    const r1 = await page.evaluate(() => ({
      open: !document.getElementById('resetPickMask').classList.contains('hidden'),
      rows: document.querySelectorAll('#resetPickRows .payrow').length,
      goDis: document.getElementById('btnResetPickGo').disabled,
      info: document.getElementById('resetPickInfo').textContent,
      pick: window.PALM_UI.resetPickState(),
    }));
    expect('收集触发上限：重置选择抽屉 4 张候选 · 未选不可继续', r1.open && r1.rows === 4 && r1.goDis && r1.pick.action === 'collect');
    await shot('m9-reset-pick.png');
    await page.evaluate(() => window.PALM_UI.resetPickSelect('quarry#1'));
    await page.waitForTimeout(140);
    const r2 = await page.evaluate(() => ({
      goDis: document.getElementById('btnResetPickGo').disabled,
      info: document.getElementById('resetPickInfo').textContent,
    }));
    expect('选中一张后信息与按钮就绪', !r2.goDis && r2.info.includes('采石场'));
    await page.click('#btnResetPickGo');
    await idle();
    const b1 = await st();
    expect('重置并继续：仍 4 / 4（换入新收集卡）· 合计 w2 f2 s2', b1.bankN === '4 / 4' && b1.wood === '2' && b1.fish === '2' && b1.stone === '2');
    expect('被重置卡原位复位（未改牌堆顺序）· 收集卡沉底横置', await page.evaluate(() => {
      const S = window.PALM_UI.state();
      const q = S.deck.findIndex(x => x.uid === 'quarry#1');
      return q === 3 && S.deck[q].res === false                       // 目标卡移走后仅整体前移 1 位
        && S.deck[2].uid === 'boathouse#2' && S.deck[4].uid === 'quarry#2'
        && S.deck[16].uid === 'woodcutter#0' && S.deck[16].res === true;
    }));
    /* 取消路径：状态不动 */
    await setScene(scene([['woodcutter', 0, 0, 0], ['boathouse', 0, 0, 0],
      ['woodcutter', 1, 0, 1, true], ['boathouse', 2, 0, 1, true], ['quarry', 1, 1, 0, true], ['quarry', 2, 1, 1, true]]));
    await page.click('#btnCollect');
    await page.waitForTimeout(220);
    await page.click('#btnResetPickCancel');
    await page.waitForTimeout(160);
    expect('取消：抽屉收起 · 牌堆顶与资源数不动', await page.evaluate(() => {
      const S = window.PALM_UI.state();
      return document.getElementById('resetPickMask').classList.contains('hidden')
        && S.deck[0].uid === 'woodcutter#0' && S.deck.filter(c => window.PALM.isCard(c) && c.res).length === 4;
    }));
  }

  console.log('■ 10 回合标记自动计数（无离场）');
  {
    const S = scene([['woodcutter', 0, 0, 0]], 2);
    const mkCard = S.deck.pop(); S.deck.unshift(mkCard);
    await setScene(S);
    const pre = await page.evaluate(() => ({
      kind: window.PALM_UI.view().kind,
      sun: document.querySelector('#focusCardArea .mk-sun').textContent,
      note: document.getElementById('focusNote').textContent,
    }));
    expect('标记卡置顶：自动计数位 · 第 3 次将读出', pre.kind === 'marker' && pre.sun === '3' && pre.note.includes('自动计数'));
    await shot('m10-marker.png');
    await page.waitForFunction(() => window.PALM_UI.view().kind === 'card', null, { timeout: 4000 });
    await idle();
    const s = await st();
    expect('计数 +1（2→3）· 轮次推进到第 4 / 8 轮 · 无卡牌离场（仍 16）', s.markerN === 3 && s.roundTxt.includes('第 4') && s.cards === 16);
    const pips = await page.evaluate(() => ({
      done: document.querySelectorAll('#roundPips .pip.done').length,
      now: document.querySelectorAll('#roundPips .pip.now').length,
    }));
    expect('轮次底线 3 完成 / 1 当前', pips.done === 3 && pips.now === 1);
    const lg = await lastLog();
    expect('日志：轮结束 → 轮开始', lg.s.includes('第 4 轮开始'));
  }

  console.log('■ 11 抽屉三件套 + 重置开局');
  {
    await page.click('#logbar');
    await page.waitForTimeout(220);
    const lg = await page.evaluate(() => ({
      open: !document.getElementById('logMask').classList.contains('hidden'),
      items: document.querySelectorAll('#logList .log-item').length,
      first: document.querySelector('#logList .log-item') ? document.querySelector('#logList .log-item').textContent : '',
    }));
    expect('日志抽屉：最新在前', lg.open && lg.items >= 2 && lg.first.includes('第 4 轮开始'));
    await shot('m11-log.png');
    await page.click('#btnCloseLog');
    await page.waitForTimeout(160);
    await page.click('#btnReset');
    await page.waitForTimeout(220);
    expect('重置确认抽屉', await page.evaluate(() => !document.getElementById('resetMask').classList.contains('hidden')));
    await shot('m12-reset.png');
    await page.click('#btnResetBack');
    await page.waitForTimeout(160);
    const keep = await st();
    expect('取消重置：回合不变', keep.roundTxt.includes('第 4'));
    await page.click('#btnReset');
    await page.waitForTimeout(200);
    await page.click('#btnResetGo');
    await page.waitForTimeout(700);
    const fresh = await page.evaluate(() => ({
      active: window.PALM_UI.coachActive(),
      round: document.getElementById('roundTxt').textContent,
      deckN: document.getElementById('deckN').textContent,
    }));
    expect('重置后新局：第 1 / 8 轮 · 牌堆 16 · 引导不再出现', fresh.round.includes('第 1') && fresh.deckN === '16' && !fresh.active);
  }

  console.log('■ 12 存档续玩（刷新恢复 / 回菜单留档）');
  {
    await setScene(scene([['woodcutter', 0, 0, 0], ['boathouse', 1, 0, 0]]));
    await page.click('#btnCollect');
    await idle();
    const before = await st();
    await page.reload();
    await page.waitForTimeout(420);
    const menu = await page.evaluate(() => ({
      resumeShown: !document.getElementById('btnResume').classList.contains('hidden'),
      sub: document.getElementById('resumeSub').textContent,
    }));
    expect('刷新后回封面：「继续上次航程」可见并带进度', menu.resumeShown && menu.sub.includes('第 3 / 8 轮') && menu.sub.includes('1 / 4'));
    await shot('m13-resume.png');
    await page.click('#btnResume');
    await page.waitForTimeout(300);
    const after = await st();
    expect('续玩恢复：轮次 / 牌堆 / 资源一致', after.roundTxt === before.roundTxt && after.deckN === before.deckN && after.bankN === before.bankN);
    await page.click('#btnMenu');
    await page.waitForTimeout(220);
    expect('回菜单留档：继续按钮仍在', await page.evaluate(() => !document.getElementById('btnResume').classList.contains('hidden')));
    await page.click('#btnResume');
    await page.waitForTimeout(220);
  }

  console.log('■ 13 结算（段位印章 · 清单 · 最佳写入 · 清档）');
  {
    const S = scene([['woodcutter', 0, 0, 0]], 7);
    /* 铺高分终态：两座神殿背0°（10⭐×2）+ 两栋房屋背0°（6⭐×2）+ 樵夫背0°（5⭐）→ 37 */
    [['temple', 0], ['temple', 1], ['house', 0], ['house', 1], ['woodcutter', 2]].forEach(function (u) {
      const c = S.deck.find(x => x.uid === u[0] + '#' + u[1]);
      c.face = 1; c.row = 0;
    });
    const mkCard = S.deck.pop(); S.deck.unshift(mkCard);
    const expected = G.score(S).total;
    await page.evaluate(() => { try { localStorage.removeItem('palm-island-best'); } catch (e) {} });
    await setScene(S);
    await page.waitForFunction(() => window.PALM_UI.screen() === 'win', null, { timeout: 6000 });
    await page.waitForFunction((t) => document.getElementById('winScore').textContent === String(t), expected, { timeout: 4000 });
    const w = await page.evaluate(() => ({
      stamp: document.querySelector('.win-stamp').textContent,
      rows: document.querySelectorAll('#winList .winrow').length,
      best: document.getElementById('winBest').textContent,
      stored: localStorage.getItem('palm-island-state'),
      bestRaw: localStorage.getItem('palm-island-best'),
      kicker: document.querySelector('.win-kicker').textContent,
    }));
    expect('结算：' + expected + '⭐ → 段位「优秀的」· 清单 16 行',
      w.stamp.includes('优秀的') && w.rows === 16 && w.kicker.includes('8 轮'));
    expect('最佳写入（新纪录）· 终局清档', w.best.includes('新纪录') && w.bestRaw && JSON.parse(w.bestRaw).best === expected && w.stored === null);
    const wl = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#winList .winrow .pcard')];
      return {
        n: cards.length,
        oneBar: cards.every(c => c.querySelectorAll('.pc-bar').length === 1),
        noRows: cards.every(c => c.querySelectorAll('.pc-row').length === 0),
        stemples: cards.filter(c => c.querySelector('.pc-nm').textContent === '神殿').length,
      };
    });
    expect('结算清单：每卡只印当前朝向（1 条框条 · 无其他朝向内容）· 16 张', wl.n === 16 && wl.oneBar && wl.noRows && wl.stemples === 2);
    await page.waitForTimeout(450);
    await idle(); /* 等落章盖章 + 金色火花排空，截到稳定态 */
    await shot('m14-win.png');
  }

  console.log('■ 14 再来一局 + 封面读数');
  {
    await page.click('#btnAgain');
    await page.waitForTimeout(700);
    const g = await st();
    expect('再来一局：新航程第 1 轮 · 引导不再出现', g.roundTxt.includes('第 1') && g.deckN === '16' && !(await page.evaluate(() => window.PALM_UI.coachActive())));
    await page.click('#btnMenu');
    await page.waitForTimeout(240);
    const m = await page.evaluate(() => ({
      meta: document.getElementById('menuMeta').textContent,
      resumeShown: !document.getElementById('btnResume').classList.contains('hidden'),
    }));
    expect('封面读数：最佳 37 · 已完成 1 次 · 新开局可继续', m.meta.includes('37') && m.meta.includes('1 次航程') && m.resumeShown);
    await shot('m15-menu-best.png');
  }

  console.log('■ 15 金路径：脚本代打整局到结算');
  {
    await page.evaluate(() => { try { localStorage.removeItem('palm-island-state'); } catch (e) {} });
    await setScene(scene([], 0));
    await page.waitForTimeout(200);
    let guard = 0, acts = 0;
    while (guard++ < 500) {
      const cur = await page.evaluate(() => {
        const UI = window.PALM_UI;
        if (UI.isBusy()) return { wait: true };
        const v = UI.view();
        if (v.kind === 'settle') return { done: true };
        if (v.kind === 'marker') { UI.actRaw('marker'); return { acted: 'marker' }; }
        if (v.kind === 'res') { UI.actRaw('reset'); return { acted: 'reset' }; }
        const r = UI.actRaw('collect', null);
        if (!r.ok) { UI.actRaw('skip'); return { acted: 'skip' }; }
        return { acted: 'collect' };
      });
      if (cur.done) break;
      if (cur.acted) acts += 1;
      await page.waitForTimeout(cur.acted ? 90 : 140);
    }
    const done = await page.evaluate(() => ({
      screen: window.PALM_UI.screen(),
      rows: document.querySelectorAll('#winList .winrow').length,
      cards: window.PALM_UI.view().counts.cards,
      log: window.PALM_UI.state().log.map(e => e.s),
    }));
    expect('金路径打满 8 轮进入结算（' + acts + ' 步）· 全程 16 张卡不离场',
      done.screen === 'win' && done.rows === 16 && done.cards === 16);
    expect('日志闭环：第 8 轮结束 + 结算', done.log.some(s => s.includes('第 8 轮结束')) && done.log.some(s => s.includes('结算')));
    await page.waitForTimeout(650);
    await idle(); /* 等落章 + 火花结束再截，避免截到半透明演出帧 */
    await shot('m16-golden-win.png');
    await page.click('#btnHome');
    await page.waitForTimeout(220);
  }

  console.log('■ 16 桌面视口（1280×820）');
  {
    const desk = await browser.newPage({ viewport: DESK });
    desk.on('pageerror', e => errors.push('PAGE(desk): ' + e.message));
    desk.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE(desk): ' + m.text()); });
    await desk.goto(URL);
    await desk.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await desk.reload();
    await desk.waitForTimeout(400);
    await desk.screenshot({ path: path.join(SHOTS, 'd1-menu.png') });
    console.log('  shot: d1-menu.png');
    await desk.click('#btnStart');
    await desk.waitForFunction(() => window.PALM_UI.coachActive(), null, { timeout: 4000 });
    await desk.click('#coachSkip');
    await desk.waitForTimeout(260);
    const D = await desk.evaluate(() => {
      const rect = el => el.getBoundingClientRect();
      const slots = [...document.querySelectorAll('#focusCardArea .fslot')].map(rect);
      const stage = document.getElementById('screen-game');
      return {
        sameTop: Math.abs(slots[0].top - slots[1].top) < 1,
        sideBySide: slots[0].right <= slots[1].left + 1,
        actsVisible: rect(document.getElementById('actbar')).bottom < innerHeight + 1,
        deckItems: document.querySelectorAll('#decklist .dkitem').length,
        overflow: stage.scrollHeight - stage.clientHeight,
      };
    });
    expect('桌面：焦点双卡横排 · 行动栏在视口内 · 横置资源条开局空态 · 无溢出', D.sameTop && D.sideBySide && D.actsVisible && D.deckItems === 0 && D.overflow <= 1);
    await desk.screenshot({ path: path.join(SHOTS, 'd2-game.png') });
    console.log('  shot: d2-game.png');
    await desk.close();
  }

  console.log('\n=== 断言: ' + ok + '/' + total + (ok === total ? '  ALL OK' : '') + ' ===');
  if (errors.length) { console.log('控制台/页面错误:'); errors.forEach(e => console.log('  ' + e)); }
  expect('无控制台/页面错误', errors.length === 0);
  console.log('最终: ' + ok + '/' + total);
  await browser.close();
  process.exit(ok === total ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
