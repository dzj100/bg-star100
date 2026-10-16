# 联机桌游 → 微信小程序迁移方案（Supabase 方案）

> 目标：把 5 款联机桌游（弑君者 / 月面探险 / 神探缉凶 / 渗透因子 / 煞有其时）迁移到微信小游戏，
> 保留 Supabase 作为后端，个人主体 + 广告变现。
> 本文档是 [README.md](./README.md) 的执行细化版，含成本、架构、代码骨架与实施顺序。

---

## 一、成本核算（先把账算清楚）

"个人小程序 = 30 元/年"这个判断**只对了一半**。30 元是微信认证年费上限，但 Supabase 直连域名在小程序里用不了：

> 小程序要求所有网络域名**必须 ICP 备案**（详见[官方网络文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)），
> `*.supabase.co` 无法备案 → **必须加一层你自己的备案域名做反向代理**。这是唯一的硬性额外成本。

| 项目 | 费用 | 说明 |
|---|---|---|
| 小程序微信认证 | 30 元/年 | 个人主体 |
| 备案域名（如 `.cn`/`.xyz`） | 首年 0~60 元 | 腾讯云/阿里云常有 1 元注册活动 |
| ICP 备案 | 免费 | 1~3 周，需提前办 |
| 反代通道（二选一） | **0 元** 或 40~100 元/年 | **首选 Cloudflare Worker（免费，零服务器）**；或国内轻量云跑 nginx |
| SSL 证书 | 免费 | Worker 方案自带；服务器方案用免费 DV 证书 |
| Supabase | 0 元 | Free 层（500MB 数据库 + 200 并发实时连接）足够起步 |
| **合计** | **≈ 30~90 元 / 首年** | 选 Worker 方案≈仅域名+认证 |

**省钱要点（零服务器路线）**：H5 已经部署在 Cloudflare Pages，**在同一个 Cloudflare 账号里加一个 Worker 做反代即可**，REST 和 Realtime WebSocket 都支持（`server/cloudflare-worker.js`，免费版 10 万请求/天，个人游戏量级绰绰有余）。唯一代价：国内访问 Cloudflare 边缘节点有 30~80ms 时延波动；将来用户量大了想升级，保留备案域名换解析到国内轻量云 + nginx 即可，小程序侧零改动。

**另需注意（软著）**：个人主体纯广告变现，微信通常要求**软件著作权登记**作为上架/结算依据（约 300 元 + 1~3 个月，可在开发期并行办理）。

---

## 二、目标架构

```
┌─────────────────────┐    wss/https（白名单域名）    ┌────────────────────────┐
│   微信小游戏         │ ───────────────────────────▶│ 你的备案域名           │
│  ┌───────────────┐  │                             │ api.your-domain.com    │
│  │ 官方 supabase-js│ │  /rest/v1/*      → PostgREST│  └─ 通道二选一:        │
│  │   + 适配层垫片  │  │  /realtime/v1/*  → WebSocket│     A. CF Worker(免费) │
│  └───────────────┘  │  /functions/v1/* → Edge Fn  │     B. nginx 轻量云    │
│  wx.request          │                             └────────────────────────┘
│  wx.connectSocket    │                                        │ https/wss
│  wx.setStorageSync   │                                        ▼
└─────────────────────┘                              ┌────────────────────────┐
         │                                           │   Supabase（免费层）    │
         │ wx.login → code                           │  rooms / users         │
         ▼                                           │  wallets /             │
┌─────────────────────┐  云函数校验后写库              │  game_records          │
│ 微信云函数（免费额度）│ ─────────────────────────────▶│  + Realtime            │
│ code→openid 换发     │                              │  + Edge Functions      │
│ 钻石账本动作         │                              └────────────────────────┘
└─────────────────────┘
```

**职责划分**：

| 数据 | 客户端可写？ | 说明 |
|---|---|---|
| `rooms`（房间态） | ✅（anon key + RLS 限定） | 沿用现有全量快照协议，零改动 |
| `users`（昵称/头像） | ✅（仅本人行） | openid 从云函数换取 |
| `game_records`（战绩） | ❌ 只读 | 由结算云函数写入 |
| `wallets` / `diamond_logs`（钻石） | ❌ 只读 | **只能服务端写**，否则可被刷 |

---

## 三、三个卡点与解法（核心章节）

### 卡点 1：Supabase 域名无法配置进小程序

**解法**：备案域名 + 反代通道。**通道不需要服务器，二选一**：

| 方案 | 成本 | 适用 | 配置 |
|---|---|---|---|
| **A. Cloudflare Worker**（首选） | **0 元** | 已在用 Cloudflare Pages，直接复用账号 | [`server/cloudflare-worker.js`](./server/cloudflare-worker.js)，粘贴到 Workers 面板 + 绑定自定义域 |
| B. 国内轻量云 + nginx | 40~100 元/年 | 用户量大、要求低时延后可切换 | [`server/nginx.conf`](./server/nginx.conf) |

