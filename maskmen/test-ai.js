'use strict';
/* AI 测试：合法性、可复现性、对随机对手的胜率。node test-ai.js */
const M = require('./game.js');
const AI = require('./ai.js');

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, name, extra) {
  if (cond) { passed++; return true; }
  failed++;
  failures.push(name + (extra ? '  >>  ' + extra : ''));
  return false;
}

function chooseAI(v, seed) { return AI.choose(v, seed); }

function chooseRandom(v, seed) {
  const rand = M.seeded(seed);
  const moves = v.legal.moves || [];
  if (v.legal.canPass && (!moves.length || rand() < 0.2)) return { type: 'pass' };
  if (!moves.length) return { type: 'pass' };
  const m = moves[Math.floor(rand() * moves.length)];
  return { type: 'play', color: m.color };
}

function step(st, chooser, tag) {
  if (st.phase === 'playing') {
    const v = M.viewFor(st, st.turn);
    const act = chooser(v, M.aiSeed(st));
    if (!act || (act.type !== 'play' && act.type !== 'pass')) {
      throw new Error(tag + ' AI 返回无效动作');
    }
    if (act.type === 'pass') {
      if (!v.legal.canPass) throw new Error(tag + ' AI 在不能跳过时跳过');
      const r = M.pass(st);
      if (!r.ok) throw new Error(tag + ' 跳过失败: ' + r.error);
    } else {
      const legalColor = v.legal.moves.some(function (m) { return m.color === act.color; });
      if (!legalColor) throw new Error(tag + ' AI 出了非法花色 ' + act.color);
      const r = M.play(st, act.color);
      if (!r.ok) throw new Error(tag + ' 出牌失败: ' + r.error);
    }
    return true;
  }
  if (st.phase === 'roundEnd') return M.nextRound(st).ok;
  if (st.phase === 'seasonEnd') {
    if (st.gameOver) return M.finishGame(st).ok;
    return M.nextSeason(st).ok;
  }
  return false;
}

function playGame(n, seed, chooser) {
  const st = M.createGame({ playerCount: n, seed: seed });
  let guard = 0;
  while (st.phase !== 'gameEnd') {
    if (++guard > 12000) throw new Error(n + '人局未能在步数上限内结束');
    if (!step(st, chooser, n + '人局')) throw new Error(n + '人局推进失败：' + st.phase);
  }
  return st;
}

/* 1. 全 AI 对局：合法、可完成、可复现 */
(function testAllAI() {
  for (let n = 2; n <= 6; n++) {
    for (let g = 0; g < 12; g++) {
      const seed = 5000 + n * 100 + g;
      let a, b;
      try {
        a = playGame(n, seed, chooseAI);
        b = playGame(n, seed, chooseAI);
      } catch (e) {
        ok(false, n + '人局 AI 自对弈', e.message);
        continue;
      }
      ok(true, n + '人局 AI 自对弈完成');
      ok(JSON.stringify(a.result) === JSON.stringify(b.result), n + '人局 AI 对局可复现（结果）');
      ok(M.serialize(a) === M.serialize(b), n + '人局 AI 对局可复现（全状态）');
      const winners = a.result.winnerIds;
      ok(winners.length >= 1 && winners.every(function (s) { return s >= 0 && s < n; }), n + '人局胜者有效');
    }
  }
})();

/* 2. AI 对随机：2 人局胜率（先 3 胜） */
(function testVsRandom() {
  const N = 200;
  let wins = 0;
  let losses = 0;
  for (let g = 0; g < N; g++) {
    const seed = 90000 + g;
    const st = M.createGame({ playerCount: 2, seed: seed });
    let guard = 0;
    while (st.phase !== 'gameEnd') {
      if (++guard > 12000) break;
      const chooser = st.turn === 0 ? chooseAI : chooseRandom;
      step(st, chooser, '人机对局');
    }
    if (st.result && st.result.winnerIds.indexOf(0) >= 0) wins++;
    else losses++;
  }
  const rate = wins / N;
  console.log('   AI vs 随机（200 局）：' + wins + ' 胜 / ' + losses + ' 负 = ' + (rate * 100).toFixed(1) + '%');
  ok(rate > 0.55, 'AI 对随机胜率 > 55%', (rate * 100).toFixed(1) + '%');
})();

/* 3. 同一视图 + 同一种子 → 同一决策 */
(function testDeterminism() {
  const st = M.createGame({ playerCount: 4, seed: 321 });
  const v = M.viewFor(st, st.turn);
  const s = M.aiSeed(st);
  const a = AI.choose(v, s);
  const b = AI.choose(v, s);
  ok(JSON.stringify(a) === JSON.stringify(b), 'AI 决策可复现');
  ok(a.type === 'play' && v.legal.moves.some(function (m) { return m.color === a.color; }),
    '首家 AI 决策合法');
})();

/* 4. 存档续玩：同一份存档两条线推进，结果必须一致 */
(function testSaveResume() {
  const st = M.createGame({ playerCount: 4, seed: 4711 });
  for (let i = 0; i < 30 && st.phase === 'playing'; i++) step(st, chooseAI, '存档前');

  const json = M.serialize(st);
  const a = M.deserialize(json);
  const b = M.deserialize(json);
  ok(!!a && !!b, '存档可反序列化');
  if (!a || !b) return;

  let guard = 0;
  while (a.phase !== 'gameEnd' && guard++ < 12000) step(a, chooseAI, '续玩A');
  while (b.phase !== 'gameEnd' && guard++ < 12000) step(b, chooseAI, '续玩B');
  ok(a.phase === 'gameEnd' && b.phase === 'gameEnd', '存档续玩可终局');
  ok(JSON.stringify(a.result) === JSON.stringify(b.result), '存档续玩结果一致');
  ok(M.serialize(a) === M.serialize(b), '存档续玩状态一致');
})();

/* 汇总 */
console.log('');
if (failed) {
  console.log('❌ 失败 ' + failed + ' 项 / 通过 ' + passed + ' 项');
  failures.slice(-20).forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
console.log('✅ AI 测试全部通过：' + passed + ' 项断言');