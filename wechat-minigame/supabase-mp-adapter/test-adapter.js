/**
 * test-adapter.js — 适配层单元验证（Node 运行，mock wx API）
 * 运行：node wechat-minigame/supabase-mp-adapter/test-adapter.js
 */
const assert = require('assert');
const { createFetch, createWebSocketClass, setupMiniProgramGlobals } = require('./transport');

let passed = 0;
function ok(name) { passed++; console.log('  ✓', name); }

/* ---------- 1. fetch 适配：字符串响应 ---------- */
async function testFetchString() {
  const calls = [];
  const mockWx = {
    request(opts) {
      calls.push(opts);
      opts.success({
        statusCode: 200,
        data: '{"id":"game-1234","status":"waiting"}',
        header: { 'Content-Type': 'application/json' },
      });
    },
  };
  const fetch = createFetch(mockWx);
  const res = await fetch('https://api.test/rest/v1/rooms?id=eq.game-1234', {
    method: 'GET',
    headers: { apikey: 'K', Accept: 'application/vnd.pgrst.object+json' },
  });
  assert.strictEqual(calls[0].url, 'https://api.test/rest/v1/rooms?id=eq.game-1234');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'application/json');
  const body = await res.json();
  assert.strictEqual(body.id, 'game-1234');
  ok('fetch: GET + string 响应 + 头转换');
}

/* ---------- 2. fetch 适配：wx 已解析 JSON 的兜底 ---------- */
async function testFetchParsedJson() {
  const mockWx = {
    request(opts) {
      opts.success({ statusCode: 201, data: { id: 'game-5678' }, header: {} });
    },
  };
  const fetch = createFetch(mockWx);
  const res = await fetch('https://api.test/rest/v1/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'game-5678' }),
  });
  const text = await res.text();
  assert.strictEqual(JSON.parse(text).id, 'game-5678');
  ok('fetch: POST + wx 已解析 JSON 的兜底');
}

/* ---------- 3. fetch 适配：错误码 + fail ---------- */
async function testFetchErrors() {
  const mockWx = {
    request(opts) {
      if (opts.url.includes('err-404')) {
        opts.success({ statusCode: 404, data: '{"message":"not found"}', header: {} });
      } else {
        opts.fail({ errMsg: 'request:fail timeout' });
      }
    },
  };
  const fetch = createFetch(mockWx);
  const r404 = await fetch('https://api.test/err-404');
  assert.strictEqual(r404.ok, false);
  assert.strictEqual(r404.status, 404);
  ok('fetch: 非 2xx 映射 ok=false');

  let rejected = false;
  try { await fetch('https://api.test/boom'); } catch (e) { rejected = e.message.includes('timeout'); }
  assert.strictEqual(rejected, true);
  ok('fetch: 网络失败 reject');
}

/* ---------- 4. Headers 实例（forEach）兼容 ---------- */
async function testFetchHeadersInstance() {
  let captured;
  const mockWx = { request(opts) { captured = opts; opts.success({ statusCode: 204, data: '', header: {} }); } };
  const fetch = createFetch(mockWx);
  const h = new Map([['apikey', 'K1'], ['Authorization', 'Bearer T']]);
  h.forEach = Map.prototype.forEach.bind(h);
  h.get = Map.prototype.get.bind(h);
  await fetch('https://api.test', { headers: h });
  assert.strictEqual(captured.header['apikey'], 'K1');
  assert.strictEqual(captured.header['Authorization'], 'Bearer T');
  ok('fetch: Headers(Map 风格) → 普通对象');
}

/* ---------- 5. WebSocket 适配：事件与 readyState ---------- */
async function testWebSocket() {
  const handlers = {};
  const sent = [];
  const mockTask = {
    onOpen(cb) { handlers.open = cb; },
    onMessage(cb) { handlers.message = cb; },
    onClose(cb) { handlers.close = cb; },
    onError(cb) { handlers.error = cb; },
    send(p) { sent.push(p.data); },
    close(p) { handlers.close({ code: p.code, reason: p.reason }); },
  };
  const mockWx = { connectSocket(opts) { assert.ok(opts.url.startsWith('wss://api.test/realtime/v1/websocket')); return mockTask; } };

  const WS = createWebSocketClass(mockWx);
  const ws = new WS('wss://api.test/realtime/v1/websocket?apikey=K&vsn=1.0.0', ['realtime']);
  assert.strictEqual(ws.readyState, WS.CONNECTING);

  const events = [];
  ws.onopen = () => events.push('open');
  ws.onmessage = (m) => events.push('msg:' + m.data);
  ws.onclose = (c) => events.push('close:' + c.code);

  handlers.open();
  assert.strictEqual(ws.readyState, WS.OPEN);
  assert.strictEqual(events[0], 'open');

  // 字符串帧
  handlers.message({ data: '{"event":"phx_reply"}' });
  assert.strictEqual(events[1], 'msg:{"event":"phx_reply"}');

  // ArrayBuffer 帧（Phoenix heartbeat 可能是二进制）→ 应转成 UTF-8 字符串
  const bytes = new TextEncoder().encode('{"event":"heartbeat"}');
  handlers.message({ data: bytes.buffer });
  assert.strictEqual(events[2], 'msg:{"event":"heartbeat"}');

  ws.send('hello');
  assert.strictEqual(sent[0], 'hello');

  ws.close(1000, 'bye');
  assert.strictEqual(ws.readyState, WS.CLOSED);
  assert.ok(events.some((e) => e === 'close:1000'));
  ok('WebSocket: open/message(字符串+ArrayBuffer)/send/close/readyState');
}

/* ---------- 6. setupMiniProgramGlobals 幂等 + 垫全局 ---------- */
async function testSetupGlobals() {
  const mockWx = { request() {}, connectSocket() { return null; } };
  delete globalThis.fetch;
  delete globalThis.WebSocket;
  delete globalThis.location;
  delete globalThis.navigator;
  delete globalThis.document;
  delete globalThis.sessionStorage;

  setupMiniProgramGlobals({ supabaseUrl: 'https://api.your-domain.com', wx: mockWx });
  assert.strictEqual(typeof globalThis.fetch, 'function');
  assert.strictEqual(typeof globalThis.WebSocket, 'function');
  assert.strictEqual(globalThis.location.protocol, 'https:');
  assert.strictEqual(globalThis.navigator.userAgent, 'wechat-miniprogram');
  assert.strictEqual(typeof globalThis.sessionStorage.getItem, 'function');
  ok('setupMiniProgramGlobals: 垫 fetch/WebSocket/location/navigator/document/sessionStorage');

  // 幂等：二次调用不应覆盖
  const f1 = globalThis.fetch;
  setupMiniProgramGlobals({ supabaseUrl: 'https://other.com', wx: mockWx });
  assert.strictEqual(globalThis.fetch, f1);
  ok('setupMiniProgramGlobals: 幂等');
}

(async () => {
  console.log('适配层验证开始…\n');
  await testFetchString();
  await testFetchParsedJson();
  await testFetchErrors();
  await testFetchHeadersInstance();
  await testWebSocket();
  await testSetupGlobals();
  console.log(`\n全部通过：${passed} 项`);
})().catch((e) => { console.error('✗ 失败:', e); process.exit(1); });
