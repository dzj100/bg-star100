# 同词相遇 · 并行开发接口契约（内部）

> 3 个 agent 并行写不同文件，必须严格遵守本契约；`SPEC.md` 是产品规则唯一来源。
> 若实现中确实需要改契约，先在自己的交付说明里写明，不要擅自改别人的文件或接口。

## 0. 文件所有权

| Agent | 独占文件 | 禁止修改 |
|---|---|---|
| Core | `game.js`, `test-core.js` | 其他所有文件 |
| Net | `net.js`, `online.js`, `supabase.min.js`（从 `../take-time/` 复制） | 其他所有文件 |
| UI | `index.html`, `style.css`, `render.js` | 其他所有文件 |
| 集成 | 以上全部 + 根目录 `index.html` 的 GAMES 条目 + `test-e2e.js` | 仅在三个 agent 完成后介入 |

- 无构建步骤、无框架、无 npm 依赖。浏览器 ES2017+；`node --check` 必须通过。
- 代码注释从简。UI 文案用中文，严格按 `SPEC.md` 的措辞。
- 不提交 git，不删 `SPEC.md`。

## 1. 全局命名空间

- `window.SWG`：纯游戏规则（`game.js`，不碰 DOM，不在加载时读 `document`）。
- `window.SWR`：界面控制器（`render.js`），持有全局 `S`（当前共享状态）、等待室视图、本地界面状态。
- `window.SWN`：联机控制器（`online.js`），持有房间/座位/会话，不直接画 DOM。
- 脚本顺序：`game.js → render.js → supabase.min.js → net.js → online.js`，最后一段内联脚本初始化。

## 2. 共享状态 `S`（由 `SWG` 创建/修改，`SWR` 持有）

```js
S = {
  schema: 1,
  mode: 'duel' | 'party',
  settings: { timeLimit: 0|15|30|60, roundLimit: 10|15|20 }, // roundLimit 仅 party
  seatNames: ['阿山','小海','橙子'],   // 开局快照；离开者仍可显示
  phase: 'playing' | 'reveal' | 'finished',
  gameNo: 1,
  round: 1,
  subs: { 0: { word: '西瓜', at: 1710000000000, done: true, round: 1 } },
  deadline: 1710000015000 | null,       // 房主时钟；0 不限时为 null
  hostNow: 1710000000000,
  history: [{ round: 1, words: ['西瓜',''], pairs: [{a:0,b:2,kind:'exact'|'agree'}], all: false }],
  decisions: { 0: { value: 'same'|'next', at } },           // duel reveal
  claims: { 0: { 2: { on: true, at } } },                   // party 有向认证（关闭也要留 {on:false,at} 墓碑）
  ready: { 0: { on: true, at } },                           // party reveal
  rematch: { 0: { on: true, at } },                         // finished
  result: null | 'match' | 'agree' | 'giveup' | 'limit' | 'allmatch',
  resultBy: 0 | null,
  departed: [2],
  rev: 12, _ts: 1710000000000, _pushId: '0-1710000000000-12',
};
```

- 座位号 0..seatNames.length-1；房主永远 seat 0。
- 所有 `at` 都是写入者本地 `Date.now()`，只用于同座位新旧比较。
- `subs` 只由该座位本人写；房主只在超时/离席时代填空词。
- 重复词允许；不设历史词禁池。
- 词归一化：`NFKC → toLowerCase → 去掉所有空白与标点（\p{P} 及 ~～·…）`；归一化后必须非空且至少含一个 `\p{L}` 或 `\p{N}`；长度 1~10 个 Unicode 码点（按归一化后的词计）。展示保留原输入。
- 昵称 1~12 码点，仅空白拒绝，允许重名。

## 3. `SWG`（game.js）必需 API

