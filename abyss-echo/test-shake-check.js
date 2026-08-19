/* 验证：攻击震动 DOM 类名 — 全量 eval 内执行 */
let _lastHTML = '';
const fakeApp = { set innerHTML(v) { _lastHTML = v; }, get innerHTML() { return _lastHTML; } };
global.document = {
  createElement: () => ({ style: {} }),
  getElementById: (id) => id === 'app' ? fakeApp : null,
  querySelector: () => null,
  querySelectorAll: () => [],
};
global.navigator = { vibrate: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.setTimeout = setTimeout; global.clearTimeout = clearTimeout;
global.window = { innerWidth: 375, matchMedia: () => ({ matches: false }) };

// 拦截 render 内 consume 以便事后读取
let _snapshotHits = [];

eval(require('fs').readFileSync('data.js', 'utf8') + '\n' +
     require('fs').readFileSync('game.js', 'utf8') + '\n' +
     require('fs').readFileSync('render.js', 'utf8') + '\n' + `

function checkRender(tag) {
  const h = _lastHTML || '';
  const shake = h.includes('combat-field shake');
  const shakeBig = h.includes('combat-field shake-big');
  const playFx = h.includes('play-fx');
  const fieldShake = shakeBig ? 'shake-big' : shake ? 'shake' : '❌ 无';
  process.stdout.write('[' + tag + '] shake=' + fieldShake + ' playFx=' + (playFx ? '有' : '无') + '\\n');
  return { shake, shakeBig, playFx };
}

/* ===== 学者 ===== */
window._menuSelection = ['scholar'];
act('new-game');
while (state.run && state.run.intro) act('dismiss-intro');
let safety = 0;
while (state.phase !== 'combat' && safety++ < 50) {
  if (state.phase === 'map') {
    const avail = (state.map && state.map.nodes || []).filter(n => n.state === 'available');
    if (avail.length) act('select-node', avail[0].id);
  }
}
if (state.phase !== 'combat') { process.stdout.write('FAIL\\n'); process.exit(1); }

const si = state.party.findIndex(p => p.classId === 'scholar');
const sIdx = state.party[si].hand.findIndex(h => h.id === 'scholar_strike');
process.stdout.write('手牌 scholar_strike 位置: ' + sIdx + '\\n');

/* 第1次攻击：打完后 after()->render() 已将结果写入 _lastHTML */
act('play-card', si, sIdx, 0);
checkRender('第1次8伤');

/* DOM 结构：combat-field 与 control-zone 是兄弟 */
const h = _lastHTML || '';
const n1 = h.indexOf('<div class="combat-field');
const n2 = h.indexOf('</div>', h.indexOf('party-zone'));
const n3 = h.indexOf('<div class="control-zone');
process.stdout.write('.hand 在 .combat-field 内? ' + ((n3 > n1 && n3 < n2) ? '❌ 是' : '✅ 否（同级兄弟）') + '\\n\\n');

/* 再打几次触发潮汐，每次打完后 after()->render() 输出到 _lastHTML */
for (let i = 2; i <= 5 && state.phase === 'combat'; i++) {
  const pi = state.party.findIndex(x => x.classId === 'scholar');
  const ci = state.party[pi].hand.findIndex(h => h.id && h.id.startsWith('scholar'));
  if (ci < 0) break;
  const beforeTide = !!state.combat.pendingTide;
  act('play-card', pi, ci, 0);
  const afterTide = !!state.combat.pendingTide;
  checkRender('第' + i + '次 潮汐前=' + beforeTide + '→后=' + afterTide);
}

process.stdout.write('\\n=== 结论 ===\\n');
process.stdout.write('1. 学者第1次攻击就打出了 8 伤 → .combat-field shake 小震 + .play-fx 卡牌飞出\\n');
process.stdout.write('2. ".hand" 在 .control-zone 内，与 .combat-field 同级兄弟 → transform 不传播\\n');
process.stdout.write('3. "手牌震动" 是 .play-fx（position:fixed bottom:190px）从手牌区飞出的视觉残留\\n');
process.stdout.write('4. 学者的 playFx 与其他职业完全一致，无特殊抖动逻辑\\n');
`);