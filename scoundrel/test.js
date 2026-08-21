/* ============================================================
   Scoundrel 规则引擎测试（node test.js）
   ============================================================ */
'use strict';
const G = require('./game.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function eq(a, b, msg) { assert(a === b, msg + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(name) { console.log('\n■ ' + name); }
function craft(seed, patch) { return Object.assign(G.newGame(seed), patch); }
const C = G._internal.makeCard;

/* ---------- 牌组构成 ---------- */
section('牌组构成');
(function () {
  const deck = G.buildDeck();
  eq(deck.length, 44, '共44张');
  eq(deck.filter(c => c.suit === 'H').length, 9, '红桃9张(2~10)');
  eq(deck.filter(c => c.suit === 'D').length, 9, '方片9张(2~10)');
  eq(deck.filter(c => c.suit === 'S').length, 13, '黑桃13张(2~A)');
  eq(deck.filter(c => c.suit === 'C').length, 13, '梅花13张(2~A)');
  assert(!deck.some(c => (c.suit === 'H' || c.suit === 'D') && c.rank > 10), '无红方片JQKA');
  assert(!deck.some(c => c.rank < 2), '无2以下');
  eq(Math.max(...deck.map(c => c.rank)), 14, 'A=14');
  eq(Math.min(...deck.map(c => c.rank)), 2, '最小2');
  // 洗牌随机性：两次不同种子应不同
  const a = G.newGame(1).deck.map(G.cardLabel).join(',');
  const b = G.newGame(2).deck.map(G.cardLabel).join(',');
  assert(a !== b, '不同种子洗牌结果不同');
})();

/* ---------- 开局 ---------- */
section('开局');
(function () {
  const s = G.newGame(42);
  eq(s.hp, 20, '初始血量20');
  eq(s.room.length, 4, '房间4张');
  eq(s.deck.length, 40, '牌堆40张');
  eq(s.phase, 'playing', '进行中');
  eq(s.stats.rooms, 1, '房间计数1');
  eq(G.canKick(s), true, '开局可踢门');
})();

/* ---------- 对决结算 ---------- */
section('对决结算');
(function () {
  // 空手：全额伤害
  let s = craft(1, { room: [C('S', 7)], deck: [] });
  let r = G.act(s, 0);
  eq(r.dmg, 7, '空手伤害=怪物点数');
  eq(s.hp, 13, '空手掉血');
  eq(r.weaponUsed, false, '空手不使用武器');

  // 武器满挡：无损
  s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: null }, room: [C('C', 6)], deck: [] });
  r = G.act(s, 0);
  eq(r.dmg, 0, '武器>=怪物 无损');
  eq(r.blocked, true, '满挡标记');
  eq(s.hp, 20, '不掉血');
  eq(s.weapon.lastFight, 6, '记录更新为6');

  // 武器部分减伤
  s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: null }, room: [C('S', 10)], deck: [] });
  r = G.act(s, 0);
  eq(r.dmg, 2, '部分减伤 10-8=2');
  eq(s.hp, 18, '掉2血');
  eq(s.weapon.lastFight, 10, '记录更新为10');

  // 递减满足：记录10后打9 合法（9<10），部分减伤1
  s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: 10 }, room: [C('C', 9)], deck: [] });
  r = G.act(s, 0);
  eq(r.weaponUsed, true, '9<10 可用武器');
  eq(r.dmg, 1, '9-8=1');
  eq(s.weapon.lastFight, 9, '记录更新为9');

  // 递减限制：记录7后打9 = 违反，按空手结算且记录不变
  s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: 7 }, room: [C('C', 9)], deck: [] });
  r = G.act(s, 0);
  eq(r.dmg, 9, '违反递减按空手全额');
  eq(r.weaponUsed, false, '未使用武器');
  eq(s.weapon.lastFight, 7, '记录不变');
  eq(s.hp, 11, '掉9血');

  // 递减：等于上次记录也违反（严格小于）
  s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: 6 }, room: [C('S', 6)], deck: [] });
  r = G.act(s, 0);
  eq(r.weaponUsed, false, '等于上次记录=违反');

  // 新武器首击无限制
  s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: null }, room: [C('S', 13)], deck: [] });
  r = G.act(s, 0);
  eq(r.weaponUsed, true, '无记录首击可用');
  eq(r.dmg, 5, '13-8=5');

  // 武器收起 = 空手
  s = craft(1, { weapon: { card: C('D', 8), enabled: false, lastFight: 7 }, room: [C('S', 5)], deck: [] });
  r = G.act(s, 0);
  eq(r.dmg, 5, '收起武器全额');
  eq(s.weapon.lastFight, 7, '记录不变');
})();