```js
SWG.MODES = { DUEL:'duel', PARTY:'party' };
SWG.SEAT_COLORS = ['#2F6B4F','#2A9D8F','#E8733A','#8C5A9E'];
SWG.TIME_OPTIONS = [0,15,30,60];
SWG.PARTY_ROUNDS = [10,15,20];
SWG.LIMITS = { WORD:10, NAME:12, MIN_PARTY_ROUNDS:5, MAX_PARTY_ROUNDS:50 };
SWG.minPlayers(mode);                    // duel 2, party 3

SWG.normalizeWord(raw);                  // 归一化字符串
SWG.charLen(raw);                        // 码点数（Array.from）
SWG.validateWord(raw);                   // {ok:true,word,display} | {ok:false,error:'EMPTY'|'ONLY_SYMBOL'|'TOO_LONG'}
SWG.validateName(raw);                   // {ok:true,name} | {ok:false,error}

SWG.createState({mode, settings, seatNames, now});          // 新局，round=1，phase=playing，rev=1
SWG.startRound(S, now);                                     // 房主：round++，重置 subs/decisions/claims/ready，设 deadline/hostNow
SWG.restartGame(S, now);                                    // 房主：gameNo++，清 history/result/decisions/claims/ready/rematch，round=1
SWG.submit(S, seat, rawWord, at);                           // {ok:true,word} | {ok:false,error}
SWG.submitEmpty(S, seat, at);                               // 超时自动空提交 / 房主代填
SWG.withdraw(S, seat, at);                                  // 撤回重写：done:false, at 刷新
SWG.fillMissing(S, at);                                     // 房主：给本轮缺交的活跃座位补空词；返回补的座位数组
SWG.allDone(S);                                             // 活跃座位本轮全部 done
SWG.allReady(S);                                            // party 活跃座位全部 ready
SWG.allRematch(S);                                          // finished 后活跃座位全部 rematch
SWG.isActive(S, seat);
SWG.activeSeats(S);
SWG.markDeparted(S, seat, at);                              // 记入 departed，补空提交，清 ready/decision

SWG.finalizeRound(S, now);                                  // 房主：写 history，算 exact pairs/all；duel 撞词→result=match+finished；party 全员同词→allmatch+finished；否则 reveal
SWG.duelDecide(S, seat, value, at);                         // {resolved:null|'next'|'agree'}；双方都表态后才返回 next/agree；两者 same 时写 agree pair
SWG.toggleClaim(S, from, to, at);                           // party 有向认证，关闭写 {on:false,at}
SWG.syncPairs(S);                                           // 重算本轮 last history 的 exact + 双向 agree
SWG.setReady(S, seat, on, at);
SWG.toggleRematch(S, seat, at);
SWG.disableRematch(S, seat);                                // 结算页离席/人数不足时清理

// 房主时钟推进（只房主调用；有变化返回 true）
SWG.hostTick(S, now);   // playing: allDone/超时+3000ms → finalizeRound（同轮幂等）
                        // reveal duel: 双方都表态后，全部 same → agree+finished；否则 startRound（未全员表态则等待）
                        // reveal party: allReady → 满局 limit / 否则 startRound
                        // finished: allRematch → restartGame
                        // 任意阶段活跃人数 < minPlayers → giveup+finished（房主 resultBy=0）

SWG.finish(S, result, by, now);                             // 置 result/resultBy/phase=finished/deadline=null
SWG.duelLevel(rounds, result);                              // {t:'称号', q:'描述'}（边界按 SPEC §3.6）
SWG.partyStats(S, meSeat);                                  // {scores:[{seat,score}], pairs, best, topSeats, myScore, myBest, rounds}
SWG.rankTitles(scores);                                     // {special:null|string, list:[{rank,title,tag,seats}]}
SWG.cpTitle(count);                                         // party 个人 CP 数称号

// 网络合并（纯函数，不 mutate 入参）
SWG.mergeState(local, remote, {seat, isHost});
// 规则：
// - host 字段（mode/settings/seatNames/phase/round/history/deadline/hostNow/result/resultBy/departed/gameNo）：
//   isHost ? local : remote。
// - 若 remote.gameNo/round 与 local 不同，丢弃 local 的轮次字段（subs/decisions/claims/ready），以 remote 为准。
// - 同轮内：subs/decisions/ready/rematch 按座位比较 at，新者胜；claims 按 from→to 比较 at。
// - 自己座位的字段 local 较新时保留（成员乐观提交）；其他座位以 remote 为准。
// - rev/_ts/_pushId 用 remote（由 SWN 递增后写入）。
```

