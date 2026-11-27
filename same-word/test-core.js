/* 同词相遇 · 纯逻辑单测（无第三方依赖）
 * 运行：node test-core.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, console: console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8'), sandbox, { filename: 'game.js' });
const SWG = sandbox.window.SWG;

/* ---------- 迷你测试框架 ---------- */

let passed = 0;
const failures = [];
let group = '';

function section(name) {
  group = name;
}

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`[${group}] ${name}\n    ${err && err.message ? err.message : err}`);
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

function show(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

function eq(actual, expected, msg) {
  if (!deepEqual(actual, expected)) {
    throw new Error(`${msg || 'eq'} → expected ${show(expected)}, got ${show(actual)}`);
  }
}

function ok(v, msg) {
  if (!v) throw new Error(`${msg || 'ok'} → expected truthy, got ${show(v)}`);
}

function notOk(v, msg) {
  if (v) throw new Error(`${msg || 'notOk'} → expected falsy, got ${show(v)}`);
}

/* ---------- 工具 ---------- */

const T0 = 1000000;

function mkDuel(opts) {
  return SWG.createState({
    mode: 'duel',
    settings: Object.assign({ timeLimit: 0, roundLimit: 10 }, opts && opts.settings),
    seatNames: (opts && opts.seatNames) || ['阿山', '小海'],
    now: T0,
  });
}

function mkParty(opts) {
  return SWG.createState({
    mode: 'party',
    settings: Object.assign({ timeLimit: 0, roundLimit: 10 }, opts && opts.settings),
    seatNames: (opts && opts.seatNames) || ['阿山', '小海', '橙子'],
    now: T0,
  });
}

/* ========== 1. 归一化 / 校验 ========== */

section('normalizeWord');

test('英文小写归一', () => eq(SWG.normalizeWord('HeLLo'), 'hello'));
test('全角转半角', () => eq(SWG.normalizeWord('ｈｅｌｌｏ'), 'hello'));
test('标点剔除', () => eq(SWG.normalizeWord('hello, world!'), 'helloworld'));
test('中文标点剔除', () => eq(SWG.normalizeWord('你好，世界。'), '你好世界'));
test('空白剔除', () => eq(SWG.normalizeWord(' 苹 果 '), '苹果'));
test('特殊符号剔除', () => eq(SWG.normalizeWord('a~b～c·d…e'), 'abcde'));
test('下划线视为标点', () => eq(SWG.normalizeWord('a_b-c'), 'abc'));
test('纯符号归一为空', () => eq(SWG.normalizeWord('～…·~!?，。'), ''));
test('null 安全', () => eq(SWG.normalizeWord(null), ''));
test('数字保留', () => eq(SWG.normalizeWord('２０２６年'), '2026年'));

section('charLen');

test('中文 2 码点', () => eq(SWG.charLen('西瓜'), 2));
test('emoji 1 码点', () => eq(SWG.charLen('😀'), 1));
test('空串 0', () => eq(SWG.charLen(''), 0));
test('null 0', () => eq(SWG.charLen(null), 0));

section('validateWord');

test('基础通过', () => eq(SWG.validateWord('西瓜'), { ok: true, word: '西瓜', display: '西瓜' }));
test('内部空白折叠 + 首尾去空白', () => {
  const r = SWG.validateWord('  西   瓜  ');
  eq(r.ok, true);
  eq(r.display, '西 瓜');
  eq(r.word, '西瓜');
});
test('英文展示保留原文', () => {
  const r = SWG.validateWord('Hello!');
  eq(r.word, 'hello');
  eq(r.display, 'Hello!');
});
test('全角同样通过', () => eq(SWG.validateWord('ｈｅｌｌｏ').word, 'hello'));
test('空串 EMPTY', () => eq(SWG.validateWord(''), { ok: false, error: 'EMPTY' }));
test('纯空白 EMPTY', () => eq(SWG.validateWord('   '), { ok: false, error: 'EMPTY' }));
test('null EMPTY', () => eq(SWG.validateWord(null), { ok: false, error: 'EMPTY' }));
test('纯符号 ONLY_SYMBOL', () => eq(SWG.validateWord('！？。'), { ok: false, error: 'ONLY_SYMBOL' }));
test('波浪线 ONLY_SYMBOL', () => eq(SWG.validateWord('~~~'), { ok: false, error: 'ONLY_SYMBOL' }));
test('emoji ONLY_SYMBOL', () => eq(SWG.validateWord('🙂'), { ok: false, error: 'ONLY_SYMBOL' }));
test('10 码点通过', () => eq(SWG.validateWord('一二三四五六七八九十').ok, true));
test('10 字母通过', () => eq(SWG.validateWord('abcdefghij').ok, true));
test('11 码点 TOO_LONG', () => eq(SWG.validateWord('一二三四五六七八九十一').error, 'TOO_LONG'));
test('11 字母 TOO_LONG', () => eq(SWG.validateWord('abcdefghijk').error, 'TOO_LONG'));
test('长度按归一化计', () => eq(SWG.validateWord('a-b-c-d-e-f').ok, true));
test('全角 11 字母 TOO_LONG', () => eq(SWG.validateWord('ａｂｃｄｅｆｇｈｉｊｋ').error, 'TOO_LONG'));
test('重复校验不拦重复词', () => {
  eq(SWG.validateWord('西瓜').ok, true);
  eq(SWG.validateWord('西瓜').ok, true);
});

section('validateName');

test('昵称通过', () => eq(SWG.validateName(' 阿山 '), { ok: true, name: '阿山' }));
test('昵称 12 通过', () => eq(SWG.validateName('一二三四五六七八九十一二').ok, true));
test('昵称 13 TOO_LONG', () => eq(SWG.validateName('一二三四五六七八九十一二三').error, 'TOO_LONG'));
test('昵称空 EMPTY', () => eq(SWG.validateName('  ').error, 'EMPTY'));

/* ========== 2. 生命周期 ========== */

section('createState / startRound / restartGame');

test('createState 初始字段', () => {
  const S = mkDuel();
  eq(S.schema, 1);
  eq(S.mode, 'duel');
  eq(S.phase, 'playing');
  eq(S.round, 1);
  eq(S.gameNo, 1);
  eq(S.rev, 1);
  eq(S.result, null);
  eq(S.resultBy, null);
  eq(S.history, []);
  eq(S.departed, []);
  eq(S.subs, {});
  eq(S.decisions, {});
  eq(S.claims, {});
  eq(S.ready, {});
  eq(S.rematch, {});
  eq(S.deadline, null);
  eq(S.hostNow, T0);
  eq(S.seatNames, ['阿山', '小海']);
  eq(S.settings, { timeLimit: 0, roundLimit: 10 });
});
test('createState 限时设 deadline', () => {
  const S = mkDuel({ settings: { timeLimit: 15 } });
  eq(S.deadline, T0 + 15000);
});
test('createState 非法限时归 0', () => {
  const S = mkDuel({ settings: { timeLimit: 7 } });
  eq(S.settings.timeLimit, 0);
  eq(S.deadline, null);
});
test('createState 局数夹取 5~50', () => {
  eq(mkParty({ settings: { roundLimit: 1 } }).settings.roundLimit, 5);
  eq(mkParty({ settings: { roundLimit: 4 } }).settings.roundLimit, 5);
  eq(mkParty({ settings: { roundLimit: 99 } }).settings.roundLimit, 50);
  eq(mkParty({ settings: { roundLimit: 20 } }).settings.roundLimit, 20);
});
test('minPlayers', () => {
  eq(SWG.minPlayers('duel'), 2);
  eq(SWG.minPlayers('party'), 3);
});
test('startRound 重置本轮字段', () => {
  const S = mkParty({ settings: { timeLimit: 15 } });
  S.phase = 'reveal';
  S.subs = { 0: { word: 'a', at: 1, done: true, round: 1 } };
  S.claims = { 0: { 1: { on: true, at: 1 } } };
  S.ready = { 0: { on: true, at: 1 } };
  S.decisions = { 0: { value: 'same', at: 1 } };
  SWG.startRound(S, T0 + 5000);
  eq(S.round, 2);
  eq(S.phase, 'playing');
  eq(S.subs, {});
  eq(S.claims, {});
  eq(S.ready, {});
  eq(S.decisions, {});
  eq(S.hostNow, T0 + 5000);
  eq(S.deadline, T0 + 5000 + 15000);
  eq(S.history, []);
});
test('restartGame 清空全部对局数据', () => {
  const S = mkParty();
  S.phase = 'finished';
  S.result = 'limit';
  S.resultBy = 0;
  S.round = 7;
  S.history = [{ round: 1, words: ['a', 'b', 'c'], pairs: [], all: false }];
  S.subs = { 0: { word: 'a', at: 1, done: true, round: 7 } };
  S.rematch = { 0: { on: true, at: 1 } };
  SWG.restartGame(S, T0 + 99000);
  eq(S.gameNo, 2);
  eq(S.round, 1);
  eq(S.phase, 'playing');
  eq(S.result, null);
  eq(S.resultBy, null);
  eq(S.history, []);
  eq(S.subs, {});
  eq(S.rematch, {});
  eq(S.hostNow, T0 + 99000);
});

/* ========== 3. 双人 ========== */

section('duel: 同词即结算');

test('大小写不同判同 → match 立即结束', () => {
  const S = mkDuel();
  eq(SWG.submit(S, 0, 'Hello', T0 + 1), { ok: true, word: 'Hello' });
  eq(SWG.submit(S, 1, 'hello', T0 + 2).ok, true);
  ok(SWG.allDone(S));
  ok(SWG.hostTick(S, T0 + 3));
  eq(S.phase, 'finished');
  eq(S.result, 'match');
  eq(S.resultBy, null);
  eq(S.history.length, 1);
  eq(S.history[0].words, ['Hello', 'hello']);
  eq(S.history[0].pairs, [{ a: 0, b: 1, kind: 'exact' }]);
  eq(S.history[0].all, false);
});
test('全角 + 标点不同判同 → match', () => {
  const S = mkDuel();
  SWG.submit(S, 0, 'ｈｅｌｌｏ！', T0 + 1);
  SWG.submit(S, 1, 'HeLLo,', T0 + 2);
  SWG.hostTick(S, T0 + 3);
  eq(S.result, 'match');
});
test('中文带空格判同', () => {
  const S = mkDuel();
  SWG.submit(S, 0, '苹 果', T0 + 1);
  SWG.submit(S, 1, '苹果', T0 + 2);
  SWG.hostTick(S, T0 + 3);
  eq(S.result, 'match');
});
test('不同词 → reveal', () => {
  const S = mkDuel();
  SWG.submit(S, 0, '苹果', T0 + 1);
  SWG.submit(S, 1, '香蕉', T0 + 2);
  SWG.hostTick(S, T0 + 3);
  eq(S.phase, 'reveal');
  eq(S.result, null);
  eq(S.deadline, null);
  eq(S.history[0].pairs, []);
});

section('duel: 表态');

test('单方 same 不结算', () => {
  const S = mkDuel();
  SWG.submit(S, 0, '苹果', T0 + 1);
  SWG.submit(S, 1, '香蕉', T0 + 2);
  SWG.hostTick(S, T0 + 3);
  eq(SWG.duelDecide(S, 0, 'same', T0 + 4), { resolved: null });
  notOk(SWG.hostTick(S, T0 + 5));
  eq(S.phase, 'reveal');
  eq(S.decisions[0].value, 'same');
});
test('双方 same → agree 结算 + agree 对', () => {
  const S = mkDuel();
  SWG.submit(S, 0, '苹果', T0 + 1);
  SWG.submit(S, 1, '香蕉', T0 + 2);
  SWG.hostTick(S, T0 + 3);
  SWG.duelDecide(S, 0, 'same', T0 + 4);
  eq(SWG.duelDecide(S, 1, 'same', T0 + 5), { resolved: 'agree' });
  eq(S.history[0].pairs, [{ a: 0, b: 1, kind: 'agree' }]);
  ok(SWG.hostTick(S, T0 + 6));
  eq(S.phase, 'finished');
  eq(S.result, 'agree');
  eq(S.resultBy, null);
});
test('单方 next 不推进，双方表态后才下一轮', () => {
  const S = mkDuel({ settings: { timeLimit: 30 } });
  SWG.submit(S, 0, '苹果', T0 + 1);
  SWG.submit(S, 1, '香蕉', T0 + 2);
  SWG.hostTick(S, T0 + 3);
  eq(SWG.duelDecide(S, 0, 'next', T0 + 4), { resolved: null });
  notOk(SWG.hostTick(S, T0 + 5));
  eq(S.phase, 'reveal');
  eq(S.round, 1);
  eq(SWG.duelDecide(S, 1, 'next', T0 + 6), { resolved: 'next' });
  ok(SWG.hostTick(S, T0 + 7));
  eq(S.phase, 'playing');
  eq(S.round, 2);
  eq(S.subs, {});
  eq(S.decisions, {});
  eq(S.history.length, 1);
  eq(S.deadline, T0 + 7 + 30000);
});
test('一方 same 后另一方 next 仍下一轮', () => {
  const S = mkDuel();
  SWG.submit(S, 0, '苹果', T0 + 1);
  SWG.submit(S, 1, '香蕉', T0 + 2);
  SWG.hostTick(S, T0 + 3);
  eq(SWG.duelDecide(S, 0, 'same', T0 + 4), { resolved: null });
  notOk(SWG.hostTick(S, T0 + 5));
  eq(SWG.duelDecide(S, 1, 'next', T0 + 6), { resolved: 'next' });
  ok(SWG.hostTick(S, T0 + 7));
  eq(S.round, 2);
  eq(S.result, null);
});
test('非法表态被拒', () => {
  const S = mkDuel();
  SWG.submit(S, 0, '苹果', T0 + 1);
  SWG.submit(S, 1, '香蕉', T0 + 2);
  SWG.hostTick(S, T0 + 3);
  eq(SWG.duelDecide(S, 0, 'whatever', T0 + 4).error, 'BAD_VALUE');
  eq(SWG.duelDecide(S, 5, 'same', T0 + 4).error, 'INACTIVE');
});
test('超时空词不可 same', () => {
  const S = mkDuel({ settings: { timeLimit: 15 } });
  SWG.submit(S, 0, '苹果', T0 + 1);
  ok(SWG.hostTick(S, T0 + S.deadline - T0 + 800));
  eq(S.phase, 'reveal');
  eq(S.history[0].words, ['苹果', '']);
  eq(SWG.duelDecide(S, 0, 'same', T0 + 20000).error, 'EMPTY_WORD');
  eq(SWG.duelDecide(S, 0, 'next', T0 + 20001), { resolved: null });
  eq(SWG.duelDecide(S, 1, 'next', T0 + 20002), { resolved: 'next' });
  ok(SWG.hostTick(S, T0 + 20003));
  eq(S.round, 2);
});
test('双方超时 → 只能下一轮', () => {
  const S = mkDuel({ settings: { timeLimit: 15 } });
  ok(SWG.hostTick(S, S.deadline + 800));
  eq(S.phase, 'reveal');
  eq(S.history[0].words, ['', '']);
  notOk(SWG.hostTick(S, S.deadline + 900));
  eq(SWG.duelDecide(S, 0, 'same', T0 + 30000).error, 'EMPTY_WORD');
});
test('giveup 结算只执行一次', () => {
  const S = mkDuel();
  ok(SWG.finish(S, 'giveup', 0, T0 + 10));
  eq(S.phase, 'finished');
  eq(S.result, 'giveup');
  eq(S.resultBy, 0);
  notOk(SWG.finish(S, 'agree', 1, T0 + 11));
  eq(S.result, 'giveup');
  eq(S.resultBy, 0);
});
test('重复词连续两轮仍可 match', () => {
  const S = mkDuel();
  SWG.submit(S, 0, '西瓜', T0 + 1);
  SWG.submit(S, 1, '空调', T0 + 2);
  SWG.hostTick(S, T0 + 3);
  SWG.duelDecide(S, 0, 'next', T0 + 4);
  notOk(SWG.hostTick(S, T0 + 5));
  SWG.duelDecide(S, 1, 'next', T0 + 6);
  SWG.hostTick(S, T0 + 7);
  eq(S.round, 2);
  eq(SWG.submit(S, 0, '西瓜', T0 + 8).ok, true);
  eq(SWG.submit(S, 1, '西瓜', T0 + 9).ok, true);
  SWG.hostTick(S, T0 + 10);
  eq(S.result, 'match');
  eq(S.history.length, 2);
});
test('submit 在 reveal / 非法词时拒绝', () => {
  const S = mkDuel();
  SWG.submit(S, 0, '苹果', T0 + 1);
  SWG.submit(S, 1, '香蕉', T0 + 2);
  SWG.hostTick(S, T0 + 3);
  eq(SWG.submit(S, 0, '再来', T0 + 4).error, 'NOT_PLAYING');
  const S2 = mkDuel();
  eq(SWG.submit(S2, 0, '！！', T0 + 1).error, 'ONLY_SYMBOL');
  eq(SWG.submit(S2, 0, '一二三四五六七八九十一', T0 + 1).error, 'TOO_LONG');
  eq(SWG.submit(S2, 9, '苹果', T0 + 1).error, 'INACTIVE');
});

/* ========== 4. 多人 ========== */

section('party: 提交与配对');

function partyReveal(words, roundLimit) {
  const S = mkParty({ settings: { roundLimit: roundLimit || 10 } });
  words.forEach((w, i) => SWG.submit(S, i, w, T0 + 1 + i));
  SWG.hostTick(S, T0 + 10);
  return S;
}

test('exact 对自动成对', () => {
  const S = partyReveal(['西瓜', '西瓜', '空调']);
  eq(S.phase, 'reveal');
  eq(S.history.length, 1);
  eq(S.history[0].pairs, [{ a: 0, b: 1, kind: 'exact' }]);
  eq(S.history[0].all, false);
});
test('单方认证不成对', () => {
  const S = partyReveal(['西瓜', '空调', '夏天']);
  eq(SWG.toggleClaim(S, 0, 1, T0 + 20), { ok: true, on: true });
  eq(S.history[0].pairs, []);
  eq(SWG.partyStats(S, 0).myScore, 0);
});
test('双向认证成 agree 对', () => {
  const S = partyReveal(['西瓜', '空调', '夏天']);
  SWG.toggleClaim(S, 1, 0, T0 + 20);
  SWG.toggleClaim(S, 0, 1, T0 + 21);
  eq(S.history[0].pairs, [{ a: 0, b: 1, kind: 'agree' }]);
  const st = SWG.partyStats(S, 0);
  eq(st.scores, [{ seat: 0, score: 1 }, { seat: 1, score: 1 }, { seat: 2, score: 0 }]);
  eq(st.myScore, 1);
});
test('取消认证写墓碑并撤对', () => {
  const S = partyReveal(['西瓜', '空调', '夏天']);
  SWG.toggleClaim(S, 1, 0, T0 + 20);
  SWG.toggleClaim(S, 0, 1, T0 + 21);
  eq(SWG.toggleClaim(S, 1, 0, T0 + 22), { ok: true, on: false });
  eq(S.claims[1][0], { on: false, at: T0 + 22 });
  eq(S.history[0].pairs, []);
  eq(SWG.partyStats(S, 0).myScore, 0);
});
test('撞词对不可认证', () => {
  const S = partyReveal(['西瓜', '西瓜', '夏天']);
  eq(SWG.toggleClaim(S, 0, 1, T0 + 20).error, 'EXACT');
});
test('空词不可发起/接受认证', () => {
  const S = mkParty({ settings: { timeLimit: 15 } });
  SWG.submit(S, 0, '西瓜', T0 + 1);
  SWG.submit(S, 1, '空调', T0 + 2);
  SWG.hostTick(S, S.deadline + 800);
  eq(S.phase, 'reveal');
  eq(S.history[0].words, ['西瓜', '空调', '']);
  eq(SWG.toggleClaim(S, 0, 2, T0 + 30000).error, 'EMPTY_WORD');
  eq(SWG.toggleClaim(S, 2, 0, T0 + 30001).error, 'EMPTY_WORD');
});
test('全员同词 → allmatch 立即结算', () => {
  const S = partyReveal(['夏天', '夏天', '夏天']);
  eq(S.phase, 'finished');
  eq(S.result, 'allmatch');
  eq(S.resultBy, null);
  eq(S.history[0].all, true);
  eq(S.history[0].pairs.length, 3);
  const st = SWG.partyStats(S, 1);
  eq(st.scores, [{ seat: 0, score: 2 }, { seat: 1, score: 2 }, { seat: 2, score: 2 }]);
});
test('四人全员同词 6 对', () => {
  const S = mkParty({ seatNames: ['a', 'b', 'c', 'd'] });
  ['同', '同', '同', '同'].forEach((w, i) => SWG.submit(S, i, w, T0 + i));
  SWG.hostTick(S, T0 + 10);
  eq(S.result, 'allmatch');
  eq(S.history[0].pairs.length, 6);
});
test('历史保留每个座位的词（超时空串）', () => {
  const S = partyReveal(['西瓜', '空调', '夏天']);
  eq(S.history[0].words.length, 3);
  eq(S.history[0].words, ['西瓜', '空调', '夏天']);
  eq(S.history[0].round, 1);
});

section('party: 准备与推进');

function nextRound(S) {
  SWG.activeSeats(S).forEach((s, i) => SWG.setReady(S, s, true, T0 + 100 + i));
  return SWG.hostTick(S, T0 + 200);
}

test('非全员 ready 不推进', () => {
  const S = partyReveal(['西瓜', '空调', '夏天']);
  SWG.setReady(S, 0, true, T0 + 20);
  SWG.setReady(S, 1, true, T0 + 21);
  notOk(SWG.allReady(S));
  notOk(SWG.hostTick(S, T0 + 22));
  eq(S.phase, 'reveal');
  eq(S.round, 1);
});
test('全员 ready 自动下一局', () => {
  const S = partyReveal(['西瓜', '空调', '夏天']);
  ok(nextRound(S));
  eq(S.phase, 'playing');
  eq(S.round, 2);
  eq(S.subs, {});
  eq(S.ready, {});
  eq(S.claims, {});
  eq(S.history.length, 1);
});
test('取消 ready', () => {
  const S = partyReveal(['西瓜', '空调', '夏天']);
  SWG.setReady(S, 0, true, T0 + 20);
  SWG.setReady(S, 0, false, T0 + 21);
  eq(S.ready[0], { on: false, at: T0 + 21 });
  notOk(SWG.allReady(S));
});
test('打满局数 → limit', () => {
  const S = mkParty({ settings: { roundLimit: 5 } });
  for (let r = 1; r <= 5; r++) {
    SWG.submit(S, 0, '词' + r + 'a', T0 + 1);
    SWG.submit(S, 1, '词' + r + 'b', T0 + 2);
    SWG.submit(S, 2, '词' + r + 'c', T0 + 3);
    SWG.hostTick(S, T0 + 4);
    eq(S.phase, 'reveal');
    eq(S.round, r);
    ok(nextRound(S));
  }
  eq(S.phase, 'finished');
  eq(S.result, 'limit');
  eq(S.history.length, 5);
});
test('房主提前结束 → giveup 且记录发起人', () => {
  const S = partyReveal(['西瓜', '空调', '夏天']);
  ok(SWG.finish(S, 'giveup', 0, T0 + 30));
  eq(S.result, 'giveup');
  eq(S.resultBy, 0);
  notOk(SWG.finish(S, 'limit', 0, T0 + 31));
  eq(S.result, 'giveup');
});

section('party: 统计与称号');

test('partyStats 累计分与 CP 榜', () => {
  const S = mkParty({ seatNames: ['a', 'b', 'c', 'd'] });
  S.history = [
    { round: 1, words: ['a', 'a', 'b', 'c'], pairs: [{ a: 0, b: 1, kind: 'exact' }, { a: 0, b: 2, kind: 'agree' }], all: false },
    { round: 2, words: ['x', 'y', 'z', 'w'], pairs: [{ a: 0, b: 1, kind: 'agree' }], all: false },
  ];
  const st = SWG.partyStats(S, 2);
  eq(st.rounds, 2);
  eq(st.scores, [{ seat: 0, score: 3 }, { seat: 1, score: 2 }, { seat: 2, score: 1 }, { seat: 3, score: 0 }]);
  eq(st.pairs[0], { a: 0, b: 1, n: 2, count: 2 });
  eq(st.pairs.length, 2);
  eq(st.best, { a: 0, b: 1, n: 2, count: 2 });
  eq(st.topSeats, [0, 1]);
  eq(st.myScore, 1);
  eq(st.myBest, { a: 0, b: 2, n: 1, count: 1 });
});
test('partyStats 无 CP 时候选为空', () => {
  const S = mkParty();
  const st = SWG.partyStats(S, 1);
  eq(st.best, null);
  eq(st.myBest, null);
  eq(st.topSeats, []);
  eq(st.myScore, 0);
  eq(st.rounds, 0);
});
test('rankTitles 并列占位 (5,5,2)', () => {
  const r = SWG.rankTitles([{ seat: 0, score: 5 }, { seat: 1, score: 5 }, { seat: 2, score: 2 }]);
  eq(r.special, null);
  eq(r.list, [
    { rank: 1, title: '万人迷', tag: null, seats: [0, 1] },
    { rank: 3, title: '独立寒秋的脑回路', tag: null, seats: [2] },
  ]);
});
test('rankTitles 四人 (6,4,4,1)', () => {
  const r = SWG.rankTitles([{ seat: 0, score: 6 }, { seat: 1, score: 4 }, { seat: 2, score: 4 }, { seat: 3, score: 1 }]);
  eq(r.list.map((g) => [g.rank, g.title, g.seats]), [
    [1, '万人迷', [0]],
    [2, '比较标准的脑回路', [1, 2]],
    [4, '独立寒秋的脑回路', [3]],
  ]);
});
test('rankTitles 三人全 0 → 各自美丽', () => {
  const r = SWG.rankTitles([{ seat: 0, score: 0 }, { seat: 1, score: 0 }, { seat: 2, score: 0 }]);
  eq(r.special, '各自美丽');
  eq(r.tag, '都这样了还能做朋友吗！？');
  eq(r.list, []);
});
test('rankTitles 三人同分 >0 → 三胞胎', () => {
  const r = SWG.rankTitles([{ seat: 0, score: 2 }, { seat: 1, score: 2 }, { seat: 2, score: 2 }]);
  eq(r.special, '三胞胎');
  eq(r.tag, '可以去驾驶EVA了');
});
test('rankTitles 四人同分 >0 → 四胞胎', () => {
  const r = SWG.rankTitles([{ seat: 0, score: 3 }, { seat: 1, score: 3 }, { seat: 2, score: 3 }, { seat: 3, score: 3 }]);
  eq(r.special, '四胞胎');
});
test('cpTitle 边界', () => {
  eq(SWG.cpTitle(0), null);
  eq(SWG.cpTitle(1), '一撞钟情');
  eq(SWG.cpTitle(2), '心有灵犀 CP');
  eq(SWG.cpTitle(3), '心有灵犀 CP');
  eq(SWG.cpTitle(4), '默契老夫老妻');
  eq(SWG.cpTitle(5), '默契老夫老妻');
  eq(SWG.cpTitle(6), '天选 CP');
  eq(SWG.cpTitle(9), '天选 CP');
});

/* ========== 5. 称号边界 ========== */

section('duelLevel');

test('轮数边界', () => {
  const t = (n) => SWG.duelLevel(n, 'match').t;
  eq(t(1), '灵魂双胞胎');
  eq(t(2), '脑电波同频');
  eq(t(3), '心有灵犀');
  eq(t(4), '默契搭子');
  eq(t(5), '默契搭子');
  eq(t(6), '渐入佳境');
  eq(t(8), '渐入佳境');
  eq(t(9), '脑内环游');
  eq(t(12), '脑内环游');
  eq(t(13), '平行宇宙重逢');
  eq(t(40), '平行宇宙重逢');
});
test('13+ 文案带入轮数', () => {
  ok(SWG.duelLevel(15, 'match').q.indexOf('15') >= 0);
  eq(SWG.duelLevel(15, 'match').q, '跨越了 15 轮，终于在同一个宇宙相遇');
});
test('giveup 覆盖轮数', () => {
  eq(SWG.duelLevel(3, 'giveup'), { t: '信号失联', q: '今天的脑电波没对上频道，换个时间再战！' });
  eq(SWG.duelLevel(1, 'giveup').t, '信号失联');
});
test('文案完整性', () => {
  eq(SWG.duelLevel(1, 'match').q, '第一轮就撞上？你们是不是共用一个脑子！');
  eq(SWG.duelLevel(3, 'agree').q, '一点就通，好搭子认证 ✓');
});

/* ========== 6. hostTick ========== */

section('hostTick');

test('不限时且未交齐 → 不推进', () => {
  const S = mkParty();
  SWG.submit(S, 0, '西瓜', T0 + 1);
  notOk(SWG.hostTick(S, T0 + 999999));
  eq(S.phase, 'playing');
});
test('限时 deadline+800 未到不推进', () => {
  const S = mkParty({ settings: { timeLimit: 15 } });
  SWG.submit(S, 0, '西瓜', T0 + 1);
  notOk(SWG.hostTick(S, S.deadline + 799));
  eq(S.phase, 'playing');
});
test('限时 deadline+800 补空并揭晓', () => {
  const S = mkParty({ settings: { timeLimit: 15 } });
  SWG.submit(S, 0, '西瓜', T0 + 1);
  const tickAt = S.deadline + 800;
  ok(SWG.hostTick(S, tickAt));
  eq(S.phase, 'reveal');
  eq(S.subs[1], { word: '', at: tickAt, done: true, round: 1 });
  eq(S.history[0].words, ['西瓜', '', '']);
});
test('tick 幂等：揭晓后不重复写历史', () => {
  const S = partyReveal(['西瓜', '空调', '夏天']);
  notOk(SWG.hostTick(S, T0 + 50));
  eq(S.history.length, 1);
});
test('activeSeats 不足 → giveup 且只结算一次', () => {
  const S = mkParty();
  SWG.markDeparted(S, 2, T0 + 5);
  ok(SWG.hostTick(S, T0 + 6));
  eq(S.phase, 'finished');
  eq(S.result, 'giveup');
  eq(S.resultBy, 0);
  notOk(SWG.hostTick(S, T0 + 7));
  eq(S.result, 'giveup');
});
test('四人房一人离席后仍可推进（离席视为 ready）', () => {
  const S = mkParty({ seatNames: ['a', 'b', 'c', 'd'] });
  ['西', '东', '南', '北'].forEach((w, i) => SWG.submit(S, i, w, T0 + i));
  SWG.hostTick(S, T0 + 10);
  eq(S.phase, 'reveal');
  SWG.markDeparted(S, 3, T0 + 11);
  SWG.setReady(S, 0, true, T0 + 12);
  SWG.setReady(S, 1, true, T0 + 13);
  notOk(SWG.hostTick(S, T0 + 14));
  SWG.setReady(S, 2, true, T0 + 15);
  ok(SWG.hostTick(S, T0 + 16));
  eq(S.round, 2);
});
test('rematch 全员确认 → 重开', () => {
  const S = partyReveal(['夏天', '夏天', '夏天']);
  eq(S.phase, 'finished');
  eq(SWG.toggleRematch(S, 0, T0 + 40), { ok: true, on: true });
  SWG.toggleRematch(S, 1, T0 + 41);
  notOk(SWG.hostTick(S, T0 + 42));
  SWG.toggleRematch(S, 2, T0 + 43);
  ok(SWG.hostTick(S, T0 + 44));
  eq(S.phase, 'playing');
  eq(S.gameNo, 2);
  eq(S.round, 1);
  eq(S.history, []);
  eq(S.result, null);
});
test('rematch 取消后不重开', () => {
  const S = partyReveal(['夏天', '夏天', '夏天']);
  SWG.toggleRematch(S, 0, T0 + 40);
  SWG.toggleRematch(S, 0, T0 + 41);
  SWG.toggleRematch(S, 1, T0 + 42);
  SWG.toggleRematch(S, 2, T0 + 43);
  notOk(SWG.allRematch(S));
  notOk(SWG.hostTick(S, T0 + 44));
  eq(S.gameNo, 1);
});
test('disableRematch 清座位', () => {
  const S = partyReveal(['夏天', '夏天', '夏天']);
  SWG.toggleRematch(S, 1, T0 + 40);
  ok(SWG.disableRematch(S, 1));
  eq(S.rematch, {});
  notOk(SWG.disableRematch(S, 1));
});
test('withdraw 后重新回到未完成', () => {
  const S = mkParty();
  SWG.submit(S, 0, '西瓜', T0 + 1);
  ok(SWG.allDone(S) === false);
  SWG.submit(S, 1, '空调', T0 + 2);
  SWG.submit(S, 2, '夏天', T0 + 3);
  ok(SWG.allDone(S));
  eq(SWG.withdraw(S, 1, T0 + 4), { ok: true });
  eq(S.subs[1], { word: '', at: T0 + 4, done: false, round: 1 });
  notOk(SWG.allDone(S));
  ok(SWG.hostTick(S, T0 + 5) === false);
});

/* ========== 7. 离席 ========== */

section('离席');

test('markDeparted 记录 + 空词 + 清理', () => {
  const S = mkParty();
  ['西瓜', '空调', '夏天'].forEach((w, i) => SWG.submit(S, i, w, T0 + i));
  SWG.hostTick(S, T0 + 10);
  SWG.setReady(S, 2, true, T0 + 11);
  S.claims[2] = { 0: { on: true, at: 1 } };
  ok(SWG.markDeparted(S, 2, T0 + 20));
  eq(S.departed, [2]);
  eq(SWG.isActive(S, 2), false);
  eq(SWG.activeSeats(S), [0, 1]);
  eq(S.ready[2], undefined);
  eq(S.claims[2], undefined);
  notOk(SWG.markDeparted(S, 2, T0 + 21));
  eq(S.departed, [2]);
  notOk(SWG.markDeparted(S, 9, T0 + 22));
});
test('离席者不参与配对与计分', () => {
  const S = mkParty({ seatNames: ['a', 'b', 'c', 'd'] });
  ['西', '东', '南', '北'].forEach((w, i) => SWG.submit(S, i, w, T0 + i));
  SWG.hostTick(S, T0 + 10);
  SWG.markDeparted(S, 3, T0 + 11);
  SWG.syncPairs(S);
  eq(S.history[0].words, ['西', '东', '南', '北']);
  eq(S.history[0].pairs, []);
  eq(SWG.partyStats(S, 0).scores.length, 3);
});
test('游戏中离席本轮词按空处理', () => {
  const S = mkParty({ seatNames: ['a', 'b', 'c', 'd'] });
  ['西', '东', '南', '北'].forEach((w, i) => SWG.submit(S, i, w, T0 + i));
  SWG.markDeparted(S, 0, T0 + 10);
  SWG.hostTick(S, T0 + 11);
  eq(S.history[0].words, ['', '东', '南', '北']);
  eq(S.phase, 'reveal');
});
test('双人一方离席 → giveup', () => {
  const S = mkDuel();
  SWG.submit(S, 0, '苹果', T0 + 1);
  SWG.markDeparted(S, 1, T0 + 2);
  ok(SWG.hostTick(S, T0 + 3));
  eq(S.result, 'giveup');
  eq(S.resultBy, 0);
});

/* ========== 8. mergeState ========== */

section('mergeState');

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

test('房主合并成员提交（保留 host 字段）', () => {
  const local = mkDuel();
  const remote = mkDuel();
  remote.subs = { 1: { word: '海', at: T0 + 100, done: true, round: 1 } };
  const out = SWG.mergeState(local, remote, { seat: 0, isHost: true });
  eq(out.round, 1);
  eq(out.subs[1].word, '海');
  eq(out.subs[0], undefined);
});
test('房主保留自己的阶段推进', () => {
  const local = mkParty();
  local.phase = 'reveal';
  local.round = 3;
  local.history = [{ round: 3, words: ['a', 'b', 'c'], pairs: [], all: false }];
  const remote = mkParty();
  remote.phase = 'playing';
  remote.round = 1;
  const out = SWG.mergeState(local, remote, { seat: 0, isHost: true });
  eq(out.phase, 'reveal');
  eq(out.round, 3);
  eq(out.history.length, 1);
});
test('成员采用远端 host 字段并保留自己较新提交', () => {
  const local = mkDuel();
  local.subs = { 1: { word: '自己的词', at: T0 + 500, done: true, round: 1 } };
  const remote = mkDuel();
  remote.phase = 'reveal';
  remote.history = [{ round: 1, words: ['苹果', '香蕉'], pairs: [], all: false }];
  const out = SWG.mergeState(local, remote, { seat: 1, isHost: false });
  eq(out.phase, 'reveal');
  eq(out.history.length, 1);
  eq(out.subs[1].word, '自己的词');
});
test('成员旧提交被远端新提交覆盖', () => {
  const local = mkDuel();
  local.subs = { 0: { word: '旧', at: T0 + 100, done: true, round: 1 } };
  const remote = mkDuel();
  remote.subs = { 0: { word: '新', at: T0 + 200, done: true, round: 1 } };
  const out = SWG.mergeState(local, remote, { seat: 1, isHost: false });
  eq(out.subs[0].word, '新');
});
test('相同 at 取远端', () => {
  const local = mkDuel();
  local.ready = { 0: { on: true, at: T0 + 5 } };
  const remote = mkDuel();
  remote.ready = { 0: { on: false, at: T0 + 5 } };
  const out = SWG.mergeState(local, remote, { seat: 1, isHost: false });
  eq(out.ready[0].on, false);
});
test('轮次变化丢弃本地旧轮字段', () => {
  const local = mkParty();
  local.subs = { 0: { word: '旧词', at: T0 + 1, done: true, round: 1 } };
  local.claims = { 0: { 1: { on: true, at: T0 + 1 } } };
  local.ready = { 0: { on: true, at: T0 + 1 } };
  const remote = mkParty();
  remote.round = 2;
  const out = SWG.mergeState(local, remote, { seat: 0, isHost: false });
  eq(out.round, 2);
  eq(out.subs, {});
  eq(out.claims, {});
  eq(out.ready, {});
});
test('成员不拥有轮次：远端旧轮整块覆盖', () => {
  const local = mkParty();
  local.round = 2;
  local.subs = { 1: { word: '新轮词', at: T0 + 50, done: true, round: 2 } };
  const remote = mkParty();
  remote.round = 1;
  remote.subs = { 1: { word: '旧轮词', at: T0 + 40, done: true, round: 1 } };
  const out = SWG.mergeState(local, remote, { seat: 1, isHost: false });
  eq(out.round, 1);
  eq(out.subs[1].word, '旧轮词');
});
test('subs 中残留其它轮次的条目被丢弃', () => {
  const local = mkParty();
  local.round = 2;
  local.subs = { 0: { word: '上轮词', at: T0 + 1, done: true, round: 1 } };
  const remote = mkParty();
  remote.round = 2;
  const out = SWG.mergeState(local, remote, { seat: 0, isHost: true });
  eq(out.round, 2);
  eq(out.subs, {});
});
test('gameNo 变化丢弃本地 rematch', () => {
  const local = mkParty();
  local.phase = 'finished';
  local.gameNo = 1;
  local.rematch = { 0: { on: true, at: T0 + 9 } };
  const remote = mkParty();
  remote.gameNo = 2;
  const out = SWG.mergeState(local, remote, { seat: 0, isHost: false });
  eq(out.gameNo, 2);
  eq(out.rematch, {});
});
test('claims 按 from→to 合并，墓碑胜出', () => {
  const local = mkDuel();
  local.claims = { 0: { 1: { on: true, at: T0 + 100 } } };
  const remote = mkDuel();
  remote.claims = { 0: { 1: { on: false, at: T0 + 200 } } };
  const out = SWG.mergeState(local, remote, { seat: 0, isHost: false });
  eq(out.claims[0][1], { on: false, at: T0 + 200 });
});
test('claims 本地更新（新轮发起）保留', () => {
  const local = mkParty();
  local.claims = { 2: { 0: { on: true, at: T0 + 300 } } };
  const remote = mkParty();
  remote.claims = { 2: { 0: { on: false, at: T0 + 100 } }, 0: { 2: { on: true, at: T0 + 100 } } };
  const out = SWG.mergeState(local, remote, { seat: 2, isHost: false });
  eq(out.claims[2][0].on, true);
  eq(out.claims[0][2].on, true);
});
test('rev/_ts/_pushId 用远端', () => {
  const local = mkDuel();
  local.rev = 3;
  const remote = mkDuel();
  remote.rev = 7;
  remote._ts = T0 + 777;
  remote._pushId = '1-777-7';
  const out = SWG.mergeState(local, remote, { seat: 0, isHost: true });
  eq(out.rev, 7);
  eq(out._ts, T0 + 777);
  eq(out._pushId, '1-777-7');
});
test('mergeState 不修改入参', () => {
  const local = mkParty();
  local.subs = { 0: { word: 'a', at: T0 + 1, done: true, round: 1 } };
  local.claims = { 0: { 1: { on: true, at: 1 } } };
  const remote = mkParty();
  remote.round = 2;
  remote.subs = { 1: { word: 'b', at: T0 + 2, done: true, round: 2 } };
  const beforeL = clone(local);
  const beforeR = clone(remote);
  SWG.mergeState(local, remote, { seat: 0, isHost: true });
  eq(local, beforeL);
  eq(remote, beforeR);
});
test('两端交替合并收敛', () => {
  const host = mkParty();
  const member = mkParty();
  member.subs = { 1: { word: '成员词', at: T0 + 10, done: true, round: 1 } };
  const atHost = SWG.mergeState(host, member, { seat: 0, isHost: true });
  const backToMember = SWG.mergeState(member, atHost, { seat: 1, isHost: false });
  eq(atHost.subs[1].word, '成员词');
  eq(backToMember.subs[1].word, '成员词');
  eq(backToMember.round, 1);
});

/* ---------- 汇总 ---------- */

const total = passed + failures.length;
if (failures.length) {
  console.error('\nFAILED ' + failures.length + ' / ' + total + '\n');
  failures.forEach((f) => console.error('  ✗ ' + f + '\n'));
  process.exit(1);
}
console.log('SWG test-core: ' + passed + '/' + total + ' passed');