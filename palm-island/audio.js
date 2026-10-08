/* ============================================================
   棕榈岛 Palm Island · WebAudio 合成音效（无外部资源）
   与 scoundrel / wizard 同款结构：tone/noise 合成 + 静音开关
   ============================================================ */
var SFX = (function () {
  'use strict';

  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var muted = false;
  var MUTE_KEY = 'palm-island-muted';

  function ensure() {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function unlock() { ensure(); }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (muted || !ctx) return;
    var t0 = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterFreq, q, delay) {
    if (muted || !ctx || !noiseBuf) return;
    var t0 = ctx.currentTime + (delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq || 2000, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, (filterFreq || 2000) * 0.12), t0 + dur);
    f.Q.value = q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  /* 轻点 */
  function tap() { tone(660, 0.05, 'triangle', 0.14, 560); }

  /* 收集：拾取上行双音 + 小浪花 */
  function collect() {
    tone(520, 0.09, 'triangle', 0.22, 600);
    tone(780, 0.13, 'triangle', 0.18, null, 0.07);
    noise(0.07, 0.1, 3200, 2);
  }

  /* 转 180°：木轴转动 + 上行滑音 */
  function spin() {
    noise(0.1, 0.14, 1800, 1.4);
    tone(300, 0.16, 'sawtooth', 0.1, 620);
  }

  /* 翻面：翻牌唰声 + 轻点 */
  function flip() {
    noise(0.16, 0.18, 3000, 1.2);
    tone(620, 0.1, 'sine', 0.14, 760, 0.02);
  }

  /* 回合标记：海浪 + 木钟 */
  function marker() {
    noise(0.34, 0.2, 900, 1);
    tone(330, 0.2, 'sine', 0.2, null, 0.04);
    tone(247, 0.26, 'sine', 0.16, null, 0.14);
  }

  /* 结算入口：下行的温柔琶音 */
  function settle() {
    var notes = [659, 523, 440, 349];
    for (var i = 0; i < notes.length; i++) tone(notes[i], 0.2, 'triangle', 0.2, null, i * 0.11);
  }

  /* 终局庆贺 */
  function win() {
    var notes = [523, 659, 784, 1046, 1318];
    for (var i = 0; i < notes.length; i++) tone(notes[i], 0.24, 'triangle', 0.26, null, i * 0.12);
    noise(0.3, 0.1, 4200, 1.5, 0.5);
  }

  /* 拒绝 / 不可用 */
  function bad() {
    tone(220, 0.14, 'square', 0.1, 170);
  }

  function loadMute() {
    try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
  }
  function toggle() {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = muted ? 0 : 0.5;
    return !muted;
  }

  loadMute();

  return {
    unlock: unlock, toggle: toggle,
    tap: tap, collect: collect, spin: spin, flip: flip,
    marker: marker, settle: settle, win: win, bad: bad,
    get muted() { return muted; }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SFX;