实现补充（Core agent 已落地）：`duelDecide` 返回 `{resolved:null|'next'|'agree', error?}`；`toggleClaim`/`setReady` 返回 `{ok,on|error}`；`hostTick`/`finish`/`markDeparted` 返回 boolean；`partyStats.pairs` 为 `{a,b,n,count}`；`rankTitles` 返回 `{special,tag,list}`；`subs[seat].word` 存展示原文，`done:false` 表示撤回。

规则语义以 `SPEC.md` 为准；称号/边界/阶段优先级必须逐条核对。`hostTick` 是唯一的房主自动推进入口，UI 不自行改 `phase/round/result`。

## 4. `SWN`（online.js）必需 API

```js
SWN.init({
  sessionKey: 'sameword-online',
  title: '同词相遇',
  maxPlayers: 4,
  getState: () => SWR.getState(),          // 供远端合并
  onWaiting: (view) => SWR.renderWaiting(view),
  onState: (state, meta) => SWR.applyRemote(state, meta), // meta={status}
  onClosed: (reason) => SWR.onRoomClosed(reason),         // 'host-left'|'closed'|'left'|'not-found'
  onPlayerLeft: (info) => SWR.onPlayerLeft(info),         // {name, seat, isHost}
  onNet: (online) => SWR.setNet(online),
});

SWN.createRoom({name, mode, timeLimit, roundLimit}) -> Promise<{code, seat:0}>
SWN.joinRoom({code, name}) -> Promise<{seat}>            // 4 位数字；duel 房满 2 人拒绝
SWN.startGame(state) -> Promise<boolean>                 // 仅房主；status='playing'
SWN.setWaiting(patch) -> Promise<boolean>                // 仅房主；patch={mode?,timeLimit?,roundLimit?}
SWN.pushState(state) -> Promise<{ok:boolean, state}>     // 任意在座玩家；内部合并+rev 乐观锁+重试
SWN.getRoomView() -> view | null
SWN.getSeats() -> [{seatIndex,name}]
SWN.getSeat() -> number
SWN.isHost() -> boolean
SWN.leave() -> Promise<void>                             // 清会话；onClosed('left')
SWN.tryRestore() -> Promise<boolean>                     // 刷新/断线恢复；成功则已触发 onWaiting/onState
```

`view`：

```js
{
  code: '1234', seat: 1, isHost: false, status: 'waiting',
  hostName: '阿山',
  seats: [{seatIndex:0,name:'阿山'},{seatIndex:1,name:'小海'}],
  pending: {mode:'duel', timeLimit:0, roundLimit:10},
  canStart: false,   // isHost && (duel ? seats.length===2 : seats.length>=3) && <=4
}
```

等待室房间的 `room.state` 形如 `{schema:1, pending:{...}, rev, _ts, _pushId}`。开局后为正常 `S`。

### 联机不变量（必须实现，细则见 SPEC §6）

- `net.js` 前缀 `sameword-`，最大 4 人；`netUpdateGameState` 支持 `expectRev` 条件更新（按 `state->>rev`），失败返回冲突而非抛错；条件过滤不被 PostgREST 支持时退化为“更新后读回校验”。
- 任何在座玩家都可推送；**不要**沿用 take-time 的“只有 currentPlayer 能推”。合并由 `SWG.mergeState` 保证字段所有权。
- `rev` 单调递增；写前读最新 rev，`rev=remote.rev+1`，带 `expectRev` 写；冲突重读重试 3 次。
- Realtime 订阅 + 2.5s 轮询兜底；断线/切前后台/`online` 事件强制重同步；重订阅。
- 超时：房主 `deadline` + `hostNow`（房主 offset=0，成员 offset 持久化到 localStorage）；剩余 ≤0 才自动提交（有合法草稿就提交，否则空提交），房主 deadline+3000ms 补空并结算；同一轮 finalize 幂等。
- 离席：不退座位接管；`netLeaveRoom` 移除 seat；房主检测到座位消失 → `onPlayerLeft` + `SWG.markDeparted` + 推送。房主离开 → 成员 `onClosed('host-left')`。剩余人数不足由 `hostTick` 判 giveup。
- 会话键 `localStorage['sameword-online']`；刷新恢复房间/座位；房间不存在/已解散清会话。
- 房间状态：waiting → playing → finished；`pushState` 时 `phase==='finished'` 则 status='finished'，restart 后回 'playing'。
- 不做服务端鉴权，信任模型与 take-time 一致。

