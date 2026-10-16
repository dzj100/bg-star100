/**
 * transport.js — 微信小程序 × supabase-js 运行时适配层
 *
 * 背景：supabase-js 依赖浏览器全局对象（fetch / WebSocket / location /
 * navigator / sessionStorage），而微信小程序运行时不提供这些。
 * 本模块在小程序启动时把这些能力"垫"上，之后即可直接使用官方
 * supabase-js（npm 依赖）的完整 API：.from().select()、.channel().on() 等。
 *
 * 用法（必须在 import supabase-js 之前调用，见 index.js）：
 *   const { setupMiniProgramGlobals } = require('./transport');
 *   setupMiniProgramGlobals({ supabaseUrl: 'https://api.your-domain.com' });
 *   const { createClient } = require('@supabase/supabase-js');
 *
 * 注意：小程序 Node 侧编译时需保证本文件先于 supabase-js 执行
 *（依赖注入顺序，而不是 import 提升顺序——小程序是 CommonJS，require 顺序即执行顺序）。
 */

let _configured = false;

/* ------------------------------------------------------------------ */
/* 1. fetch 适配：基于 wx.request                                      */
/* ------------------------------------------------------------------ */

function createFetch(wxApi) {
  return function fetch(input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = (init.method || 'GET').toUpperCase();

    // Headers → 普通对象（wx.request 的 header 不接受 Headers 实例）
    let headers = {};
    const rawHeaders = init.headers;
    if (rawHeaders) {
      if (typeof rawHeaders.forEach === 'function' && typeof rawHeaders.get === 'function') {
        rawHeaders.forEach((value, key) => { headers[key] = value; });
      } else {
        Object.keys(rawHeaders).forEach((key) => { headers[key] = rawHeaders[key]; });
      }
    }

    const body = init.body == null
      ? undefined
      : (typeof init.body === 'string' ? init.body : String(init.body));

    return new Promise((resolve, reject) => {
      wxApi.request({
        url,
        method,
        header: headers,
        data: body,
        responseType: 'text',
        timeout: 30000,
        success(res) {
          // wx.request 在 content-type 为 JSON 时会把 data 解析成对象，
          // 但 fetch 契约要求 Response 体是字符串，这里做双向兜底
          let text;
          if (typeof res.data === 'string') {
            text = res.data;
          } else if (res.data !== undefined && res.data !== null) {
            try { text = JSON.stringify(res.data); } catch (e) { text = String(res.data); }
          } else {
            text = '';
          }

          const resHeaders = {};
          const lower = {};
          const raw = res.header || {};
          Object.keys(raw).forEach((key) => {
            const val = Array.isArray(raw[key]) ? raw[key].join(', ') : String(raw[key]);
            resHeaders[key] = val;
            lower[key.toLowerCase()] = val;
          });

          const response = {
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: String(res.statusCode),
            url,
            headers: {
              get(name) { return lower[String(name).toLowerCase()] ?? null; },
              has(name) { return String(name).toLowerCase() in lower; },
              forEach(cb) { Object.keys(resHeaders).forEach((k) => cb(resHeaders[k], k)); },
            },
            text() { return Promise.resolve(text); },
            json() { return Promise.resolve(text ? JSON.parse(text) : null); },
            clone() { return this; },
            arrayBuffer() {
              // 小程序里一般用不到二进制响应；如以后需要改用 responseType:'arraybuffer'
              return Promise.reject(new Error('arrayBuffer() not supported by mp fetch shim'));
            },
          };
          resolve(response);
        },
        fail(err) {
          const e = new Error((err && err.errMsg) || 'wx.request failed');
          e.cause = err;
          reject(e);
        },
      });
    });
  };
}

/* ------------------------------------------------------------------ */
/* 2. WebSocket 适配：基于 wx.connectSocket（supabase Realtime 必需）  */
/* ------------------------------------------------------------------ */