/* ---------- 装备与切换 ---------- */
section('装备与切换');
(function () {
  // 装备新武器：替换并清空记录
  let s = craft(1, { weapon: { card: C('D', 6), enabled: true, lastFight: 5 }, room: [C('D', 9)], deck: [] });
  let r = G.act(s, 0);
  eq(r.action, 'equip', '方片=装备');
  eq(s.weapon.card.rank, 9, '新武器替换');
  eq(s.weapon.lastFight, null, '新武器记录清空');
  eq(s.weapon.enabled, true, '新武器默认启用');
  eq(s.room.length, 0, '装备牌消耗');
  eq(s.deck.length, 0, '牌堆空');
  eq(s.phase, 'won', '牌堆房间都空=胜利');

  // 反选再勾选：记录不清空（用户确认规则）
  s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: 6 }, room: [C('C', 7)], deck: [] });
  G.toggleWeapon(s);                       // 反选
  eq(s.weapon.enabled, false, '反选收起');
  G.toggleWeapon(s);                       // 再勾选
  eq(s.weapon.enabled, true, '重新启用');
  eq(s.weapon.lastFight, 6, '重新启用不清空记录');
  r = G.act(s, 0);
  eq(r.weaponUsed, false, '记录保留则7>=6违反递减');
  eq(r.dmg, 7, '按空手结算');
  eq(s.weapon.lastFight, 6, '记录仍不变');
  // 记录保留时打更小的怪仍可用
  s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: 6 }, room: [C('S', 5)], deck: [] });
  r = G.act(s, 0);
  eq(r.weaponUsed, true, '5<6 可用武器');
  eq(r.dmg, 0, '满挡');
})();

/* ---------- 武器击杀记录 ---------- */
section('武器击杀记录');
(function () {
  // 武器击杀记入 kills
  let s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: null }, room: [C('C', 6)], deck: [] });
  let r = G.act(s, 0);
  eq(r.weaponUsed, true, '武器击杀');
  eq(s.weapon.kills.length, 1, '记入1次击杀');
  eq(s.weapon.kills[0].suit, 'C', '击杀牌花色');
  eq(s.weapon.kills[0].rank, 6, '击杀牌点数');

  // 多次击杀按顺序追加
  s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: null, kills: [C('C', 5)] }, room: [C('S', 4)], deck: [] });
  G.act(s, 0);
  eq(s.weapon.kills.length, 2, '追加击杀');
  eq(s.weapon.kills[1].rank, 4, '新击杀在后');

  // 空手（违反递减）不记入
  s = craft(1, { weapon: { card: C('D', 8), enabled: true, lastFight: 7, kills: [C('C', 5)] }, room: [C('C', 9)], deck: [] });
  r = G.act(s, 0);
  eq(r.weaponUsed, false, '违反递减空手');
  eq(s.weapon.kills.length, 1, '空手不记入');

  // 收起武器不记入
  s = craft(1, { weapon: { card: C('D', 8), enabled: false, lastFight: 7, kills: [C('C', 5)] }, room: [C('S', 2)], deck: [] });
  r = G.act(s, 0);
  eq(r.weaponUsed, false, '收起武器空手');
  eq(s.weapon.kills.length, 1, '收起不记入');

  // 装备新武器清空击杀
  s = craft(1, { weapon: { card: C('D', 6), enabled: true, lastFight: 5, kills: [C('C', 5)] }, room: [C('D', 9)], deck: [] });
  G.act(s, 0);
  eq(s.weapon.kills.length, 0, '新武器清空击杀');
  eq(s.weapon.lastFight, null, '新武器清空记录');

  // 老存档（无 kills 字段）反序列化补齐
  let old = JSON.stringify({ hp: 15, deck: [], room: [], weapon: { card: C('D', 8), enabled: true, lastFight: 6 }, potionUsed: false, kickBanned: false, phase: 'playing', stats: { kills: 1, rooms: 2, kicks: 0 } });
  let restored = G.deserialize(old);
  eq(Array.isArray(restored.weapon.kills), true, '老存档补齐 kills');
  eq(restored.weapon.kills.length, 0, '老存档击杀为空');
})();