实现补充（Net agent 已落地）：`onPlayerLeft` 对房主和成员都会触发；房主侧 SWN 内部已执行 `SWG.markDeparted` 并推送，**UI 只做提示/重绘，不要再次 markDeparted 或重复 push**。`tryRestore` 失败静默返回 false（不触发 onClosed）。`pushState` 对无 `phase` 的等待态保持 status='waiting'。`sameword-prefs` 存昵称偏好。条件过滤被 PostgREST 拒绝时 net.js 自动降级为“无条件写 + 读回校验”。

## 5. `SWR`（render.js）必需 API

```js
SWR.init();                       // 绑定静态事件、启动 600ms 房主 tick、200ms 计时器、visibility 处理
SWR.getState();                   // 返回全局 S
SWR.renderLanding();
SWR.renderWaiting(view);
SWR.applyRemote(state, meta);     // 设 S、记录 hostNow 偏移、清自动提交标记、renderGame
SWR.renderGame();                 // 按 S.phase 渲染 playing/reveal/finished
SWR.onRoomClosed(reason);
SWR.onPlayerLeft(info);           // 房主侧：markDeparted+push；成员侧：toast
SWR.setNet(online);
SWR.toast(msg, type?);
SWR.showSheet(html, onMount?);
SWR.closeSheet();
SWR.showRules();
SWR.showShare();
```

界面必须覆盖 SPEC §4：封面、创建/加入弹层、等待室、出词、揭晓（duel 投票 / party 认证）、结算（庆祝→结果）、规则、日志、分享长图、断线/房间关闭。视觉按 SPEC §7（户外/自然/运动，SVG symbol 库，安全区，44px 点击区，≥14px 正文，色彩+图标双编码，`prefers-reduced-motion`）。

UI 点击处理约定：

- 房主开局：`S=SWG.createState({...})` → `SWN.startGame(S)` → `renderGame()`。
- 提交：`const r=SWG.submit(S, SWN.getSeat(), input, Date.now())` → 成功后 `pushState()`。
- 所有写操作后统一 `SWR.pushState()`：
  ```js
  SWR.pushState = async () => {
    const r = await SWN.pushState(S);
    if (r && r.state) { S = r.state; SWR.renderGame(); }
  };
  ```
- 房主自动推进：
  ```js
  setInterval(() => {
    if (!S || !SWN.isHost()) return;
    if (SWG.hostTick(S, Date.now())) SWR.pushState();
  }, 600);
  ```
- 成员只改自己座位字段；不改 phase/round/result/history。
- 等待室房主改设置 → `SWN.setWaiting(patch)`；成员只读。
- 分享/结算页离席 → `SWN.leave()`。

## 6. 初始化（index.html 末尾）

```html
<script src="game.js"></script>
<script src="render.js"></script>
<script src="supabase.min.js"></script>
<script src="net.js"></script>
<script src="online.js"></script>
<script>
  SWR.init();
  SWN.init({
    sessionKey: 'sameword-online',
    title: '同词相遇',
    maxPlayers: 4,
    getState: () => SWR.getState(),
    onWaiting: v => SWR.renderWaiting(v),
    onState: (s, m) => SWR.applyRemote(s, m),
    onClosed: r => SWR.onRoomClosed(r),
    onPlayerLeft: i => SWR.onPlayerLeft(i),
    onNet: on => SWR.setNet(on),
  });
  SWN.tryRestore().then(ok => { if (!ok) SWR.renderLanding(); });
</script>
<script src="../track.js?v=20261125"></script>
```

## 7. 验收

- `node --check game.js render.js net.js online.js test-core.js`
- `node test-core.js` 全绿（Core agent 写；纯 vm/require 均可，不得依赖浏览器）
- UI 至少能在无房间时打开封面、规则、创建/加入弹层；无控制台报错。
- 联机冒烟：创建房间 → 等待室显示房号；刷新恢复；两个浏览器加入同一房间；房主开局后双方进入出词页。