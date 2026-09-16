/* ============================================================
   空过提示场景演示（「跳过行动」卡片）—— 浏览器控制台脚本
   用法：浏览器打开 index.html → F12 控制台 → 整段粘贴本文件 → 回车
   变体（先设好再粘贴）：
     window.__DEMO_AI = true           AI 回合版（卡片点名「黑方（AI）」）
     window.__DEMO_CAUSE = 'trapped'   成因二：焦点时空有子却无路可走
   演示会重开一局（覆盖当前存档，原档自动备份到 …-state-backup）；
   看够了点「重开」或刷新即回正常对局。
   ============================================================ */
(() => {
  const UI = window.TTYKM_UI, G = window.TTYKM;
  if (!UI || !G) { console.warn('请先在浏览器打开 that_time_you_killed_me/index.html，再粘贴运行'); return; }
  const wantAi = !!window.__DEMO_AI;
  const trapped = window.__DEMO_CAUSE === 'trapped';

  // 备份演示前的存档（仅首次；恢复：见文末提示）
  const BK = UI.saveKey + '-backup';
  const cur = localStorage.getItem(UI.saveKey);
  if (cur && !localStorage.getItem(BK)) localStorage.setItem(BK, cur);

  UI.startGame(wantAi ? 'ai' : 'local2p', []);          // 干净开局：确定 mode 与 aiSide
  const me = wantAi ? UI.aiSide() : 0;                  // 空过方（双人演示固定为黑方）
  const foe = 1 - me;

  const S = G.newGame(wantAi ? 'ai' : 'local2p', () => 0);   // 固定随机源 → 局面确定
  for (const b of S.boards) b.cell.fill(null);
  S.turn = me; S.focus = [2, 2]; S.focus[me] = 0;       // 空过方焦点钉在「过去」
  S.spares = [4, 4]; S.dead = [0, 0];
  S.stage = 'focus'; S.sel = null; S.acted = 0; S.over = null; S.log.length = 0;
  S.skip = true;                                        // ← 提示卡由此亮起
  const put = (e, i, c) => { S.boards[e].cell[i] = { c }; };
  if (trapped) {          // 成因二：0 号己子被自子 1/4 与对方子围死（不能移动、不能穿越）
    put(0, 0, me); put(0, 1, me); put(0, 4, me); put(0, 5, foe);
    put(1, 0, foe); put(1, 10, me); put(2, 10, me); put(2, 11, foe);
  } else {                // 成因一：焦点「过去」干脆没有己方棋子
    put(1, 5, me); put(2, 10, me);
    put(0, 1, foe); put(1, 3, foe); put(2, 15, foe);
  }
  S.log.push({ no: 1, p: me, text: G.NAMES[me] + '新回合焦点时空无子，将自动空过' });

  UI.setState(S);   // 定格注入：卡片约 2.4s 淡出后画面停在移焦点阶段；想接着看 AI 动，改成 UI.setState(S, { live: true })
  console.log('空过场景已就绪：看「过去」棋盘上缘的「跳过行动」卡片、底部面板与提示条（想看两种成因/点名文案，改 window.__DEMO_AI / __DEMO_CAUSE 后重跑）');
  console.log('恢复正常对局：点「重开」或刷新页面。恢复演示前存档：localStorage.setItem("' + UI.saveKey + '", localStorage.getItem("' + BK + '")) 后刷新');
})();
