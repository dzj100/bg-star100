/**
 * cloudflare-worker.js — 备案域名 → Supabase 反向代理（零服务器方案）
 *
 * 用途：微信小程序要求网络域名必须 ICP 备案，而 *.supabase.co 无法备案。
 * 这个 Worker 把你在 Cloudflare 上的备案域名（如 api.your-domain.com）
 * 透明转发到 Supabase，REST / Auth / Realtime WebSocket 全部支持。
 *
 * 部署步骤：
 *   1. 你有 Cloudflare 账号（H5 已部署在 Cloudflare Pages，直接复用）
 *   2. 准备一个已 ICP 备案的域名（注册于腾讯云/阿里云均可，约 30 元/年），
 *      在 Cloudflare 添加该域名为 zone，DNS 记录指向本 Worker（走 Cloudflare 代理，小黄云）
 *   3. Cloudflare Dashboard → Workers & Pages → 创建 Worker → 粘贴本文件内容
 *   4. Worker 设置 → Triggers → 添加自定义域：api.your-domain.com
 *   5. 小程序后台「服务器域名」同时配置：
 *        request 合法域名: https://api.your-domain.com
 *        socket 合法域名:  wss://api.your-domain.com
 *
 * 成本：Workers 免费版 10 万请求/天 + WebSocket 连接不按消息计费，个人游戏量级足够。
 * 局限：国内访问 Cloudflare 边缘节点时延 30~80ms 波动，一般可接受；
 *       如后续用户量大且对实时性要求提高，可无缝换回国内轻量云 + nginx（见 nginx.conf）。
 */

const UPSTREAM = 'https://smcplxyjjvehbizirvrw.supabase.co'; // ⚠️ 替换为你的 Supabase 项目域名
const ALLOW_PATHS = ['/rest/v1/', '/auth/v1/', '/realtime/v1/', '/storage/v1/', '/functions/v1/'];

export default {
  async fetch(request) {
    const url = new URL(request.url);

    const allowed = ALLOW_PATHS.some((p) => url.pathname.startsWith(p));
    if (!allowed) {
      return new Response('Not Found', { status: 404 });
    }

    // 构造转发请求：保留 method / headers / body / query，仅替换 origin。
    // WebSocket 升级请求（Upgrade: websocket）同样经这里透传——
    // Realtime 的 wss:// 会被 Cloudflare 与 Supabase 之间建立真正的 WebSocket 隧道。
    const upstreamUrl = UPSTREAM + url.pathname + url.search;
    const proxied = new Request(upstreamUrl, request);

    const response = await fetch(proxied);

    // WebSocket 升级成功时，把上游的 webSocket 句柄交给客户端
    if (response.webSocket) {
      return new Response(null, { status: 101, webSocket: response.webSocket });
    }
    return response;
  },
};
