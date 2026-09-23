/* 《车票收藏家》音效慢放拉伸测试 —— 无头跑，不需要浏览器。
   用假 AudioContext 把每个节点被排到的时刻记下来，验两件事：
   1. stretch = 1 时与改动前逐值一致（T 与 D 都是恒等映射）；
   2. stretch = S 时每个时刻都从**本发起点**线性放大 S 倍。
   为什么必须有这个文件：`SFX.play` 吞掉全部异常（合成失败不能影响玩法），
   所以「时长喂给了锚定映射 T」这类错误在真机上只表现为静音 —— 没有断言就永远发现不了。 */
'use strict';
const REC = [];
let kind = '';
function param(owner, name) {
  const o = {
    value: 0,
    setValueAtTime(v, t) { REC.push([kind, name, t, v]); return o; },
    setTargetAtTime() { return o; },
    linearRampToValueAtTime(v, t) { REC.push([kind, name, t, v]); return o; },
    exponentialRampToValueAtTime(v, t) { REC.push([kind, name, t, v]); return o; },
  };
  return o;
}
function node(k) {
  const n = { connect() { return n; }, disconnect() {} };
  n.gain = param(n, 'gain');
  n.frequency = param(n, 'frequency');
  n.Q = param(n, 'Q');
  n.detune = param(n, 'detune');
  n.start = t => REC.push([k, 'start', t]);
  n.stop = t => REC.push([k, 'stop', t]);
  return n;
}
const CTX = {
  currentTime: 10, sampleRate: 48000, state: 'running', destination: {},
  resume: () => Promise.resolve(),
  createGain: () => node('gain'),
  createOscillator: () => node('osc'),
  createBufferSource: () => node('src'),
  createBiquadFilter: () => node('bq'),
  createBuffer: (ch, n, sr) => ({ duration: n / sr, getChannelData: () => new Float32Array(n) }),
};
global.window = { AudioContext: function () { return CTX; } };
require('./audio.js');
const SFX = global.window.TC_SFX;

function run(names, opt) {
  /* 假 ctx 的 currentTime 是死的，而限流（同名 100ms 内 10 发）与声部上限（14 个存活）
     都按真实 currentTime 记账 —— 不推进时间的话第二次 play 就会被当成「同一瞬间的第 N 发」挡掉。 */
  CTX.currentTime += 30;
  const base = CTX.currentTime + 0.005;
  REC.length = 0;
  names.forEach(n => SFX.play(n, opt));
  /* 时刻一律换算成「相对本发起点」，两个模式才可比 */
  return { base, times: REC.map(r => [r[0], r[1], r[2] == null ? null : r[2] - base]) };
}

const ALL = Object.keys({ tap: 1, confirm: 1, deny: 1, slide: 1, slideShut: 1, locker: 1, paper: 1, bag: 1, spin: 1, stamp: 1, pip: 1, tick: 1, score: 1, fanfare: 1, whoosh: 1, warn: 1, whistle: 1 });
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };

ok('TC_SFX 装上了', !!SFX && SFX.init() === true);

const plain = run(ALL, undefined);          // 不慢放
let maxPlain = 0;
plain.times.forEach(t => { if (t[2] != null && t[2] > maxPlain) maxPlain = t[2]; });
ok('不慢放时首音落在起点（<1ms）', Math.abs(plain.times[0][2]) < 0.001);
ok('不慢放时整发不超过 1.2s', maxPlain > 0.3 && maxPlain < 1.2);

const slow = run(ALL, { stretch: 5 });      // 慢放 5 倍
let bad = 0, maxSlow = 0;
slow.times.forEach(t => {
  if (t[2] == null) return;
  if (t[2] > maxSlow) maxSlow = t[2];
  if (t[2] < -0.001) bad++;                 // 起点不能被挪到过去
});
ok('慢放时没有任何时刻落在起点之前', bad === 0);

/* 逐值比对必须一个名字单独跑：一次性发 17 个名字会撞上 MAX_VOICES 上限
   （拉伸后每发占声部的时间本来就长 5 倍），拼批比对会数出不一样的长度。
   slideShut 覆盖 swish + thump（噪声带通 + 正弦下滑）、spin 覆盖 LFO 的独立 start/stop、
   locker 覆盖高次分音 + 噪声、stamp 覆盖 thump + 低通噪声、score 覆盖三连音 ——
   原语基本就都过了一遍。 */
['slideShut', 'spin', 'locker', 'stamp', 'score'].forEach(n => {
  const a = run([n], undefined).times, b = run([n], { stretch: 5 }).times;
  ok(n + '：拉伸后时间点个数不变', a.length === b.length);
  let maxErr = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i][2] == null || b[i][2] == null) { if (a[i][2] !== b[i][2]) maxErr = 1e9; continue; }
    maxErr = Math.max(maxErr, Math.abs(b[i][2] - a[i][2] * 5));
  }
  ok(n + '：每个时刻都精确放大 5 倍（误差 ' + maxErr.toExponential(1) + '）', maxErr < 1e-9);
});

/* 收尾时刻也要跟着拉长：拉伸后每发占声部的时间长 5 倍，
   声部记账（voices 按真实 currentTime 剪枝）靠的就是它 —— 记错了会误伤后续发音。
   单独发一个 warn（最长的钟声 0.85s）比对跨度的变化倍率。 */
const span = (n, opt) => {
  const t = run([n], opt).times.filter(x => x[2] != null).map(x => x[2]);
  return Math.max.apply(null, t) - Math.min.apply(null, t);
};
const sPlain = span('warn', undefined), sSlow = span('warn', { stretch: 5 });
ok('慢放让最长的一发明显变长（' + sPlain.toFixed(2) + 's → ' + sSlow.toFixed(2) + 's）', sSlow > sPlain * 4);

console.log((fail === 0 ? '✅' : '❌') + ' 音效拉伸：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