/* ---------- 简易模式 ---------- */
section('简易模式');
(function () {
  // 卡组扩容
  let d = G.buildDeck(true);
  eq(d.length, 52, '简易模式 52 张');
  eq(d.filter(c => c.suit === 'H' && c.rank >= 11).length, 4, '含 ♥JQKA');
  eq(d.filter(c => c.suit === 'D' && c.rank >= 11).length, 4, '含 ♦JQKA');
  eq(d.filter(c => c.suit === 'S').length, 13, '黑桃仍13张');
  eq(G.buildDeck(false).length, 44, '普通模式 44 张');

  // 开局状态
  let s = G.newGame(1, true);
  eq(s.hp, 20, '简易初始血量 20');
  eq(s.maxHp, 20, '简易血量上限与常规一致 20');
  eq(s.deck.length, 48, '简易牌堆 48（52-4房）');
  eq(G.newGame(1, false).maxHp, 20, '普通上限 20');

  // 恢复上限 20（与常规一致）
  s = craft(1, { hp: 19, room: [C('H', 5)], deck: [] });
  let r = G.act(s, 0);
  eq(s.hp, 20, '简易可恢复到 20');
  eq(r.hpGain, 1, '恢复量正确');
  s = craft(1, { hp: 19, maxHp: 20, room: [C('H', 6)], deck: [] });
  G.act(s, 0);
  eq(s.hp, 20, '恢复不超 20');

  // 普通模式仍以 20 为上限
  s = craft(1, { hp: 19, room: [C('H', 5)], deck: [] });
  G.act(s, 0);
  eq(s.hp, 20, '普通模式上限仍 20');

  // 老存档反序列化补 maxHp
  let old = JSON.stringify({ hp: 15, deck: [], room: [], weapon: null, potionUsed: false, kickBanned: false, phase: 'playing', stats: { kills: 0, rooms: 1, kicks: 0 } });
  let restored = G.deserialize(old);
  eq(restored.maxHp, 20, '老存档 maxHp 默认 20');
  // 旧简易存档（曾有过更高上限）也被统一为 20
  old = JSON.stringify({ hp: 25, maxHp: 30, deck: [], room: [], weapon: null, potionUsed: false, kickBanned: false, phase: 'playing', stats: { kills: 0, rooms: 1, kicks: 0 } });
  restored = G.deserialize(old);
  eq(restored.maxHp, 20, '旧简易存档 maxHp 修正为 20');
  eq(restored.hp, 20, '血量钳制到 20');
})();

/* ---------- 血瓶 ---------- */
section('血瓶');
(function () {
  // 第一瓶生效
  let s = craft(1, { hp: 10, room: [C('H', 7)], deck: [] });
  let r = G.act(s, 0);
  eq(r.hpGain, 7, '第一瓶回复7');
  eq(s.hp, 17, '血量17');

  // 第二瓶无效
  s = craft(1, { hp: 10, potionUsed: true, room: [C('H', 7)], deck: [] });
  r = G.act(s, 0);
  eq(r.hpGain, 0, '第二瓶回复0');
  eq(s.hp, 10, '血量不变');

  // 上限20
  s = craft(1, { hp: 19, room: [C('H', 5)], deck: [] });
  r = G.act(s, 0);
  eq(s.hp, 20, '上限20，回复不超');
  eq(r.hpGain, 1, '实际回复1');

  // 房间更替重置血瓶计数
  s = craft(1, { hp: 5, potionUsed: true, room: [C('H', 6), C('S', 2)], deck: [] });
  G.act(s, 1); // 打掉怪物 → 房间剩1张 → 自动补牌（新房间，重置血瓶）
  eq(s.potionUsed, false, '补牌进入新房间后血瓶计数重置');
  r = G.act(s, 0);
  eq(r.hpGain, 6, '新房间第一瓶生效');
})();

/* ---------- 补牌与房间流程 ---------- */
section('补牌与房间流程');
(function () {
  // 剩1张自动补到4张，旧牌保留
  let s = craft(1, { room: [C('S', 3), C('S', 4)], deck: [C('C', 5), C('C', 6), C('C', 7)] });
  G.act(s, 0); // 打掉一张 → 剩1张 → 补牌
  eq(s.room.length, 4, '补到4张(1旧+3新)');
  eq(s.room[0].rank, 4, '旧牌保留在第0位');
  eq(s.deck.length, 0, '牌堆清空');

  // 牌堆空不补：最后一张打掉=胜利
  s = craft(1, { room: [C('S', 3)], deck: [] });
  G.act(s, 0);
  eq(s.phase, 'won', '牌堆+房间都空=胜利');

  // 牌堆空房间2张：继续打
  s = craft(1, { room: [C('S', 3), C('S', 4)], deck: [] });
  G.act(s, 0);
  eq(s.phase, 'playing', '牌堆空但房间有牌继续');
  eq(s.room.length, 1, '房间剩1');
})();

