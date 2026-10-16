/**
 * test-integration.js — 集成验证：官方 supabase-js 2.112.4 + 适配层 + 真实远端
 *
 * 验证目标（按重要性）：
 *   1. createClient 在小程序风格环境（无 fetch/WebSocket/location）里能创建
 *   2. .from().select() 走通我们的 wx.request 适配层，拿到真实响应
 *   3. .insert() + .select() 写读链路
 *   4. Realtime channel 用我们的 WebSocket 垫片建立连接并收到 SUBSCRIBED 状态
 *   5. 清理测试数据
 *
 * 运行：node test-integration.js
 */
const assert = require('assert');
const { setupMiniProgramGlobals, createWebSocketClass, createFetch } = require('./transport');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://smcplxyjjvehbizirvrw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtY3BseHlqanZlaGJpemlydnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNTQyMDgsImV4cCI6MjA5ODYzMDIwOH0.TNkL6gOBMyZIt8mB-b-JBPe7_LgJIHXXtHwOW_Xr0qM';

const TEST_ROOM_ID = 'game-9999'; // 固定测试房号，跑完即删

/* ---------- 1. 模拟小程序环境：wx.request → Node fetch，wx.connectSocket → Node WebSocket ---------- */

function nodeFetch(input, init) {
  return globalThis.__nodeFetch(input, init);
}

const mockWx = {
  request(opts) {
    nodeFetch(opts.url, { method: opts.method, headers: opts.header, body: opts.data })
      .then(async (res) => {
        const text = await res.text();
        opts.success({ statusCode: res.status, data: text, header: Object.fromEntries(res.headers.entries()) });
      })
      .catch((err) => opts.fail({ errMsg: String(err && err.message || err) }));
  },
  connectSocket(opts) {
    const ws = new globalThis.__NodeWebSocket(opts.url);
    const listeners = { open: [], message: [], close: [], error: [] };
    ws.addEventListener('open', (e) => listeners.open.forEach((cb) => cb(e)));
    ws.addEventListener('message', (e) => listeners.message.forEach((cb) => cb({ data: e.data })));
    ws.addEventListener('close', (e) => listeners.close.forEach((cb) => cb({ code: e.code, reason: e.reason })));
    ws.addEventListener('error', (e) => listeners.error.forEach((cb) => cb(e)));
    return {
      onOpen(cb) { listeners.open.push(cb); },
      onMessage(cb) { listeners.message.push(cb); },
      onClose(cb) { listeners.close.push(cb); },
      onError(cb) { listeners.error.push(cb); },
      send(p) { ws.send(p.data); },
      close(p) { ws.close(p.code, p.reason); },
    };
  },
};

async function main() {
  globalThis.__nodeFetch = globalThis.fetch;
  globalThis.__NodeWebSocket = globalThis.WebSocket;
  if (!globalThis.__nodeFetch || !globalThis.__NodeWebSocket) {
    console.error('需要 Node 22+（内置 fetch/WebSocket）'); process.exit(1);
  }

  // 抹掉浏览器全局，模拟小程序纯净环境
  delete globalThis.fetch;
  delete globalThis.WebSocket;
  delete globalThis.location;
  delete globalThis.navigator;
  delete globalThis.document;
  delete globalThis.sessionStorage;

  console.log('== 1. setupMiniProgramGlobals 垫全局 ==');
  setupMiniProgramGlobals({ supabaseUrl: SUPABASE_URL, wx: mockWx });
  assert.strictEqual(typeof globalThis.fetch, 'function');
  assert.strictEqual(typeof globalThis.WebSocket, 'function');
  console.log('  ✓ 环境垫片就绪（fetch/WebSocket/location 全部来自适配层）');

  console.log('== 2. createClient（官方 SDK，自动使用垫片） ==');
  const client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  console.log('  ✓ createClient 未抛异常');

  console.log('== 3. REST 读：清理残留 + 查询 rooms 表 ==');
  await client.from('rooms').delete().eq('id', TEST_ROOM_ID);
  const { data: beforeData, error: beforeErr } = await client.from('rooms').select('id').limit(3);
  assert.ifError(beforeErr);
  console.log(`  ✓ select 成功，rooms 现有样本 ${beforeData.length} 行`);

  console.log('== 4. REST 写：insert 测试房间 ==');
  const { error: insErr } = await client.from('rooms').insert({
    id: TEST_ROOM_ID,
    host_name: '_adapter_test_',
    status: 'waiting',
    seats: [{ name: '_adapter_test_', seatIndex: 0 }],
  });
  assert.ifError(insErr);
  const { data: room, error: getErr } = await client.from('rooms').select('*').eq('id', TEST_ROOM_ID).single();
  assert.ifError(getErr);
  assert.strictEqual(room.host_name, '_adapter_test_');
  console.log('  ✓ insert + select 写读闭环（真实网络，走适配层）');

  console.log('== 5. Realtime：WebSocket 垫片订阅房间变更 ==');
  // 确定性设计：只订阅 UPDATE 事件；先在步骤 4 写入的 room 上等待 SUBSCRIBED，
  // 订阅就绪后再触发一次 UPDATE 验证推送。避免"订阅成功前后的先导事件提前 resolve"。
  const realtimeResult = await new Promise((resolve) => {
    let subscribed = false;
    const timer = setTimeout(() => resolve({ ok: false, reason: '10s 超时' }), 10000);
    let channel;
    channel = client
      .channel('room-' + TEST_ROOM_ID)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: 'id=eq.' + TEST_ROOM_ID },
        (payload) => {
          clearTimeout(timer);
          resolve({ ok: true, payload, channel });
        })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          // 订阅就绪后再触发更新，确保此前的任何历史事件不会干扰
          setTimeout(() => {
            client.from('rooms').update({ status: 'playing' }).eq('id', TEST_ROOM_ID).then(() => {});
          }, 300);
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          resolve({ ok: false, reason: status + (subscribed ? ' (after subscribe)' : ''), channel });
        }
      });
  });

  if (realtimeResult.ok) {
    const p = realtimeResult.payload || {};
    const evt = p.event || (p.data && p.data.type) || 'UPDATE';
    console.log(`  ✓ Realtime 连接 + 变更推送成功（收到事件: ${evt}，status→${p.new ? p.new.status : 'playing'}）`);
  } else {
    console.log(`  ✗ Realtime 未成功：${realtimeResult.reason}`);
  }
  // 释放 socket，否则进程不退出
  try { client.removeAllChannels(); } catch (e) { /* noop */ }

  console.log('== 6. 清理测试数据 ==');
  await client.from('rooms').delete().eq('id', TEST_ROOM_ID);
  console.log('  ✓ 测试房间已删除');

  // 汇总
  if (realtimeResult.ok) {
    console.log('\n集成验证全部通过：REST 读/写/Realtime 三链路在"小程序环境"下均可用');
  } else {
    console.log('\nREST 通过；Realtime 异常，需要检查（见上方原因）');
    process.exitCode = 2;
  }
  process.exit(realtimeResult.ok ? 0 : 2);
}

main().catch((e) => { console.error('集成验证失败:', e); process.exit(1); });
