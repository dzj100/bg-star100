/* 净化机制专项验证：node test-purify.js */
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
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('PASS:', msg);
}

window._menuSelection = ['healer', 'warder'];
init();
act('new-game');

const healer = state.party[0];
assert(healer.classId === 'healer', '创建圣汐医者');
const deckIds = healer.deck.map(c => c.id);
assert(deckIds.includes('healer_purify'), '初始卡组包含净化之潮: ' + deckIds.join(','));
assert(deckIds.filter(x => x === 'healer_purify').length === 1, '净化之潮恰好1张');
assert(deckIds.filter(x => x === 'healer_sooth').length === 2, '圣汐抚慰2张');
assert(deckIds.filter(x => x === 'healer_bolt').length === 3, '圣光弹3张（医者具备攻击能力）');

const washDef = cdef({ id: 'healer_wash' });
assert(!!washDef, '圣汐洗涤卡定义存在');
assert(washDef.effects[0].t === 'removeDebuffAll', '圣汐洗涤效果为 removeDebuffAll');

/* 构造战斗场景：给队友上中毒，打出净化卡验证能量+1 */
state.party.forEach(p => { p.dead = false; p.hp = p.maxHp; });
startCombat(['deep_one']); // 进入战斗
const p0 = state.party[0];
// 直接把圣汐洗涤塞进手牌（手牌随机，避免测试不稳定）
p0.hand.push({ uid: 999, id: 'healer_wash' });
const idx = p0.hand.findIndex(c => c.id === 'healer_wash');
assert(idx >= 0, '手牌中有圣汐洗涤');

const mate = state.party[1];
mate.buffs.poison = 3;
const cost = cdef(p0.hand[idx]).cost;
const energyBefore = p0.energy;
if (cost > p0.energy) p0.energy = cost;
act('play-card', 0, idx, 1); // 目标是队友(索引1)
assert(mate.buffs.poison === 2, '全队各移除1层中毒(队友)');
assert(p0.energy === energyBefore - cost + 1, `成功移除debuff→净化+1能量 (${energyBefore}→${p0.energy})`);

/* 无debuff时打出不应触发净化 */
state.party.forEach(p => { for (const k in p.buffs) p.buffs[k] = 0; });
p0.hand.push({ uid: 1000, id: 'healer_wash' });
const idx2 = p0.hand.findIndex(c => c.id === 'healer_wash');
const eb2 = p0.energy;
if (cost > p0.energy) p0.energy = cost;
act('play-card', 0, idx2, 1);
assert(p0.energy === eb2 - cost, `无debuff可移除时不触发净化 (${eb2}→${p0.energy})`);

console.log('PURIFY TEST DONE');
