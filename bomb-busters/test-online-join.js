/**
 * 并发加入房间回归测试
 *
 * 默认（mock）：在 vm 中装载 net.js，验证加入/离开走原子 RPC、
 *              并发调用能拿到不同座位、错误提示正确。
 * 真实环境（需先在 Supabase SQL Editor 执行 room-rpc.sql）：
 *              node test-online-join.js --live
 *              直接并发调用 join_room / leave_room，验证服务端串行分配座位。
 *
 * 运行：node test-online-join.js [--live]
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const NET_SRC = fs.readFileSync(path.join(__dirname, 'net.js'), 'utf8');

let passN = 0, failN = 0;
const failures = [];

async function t(name, fn) {
  try {
    await fn();
    passN++;
    console.log('  ✅', name);
  } catch (e) {
    failN++;
    failures.push({ name, msg: e && e.message });
    console.log('  ❌', name);
    console.log('     ', e && e.message);
  }
}

function assert(c, msg) { if (!c) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg ? msg + '：' : '') + `期望 ${JSON.stringify(b)}，得到 ${JSON.stringify(a)}`);
}

async function assertRejects(fn, sub, msg) {
  try {
    await fn();
  } catch (e) {
    assert(String(e.message).includes(sub), (msg || '错误提示不符') + `：实际「${e.message}」`);
    return;
  }
  throw new Error((msg || '应抛出错误') + '：实际未抛错');
}

/** 装载 net.js：supabase 用可控假客户端，禁止再走表级读改写 */
function loadNet(rpcHandler) {
  const calls = [];
  const client = {
    rpc(name, params) {
      calls.push({ kind: 'rpc', name, params });
      return Promise.resolve().then(() => rpcHandler(name, params));
    },
    from(table) {
      calls.push({ kind: 'from', table });
      throw new Error('net.js 不应再直接读写 rooms 表（并发会互相覆盖）');
    },
  };
  const ctx = {
    supabase: { createClient: () => client },
    fetch: () => { throw new Error('unexpected fetch'); },
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(NET_SRC, ctx, { filename: 'net.js' });
  return { ctx, calls };
}

const run = (ctx, expr) => vm.runInContext(expr, ctx);

/* ══════════════════════════════ mock 用例 ══════════════════════════════ */

async function runMock() {
  console.log('== net.js 客户端契约 ==');

  await t('加入房间调用 join_room，并使用服务端返回的权威座位', async () => {
    const { ctx, calls } = loadNet(() => ({
      data: {
        seatIndex: 1,
        room: {
          id: 'bomb-1234', status: 'waiting',
          seats: [{ name: '房主', seatIndex: 0 }, { name: 'A', seatIndex: 1 }],
        },
      },
      error: null,
    }));
    const r = await run(ctx, 'netJoinRoom("1234", "A")');
    eq(calls.length, 1, '只应发起一次 RPC');
    eq(calls[0].kind, 'rpc');
    eq(calls[0].name, 'join_room');
    eq(calls[0].params.p_room_id, 'bomb-1234');
    eq(calls[0].params.p_name, 'A');
    eq(calls[0].params.p_max_players, 5);
    eq(r.seatIndex, 1);
    eq(r.room.seats.length, 2, '应直接返回服务端快照');
  });

  await t('并发加入：两个调用拿到不同座位，且都返回最新座位列表', async () => {
    let seats = [{ name: '房主', seatIndex: 0 }];
    let tail = Promise.resolve();
    const { ctx, calls } = loadNet((name, params) => {
      assert(name === 'join_room');
      const next = tail.then(() => {
        const seatIndex = Math.max(...seats.map(s => s.seatIndex), -1) + 1;
        seats.push({ name: params.p_name, seatIndex });
        return {
          data: {
            seatIndex,
            room: {
              id: params.p_room_id, status: 'waiting',
              seats: seats.map(s => ({ ...s })),
            },
          },
          error: null,
        };
      });
      tail = next.catch(() => {});
      return next;
    });
    const [a, b] = await Promise.all([
      run(ctx, 'netJoinRoom("1234", "A")'),
      run(ctx, 'netJoinRoom("1234", "B")'),
    ]);
    const idx = [a.seatIndex, b.seatIndex].sort((x, y) => x - y);
    eq(idx.join(','), '1,2', '并发加入不能拿到同一座位');
    eq(calls.length, 2);
    assert(calls.every(c => c.kind === 'rpc' && c.name === 'join_room'), '必须全部走 RPC');
    eq(seats.length, 3, '服务端最终应为房主 + 两名成员');
    eq(new Set(seats.map(s => s.seatIndex)).size, 3, '座位号必须互不重复');
    eq(a.room.seats.length, 2);
    eq(b.room.seats.length, 3, '后完成的一笔应看到全部三人');
  });

  await t('离开房间调用 leave_room', async () => {
    const { ctx, calls } = loadNet(() => ({ data: { removed: true, seats: [] }, error: null }));
    await run(ctx, 'netLeaveRoom("1234", 1)');
    eq(calls.length, 1);
    eq(calls[0].name, 'leave_room');
    eq(calls[0].params.p_room_id, 'bomb-1234');
    eq(calls[0].params.p_seat_index, 1);
    assert(calls.every(c => c.kind === 'rpc'), '离开也必须走 RPC');
  });

  await t('RPC 未部署时给出明确提示', async () => {
    const { ctx } = loadNet(() => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.join_room in the schema cache' },
    }));
    await assertRejects(
      () => run(ctx, 'netJoinRoom("1234", "A")'),
      '联机服务未初始化',
      '应提示先执行 room-rpc.sql'
    );
  });

  await t('服务端业务错误原样提示（房间已满）', async () => {
    const { ctx } = loadNet(() => ({ data: null, error: { message: '房间已满' } }));
    await assertRejects(() => run(ctx, 'netJoinRoom("1234", "A")'), '房间已满');
  });

  await t('服务端返回异常时拒绝渲染', async () => {
    const { ctx } = loadNet(() => ({ data: { seatIndex: 1 }, error: null }));
    await assertRejects(() => run(ctx, 'netJoinRoom("1234", "A")'), '服务端返回异常');
  });
}

