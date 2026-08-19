/* 逻辑冒烟测试：node test-sim.js
 * 用 DOM stub 加载 data.js + game.js，AI 自动走完整流程直到胜负 */
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
global.showToast = msg => { if (process.env.VERBOSE) console.log('[TOAST]', msg); };
global.render = () => {};

vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), { filename: 'data.js' });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8'), { filename: 'game.js' });

let steps = 0;
function step() {
  if (++steps > 5000) throw new Error('步数超限，疑似死循环: phase=' + state.phase + ' subPhase=' + state.subPhase);
}
function firstAvailable() {
  return state.map.nodes.find(n => n.state === 'available');
}
function autoPlay() {
  for (let i = 0; i < 200 && steps < 5000; i++) {
    step();
    if (state.phase === 'defeat' || state.phase === 'victory') return state.phase;
    switch (state.phase) {
      case 'menu': act('new-game'); break;
      case 'map': {
        const n = firstAvailable();
        if (!n) { act('return-menu'); break; }
        act('select-node', n.id);
        break;
      }
      case 'combat': {
        if (state.subPhase === 'enemy') { stepEnemyAct(); break; } // 敌方分步行动：AI 同步推进
        if (state.combat.pendingWin) { stepKillSettle(); break; } // 击杀演出结束：结算奖励
        if (state.combat.pendingCard) {
          const pc = state.combat.pendingCard;
          const def = cdef(state.party[pc.playerIdx].hand[pc.handIdx]);
          const tgt = def.target === 'ally' ? state.party.findIndex(p => !p.dead) : 0;
          act('play-card', pc.playerIdx, pc.handIdx, tgt);
          break;
        }
        let played = false;
        for (let pi = 0; pi < state.party.length; pi++) {
          const p = state.party[pi];
          if (p.dead) continue;
          for (let hi = 0; hi < p.hand.length; hi++) {
            const d = cdef(p.hand[hi]);
            if (d.cost <= p.energy) {
              if (d.target === 'enemy' || d.target === 'ally') {
                const tgt = d.target === 'ally' ? state.party.findIndex(x => !x.dead) : 0;
                act('play-card', pi, hi, tgt);
              } else {
                act('play-card', pi, hi, -1);
              }
              played = true;
              break;
            }
          }
          if (played) break;
        }
        if (!played) act('end-turn');
        break;
      }
      case 'reward': {
        if (state.reward.pendingCardIdx !== null) {
          act('reward-give', state.party.findIndex(p => !p.dead));
          break;
        }
        if (state.reward.cards.length) { act('pick-reward-card', 0); break; }
        act('skip-reward');
        break;
      }
      case 'shop': {
        if (state.shop.removeMode) { act('leave-map-node'); break; }
        if (state.shop.confirmIdx !== null) { act('buy-confirm'); break; }
        if (state.shop.pendingBuyIdx !== null) {
          act('buy-give', 0);
          break;
        }
        const buyable = state.shop.items.findIndex(it => !it.sold && it.kind !== 'heal' && it.price <= state.run.gold);
        if (buyable >= 0) act('buy-shop-item', buyable);
        else act('leave-map-node');
        break;
      }
      case 'event': {
        if (state.event.chosen === null) {
          const def = EVENTS[state.event.defId];
          let picked = false;
          for (let oi = 0; oi < def.options.length; oi++) {
            const opt = def.options[oi];
            if (opt.eff.t === 'goldPay' && state.run.gold < opt.eff.n) continue;
            act('pick-event-option', oi);
            picked = true;
            break;
          }
          if (!picked) act('leave-map-node');
        } else act('leave-map-node');
        break;
      }
      case 'rest': {
        if (state.rest && state.rest.usedHeal) { act('leave-map-node'); break; }
        act('rest-heal');
        break;
      }
      case 'gameover': act('return-menu'); break;
      default: throw new Error('未知 phase: ' + state.phase);
    }
  }
  return state.phase;
}

function jsonCheck() {
  // 联机前提：state 可完整 JSON 序列化且无函数
  const s = JSON.stringify(state);
  if (!s) throw new Error('state 无法 JSON 序列化');
  if (/function|=>/.test(s)) throw new Error('state 中出现函数！');
}

function runSuite(sel, label, maxRuns) {
  let wins = 0;
  let endPhases = {};
  let maxFloor = 0;
  for (let i = 0; i < maxRuns; i++) {
    steps = 0;
    window._menuSelection = sel;
    init();
    const end = autoPlay();
    endPhases[end] = (endPhases[end] || 0) + 1;
    if (end === 'victory') wins++;
    maxFloor = Math.max(maxFloor, state.run ? state.run.floor : 0);
    jsonCheck();
  }
  console.log(`[${label}] ${maxRuns}局 → 胜利${wins} 结果分布:`, JSON.stringify(endPhases), '最深层数:', maxFloor);
}

runSuite(['warder'], '单人·守望者', 6);
runSuite(['scholar'], '单人·潮汐学者', 6);
runSuite(['hunter'], '单人·深渊猎手', 6);
runSuite(['healer'], '单人·圣汐医者', 6);
runSuite(['warder', 'healer', 'hunter', 'scholar'], '四人小队', 8);
console.log('LOGIC SMOKE OK');
