/**
 * index.js — 小程序侧 Supabase 客户端入口
 *
 * 在同一层里给出两种接入姿势：
 *   A. supabase-lite：完全复用现有 H5 的 net.js 协议（rooms 表 REST 读写 +
 *      Realtime 订阅），只需在 createClient 时注入适配层。迁移期最省事。
 *   B. 官方 supabase-js：npm 安装 '@supabase/supabase-js' 后调用 createMPClient()，
 *      可用完整查询链（.from().select()...），适合新写的用户/钻石/战绩模块。
 *
 * 目录约定（建议）：
 *   miniprogram/wechat-minigame/supabase/transport.js  ← 本适配层
 *   miniprogram/wechat-minigame/supabase/index.js      ← 本文件
 *   miniprogram/wechat-minigame/net-mp.js              ← 由 H5 的 net.js 改造而成
 */

const { setupMiniProgramGlobals } = require('./transport');

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

const MP_NET_CONFIG = {
  // ⚠️ 必须是你自己的、已 ICP 备案的代理域名（见 wechat-minigame/README.md 部署篇）
  SUPABASE_URL: 'https://api.your-domain.com',
  // anon key 可以放在这里（与 H5 版一致）；service_role key 绝不能出现在客户端
  SUPABASE_ANON: 'REPLACE_WITH_YOUR_ANON_KEY',
  ROOM_PREFIX: 'game-',
  MAX_PLAYERS: 5,
};

/* ------------------------------------------------------------------ */
/* B 路线：官方 supabase-js                                            */
/* ------------------------------------------------------------------ */

let _officialClient = null;

/**
 * 创建官方 supabase-js 客户端（小程序适配版）。
 * 需先 npm install @supabase/supabase-js，并在构建时勾选"构建 npm"。
 */
function createMPClient(config) {
  const cfg = Object.assign({}, MP_NET_CONFIG, config || {});

  // 顺序敏感：必须先垫全局，再加载 supabase-js
  setupMiniProgramGlobals({ supabaseUrl: cfg.SUPABASE_URL });

  const { createClient } = require('@supabase/supabase-js');

  if (_officialClient) return _officialClient;
  _officialClient = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON, {
    auth: {
      persistSession: false,   // 小程序登录走 wx.login + 自建 users 表，不用 supabase auth 的本地会话
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
  return _officialClient;
}

/* ------------------------------------------------------------------ */
/* A 路线：轻量 REST + Realtime（与 H5 net.js 协议 1:1 对应）            */
/* ------------------------------------------------------------------ */

/**
 * 纯 wx.request 实现的 PostgREST 调用，避免引入整个 supabase-js。
 * 迁移期可直接替换 H5 net.js 里的 _supabase.from(...) 调用。
 */
function createLiteClient(config) {
  const cfg = Object.assign({}, MP_NET_CONFIG, config || {});

  function request(path, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      wx.request({
        url: cfg.SUPABASE_URL + path,
        method: opts.method || 'GET',
        header: Object.assign({
          apikey: cfg.SUPABASE_ANON,
          Authorization: 'Bearer ' + cfg.SUPABASE_ANON,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }, opts.headers || {}),
        data: opts.body,
        timeout: 15000,
        success(res) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ data: res.data, error: null });
          } else {
            resolve({ data: null, error: res.data || { message: 'HTTP ' + res.statusCode } });
          }
        },
        fail(err) {
          reject(new Error((err && err.errMsg) || 'request failed'));
        },
      });
    });
  }

  return {
    config: cfg,

    /* ---- rooms 表 CRUD（对应 net.js 全部函数）---- */

    getRoom(roomId) {
      return request('/rest/v1/rooms?id=eq.' + encodeURIComponent(roomId) + '&select=*',
        { headers: { Accept: 'application/vnd.pgrst.object+json' } });
    },

    insertRoom(row) {
      return request('/rest/v1/rooms', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: row,
      });
    },

    updateRoom(roomId, patch) {
      return request('/rest/v1/rooms?id=eq.' + encodeURIComponent(roomId), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: patch,
      });
    },

    deleteRoom(roomId) {
      return request('/rest/v1/rooms?id=eq.' + encodeURIComponent(roomId), { method: 'DELETE' });
    },

    /**
     * Realtime 订阅（rooms 表单行变更）。
     * 走官方客户端以保证 Phoenix 协议兼容；轻量实现需自己处理心跳/重连，性价比低。
     */
    subscribeRoom(roomId, cb) {
      const client = createMPClient(cfg);
      const channel = client
        .channel('room-' + roomId)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.' + roomId },
          (payload) => cb((payload && payload.new) || null))
        .subscribe();
      return () => { try { client.removeChannel(channel); } catch (e) { /* noop */ } };
    },
  };
}

/* ------------------------------------------------------------------ */
/* 扩展：用户 / 钻石 / 战绩（先落协议约定，表结构见 README）             */
/* ------------------------------------------------------------------ */

/**
 * 这些函数对应"记录昵称 + 查看游戏记录 + 钻石"的需求。
 * 表结构建议见 README「数据模型」一节。
 */
function createUserService(client) {
  return {
    /** 按 openid 取用户，无则创建（openid 由云函数/后端用 wx.login code 换取，绝不打客户端） */
    async ensureUser(openid, nickname, avatarUrl) {
      const { data, error } = await client
        .from('users')
        .select('*')
        .eq('openid', openid)
        .maybeSingle();
      if (error) throw error;
      if (data) return data;
      const { data: created, error: e2 } = await client
        .from('users')
        .insert({ openid, nickname, avatar_url: avatarUrl || null })
        .select()
        .single();
      if (e2) throw e2;
      return created;
    },

    async updateNickname(userId, nickname) {
      return client.from('users').update({ nickname }).eq('id', userId);
    },

    async listRecords(userId, limit) {
      return client
        .from('game_records')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit || 20);
    },

    /** ⚠️ 钻石变动必须走云函数/Edge Function 的服务端校验，客户端只读 */
    async getWallet(userId) {
      return client.from('wallets').select('diamond').eq('user_id', userId).maybeSingle();
    },

    async claimDaily(userId) {
      // 通过云函数调用：wx.cloud.callFunction({ name: 'claimDaily' })
      throw new Error('claimDaily 必须在服务端执行，见 README「虚拟币防刷」');
    },
  };
}

module.exports = {
  MP_NET_CONFIG,
  setupMiniProgramGlobals,
  createMPClient,
  createLiteClient,
  createUserService,
};
