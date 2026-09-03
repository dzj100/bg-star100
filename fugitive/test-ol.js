/* 神探缉凶 · 联机模式冒烟测试（真实 Supabase：房主 + 成员 双浏览器对局）
 * 覆盖：大厅创建 → 加入 → 座位显示 → 身份三选(房主警探) → 开始 → 双方视角
 *       → 大盗首回合放置/结束 → 警探抽2+猜错 → 大盗摸牌+放置 → 同步校验 → 成员退出→房主解散
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const URL = 'file:///' + path.resolve(__dirname, 'index_ol.html').replace(/\\/g, '/');
const SHOTS = path.join(__dirname, 'shots-ol');
if(!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, {recursive:true});

let failures = 0;
function assert(cond, msg){ if(!cond){ throw new Error('ASSERT FAIL: ' + msg); } }
async function shot(page, name){
  try { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); } catch(e){ console.log('  [shot err]', name, e.message); }
}
const stateOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(state)));
async function waitFor(page, fn, timeout, label, arg){
  const t0 = Date.now(); const limit = timeout || 30000;
  while(Date.now()-t0 < limit){
    let ok = false;
    try { ok = await page.evaluate(fn, arg); } catch(e){ ok = false; }
    if(ok) return;
    await page.waitForTimeout(200);
  }
  throw new Error('TIMEOUT waiting: ' + (label || fn.toString()));
}
function watchErrors(page, tag){
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if(m.type() === 'error') errs.push('console.error: ' + m.text()); });
  return errs;
}
// 点击文本开头匹配的按钮（如 'A 堆' 摸牌 / '猜' / '放置'）
async function clickBtn(page, prefix){
  const ok = await page.evaluate((p) => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => (x.textContent || '').trim().startsWith(p) && !x.disabled);
    if(!b) return false;
    b.click(); return true;
  }, prefix);
  assert(ok, '按钮「' + prefix + '…」未找到/不可点');
  await page.waitForTimeout(120);
}
// 精确点击「猜（N）」按钮（不能用前缀 '猜'，会误中网格工具的「猜测模式」按钮）
async function clickGuess(page){
  const ok = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => /^猜（/.test((x.textContent || '').trim()) && !x.disabled);
    if(!b) return false;
    b.click(); return true;
  });
  assert(ok, '猜按钮未找到/不可点');
  await page.waitForTimeout(120);
}
// 监听 #track 内翻牌动画 class 出现（flip-out 背面转出 / flip-in 正面转入），供双端动画断言。
// 必须观察 body 而非 #track：render() 每次整段重建 DOM，挂在 #track 旧节点上的 observer 会随节点销毁而失效。
async function watchFlips(page){
  await page.evaluate(() => {
    if(window.__flipLog) return;
    window.__flipLog = { out: false, in: false };
    const record = () => {
      if(document.querySelector('#track .t-card.flip-out')) window.__flipLog.out = true;
      if(document.querySelector('#track .t-card.flip-in')) window.__flipLog.in = true;
    };
    const obs = new MutationObserver(record);
    obs.observe(document.body, { subtree:true, childList:true, attributes:true, attributeFilter:['class'] });
    window.__flipObs = obs;
  });
}
// 警探：选一个必然命中的数字（首张暗置路线牌；首张必为 1~3，不可能在警探摸牌范围 4+ 内）
async function pickSafeHit(page){
  return page.evaluate(() => state.fug.route[0].num);
}
// 点击手牌数字卡
async function clickHandCard(page, n){
  const ok = await page.evaluate((num) => {
    const btns = [...document.querySelectorAll('#hand .h-card')];
    const b = btns.find(x => parseInt(x.textContent, 10) === num);
    if(!b) return false;
    b.click(); return true;
  }, n);
  assert(ok, '手牌卡 ' + n + ' 未找到');
  await page.waitForTimeout(120);
}
// 选主牌并点击「放置」：开局首推若迟到重复到达会 resetUI 清空选中 → 放置不可点 → 重试
async function selectAndPlace(page, n){
  for(let attempt = 0; attempt < 3; attempt++){
    await clickHandCard(page, n);
    try {
      await waitFor(page, () => {
        const b = [...document.querySelectorAll('#actions button')].find(x => (x.textContent || '').trim().startsWith('放置'));
        return !!b && !b.disabled;
      }, 4000, '放置按钮未变为可点');
      await clickBtn(page, '放置');
      return;
    } catch(e){
      if(attempt === 2) throw e;
      await page.waitForTimeout(300);
    }
  }
}
// 警探：选一个必然落空的猜测数字（避开暗置主牌/掩护/已翻开/手牌），单猜必 miss
async function pickSafeMiss(page){
  const n = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.g-cell')];
    const banned = new Set();
    state.fug.route.forEach(r => { banned.add(r.num); (r.cover||[]).forEach(c => banned.add(c)); });
    const c = cells.find(x => !x.disabled && !banned.has(parseInt(x.dataset.n,10)) && x.dataset.n !== '42');
    return c ? parseInt(c.dataset.n,10) : null;
  });
  assert(n !== null, '无可用的落空猜测数字');
  await page.click('.g-cell[data-n="' + n + '"]');
  await page.waitForTimeout(120);
  return n;
}

(async () => {
  const browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  const errA = watchErrors(host, 'host'), errB = watchErrors(guest, 'guest');
  host.on('dialog', d => d.dismiss().catch(()=>{}));
  guest.on('dialog', d => d.dismiss().catch(()=>{}));
  const t0 = Date.now();

  try {
    /* ============ 1. 首页 → 联机模式 → 房主创建房间 ============ */
    console.log('1. 房主打开首页并创建房间');
    await host.goto(URL);
    await host.waitForSelector('#ol-enter-online', { timeout: 20000 });
    assert(await host.isVisible('.ol-landing-title'), '首页标题缺失');
    const landingBtns = await host.$$eval('#online button', els => els.map(e => e.textContent.trim()));
    assert(landingBtns.length === 1 && landingBtns[0].indexOf('联机模式') >= 0, '首页应只有 1 个【联机模式】按钮: ' + landingBtns);
    await shot(host, '1-landing');
    await host.click('#ol-enter-online');
    await host.waitForSelector('#ol-code', { timeout: 20000 });
    // 加入表单应与创建按钮同屏：房间号在上、昵称紧跟其后（成员顺位填写）
    assert(await host.isVisible('#ol-name'), '大厅昵称输入缺失');
    const lbls = await host.$$eval('.ol-lobby .ol-label', els => els.map(e => e.textContent.trim()));
    assert(lbls[0].indexOf('房间号') >= 0, '加入表单应房间号在前: ' + lbls);
    await shot(host, '1-lobby');
    await host.click('#ol-create');
    await host.waitForSelector('#ol-modal-nick', { timeout: 10000 }); // 无存档昵称 → 弹昵称输入
    await shot(host, '1-host-nick-modal');
    await host.fill('#ol-nick-input', '房主阿明');
    await host.click('#ol-nick-ok');
    await host.waitForSelector('.ol-code', { timeout: 20000 });
    const code = (await host.textContent('.ol-code')).trim();
    assert(/^\d{4}$/.test(code), '房间号异常: ' + code);
    console.log('   房间号 =', code);
    // 身份三选渲染（房主可见）
    assert(await host.$$eval('.ol-assign', els => els.length === 3), '身份三选数量 ≠ 3');
    await shot(host, '1-host-waiting');
    // 等候室「✕ 退出」弹窗：取消应关闭弹窗且房间保留
    await host.click('.ol-room-top .icon-btn');
    await host.waitForSelector('#ol-modal-leave.show', { timeout: 10000 });
    await host.click('#ol-modal-leave .ol-modal-btn >> nth=1'); // 取消
    await host.waitForFunction(() => !document.getElementById('ol-modal-leave').classList.contains('show'), { timeout: 5000 });
    assert(await host.isVisible('.ol-code'), '取消退出后应仍在等候室');
    await shot(host, '1-host-leave-cancelled');
    // 房主选择身份
    await host.click('.ol-assign >> nth=0'); // host-mar 房主警探
    assert(await host.$eval('.ol-assign >> nth=0', el => el.classList.contains('sel')), '选择高亮失效');
    // 身份选择必须真实落库（成员进入时靠读房间行第一屏展示，不能只存内存）。
    // 建房间即落库默认「随机分配」，故不能取第一个非空值，要等目标值生效
    const persisted = await host.evaluate(async (roomCode) => {
      for(let i = 0; i < 20; i++){
        try {
          const room = await netGetRoom(roomCode);
          const a = room && room.state && room.state.assign;
          if(a === 'host-mar') return a;
        } catch(e){}
        await new Promise(r => setTimeout(r, 150));
      }
      return null;
    }, code);
    assert(persisted === 'host-mar', '房主选择未写入房间行 state.assign: ' + persisted);
    console.log('   身份选择已写入房间 (state.assign=' + persisted + ')');

    /* ============ 2. 成员加入 ============ */
    console.log('2. 成员加入房间');
    await guest.goto(URL);
    await guest.waitForSelector('#ol-enter-online', { timeout: 20000 });
    await guest.click('#ol-enter-online');
    await guest.waitForSelector('#ol-name', { timeout: 20000 });
    await guest.fill('#ol-name', '大盗小王');
    await guest.fill('#ol-code', code);
    await guest.click('#ol-join');
    await guest.waitForSelector('.ol-code', { timeout: 20000 });
    // 房主在成员加入前已选身份 → 成员第一屏应立即看到（不依赖轮询/房主再点）
    const tJoin = Date.now();
    await waitFor(guest, () => {
      const el = document.querySelector('.ol-assign-ro');
      return el && el.textContent.indexOf('房主警探') >= 0;
    }, 2500, '成员进入房间应立即看到房主已选身份');
    console.log('   成员进入即见身份分配 (' + (Date.now() - tJoin) + 'ms)');
    // 双方等候室均有 2 个真实座位（空位槽 .ol-seat.empty 不计）
    await waitFor(host, () => document.querySelectorAll('.ol-seat:not(.empty)').length === 2, 30000, '房主看到成员入座');
    await waitFor(guest, () => document.querySelectorAll('.ol-seat:not(.empty)').length === 2, 30000, '成员看到自己入座');
    const hostSeats = await host.$$eval('.ol-seat:not(.empty) .os-name', els => els.map(e => e.textContent));
    assert(hostSeats.join('|').indexOf('房主阿明') >= 0 && hostSeats.join('|').indexOf('大盗小王') >= 0, '座位名单错误: ' + hostSeats);
    const startDis = await host.$eval('#ol-start', el => el.disabled);
    assert(!startDis, '房主开始按钮应已可用');
    await shot(host, '2-host-full');
    await shot(guest, '2-guest-full');
    // 房主的身份选择需同步到成员侧（等候室实时展示）
    await waitFor(guest, () => !!document.querySelector('.ol-assign-ro'), 20000, '成员看到房主身份选择卡片');
    const assignTxt1 = await guest.textContent('.ol-assign-ro');
    assert(assignTxt1.indexOf('房主警探') >= 0, '成员看到的身份选择错误: ' + assignTxt1);
    await shot(guest, '2-guest-sees-assign');
    // 房主改选 → 成员侧实时更新
    await host.click('.ol-assign >> nth=1'); // host-fug 房主大盗
    await waitFor(guest, () => {
      const el = document.querySelector('.ol-assign-ro');
      return el && el.textContent.indexOf('房主大盗') >= 0;
    }, 20000, '成员看到房主改选为房主大盗');
    await host.click('.ol-assign >> nth=0'); // 改回 host-mar
    await waitFor(guest, () => {
      const el = document.querySelector('.ol-assign-ro');
      return el && el.textContent.indexOf('房主警探') >= 0;
    }, 20000, '成员看到房主改回房主警探');
    console.log('   身份选择已实时同步到成员侧');
    await shot(guest, '2-guest-assign-sync');

    /* ============ 3. 开始对战（host-mar：房主警探 / 成员大盗） ============ */
    console.log('3. 开始对战（房主警探 / 成员大盗）');
    await host.click('#ol-start');
    // 房主 = 警探视角
    await waitFor(host, () => {
      const app = document.getElementById('app');
      return app && app.style.display === 'block' && !!document.querySelector('.role-mar');
    }, 20000, '房主进入警探对局');
    const marTag = await host.textContent('.role-mar');
    assert(marTag.indexOf('警探') >= 0 && marTag.indexOf(' (你)') >= 0, '房主警探标签异常: ' + marTag);
    const fugTag = await host.textContent('.role-fug');
    assert(fugTag.indexOf('大盗') >= 0 && fugTag.indexOf('大盗小王') >= 0, '房主看到对手标签异常: ' + fugTag);
    await waitFor(host, () => /等待/.test(document.querySelector('#app .hint, .hint') ? (document.querySelector('.hint')||{}).textContent || '' : ''), 15000, '房主等待提示');
    // 成员 = 大盗视角（等待房主推送）
    await waitFor(guest, () => {
      const app = document.getElementById('app');
      return app && app.style.display === 'block' && !!document.querySelector('#hand .h-card');
    }, 30000, '成员进入大盗对局');
    const fugTagG = await guest.textContent('.role-fug');
    assert(fugTagG.indexOf(' (你)') >= 0, '成员大盗标签异常: ' + fugTagG);
    const myHandLen = await guest.$$eval('#hand .h-card', els => els.length);
    assert(myHandLen === 9, '大盗手牌应 9 张, 实际 ' + myHandLen);
    console.log('   房主=警探(等待), 成员=大盗(9 张手牌)');
    await shot(host, '3-host-marshal-wait');
    await shot(guest, '3-guest-fug-turn1');

    /* ============ 4. 大盗（成员）首回合：放置 1 张 → 结束回合 ============ */
    console.log('4. 成员大盗首回合放 1 张');
    const route0 = [];
    const h1 = await guest.$$eval('#hand .h-card', els => els.map(e => parseInt(e.textContent, 10)));
    const main = h1.find(n => n >= 1 && n <= 3);
    assert(main !== undefined, '首回合应可放 1/2/3: 手牌 ' + h1);
    await selectAndPlace(guest, main);
    route0.push(main);
    await waitFor(guest, () => document.querySelectorAll('#track .t-card').length === 2, 10000, '首张路线卡上桌');
    await shot(guest, '4-guest-placed-1');
    // 首回合可再放或结束：直接结束
    await clickBtn(guest, '结束回合');
    // 房主应收到：turn=marshal & needDraw
    await waitFor(host, () => state && state.turn === 'marshal' && state.needDraw, 20000, '房主收到警探回合(needDraw)');
    console.log('   首张放置 ' + main + ' → 结束首回合, 房主已同步');

    /* ============ 5. 警探（房主）抽 2 张 → 猜一个必 miss 数字 ============ */
    console.log('5. 房主警探摸 2 张并猜测');
    await waitFor(host, () => !!document.querySelector('.pile-pick'), 10000, '房主摸牌按钮出现');
    await clickBtn(host, 'A 堆'); // 第一张：首回合需抽满 2 张，抽完仍提示再抽
    await waitFor(host, () => (state.mar.drawCount || 0) === 1 && state.needDraw, 15000, '警探抽第 1 张');
    await clickBtn(host, 'B 堆'); // 第二张
    await waitFor(host, () => (state.mar.drawCount || 0) === 2 && !state.needDraw, 15000, '房主抽满 2 张');
    const missN = await pickSafeMiss(host);
    await clickGuess(host);
    // 猜测宣言应在结算前即时上报：成员（大盗）同步播放警探猜测气泡
    await waitFor(guest, (expectN) => {
      const b = document.querySelector('#bubble-layer .bubble-mar');
      return b && b.textContent.indexOf('我猜地点有 ' + expectN) >= 0;
    }, 8000, '成员侧未即时播放警探猜测气泡', missN);
    await shot(guest, '5-guest-mar-guess-bubble');
    // 气泡出现时（宣言已报、结算未至）：回合应尚未交还大盗
    const preTurn = await guest.evaluate(() => state ? state.turn : null);
    assert(preTurn === 'marshal', '气泡期间不应已结算: turn=' + preTurn);
    // 大盗回应气泡（未命中 → 你猜错了）
    await waitFor(guest, () => {
      const b = document.querySelector('#bubble-layer .bubble-fug');
      return b && b.textContent.indexOf('你猜错了') >= 0;
    }, 8000, '成员侧未播放大盗回应气泡');
    console.log('   警探猜 ' + missN + ' 宣言即时报 → 成员侧同步气泡');
    // 猜测动画约 2.4s，随后回合交还大盗
    await waitFor(host, () => state && state.turn === 'fugitive', 25000, '房主猜测后回合交还大盗');
    await waitFor(guest, () => state && state.turn === 'fugitive', 25000, '成员收到自己的回合');
    console.log('   警探猜 ' + missN + '（未命中）→ 回合交还');
    await shot(host, '5-host-after-guess');
    await shot(guest, '5-guest-turn2');

    /* ============ 6. 大盗（成员）摸牌 + 放置（自动结束回合） ============ */
    console.log('6. 成员大盗摸牌并放置');
    await clickBtn(guest, 'A 堆');
    await waitFor(guest, () => !state.needDraw, 10000, '大盗摸牌完成');
    const last = await guest.evaluate(() => state.fug.route[state.fug.route.length-1].num);
    const hand2 = await guest.$$eval('#hand .h-card', els => els.map(e => parseInt(e.textContent, 10)));
    const main2 = hand2.filter(n => n > last && n <= last + 3).sort((a,b) => a - b)[0];
    assert(main2 !== undefined, '无可合法放置的主牌 last=' + last + ' hand=' + hand2);
    await selectAndPlace(guest, main2);
    await waitFor(guest, () => state && state.turn === 'marshal' && state.needDraw, 15000, '大盗放置后回合移交警探');
    await waitFor(host, () => state && state.fug.route.length === 2, 20000, '房主看到 2 张路线牌');
    const route2 = await host.evaluate(() => state.fug.route.map(r => r.num));
    assert(route2[0] === route0[0], '房主路线首张应与成员一致');
    console.log('   放置 ' + main2 + '，双方路线同步: ' + route2.join(' > '));
    await shot(host, '6-host-route2');
    await shot(guest, '6-guest-route2');

    /* ============ 7. 警探（房主）摸 1 张 + 再猜 miss → 回合回大盗 ============ */
    console.log('7. 房主警探再摸 1 张并猜测');
    await clickBtn(host, 'B 堆');
    await waitFor(host, () => !state.needDraw, 10000, '警探摸牌完成');
    const missN2 = await pickSafeMiss(host);
    await clickGuess(host);
    await waitFor(host, () => state && state.turn === 'fugitive', 25000, '回合回到大盗');
    await waitFor(guest, () => state && state.turn === 'fugitive' && state.needDraw, 25000, '成员收到摸牌回合');
    console.log('   警探再猜 ' + missN2 + '，回合回大盗（needDraw）');
    await shot(host, '7-host-wait');
    await shot(guest, '7-guest-turn3');

    /* ============ 7b. 猜中：双端均应播放翻牌动画 ============ */
    console.log('7b. 警探猜中 → 双端翻牌动画');
    await clickBtn(guest, 'A 堆'); // 大盗摸 1 张后直接跳过，交还警探
    await waitFor(guest, () => !state.needDraw, 10000, '大盗摸牌完成');
    await clickBtn(guest, '跳过');
    await waitFor(host, () => state && state.turn === 'marshal' && state.needDraw, 20000, '跳过后警探摸牌回合');
    await clickBtn(host, 'A 堆');
    await waitFor(host, () => state && !state.needDraw, 10000, '警探摸牌完成');
    const hitN = await pickSafeHit(host);
    assert(hitN >= 1 && hitN <= 3, '命中目标异常: ' + hitN);
    await watchFlips(host);
    await watchFlips(guest);
    await host.click('.g-cell[data-n="' + hitN + '"]');
    await clickGuess(host);
    // 警探端：本地结算自带 flip-out + flip-in 翻牌动画
    await waitFor(host, () => window.__flipLog && window.__flipLog.out && window.__flipLog.in, 15000, '房主侧未播放翻牌动画');
    // 成员端：宣言气泡后补播翻牌（flip-out + flip-in），结算到达后牌翻明
    await waitFor(guest, () => state && state.fug.route[0].hidden === false, 20000, '成员侧地点牌未翻明');
    await waitFor(guest, () => window.__flipLog && window.__flipLog.out && window.__flipLog.in, 15000, '成员侧未补播翻牌动画');
    await waitFor(host, () => state.log.slice(-3).map(l=>l.msg).join('').indexOf('猜中') >= 0, 20000, '房主侧猜中日志缺失');
    await waitFor(guest, () => state.log.slice(-3).map(l=>l.msg).join('').indexOf('猜中') >= 0, 20000, '成员侧猜中日志缺失');
    await waitFor(guest, () => state && state.turn === 'fugitive' && state.needDraw, 25000, '猜中后回合交还大盗');
    console.log('   警探猜中 ' + hitN + '：双端均播放翻牌动画');
    await shot(host, '7b-host-flip');
    await shot(guest, '7b-guest-flip');

    /* ============ 8. 退出流程：成员退出 → 房主弹窗 → 解散 ============ */
    console.log('8. 成员退出 → 房主解散');
    await guest.click('.tb-btns .icon-btn >> nth=0'); // 🚪 退出
    await guest.waitForSelector('#ol-modal-quit.show', { timeout: 10000 });
    await shot(guest, '8-guest-quit-modal');
    // 点击遮罩层应关闭抽屉弹窗
    await guest.evaluate(() => {
      const ov = document.getElementById('ol-modal-quit');
      ov.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await guest.waitForFunction(() => !document.getElementById('ol-modal-quit').classList.contains('show'), { timeout: 5000 });
    await guest.click('.tb-btns .icon-btn >> nth=0'); // 重新打开退出弹窗
    await guest.waitForSelector('#ol-modal-quit.show', { timeout: 5000 });
    await guest.click('#ol-modal-quit .ol-modal-btn >> nth=1'); // 取消 → 关闭弹窗且留在房间
    await guest.waitForFunction(() => !document.getElementById('ol-modal-quit').classList.contains('show'), { timeout: 5000 });
    assert(await guest.isVisible('#app'), '取消退出后应仍在对局中');
    await shot(guest, '8-guest-quit-cancelled');
    await guest.click('.tb-btns .icon-btn >> nth=0'); // 再次打开 → 确认退出
    await guest.waitForSelector('#ol-modal-quit.show', { timeout: 5000 });
    await guest.click('#ol-modal-quit .ol-modal-btn >> nth=0'); // 确认退出
    await guest.waitForSelector('#ol-enter-online', { timeout: 15000 }); // 回到首页
    assert(await guest.isVisible('.ol-landing-title'), '成员退出后应回首页');
    await shot(guest, '8-guest-back-landing');
    // 房主弹「成员已离开」
    await waitFor(host, () => !!document.getElementById('ol-modal-member-gone') &&
      document.getElementById('ol-modal-member-gone').classList.contains('show'), 25000, '房主收到成员离开弹窗');
    const goneTxt = await host.textContent('#ol-modal-member-gone');
    assert(goneTxt.indexOf('大盗小王') >= 0, '离开弹窗未含成员名');
    await shot(host, '8-host-member-gone');
    await host.click('#ol-modal-member-gone .ol-modal-btn >> nth=0'); // 解散房间
    await host.waitForSelector('#ol-enter-online', { timeout: 15000 });
    assert(await host.isVisible('.ol-landing-title'), '房主解散后应回首页');
    console.log('   成员退出 → 房主确认解散 → 双方回首页');

    /* ============ JS 错误检查 ============ */
    const realErrA = errA.filter(e => e.indexOf('net') < 0 && e.indexOf('supabase') < 0 && e.indexOf('406') < 0);
    const realErrB = errB.filter(e => e.indexOf('net') < 0 && e.indexOf('supabase') < 0 && e.indexOf('406') < 0);
    assert(realErrA.length === 0, '房主 JS 错误: ' + realErrA.join(' || '));
    assert(realErrB.length === 0, '成员 JS 错误: ' + realErrB.join(' || '));

    console.log('\n✅ 联机冒烟测试全部通过（' + Math.round((Date.now()-t0)/1000) + 's）');
  } catch(e){
    failures++;
    console.log('\n❌ 测试失败: ' + e.message);
    try {
      const hst = await stateOf(host), gst = await stateOf(guest);
      console.log('-- host: turn=' + hst.turn + ' needDraw=' + hst.needDraw + ' route=' + JSON.stringify(hst.fug.route.map(r=>r.num+(r.hidden?'?':''))) + ' logs=' + JSON.stringify(hst.log.slice(-4).map(l=>l.msg)));
      console.log('-- guest: turn=' + gst.turn + ' needDraw=' + gst.needDraw + ' route=' + JSON.stringify(gst.fug.route.map(r=>r.num+(r.hidden?'?':''))) + ' logs=' + JSON.stringify(gst.log.slice(-4).map(l=>l.msg)));
    } catch(e2){ console.log('-- state dump fail:', e2.message); }
    console.log('-- host errs:', errA.join(' | '));
    console.log('-- guest errs:', errB.join(' | '));
    try {
      const hui = await host.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => /^猜/.test((b.textContent||'').trim()));
        return JSON.stringify({ gridSel: ui.gridSel, lock: ui.lock, gridMode, btnText: btn ? btn.textContent.trim() : null, btnDisabled: btn ? btn.disabled : null });
      });
      console.log('-- host ui:', hui);
    } catch(e3){ console.log('-- ui dump fail:', e3.message); }
    try {
      const gui = await guest.evaluate(() => {
        const btns = [...document.querySelectorAll('#actions button')].map(b => b.textContent.trim() + (b.disabled ? '(dis)' : ''));
        const selMain = document.querySelectorAll('#hand .h-card.sel-main').length;
        return JSON.stringify({ phase: state.phase, needDraw: state.needDraw, turn: state.turn, lock: ui ? ui.lock : null, selMain, actions: btns, hand: state.fug.hand.slice(0, 9).join(',') });
      });
      console.log('-- guest ui:', gui);
    } catch(e3){ console.log('-- guest ui dump fail:', e3.message); }
    await shot(host, 'FAIL-host').catch(()=>{});
    await shot(guest, 'FAIL-guest').catch(()=>{});
  } finally {
    await browser.close();
  }
  process.exit(failures ? 1 : 0);
})();
