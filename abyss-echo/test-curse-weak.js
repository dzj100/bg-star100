/* 验证：虚弱叠加（问题1）与诅咒结算（问题2） */
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

const origLog = console.log;
let dmgSteps = [];
console.log = (...a) => {
  const s = a.join(' ');
  if (s.includes('[伤害结算]')) dmgSteps.push(s);
  if (s.includes('诅咒')) process.stdout.write('  ' + s + '\n');
};

eval(require('fs').readFileSync('data.js', 'utf8') + '\n' +
     require('fs').readFileSync('game.js', 'utf8') + '\n' +
     require('fs').readFileSync('render.js', 'utf8') + '\n' + `

let pass = true;
function assert(cond, msg) {
  process.stdout.write((cond ? '✅ ' : '❌ ') + msg + '\\n');
  if (!cond) pass = false;
}

/* ===== 进入战斗 ===== */
window._menuSelection = ['warder'];
act('new-game');
while (state.run && state.run.intro) act('dismiss-intro');
let safety = 0;
while (state.phase !== 'combat' && safety++ < 50) {
  if (state.phase === 'map') {
    const avail = (state.map && state.map.nodes || []).filter(n => n.state === 'available');
    if (avail.length) act('select-node', avail[0].id);
  }
}
if (state.phase !== 'combat') { process.stdout.write('FAIL 未进入战斗\\n'); process.exit(1); }
const p = state.party[0];
const e = state.combat.enemyGroup[0];

/* ===== 测试1：虚弱叠加 ===== */
process.stdout.write('\\n--- 虚弱叠加（敌人攻击玩家） ---\\n');
e.buffs.weak = 2; // 敌人2层虚弱
e.buffs.strength = 0; e.buffs.rage = 0;
p.block = 0;
const p0hpBefore = p.hp;
dealDamage(p, 6, { enemy: e }); // 敌人攻击玩家6伤
const pDmg = p0hpBefore - p.hp;
const expectDmg = Math.floor(6 * (1 - 0.2 * 2)); // 0.6 → 3
assert(pDmg === expectDmg, '2层虚弱：敌人攻击应×0.6（6伤→3），实际' + pDmg + '伤');
const last = dmgSteps[dmgSteps.length - 1] || '';
assert(last.includes('虚弱×0.6'), '结算日志显示 虚弱×0.6：' + last);

/* ===== 测试2：诅咒结算 ===== */
process.stdout.write('\\n--- 诅咒结算 ---\\n');
// 直接给玩家挂2层诅咒，模拟狂信徒意图
p.buffs.curse = 2;
const pHpBefore = p.hp;
p.hand.push({ uid: state.nextUid++, id: 'warder_strike' });
p.energy = 5;
const cIdx = p.hand.findIndex(h => h.id === 'warder_strike');
act('play-card', 0, cIdx, 0);
assert(p.hp === pHpBefore - 2, '打出攻击牌损失2血（诅咒2层），实际扣' + (pHpBefore - p.hp));

/* ===== 测试3：狂信徒意图含诅咒 ===== */
process.stdout.write('\\n--- 狂信徒意图 ---\\n');
const fan = ENEMIES.fanatic;
assert(fan.intents.some(i => i.t === 'debuff' && i.status === 'curse'), '狂信徒意图含 debuff curse');

/* ===== 测试4：净化可移除诅咒 ===== */
process.stdout.write('\\n--- 净化移除诅咒 ---\\n');
p.buffs.curse = 1;
const curseKeys = BUFF_KEYS.filter(k => BUFF_META[k].kind === 'debuff' && (p.buffs[k] || 0) > 0);
assert(curseKeys.includes('curse'), '诅咒在可净化 debuff 列表中');

process.stdout.write('\\n' + (pass ? 'ALL PASS' : 'SOME FAIL') + '\\n');
process.exit(pass ? 0 : 1);
`);

console.log = origLog;
