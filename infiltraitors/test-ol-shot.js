/* ============================================================
   渗透因子 · 联机模式截图走查（node test-ol-shot.js）
   覆盖：联机入口 / 大厅（创建·加入）/ 等候室（房主可编辑配置 · 成员只读 · 满 2 人才可开局）/
        开局弹窗（配置 + 发牌演出 + 随机先手 + 5 秒倒计时自动关闭）/
        牌桌玩家区（各座位视图 · 手牌与盯梢目标保密 · 回合灯）/
        五类行动人人可用：盯梢 / 情报 / 通讯（多目标抽屉 + 摸牌子阶段）/ 潜伏 / 铲除（多目标 + 指认 + 落空·命中 + 拾牌）/
        推论板（多目标切换 + 长按自动分析）/ 抽屉三连（叛徒区保密 / 弃牌堆 / 情报明细）/
        他方子阶段提示 / 他方行动横幅（中文标签）/ 打出落点（落在区域最后一张）/
        铲除命中的「先揭示、后清空」（盯梢牌与情报区不被重绘提前清掉）/
        结算（房主·成员按钮差异）/ 5 人布局 / 桌面横排 /
        联机不写单机 localStorage（req8）· 全程无页面错误
   说明：Supabase 用桩替换（CDN 与本地 supabase.min.js 两个来源都拦，离线可跑），本脚本不触网、不读写真实房间行。
   ============================================================ */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const SHOTS = path.join(ROOT, 'shots');
const MOBILE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 820 };
const URL = 'file://' + path.join(ROOT, 'index_ol.html').replace(/\\/g, '/');

const OL = require('./game_ol.js');
const NAMES = ['林一', '秦二', '赵三', '周四', '吴五'];
const seeded = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

/* Supabase 桩：createClient 返回可链式调用的空实现（等待房主配置落库不会抛错，也不会真联网）
   __netSingle 统计单行查询次数（对账轮询的拉取探测）；select('*') 查无此行按真实语义回 not-found 错误 */
const SUPABASE_STUB = `
window.__netSingle = 0;
window.supabase = { createClient: function(){
  function chain(){
    var o = {
      _fields: null,
      select: function(f){ o._fields = f || '*'; return o; }, eq: function(){ return o; }, update: function(){ return o; },
      insert: function(){ return o; }, delete: function(){ return o; },
      single: function(){
        window.__netSingle++;
        if(o._fields === '*') return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'row not found' } });
        return Promise.resolve({ data: null, error: null });
      },
      then: function(res){ return Promise.resolve({ data: null, error: null }).then(res); },
    };
    return o;
  }
  return {
    from: function(){ return chain(); },
    channel: function(){ var ch = { on: function(){ return ch; }, subscribe: function(){ return ch; }, unsubscribe: function(){} }; return ch; },
    removeChannel: function(){},
  };
} };
`;