**方案 A 部署步骤**（10 分钟）：
1. 备案域名加入 Cloudflare（DNS 托管），无需改 DNS；
2. Cloudflare Dashboard → Workers & Pages → 新建 Worker，粘贴 `cloudflare-worker.js`（改一行 `UPSTREAM` 为你的 Supabase 域名）；
3. Worker → Settings → Domains & Routes → 添加自定义域 `api.your-domain.com`；
4. 小程序后台配置域名（见下）。

**关键细节（两方案通用）**：
- 小程序后台「开发管理 → 开发设置 → 服务器域名」配置 `request 合法域名` 和 `socket 合法域名`，都填你的域名；
- **新备案域名需 24 小时后才能配置**；开发联调期在开发者工具勾选"不校验合法域名"先行开发；
- Realtime 是 WSS：Worker 方案靠 Cloudflare 原生 WebSocket 透传（代码里已处理 101 升级）；nginx 方案需透传 `Upgrade/Connection` 头（配置里已处理）；
- ⚠️ Worker 方案的国内访问时延 30~80ms 波动，对回合制桌游无感知；若将来要升级，保留备案域名、改解析到国内轻量云即可，**小程序代码零改动**。

### 卡点 2：supabase-js 不能直接运行在小程序

| 依赖项 | 浏览器 | 小程序 | 解法 |
|---|---|---|---|
| `fetch` | 原生 | ❌ 只有 `wx.request` | 适配层用 `wx.request` 实现 fetch 契约 |
| `WebSocket` | 原生 | ⚠️ `wx.connectSocket`（监听式 API） | 适配层用 SocketTask 包装成标准 WebSocket 类 |
| `location` | 原生 | ❌ | Realtime 从 `location.host` 推导 WebSocket 地址，垫真实 Supabase origin（不是代理域名） |
| `navigator` / `document` / `sessionStorage` | 原生 | ❌ | 内存垫片 |

**现成实现**见 [`supabase-mp-adapter/transport.js`](./supabase-mp-adapter/transport.js)，用法：

```js
// app.js —— 顺序敏感！必须先垫全局再 require supabase-js
const { setupMiniProgramGlobals } = require('./supabase/transport');
setupMiniProgramGlobals({ supabaseUrl: 'https://api.your-domain.com' });

// 之后任意模块都可以正常用官方 API
const { createMPClient } = require('./supabase/index');
const supabase = createMPClient();
const { data } = await supabase.from('rooms').select('*').eq('id', 'game-1234').single();
```

> **✅ 已实测验证（2026-10）**：在本仓库用官方 `@supabase/supabase-js@2.112.4` + 适配层，
> 抹掉 Node 全部浏览器全局模拟小程序环境，对现有 Supabase 项目真实网络验证：
> REST 读（select）/ REST 写（insert+select）/ Realtime（WebSocket 连接 → phx_join → SUBSCRIBED →
> postgres_changes 变更推送）**三条链路全部通过**。
> 复现：`cd wechat-minigame/supabase-mp-adapter && npm i && node test-adapter.js && node test-integration.js`

**风险提示**：适配层按 supabase-js v2.112 的 Phoenix/Realtime 内部契约编写（`onopen/onmessage` 赋值式回调、`readyState` 常量、`send/close`），官方若大改 Realtime 传输层需要跟着修——**建议 npm 锁版本**（如 `"@supabase/supabase-js": "2.112.4"`）。

**降级路线**：若适配层的 Realtime 遇到疑难杂症，可只把**读**走 REST（`createLiteClient`），实时同步退化为"操作后广播 + 2.5s 轮询"——你现有的 `take-time/online.js` 已经有轮询兜底实现，可原样搬到小程序端，晚 2 秒但一定能跑通。

### 卡点 3：身份系统与虚拟币防刷

**身份**：`wx.login()` 拿到临时 `code` → 微信云函数（免费额度够用）用 `code2session` 换 `openid` → 你在 Supabase `users` 表里 upsert 用户行。昵称/头像用 `wx.getUserProfile` 组件（注意：这个能力政策上多次收紧，以最新审核口径为准）。

**钻石防刷（必做）**：现在 H5 是"客户端权威"，谁都改得了状态。钻石一旦可刷，广告收益模型就废了。
- `wallets` / `diamond_logs` 表：**RLS 只允许 `select`，禁止 `insert/update`**；
- 签到、看广告奖励、扣钻石建房 → 全部走**云函数/Edge Function**（服务端校验 + 幂等 + 每日限额）；
- 激励视频用 `wx.createRewardedVideoAd`，`onClose({isEnded:true})` 后请求服务端发放。

### 数据模型（建议）

```sql
users          (id uuid pk, openid text unique, nickname text, avatar_url text, created_at)
wallets        (user_id uuid pk → users, diamond int default 0, updated_at)         -- 仅服务端写
diamond_logs   (id bigserial pk, user_id uuid, delta int, reason text, ref text, created_at)  -- 仅服务端写
game_records   (id bigserial pk, user_id uuid, game text, result text, detail jsonb, created_at) -- 仅服务端写
rooms          (沿用现有表；新增 cleanup_at timestamptz)  -- 房主离线/开局时写入，定时任务清理
```

