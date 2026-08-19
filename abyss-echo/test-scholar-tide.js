/* 潮汐学者机制复现：node test-scholar-tide.js */
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

window._menuSelection = ['scholar'];
act('new-game');
state.map.nodes.forEach(n => { n.state = 'cleared'; });
startCombat(['deep_one', 'deep_one']); // 双敌人：总血量足够打完测试序列
const p = state.party[0];
const e = state.combat.enemyGroup[0];
const eHp0 = e.hp;

/* 1. 手牌固定为 3 张攻击牌 + 1 张技能牌 */
p.hand = [
  { uid: state.nextUid++, id: 'scholar_strike' },
  { uid: state.nextUid++, id: 'scholar_strike' },
  { uid: state.nextUid++, id: 'scholar_strike' },
  { uid: state.nextUid++, id: 'scholar_surge' },
];
p.energy = 3;
state.combat.spellsPlayed = [0];

playCard(0, 0, 0); // 深渊弹幕 1（8伤）
playCard(0, 0, 0); // 深渊弹幕 2（8伤）
assert(state.combat.spellsPlayed[0] === 2, `打出2张攻击牌，潮汐计数=2（实际 ${state.combat.spellsPlayed[0]}）`);
assert(e.hp === eHp0 - 16, `两张弹幕共造成16点伤害（实际 ${eHp0 - e.hp}）`);

const eHp2 = e.hp;
const logBefore = state.combat.log.length;
playCard(0, 0, 0); // 深渊弹幕 3 → 触发潮汐爆发
assert(state.combat.spellsPlayed[0] === 3, `打出3张攻击牌，潮汐计数=3`);
const tideLog = state.combat.log.slice(logBefore).find(l => l.includes('【潮汐】'));
assert(!!tideLog, '第3张攻击牌触发【潮汐爆发】日志');
assert(e.hp <= eHp2 - 6, `潮汐爆发额外造成6点伤害（实际 ${eHp2 - e.hp}）`);
console.log('  日志:', tideLog);

/* 2. 技能牌释放（潮汐涌动：+2能量抽1） */
p.energy = 1;
const handAfter = p.hand.length;
playCard(0, 0, 0);
assert(p.energy === 2, `潮汐涌动释放成功：能量 1→2（实际 ${p.energy}）`);
assert(p.hand.length === handAfter - 1 + 1, '潮汐涌动抽1张牌（手牌净减少0）');

/* 3. 第4张攻击牌不触发（4%3≠0） */
const tgtHp = e.hp;
const l2 = state.combat.log.length;
p.hand.unshift({ uid: state.nextUid++, id: 'scholar_strike' });
p.energy = 3;
playCard(0, 0, 0);
assert(!state.combat.log.slice(l2).find(l => l.includes('【潮汐】')), '第4张攻击牌不触发潮汐（4%3≠0）');
assert(e.hp === tgtHp - 7, '第4张弹幕正常造成7点伤害');

console.log('SCHOLAR TIDE OK');