/* 摆局面：底稿是确定性 newGame，再覆写为「4 色 · 4 人 · 0/1/2 号各有盯梢」的干净局 */
const HANDS = [
  [OL.mk(0, 9), OL.mk(1, 4), OL.mk(2, 12), OL.mk(3, 7), OL.mk(1, 10)],
  [OL.mk(0, 15), OL.mk(2, 3), OL.mk(3, 5), OL.mk(1, 8), OL.mk(0, 2)],
  [OL.mk(2, 4), OL.mk(3, 14), OL.mk(1, 12), OL.mk(0, 5), OL.mk(2, 7)],
  [OL.mk(3, 9), OL.mk(0, 11), OL.mk(1, 13), OL.mk(2, 10), OL.mk(3, 2)],
  [OL.mk(0, 13), OL.mk(1, 15), OL.mk(2, 5), OL.mk(3, 15), OL.mk(0, 7)],
];
function scene(patch, n) {
  n = n || 4;
  const S = OL.newGame({ colors: 4, one: false, traitors: 7, extra: 3 },
    NAMES.slice(0, n).map(nm => ({ name: nm })), seeded(11));
  S.turnSeat = 0; S.turnNo = 3; S.round = 2;
  S.pending = null; S.pendingSeat = null; S.over = null;
  S.log.length = 0;
  S.watches = [OL.mk(0, 3), OL.mk(1, 6), OL.mk(2, 9), null, null].slice(0, n);
  S.traitorPile = [OL.mk(1, 5), OL.mk(2, 8), OL.mk(3, 11), OL.mk(0, 14)];
  S.hands = HANDS.slice(0, n).map(h => h.slice());
  S.intel = Array.from({ length: n }, () => ({ rel: [], unrel: [] }));
  const put = (seat, card) => { if (seat < n) S.intel[seat][OL.related(card, S.watches[seat]) ? 'rel' : 'unrel'].push(card); };
  put(0, OL.mk(0, 6)); put(0, OL.mk(3, 8));       // 红6（同色）有关 / 蓝8 无关
  put(1, OL.mk(2, 6)); put(1, OL.mk(3, 4));       // 绿6（同数）有关 / 蓝4 无关
  put(2, OL.mk(2, 15)); put(2, OL.mk(3, 13));     // 绿15（同色）有关 / 蓝13 无关
  S.discardUp = [OL.mk(2, 2), OL.mk(3, 6)];
  S.discardDown = [OL.mk(0, 8)];
  S.caught = 0; S.caughtCards = [];
  S.bullets = 10; S.bulletsMax = 10;
  const used = new Set([...S.hands.flat(), ...S.watches.filter(w => w != null), ...S.traitorPile,
    ...S.intel.flatMap(z => z.rel.concat(z.unrel)), ...S.discardUp, ...S.discardDown]);
  S.deck = OL.combos(S.cfg).filter(id => !used.has(id));
  S.stat = { shots: 1, hits: 0, misses: 1, stakes: 1, intels: 2, comms: 1, lurks: 0 };
  OL.logPush(S, 0, '林一 盯梢：锁定 1 名目标（剩 4 名待查）');
  OL.logPush(S, 2, '赵三 通讯 → 秦二【绿6】：有关');
  Object.assign(S, patch || {});
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
  /* 页面已把 supabase 换成本地 supabase.min.js（file://），CDN 路由留着兼容旧版 */
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'application/javascript', body: SUPABASE_STUB }));
  await page.route('**/supabase.min.js', route => route.fulfill({ contentType: 'application/javascript', body: SUPABASE_STUB }));

  const shot = async name => { await page.screenshot({ path: path.join(SHOTS, name) }); console.log('  shot:', name); };
  const setState = async (s, opts) => {
    await page.evaluate(a => {
      document.getElementById('app').style.display = 'block';
      document.getElementById('online').style.display = 'none';
      window.INFIL_OL_TEST.setState(a.s, a.o);
    }, { s, o: opts || null });
    await page.waitForTimeout(110);
  };
  const st = () => page.evaluate(() => {
    const S = window.INFIL_OL_TEST.state();
    if (!S) return null;
    return {
      n: S.n, turnSeat: S.turnSeat, turnNo: S.turnNo, round: S.round, pending: S.pending, pendingSeat: S.pendingSeat,
      over: S.over ? S.over.win : null, deck: S.deck.length, hands: S.hands.map(h => h.length),
      watches: S.watches.slice(), bullets: S.bullets, caught: S.caught,
      intel: S.intel.map(z => z.rel.length + z.unrel.length), up: S.discardUp.length, down: S.discardDown.length,
      left: window.INFIL_OL.traitorsLeft(S),
    };
  });
  const fx = v => page.evaluate(x => window.INFIL_OL_UI.setFx(x), v);
  const idle = async (to = 12000) => page.waitForFunction(() =>
    !window.INFIL_OL_UI.busy() && document.getElementById('fx').children.length === 0, null, { timeout: to });

  await page.goto(URL);
  await page.waitForTimeout(420);

  console.log('■ 1 首页：沿用原结构，主按钮改【联机模式】');
  {
    const m = await page.evaluate(() => ({
      menu: !document.getElementById('screen-menu').classList.contains('hidden'),
      start: document.getElementById('btnStart').textContent,
      resumeHidden: document.getElementById('btnResume').classList.contains('hidden'),
      metaGone: !document.getElementById('menuMeta'),
      lobbyHidden: getComputedStyle(document.getElementById('online')).display === 'none',
      hasSolo: typeof window.INFIL !== 'undefined',
    }));
    expect('封面可见 · 主按钮为联机模式', m.menu && m.start.includes('联机'));
    expect('无会话时【继续联机对局】隐藏', m.resumeHidden);
    expect('封面不再展示配置读数（配置在房间页）', m.metaGone);
    expect('未进大厅时 #online 隐藏', m.lobbyHidden);
    expect('index_ol.html 不加载单机引擎（INFIL 未定义）', !m.hasSolo);
    await shot('ol1-menu.png');
  }

  console.log('■ 2 大厅：创建房间 / 加入房间（4 位数字）');
  {
    await page.click('#btnStart');
    await page.waitForTimeout(220);
    const l = await page.evaluate(() => ({
      lobby: !!document.querySelector('#online .ol-lobby'),
      create: !!document.getElementById('ol-create'),
      join: !!document.getElementById('ol-join'),
      codeMax: document.getElementById('ol-code').maxLength,
      name: !!document.getElementById('ol-name'),
      app: getComputedStyle(document.getElementById('app')).display,
    }));
    expect('进入大厅：创建/加入入口齐备', l.lobby && l.create && l.join && l.name);
    expect('房间号输入限 4 位', l.codeMax === 4);
    expect('大厅内隐藏菜单层', l.app === 'none');
    await shot('ol2-lobby.png');
  }

  console.log('■ 3 等候室 · 房主：任务配置可编辑 · 满 2 人才可开始');
  {
    await page.evaluate(() => window.INFIL_OL_NET_TEST.identity(true, 0, '1234'));
    await page.evaluate(() => renderWaitingRoom({ status: 'waiting', seats: [{ seatIndex: 0, name: '林一' }], state: { cfg: { colors: 4, one: false, traitors: 7, extra: 3 } } }));
    await page.waitForTimeout(160);
    const w1 = await page.evaluate(() => ({
      code: document.querySelector('.ol-code').textContent,
      seats: document.querySelectorAll('.ol-seat').length,
      empty: document.querySelector('.ol-seat.empty .os-name').textContent,
      startBtn: document.getElementById('ol-start'),
      startDisabled: document.getElementById('ol-start').disabled,
      startText: document.getElementById('ol-start').textContent,
      editable: !document.querySelector('#online .cfg-panel .seg[data-k="traitors"] button').disabled,
      roCount: document.querySelectorAll('#online .cfg-panel .seg.ro').length,
      traitors: document.querySelectorAll('#online .cfg-panel .seg[data-k="traitors"] button').length,
      extra: document.querySelectorAll('#online .cfg-panel .seg[data-k="extra"] button').length,
      oneOn: document.querySelector('#online .cfg-panel .seg[data-k="one"] button.on').textContent,
      read: document.querySelector('#online .cfg-read').textContent,
    }));
    expect('房主等候室：房间号 + 1 个座位（房主）', w1.code === '1234' && w1.seats === 2 && w1.empty.includes('等待成员加入'));
    expect('房主配置面板可编辑（5 档叛徒 / 4 档额外子弹）', w1.editable && w1.traitors === 5 && w1.extra === 4 && w1.roCount === 0);
    expect('配置读数含牌库/叛徒/子弹/难度', /牌库/.test(w1.read) && /叛徒/.test(w1.read) && /子弹/.test(w1.read) && /难度|轻松|标准|紧张|绝望/.test(w1.read));
    expect('数字 1 行有选中态（默认「不含」）', w1.oneOn.startsWith('不含'));
    expect('不足 2 人：开始按钮禁用并标「等待成员加入」', w1.startDisabled && w1.startText.includes('等待成员加入'));
    await shot('ol3-waiting-host.png');
    /* 成员加入 → 门槛解除 + 配置联动 */
    await page.evaluate(() => renderWaitingRoom({
      status: 'waiting',
      seats: [{ seatIndex: 0, name: '林一' }, { seatIndex: 1, name: '秦二' }, { seatIndex: 2, name: '赵三' }],
      state: { cfg: { colors: 4, one: false, traitors: 7, extra: 3 } },
    }));
    await page.waitForTimeout(140);
    const w2 = await page.evaluate(() => ({
      seats: document.querySelectorAll('.ol-seat:not(.empty)').length,
      you: document.querySelector('.ol-seat.me .os-name').textContent,
      tags: [...document.querySelectorAll('.ol-seat .os-tag')].map(e => e.textContent),
      empty: document.querySelector('.ol-seat.empty .os-name').textContent,
      startDisabled: document.getElementById('ol-start').disabled,
      label: document.querySelector('.ol-sub').textContent,
    }));
    expect('3 人入座：房主标「你」· 标签 房主/成员/成员', w2.seats === 3 && w2.you.includes('（你）') && w2.tags.join(',') === '房主,成员,成员');
    expect('空位提示「还可加入 2 人」', w2.empty.includes('还可加入 2 人'));
    expect('满 2 人：开始对战可用 · 房主提示 3/5 人', !w2.startDisabled && w2.label.includes('3/5'));
    await page.click('#online .cfg-panel .seg[data-k="traitors"] button:nth-child(3)');   // 9 名叛徒
    await page.waitForTimeout(180);
    const w3 = await page.evaluate(() => ({
      read: document.querySelector('#online .cfg-read').textContent,
      on: document.querySelector('#online .cfg-panel .seg[data-k="traitors"] button.on').textContent,
    }));
    expect('房主改叛徒 9 → 读数联动（牌库 32 · 紧张）', w3.on === '9' && w3.read.includes('32') && w3.read.includes('紧张'));
    await shot('ol4-waiting-host-9.png');
    /* 数字 1 行可切换：点「含 1」高亮跟着走 · 读数重算（5 色不参与，此处 4 色） */
    await page.click('#online .cfg-panel .seg[data-k="one"] button:nth-child(2)');
    await page.waitForTimeout(180);
    const w4 = await page.evaluate(() => ({
      on: document.querySelector('#online .cfg-panel .seg[data-k="one"] button.on').textContent,
      n: document.querySelectorAll('#online .cfg-panel .seg[data-k="one"] button.on').length,
      read: document.querySelector('#online .cfg-read').textContent,
    }));
    expect('数字 1 行可点选：高亮唯一且切到「含 1」· 牌库 32→36（3 人 × 5 张 · 4 色含 1）',
      w4.on.includes('含 1') && !w4.on.startsWith('不含') && w4.n === 1 && w4.read.includes('36'));
    await page.click('#online .cfg-panel .seg[data-k="one"] button:nth-child(1)');   // 回「不含」
    await page.waitForTimeout(140);
  }

  console.log('■ 4 等候室 · 成员：配置只读 + 等待房主');
  {
    await page.evaluate(() => window.INFIL_OL_NET_TEST.identity(false, 1, '1234'));
    await page.evaluate(() => renderWaitingRoom({
      status: 'waiting',
      seats: [{ seatIndex: 0, name: '林一' }, { seatIndex: 1, name: '秦二' }, { seatIndex: 2, name: '赵三' }],
      state: { cfg: { colors: 5, one: true, traitors: 9, extra: 1 } },
    }));
    await page.waitForTimeout(160);
    const m = await page.evaluate(() => ({
      dis: [...document.querySelectorAll('#online .cfg-panel button')].every(b => b.disabled),
      ro: document.querySelectorAll('#online .cfg-panel .seg.ro').length,
      start: !!document.getElementById('ol-start'),
      note: document.querySelector('.ol-wait-note') ? document.querySelector('.ol-wait-note').textContent : '',
      label: document.querySelector('.ol-sub').textContent,
      onColors: document.querySelector('#online .cfg-panel .seg[data-k="colors"] button.on').textContent,
      onOne: document.querySelector('#online .cfg-panel .seg[data-k="one"] button.on').textContent,
      read: document.querySelector('#online .cfg-read').textContent,
    }));
    expect('成员侧配置全部只读（4 段 .ro）', m.dis && m.ro === 4);
    expect('成员侧无开始按钮 · 显示等待提示', !m.start && m.note.includes('等待房主开始对战'));
    expect('成员侧选中态正确（含 1 高亮）', m.onOne.includes('含 1') && !m.onOne.startsWith('不含'));
    expect('成员读到房主配置（5 色含 1 · 3 人牌库 51 · 绝望）', m.onColors.includes('5 色') && m.read.includes('51') && m.read.includes('绝望'));
    expect('成员侧顶部标房主名', m.label.includes('林一'));
    await shot('ol5-waiting-member.png');
  }

  console.log('■ 4b 等候室心跳：最后一次上报 / 信息回传后 5 分钟暂停拉取');
  {
    await page.evaluate(() => window.INFIL_OL_NET_TEST.identity(true, 0, '1234'));
    await page.evaluate(() => renderWaitingRoom({
      status: 'waiting',
      seats: [{ seatIndex: 0, name: '林一' }, { seatIndex: 1, name: '秦二' }],
      state: { cfg: { colors: 4, one: false, traitors: 7, extra: 3 } },
    }));
    const probe = () => page.evaluate(() => Object.assign(
      { fetches: window.__netSingle }, window.INFIL_OL_NET_TEST.waitPoll()));
    await page.evaluate(() => { window.__netSingle = 0; window.INFIL_OL_NET_TEST.waitStart(); });
    await page.waitForTimeout(80);
    const h1 = await probe();
    expect('心跳开播：定时器在跑 · 立即对账一次', h1.active && h1.fetches === 1 && h1.idleMs < 1000);
    await page.evaluate(() => window.INFIL_OL_NET_TEST.waitStop()); // 后续手动 tick，避免真实 2.5s 定时器干扰计数

    await page.evaluate(() => window.INFIL_OL_NET_TEST.waitTick());
    await page.waitForTimeout(80);
    const h2 = await probe();
    expect('窗口内 tick：照常拉取（2.5s 心跳）', h2.fetches === 2);

    await page.evaluate(() => window.INFIL_OL_NET_TEST.waitAge(5 * 60 * 1000 + 1000));
    await page.evaluate(() => window.INFIL_OL_NET_TEST.waitTick());
    await page.waitForTimeout(80);
    const h3 = await probe();
    expect('最后一次活动超过 5 分钟：暂停拉取（不再请求）', h3.fetches === 2 && h3.warned);

    await page.click('#online .cfg-panel .seg[data-k="extra"] button:nth-child(2)');   // 房主上报：改配置
    await page.waitForTimeout(200);
    const h4 = await probe();
    expect('上报成功 → 心跳窗口续期（恢复窗口内状态）', h4.idleMs < 2000 && !h4.warned);
    await page.evaluate(() => window.INFIL_OL_NET_TEST.waitTick());
    await page.waitForTimeout(80);
    const h5 = await probe();
    expect('续期后 tick 恢复拉取', h5.fetches === 3);
  }

  console.log('■ 5 开局弹窗：配置 + 发牌演出 + 随机先手 + 5 秒倒计时自动关闭');
  {
    const S = scene({}, 4);
    S.introId = 'g-oltest-1';
    await page.evaluate(() => window.INFIL_OL_NET_TEST.identity(true, 0, '1234'));
    await page.evaluate(s => window.INFIL_OL_TEST.setSeat(0), 0);
    await page.evaluate(() => window.INFIL_OL_TEST.setRoom('1234'));
    await setState(S, { live: true });
    await page.evaluate(() => window.INFIL_OL_TEST.showIntro());
    await page.waitForTimeout(360);
    const i1 = await page.evaluate(() => ({
      open: !document.getElementById('introMask').classList.contains('hidden'),
      sub: document.getElementById('introSub').textContent,
      cfg: document.getElementById('introCfg').textContent,
      first: document.getElementById('introFirst').textContent,
      seats: document.querySelectorAll('#introSeats .intro-seat').length,
      cards: document.querySelectorAll('#introSeats .intro-seat:first-child .icard').length,
      firstTag: document.querySelector('#introSeats .intro-seat.first .isfirst') ? document.querySelector('#introSeats .intro-seat.first .isfirst').textContent : '',
      me: !!document.querySelector('#introSeats .intro-seat.me'),
      count: document.getElementById('introCount').textContent,
      dealing: document.querySelectorAll('#introSeats .icard.deal').length,
    }));
    expect('开局弹窗弹出：4 人协作 · 4 色牌库', i1.open && i1.sub.includes('4 人协作') && i1.sub.includes('4 色'));
    expect('弹窗内展示本局配置（牌库/叛徒/子弹/难度）', i1.cfg.includes('牌库') && i1.cfg.includes('叛徒 7') && i1.cfg.includes('子弹 10'));
    expect('弹窗内点名随机先手', i1.first.includes('随机先手：') && NAMES.some(nm => i1.first.includes(nm)));
    expect('4 个座位各发 5 张牌背 · 先手座位有「先手」标 · 标出「你」', i1.seats === 4 && i1.cards === 5 && i1.firstTag === '先手' && i1.me);
    expect('发牌演出已启动（牌背飞入动画）', i1.dealing === 20);
    expect('倒计时从 5 起', i1.count === '5');
    await shot('ol6-intro.png');
    await page.waitForTimeout(1100);
    const i2 = await page.evaluate(() => document.getElementById('introCount').textContent);
    expect('倒计时逐秒递减（5 → ' + i2 + '）', +i2 < 5);
    await page.click('#btnIntroGo');
    await page.waitForTimeout(160);
    const i3 = await page.evaluate(() => ({
      hidden: document.getElementById('introMask').classList.contains('hidden'),
      cleared: document.getElementById('introSeats').innerHTML === '',
    }));
    expect('点【开始行动】立即关闭弹窗并清理发牌占位', i3.hidden && i3.cleared);
    /* 再开一次：不作操作 → 5 秒后自动关闭 */
    await page.evaluate(() => window.INFIL_OL_TEST.showIntro());
    await page.waitForTimeout(300);
    const i4 = await page.evaluate(() => !document.getElementById('introMask').classList.contains('hidden'));
    expect('再次弹出（成员同样可见）', i4);
    await page.waitForFunction(() => document.getElementById('introMask').classList.contains('hidden'), null, { timeout: 8000 });
    expect('倒计时结束自动关闭（无需点击）', true);
    await page.waitForTimeout(200);
  }

  console.log('■ 6 牌桌：玩家区（夜枭区式面板 / 自己的目标可见 / 他人保密 / 回合灯 / 行动可用性）');
  {
    const S = scene({}, 4);
    await setState(S, { live: true });
    const d = await page.evaluate(s => {
      const rows = [...document.querySelectorAll('#players .pl-row')];
      const myWatch = rows[0].querySelector('.pl-watch .card');
      return {
        rows: rows.length,
        meRow: rows.findIndex(r => r.classList.contains('me')),
        onRow: rows.findIndex(r => r.classList.contains('on')),
        lampOn: rows.filter(r => r.querySelector('.turn-lamp.on')).length,
        watches: rows.map(r => r.querySelector('.pl-watch').classList.contains('set')),
        watchTags: rows.map(r => r.querySelector('.watch-tag').textContent),
        hands: rows.map(r => +r.querySelector('.pl-hand b').textContent),
        chips: rows.map(r => [...r.querySelectorAll('.intel-n')].map(b => +b.textContent)),
        intelCards: rows.map(r => r.querySelectorAll('.intel-cards .card').length),
        cardsInPlayers: document.querySelectorAll('#players .card').length,
        playersCardIds: [...document.querySelectorAll('#players .card[data-id]')].map(c => +c.dataset.id),
        watchFaces: [...document.querySelectorAll('#players .pl-watch .card')].map(c => +c.dataset.id),
        watchBacks: document.querySelectorAll('#players .pl-watch .watch-back').length,
        myWatchId: myWatch ? +myWatch.dataset.id : null,
        names: rows.map(r => r.querySelector('.pl-name').textContent),
        youTag: rows[0].querySelector('.pl-you') ? rows[0].querySelector('.pl-you').textContent : '',
        myCards: document.querySelectorAll('#hand .card').length,
        myIds: [...document.querySelectorAll('#hand .card')].map(c => +c.dataset.id),
        turn: document.getElementById('turnsign').textContent,
        alertHidden: document.getElementById('alertbar').classList.contains('hidden'),
        btns: ['btnStake', 'btnIntel', 'btnComm', 'btnLurk', 'btnElim'].map(id => !document.getElementById(id).disabled),
        stakeLabel: document.querySelector('#btnStake span').textContent,
        commLabel: document.querySelector('#btnComm span').textContent,
        lurkLabel: document.querySelector('#btnLurk span').textContent,
        room: document.getElementById('tbRoom').textContent,
      };
    }, S);
    expect('玩家区按座位列出 4 块面板（名字齐）', d.rows === 4 && d.names.join(',') === '林一,秦二,赵三,周四');
    expect('本机座位标「你」· 回合灯只亮当前行动方', d.meRow === 0 && d.youTag === '你' && d.onRow === 0 && d.lampOn === 1);
    expect('盯梢位：0/1/2 号已布控 · 3 号未布控', JSON.stringify(d.watches) === JSON.stringify([true, true, true, false]));
    expect('盯梢位角标：已布控 / 待布控', d.watchTags.join(',') === '已布控,已布控,已布控,待布控');
    expect('手牌张数按座位显示（各 5 张）', JSON.stringify(d.hands) === JSON.stringify([5, 5, 5, 5]));
    expect('情报计数按座位显示（每块面板有关/无关两行）', JSON.stringify(d.chips) === JSON.stringify([[1, 1], [1, 1], [1, 1], [0, 0]]));
    expect('自己的盯梢目标正面可见（红3）· 只有本机能见',
      d.myWatchId === OL.mk(0, 3) && d.watchFaces.length === 1 && d.watchBacks === 2);
    expect('他人盯梢内容不泄露（1/2 号的目标牌不在玩家区 DOM）',
      !d.playersCardIds.includes(S.watches[1]) && !d.playersCardIds.includes(S.watches[2]));
    expect('公开情报区迷你牌进 DOM（0/1/2 号各 2 张 · 3 号空）',
      JSON.stringify(d.intelCards) === JSON.stringify([2, 2, 2, 0]) && d.cardsInPlayers === 7);
    expect('本机手牌渲染 5 张且与引擎一致', d.myCards === 5 && JSON.stringify(d.myIds) === JSON.stringify(S.hands[0]));
    expect('顶部读数：你的回合 · 第 2 轮 · 房间 1234', d.turn.includes('你的回合') && d.turn.includes('第 2 轮') && d.room.includes('1234'));
    expect('轮到我时提示条隐藏', d.alertHidden);
    expect('五类行动（盯梢已有目标 → 禁用并说明）', JSON.stringify(d.btns) === JSON.stringify([false, true, true, true, true]) && d.stakeLabel.includes('已有目标'));
    expect('通讯按钮说明「打给队友目标」· 潜伏「摸牌并暗弃 1」', d.commLabel.includes('打给队友目标') && d.lurkLabel.includes('摸牌并暗弃 1'));
    await page.click('#hand .card:nth-child(2)');
    await page.waitForTimeout(160);
    expect('点选手牌抬起（.pick）', await page.evaluate(() => !!document.querySelector('#hand .card.pick')));
    await shot('ol7-players.png');
    /* 点自己的盯梢位：提示目标内容（只有自己能看到）· 点他方：提示保密 */
    await page.click('#players .pl-row[data-seat="0"] .pl-watch');
    await page.waitForTimeout(160);
    const t1 = await page.evaluate(() => document.getElementById('toasts').textContent);
    expect('点自己的盯梢位 → 提示「你的盯梢目标：红3」', t1.includes('你的盯梢目标') && t1.includes('红3'));
    await page.click('#players .pl-row[data-seat="1"] .pl-watch');
    await page.waitForTimeout(160);
    const t2 = await page.evaluate(() => document.getElementById('toasts').textContent);
    expect('点他人的盯梢位 → 只提示「内容保密」（不泄露目标）', t2.includes('秦二') && t2.includes('保密') && !t2.includes('黄6'));
    /* 自己未布控时：盯梢位仍是可见空槽（不是被隐藏） */
    const U = scene({ watches: [null, OL.mk(1, 6), OL.mk(2, 9), null] }, 4);
    await setState(U, { live: true });
    const u = await page.evaluate(() => {
      const s = document.querySelector('#players .pl-row[data-seat="0"] .pl-watch');
      return {
        card: !!s.querySelector('.card'),
        tag: s.querySelector('.watch-tag').textContent,
        cls: s.className,
        w: Math.round(s.getBoundingClientRect().width),
      };
    });
    expect('自己未布控：盯梢位是空槽（无牌面 · 待布控 · 仍有宽度）',
      !u.card && u.tag === '待布控' && !u.cls.includes('set') && !u.cls.includes('mine') && u.w >= 24);
  }

  console.log('■ 7 通讯：多目标抽屉 → 判定 → 摸牌子阶段 → 交棒');
  {
    await fx(true);
    const S = scene({}, 4);
    await setState(S, { live: true });
    await page.click('#hand .card:nth-child(3)');
    await page.waitForTimeout(140);
    await page.click('#btnComm');
    await page.waitForTimeout(220);
    const p1 = await page.evaluate(() => ({
      open: !document.getElementById('pickMask').classList.contains('hidden'),
      title: document.getElementById('pickTitle').textContent,
      rows: [...document.querySelectorAll('#pickList .pick-row')].map(b => ({ seat: +b.dataset.seat, name: b.querySelector('b').textContent })),
    }));
    expect('通讯弹多目标抽屉（不含自己 · 只列有盯梢的队友）',
      p1.open && p1.rows.length === 2 && p1.rows.map(r => r.seat).join(',') === '1,2');
    expect('抽屉标题与目标名正确', p1.title.includes('通讯') && p1.rows[0].name === '秦二' && p1.rows[1].name === '赵三');
    await shot('ol8-comm-pick.png');
    await page.click('#pickList .pick-row[data-seat="2"]');
    await page.waitForFunction(() => window.INFIL_OL_TEST.state().pending === 'draw', null, { timeout: 9000 });
    await idle(9000);
    const s1 = await st();
    const p2 = await page.evaluate(() => ({
      mask: !document.getElementById('drawMask').classList.contains('hidden'),
      info: document.getElementById('drawInfo').textContent,
      chip2: [...document.querySelectorAll('#players .pl-row[data-seat="2"] .intel-n')].map(b => +b.textContent),
      hand: document.querySelectorAll('#hand .card').length,
    }));
    expect('通讯结算：手牌 5 → 4 · 判定计入 2 号情报区（1→2）', s1.hands[0] === 4 && p2.chip2[0] + p2.chip2[1] === 3 && p2.hand === 4);
    expect('通讯后弹出摸牌选择抽屉（仍在你的回合）', p2.mask && s1.pending === 'draw' && s1.pendingSeat === 0 && s1.turnSeat === 0);
    expect('抽屉读数含牌库剩余与手牌数', p2.info.includes('牌库剩余') && p2.info.includes('手牌 4/7'));
    await shot('ol9-draw-choose.png');
    await page.mouse.click(12, 40);                        // 摸牌是必选阶段
    await page.waitForTimeout(160);
    expect('摸牌为必选阶段：点遮罩不收起', await page.evaluate(() => !document.getElementById('drawMask').classList.contains('hidden')));
    await page.click('#btnDrawTake');
    await idle(9000);
    const s2 = await st();
    const p3 = await page.evaluate(() => ({
      alert: document.getElementById('alertbar').textContent,
      vis: !document.getElementById('alertbar').classList.contains('hidden'),
      ai: document.getElementById('alertbar').classList.contains('turn-ai'),
      turn: document.getElementById('turnsign').textContent,
      dead: document.querySelectorAll('#hand .card.dead').length,
      btns: ['btnStake', 'btnIntel', 'btnComm', 'btnLurk', 'btnElim'].map(id => document.getElementById(id).disabled),
      hand: document.querySelectorAll('#hand .card').length,
    }));
    expect('摸 1 张：手牌回 5 · 牌库 -1 · 交棒 1 号', s2.hands[0] === 5 && s2.turnSeat === 1 && s2.deck === S.deck.length - 1 && p3.hand === 5);
    expect('交棒后提示条点名「等待 秦二 行动…」', p3.vis && p3.ai && p3.alert.includes('等待 秦二 行动'));
    expect('非我方回合：手牌变暗 · 五类行动全部禁用', p3.dead === 5 && p3.btns.every(v => v === true) && p3.turn.includes('秦二'));
    await shot('ol10-after-comm.png');
    await fx(false);
  }

  console.log('■ 8 他方子阶段：提示条区分「摸牌 / 拾取」');
  {
    const A = scene({ turnSeat: 1, pending: 'draw', pendingSeat: 1 }, 4);
    await setState(A, { live: true });
    const a = await page.evaluate(() => ({
      vis: !document.getElementById('alertbar').classList.contains('hidden'),
      txt: document.getElementById('alertbar').textContent,
      tag: document.querySelector('#players .pl-row[data-seat="1"] .pl-pending') ? document.querySelector('#players .pl-row[data-seat="1"] .pl-pending').textContent : '',
      btnsDisabled: ['btnStake', 'btnIntel', 'btnComm', 'btnLurk', 'btnElim'].every(id => document.getElementById(id).disabled),
    }));
    expect('他方摸牌子阶段：提示条点名 + 座位标「决策中」', a.vis && a.txt.includes('秦二 正在决定是否摸牌') && a.tag === '决策中');
    expect('他方子阶段时本机五类行动全禁用', a.btnsDisabled);
    await shot('ol11-pending-ai.png');
    const B = scene({ turnSeat: 2, pending: 'reward', pendingSeat: 2 }, 4);
    await setState(B, { live: true });
    const b = await page.evaluate(() => document.getElementById('alertbar').textContent);
    expect('他方拾牌子阶段：提示条文案不同', b.includes('赵三 正在拾取战利品'));
  }

  console.log('■ 8b 他方行动横幅：中文行动标签（不出现原始英文键）');
  {
    await fx(true);                                        // 回放需要 fx 循环在跑
    const S = scene({}, 4);
    await setState(S, { live: true });
    /* 造一份「他人行动」快照：_src 行动座位 + _act 英文键 + _evs 演出序列，直接喂 applyRemote */
    const fireRemote = (seat, key) => page.evaluate(({ seat, key }) => {
      const st = JSON.parse(JSON.stringify(window.INFIL_OL_TEST.state()));
      st._src = seat; st._act = key;
      if (key === 'stake') st._evs = [{ k: 'stake', seat: seat, card: st.watches[seat] }];
      else if (key === 'lurk') { const c = st.deck.pop(); st._evs = [{ k: 'draw', cards: [c], to: seat }]; }
      else st._evs = [{ k: 'mill', n: 1 }];
      window.__remoteDone = window.INFIL_OL_UI.applyRemote(st, { replay: true });
    }, { seat, key });
    await fireRemote(1, 'stake');
    await page.waitForTimeout(220);
    const b1 = await page.evaluate(() => {
      const el = document.querySelector('#fx .banner');
      return { txt: el ? el.textContent : null, act: !!el && el.classList.contains('act') };
    });
    expect('他方盯梢横幅：中文标签「秦二 盯梢」（无 raw key "stake"）', b1.txt === '秦二 盯梢' && b1.act && b1.txt.indexOf('stake') < 0);
    /* 回归：横幅类名 act 曾命中行动按钮的 .act 样式（min-height clamp）被撑成高盒子；
       按钮外观限定 button.act 后，.banner.act 显式恢复为贴合文字的带框徽章
       （1.5px 边框在 Chromium 计算值会取整成 1px，故只校验「有实线边框」） */
    const b1geo = await page.evaluate(() => {
      const el = document.querySelector('#fx .banner');
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const rg = document.createRange(); rg.selectNodeContents(el);
      const t = rg.getBoundingClientRect();
      return {
        h: r.height, bg: cs.backgroundImage, bw: cs.borderTopWidth, bs: cs.borderTopStyle,
        pad: cs.paddingTop, rad: cs.borderTopLeftRadius,
        dy: Math.abs((r.top + r.height / 2) - (t.top + t.height / 2)),
      };
    });
    expect('横幅为带框徽章（实线边框 + 深色渐变底 + 12px 圆角，贴合文字不被撑高）· 文字垂直居中',
      b1geo.h < 50 && b1geo.bg.indexOf('linear-gradient') === 0 && parseFloat(b1geo.bw) >= 1
      && b1geo.bs === 'solid' && b1geo.pad === '6px' && b1geo.rad === '12px' && b1geo.dy <= 2);
    await shot('ol11b-remote-banner.png');
    await idle(9000);
    await fireRemote(2, 'lurk');
    await page.waitForTimeout(220);
    const b2 = await page.evaluate(() => {
      const el = document.querySelector('#fx .banner');
      return el ? el.textContent : null;
    });
    expect('他方潜伏横幅：中文标签「赵三 潜伏」', b2 === '赵三 潜伏');
    await idle(9000);
    /* 未收录的键兜底为「行动」，不裸奔英文 */
    await fireRemote(1, 'zzz');
    await page.waitForTimeout(220);
    const b3 = await page.evaluate(() => {
      const el = document.querySelector('#fx .banner');
      return el ? el.textContent : null;
    });
    expect('未知行动键兜底为「行动」', b3 === '秦二 行动');
    await idle(9000);
    await fx(false);
  }

  console.log('■ 8c 打出落点：飞行牌落在「区域最后一张」上（情报打自己 · 通讯打队友）');
  {
    await fx(true);
    const S = scene({}, 4);
    await setState(S, { live: true });
    /* 在动画进行中采样：飞行牌矩形 vs 区域内最后一张牌的矩形（renderAll 会重建 DOM，逐帧重取） */
    const measure = (to, zone) => page.evaluate(async ({ to, zone }) => {
      const rowSel = '#players .intel-cards[data-seat="' + to + '"][data-zone="' + zone + '"]';
      const before = document.querySelector(rowSel).querySelectorAll('.card').length;
      const st = JSON.parse(JSON.stringify(window.INFIL_OL_TEST.state()));
      const card = window.INFIL_OL.mk(0, 9);
      st.hands[0] = st.hands[0].filter(c => c !== card);
      for (let k = 0; k < 7; k++) st.intel[to][zone].push(window.INFIL_OL.mk(1, 3 + k));   // 撑宽区域：中点 ≠ 末牌
      st.intel[to][zone].push(card);
      st._src = 1; st._act = 'intel';
      st._evs = [{ k: 'play', seat: 0, card: card, to: to, zone: zone }];
      window.INFIL_OL_UI.applyRemote(st, { replay: true });
      let best = null;
      for (let i = 0; i < 80; i++) {
        const row = document.querySelector(rowSel);
        const cells = row.querySelectorAll('.card');
        const t = cells[cells.length - 1].getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        const f = [...document.querySelectorAll('#fx .fxc')].find(e => e.querySelector('.card[data-id]'));
        if (f && cells.length > before) {
          const r = f.getBoundingClientRect();
          best = {
            dx: Math.round(Math.abs(r.left - t.left)), dy: Math.round(Math.abs(r.top - t.top)),
            gapMid: Math.round(Math.abs((t.left + t.width / 2) - (rr.left + rr.width / 2))),
          };
        }
        await new Promise(r => setTimeout(r, 12));
      }
      return best;
    }, { to, zone });
    const L1 = await measure(0, 'rel');
    expect('情报：落点 = 自己区域的最后一张（dx/dy≈0 · 末牌确实不在区域中点）',
      !!L1 && L1.dx <= 2 && L1.dy <= 2 && L1.gapMid > 10);
    await page.waitForFunction(() => !window.INFIL_OL_UI.busy(), null, { timeout: 9000 });
    const L2 = await measure(1, 'rel');
    expect('通讯：落点 = 队友区域的最后一张（dx/dy≈0）', !!L2 && L2.dx <= 2 && L2.dy <= 2);
    await page.waitForFunction(() => !window.INFIL_OL_UI.busy(), null, { timeout: 9000 });
    await fx(false);
  }

  console.log('■ 8d 他方拾牌（铲除奖励）：飞行牌落向拾牌人，而不是吸进本机手牌');
  {
    await fx(true);
    const S = scene({}, 4);
    await setState(S, { live: true });
    /* 逐帧采样飞行克隆：记录最后落点到「拾牌人手牌叠」与「本机 #hand」的距离（克隆收尾后 best 停在落点） */
    const measure = (seat, from, card) => page.evaluate(async ({ seat, from, card }) => {
      const plSel = '#players .pl-hand[data-seat="' + seat + '"]';
      const st = JSON.parse(JSON.stringify(window.INFIL_OL_TEST.state()));
      st.hands[seat].push(card);
      (from === 'up' ? st.discardUp : st.discardDown).push(card);
      st._src = seat; st._act = 'pick';
      st._evs = [{ k: 'pick', seat: seat, card: card, from: from }];
      window.INFIL_OL_UI.applyRemote(st, { replay: true });
      let best = null;
      for (let i = 0; i < 90; i++) {
        const f = [...document.querySelectorAll('#fx .fxc')].find(e => e.querySelector('.card'));
        if (f) {
          const r = f.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const ph = document.querySelector(plSel).getBoundingClientRect();
          const hh = document.querySelector('#hand').getBoundingClientRect();
          best = {
            toPl: Math.round(Math.hypot(cx - (ph.left + ph.width / 2), cy - (ph.top + ph.height / 2))),
            toHand: Math.round(Math.hypot(cx - (hh.left + hh.width / 2), cy - (hh.top + hh.height / 2))),
            fd: !!f.querySelector('.card.facedown'),
          };
        }
        await new Promise(r => setTimeout(r, 12));
      }
      return best;
    }, { seat, from, card });
    const P = await measure(2, 'up', OL.mk(1, 11));
    expect('他方拾牌（明弃）：落点贴近拾牌人手牌叠 · 不再吸进本机 #hand · 牌面公开',
      !!P && P.toPl <= 15 && P.toHand >= 80 && !P.fd);
    await page.waitForFunction(() => !window.INFIL_OL_UI.busy(), null, { timeout: 9000 });
    const Q = await measure(1, 'down', OL.mk(2, 13));
    expect('他方拾牌（暗弃盲抽）：落点同样在拾牌人处 · 对本机只露牌背（盲抽结果不泄露）',
      !!Q && Q.toPl <= 15 && Q.toHand >= 80 && Q.fd);
    await page.waitForFunction(() => !window.INFIL_OL_UI.busy(), null, { timeout: 9000 });
    await fx(false);
  }

  console.log('■ 8e 他方铲除命中：重绘先冻结，盯梢牌与情报区「先揭示、后清空」');
  {
    await fx(true);
    const S = scene({}, 4);
    await setState(S, { live: true });
    /* 构造远端推来的铲除命中：座位 2 铲除座位 1 的盯梢目标（状态整盘一次到位） */
    const P = await page.evaluate(async () => {
      const st = JSON.parse(JSON.stringify(window.INFIL_OL_TEST.state()));
      const tra = st.watches[1];
      const swept = st.intel[1].rel.concat(st.intel[1].unrel);
      st.watches[1] = null; st.intel[1] = { rel: [], unrel: [] };
      st.discardUp.push(...swept); st.deck.push(tra);
      st.bullets--; st.caught = 1; st.pending = 'reward'; st.pendingSeat = 2;
      st._src = 2; st._act = 'elim';
      st._evs = [{ k: 'shot', seat: 2, target: 1, hit: true, guess: tra },
        { k: 'reveal', seat: 1, card: tra },
        { k: 'sweep', seat: 1, cards: swept },
        { k: 'back', card: tra }];
      const snap = () => {
        const w = document.querySelector('.pl-watch[data-seat="1"]');
        return { set: w.classList.contains('set'), face: !!w.querySelector('.card, .watch-back'),
          cards: document.querySelectorAll('.pl-row[data-seat="1"] .intel-cards .card').length,
          busy: window.INFIL_OL_UI.busy() };
      };
      const pr = window.INFIL_OL_UI.applyRemote(st, { replay: true });   // 不 await：同步重绘后立刻取画面
      const early = snap();
      await pr;
      return { early, late: snap(), stWatch: window.INFIL_OL_TEST.state().watches[1] === null };
    });
    expect('远端命中重绘当拍：状态已清但画面顶住（1 号盯梢牌与 2 张情报卡仍在）· 演出进行中',
      P.stWatch && P.early.busy && P.early.set && P.early.face && P.early.cards === 2);
    expect('回放结束：盯梢位与情报区按「揭示 · 清扫」顺序清空（冻结解除）',
      !P.late.busy && !P.late.set && !P.late.face && P.late.cards === 0);
    await fx(false);
  }

  console.log('■ 9 铲除：多目标 + 色数指认 → 落空 / 命中（公示 · 清扫 · 洗回）+ 拾牌');
  {
    const S = scene({}, 4);
    await setState(S, { live: true });
    await page.click('#btnElim');
    await page.waitForTimeout(220);
    const e1 = await page.evaluate(() => ({
      open: !document.getElementById('elimMask').classList.contains('hidden'),
      chips: [...document.querySelectorAll('#elimTargets .tchip')].map(b => b.textContent),
      pc: document.querySelectorAll('#pickColors .pc').length,
      pn: document.querySelectorAll('#pickNums .pn').length,
      fire: document.getElementById('btnFire').disabled,
      state: document.getElementById('pickState').textContent,
    }));
    expect('铲除抽屉：只列他人盯梢目标（2 个 · 不含自己的）',
      e1.open && e1.chips.length === 2 && e1.chips[0].includes('秦二') && e1.chips[1].includes('赵三') &&
      !e1.chips.some(c => c.includes('你自己的')));
    expect('指认面：4 色块 × 14 数字（不含 1）', e1.pc === 4 && e1.pn === 14);
    expect('未选完不可开枪 · 读数含剩弹与未铲除数', e1.fire && e1.state.includes('剩 10 发') && e1.state.includes('未铲除 7 名'));
    await shot('ol12-elim-pick.png');
    await page.click('#elimTargets .tchip[data-seat="1"]');
    await page.click('#pickColors .pc[data-c="1"]');
    await page.click('#pickNums .pn[data-n="4"]');
    await page.waitForTimeout(140);
    const e2 = await page.evaluate(() => ({
      fire: document.getElementById('btnFire').disabled,
      state: document.getElementById('pickState').textContent,
    }));
    expect('选完目标+色+数 → 可开枪并显示耗弹（10 → 9）', !e2.fire && e2.state.includes('秦二的') && e2.state.includes('黄 4') && e2.state.includes('10 → 9'));
    await page.click('#btnFire');
    await idle();
    const s1 = await st();
    const m1 = await page.evaluate(() => ({
      spent: document.querySelectorAll('#pips i.spent').length,
      b: document.getElementById('bcount').textContent,
      logs: window.INFIL_OL_TEST.state().log.some(l => l.text.includes('铲除落空')),
    }));
    expect('落空：子弹 -1 · 目标仍在（3 个盯梢位不变）· 换手', s1.bullets === 9 && s1.watches.filter(w => w != null).length === 3 && s1.turnSeat === 1);
    expect('落空：弹芯少 1 · 读数 9 · 日志有落空记录', m1.spent === 1 && m1.b === '9' && m1.logs);
    /* 命中：指认 1 号（秦二）的目标（黄6）——铲除不含自己盯梢的目标 */
    await fx(true);
    const H = scene({}, 4);
    await setState(H, { live: true });
    await page.click('#btnElim');
    await page.waitForTimeout(200);
    await page.click('#elimTargets .tchip[data-seat="1"]');
    await page.click('#pickColors .pc[data-c="1"]');
    await page.click('#pickNums .pn[data-n="6"]');
    await page.click('#btnFire');
    await page.waitForTimeout(620);                        // 手枪滑入 + 枪口火光
    /* 回归：命中已落进状态（watches[1]=null / intel[1] 清空），但演出期间目标座位的盯梢牌与
       情报区要「先揭示、后清空」——枪响阶段画面仍顶住行动前的样子 */
    const mid = await page.evaluate(() => {
      const S = window.INFIL_OL_TEST.state();
      const w = document.querySelector('.pl-watch[data-seat="1"]');
      return {
        stWatch: S.watches[1] === null, stIntel: S.intel[1].rel.length + S.intel[1].unrel.length,
        busy: window.INFIL_OL_UI.busy(), set: w.classList.contains('set'), face: !!w.querySelector('.card, .watch-back'),
        cards: document.querySelectorAll('.pl-row[data-seat="1"] .intel-cards .card').length,
      };
    });
    expect('枪响阶段：状态已清但画面顶住（1 号盯梢牌与 2 张情报卡仍在）· 演出进行中',
      mid.stWatch && mid.stIntel === 0 && mid.busy && mid.set && mid.face && mid.cards === 2);
    await shot('ol13-shot-mid.png');
    await page.waitForFunction(() => window.INFIL_OL_TEST.state().pending === 'reward' && !window.INFIL_OL_UI.busy(), null, { timeout: 15000 });
    const done = await page.evaluate(() => {
      const w = document.querySelector('.pl-watch[data-seat="1"]');
      return { set: w.classList.contains('set'), face: !!w.querySelector('.card, .watch-back'),
        cards: document.querySelectorAll('.pl-row[data-seat="1"] .intel-cards .card').length };
    });
    expect('揭示与清扫后：1 号盯梢位清空 · 情报区清空（冻结解除）', !done.set && !done.face && done.cards === 0);
    const h = await st();
    expect('命中：铲除 1 · 1 号盯梢位清空 · 子弹 9', h.caught === 1 && h.watches[1] === null && h.bullets === 9);
    expect('命中：1 号情报区清扫（2 → 0）· 明弃 +2 · 叛徒洗回牌库', h.intel[1] === 0 && h.up === H.discardUp.length + 2 && h.left === 6);
    const r1 = await page.evaluate(() => ({
      open: !document.getElementById('rewardMask').classList.contains('hidden'),
      cards: document.querySelectorAll('#rewardUp .card[data-i]').length,
      blind: document.getElementById('btnBlind').disabled,
      skip: document.getElementById('btnSkipReward').textContent,
      handN: document.getElementById('rewardHandN').textContent,
      handCards: document.querySelectorAll('#rewardHand .card').length,
      named: [...document.querySelectorAll('#rewardUp .card[data-i] .band')].every(b => b.children.length === 2 && b.lastElementChild.textContent.trim()),
      /* 色带通铺：明弃是 <button> 卡、手牌是 <div> 卡，两者都须左右仅剩 2px 边框、且显式 align-items:stretch */
      bandFit: [...document.querySelectorAll('#rewardUp .card[data-i], #rewardHand .card')].every(c => {
        const cr = c.getBoundingClientRect(), br = c.querySelector('.band').getBoundingClientRect();
        return Math.abs(br.left - cr.left) <= 2.5 && Math.abs(cr.right - br.right) <= 2.5 && getComputedStyle(c).alignItems === 'stretch';
      }),
    }));
    expect('命中后自动弹出拾牌抽屉：明弃可选 · 盲抽可用', r1.open && r1.cards === h.up && !r1.blind && r1.skip === '跳过');
    expect('拾牌小卡色带右侧标色名 · 底部展示手牌 5/7', r1.named && r1.handN === '5/7' && r1.handCards === 5);
    expect('色带通铺：button 明弃卡与 div 手牌卡均无内缩', r1.bandFit);
    await page.waitForTimeout(240);                         /* 等抽屉滑入动画结束再截屏 */
    await shot('ol14-reward.png');
    await page.click('#rewardUp .card[data-i="0"]');
    await idle();
    const h2 = await st();
    expect('拾取明弃 1 张：手牌 6 · 明弃 -1 · 子阶段结束并换手', h2.hands[0] === 6 && h2.up === h.up - 1 && h2.pending === null && h2.turnSeat === 1);
    await fx(false);
  }

  console.log('■ 10 潜伏：摸牌数抽屉（含上限）· 7 张手牌单行');
  {
    const S = scene({}, 4);
    await setState(S, { live: true });
    await page.click('#btnLurk');
    await page.waitForTimeout(220);
    const l1 = await page.evaluate(() => ({
      open: !document.getElementById('lurkMask').classList.contains('hidden'),
      n: document.querySelectorAll('#lurkOpts .lurk-opt').length,
      txt: document.querySelector('#lurkOpts .lurk-opt').textContent,
    }));
    expect('潜伏抽屉 2 个选项（手牌 5 → 最多补 2）', l1.open && l1.n === 2 && l1.txt.includes('摸 1') && l1.txt.includes('牌库 -2'));
    await shot('ol15-lurk.png');
    await page.click('#lurkOpts .lurk-opt:nth-child(2)');
    await idle();
    const s = await st();
    expect('潜伏摸 2 暗弃 1：手牌 7 · 牌库 -3 · 暗弃 +1', s.hands[0] === 7 && S.deck.length - s.deck === 3 && s.down === S.discardDown.length + 1);
    expect('潜伏后交棒（1 号）', s.turnSeat === 1);
    const row = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#hand .card')];
      const rs = cards.map(c => c.getBoundingClientRect());
      const hb = document.getElementById('hand').getBoundingClientRect();
      const top = rs[0].top;
      return {
        n: cards.length,
        oneRow: rs.every(r => Math.abs(r.top - top) < 1),
        inside: rs[0].left >= hb.left - 1 && rs[rs.length - 1].right <= hb.right + 1,
        z: getComputedStyle(cards[0]).zoom,
      };
    });
    expect('7 张手牌单行放下且不溢出（整行缩放 zoom ' + row.z + '）', row.n === 7 && row.oneRow && row.inside && parseFloat(row.z) < 1);
    await shot('ol16-hand-seven.png');
  }

  console.log('■ 11 推论板：多目标切换 + 长按自动分析');
  {
    const S = scene({}, 4);
    await setState(S, { live: true });
    await page.click('#btnBoard');
    await page.waitForTimeout(260);
    const b1 = await page.evaluate(() => ({
      open: !document.getElementById('boardMask').classList.contains('hidden'),
      chips: [...document.querySelectorAll('#boardTargets .tchip')].map(b => b.textContent),
      on: document.querySelector('#boardTargets .tchip.on').textContent,
      cand: +document.getElementById('candN').textContent,
      cells: document.querySelectorAll('#boardGrid .bcell.cand').length,
      hand: document.querySelectorAll('#boardGrid .bcell.hand').length,
      judge: document.querySelectorAll('#boardGrid .bcell.judge').length,
      auto: document.getElementById('autoHold').classList.contains('on'),
    }));
    expect('推论板 3 个盯梢目标可选 · 默认选第一个（你自己的）', b1.open && b1.chips.length === 3 && b1.on.includes('你的目标'));
    expect('默认不自动分析（无判定冲突）· 候选格数与读数一致', !b1.auto && b1.judge === 0 && b1.cand === b1.cells);
    expect('本机手牌 5 格标出', b1.hand === 5);
    await page.click('#boardTargets .tchip[data-seat="1"]');
    await page.waitForTimeout(220);
    const b2 = await page.evaluate(() => ({
      on: document.querySelector('#boardTargets .tchip.on').textContent,
      cand: parseInt(document.getElementById('candN').textContent, 10) || 0,
      cells: document.querySelectorAll('#boardGrid .bcell.cand').length,
    }));
    expect('切到「秦二的目标」：板面按所选目标重算（读数与高亮格一致）',
      b2.on.includes('秦二') && b2.cand > 0 && b2.cand === b2.cells);
    await shot('ol17-board.png');
    await page.evaluate(() => {
      const b = document.getElementById('autoHold');
      b.setPointerCapture = () => {};
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
    });
    await page.waitForTimeout(220);
    const b3 = await page.evaluate(() => ({
      cand: parseInt(document.getElementById('candN').textContent, 10) || 0,
      judge: document.querySelectorAll('#boardGrid .bcell.judge').length,
      on: document.getElementById('autoHold').classList.contains('on'),
    }));
    expect('长按 → 自动分析开启（候选收窄 ' + b2.cand + '→' + b3.cand + ' + 判定冲突 ' + b3.judge + ' 格）',
      b3.on && b3.cand < b2.cand && b3.judge > 0);
    await shot('ol18-board-auto.png');
    await page.evaluate(() => {
      const b = document.getElementById('autoHold');
      b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
    });
    await page.waitForTimeout(220);
    const b4 = await page.evaluate(() => ({
      cand: parseInt(document.getElementById('candN').textContent, 10) || 0,
      judge: document.querySelectorAll('#boardGrid .bcell.judge').length,
      on: document.getElementById('autoHold').classList.contains('on'),
    }));
    expect('松开 → 自动分析关闭（回到仅已知位置排除）', !b4.on && b4.judge === 0 && b4.cand === b2.cand);
    await page.click('#btnCloseBoard');
    await page.waitForTimeout(140);
  }

  console.log('■ 12 抽屉三连：叛徒区（保密）/ 弃牌堆 / 情报明细');
  {
    /* 中英混名：英文名与中文名的回退字体度量不同，盯梢格的卡牌曾被顶出 2px 错位 */
    const S = scene({ seats: [{ name: '你' }, { name: 'LM' }, { name: '昵称' }, { name: '周四' }] }, 4);
    await setState(S, { live: true });
    await page.click('#pileTrait');
    await page.waitForTimeout(240);
    const t = await page.evaluate(() => {
      const N = id => parseInt(document.getElementById(id).textContent, 10);
      const txt = s => [...document.querySelectorAll(s + ' .card')].map(c => (c.querySelector('.num') || {}).textContent || 'back');
      const cells = [...document.querySelectorAll('#tWatchCards .zcell')];
      return {
        open: !document.getElementById('traitorMask').classList.contains('hidden'),
        sub: document.getElementById('traitSub').textContent,
        n: [N('tPileN'), N('tWatchN'), N('tCaughtN')],
        down: ['#tPileCards', '#tWatchCards', '#tCaughtCards'].map(s => document.querySelectorAll(s + ' .card.facedown').length),
        up: ['#tPileCards', '#tWatchCards', '#tCaughtCards'].map(s => document.querySelectorAll(s + ' .card:not(.facedown)').length),
        cards: [txt('#tPileCards'), txt('#tWatchCards'), txt('#tCaughtCards')],
        tags: [...document.querySelectorAll('#tWatchCards .wtag')].map(e => e.textContent),
        tagH: cells.map(c => c.querySelector('.wtag').getBoundingClientRect().height),
        cardTop: cells.map(c => c.querySelector('.card').getBoundingClientRect().top),
      };
    });
    expect('叛徒区抽屉：4 名待查 + 3 名盯梢 + 0 名已铲除', t.open && t.n.join(',') === '4,3,0');
    expect('对局中：叛徒区全为牌背（不泄露真相）', t.down[0] === 4 && t.cards[0].every(v => v === 'back'));
    expect('盯梢区：只有自己的目标正面（红3）· 他人的仍是牌背（2 背 + 1 面）',
      t.up[1] === 1 && t.down[1] === 2 && t.cards[1][0] === '3' && t.cards[1][1] === 'back' && t.cards[1][2] === 'back');
    expect('盯梢牌按持有者署名（本机显示「你」）', t.tags.join(',') === '你,LM,昵称');
    expect('盯梢格：中英名标签行盒同高（固定 12px）· 三张卡顶严格对齐',
      t.tagH.every(h => h === 12) && t.cardTop.every(v => Math.abs(v - t.cardTop[0]) < 0.5));
    expect('抽屉副标题：只有你自己的盯梢目标可见', t.sub.includes('执行任务中') && t.sub.includes('只有你自己的盯梢目标可见'));
    await shot('ol19-traitor-hidden.png');
    await page.click('#btnCloseTraitor');
    await page.waitForTimeout(140);
    await page.click('#pileUp');
    await page.waitForTimeout(220);
    const d = await page.evaluate(() => {
      const group = [...document.querySelectorAll('#discUp .dgroup')]
        .reduce((a, b) => a.querySelectorAll('.card').length >= b.querySelectorAll('.card').length ? a : b);
      return {
        open: !document.getElementById('discMask').classList.contains('hidden'),
        groups: document.querySelectorAll('#discUp .dgroup').length,
        nums: [...group.querySelectorAll('.num')].map(x => +x.textContent),
        down: document.getElementById('discDownN').textContent,
        sub: document.getElementById('discSub').textContent,
        named: [...document.querySelectorAll('#discUp .card')].every(c => {
          const b = c.querySelector('.band');
          return b && b.children.length === 2 && b.lastElementChild.textContent.trim();
        }),
      };
    });
    expect('弃牌堆：明弃按色分组 · 数字升序 · 小卡标色名', d.open && d.groups >= 2 && d.nums.every((v, i) => i === 0 || d.nums[i - 1] <= v) && d.named);
    expect('暗弃只报张数 · 副题报总数', d.down === '1 张' && d.sub.includes('共 2 张'));
    await shot('ol20-disc.png');
    await page.click('#btnCloseDisc');
    await page.waitForTimeout(140);
    await page.click('#players .pl-row[data-seat="1"] .intel-row[data-zone="rel"]');
    await page.waitForTimeout(220);
    const i = await page.evaluate(() => ({
      open: !document.getElementById('intelMask').classList.contains('hidden'),
      sub: document.getElementById('intelSub').textContent,
      rel: document.querySelectorAll('#intelBody .zone-block:nth-child(1) .card').length,
      unrel: document.querySelectorAll('#intelBody .zone-block:nth-child(2) .card').length,
    }));
    expect('情报明细：按玩家查看（公开区 · 有关/无关两区）', i.open && i.sub.includes('LM') && i.rel === 1 && i.unrel === 1);
    await shot('ol21-intel.png');
    await page.click('#btnCloseIntel');
    await page.waitForTimeout(140);
  }

  console.log('■ 13 结算：房主可再来一局 / 成员只能回房等');
  {
    const mkOver = n => {
      const S = scene({ turnSeat: 1 }, n);
      S.caught = 7; S.caughtCards = S.traitorPile.slice(); S.traitorPile = [];
      S.watches = [null, null, null, null, null].slice(0, n);
      S.over = { win: true, why: 'done', stats: OL.statLine(S) };
      return S;
    };
    await page.evaluate(() => window.INFIL_OL_TEST.setSeat(0));
    await setState(mkOver(4), { live: true });
    await page.waitForTimeout(260);
    const h = await page.evaluate(() => ({
      open: !document.getElementById('overlay-win').classList.contains('hidden'),
      stamp: document.querySelector('.win-stamp') ? document.querySelector('.win-stamp').textContent : '',
      cls: document.querySelector('.win-stamp') ? document.querySelector('.win-stamp').className : '',
      dots: document.querySelectorAll('.vs-dots i.on').length,
      again: !!document.getElementById('btnAgain'),
      back: document.getElementById('btnBackRoom').textContent,
    }));
    expect('胜利结算：任务成功 + 7 芯全亮', h.open && h.stamp.includes('任务成功') && h.cls.includes('ok') && h.dots === 7);
    expect('房主视角：可再来一局 · 返回房间改配置', h.again && h.back.includes('返回房间改配置'));
    await shot('ol22-over-host.png');
    await page.evaluate(() => window.INFIL_OL_TEST.setSeat(2));
    await setState(mkOver(4), { live: true });
    await page.waitForTimeout(260);
    const m = await page.evaluate(() => ({
      again: !!document.getElementById('btnAgain'),
      back: document.getElementById('btnBackRoom').textContent,
      primary: document.getElementById('btnBackRoom').classList.contains('primary'),
    }));
    expect('成员视角：无「再来一局」· 按钮为「返回房间等待」且升为主按钮', !m.again && m.back.includes('返回房间等待') && m.primary);
    await shot('ol23-over-member.png');
    await page.evaluate(() => window.INFIL_OL_TEST.setSeat(0));
  }

  console.log('■ 14 5 人桌：玩家区 5 行 · 整体不溢出');
  {
    const S = scene({}, 5);
    await setState(S, { live: true });
    await page.waitForTimeout(200);
    const f = await page.evaluate(() => {
      const stage = document.getElementById('screen-game');
      const rail = document.getElementById('players');
      const act = document.getElementById('actbar');
      return {
        rows: document.querySelectorAll('#players .pl-row').length,
        overflow: stage.scrollHeight - stage.clientHeight,
        railScroll: rail.scrollHeight - rail.clientHeight,
        actBottom: act.getBoundingClientRect().bottom,
        vh: innerHeight,
        hand: document.querySelectorAll('#hand .card').length,
      };
    });
    expect('5 人：玩家区 5 行（房主 + 4 成员）', f.rows === 5 && f.hand === 5);
    expect('5 人桌不纵向溢出 · 行动栏仍贴底', f.overflow <= 1 && f.vh - f.actBottom < 24);
    await shot('ol24-five-players.png');
  }

  console.log('■ 15 桌面横排（1280×820）');
  {
    const dpage = await browser.newPage({ viewport: DESK });
    dpage.on('pageerror', e => errors.push('DPAGE: ' + e.message));
    dpage.on('console', m => { if (m.type() === 'error') errors.push('DCONSOLE: ' + m.text()); });
    await dpage.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'application/javascript', body: SUPABASE_STUB }));
    await dpage.route('**/supabase.min.js', route => route.fulfill({ contentType: 'application/javascript', body: SUPABASE_STUB }));
    await dpage.goto(URL);
    await dpage.waitForTimeout(420);
    await dpage.screenshot({ path: path.join(SHOTS, 'd-ol1-menu.png') });
    console.log('  shot: d-ol1-menu.png');
    await dpage.click('#btnStart');
    await dpage.waitForTimeout(220);
    await dpage.evaluate(() => window.INFIL_OL_NET_TEST.identity(true, 0, '1234'));
    await dpage.evaluate(() => renderWaitingRoom({
      status: 'waiting',
      seats: [{ seatIndex: 0, name: '林一' }, { seatIndex: 1, name: '秦二' }],
      state: { cfg: { colors: 4, one: false, traitors: 7, extra: 3 } },
    }));
    await dpage.waitForTimeout(220);
    await dpage.screenshot({ path: path.join(SHOTS, 'd-ol2-waiting.png') });
    console.log('  shot: d-ol2-waiting.png');
    const wide = await dpage.evaluate(s => {
      document.getElementById('app').style.display = 'block';
      document.getElementById('online').style.display = 'none';
      window.INFIL_OL_TEST.setSeat(0);
      window.INFIL_OL_TEST.setRoom('1234');
      window.INFIL_OL_TEST.setState(s, { live: true });
      return true;
    }, scene({}, 4));
    await dpage.waitForTimeout(260);
    const L = await dpage.evaluate(() => {
      const stage = document.getElementById('screen-game');
      const rail = document.getElementById('players');
      const r = rail.getBoundingClientRect();
      return {
        scrollX: document.documentElement.scrollWidth,
        w: innerWidth,
        overflow: stage.scrollHeight - stage.clientHeight,
        railW: r.width,
        railLeft: r.left,
        rows: document.querySelectorAll('#players .pl-row').length,
      };
    });
    expect('桌面端不横向溢出 · 不纵向溢出', L.scrollX <= L.w + 1 && L.overflow <= 1 && L.rows === 4);
    expect('桌面端玩家区居中收窄（' + Math.round(L.railW) + 'px）', L.railW <= 660 + 1 && L.railLeft > 0);
    await dpage.screenshot({ path: path.join(SHOTS, 'd-ol3-game.png') });
    console.log('  shot: d-ol3-game.png');
    await dpage.close();
    expect('桌面页装载正常', !!wide);
  }

  console.log('■ 16 收尾：联机不写单机 localStorage（req8）· 无页面错误');
  {
    const ls = await page.evaluate(() => ({
      soloState: localStorage.getItem('infiltraitors-state'),
      soloCfg: localStorage.getItem('infiltraitors-cfg'),
      olCfg: localStorage.getItem('infiltraitors-ol-cfg'),
      olSession: localStorage.getItem('infiltraitors-ol-session'),
    }));
    expect('单机存档键未被触碰（infiltraitors-state / infiltraitors-cfg 仍为空）', ls.soloState === null && ls.soloCfg === null);
    expect('联机配置写入自己的键（infiltraitors-ol-cfg）', ls.olCfg !== null && ls.olCfg.includes('colors'));
    expect('未加入真实房间：不写联机会话键', ls.olSession === null);
    expect('全程无页面错误', errors.length === 0);
    if (errors.length) console.log('  错误：\n  ' + errors.join('\n  '));
  }

  console.log('\n断言: ' + ok + '/' + total);
  await browser.close();
  if (ok < total) { console.log('部分断言未通过'); process.exit(1); }
  if (errors.length) process.exit(1);
  console.log('ALL OK');
}
main().catch(e => { console.error(e); process.exit(1); });
