/* AI 对 AI 无头平衡模拟：vm 沙箱加载真实 game.js（DOM 桩 + 同步定时器），快速跑数千局统计胜率。
 * 用法：node sim-balance.js [局数] [种子]
 * 只读工具：不改 game.js；候选改动经 applyPatches 生成临时源码进沙箱，对比同一种子流。
 * 注：game.js 基准已含 2026-09 警探升级（批量唯一窗口、猜错按槽龄过滤、窗口封顶、命中概率加权，
 * 落地面板 41.7% / 旧版 33.4%）。下方 P_* 补丁常量为升级前的存档快照（from 文本匹配旧源码），
 * 需要时结合 git diff 还原对照版本。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
// vm 全局 Math 会被上下文内建遮蔽、host 侧赋值不可见 → 源码级替换为沙箱自持函数
const SIM_SRC = SRC.replace(/Math\.random\(/g, '__rng(');

function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function applyPatches(src, patches){
  if(!patches) return src;
  for(const p of patches){
    if(!src.includes(p.from)){
      throw new Error('patch not found: ' + p.name + '\nlooking for: ' + p.from.slice(0, 120));
    }
    if(p.from === p.to) continue;
    src = src.split(p.from).join(p.to);
  }
  return src;
}

function makeEl(){
  const store = {};
  const el = function(){ return makeEl(); };
  return new Proxy(el, {
    get(t, p){
      if(typeof p === 'symbol') return p === Symbol.toPrimitive ? (() => '') : undefined;
      if(p === 'toString') return () => '';
      if(p === 'valueOf') return () => '';
      if(p === 'length' || p === 'nodeType') return 0;
      if(p in store) return store[p];
      switch(p){
        case 'classList': return { add(){}, remove(){}, toggle(){}, contains: () => false };
        case 'style': return new Proxy({}, { get: () => '', set: () => true });
        case 'dataset': return {};
        case 'children': return [];
        case 'parentNode': return null;
        case 'querySelectorAll': return () => [];
        default:
          return () => makeEl();
      }
    },
    set(t, p, v){ store[p] = v; return true; },
    has(){ return true; },
    apply(){ return makeEl(); },
  });
}

function makeCtx(src, seed, mode){
  const docEl = makeEl();
  const document = {
    body: docEl, documentElement: makeEl(), head: makeEl(),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    getElementById: () => makeEl(),
    createElement: () => makeEl(),
    createTextNode: () => makeEl(),
    addEventListener(){}, removeEventListener(){},
    getComputedStyle: () => new Proxy({}, { get: () => '', set: () => true }),
  };
  const localStorage = { getItem: () => null, setItem(){}, removeItem(){}, clear(){}, key: () => null, length: 0 };
  const sandbox = {
    window: new Proxy({}, {
      get: (t, p) => {
        if(p === 'innerWidth' || p === 'innerHeight') return 800;
        if(p === 'matchMedia') return () => ({ matches: false, addEventListener(){}, removeEventListener(){} });
        if(p === 'addEventListener' || p === 'removeEventListener') return () => {};
        if(p === '__FUGITIVE_OL__') return false;
        return undefined;
      },
    }),
    document, localStorage, navigator: {},
    console: { log(){}, warn(){}, error(){}, info(){} },
    setTimeout: (fn) => { fn(); return 1; },   // 定时器同步执行：wait/调度变纯微任务，AI 链自驱
    clearTimeout(){}, setInterval: () => 1, clearInterval(){},
    innerWidth: 800, innerHeight: 800,
    __rng: mulberry32(seed),
    Math, Date, JSON, Promise, parseInt, parseFloat, String, Number, Boolean, Array, Object,
    Set, Map, isNaN, encodeURIComponent, decodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'game.js' });
  // 顶层 let/const 是词法绑定不挂全局对象 → 在沙箱内建闭包 API
  const api = vm.runInContext('(' + (function(mode){
    return {
      mode,
      newGame(){ newGame('fugitive', mode); },
      get phase(){ return state ? state.phase : 'init'; },
      get turn(){ return state ? state.turn : null; },
      get winner(){ return state ? state.winner : null; },
      fugAct(){ if(state && state.turn === 'fugitive' && state.phase === 'playing') aiFugitiveTurn(aiGen); },
      snapshot(){ return state ? JSON.parse(JSON.stringify(state)) : null; },
    };
  }).toString() + ')(' + JSON.stringify(mode) + ')', sandbox);
  return { sb: sandbox, api };
}

async function playOne(ctx){
  const maxLoops = 8000;
  ctx.api.newGame();
  let guard = 0;
  while(ctx.api.phase !== 'over' && guard++ < maxLoops){
    ctx.api.fugAct();
    // 警探行动与搜捕由 endFugTurn/endMarTurn 内的 scheduleAI（同步定时器）自驱；让出事件循环冲刷微任务
    await new Promise(r => setImmediate(r));
  }
  const st = ctx.api.snapshot();
  if(!st || st.phase !== 'over') return { winner: null, type: 'aborted' };
  const manhunt = st.log.some(l => l.msg.includes('搜捕开始'));
  const w = st.winner;
  const type = w === 'marshal'
    ? (manhunt ? 'manhunt-mar' : 'reveal-mar')
    : (manhunt ? 'manhunt-fug' : 'direct42-fug');
  return {
    winner: w, type, manhunt,
    reveals: st.fug.route.filter(r => !r.hidden).length,
    route: st.fug.route.length,
    misses: st.marMissed.length,
    turns: st.turns,
  };
}

function summarize(label, rows){
  const N = rows.length;
  const cnt = (cond) => rows.filter(cond).length;
  const avg = (f) => (rows.reduce((s, r) => s + (r[f] || 0), 0) / N).toFixed(2);
  const mar = cnt(r => r.winner === 'marshal');
  const fug = cnt(r => r.winner === 'fugitive');
  console.log(
    `${label}  警探 ${(mar * 100 / N).toFixed(1)}% / 大盗 ${(fug * 100 / N).toFixed(1)}%` +
    `  | 直逃42 ${cnt(r => r.type === 'direct42-fug')} · 搜捕败 ${cnt(r => r.type === 'manhunt-fug')} · 搜捕胜 ${cnt(r => r.type === 'manhunt-mar')} · 翻全胜 ${cnt(r => r.type === 'reveal-mar')}` +
    `  | 未终局 ${cnt(r => r.winner === null)}  局均：回合 ${avg('turns')} · 猜错 ${avg('misses')} · 翻牌 ${avg('reveals')}/${avg('route')}`
  );
}

// 实验补丁：from/to 均为 SIM_SRC 内的精确片段
const P_CAP = [
  {
    name: 'cap-precompute',
    from: '  const cands = [];\n  let prevSet = new Set([0]); // 起点 0\n  let lastPublic = 0;\n  for(let i=0;i<route.length;i++){',
    to: '  const cands = [];\n  let prevSet = new Set([0]); // 起点 0\n  let lastPublic = 0;\n  // 暗格必小于其后任一公开锚点 → 窗口上限取更小值，避免浪费探测锚点之后的数字\n  const cap = [];\n  let nextPub = 41;\n  for(let i=route.length-1;i>=0;i--){\n    cap[i] = nextPub;\n    if(!route[i].hidden) nextPub = route[i].num - 1;\n  }\n  for(let i=0;i<route.length;i++){',
  },
  {
    name: 'cap-window',
    from: '        const x = p+d;\n        if(x>=1 && x<=41 && !known.has(x)) cur.add(x);',
    to: '        const x = p+d;\n        if(x>=1 && x<=41 && x<=cap[i] && !known.has(x)) cur.add(x);',
  },
  {
    name: 'cap-fallback',
    from: '      for(let n=lastPublic+1;n<=41;n++){ if(!known.has(n)) cur.add(n); }',
    to: '      for(let n=lastPublic+1;n<=cap[i];n++){ if(!known.has(n)) cur.add(n); }',
  },
];
const P_ANCHOR = [
  {
    name: 'anchor-first',
    from: '  const freq = new Map();\n  for(const c of cands){\n    if(!c) continue;\n    for(const n of c){ freq.set(n, (freq.get(n)||0)+1); }\n  }\n  let best=[], bestF=0;\n  for(const [n,f] of freq){\n    if(f>bestF){ bestF=f; best=[n]; }\n    else if(f===bestF){ best.push(n); }\n  }\n  if(best.length){\n    const pick = rng(100)<15 ? best[rng(best.length)] : best[0];\n    return pick;\n  }\n  const pool = [];\n  for(let n=1;n<=41;n++){ if(!aiKnownNums().has(n)) pool.push(n); }\n  if(pool.length) return pool[rng(pool.length)];\n  // 全部数字都猜过：从已猜未中盲选（仍比固定猜 1 好）\n  return aiMarMissed.length ? aiMarMissed[rng(aiMarMissed.length)] : 1;',
    to: '  // 锚点优先：无唯一候选时，探最前暗置格窗口的最低候选（命中即重锚、收窄后续全部窗口）\n  for(const c of cands){\n    if(c && c.size) return [...c][0];\n  }\n  const pool = [];\n  for(let n=1;n<=41;n++){ if(!aiKnownNums().has(n)) pool.push(n); }\n  if(pool.length) return pool[rng(pool.length)];\n  // 全部数字都猜过：从已猜未中盲选（仍比固定猜 1 好）\n  return aiMarMissed.length ? aiMarMissed[rng(aiMarMissed.length)] : 1;',
  },
];

// 直逃机制：警探翻开 ≥30 的地点牌后，大盗 42 一步即胜（武装逃逸）。
// 低区优先：命中率期望不差太多时先翻 ≤29 —— 不改变「翻全」所需命中总数，
// 只把武装推迟到末段冲刺临界，把必败的直逃局转化为还有翻盘可能的搜捕局。
// alpha：低区最佳频次 ≥ 高区最佳频次 × alpha 时优先低区（0=纯频次原逻辑，0.5/1.0 为温和/严格低区）。
const FREQ_FROM =
  '  const freq = new Map();\n' +
  '  for(const c of cands){\n' +
  '    if(!c) continue;\n' +
  '    for(const n of c){ freq.set(n, (freq.get(n)||0)+1); }\n' +
  '  }\n' +
  '  let best=[], bestF=0;\n' +
  '  for(const [n,f] of freq){\n' +
  '    if(f>bestF){ bestF=f; best=[n]; }\n' +
  '    else if(f===bestF){ best.push(n); }\n' +
  '  }\n' +
  '  if(best.length){\n' +
  '    const pick = rng(100)<15 ? best[rng(best.length)] : best[0];\n' +
  '    return pick;\n' +
  '  }\n';
function freqBlockTo(alpha, weighted){
  const score = weighted
    ? '  // 命中概率加权：候选跨槽按 1/窗口大小 求和（窗小者单槽命中率更高，槽数同频不代表同概率）\n' +
      '  const freq = new Map();\n' +
      '  for(const c of cands){\n' +
      '    if(!c || !c.size) continue;\n' +
      '    const q = 1 / c.size;\n' +
      '    for(const n of c){ freq.set(n, (freq.get(n)||0) + q); }\n' +
      '  }\n'
    : '  const freq = new Map();\n' +
      '  for(const c of cands){\n' +
      '    if(!c) continue;\n' +
      '    for(const n of c){ freq.set(n, (freq.get(n)||0)+1); }\n' +
      '  }\n';
  if(alpha === null){
    return score +
      '  let best=[], bestW=0;\n' +
      '  for(const [n,f] of freq){\n' +
      '    if(f>bestW){ bestW=f; best=[n]; }\n' +
      '    else if(f===bestW){ best.push(n); }\n' +
      '  }\n' +
      '  if(best.length){\n' +
      '    const pick = rng(100)<15 ? best[rng(best.length)] : best[0];\n' +
      '    return pick;\n' +
      '  }\n';
  }
  return score +
    '  let low=[], high=[], lf=0, hf=0;\n' +
    '  for(const [n,f] of freq){\n' +
    '    if(n<=29){ if(f>lf){ lf=f; low=[n]; } else if(f===lf){ low.push(n); } }\n' +
    '    else     { if(f>hf){ hf=f; high=[n]; } else if(f===hf){ high.push(n); } }\n' +
    '  }\n' +
    '  const pickOne = arr => (rng(100)<15 ? arr[rng(arr.length)] : arr[0]);\n' +
    '  if(lf && lf >= hf * ' + alpha + ') return pickOne(low); // 低区优先：直逃武装推迟\n' +
    '  if(high.length) return pickOne(high);\n';
}
const P_LOW10 = [
  { name: 'freq-low10', from: FREQ_FROM, to: freqBlockTo(1.0, false) },
];
const P_LOW05 = [
  { name: 'freq-low05', from: FREQ_FROM, to: freqBlockTo(0.5, false) },
];
const P_WGT = [
  { name: 'freq-wgt', from: FREQ_FROM, to: freqBlockTo(null, true) },
];
const P_WLOW05 = [
  { name: 'freq-wlow05', from: FREQ_FROM, to: freqBlockTo(0.5, true) },
];

// 猜错按槽龄过滤：aiMarMissed 排除只对「猜错时已放置」的槽（missLen > i）成立——
// 大盗之后才补打的牌完全可能是曾猜错的数字，对旧槽排除仍然可靠，对新槽排除是错的。
// （旧 AI 把猜错当永久排除，会把「后来补打」的真值从窗口里永久剔除 → 系统性漏猜）
const P_STAMP = [
  {
    name: 'stamp-decl',
    from: 'let aiMarMissed = []; // AI 警探猜过未中的数字（内部记忆，避免反复猜同一数字；对玩家 UI 不置灰）',
    to: 'let aiMarMissed = []; // AI 警探猜过未中的数字（内部记忆，避免反复猜同一数字；对玩家 UI 不置灰）\nlet aiMarMissLen = []; // 与 aiMarMissed 平行：各次猜错时的大盗路线长度（排除只对当时已放置的槽成立）',
  },
  {
    name: 'stamp-reset',
    from: '  aiMarMissed = [];',
    to: '  aiMarMissed = [];\n  aiMarMissLen = [];',
  },
  {
    name: 'stamp-record',
    from: '      if(state.humanRole === \'fugitive\') aiMarMissed.push(nums[0]); // AI 内部排除，避免反复猜同一数字',
    to: '      if(state.humanRole === \'fugitive\'){ aiMarMissed.push(nums[0]); aiMarMissLen.push(state.fug.route.length); } // AI 内部排除，避免反复猜同一数字',
  },
  {
    name: 'stamp-inference',
    from: '  const route = state.fug.route;\n  const known = aiKnownNums();\n  const cands = [];',
    to: '  const route = state.fug.route;\n  const base = knownNums(); // 公开 ∪ 手牌：对任意槽都成立的排除集\n  const cands = [];',
  },
  {
    name: 'stamp-slot-known',
    from: '    const relax = 2 * (route[i].cover || []).length; // 该格可见掩护牌数 ×2（标记奇 1 偶 2，取最大值）\n    let cur = new Set();',
    to: '    const relax = 2 * (route[i].cover || []).length; // 该格可见掩护牌数 ×2（标记奇 1 偶 2，取最大值）\n    // 猜错排除按槽龄过滤：该格在猜错时已放置（missLen > i）才排除，新槽仍可补打该数\n    const known = new Set(base);\n    for(let mi=0;mi<aiMarMissed.length;mi++){ if(aiMarMissLen[mi] > i) known.add(aiMarMissed[mi]); }\n    let cur = new Set();',
  },
];

// 批量猜测：多个唯一窗口（必中）一次全猜——单回合多翻牌直接提速「翻全」竞赛，
// 全程无 miss 风险（窗口唯一性由公开锚点保证，非投机）；marGuess 的多选管道本已支持。
const P_BATCH = [
  {
    name: 'batch-uniques',
    from: '  if(uniques.length){\n    const pick = rng(100)<15 ? uniques[rng(uniques.length)] : uniques[0];\n    return pick;\n  }',
    to: '  if(uniques.length){\n    if(uniques.length >= 2) return uniques; // 批量：多个唯一窗口一次全猜（必中，翻牌提速）\n    const pick = rng(100)<15 ? uniques[rng(uniques.length)] : uniques[0];\n    return pick;\n  }',
  },
  {
    name: 'batch-call',
    from: '  const guess = aiMarChooseGuess();\n  console.log(\'[mar-ai] choose guess =\', guess);\n  await marGuess([guess], gen);',
    to: '  const guess = aiMarChooseGuess();\n  const batch = Array.isArray(guess) ? guess : [guess];\n  console.log(\'[mar-ai] choose guess =\', batch.join(\',\'));\n  await marGuess(batch, gen);',
  },
];

const CONFIGS = [
  { key: 'landed', mode: 'normal',  srcPatch: null },
  { key: 'landed', mode: 'phantom', srcPatch: null },
];

async function main(){
  const N = parseInt(process.argv[2] || '3000', 10);
  const MASTER = mulberry32(parseInt(process.argv[3] || '777', 10));
  const gameSeeds = [];
  for(let i = 0; i < N; i++) gameSeeds.push((MASTER() * 0xFFFFFFFF) >>> 0); // mulberry32 入参须为 32 位整数
  const t0 = Date.now();
  for(const cfg of CONFIGS){
    const src = cfg.srcPatch ? applyPatches(SIM_SRC, cfg.srcPatch) : SIM_SRC;
    const ctx = makeCtx(src, 1, cfg.mode);
    const rows = [];
    for(let i = 0; i < N; i++){
      ctx.sb.__rng = mulberry32(gameSeeds[i]);
      rows.push(await playOne(ctx));
    }
    summarize(cfg.key + ' [' + cfg.mode + ']', rows);
  }
  console.log('done in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
if(require.main === module){
  main().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { SRC, SIM_SRC, makeCtx, playOne, mulberry32, applyPatches, CONFIGS };
