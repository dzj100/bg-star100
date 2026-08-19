/* 敌人护甲持续验证：node test-enemy-block.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mem = {};
global.window = global;
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; },
};
global.document = { getElementById: () => ({ innerHTML: '' }) };
global.showToast = () => {};
global.render = () => {};

vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), { filename: 'data.js' });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8'), { filename: 'game.js' });

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else console.log('PASS: ' + msg);
}

/* 1. 开局单人（守望者） */
window._menuSelection = ['warder'];
act('new-game');
assert(state.phase === 'map', '进入地图');

/* 2. 注入一场 vs 深潜者（意图循环：攻击6 → 攻击6 → 护盾8 → 虚弱） */
state.map.nodes.forEach(n => { n.state = 'cleared'; });
startCombat(['deep_one']);
assert(state.phase === 'combat' && state.combat.turn === 1, '战斗开始，回合1');

/* 3. 直接推进到深潜者的第3个意图（护盾8）：跳过前2个敌方回合 */
function passEnemyTurn() {
  // 结束当前玩家回合 → 敌方逐个行动 → 同步模拟定时器补一步回合结算 → 回到 play
  act('end-turn');
  stepEnemyAct();
}
function enemyBlock() { return state.combat.enemyGroup[0].block; }

// 回合1：玩家直接结束（不攻击）→ 深潜者意图1（攻击6）→ 回合2
passEnemyTurn();
assert(state.combat.turn === 2, '进入回合2（深潜者已攻击一次）');
// 回合2：玩家结束 → 深潜者意图2（攻击6）→ 回合3
passEnemyTurn();
assert(state.combat.turn === 3, '进入回合3（深潜者已攻击两次）');
// 回合3：玩家结束 → 深潜者意图3（护盾8）
passEnemyTurn();
assert(state.combat.turn === 4, '进入回合4（深潜者已释放护盾）');
assert(enemyBlock() === 8, `护盾8持续到玩家回合（当前 ${enemyBlock()}）`);

/* 4. 玩家攻击深潜者，护甲应抵挡伤害 */
const p = state.party[0];
const dmgCardIdx = p.hand.findIndex(hi => {
  const d = cdef(hi);
  return d.type === 'attack' && d.cost <= p.energy && d.target === 'enemy';
});
assert(dmgCardIdx >= 0, '手牌中有可用的攻击牌');
const hpBefore = state.combat.enemyGroup[0].hp;
const d = cdef(p.hand[dmgCardIdx]);
const raw = d.effects.find(e => e.t === 'damage').n;
act('play-card', 0, dmgCardIdx, 0);
const blocked = Math.min(8, raw);
assert(state.combat.enemyGroup[0].hp === hpBefore + (raw > 8 ? 0 : 0) - Math.max(0, raw - 8),
  `攻击 ${raw} 被护甲抵挡，剩余护甲 ${enemyBlock()}，敌人掉血 ${hpBefore - state.combat.enemyGroup[0].hp}（应 ${Math.max(0, raw - 8)}）`);
assert(enemyBlock() === Math.max(0, 8 - raw), `剩余护甲 ${enemyBlock()}（应 ${Math.max(0, 8 - raw)}）`);

/* 5. 下一回合敌人行动前护甲清零 */
passEnemyTurn();
assert(enemyBlock() === 0, `敌人行动前护甲清零（当前 ${enemyBlock()}）`);

if (!process.exitCode) console.log('ENEMY BLOCK OK');
