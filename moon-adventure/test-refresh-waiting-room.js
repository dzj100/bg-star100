/**
 * 等候室刷新恢复测试：
 * 1. 房主开房，成员加入（等候室阶段）
 * 2. 成员刷新页面 → 应自动回到等候室（不重新加入）
 * 3. 房主侧 seats 数量不变（无重复成员）
 * 4. 房主开始游戏后成员能正常进入对局
 */
const { chromium } = require('playwright');

const URL = 'http://localhost:8123/index_ol.html';

(async () => {
  const browser = await chromium.launch({ headless: true });
  // 独立 context：模拟两台设备，localStorage 互不共享
  const host = await browser.newContext().then(c => c.newPage());
  const member = await browser.newContext().then(c => c.newPage());

  const errors = [];
  for (const [tag, page] of [['host', host], ['member', member]]) {
    page.on('pageerror', e => errors.push(`[${tag}] pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${tag}] console.error: ${m.text()}`); });
    page.on('dialog', d => { console.log(`[${tag}] dialog:`, d.message()); d.accept(tag === 'host' ? 'HostPlayer' : 'Member'); });
  }

  const step = msg => console.log('STEP:', msg);

  // ---- 房主创建房间 ----
  step('host creates room');
  await host.goto(URL);
  await host.waitForFunction(() => document.querySelector('button[onclick="showOnlineLobby()"]') !== null);
  await host.click('button[onclick="showOnlineLobby()"]');
  await host.waitForFunction(() => document.querySelector('#online button[onclick*="onCreateRoom"]') !== null);
  await host.click('#online button[onclick*="onCreateRoom"]');
  await host.waitForFunction(() => document.getElementById('online').innerHTML.includes('开始游戏'));
  const roomCode = await host.evaluate(() => document.getElementById('online').innerHTML.match(/\d{4}/)[0]);
  console.log('room:', roomCode);

  // ---- 成员加入 ----
  step('member joins room');
  await member.goto(URL);
  await member.waitForFunction(() => document.querySelector('button[onclick="showOnlineLobby()"]') !== null);
  await member.click('button[onclick="showOnlineLobby()"]');
  await member.waitForFunction(() => document.querySelector('#joinRoomInput') !== null);
  await member.fill('#joinRoomInput', roomCode);
  await member.fill('#joinNameInput', 'Member');
  await member.click('button[onclick="onJoinRoom()"]');
  await member.waitForFunction(code => document.getElementById('online').innerHTML.includes(code), roomCode, { timeout: 20000 });
  step('member in waiting room');

  const seatsBefore = await host.evaluate(() => netGetRoom ? null : null).catch(() => null);
  const hostSeatsBefore = await host.evaluate(async () => {
    const r = await netGetRoom(_onlineRoomId);
    return r.seats.map(s => s.name + '@' + s.seatIndex);
  });
  console.log('host seats before refresh:', JSON.stringify(hostSeatsBefore));

  // ---- 成员刷新页面 ----
  step('member refreshes page');
  await member.reload();
  await member.waitForFunction(code => document.getElementById('online').innerHTML.includes(code), roomCode, { timeout: 20000 });
  const memberState = await member.evaluate(() => ({
    onlineDisplay: document.getElementById('online').style.display,
    appDisplay: document.getElementById('app').style.display,
    hasRoom: document.getElementById('online').innerHTML.includes('等待房主开始游戏'),
    seat: _mySeatIndex,
    roomId: _onlineRoomId,
  }));
  console.log('member after refresh:', JSON.stringify(memberState));
  if (memberState.seat !== 1 || memberState.roomId !== roomCode) throw new Error('member session not restored');

  // ---- 房主侧 seats 应无重复 ----
  await member.waitForTimeout(3000);
  const hostSeatsAfter = await host.evaluate(async () => {
    const r = await netGetRoom(_onlineRoomId);
    return r.seats.map(s => s.name + '@' + s.seatIndex);
  });
  console.log('host seats after refresh:', JSON.stringify(hostSeatsAfter));
  if (JSON.stringify(hostSeatsAfter) !== JSON.stringify(hostSeatsBefore)) {
    throw new Error('seats changed after refresh (duplicate member?): ' + JSON.stringify(hostSeatsAfter));
  }

  // ---- 房主开始游戏，成员应自动进入 ----
  step('host starts game');
  await host.click('button[onclick="startOnlineGame()"]');
  await host.waitForFunction(() => S && S.phase === 'playing' && document.getElementById('app').style.display === 'block');
  await member.waitForFunction(() => S && S.phase === 'playing' && document.getElementById('app').style.display === 'block', { timeout: 20000 });
  const memberSeat = await member.evaluate(() => _mySeatIndex);
  const playerCount = await member.evaluate(() => S.playerCount);
  console.log('member in game, seat:', memberSeat, 'players:', playerCount);
  if (memberSeat !== 1 || playerCount !== 2) throw new Error('member not correctly in game after refresh');

  console.log('JS errors:', errors.length ? errors : 'none');
  await browser.close();
  console.log('ALL PASS');
})().catch(e => { console.error('TEST FAIL:', e); process.exit(1); });