/* ---------- 踢门 ---------- */
section('踢门');
(function () {
  // 基本踢门
  let s = craft(1, { room: [C('S', 2), C('S', 3), C('S', 4), C('S', 5)], deck: [C('C', 6), C('C', 7), C('C', 8), C('C', 9)] });
  let r = G.kick(s);
  eq(r.ok, true, '踢门可用');
  eq(s.room.length, 4, '踢门后房间4张');
  eq(s.deck.length, 4, '牌堆数量不变(4入底4出顶)');
  eq(s.kickBanned, true, '踢门后禁止下一次');
  eq(G.canKick(s), false, '当前房间不能再踢');
  assert(s.room.every(c => c.suit === 'C'), '踢门后房间为牌堆顶新牌');
  assert(s.deck.every(c => c.suit === 'S'), '旧房间牌在牌堆底部');

  // 连续限制：下一次补牌房间不能踢，再下一次恢复
  // 用点数小的怪避免测试中被打死；牌堆多留牌保证补牌后仍可踢
  s = craft(1, { room: [C('S', 2), C('S', 3), C('S', 4), C('S', 5)], deck: [C('C', 2), C('C', 3), C('C', 4), C('C', 5), C('C', 6), C('C', 7)] });
  G.kick(s);
  eq(G.canKick(s), false, '踢门后本房间不能再踢');
  G.act(s, 0); G.act(s, 0); G.act(s, 0); // 打到剩1张 → 补牌进入下一房间
  eq(s.kickBanned, false, '禁令在下一房间被消耗');
  eq(G.canKick(s), true, '下一房间可踢(房间4张且牌堆>0)');
  // 紧接着连续踢：第一次成功，第二次被拒
  eq(G.kick(s).ok, true, '该房间踢门成功');
  r = G.kick(s);
  eq(r.ok, false, '连续踢门被拒绝');

  // 房间不满4张不能踢
  s = craft(1, { room: [C('S', 2), C('S', 3), C('S', 4)], deck: [C('C', 6)] });
  r = G.kick(s);
  eq(r.ok, false, '3张不能踢');

  // 牌堆空不能踢
  s = craft(1, { room: [C('S', 2), C('S', 3), C('S', 4), C('S', 5)], deck: [] });
  r = G.kick(s);
  eq(r.ok, false, '牌堆空不能踢');

  // 牌堆只剩1张也能踢：旧4张入底后总能翻满4张
  s = craft(1, { room: [C('S', 2), C('S', 3), C('S', 4), C('S', 5)], deck: [C('C', 6)] });
  r = G.kick(s);
  eq(s.room.length, 4, '踢门后房间仍4张');
  eq(s.deck.length, 1, '牌堆剩1张');
})();

/* ---------- 胜负判定 ---------- */
section('胜负判定');
(function () {
  let s = craft(1, { hp: 5, room: [C('S', 5)], deck: [] });
  G.act(s, 0);
  eq(s.hp, 0, '血量归0');
  eq(s.phase, 'lost', '失败');
  eq(G.act(s, 0).ok, false, '失败后不能操作');

  s = craft(1, { hp: 6, room: [C('S', 5), C('S', 2)], deck: [C('C', 3)] });
  G.act(s, 0); // 掉5血 → 1血
  G.act(s, 0); // 打2 → -1 → 失败（虽然牌没打完）
  eq(s.phase, 'lost', '血量<=0立即失败');

  // 胜利后不能操作
  s = craft(1, { room: [C('S', 2)], deck: [] });
  G.act(s, 0);
  eq(s.phase, 'won', '胜利');
  eq(G.act(s, 0).ok, false, '胜利后不能操作');
})();

/* ---------- 序列化 ---------- */
section('序列化');
(function () {
  const s = G.newGame(7);
  G.act(s, 0);
  const s2 = G.deserialize(G.serialize(s));
  eq(JSON.stringify(s), JSON.stringify(s2), '存档还原一致');
  eq(G.deserialize('null'), null, '坏存档返回null');
})();

console.log(`\n========== ${passed} passed, ${failed} failed ==========`);
process.exit(failed ? 1 : 0);