function createWebSocketClass(wxApi) {
  class MiniProgramWebSocket {
    constructor(url, protocols) {
      this.url = url;
      this.readyState = MiniProgramWebSocket.CONNECTING;
      // 浏览器 WebSocket 的赋值式回调，supabase-js / Phoenix 依赖这个契约
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;

      let socketUrl = String(url);
      let protoList;
      if (Array.isArray(protocols)) {
        protoList = protocols;
      } else if (typeof protocols === 'string') {
        protoList = [protocols];
      } else if (protocols) {
        protoList = [String(protocols)];
      }

      // supabase-js 传的 ws 地址自带 query（apikey / vsn 等），
      // 协议协商顺带塞进子协议即可——Realtime 服务端读的是 query 参数
      if (protoList && protoList.length) {
        const sep = socketUrl.indexOf('?') >= 0 ? '&' : '?';
        socketUrl += sep + 'protocol=' + encodeURIComponent(protoList.join(','));
      }

      this._task = wxApi.connectSocket({
        url: socketUrl,
        protocols: protoList,
        fail: (err) => {
          this.readyState = MiniProgramWebSocket.CLOSED;
          if (this.onerror) this.onerror({ reason: (err && err.errMsg) || 'connectSocket failed' });
          if (this.onclose) this.onclose({ code: 1006, reason: (err && err.errMsg) || '' });
        },
      });
      if (!this._task) return;

      // 有些基础库版本 SocketTask 无 readyState，做兼容
      const task = this._task;

      task.onOpen(() => {
        this.readyState = MiniProgramWebSocket.OPEN;
        if (this.onopen) this.onopen({});
      });

      task.onMessage((res) => {
        if (!this.onmessage) return;
        let data = res.data;
        if (data instanceof ArrayBuffer) {
          try {
            data = new TextDecoder('utf-8').decode(new Uint8Array(data));
          } catch (e) {
            try { data = decodeURIComponent(escape(String.fromCharCode.apply(null, new Uint8Array(data)))); } catch (e2) { /* 保持原值 */ }
          }
        }
        this.onmessage({ data });
      });

      task.onClose((res) => {
        this.readyState = MiniProgramWebSocket.CLOSED;
        if (this.onclose) this.onclose({ code: (res && res.code) || 1000, reason: (res && res.reason) || '' });
      });

      task.onError((err) => {
        this.readyState = MiniProgramWebSocket.CLOSED;
        if (this.onerror) this.onerror(err || {});
      });
    }

    send(data) {
      if (this.readyState !== MiniProgramWebSocket.OPEN) {
        throw new Error('MiniProgramWebSocket is not open (readyState=' + this.readyState + ')');
      }
      this._task.send({ data });
    }

    close(code, reason) {
      if (this.readyState === MiniProgramWebSocket.CLOSED) return;
      this.readyState = MiniProgramWebSocket.CLOSING;
      try { this._task.close({ code: code || 1000, reason: reason || '' }); } catch (e) { /* noop */ }
    }
  }

  MiniProgramWebSocket.CONNECTING = 0;
  MiniProgramWebSocket.OPEN = 1;
  MiniProgramWebSocket.CLOSING = 2;
  MiniProgramWebSocket.CLOSED = 3;
  // 实例上也放一份（部分代码从实例读常量）
  MiniProgramWebSocket.prototype.CONNECTING = 0;
  MiniProgramWebSocket.prototype.OPEN = 1;
  MiniProgramWebSocket.prototype.CLOSING = 2;
  MiniProgramWebSocket.prototype.CLOSED = 3;

  return MiniProgramWebSocket;
}

/* ------------------------------------------------------------------ */
/* 3. 浏览器全局对象垫片 + 统一注册入口                                 */
/* ------------------------------------------------------------------ */

function createStorageShim(wxApi) {
  // supabase-js 里 sessionStorage 只用于"多标签页 session 同步"，try/catch 包裹；
  // 小程序单页面环境给个内存实现即可，为保稳再兼容一样 wx storage
  const memory = {};
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; },
    setItem(key, value) { memory[key] = String(value); },
    removeItem(key) { delete memory[key]; },
    clear() { Object.keys(memory).forEach((k) => delete memory[k]); },
    get length() { return Object.keys(memory).length; },
    key(i) { return Object.keys(memory)[i] ?? null; },
  };
}

/**
 * 把 supabase-js 需要的浏览器全局能力注册到小程序运行时。
 * 必须在 require('@supabase/supabase-js') 之前调用。
 *
 * @param {{ supabaseUrl: string, wx?: object }} options
 *   supabaseUrl: 你的备案代理域名（https://...），用于垫 location.protocol，
 *                Phoenix 据此决定 ws/wss。请勿传 http。
 */
function setupMiniProgramGlobals(options) {
  if (_configured) return;
  _configured = true;

  const wxApi = (options && options.wx) || (typeof wx !== 'undefined' ? wx : null);
  if (!wxApi) throw new Error('[mp-adapter] wx 对象不存在，请在微信小程序环境调用');

  const supabaseUrl = (options && options.supabaseUrl) || 'https://example.com';

  const g = typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : {});
  const root = g; // 小程序里 globalThis 即全局

  if (!root.fetch) root.fetch = createFetch(wxApi);
  if (!root.WebSocket) root.WebSocket = createWebSocketClass(wxApi);
  if (!root.sessionStorage) root.sessionStorage = createStorageShim(wxApi);
  if (!root.localStorage) root.localStorage = createStorageShim(wxApi); // 兜底，正常应使用 wx.setStorageSync

  // Phoenix/realtime-js 从 location 推导 WebSocket 地址（location.host → wss://host/...）。
  // ⚠️ 必须填真实 Supabase 域名，而不是代理域名：Realtime 客户端会脱离 fetch 垫片
  // 直接用 WebSocket 垫片连接，路径是对的，host 必须能解析到 Supabase。
  let supabaseOrigin;
  try {
    supabaseOrigin = new URL(supabaseUrl).origin;
  } catch (e) {
    supabaseOrigin = 'https://example.com';
  }
  if (!root.location) {
    root.location = {
      protocol: 'https:',
      hostname: supabaseOrigin.replace(/^https?:\/\//, '').split('/')[0],
      host: supabaseOrigin.replace(/^https?:\/\//, ''),
      href: supabaseOrigin + '/',
      origin: supabaseOrigin,
    };
  }

  // realtime-js 通过 navigator 探测运行环境
  if (!root.navigator) {
    root.navigator = { userAgent: 'wechat-miniprogram', platform: 'wechat' };
  }

  // supabase-js 里少量 DOM 相关防御代码（document.hidden / visibilitychange / body）
  if (!root.document) {
    root.document = {
      hidden: false,
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
      createElement() { return { style: {} }; },
      body: { appendChild() {}, removeChild() {} },
    };
  }
  if (!root.window) root.window = root;
}

module.exports = {
  setupMiniProgramGlobals,
  createFetch,
  createWebSocketClass,
  createStorageShim,
};