---

## 四、逐游戏迁移要点

| 游戏 | 适配重点 | 预估工作量 |
|---|---|---|
| ⏳ 煞有其时 | 最简单，先做试点。已有轮询兜底逻辑可直接复用 | 1~2 周 |
| 🕵️ 神探缉凶 | 1v1 隐藏信息；震动 `navigator.vibrate` → `wx.vibrateShort`；快照模式注意手牌泄露检查 | 2~3 周 |
| 🕶️ 渗透因子 | render 层最大（12.6 万字符）需整体重写；无音频，UI 用 WXML 重做 | 3~4 周 |
| 🌕 月面探险 | render 重 + 角色制；地图动画建议改用 canvas 2D 而非 WXML 节点动画 | 3~4 周 |
| ⚔️ 弑君者 | 有 BGM（`new Audio` → `wx.createInnerAudioContext`）+ cinematic 过场动画（重写为 canvas） | 3~4 周 |

**通用替换清单**：

| H5 API | 小程序替代 |
|---|---|
| `localStorage` | `wx.setStorageSync/getStorageSync`（key 加 openid 前缀做多账号隔离） |
| `navigator.clipboard` | `wx.setClipboardData`；房间分享改用 `onShareAppMessage`（体验更好，带房间号参数直达） |
| `new Audio` / `autoplay` | `wx.createInnerAudioContext`（自动播放需用户手势后） |
| `alert/confirm` | `wx.showModal` |
| `requestAnimationFrame` | canvas 用 `canvas.requestAnimationFrame`；WXML 动画用 CSS transition |
| `env(safe-area-inset-*)` / `dvh` | WXSS 直接支持 `env()`；`dvh` 换 `100vh` 或 JS 读 `wx.getWindowInfo()` |
| CSS `feTurbulence` 噪点纹理 | 转静态图片或 canvas 绘制 |

**包体策略**：5 个游戏各自独立分包（主包 2MB / 单分包 2MB / 总 20MB）。代码本身每游戏 0.3MB 以内没问题，supabase-js min 版 208KB 放主包，图标等图片压缩后进分包。

---

## 五、实施顺序

```
Phase 0（与开发并行，最先启动）
  ├─ 个体户 or 个人主体决策 → 注册小游戏账号（一级类目必须选「游戏」，选定不可改）
  ├─ 域名注册 + ICP 备案（1~3 周）→ Cloudflare Worker 反代（10 分钟，免费）
  ├─ 软著申请（1~3 个月，广告结算需要）
  └─ 微信认证 30 元

Phase 1（骨架，2~3 周）
  ├─ 小程序壳：wx.login → 云函数换 openid → users 表
  ├─ 移植 supabase-mp-adapter + net-mp.js（rooms 表 CRUD + Realtime 联调）
  ├─ 钻石账本 + 签到云函数 + 激励视频广告位（开发者工具可先接测试广告位）
  └─ 用「煞有其时」打通：建房 → 邀请分享 → 加入 → 同步 → 结算写战绩

Phase 2（试点上线）：煞有其时 提审 → 备案 → 上线 → 验证 UV 增长 → 开流量主

Phase 3（批量迁移）：神探缉凶 → 渗透因子 → 月面探险 → 弑君者
```

---

## 六、风险与注意

1. **类目风险（最高）**：一级类目注册时必须选「游戏」，一旦选错无法修改。个人主体可注册小游戏（纯广告变现路径），但二级类目避开"牌类/文化互动"字样，弑君者等扑克题材建议归入"休闲"并提前咨询审核口径。若被拒，备选方案是升级为个体工商户主体（认证 300 元/年）。
2. **虚拟币合规**：钻石只能靠签到/看广告获得 + 建房消耗，**严禁提现、兑换实物、抽奖概率机制**，否则触发违规。
3. **流量主门槛**：小游戏口径是累计 UV > 500 + 实名 + 备案 + 隐私协议，达标后开通，广告位 ID 再后台创建。
4. **适配层版本锁定**：`@supabase/supabase-js` 锁 2.112.x，升级前先在开发者工具跑通 Realtime。
5. **香港服务器**：域名备案后可以不放置国内服务器，但大陆访问 Supabase 的时延波动较大，联机体验差，不建议为省 40 元踩这个坑。
6. **现有 H5 保留**：app 端（bg-star100.pages.dev）继续服务，小程序端代码复用逻辑层（`game.js`），不要动 H5 的联机实现，两者对同一张 `rooms` 表天然互通（甚至可以跨端联机）。

---

## 七、参考

- [小程序网络能力（服务器域名/ICP/HTTPS 要求）](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)
- [wx.connectSocket](https://developers.weixin.qq.com/miniprogram/dev/api/network/websocket/wx.connectSocket.html)
- [小游戏类目设置](https://developers.weixin.qq.com/minigame/introduction/guide/type.html)
- [小游戏广告接入与流量主条件](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/ad/ad.html)
- Supabase JS 自定义 fetch：`createClient(url, key, { global: { fetch: myFetch } })` / 环境探测见包内 `getWebSocketConstructor`