/* ══════════════════════════════ live 用例 ══════════════════════════════ */

function readSupabaseConfig() {
  const url = NET_SRC.match(/SUPABASE_URL:\s*'([^']+)'/);
  const key = NET_SRC.match(/SUPABASE_ANON:\s*'([^']+)'/);
  if (!url || !key) throw new Error('net.js 中未找到 Supabase 配置');
  return { url: url[1], key: key[1] };
}

async function runLive() {
  const { url, key } = readSupabaseConfig();
  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
  };
  const rest = (p) => url + '/rest/v1/' + p;

  async function createRoom() {
    for (let i = 0; i < 5; i++) {
      const id = 'bomb-' + Math.floor(1000 + Math.random() * 9000);
      const res = await fetch(rest('rooms'), {
        method: 'POST',
        headers: Object.assign({ Prefer: 'return=representation' }, headers),
        body: JSON.stringify({
          id, host_name: '房主', status: 'waiting',
          seats: [{ name: '房主', seatIndex: 0 }, { name: 'X', seatIndex: 1 }],
        }),
      });
      if (res.ok) return id;
      if (res.status !== 409) throw new Error(`创建测试房间失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    throw new Error('创建测试房间失败：连续房间号冲突');
  }

  async function join(roomId, name, max = 5) {
    const res = await fetch(rest('rpc/join_room'), {
      method: 'POST', headers,
      body: JSON.stringify({ p_room_id: roomId, p_name: name, p_max_players: max }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  async function leave(roomId, seatIndex) {
    const res = await fetch(rest('rpc/leave_room'), {
      method: 'POST', headers,
      body: JSON.stringify({ p_room_id: roomId, p_seat_index: seatIndex }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  async function getRoom(roomId) {
    const res = await fetch(rest(`rooms?id=eq.${encodeURIComponent(roomId)}&select=*`), { headers });
    const rows = await res.json();
    return rows[0];
  }

  async function removeRoom(roomId) {
    await fetch(rest(`rooms?id=eq.${encodeURIComponent(roomId)}`), { method: 'DELETE', headers });
    const room = await getRoom(roomId);
    if (room) {
      await fetch(rest(`rooms?id=eq.${encodeURIComponent(roomId)}`), {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: 'finished', seats: [] }),
      });
    }
  }

  console.log('== Supabase 原子 RPC（真实并发） ==');
  const probe = await join('bomb-0000', 'probe');
  if (probe.status === 404 || /PGRST202|Could not find the function/i.test(JSON.stringify(probe.body))) {
    throw new Error('join_room 未部署：请先在 Supabase SQL Editor 执行 room-rpc.sql');
  }
  const roomId = await createRoom();
  try {
    // 已有 2 座（房主 + X），再并发加 4 人：房主+1 人应成功，其余 3 个满员失败
    const results = await Promise.all([
      join(roomId, 'A'), join(roomId, 'B'), join(roomId, 'C'), join(roomId, 'D'),
    ]);
    const ok = results.filter(r => r.status === 200);
    const full = results.filter(r => r.status !== 200);
    eq(ok.length, 3, '2 座 + 并发 4 人，应有 3 人成功');
    eq(full.length, 1, '应恰有 1 人收到房间已满');
    assert(full[0].body.message.includes('房间已满'), '失败原因应为房间已满');
    const seatIdx = ok.map(r => r.body.seatIndex).sort((a, b) => a - b);
    eq(seatIdx.join(','), '2,3,4', '并发成功的座位号必须互不重复且连续');
    const lengths = ok.map(r => r.body.room.seats.length).sort((a, b) => a - b);
    eq(lengths.join(','), '3,4,5', '每次成功都应返回递增的权威快照');

    const room = await getRoom(roomId);
    eq(room.seats.length, 5, '数据库最终应为 5 个座位');
    eq(new Set(room.seats.map(s => s.seatIndex)).size, 5, '数据库座位号不能重复');

    const seatOne = room.seats.find(s => s.name === 'X').seatIndex;
    const left = await leave(roomId, seatOne);
    eq(left.status, 200);
    eq(left.body.removed, true, '离开应移除座位');
    eq((await getRoom(roomId)).seats.length, 4, '离开后应剩 4 座');

    const rejoin = await join(roomId, 'E');
    eq(rejoin.status, 200, '有空位时应允许重新加入');
    eq(rejoin.body.seatIndex, 5, '座位号按 max(seatIndex)+1 分配');
  } finally {
    await removeRoom(roomId);
  }
}

/* ══════════════════════════════ 入口 ══════════════════════════════ */

(async () => {
  await runMock();
  if (process.argv.includes('--live')) {
    try {
      await runLive();
    } catch (e) {
      failN++;
      failures.push({ name: 'live', msg: e.message });
      console.log('  ❌ live 并发测试失败：', e.message);
      if (/PGRST202|Could not find the function|room-rpc\.sql/i.test(e.message)) {
        console.log('     请先在 Supabase SQL Editor 执行 room-rpc.sql');
      }
    }
  }
  console.log(`\n通过 ${passN}，失败 ${failN}`);
  if (failN) {
    for (const f of failures) console.log('  -', f.name, ':', f.msg);
    process.exitCode = 1;
  }
})();
