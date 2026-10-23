/**
 * 月面探险 (Moon Adventure) - 渲染模块
 * 
 * 负责：所有UI渲染函数
 * 依赖：game.js（状态 S 和游戏逻辑函数）
 */

// ========================================
// 主渲染入口
// ========================================

/** 主渲染函数，根据游戏阶段分发渲染 */
function render() {
  const app = document.getElementById('app');
  app.classList.toggle('app--landing', S.phase === 'landing');

  // 观战端：逐格移动/返回动画播放中收到最终位置状态（S._moveSteps/S._returnSteps 已被清除）时，
  // 延迟到动画播完再重建 DOM，避免 ghost 未走完就被替换、token 提前瞬移到终位
  if (S && S.phase === 'playing' && _moveAnim && !S._moveSteps && !S._returnSteps) {
    _deferRender = true;
    return;
  }
  _deferRender = false;

  // 动画：渲染前捕获 token 旧位置 + 计算状态diff（FLIP首帧）
  const animCtx = captureAnimState();

  // 捕获旧 dice-area 高度
  const oldDice = app.querySelector('.dice-area');
  const oldH = oldDice ? oldDice.offsetHeight : null;

  if (S.phase === 'landing') {
    app.innerHTML = renderLanding();
  } else if (S.phase === 'setup') {
    app.innerHTML = renderSetup();
  } else {
    app.innerHTML = renderGame();
  }

  // 动画过渡 dice-area 高度
  const newDice = app.querySelector('.dice-area');
  if (newDice && oldH !== null) {
    const newH = newDice.scrollHeight;
    if (Math.abs(oldH - newH) > 2) {
      newDice.style.height = oldH + 'px';
      requestAnimationFrame(() => {
        newDice.style.height = newH + 'px';
        newDice.addEventListener('transitionend', () => {
          newDice.style.height = '';
        }, { once: true });
      });
    }
  }

  // 玩家条吸顶缩小监听（render重建DOM后重新绑定）
  observePlayerStrip();

  // 悬浮窗保持打开时按新按钮位置重新摆放
  if (moreOpen) positionMoreSheet();

  // 动画：播放 FLIP 位移 / AP反馈 / 拾取反馈 / 磁暴摧毁
  playAnimEffects(animCtx);
}

// ========================================
// 玩家条吸顶无极缩小（滚动驱动）
// ========================================

let psScrollHandler = null;

/** 玩家条吸顶后随下滑距离连续缩小至50%（左上角），回滚恢复 */
function observePlayerStrip() {
  if (psScrollHandler) {
    window.removeEventListener('scroll', psScrollHandler);
    psScrollHandler = null;
  }
  const oldSentinel = document.getElementById('ps-sentinel');
  if (oldSentinel) oldSentinel.remove();

  const strip = document.querySelector('.player-strip');
  if (!strip) return;

  // 哨兵：贴在玩家条正上方（不吸顶），其视口位置反映玩家条文档位置
  const sentinel = document.createElement('div');
  sentinel.id = 'ps-sentinel';
  sentinel.style.cssText = 'position:absolute;left:0;width:1px;height:1px;pointer-events:none;';
  strip.parentElement.insertBefore(sentinel, strip);

  function update() {
    const range = Math.max(150, window.innerHeight * 0.25);
    // 吸顶点：哨兵顶部距视口顶8px（与sticky top一致）
    const p = Math.min(1, Math.max(0, (8 - sentinel.getBoundingClientRect().top) / range));
    strip.style.transformOrigin = 'top left';
    strip.style.transform = `scale(${1 - 0.5 * p})`;
    strip.style.opacity = 1 - 0.5 * p;
    strip.style.boxShadow = `0 4px 10px rgba(0,0,0,.35))`;
  }

  update();
  psScrollHandler = update;
  window.addEventListener('scroll', update, { passive: true });
}

// ========================================
// 着陆页（月球任务封面）
// ========================================

/** 渲染着陆页（单机） */
function renderLanding() {
  return renderLandingShell('single');
}

/**
 * 着陆页共享外壳
 * single / online 只切换顶部任务标签、入口按钮与说明，封面主体保持一致
 */
function renderLandingShell(mode) {
  const isOnline = mode === 'online';
  const ctaIcon = isOnline
    ? `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="7.2" stroke="currentColor" stroke-width="1.7"/>
        <path d="M4.8 12h14.4M12 4.8c1.9 2.2 2.8 4.6 2.8 7.2s-.9 5-2.8 7.2c-1.9-2.2-2.8-4.6-2.8-7.2S10.1 7 12 4.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`
    : `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3.2c3.1 1.9 4.6 5.1 4.6 8.4l-2.2 2.2H9.6L7.4 11.6C7.4 8.3 8.9 5.1 12 3.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        <circle cx="12" cy="9.2" r="1.5" stroke="currentColor" stroke-width="1.4"/>
        <path d="M9.6 16.2 8 20l4-1.3M14.4 16.2 16 20l-4-1.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;

  return `
    <div class="landing-v2 ${isOnline ? 'landing-v2--online' : 'landing-v2--single'}">
      <header class="lv2-top">
        <div class="lv2-brand">
          <span class="lv2-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="11.5" stroke="#f5c518" stroke-opacity=".5" stroke-width="1.2"/>
              <path d="M20.2 8.6a8.2 8.2 0 1 0 0 14.8 8.2 8.2 0 0 1 0-14.8Z" fill="#f5c518"/>
              <circle cx="23.6" cy="9.4" r="2" fill="#7fe3ff"/>
              <path d="M8.5 22.8c2.6-1.6 5.5-2.3 8.8-2.1" stroke="#7fe3ff" stroke-width="1" stroke-linecap="round" stroke-dasharray="1 3"/>
            </svg>
          </span>
          <span class="lv2-brand-text">
            <b>MOON ADVENTURE</b>
            <span>合作角色扮演</span>
          </span>
        </div>
        <button class="lv2-rules" type="button" onclick="showRules()">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4.5 5.6A2.6 2.6 0 0 1 7.1 3H11v15.5H7.1a2.6 2.6 0 0 0-2.6 2.6V5.6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M19.5 5.6A2.6 2.6 0 0 0 16.9 3H13v15.5h3.9a2.6 2.6 0 0 1 2.6 2.6V5.6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
          <span>规则</span>
        </button>
      </header>

      <main class="lv2-main">
        <div class="lv2-side">
          <section class="lv2-copy" aria-labelledby="lv2-title">
            <p class="lv2-eyebrow">
              <span class="lv2-live-dot" aria-hidden="true"></span>
              ${isOnline ? 'ONLINE' : 'LOCAL'}
              <span class="lv2-sep">/</span> 2–5 PLAYERS
            </p>
            <h1 class="lv2-title" id="lv2-title">月面探险</h1>
            <p class="lv2-tagline">氧气就是行动力，<br><em>一起返回基地。</em></p>
            <div class="lv2-meta" aria-label="游戏特色" style="display:none;">
              <span><i class="lv2-dot lv2-dot--o2" aria-hidden="true"></i>氧气行动力</span>
              <span><i class="lv2-dot lv2-dot--team" aria-hidden="true"></i>团队共享</span>
              <span><i class="lv2-dot lv2-dot--storm" aria-hidden="true"></i>磁暴生存</span>
            </div>
          </section>

          <div class="lv2-actions">
            <button class="lv2-cta ${isOnline ? 'lv2-cta--online' : 'lv2-cta--solo'}" type="button"
              onclick="${isOnline ? 'showOnlineLobby()' : 'showSetup()'}">
              <span class="lv2-cta-icon" aria-hidden="true">${ctaIcon}</span>
              <span class="lv2-cta-text">
                <b>${isOnline ? '联机模式' : '开始探险'}</b>
                <small>${isOnline ? '创建或加入房间 · 实时协作' : '2–5人同屏合作 · 立即出发'}</small>
              </span>
              <span class="lv2-cta-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
            </button>
            <p class="lv2-action-hint">和队友一起，把物资带回基地</p>
          </div>
        </div>

        <div class="lv2-art" aria-hidden="true">
          ${renderLandingScene()}
        </div>
      </main>

      <footer class="lv2-foot">
        <span class="lv2-foot-line" aria-hidden="true"></span>
        <span>@imStar100</span>
        <span class="lv2-foot-line" aria-hidden="true"></span>
      </footer>
    </div>`;
}

/** 首页月面航线插画（纯装饰，所有图形本地 SVG 绘制） */
function renderLandingScene() {
  return `
    <svg class="lv2-scene" viewBox="0 0 960 620" fill="none" xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMax meet" focusable="false">
      <defs>
        <radialGradient id="mv2Halo" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#6fb9ff" stop-opacity=".24"/>
          <stop offset=".45" stop-color="#3f7be0" stop-opacity=".09"/>
          <stop offset="1" stop-color="#3f7be0" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="mv2Crater" cx="42%" cy="38%" r="64%">
          <stop offset="0" stop-color="#0a1020" stop-opacity=".46"/>
          <stop offset=".7" stop-color="#0a1020" stop-opacity=".2"/>
          <stop offset="1" stop-color="#0a1020" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="mv2Earth" cx="34%" cy="28%" r="82%">
          <stop offset="0" stop-color="#b8f1ff"/>
          <stop offset=".4" stop-color="#4aa9ee"/>
          <stop offset=".8" stop-color="#1d6cb4"/>
          <stop offset="1" stop-color="#123f6f"/>
        </radialGradient>
        <radialGradient id="mv2EarthShade" cx="36%" cy="30%" r="76%">
          <stop offset=".52" stop-color="#04101f" stop-opacity="0"/>
          <stop offset="1" stop-color="#04101f" stop-opacity=".6"/>
        </radialGradient>
        <linearGradient id="mv2Ground" x1="480" y1="430" x2="480" y2="620" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#2b3554"/>
          <stop offset=".3" stop-color="#1a2239"/>
          <stop offset=".72" stop-color="#101629"/>
          <stop offset="1" stop-color="#080c17"/>
        </linearGradient>
        <linearGradient id="mv2Route" x1="200" y1="510" x2="820" y2="430" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ffd166"/>
          <stop offset=".38" stop-color="#9ae8ff"/>
          <stop offset="1" stop-color="#51b9ff"/>
        </linearGradient>
        <linearGradient id="mv2Dome" x1="-30" y1="-28" x2="40" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#dbe5f5"/>
          <stop offset=".55" stop-color="#8c9bbc"/>
          <stop offset="1" stop-color="#485573"/>
        </linearGradient>
        <linearGradient id="mv2Visor" x1="-6" y1="-42" x2="7" y2="-30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#7fe3ff"/>
          <stop offset=".6" stop-color="#2c8fca"/>
          <stop offset="1" stop-color="#133b5f"/>
        </linearGradient>
        <linearGradient id="mv2Beam" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#7fe3ff" stop-opacity=".4"/>
          <stop offset="1" stop-color="#7fe3ff" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="mv2Headlight" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ffe6a8" stop-opacity=".5"/>
          <stop offset="1" stop-color="#ffe6a8" stop-opacity="0"/>
        </linearGradient>
        <radialGradient id="mv2WarmGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#ffd166" stop-opacity=".45"/>
          <stop offset="1" stop-color="#ffd166" stop-opacity="0"/>
        </radialGradient>
        <filter id="mv2Glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="mv2Haze" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="10"/>
        </filter>

        <clipPath id="mv2EarthClip">
          <circle r="62"/>
        </clipPath>

        <g id="mv2Astronaut">
          <ellipse cx="0" cy="1" rx="14" ry="4" fill="#040810" opacity=".5"/>
          <path d="M-6 -8-8 0M6 -8l2 8" stroke="#cdd9ed" stroke-width="5" stroke-linecap="round"/>
          <rect x="-10" y="-28" width="20" height="23" rx="9" fill="#e8effb"/>
          <rect x="-16" y="-25" width="7" height="17" rx="3.5" fill="#93a5c4"/>
          <path d="M9 -18l8 9" stroke="#d6e1f2" stroke-width="5" stroke-linecap="round"/>
          <circle cx="0" cy="-38" r="10.5" fill="#f4f8ff"/>
          <path d="M-9 -39c2.5-3 13-3 16 1-2.5 4-13 4-16-1Z" fill="url(#mv2Visor)"/>
          <rect x="-5" y="-23" width="10" height="3" rx="1.5" fill="#f5c518" opacity=".85"/>
          <path d="M-3 -30h6" stroke="#aab9d4" stroke-width="1" opacity=".7"/>
        </g>
      </defs>

      <circle class="mv2-halo" cx="748" cy="198" r="168" fill="url(#mv2Halo)"/>

      <!-- 星野点缀（页面底层已有星野，这里只补少量亮星） -->
      <g class="mv2-sky" fill="#cddfff">
        <circle cx="262" cy="118" r="1.3" opacity=".55"/>
        <circle cx="404" cy="72" r="1" opacity=".4"/>
        <circle cx="544" cy="132" r="1.6" opacity=".5"/>
        <circle cx="612" cy="66" r="1.1" opacity=".35"/>
        <path d="M342 104v9M337.5 108.5h9" stroke="#cddfff" stroke-width=".9" opacity=".4"/>
        <path d="M636 158v7M632.5 161.5h7" stroke="#cddfff" stroke-width=".8" opacity=".3"/>
      </g>

      <!-- 地球：月面天空里唯一的星球 -->
      <g class="mv2-earth" transform="translate(748 198)">
        <circle r="112" fill="#4ea7ff" opacity=".045"/>
        <circle r="86" fill="#4ea7ff" opacity=".04"/>
        <circle r="62" fill="url(#mv2Earth)"/>
        <g clip-path="url(#mv2EarthClip)">
          <path d="M-38-36c12-9 26-7 33 2 6 8-2 16-12 19-10 3-11 10-21 9-10-1-15-7-13-16 1-7 6-11 13-14Z" fill="#6aa981" opacity=".85"/>
          <path d="M6 0c11-6 24-3 30 7 5 9-1 19-11 23-11 5-23 0-25-10-2-10 1-15 6-20Z" fill="#74b089" opacity=".8"/>
          <path d="M-24 32c7-4 15-1 17 6 2 8-4 14-12 13-8-1-12-7-10-13 1-3 2-5 5-6Z" fill="#5f9c76" opacity=".72"/>
          <path d="M-54-16c21-8 44-4 64 5M-47 21c23-9 48-6 70 3M-16-54c13 9 27 12 42 11" stroke="#e9f9ff" stroke-width="5" stroke-linecap="round" opacity=".3"/>
          <path d="M-54-16c21-8 44-4 64 5M-47 21c23-9 48-6 70 3" stroke="#e2f7ff" stroke-width="2.2" stroke-linecap="round" opacity=".6"/>
          <circle r="62" fill="url(#mv2EarthShade)"/>
          <ellipse cx="-25" cy="-29" rx="22" ry="14" fill="#d8f5ff" opacity=".12" transform="rotate(-30 -25 -29)"/>
        </g>
        <circle r="62" fill="none" stroke="#a9e9ff" stroke-opacity=".55" stroke-width="1.3"/>
        <circle r="67" fill="none" stroke="#7fe3ff" stroke-opacity=".13" stroke-width="3"/>
      </g>

      <!-- 月面地形 -->
      <path d="M0 452C120 430 225 434 330 424c125-12 210 6 310-6 115-14 220 0 320-12v214H0Z" fill="#0a0f1d"/>
      <ellipse cx="610" cy="444" rx="330" ry="28" fill="#6f84b8" opacity=".05" filter="url(#mv2Haze)"/>
      <g class="mv2-ridges" fill="#0e1626">
        <path d="M108 458l30-19 24 10 28-17 22 14 18-6v18H108Z" opacity=".72"/>
        <path d="M520 455l36-24 27 13 42-27 36 22 32-12v30H520Z" opacity=".8"/>
        <path d="M748 449l27-18 22 10 31-20 35 21 28-7v20H748Z" opacity=".75"/>
      </g>
      <g stroke="#8ea0c9" stroke-opacity=".13" stroke-width="1" fill="none">
        <path d="M556 431l42-27 36 22 28-10"/>
        <path d="M828 415l35 21 28-7"/>
        <path d="M114 439l30-19 24 10 20-9"/>
      </g>
      <path d="M0 483c120-24 240-16 360-14 140 2 240-28 350-30 115-2 195 12 250 20v161H0Z" fill="url(#mv2Ground)"/>
      <path d="M0 483c120-24 240-16 360-14 140 2 240-28 350-30 115-2 195 12 250 20" stroke="#8ea0c9" stroke-opacity=".2" stroke-width="1.2" fill="none"/>
      <path d="M0 548c150-20 300 4 470-8 180-12 330-28 490-8v88H0Z" fill="#090e1b" opacity=".5"/>

      <g class="mv2-ground-detail">
        <ellipse cx="255" cy="556" rx="64" ry="11" fill="url(#mv2Crater)"/>
        <path d="M200 552a62 10 0 0 0 112-4" stroke="#8ea0c9" stroke-opacity=".13" fill="none"/>
        <ellipse cx="782" cy="548" rx="88" ry="13" fill="url(#mv2Crater)"/>
        <path d="M704 544a84 11 0 0 0 158-3" stroke="#8ea0c9" stroke-opacity=".15" fill="none"/>
        <ellipse cx="700" cy="586" rx="36" ry="7" fill="url(#mv2Crater)"/>
        <path d="M672 583a33 6 0 0 0 56-2" stroke="#8ea0c9" stroke-opacity=".1" fill="none"/>
        <ellipse cx="512" cy="516" rx="30" ry="6" fill="#080d18" opacity=".4"/>
        <ellipse cx="888" cy="494" rx="40" ry="8" fill="#080d18" opacity=".35"/>
        <path d="M338 540l8-9 12 5-3 11-12 2z" fill="#1d2740" stroke="#7d8fb5" stroke-opacity=".14"/>
        <path d="M852 566l6-8 10 4 1 8-9 3z" fill="#1b243b" stroke="#7d8fb5" stroke-opacity=".12"/>
        <path d="M170 588l5-7 9 3 1 7-8 3z" fill="#1b243b" stroke="#7d8fb5" stroke-opacity=".1"/>
      </g>

      <!-- 任务航线 -->
      <path d="M208 512c40-18 80-20 120-10s80 6 120-8c44-16 82-18 120-6 44 14 80-6 114-24 36-18 72-16 110-20"
        stroke="#59caff" stroke-opacity=".055" stroke-width="26" stroke-linecap="round"/>
      <path d="M208 512c40-18 80-20 120-10s80 6 120-8c44-16 82-18 120-6 44 14 80-6 114-24 36-18 72-16 110-20"
        stroke="#59caff" stroke-opacity=".13" stroke-width="7" stroke-linecap="round"/>
      <path class="mv2-route-line"
        d="M208 512c40-18 80-20 120-10s80 6 120-8c44-16 82-18 120-6 44 14 80-6 114-24 36-18 72-16 110-20"
        stroke="url(#mv2Route)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="2 12"/>

      <g class="mv2-waypoints" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#9eb8d8">
        <g transform="translate(328 502)">
          <circle r="9" fill="#0a1220" stroke="#7fe3ff" stroke-opacity=".55" stroke-width="1.3"/>
          <circle r="2.5" fill="#a9efff"/>
        </g>
        <text x="328" y="486" font-size="8.5" letter-spacing="1.5" text-anchor="middle" opacity=".78">01</text>
        <g transform="translate(568 488)">
          <circle r="9" fill="#0a1220" stroke="#7fe3ff" stroke-opacity=".5" stroke-width="1.3"/>
          <circle r="2.5" fill="#a9efff"/>
        </g>
        <text x="568" y="472" font-size="8.5" letter-spacing="1.5" text-anchor="middle" opacity=".72">02</text>
        <g transform="translate(718 455)">
          <circle r="9" fill="#0a1220" stroke="#7fe3ff" stroke-opacity=".45" stroke-width="1.3"/>
          <circle r="2.5" fill="#a9efff"/>
        </g>
        <text x="718" y="439" font-size="8.5" letter-spacing="1.5" text-anchor="middle" opacity=".68">03</text>
      </g>

      <!-- 基地 -->
      <g class="mv2-base" transform="translate(142 512)">
        <ellipse cx="8" cy="20" rx="84" ry="21" fill="url(#mv2WarmGlow)" opacity=".8"/>
        <ellipse cx="4" cy="18" rx="56" ry="11" fill="#050810" opacity=".7"/>
        <path d="M-40 17a40 33 0 0 1 80 0Z" fill="url(#mv2Dome)"/>
        <path d="M-40 17a40 33 0 0 1 80 0" stroke="#c4d0e6" stroke-opacity=".35"/>
        <path d="M-31 3Q0 9 31 3" stroke="#7384a8" stroke-opacity=".5" fill="none"/>
        <circle cx="0" cy="-7" r="12" fill="#1b2742" stroke="#91a3c4" stroke-opacity=".55"/>
        <circle cx="0" cy="-7" r="8.5" fill="#ffd166"/>
        <circle cx="-3" cy="-10" r="3.5" fill="#fff4cc" opacity=".9"/>
        <rect x="19" y="2" width="12" height="15" rx="5" fill="#101728" stroke="#8b9dbc" stroke-opacity=".45"/>
        <path d="M-22-22-34-53" stroke="#a9b7d4" stroke-width="1.4" stroke-linecap="round"/>
        <circle class="mv2-base-light" cx="-35" cy="-56" r="3" fill="#ff7b7b"/>
        <path d="M22-20v-29" stroke="#c9d6ef" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M23-49 44-44 23-38Z" fill="#f5c518"/>
        <text x="4" y="34" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="8" letter-spacing="2.5" fill="#6f80a2">BASE / 01</text>
      </g>

      <!-- OGS 信标 -->
      <g class="mv2-ogs" transform="translate(804 446)">
        <rect class="mv2-beacon-beam" x="-15" y="-112" width="30" height="62" rx="15" fill="url(#mv2Beam)"/>
        <ellipse cx="0" cy="12" rx="44" ry="11" fill="#5ad8ff" opacity=".08"/>
        <ellipse class="mv2-beacon-ring" cx="0" cy="12" rx="26" ry="7" stroke="#7fe3ff" stroke-opacity=".45" fill="none"/>
        <ellipse cx="0" cy="12" rx="14" ry="4" stroke="#9cecff" stroke-opacity=".5" fill="none"/>
        <path d="M0 12v-58" stroke="#a6b8d8" stroke-width="4" stroke-linecap="round"/>
        <path d="M-17-33h34M-12-23h24" stroke="#a6b8d8" stroke-opacity=".55" stroke-width="1.2"/>
        <circle class="mv2-beacon-core" cx="0" cy="-48" r="9" fill="#7fe3ff" filter="url(#mv2Glow)"/>
        <circle cx="0" cy="-48" r="4" fill="#f3ffff"/>
        <text x="0" y="34" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="8" letter-spacing="2.5" fill="#7fe3ff" opacity=".65">OGS</text>
      </g>

      <!-- 月球车 -->
      <g class="mv2-rover" transform="translate(650 478)">
        <ellipse cx="0" cy="16" rx="40" ry="8" fill="#040810" opacity=".55"/>
        <g class="mv2-rover-light">
          <path d="M30-6 88-24v40Z" fill="url(#mv2Headlight)"/>
        </g>
        <g stroke="#7082a8" stroke-opacity=".18" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round">
          <path d="M-34 18c-24 2-48-1-70 2"/>
        </g>
        <circle cx="-23" cy="9" r="11" fill="#0a101e" stroke="#6f81a7" stroke-width="2"/>
        <circle cx="-23" cy="9" r="4" fill="#98a9c9"/>
        <circle cx="24" cy="9" r="11" fill="#0a101e" stroke="#6f81a7" stroke-width="2"/>
        <circle cx="24" cy="9" r="4" fill="#98a9c9"/>
        <path d="M-34 4Q-36-12-22-17h40Q32-14 34 2l-3 7Q0 15-32 9Z" fill="#dbe5f4" stroke="#91a3c4"/>
        <path d="M-14-13H7l5 11h-28Z" fill="#12233c" stroke="#7fe3ff" stroke-opacity=".4"/>
        <rect x="-26" y="-24" width="34" height="8" rx="3" fill="#2c3a5c" stroke="#9aaccb" stroke-opacity=".6"/>
        <path d="M-26-20h34" stroke="#7fe3ff" stroke-opacity=".2"/>
        <circle cx="28" cy="-4" r="3" fill="#ffd166"/>
      </g>

      <!-- 宇航员 -->
      <use href="#mv2Astronaut" transform="translate(414 522) scale(.96)"/>
      <use href="#mv2Astronaut" transform="translate(588 506) scale(-.84 .84)"/>

      <!-- 物资牌 -->
      <g class="mv2-supply" transform="translate(292 466) rotate(-8)">
        <ellipse cx="2" cy="21" rx="21" ry="6" fill="#040810" opacity=".55"/>
        <rect x="-20" y="-20" width="40" height="40" rx="9" fill="#f6efe1" stroke="#fffaf0" stroke-opacity=".55"/>
        <path d="M0-11 11 7h-22Z" fill="#ff9f43" stroke="#e07a1f" stroke-width="1.2" stroke-linejoin="round"/>
        <text x="12" y="15" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="8" fill="#8a7761">3</text>
      </g>
      <g class="mv2-supply" transform="translate(484 456) rotate(8)">
        <ellipse cx="2" cy="21" rx="21" ry="6" fill="#040810" opacity=".55"/>
        <rect x="-20" y="-20" width="40" height="40" rx="9" fill="#f6efe1" stroke="#fffaf0" stroke-opacity=".55"/>
        <path d="M0-11 11 0 0 11-11 0Z" fill="#ffb05a" stroke="#db8a2b" stroke-width="1.2" stroke-linejoin="round"/>
        <text x="12" y="15" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="8" fill="#8a7761">4</text>
      </g>
      <g class="mv2-supply" transform="translate(710 414) rotate(-6)">
        <ellipse cx="2" cy="21" rx="21" ry="6" fill="#040810" opacity=".55"/>
        <rect x="-20" y="-20" width="40" height="40" rx="9" fill="#f6efe1" stroke="#fffaf0" stroke-opacity=".55"/>
        <path d="M0-12 11.4-3.7 7 9.7H-7L-11.4-3.7Z" fill="#ffd166" stroke="#d9a42c" stroke-width="1.2" stroke-linejoin="round"/>
        <text x="12" y="15" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="8" fill="#8a7761">5</text>
      </g>

      <!-- 磁暴预警：远景极小提示 -->
      <g class="mv2-storm" transform="translate(884 128)">
        <circle r="18" fill="#ff6b6b" opacity=".05"/>
        <circle class="mv2-storm-dot" r="3.2" fill="#ff7b7b"/>
        <circle r="10" stroke="#ff7b7b" stroke-opacity=".32" stroke-dasharray="2 5" fill="none"/>
      </g>
    </svg>`;
}

// ========================================
// 设置页（玩家昵称）
// ========================================

/** 渲染玩家设置页面 */
function renderSetup() {
  const chips = setupNames.map((n, i) =>
    `<span class="setup-chip">
      <span class="setup-dot" style="background:${PLAYER_COLORS[i]}"></span>
      ${n}
      <span class="setup-rm" onclick="removePlayer(${i})">✕</span>
    </span>`
  ).join('');

  return `
    <div class="setup">
      <div class="setup-header">
        <h1>🌕️ 月面探险</h1>
        <button class="back-btn" onclick="showLanding()">← 返回</button>
      </div>
      <h2>添加玩家</h2>
      <p class="setup-hint">2~5 名玩家，输入昵称后添加</p>
      <div class="setup-input-row">
        <input id="name-input" placeholder="玩家昵称" maxlength="8"
          onkeydown="if(event.key==='Enter')addPlayer()">
        <button onclick="addPlayer()">添加</button>
      </div>
      <div class="setup-chips">${chips}</div>
      <label class="setup-ext">
        <input type="checkbox" ${useExtension ? 'checked' : ''} onchange="setUseExtension(this.checked)">
        <span class="setup-ext-mark" style="display:none;">🌙</span> 使用扩展角色
      </label>
      <button class="btn-full btn-primary" onclick="startGame()"
        ${setupNames.length < 2 ? 'disabled style="opacity:.4"' : ''}>
        开始探险（${setupNames.length}人）
      </button>
    </div>`;
}

/** 从设置页返回着陆页 */
function showLanding() {
  S.phase = 'landing';
  render();
}

/** 开始游戏（从设置页） */
function startGame() {
  if (setupNames.length < 2) return;
  dealGame([...setupNames], useExtension);
  render();
}

// ========================================
// 游戏主界面
// ========================================

/** 渲染游戏主界面 */
function renderGame() {
  let h = '';

  // 游戏标题栏
  h += renderHeader();

  // 统计面板
  h += renderStatsPanel();  

  // 玩家列表
  h += renderPlayerStrip();
  
  // 胜利/失败横幅
  if (S.gameOver) {
    h += renderEndBanner();
  }

  // 骰子/行动区域（游戏结束后隐藏）
  if (!S.gameOver) {
    h += renderDiceArea();
  }

  // 月面地图
  h += renderBoard();

  return h;
}

// ========================================
// 标题栏
// ========================================

function renderHeader() {
  return `
    <div class="game-header">
      <h2>🌕️ 月面探险</h2>
      <div style="display:flex;gap:6px">
        <button class="icon-btn" onclick="resetGame()">🔄 重置</button>
        <button class="icon-btn" onclick="showRules()">📖 规则</button>
      </div>
    </div>`;
}

// ========================================
// 胜利/失败横幅
// ========================================

function renderEndBanner() {
  if (S.gameResult === 'win') {
    const { total } = countIntactSupplies();
    const target = WIN_CONDITIONS[S.playerCount];
    return `
      <div class="victory-banner">
        <h2>🎉 任务成功！</h2>
        <p>完好物资 ${total} 个 ≥ 目标 ${target} 个</p>
      </div>`;
  } else {
    return `
      <div class="failure-banner">
        <h2>💀 任务失败</h2>
        <p>完好物资不足或氧气耗尽</p>
      </div>`;
  }
}

// ========================================
// 玩家列表条（顶部）
// ========================================

/** 渲染顶部玩家列表条 */
function renderPlayerStrip() {
  const playerItems = S.players.map((p, i) => {
    const isActive = i === S.currentPlayer;
    const slotsHtml = renderSlotBar(p, i);
    return `
      <div class="ps-player ${isActive ? 'active' : ''} ${p.returned ? 'returned' : ''}"
           onclick="showPlayerDetail(${i})">
        <div class="ps-color" style="background:${p.color}"></div>
        <span class="ps-name">${p.name}</span>
        <span class="ps-role"><!--${p.role.icon} -->${p.role.name}</span>
        <div class="ps-slots">${slotsHtml}</div>
      </div>`;
  }).join('');

  return `
    <div class="player-strip">
      <div class="player-strip-title">
        👥 玩家列表 · 当前回合: 
        <strong style="color:${currentPlayer().color}">${currentPlayer().name}</strong>
        ${currentPlayer().returned ? ' (已返回基地)' : ''}
      </div>
      ${playerItems}
    </div>`;
}

/** 根据物资的区域生成对应的 SVG 形状图标 */
function supplyIcon(supply, size, colorOverride) {
  const z = ZONES.find(zone => zone.id === supply.zone);
  if (!z) return '?';
  const fill = colorOverride || z.fill;
  const stroke = colorOverride ? colorOverride : darken(z.color);
  return shapeSVG(z.shape, fill, stroke);
}

/** 渲染单个玩家的存储槽指示器 */
function renderSlotBar(player, pi) {
  // 本次状态diff中该玩家新增的氧气/物资槽位（pop动画）
  const anim = _animCtx && _animCtx.diff;
  const popBar = anim ? new Set([
    ...anim.newO2.filter(x => x.pi === pi).map(x => x.si),
    ...anim.newSupplies.filter(x => x.pi === pi).map(x => player.oxygen.length + x.si),
  ]) : new Set();
  let h = '';
  for (let i = 0; i < player.slots; i++) {
    if (i < player.oxygen.length) {
      const card = player.oxygen[i];
      h += `<div class="ps-slot filled-o2${card.val === 3 ? ' val3' : ''}${popBar.has(i) ? ' slot-pop' : ''}">O</div>`;
    } else if (i < player.oxygen.length + player.supplies.length) {
      const sup = player.supplies[i - player.oxygen.length];
      const color = (S.gameOver || sup.revealed) ? (sup.intact ? '#4caf50' : '#f44336') : undefined;
      h += `<div class="ps-slot filled-sup${popBar.has(i) ? ' slot-pop' : ''}">${supplyIcon(sup, 14, color)}</div>`;
    } else {
      h += '<div class="ps-slot empty"></div>';
    }
  }
  return h;
}

// ========================================
// 骰子/行动区域（中部）
// ========================================

/** 渲染骰子和行动面板 */
function renderDiceArea() {
  const p = currentPlayer();
  let h = '<div class="dice-area">';
  h += `<h3><span style="color:${p.color}">●</span> ${p.name} 的回合</h3>`;

  if (p.returned) {
    // 已返回基地，跳过
    h += `<p class="dice-prompt">${p.name} 已返回基地，跳过回合</p>`;
    h += `<button class="act-btn btn-end" style="width:100%;margin-top:8px" onclick="endTurn()">下一位玩家</button>`;
  } else if (p.oxygen.length === 0 && S.turnPhase === 'idle' && !S.isRescue) {
    // 无氧气，等待救援面板
    h += `<p class="dice-prompt text-danger">⚠ 氧气耗尽！等待 <span class="rescue-link" onclick="showRescueSelect()">紧急救援</span> ...</p>`;
  } else if (S.turnPhase === 'idle') {
    // 等待打出氧气卡
    // 工程师：移动机器人（掷骰前可选）
    if (p.role.id === 'engineer' && !S.robotMoved) {
      h += `<button class="act-btn btn-robot" style="width:100%;margin-bottom:8px;background:linear-gradient(135deg,#1b5e20,#2e7d32);border:2px solid #4caf50"
        onclick="openRobotMoveSheet()">
        🤖 移动机器人 <span class="cost">免费</span></button>`;
    }
    h += `<p class="dice-prompt">选择一张氧气卡打出</p>`;
    h += '<div class="dice-o2-select">';
    p.oxygen.forEach((c, i) => {
      h += `<div class="dice-o2-card ${c.val === 3 ? 'val3' : 'val2'}"
             onclick="discardOxygen(${i})">O₂ ×${c.val}</div>`;
    });
    h += '</div>';
    if (p.oxygen.length === 0) {
      h += '<p class="dice-prompt text-danger">⚠ 无氧气卡！检查失败条件</p>';
      h += `<button class="act-btn btn-end" style="width:100%;margin-top:8px" onclick="endTurn()">结束回合</button>`;
    }
  } else if (S.turnPhase === 'spent' && !S.isDrawing) {
    // 已掷骰子，显示结果和行动按钮
    h += renderDiceResult();
    h += renderActionPanel();
  }

  // OGS抽取状态
  if (S.isDrawing) {
    h += renderOGSDrawArea();
  }

  h += '</div>';
  return h;
}

/** 渲染骰子结果 */
function dieSVG(val) {
  if (!val) return '<div class="die blank"></div>';
  const pips = {
    1: [[50, 50]],
    2: [[30, 30], [70, 70]],
    3: [[28, 28], [50, 50], [72, 72]],
  }[val] || [];
  return `<div class="die">${pips.map(([x, y]) => `<span class="pip" style="left:${x}%;top:${y}%"></span>`).join('')}</div>`;
}

function renderDiceResult() {
  const diceHtml = S.dice.map(d => dieSVG(d)).join('');
  const p = currentPlayer();
  const hasBonus = p.role.id === 'atmosphere' && S.ap > S.dice.reduce((a, b) => a + b, 0);
  // 先锋：活跃OGS上加成（仅掷骰时标记，防止回合中途走到OGS上误显示）
  const hasPioneerBonus = !!S.pioneerBonusApplied;
  // 技术员：行动前可重掷（本回合未重掷过且尚未执行任何行动）
  const canReroll = p.role.id === 'technician' && !S.rerollUsed &&
    (!S.moveHistory || S.moveHistory.length === 0);

  return `
    <div class="dice-row">${diceHtml}</div>
    <!-- <div class="dice-total">行动点: ${S.diceTotal} AP</div> -->
    ${hasBonus ? '<div class="dice-bonus">🎉 气氛组加成 +3 !</div>' : ''}
    ${hasPioneerBonus ? '<div class="dice-bonus">🚩 先锋加成 +2 !</div>' : ''}
    ${canReroll ? `<button class="act-btn btn-reroll" style="width:100%;margin-top:6px;background:linear-gradient(135deg,#4a148c,#6a1b9a);border:2px solid #ab47bc"
      onclick="rerollDice()">🎲 技术员·重掷骰子</button>` : ''}
    <div class="ap-display">剩余 AP: <strong>${S.ap}</strong></div>`;
}

// ========================================
// 行动按钮面板
// ========================================

/** 渲染行动按钮 */
function renderActionPanel() {
  const p = currentPlayer();
  const onRover = p.onRover;
  const reach = getMoveReach(p.pos);
  const ogsGap = getPlayerOGS();
  const adj = getAdjacentTiles(p.pos);

  let h = '<div class="action-panel"><div class="action-btns">';

  // 移动（点选地图可达格，支付AP直达；进入时收起更多悬浮窗）
  const canMove = S.ap >= 1 && (reach.targets.length > 0 || reach.base !== null);
  h += `<button class="act-btn${moveMode ? ' active' : ''}" ${canMove ? '' : 'disabled'}
    onclick="hideMoreSheet();toggleMoveMode()">
    🚶 移动 <span class="cost">1AP起</span></button>`;

  // 更多（悬浮窗开关）
  h += `<button class="act-btn${moreOpen ? ' active' : ''}" id="moreBtn" onclick="exitMoveMode();toggleMoreSheet()">
    ⋯ 更多 <span class="cost">▾</span></button>`;

  // 结束回合
  h += `<button class="act-btn btn-end" onclick="exitMoveMode();endTurn()">
    ✅ 结束回合</button>`;

  h += '</div>';

  // ===== 更多悬浮窗（低频行动，一行一个）=====
  h += `<div class="more-sheet" id="moreSheet" style="display:${moreOpen ? 'block' : 'none'}">`;

  if (!onRover) {
    // 物资回收（仅非月球车状态）
    const collectCost = p.role.id === 'veteran' ? 2 : 3;
    const adjSeq = getAdjacentSeqPositions(p.pos);
    const hasDiscardedAdj = adjSeq.some(pathIdx => {
      const el = S.path[pathIdx];
      return el && el.type === 'discarded' && !el.picked &&
        !S.accelMarks.includes(pathIdx) &&
        !S.players.some(pl => pl.pos === pathIdx && !pl.returned) &&
        !(S.hasEngineer && S.robotPos === pathIdx);
    });
    const canCollect = (S.ap >= collectCost && freeSlots(p) > 0) && (
      adj.some(t => !S.tiles[t].picked && !S.accelMarks.includes(tilePathIdx(t)) &&
        !S.players.some(pl => pathToTileIdx(pl.pos) === t && !pl.returned) &&
        !(S.hasEngineer && pathToTileIdx(S.robotPos) === t)) ||
      hasDiscardedAdj
    );
    h += `<button class="act-btn" ${canCollect ? '' : 'disabled'}
      onclick="hideMoreSheet();exitMoveMode();openCollectSheet()">
      📦 物资回收 <span class="cost">${collectCost}AP</span></button>`;

    // 放置加速标记（前/后的板块、损毁OGS或丢弃物资上）
    const accelCost = (p.role.id === 'inventor' && !S.accelPlacedThisTurn) ? 1 : 2;
    const accelSeq = S.path;
    const canPlaceFwd = p.pos + 1 < accelSeq.length &&
      !S.accelMarks.includes(p.pos + 1) &&
      (isPathTile(p.pos + 1) || (isPathOGS(p.pos + 1) && !S.path[p.pos + 1].active) ||
        isPathDiscarded(p.pos + 1));
    const canPlaceBwd = p.pos - 1 >= 0 &&
      !S.accelMarks.includes(p.pos - 1) &&
      (isPathTile(p.pos - 1) || (isPathOGS(p.pos - 1) && !S.path[p.pos - 1].active) ||
        isPathDiscarded(p.pos - 1));
    const canAccel = S.ap >= accelCost && !p.onRover && S.accelMarks.length < 10 &&
      (canPlaceFwd || canPlaceBwd);
    h += `<button class="act-btn" ${canAccel ? '' : 'disabled'}
      onclick="hideMoreSheet();exitMoveMode();placeAccelMark()">
      ⚡ 加速标记 <span class="cost">${accelCost}AP</span></button>`;

    // 建立OGS（必须在板块、损毁OGS芯片或丢弃物资上）
    const ogsCost = (p.role.id === 'builder' && !S.ogsBuilt) ? 1 : 3;
    const playerTile = pathToTileIdx(p.pos);
    const onOGS = playerTile === null && isPathOGS(p.pos);
    const onDiscarded = playerTile === null && isPathDiscarded(p.pos);
    const canOGS = S.ap >= ogsCost && (playerTile !== null || onOGS || onDiscarded) && S.ogsCount < 5;
    h += `<button class="act-btn" ${canOGS ? '' : 'disabled'}
      onclick="hideMoreSheet();exitMoveMode();openOGSSheet()">
      🔵 建立OGS <span class="cost">${ogsCost}AP</span></button>`;

    // 鉴定师：翻开自己1张物资牌
    if (p.role.id === 'appraiser' && !S.appraiseUsed && p.supplies.length > 0) {
      h += `<button class="act-btn" ${S.ap >= 1 ? '' : 'disabled'}
        onclick="hideMoreSheet();exitMoveMode();openAppraiseSheet()">
        🔍 鉴定物资 <span class="cost">1AP</span></button>`;
    }
  }

  // 共享物资（后勤：每回合首次免费）
  const adjSeq = getAdjacentSeqPositions(p.pos);
  const adjPlayers = S.players.filter((other, i) => {
    if (i === S.currentPlayer || other.returned) return false;
    if (p.pos >= 0 && other.pos === p.pos) return true;
    return adjSeq.includes(other.pos);
  });
  const shareCost = (p.role.id === 'logistician' && !S.shareUsed) ? 0 : 1;
  const canShare = S.ap >= shareCost && adjPlayers.length > 0;
  h += `<button class="act-btn" ${canShare ? '' : 'disabled'}
    onclick="hideMoreSheet();exitMoveMode();openShareSelectSheet()">
    🤝 共享 <span class="cost">${shareCost === 0 ? '免费' : '1AP'}</span></button>`;

  // 丢弃物资
  const canDiscard = S.ap >= 1 && p.supplies.length > 0 && p.pos >= 0;
  h += `<button class="act-btn" ${canDiscard ? '' : 'disabled'}
    onclick="hideMoreSheet();exitMoveMode();openDiscardSheet()">
    🗑️ 丢弃物资 <span class="cost">1AP</span></button>`;

  // OGS补给（始终展示，仅条件满足时可点击）
  const canOGS = ogsGap !== null && !S.isDrawing && freeSlots(p) > 0;
  h += `<button class="act-btn btn-ogs" ${canOGS ? '' : 'disabled'}
    onclick="hideMoreSheet();exitMoveMode();tryOGSDraw()">
    🫧 OGS补给</button>`;

  // 撤回移动（仅当上一步是移动且玩家仍在该位置时可撤回）
  const lastMove = S.moveHistory && S.moveHistory.length
    ? S.moveHistory[S.moveHistory.length - 1] : null;
  const canUndo = !p.returned && !!lastMove && lastMove.type === 'move' && lastMove.to === p.pos;
  h += `<button class="act-btn" ${canUndo ? '' : 'disabled'}
    onclick="hideMoreSheet();exitMoveMode();undoMove()">
    ↩️ 撤回移动</button>`;

  h += '</div></div>';
  return h;
}

/** 更多悬浮窗是否打开（render重建后保持状态） */
let moreOpen = false;

// ========================================
// 移动模式（点选地图目标格，支付AP直达）
// ========================================

/** 移动模式状态：null 未激活；{ targets:[{pathPos,cost}], base:number|null } */
let moveMode = null;

/** 进入移动模式：计算当前玩家所有可达格 */
function enterMoveMode() {
  const p = currentPlayer();
  if (S.turnPhase !== 'spent' || S.ap < 1) return;
  moveMode = getMoveReach(p.pos);
  if (!moveMode.targets.length && moveMode.base === null) { moveMode = null; return; }
  render();
}

/** 退出移动模式 */
function exitMoveMode() {
  if (moveMode) { moveMode = null; render(); }
}

/** 切换移动模式 */
function toggleMoveMode() {
  moveMode ? exitMoveMode() : enterMoveMode();
}

/** 点击可达格：支付AP移动到该格（基地走原确认弹窗） */
function onMoveTargetClick(targetPathPos) {
  if (!moveMode) return;
  const p = currentPlayer();
  const t = moveMode.targets.find(x => x.pathPos === targetPathPos);
  const cost = t ? t.cost : (targetPathPos === -1 ? moveMode.base : null);
  if (cost === null || S.ap < cost) return;
  const baseCost = moveMode.base;
  // 确认弹窗（返回基地/月球车）：保留moveMode，取消后仍可继续选择其他目标
  if (targetPathPos === -1) { showReturnBaseConfirm(baseCost); return; }
  const direction = targetPathPos > p.pos ? 'forward' : 'backward';
  const roverPathPos = tilePathIdx(S.roverPos);
  if (targetPathPos === roverPathPos && !S.roverUsed && S.ap > cost) {
    pendingRoverMove = { target: targetPathPos, direction, cost };
    document.getElementById('roverRemainAp').textContent = S.ap - cost;
    openModal('roverConfirmModal');
    return;
  }
  moveMode = null;
  executePlayerMove(targetPathPos, direction, cost);
}

/** 按更多按钮当前位置摆放悬浮窗（fixed跟随按钮，随滚动更新） */
function positionMoreSheet() {
  const sheet = document.getElementById('moreSheet');
  const btn = document.getElementById('moreBtn');
  if (!sheet || !btn) return;
  const rect = btn.getBoundingClientRect();
  sheet.style.position = 'fixed';
  sheet.style.top = rect.bottom + 'px';
  sheet.style.left = rect.left + 'px';
  sheet.style.width = rect.width + 'px';
  sheet.style.display = 'flex';
  btn.classList.add('active');
}

/** 切换更多悬浮窗显隐 */
function toggleMoreSheet() {
  moreOpen = !moreOpen;
  if (moreOpen) {
    positionMoreSheet();
  } else {
    hideMoreSheet();
  }
}

/** 收起更多悬浮窗 */
function hideMoreSheet() {
  moreOpen = false;
  const sheet = document.getElementById('moreSheet');
  if (sheet) sheet.style.display = 'none';
  const btn = document.getElementById('moreBtn');
  if (btn) btn.classList.remove('active');
}

// 点击面板外任意处收起悬浮窗
document.addEventListener('click', (e) => {
  if (!e.target.closest('.action-panel')) hideMoreSheet();
});

// 滚动时悬浮窗跟随更多按钮移动
window.addEventListener('scroll', () => {
  if (moreOpen) positionMoreSheet();
}, { passive: true });

// ========================================
// OGS 抽取状态
// ========================================

/** 渲染OGS抽取中的状态 */
function renderOGSDrawArea() {
  const p = currentPlayer();
  const drawn = S.drawnThisTurn;
  const last = drawn[drawn.length - 1];
  const totalOxygen = p.oxygen.length + drawn.length;
  const canContinue = totalOxygen < p.slots &&
    (S.drawPile.length > 0 || S.discardPile.some(c => c.type === 'o2'));

  if (!last) return '';

  return `
    <div class="ogs-draw-area o2-draw">
      <div class="big-icon">🫧</div>
      <div class="card-label">O₂ ×${last.val}</div>
      <div class="card-sub">本轮已抽 ${drawn.length} 张，确认后将剩余 ${p.slots - p.oxygen.length - p.supplies.length - drawn.length} 个存储槽位置</div>
      <div class="ogs-draw-btns">
        <button class="btn-keep" ${canContinue ? '' : 'disabled'} onclick="drawFromOGS()">
          ${canContinue ? '继续抽取' : '已满'}</button>
        <button class="btn-stop" onclick="confirmOGSDraw()">确认收取</button>
      </div>
    </div>`;
}

// ========================================
// 月面地图
// ========================================

/** 玩家站位标记：骑车的玩家显示"人+车"组合，其余仅显示token */
function playerTokenHTML(p, pi) {
  if (p.onRover) {
    // 已驾驶：玩家token在上，月球车SVG在下，等比例缩小至80%
    return `<div class="rover-combo-wrap token-anim" data-pid="${pi}">
      <div class="rover-combo">
        <div class="rover-combo-token">${tokenSVG(p.color)}</div>
        <div class="rover-combo-icon">${roverSVG(p.color)}</div>
      </div>
    </div>`;
  }
  return `<div class="tile-tokens token-anim" data-pid="${pi}">${tokenSVG(p.color)}</div>`;
}

/** 渲染月面地图（路径序列方案：物资+OGS交错排列，每行7个元素） */
function renderBoard() {
  let h = '<div class="board-wrap">';

  // 动态板高度（基于实际行数）
  const numRows = Math.ceil(S.path.length / COLS);
  const boardH = BOARD.y0 + (numRows - 1) * (BOARD.maxTilt + BOARD.rowGap) + BOARD.tileW + 3;

  // 板块索引 → 路径位置映射
  const tileSeqPos = {};
  S.path.forEach((el, pathIdx) => {
    if (el.type === 'tile') tileSeqPos[el.tileIdx] = pathIdx;
  });

  // 基地标记 + 玩家token + 标题（水平一行）；移动模式的基地目标圈锚定在 tokens 正上方
  const basePlayers = S.players.filter(p => p.pos === -1);
  h += `<div class="base-marker">
      <svg class="base-icon" viewBox="0 0 800 800"><g transform="translate(175.137577,623.832200) scale(0.057655,-0.057655)" fill="currentColor" stroke="none"><path d="M2392 7363 c-36 -52 -317 -650 -458 -976 -190 -436 -375 -962 -497 -1407 -88 -318 -194 -809 -232 -1070 -3 -25 -13 -88 -21 -140 -69 -455 -106 -909 -120 -1491 l-7 -277 -125 -118 c-204 -193 -338 -368 -451 -589 -130 -254 -201 -510 -219 -790 -4 -64 -5 -118 -3 -121 2 -2 141 -4 307 -4 l303 0 61 53 c265 226 421 328 630 412 110 44 328 110 336 102 3 -3 9 -76 15 -163 11 -187 26 -345 34 -367 4 -8 15 -17 27 -20 11 -3 219 -3 464 0 l444 6 6 36 c3 20 7 47 10 61 2 14 11 121 19 239 8 118 17 216 18 217 4 4 181 -49 263 -79 227 -82 452 -220 665 -409 l66 -58 640 0 c352 0 883 3 1181 7 l542 6 0 238 c0 203 2 240 16 253 13 13 45 16 199 16 172 0 185 -1 195 -19 6 -12 10 -112 10 -255 l0 -236 345 0 346 0 19 44 c77 181 122 416 122 641 1 421 -148 781 -447 1080 -104 105 -177 162 -292 231 -46 27 -83 52 -83 55 0 3 23 9 51 12 103 12 219 89 219 144 0 20 -37 64 -165 193 -91 92 -165 170 -165 174 0 19 201 200 253 228 32 17 67 44 78 59 43 61 33 136 -27 189 -28 24 -44 30 -81 30 -79 0 -130 -44 -153 -131 -9 -36 -29 -61 -106 -137 -52 -50 -98 -92 -102 -92 -4 0 -83 75 -175 165 -196 192 -203 195 -261 119 -79 -103 -117 -220 -117 -359 -1 -149 37 -260 126 -369 25 -31 45 -57 45 -58 0 -2 -82 -3 -183 -4 -157 0 -199 -4 -308 -27 -567 -120 -1000 -495 -1173 -1017 -38 -114 -65 -237 -67 -297 -2 -91 -11 -90 -60 5 -102 197 -285 435 -445 579 -43 39 -93 84 -111 100 l-31 28 -11 420 c-17 643 -48 993 -137 1530 -58 353 -178 884 -265 1170 -188 615 -359 1064 -632 1656 -144 311 -283 596 -295 603 -6 3 -19 -6 -30 -21z m181 -4016 c79 -36 128 -77 170 -140 108 -162 83 -369 -60 -497 -204 -181 -532 -107 -637 145 -36 86 -29 220 16 309 24 48 99 129 145 157 105 65 258 76 366 26z"/></g></svg>
      <div class="base-tokens">${basePlayers.map(p =>
        `<span class="base-token${p.returned ? ' returned' : ''}" data-pid="${S.players.indexOf(p)}" title="${p.name}${p.returned ? '（已返回基地）' : ''}">${tokenSVG(p.color)}</span>`
      ).join('')}</div>
      ${moveMode && moveMode.base !== null && S.ap >= moveMode.base
        ? `<div class="move-target move-base" data-cost="${moveMode.base}"
          onclick="onMoveTargetClick(-1)">返回基地<br>${moveMode.base}AP</div>` : ''}
    <span class="base-title">月面地图</span>
  </div>`;

  h += `<div class="path-board" style="aspect-ratio:100/${boardH.toFixed(1)}">`;

  // 渲染路径中的每个元素
  S.path.forEach((el, pathIdx) => {
    const { x, y } = tilePos(pathIdx);
    const left = (x - BOARD.tileW / 2).toFixed(1);
    const top = ((y - BOARD.tileW / 2) / boardH * 100).toFixed(1);
    const cp = currentPlayer();
    const isCurrentPos = cp && cp.pos === pathIdx && !cp.returned;
    // 第一/三/五行（奇数行）角色token垂直翻转
    const flipTok = Math.floor(pathIdx / COLS) % 2 === 0;

    if (el.type === 'tile') {
      const tile = S.tiles[el.tileIdx];

      if (tile.isRover) {
        const hasAccel = S.accelMarks.includes(pathIdx);
        h += `<div class="tile tile-rover${hasAccel ? ' accel' : ''}${isCurrentPos ? ' current-pos' : ''}${flipTok ? ' flip-tok' : ''}"
               style="left:${left}%;top:${top}%;width:${BOARD.tileW}%"
               onclick="onTileClick(${el.tileIdx})">`;
        if (S.accelMarks.includes(pathIdx)) h += '<div class="accel-mark">⚡</div>';

        if (!S.roverUsed) {
          // 未驾驶：显示大号月球车SVG
          h += `<div class="rover-icon-big">${roverSVG('#6C7A81')}</div>`;
        } else {
          S.players.forEach((p, pi) => {
            if (p.pos === pathIdx && !p.returned) {
              h += playerTokenHTML(p, pi);
            }
          });
        }
        h += '</div>';
      } else {
        const zone = ZONES[tile.zone - 1];
        const BACK_COLORS = { triangle: '#928694', square: '#796f7b', pentagon: '#564e55' };
        const backColor = BACK_COLORS[tile.shape] || zone.color;
        const fill = tile.picked ? 'rgba(255,255,255,.05)' : backColor;
        const stroke = tile.picked ? 'rgba(255,255,255,.1)' : backColor;
        const hasAccel = S.accelMarks.includes(pathIdx);

        h += `<div class="tile ${tile.picked ? 'picked' : ''}${hasAccel ? ' accel' : ''}${isCurrentPos ? ' current-pos' : ''}${flipTok ? ' flip-tok' : ''}"
               data-tileidx="${el.tileIdx}"
               style="left:${left}%;top:${top}%;width:${BOARD.tileW}%"
               onclick="onTileClick(${el.tileIdx})">`;
        h += `<div class="tile-shape">${shapeSVG(tile.shape, fill, stroke)}</div>`;

        if (!tile.picked) h += `<div class="tile-back-num">${tile.backNum}</div>`;
        if (tile.picked) h += '<div class="tile-x">✕</div>';
        if (S.accelMarks.includes(pathIdx)) h += '<div class="accel-mark">⚡</div>';

        S.players.forEach((p, pi) => {
          if (p.pos === pathIdx && !p.returned) {
            h += playerTokenHTML(p, pi);
          }
        });

        h += '</div>';
      }
    } else if (el.type === 'discarded') {
      // 丢弃物资：已拾取显示X，未拾取显示背面
      const zone = ZONES[el.zone - 1] || ZONES[0];
      const BACK_COLORS = { triangle: '#928694', square: '#796f7b', pentagon: '#564e55' };
      const backColor = BACK_COLORS[zone.shape] || zone.color;
      const hasAccel = S.accelMarks.includes(pathIdx);

      h += `<div class="tile discarded-supply-tile${el.picked ? ' picked' : ''}${hasAccel ? ' accel' : ''}${isCurrentPos ? ' current-pos' : ''}${flipTok ? ' flip-tok' : ''}"
             data-discidx="${pathIdx}"
             style="left:${left}%;top:${top}%;width:${BOARD.tileW}%"
             onclick="onDiscardedClick(${pathIdx})">`;

      if (el.picked) {
        h += `<div class="tile-shape">${shapeSVG(zone.shape, 'rgba(255,255,255,.05)', 'rgba(255,255,255,.1)')}</div>`;
        h += '<div class="tile-x">✕</div>';
      } else {
        h += `<div class="tile-shape">${shapeSVG(zone.shape, backColor, backColor)}</div>`;
        h += `<div class="tile-back-num">${zone.backNum}</div>`;
      }

      if (hasAccel) h += '<div class="accel-mark">⚡</div>';

      S.players.forEach((p, pi) => {
        if (p.pos === pathIdx && !p.returned) {
          h += playerTokenHTML(p, pi);
        }
      });

      h += '</div>';
    } else if (el.type === 'ogs') {
      // OGS 芯片（与板块等大）
      const hasAccel = S.accelMarks.includes(pathIdx);
      h += `<div class="ogs-chip ${!el.active ? 'dead' : ''}${hasAccel ? ' accel' : ''}${isCurrentPos ? ' current-pos' : ''}${flipTok ? ' flip-tok' : ''}"
             data-ogspos="${pathIdx}"
             style="left:${left}%;top:${top}%;width:${BOARD.tileW}%">
        <span class="ogs-label">${!el.active ? '❌️<br>OGS' : 'OGS'}</span>`;

      if (hasAccel) h += '<div class="accel-mark">⚡</div>';

      S.players.forEach((p, pi) => {
        if (p.pos === pathIdx && !p.returned) {
          h += playerTokenHTML(p, pi);
        }
      });

      h += '</div>';
    }
  });

  // 移动模式覆盖层：高亮可达格（费用不足的不显示），AP成本标在圈外下方
  if (moveMode) {
    moveMode.targets.forEach(t => {
      if (t.cost > S.ap) return;
      const { x, y } = tilePos(t.pathPos);
      const left = (x - BOARD.tileW / 2).toFixed(1);
      const top = ((y - BOARD.tileW / 2) / boardH * 100).toFixed(1);
      h += `<div class="move-target" data-cost="${t.cost}"
        style="left:${left}%;top:${top}%;width:${BOARD.tileW}%"
        onclick="onMoveTargetClick(${t.pathPos})"></div>`;
    });
  }

  // 机器人标记（在板块上时显示）
  if (S.hasEngineer && S.robotPos >= 0) {
    const robotP = tilePos(S.robotPos);
    const robotLeft = (robotP.x - BOARD.tileW / 2).toFixed(1);
    const robotTop = ((robotP.y - BOARD.tileW / 2) / boardH * 100).toFixed(1);
    h += `<div class="robot-marker token-anim" data-pid="robot" style="left:${robotLeft}%;top:${robotTop}%;width:${BOARD.tileW}%;aspect-ratio:1/1">
      <span class="robot-icon">🤖</span></div>`;
  }

  h += '</div></div>';
  return h;
}

/** 板块点击处理 */
function onTileClick(tileIdx) {
  if (moveMode) { exitMoveMode(); return; }
  if (S.turnPhase !== 'spent' || S.isDrawing) return;
  const p = currentPlayer();
  if (p.onRover) return;
  const adj = getAdjacentTiles(p.pos);

  // 如果是相邻的未拾取板块 → 拾取物资
  if (adj.includes(tileIdx) && !S.tiles[tileIdx].picked) {
    const cost = p.role.id === 'veteran' ? 2 : 3;
    if (S.ap >= cost && freeSlots(p) > 0) {
      collectSupply(tileIdx);
    }
  }
}

// ========================================
// 统计面板
// ========================================

/** 渲染统计面板 */
function renderStatsPanel() {
  const needsReshuffle = S.drawPile.length === 0 &&
    S.discardPile.some(c => c.type === 'o2');

  let h = '<div class="stats-panel">';
  h += '<div class="stats-row">';
  h += `<div class="stat-box ${S.drawPile.length <= 2 ? 'warn' : ''}" style="cursor:pointer" onclick="showDrawPileInfo()">
    <div class="num">${S.drawPile.length}</div><div class="label">抽牌堆</div></div>`;
  h += `<div class="stat-box" style="cursor:pointer" onclick="showDiscardPile()">
    <div class="num">${S.discardPile.length}</div><div class="label">弃牌堆</div></div>`;
  h += `<div class="stat-box">
    <div class="num">${S.ogsCount}/5</div><div class="label">OGS芯片</div></div>`;
  h += `<div class="stat-box">
    <div class="num">${WIN_CONDITIONS[S.playerCount]}</div><div class="label">物资目标</div></div>`;
  h += '</div>';

  // 洗回按钮
  // if (needsReshuffle && S.turnPhase === 'spent') {
  //   h += `<button class="act-btn btn-ogs" style="width:100%;margin-top:8px"
  //     onclick="reshufflePile();render()">🔄 洗回弃牌堆</button>`;
  // }

  // 最新日志（点击展开完整列表）
  if (S.log.length > 0) {
    const last = S.log[0];
    h += `<div class="stats-log-last" onclick="showLogSheet()">
      ${last.msg}</div>`;
  }

  h += '</div>';
  return h;
}

// ========================================
// 事件日志
// ========================================

/** 打开日志列表抽屉 */
function showLogSheet() {
  let h = '<h3>📋 事件日志</h3><div class="log-list">';
  S.log.slice(0, 30).forEach(item => {
    h += `<div class="log-item ${item.cls}">
      <span class="log-time">${item.t}</span>${item.msg}</div>`;
  });
  h += '</div>';
  h += '<button class="sheet-cancel" onclick="closeSheet()">关闭</button>';
  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

// ========================================
// 玩家详情卡片
// ========================================

/** 渲染单个玩家详情卡片 */
function renderPlayerCard(player, idx) {
  const isCurrent = idx === S.currentPlayer;
  const used = usedSlots(player);
  const free = freeSlots(player);

  // 本次状态diff中该玩家新增的物资/氧气卡槽位索引（用于pop动画）
  const anim = _animCtx && _animCtx.diff;
  const popSupplies = anim ? new Set(anim.newSupplies.filter(x => x.pi === idx).map(x => x.si)) : new Set();
  const popO2 = anim ? new Set(anim.newO2.filter(x => x.pi === idx).map(x => x.si)) : new Set();

  let h = `<div class="player-card ${isCurrent ? 'active-card' : ''}">`;

  // 头部
  h += `<div class="pc-header">
    <div class="pc-name"><span style="color:${player.color}">●${idx + 1}</span> ${player.name}</div>
    <div class="pc-role">${player.role.icon} ${player.role.name}</div>
  </div>`;

  // 返回基地标记
  if (player.returned) {
    h += '<div style="font-size:.7em;color:var(--safe);margin-bottom:6px">✅ 已返回基地</div>';
  }

  // 月球车标记
  if (player.onRover) {
    h += '<div style="font-size:.7em;color:var(--o2-light);margin-bottom:6px">🚗 驾驶月球车中</div>';
  }

  // 氧气卡
  h += `<div class="pc-section"><div class="pc-label">
    <span>🫧 氧气卡 (${player.oxygen.length}张)</span></div>
    <div class="pc-row">`;
  if (player.oxygen.length === 0) {
    h += '<span class="chip empty-slot">无氧气 ⚠</span>';
  } else {
    player.oxygen.forEach((c, i) => {
      h += `<span class="chip o2 ${c.val === 3 ? 'val3' : ''}${popO2.has(i) ? ' chip-pop' : ''}">O₂ ×${c.val}</span>`;
    });
  }
  h += '</div></div>';

  // 物资
  h += `<div class="pc-section"><div class="pc-label">
    <span>📦 物资 (${player.supplies.length}个)</span></div>
    <div class="pc-row">`;
  if (player.supplies.length === 0) {
    h += '<span class="chip empty-slot">空</span>';
  } else {
    player.supplies.forEach((s, i) => {
      const z = ZONES.find(zone => zone.id === s.zone);
      const label = z ? `区域${s.zone}` : '?';
      const color = (S.gameOver || s.revealed) ? (s.intact ? '#4caf50' : '#f44336') : undefined;
      h += `<span class="chip supply-chip${popSupplies.has(i) ? ' chip-pop' : ''}">${supplyIcon(s, 18, color)}<!--<span class="chip-label">${label}</span>--></span>`;
    });
  }
  h += '</div></div>';

  // 存储槽
  // h += `<div class="pc-section"><div class="pc-label">
  //   <span>🔲 存储槽</span><span style="color:var(--o2-light)">${used}/${player.slots}</span></div>
  //   <div class="slot-bar">`;
  // for (let i = 0; i < player.slots; i++) {
  //   if (i < player.oxygen.length) {
  //     h += '<div class="slot filled-o2">O</div>';
  //   } else if (i < used) {
  //     const sup = player.supplies[i - player.oxygen.length];
  //     const color = sup.intact ? '#4caf50' : '#f44336';
  //     h += `<div class="slot filled-sup">${supplyIcon(sup, 16, color)}</div>`;
  //   } else {
  //     h += '<div class="slot empty"></div>';
  //   }
  // }
  // h += `<span class="slot-info">空${free}格</span></div></div>`;

  // 位置
  const roverSeqPos = tilePathIdx(S.roverPos);
  const posText = player.pos === -1 ? '基地' :
    `${posLabel(player.pos)}${player.pos === roverSeqPos && player.onRover ? ' (月球车)' : ''}`;
  h += `<div class="pos-tag">📍 ${posText}</div>`;

  // 角色技能
  h += `<div class="pc-section"><div class="pc-label"><span>⭐ ${player.role.name}</span></div>
    <div style="font-size:.7em;color:var(--text-dim);padding:2px 0">
    ${player.role.icon} ${player.role.ability}</div></div>`;

  h += '</div>';
  return h;
}

/** 弹出玩家详情抽屉 */
function showPlayerDetail(idx) {
  const content = document.getElementById('sheetContent');
  content.innerHTML = renderPlayerCard(S.players[idx], idx)
    + '<button class="btn-full btn-primary" onclick="closeSheet()">关闭</button>';
  openSheet();
}

// ========================================
// 底部操作面板（Bottom Sheets）
// ========================================

/** 打开物资回收选择面板 */
function openCollectSheet() {
  const p = currentPlayer();
  const adj = getAdjacentTiles(p.pos);
  const cost = p.role.id === 'veteran' ? 2 : 3;
  const targets = adj.filter(t =>
    !S.tiles[t].picked &&
    !S.accelMarks.includes(tilePathIdx(t)) &&
    !S.players.some(pl => pathToTileIdx(pl.pos) === t && !pl.returned) &&
    !(S.hasEngineer && pathToTileIdx(S.robotPos) === t));

  // 相邻路径位置上的丢弃物资
  const adjSeq = getAdjacentSeqPositions(p.pos);
  const discardedTargets = adjSeq.filter(pathIdx => {
    const el = S.path[pathIdx];
    return el && el.type === 'discarded' && !el.picked &&
      !S.accelMarks.includes(pathIdx) &&
      !S.players.some(pl => pl.pos === pathIdx && !pl.returned) &&
      !(S.hasEngineer && S.robotPos === pathIdx);
  });

  let h = '<h3>📦 选择要拾取的物资</h3><div class="sheet-cards">';
  targets.forEach(t => {
    const dir = tilePathIdx(t) > p.pos ? '前方' : '后方';
    h += `<div class="sheet-card supply-card" onclick="closeSheet();collectSupply(${t})">
      ${dir === '前方' ? '⬇️' : '⬆️'} ${dir} · 板块${t + 1}</div>`;
  });
  discardedTargets.forEach(pathIdx => {
    const dir = pathIdx > p.pos ? '前方' : '后方';
    h += `<div class="sheet-card supply-card" onclick="closeSheet();onDiscardedClick(${pathIdx})">
      ${dir === '前方' ? '⬇️' : '⬆️'} ${dir} · 丢弃物资</div>`;
  });
  if (targets.length === 0 && discardedTargets.length === 0) {
    h += '<p class="text-dim" style="padding:12px">附近没有可拾取的物资</p>';
  }
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 打开OGS建立选择面板 */
function openOGSSheet() {
  const p = currentPlayer();
  const available = getAdjacentInsertPoints(p.pos);
  const ogsCost = (p.role.id === 'builder' && !S.ogsBuilt) ? 1 : 3;

  let h = '<h3>🔵 选择OGS放置位置</h3><div class="sheet-cards">';
  available.forEach(insIdx => {
    const dir = insIdx > p.pos ? '⬇️ 前方' : '⬆️ 后方';
    h += `<div class="sheet-card o2-card" onclick="closeSheet();placeOGS(${insIdx})">
      ${dir} (${ogsCost}AP)</div>`;
  });
  if (available.length === 0) {
    h += '<p class="text-dim" style="padding:12px">没有可用的放置位置</p>';
  }
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/**
 * 打开发明家加速标记选择面板
 * @param {'forward'|'backward'} direction - 移动方向
 * @param {number} skipTarget - 跳过所有加速标记后的落点（seqPos）
 * @param {number[]} accelStops - 连续加速标记的序列位置数组
 */
function openAccelChoiceSheet(direction, skipTarget, accelStops) {
  const dirLabel = direction === 'forward' ? '⬇️ 前进' : '⬆️ 后退';
  let h = `<h3>⚡ 发现加速标记</h3>`;
  h += `<p style="font-size:.75em;color:var(--text-dim);text-align:center;margin-bottom:10px">
    发明家可选择停在加速标记上，或跳过全部</p>`;
  h += '<div class="sheet-cards">';

  accelStops.forEach(seqPos => {
    h += `<div class="sheet-card o2-card"
      onclick="closeSheet();stopOnAccelMark(${seqPos},'${direction}')">
      ⚡ 停在${posLabel(seqPos)}</div>`;
  });

  if (skipTarget >= 0) {
    h += `<div class="sheet-card supply-card"
      onclick="closeSheet();executePlayerMove(${skipTarget},'${direction}')">
      ${dirLabel}到${posLabel(skipTarget)}</div>`;
  } else if (direction === 'backward') {
    h += `<div class="sheet-card supply-card"
      onclick="closeSheet();showReturnBaseConfirm()">
      📡 ${dirLabel}返回基地</div>`;
  } else {
    h += `<div class="sheet-card supply-card" style="opacity:.4">
      ⬇️ 前方无可落脚板块</div>`;
  }

  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 打开共享目标选择面板 */
function openShareSelectSheet() {
  const p = currentPlayer();
  const adjSeq = getAdjacentSeqPositions(p.pos);
  const targets = S.players.filter((other, i) => {
    if (i === S.currentPlayer || other.returned) return false;
    if (p.pos >= 0 && other.pos === p.pos) return true;
    return adjSeq.includes(other.pos);
  }).sort((a, b) => a.pos - b.pos);

  let h = '<h3>🤝 选择共享对象</h3><div class="sheet-cards">';
  targets.forEach((t, i) => {
    const realIdx = S.players.indexOf(t);
    h += `<div class="sheet-card o2-card" onclick="closeSheet();shareWithPlayer(${realIdx})">
      <span style="color:${t.color}">●</span> ${t.name} (1AP)</div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 渲染共享交换面板 */
function renderShareSheet(fromIdx, toIdx) {
  const from = S.players[fromIdx];
  const to = S.players[toIdx];

  let h = `<h3>🤝 ${from.name} ↔ ${to.name}</h3>`;
  h += '<div style="font-size:.75em;color:var(--text-dim);text-align:center;margin-bottom:10px">点击物品进行转移</div>';

  // from的物品
  h += `<div style="font-size:.8em;margin-bottom:4px;color:${from.color}">● ${from.name}（发起人） 的物品:</div>`;
  h += '<div class="sheet-cards">';
  from.oxygen.forEach((c, i) => {
    h += `<div class="sheet-card o2-card ${c.val === 3 ? 'val3' : ''}"
      onclick="transferItem(${fromIdx},${toIdx},'o2',${i});renderShareSheet(${fromIdx},${toIdx})">
      O₂×${c.val} ↓</div>`;
  });
  from.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    const color = s.revealed ? (s.intact ? '#4caf50' : '#f44336') : undefined;
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;justify-content:center;gap:8px"
      onclick="transferItem(${fromIdx},${toIdx},'supply',${i});renderShareSheet(${fromIdx},${toIdx})">
      <span style="width:20px;height:20px;display:inline-flex">${supplyIcon(s, 20, color)}</span> ↓</div>`;
  });
  h += '</div>';

  // to的物品
  h += `<div style="font-size:.8em;margin:8px 0 4px;color:${to.color}">● ${to.name} 的物品:</div>`;
  h += '<div class="sheet-cards">';
  to.oxygen.forEach((c, i) => {
    h += `<div class="sheet-card o2-card ${c.val === 3 ? 'val3' : ''}"
      onclick="transferItem(${toIdx},${fromIdx},'o2',${i});renderShareSheet(${fromIdx},${toIdx})">
      ↑ O₂×${c.val}</div>`;
  });
  to.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    const color = s.revealed ? (s.intact ? '#4caf50' : '#f44336') : undefined;
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;justify-content:center;gap:8px"
      onclick="transferItem(${toIdx},${fromIdx},'supply',${i});renderShareSheet(${fromIdx},${toIdx})">
      ↑ <span style="width:20px;height:20px;display:inline-flex">${supplyIcon(s, 20, color)}</span></div>`;
  });
  h += '</div>';

  h += '<div style="display:flex;gap:10px;margin-top:12px">';
  h += '<button class="sheet-cancel" style="flex:1" onclick="cancelShare()">取消</button>';
  h += '<button class="sheet-confirm" style="flex:1" onclick="confirmShare()">完成交换</button>';
  h += '</div>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 打开鉴定物资选择面板（鉴定师技能） */
function openAppraiseSheet() {
  const p = currentPlayer();
  if (p.role.id !== 'appraiser') return;
  if (S.appraiseUsed) return;
  if (S.ap < 1) return;
  if (p.supplies.length === 0) return;

  let h = '<h3>🔍 选择要鉴定的物资（1AP）</h3><div class="sheet-cards">';
  p.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    const color = s.revealed ? (s.intact ? '#4caf50' : '#f44336') : undefined;
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;justify-content:center;gap:8px"
      onclick="closeSheet();appraiseSupply(${i})">
      <span style="width:20px;height:20px;display:inline-flex">${supplyIcon(s, 20, color)}</span>
      ${s.revealed ? '<span style="font-size:.75em">已翻开</span>' : ''}</div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 打开丢弃物资选择面板 */
function openDiscardSheet() {
  const p = currentPlayer();
  if (p.pos < 0) return; // 必须在路径上
  const adjacentGaps = getAdjacentInsertPoints(p.pos);

  let h = '<h3>🗑️ 选择要丢弃的物资</h3><div class="sheet-cards">';
  p.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    const color = s.revealed ? (s.intact ? '#4caf50' : '#f44336') : undefined;
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;justify-content:center;gap:8px"
      onclick="closeSheet();openDiscardGapSheet(${i})">
      <span style="width:20px;height:20px;display:inline-flex">${supplyIcon(s, 20, color)}</span></div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 选择丢弃目标间隙 */
function openDiscardGapSheet(supplyIdx) {
  const p = currentPlayer();
  if (p.pos < 0) return;
  const insertPoints = getAdjacentInsertPoints(p.pos);

  let h = '<h3>📍 选择丢弃位置</h3><div class="sheet-cards">';
  insertPoints.forEach(insIdx => {
    const dir = insIdx > p.pos ? '⬇️ 前方' : '⬆️ 后方';
    h += `<div class="sheet-card supply-card"
      onclick="closeSheet();discardSupply(${supplyIdx},${insIdx})">
      ${dir}</div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

// ========================================
// 弹窗/面板管理
// ========================================

/**
 * 打开模态弹窗
 * @param {string} id - 弹窗元素的ID
 */
function openModal(id) {
  document.getElementById(id).classList.add('show');
}

/**
 * 关闭模态弹窗
 * @param {string} id - 弹窗元素的ID
 */
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

/** 打开游戏规则弹窗 */
function showRules() {
  openModal('rulesModal');
}

/** 打开底部操作面板 */
function openSheet() {
  document.getElementById('actionSheet').classList.add('show');
}

/** 关闭底部操作面板（救援/共享进行中视为取消并回滚） */
function closeSheet() {
  // 联机观战模式：共享抽屉只读，禁止通过遮罩关闭（共享结束时自动关闭）
  if (S.shareState && typeof window._olIsActor === 'function' && !window._olIsActor()) return;
  // 救援进行中：关闭（点击遮罩）视为取消救援并回滚
  if (S.isRescue) {
    cancelRescue();
    return;
  }
  // 共享进行中关闭面板视为取消
  if (S.shareState) {
    cancelShare();
    return;
  }
  document.getElementById('actionSheet').classList.remove('show');
}

/**
 * 显示磁暴弹窗
 * 延迟700ms出现：先让OGS芯片播放摧毁动画，形成"芯片损坏 → 弹窗"因果链
 * @param {string} playerName - 被磁暴摧毁OGS的玩家名称
 */
function showStormModal(playerName) {
  setTimeout(() => {
    document.getElementById('stormMsg').textContent =
      `${playerName} 所在的OGS已被磁暴摧毁！该芯片无法再使用。`;
    // 重新触发 shake 动画（CSS 动画只会在元素首次渲染时播放）
    const box = document.querySelector('#stormModal .modal-box');
    if (box) {
      box.classList.remove('shake-anim');
      void box.offsetWidth; // 强制重排
      box.classList.add('shake-anim');
    }
    openModal('stormModal');
  }, 700);
}

/** 生成并填充结算弹窗内容并打开（联机接收方也会调用） */
function showEndModal() {
  const target = WIN_CONDITIONS[S.playerCount];

  let intactCount = 0;
  let detailHtml = '';
  S.players.forEach(p => {
    let playerIntact = 0;
    const supplyIcons = p.supplies.map(s => {
      if (s.intact) playerIntact++;
      const z = ZONES.find(zone => zone.id === s.zone);
      if (!z) return '';
      const color = s.intact ? '#4caf50' : '#f44336';
      return `<span style="width:18px;height:18px;display:inline-flex;vertical-align:middle">${shapeSVG(z.shape, color, color)}</span>`;
    }).join('');
    intactCount += playerIntact;
    const supPart = p.supplies.length > 0
      ? `<span style="display:inline-flex;gap:3px;margin-left:4px">${supplyIcons}</span>`
      : '<span class="text-dim" style="margin-left:4px">· 无物资</span>';
    detailHtml += `<div style="margin:8px 0;font-size:.85em;display:flex;align-items:center;gap:6px">
      <span style="color:${p.color}">●</span> ${p.name} (${playerIntact}/${p.supplies.length})
      ${supPart}
    </div>`;
  });

  const icon = S.gameResult === 'win' ? '🎉' : '💀';
  const title = S.gameResult === 'win' ? '任务成功！' : '任务失败';
  const titleClass = S.gameResult === 'win' ? 'text-safe' : 'text-danger';

  const content = document.getElementById('endModalContent');
  content.innerHTML = `
    <div class="modal-icon">${icon}</div>
    <h3 class="${titleClass}">${title}</h3>
    <p style="font-size:1.1em;font-weight:700">完好物资: ${intactCount} / ${target}</p>
    <div style="text-align:left;padding:8px 0;border-top:1px solid rgba(255,255,255,.1);margin-top:8px">
      ${detailHtml}
    </div>
    <button class="btn-full btn-primary" onclick="closeModal('endModal')">确认</button>`;

  openModal('endModal');
}

/** 显示抽牌堆信息弹窗 */
function showDrawPileInfo() {
  const stormCount = S.drawPile.filter(c => c.type === 'storm').length;
  const o2Count = S.drawPile.length - stormCount;
  let h = '<h3>📋 抽牌堆</h3><div style="padding:8px 4px;font-size:0.95em">';
  h += `<p>共 <b>${S.drawPile.length}</b> 张牌</p>`;
  h += `<p style="color:var(--o2-light)">🫧 氧气卡：${o2Count} 张</p>`;
  h += `<p style="color:var(--danger)">💥 磁暴卡：${stormCount} 张</p>`;
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">关闭</button>';
  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/** 显示弃牌堆弹窗 */
function showDiscardPile() {
  let h = '<h3>📋 弃牌堆</h3><div style="padding:8px 4px;font-size:0.95em">';
  if (S.discardPile.length === 0) {
    h += '<p class="text-dim">弃牌堆为空</p>';
  } else {
    h += `<p>共 <b>${S.discardPile.length}</b> 张牌</p>`;
    S.discardPile.forEach((c, i) => {
      if (c.type === 'storm') {
        h += `<p style="color:var(--danger)">${i + 1}. ⚡ 磁暴</p>`;
      } else {
        h += `<p style="color:var(--o2-light)">${i + 1}. O₂ ×${c.val}</p>`;
      }
    });
  }
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">关闭</button>';
  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

/**
 * 显示共享交换面板（委托 renderShareSheet 实现）
 * @param {number} fromIdx - 发起方玩家索引
 * @param {number} toIdx - 接收方玩家索引
 */
function openShareSheet(fromIdx, toIdx) {
  renderShareSheet(fromIdx, toIdx);
}

// ========================================
// 紧急救援面板
// ========================================

/** 显示紧急救援选择面板 */
function showRescueSelect() {
  // 联机模式：仅当前回合玩家（或被房主接管的离席玩家）可弹出救援面板
  if (typeof window._olIsActor === 'function' && !window._olIsActor()) return;

  const p = currentPlayer();
  const adjSeq = getAdjacentSeqPositions(p.pos);
  const rescuers = S.players.filter((other, i) => {
    if (i === S.currentPlayer || other.returned) return false;
    if (other.oxygen.length === 0) return false;
    if (p.pos >= 0 && other.pos === p.pos) return true;
    return adjSeq.includes(other.pos);
  });

  addLog(`⚠️ ${p.name} 氧气耗尽！请求紧急救援`, 'storm-log');

  let h = '<h3>🆘 紧急救援</h3>';
  h += `<p style="font-size:.8em;color:var(--danger);text-align:center;margin-bottom:10px">
    ${p.name} 氧气耗尽！选择相邻玩家进行救援</p>`;
  h += '<div class="sheet-cards">';
  rescuers.forEach(r => {
    const idx = S.players.indexOf(r);
    h += `<div class="sheet-card o2-card" onclick="closeSheet();startRescue(${idx})">
      <span style="color:${r.color}">●</span> ${r.name}（${r.oxygen.length}张氧气）</div>`;
  });
  h += '</div>';

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
  render();
}

/**
 * 渲染紧急救援面板（救援双方可互相转移氧气和物资，免费）
 * @param {number} rescuerIdx - 救援方玩家索引
 * @param {number} rescuedIdx - 被救援方玩家索引
 */
function renderRescueSheet(rescuerIdx, rescuedIdx) {
  const rescuer = S.players[rescuerIdx];
  const rescued = S.players[rescuedIdx];

  let h = `<h3>🆘 紧急救援</h3>`;
  h += '<div style="font-size:.75em;color:var(--text-dim);text-align:center;margin-bottom:10px">' +
    '救援双方可互相转移氧气和物资</div>';

  // rescuer 的物品（可转给被救者）
  h += `<div style="font-size:.8em;margin-bottom:4px;color:${rescuer.color}">● ${rescuer.name} 的物品:</div>`;
  h += '<div class="sheet-cards">';
  rescuer.oxygen.forEach((c, i) => {
    h += `<div class="sheet-card o2-card ${c.val === 3 ? 'val3' : ''}"
      onclick="transferItem(${rescuerIdx},${rescuedIdx},'o2',${i});renderRescueSheet(${rescuerIdx},${rescuedIdx})">
      O₂×${c.val} →</div>`;
  });
  rescuer.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    const color = s.revealed ? (s.intact ? '#4caf50' : '#f44336') : undefined;
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;gap:8px"
      onclick="transferItem(${rescuerIdx},${rescuedIdx},'supply',${i});renderRescueSheet(${rescuerIdx},${rescuedIdx})">
      <span style="width:20px;height:20px;display:inline-flex">${supplyIcon(s, 20, color)}</span> →</div>`;
  });
  h += '</div>';

  // rescued 的物品（可反向转给救援者）
  h += `<div style="font-size:.8em;margin:8px 0 4px;color:${rescued.color}">● ${rescued.name} 的物品:</div>`;
  h += '<div class="sheet-cards">';
  rescued.oxygen.forEach((c, i) => {
    h += `<div class="sheet-card o2-card ${c.val === 3 ? 'val3' : ''}"
      onclick="transferItem(${rescuedIdx},${rescuerIdx},'o2',${i});renderRescueSheet(${rescuerIdx},${rescuedIdx})">
      ← O₂×${c.val}</div>`;
  });
  rescued.supplies.forEach((s, i) => {
    const z = ZONES.find(zone => zone.id === s.zone) || ZONES[0];
    const color = s.revealed ? (s.intact ? '#4caf50' : '#f44336') : undefined;
    h += `<div class="sheet-card supply-card" style="display:flex;align-items:center;gap:8px"
      onclick="transferItem(${rescuedIdx},${rescuerIdx},'supply',${i});renderRescueSheet(${rescuerIdx},${rescuedIdx})">
      ← <span style="width:20px;height:20px;display:inline-flex">${supplyIcon(s, 20, color)}</span></div>`;
  });
  h += '</div>';

  h += `<button class="sheet-confirm" style="width:100%;margin-top:12px" onclick="finishRescue()">
    完成救援</button>`;

  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

// ========================================
// 机器人移动面板
// ========================================

/**
 * 工程师打开机器人移动选择面板（路径位置系统）
 * 机器人移动0-2个板块，不受任何限制
 */
function openRobotMoveSheet() {
  let h = '<h3>🤖 移动机器人</h3><div class="sheet-cards">';
  const options = [];

  if (S.robotPos === -1) {
    for (let step = 1; step <= 2; step++) {
      const targetPos = step - 1;
      if (targetPos < S.path.length) {
        options.push({ pathPos: targetPos, label: `⬇️ 前进${step}格`, desc: `到${posLabel(targetPos)}` });
      }
    }
  } else {
    for (let step = -2; step <= 2; step++) {
      const targetPos = S.robotPos + step;
      if (targetPos < -1 || targetPos >= S.path.length) continue;
      if (targetPos === -1) {
        options.push({ pathPos: -1, label: '⬆️ 返回基地', desc: '基地' });
      } else if (step === 0) {
        options.push({ pathPos: targetPos, label: '⏸ 原地不动', desc: `留在${posLabel(targetPos)}` });
      } else if (step > 0) {
        options.push({ pathPos: targetPos, label: `⬇️ 前进${step}格`, desc: `到${posLabel(targetPos)}` });
      } else {
        options.push({ pathPos: targetPos, label: `⬆️ 后退${Math.abs(step)}格`, desc: `到${posLabel(targetPos)}` });
      }
    }
  }
  options.forEach(o => {
    h += `<div class="sheet-card supply-card" onclick="closeSheet();moveRobot(${o.pathPos})">
      ${o.label} · ${o.desc}</div>`;
  });
  h += '</div><button class="sheet-cancel" onclick="closeSheet()">取消</button>';
  document.getElementById('sheetContent').innerHTML = h;
  openSheet();
}

// ========================================
// SVG 形状生成
// ========================================

/**
 * 将十六进制颜色按比例变暗
 * @param {string} hex - 十六进制颜色值，如 "#ff8800"
 * @param {number} [f=0.55] - 变暗比例（0~1）
 * @returns {string} 变暗后的十六进制颜色
 */
function darken(hex, f = 0.55) {
  const r = Math.round(parseInt(hex.slice(1,3),16)*f);
  const g = Math.round(parseInt(hex.slice(3,5),16)*f);
  const b = Math.round(parseInt(hex.slice(5,7),16)*f);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

/** 人形 token SVG 路径 */
const TOKEN_PATH = 'M539 290.8c-19 0-37-3.8-54-11.2-17-7.4-31.8-17.4-44.2-30-12.6-12.6-22.4-27.2-30-44.2-7.4-17-11.2-35-11.2-54s3.8-37 11.2-54c7.4-17 17.4-31.8 30-44.2s27.2-22.4 44.2-30C502 15.8 520 12 539 12s37 3.8 54 11.2c17 7.4 31.8 17.4 44.2 30 12.6 12.6 22.4 27.2 29.4 44.2 7.2 17 10.8 35 10.8 54s-3.6 37-10.8 54c-7.2 17-17 31.8-29.4 44.2-12.6 12.6-27.2 22.4-44.2 30-16.8 7.4-34.8 11.2-54 11.2z m198.4 125.2c16 12 29.4 25.8 39.8 41.6s15.6 31.8 15.6 47.8v88.4c0 10.2-5.8 17.8-17.4 23.2-11.6 5.4-24.4 8-38.4 8s-26.8-2.6-38.4-7.6c-11.6-5-17.4-13.2-17.4-24.6v-37.6c0-9-2.6-15.6-8-20.2-5.4-4.4-10.8-8.2-16-11.2-6-3-12.8-1.6-20.6 4-7.8 5.6-11.6 15.4-11.6 29v236c0 14.2 4.8 27.4 14.2 39.4s21.2 23 34.8 33c12 8.4 22 16.6 30.4 25l29.4 29.4c3.6 3.6 5 9 4 16.6-0.8 7.4-3.4 15.4-7.6 23.6-4.2 8.4-9.4 16.6-15.6 25-6.2 8.4-13.2 14.8-21 19.6-7.8 4.8-15.6 7.2-23.6 7.2-8 0-15.6-3.8-22.8-11.6-10.8-11.4-19.4-20.4-26-27.2-6.6-6.8-12.4-13-17.4-18.4-5-5.4-10.2-10.4-15.6-15.2-5.4-4.8-12-11.4-19.6-19.6-15.4-15.4-28.8-35.2-39.8-59.4s-16.6-48.2-16.6-72v-72.4c-7.2 9-13.2 16-18.4 21.4-5 5.4-10.8 14.2-17.4 26.8-2.4 4.8-4.8 11-7.2 18.8-2.4 7.8-4.6 15.8-6.8 24.2s-3.8 16.6-5 25c-1.2 8.4-1.8 15.4-1.8 21.4V928c0 11.4-5.8 19.8-17.4 25.4-11.6 5.6-24.4 8.4-38.4 8-14-0.2-26.8-3.6-38.4-9.8s-17.4-15.6-17.4-28.2v-65.2c0-23.2 3.6-43.8 10.8-61.6 7.2-17.8 15.2-37 24.2-57.2 12-27.4 20.8-49.4 26.4-66.2 5.6-16.6 10-28.2 13-34.8 6-13.8 9-26 9-36.6v-28.6c-6.6 4.2-12 8-16.6 11.6-4.4 3.6-10.6 10.2-18.4 19.6-7.8 9-15.6 14.8-23.6 17.4-8 2.6-20.8 4-38 4h-58c-14.2 0-24.8-5.8-31.8-17.4-6.8-11.6-10.2-24.2-9.8-38s4-26.4 11.2-38c7.2-11.6 17.6-17.4 31.2-17.4h53.6c7.2 0 13-0.8 17.4-2.6 4.4-1.8 8.6-4.4 12.6-8 3.8-3.6 8-7.8 12.6-12.6 4.4-4.8 10-10.2 16.6-16 8.4-7.2 16.8-17.8 25.4-31.8 8.6-14 16.8-28.2 24.6-42.4 9-16.6 17.6-34.6 26-53.6 12.6 0.6 24.2 1.2 34.8 1.8 9.6 0.6 19.2 1 29 1.4 9.8 0.2 18 0.4 24.6 0.4 6.6 0 14-0.2 22.4-0.4 8.4-0.2 16.4-0.8 24.2-1.4 9-0.6 18.2-1.2 27.8-1.8 16 10.2 31.6 19.4 46.4 27.8 12.6 7.8 25 15.2 37.6 22.4 12.2 7 21.6 13 28.2 17.8z';

/**
 * 生成人形 token SVG
 * @param {string} c - 填充颜色
 * @returns {string} SVG HTML字符串
 */
function tokenSVG(c) {
  return `<svg viewBox="0 0 1024 1024"><path fill="${c}" stroke="${darken(c)}" stroke-width="24" d="${TOKEN_PATH}"/></svg>`;
}

/**
 * 生成三角形SVG（区域1）
 * @param {string} fill - 填充颜色
 * @param {string} stroke - 描边颜色
 * @returns {string} SVG HTML字符串
 */
function triSVG(fill, stroke) {
  return `<svg viewBox="0 0 100 100"><polygon points="50,16 87,79 13,79" fill="${fill}" stroke="${stroke}" stroke-width="13" stroke-linejoin="round"/></svg>`;
}

/**
 * 生成四边形SVG（区域2）
 * @param {string} fill - 填充颜色
 * @param {string} stroke - 描边颜色
 * @returns {string} SVG HTML字符串
 */
function sqSVG(fill, stroke) {
  return `<svg viewBox="0 0 100 100"><polygon points="50,11 89,50 50,89 11,50" fill="${fill}" stroke="${stroke}" stroke-width="13" stroke-linejoin="round"/></svg>`;
}

/**
 * 生成五边形SVG（区域3）
 * @param {string} fill - 填充颜色
 * @param {string} stroke - 描边颜色
 * @returns {string} SVG HTML字符串
 */
function pentSVG(fill, stroke) {
  return `<svg viewBox="0 0 100 100"><polygon points="50,13 85,39 72,80 28,80 15,39" fill="${fill}" stroke="${stroke}" stroke-width="13" stroke-linejoin="round"/></svg>`;
}

/**
 * 根据形状名生成对应SVG
 * @param {string} shape - 'triangle' | 'square' | 'pentagon'
 * @param {string} fill - 填充色
 * @param {string} stroke - 描边色
 * @returns {string} SVG HTML
 */
function shapeSVG(shape, fill, stroke) {
  if (shape === 'triangle') return triSVG(fill, stroke);
  if (shape === 'square') return sqSVG(fill, stroke);
  return pentSVG(fill, stroke);
}

/**
 * 生成月球车SVG
 * @param {string} fill - 填充颜色
 * @returns {string} SVG HTML字符串
 */
function roverSVG(fill) {
  return `<svg viewBox="0 0 1641 1024"><path fill="${fill}" d="M292.864 442.368a290.816 290.816 0 1 0 293.888 290.816 291.84 291.84 0 0 0-293.888-290.816z m0 422.912a133.12 133.12 0 1 1 134.144-133.12 133.12 133.12 0 0 1-134.144 134.144zM1331.2 442.368a290.816 290.816 0 1 0 293.888 290.816A291.84 291.84 0 0 0 1331.2 442.368z m0 422.912a133.12 133.12 0 1 1 134.144-133.12A133.12 133.12 0 0 1 1331.2 866.304z m204.8-667.648h-283.648c-76.8 0-26.624 128-291.84 128s-122.88-128-358.4-128H375.808L512 66.56h161.792V0h-204.8L279.552 204.8C102.4 220.16 102.4 429.056 102.4 429.056s539.648-136.192 539.648 294.912h358.4a294.912 294.912 0 0 1 295.936-328.704H1638.4s31.744-196.608-102.4-196.608z"/></svg>`;
}

/** 初始化星空背景（含低频流星） */
function initStars() {
  const container = document.getElementById('stars');
  let html = '';
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const dur = 1.5 + Math.random() * 3;
    html += `<div class="star" style="left:${x}%;top:${y}%;--dur:${dur}s"></div>`;
  }
  // 低频流星：右侧入屏，斜向左下划过（水平位移由起点反推，保证飞出左屏外）
  for (let i = 0; i < 2; i++) {
    const mx = 60 + Math.random() * 55;
    const my = -5 + Math.random() * 25;
    const ang = (25 + Math.random() * 20) * Math.PI / 180;           // 飞行俯角 25°~45°
    const hNeed = (mx + 25) / 100 * window.innerWidth;               // 水平位移：必然越过左屏外 25%
    const dist = hNeed / Math.cos(ang);                              // 沿俯角的斜向位移
    const dx = -Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    const rot = (180 + Math.atan2(dy, dx) * 180 / Math.PI) % 360;
    const cyc = 9 + Math.random() * 5;
    const delay = -(Math.random() * cyc);
    const tail = 90 + Math.random() * 100;
    html += `<div class="meteor" style="left:${mx}%;top:${my}%;--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--rot:${rot.toFixed(1)}deg;--cyc:${cyc.toFixed(1)}s;--delay:${delay.toFixed(1)}s;--tail:${tail.toFixed(0)}px"></div>`;
  }
  container.innerHTML = html;
}

// ========================================
// 动画系统（状态diff驱动，联机两端一致触发）
// 原则：动画基于两次渲染间的状态变化计算，而非点击事件，
// 因此操作者与旁观者走同一代码路径，无需额外同步。
// ========================================

let _animCtx = null;   // 当前渲染的动画上下文（渲染期间可读，如槽位pop）
let _lastSnap = null;  // 上次渲染时的状态快照

/** 渲染前调用：捕获token旧位置（FLIP首帧）+ 计算状态diff */
function captureAnimState() {
  // 上帧带逐格移动/返回数据、本帧已提交最终位置：跳过 FLIP（ghost 已展示移动过程）
  if ((_lastMoveSteps && !S._moveSteps) || (_lastReturnSteps && !S._returnSteps)) _skipNextFlips = true;
  const rects = new Map();
  if (S.phase === 'playing') {
    document.querySelectorAll('#app [data-pid]').forEach(el => {
      const r = el.getBoundingClientRect();
      rects.set(el.dataset.pid, { l: r.left, t: r.top });
    });
  }
  const snap = snapState();
  const diff = _lastSnap ? diffState(_lastSnap, snap) : null;
  _lastSnap = snap;
  _animCtx = { rects, diff, phase: S.phase };
  return _animCtx;
}

/** 状态快照：动画依赖的最小状态集 */
function snapState() {
  return {
    phase: S.phase,
    ap: S.ap,
    curPlayer: S.currentPlayer,
    turnPhase: S.turnPhase,
    picked: (S.tiles || []).map(t => !!t.picked),
    pickedDisc: (S.path || []).map(el => el.type === 'discarded' ? !!el.picked : null),
    discUids: (S.path || []).map(el => el.type === 'discarded' ? el.uid : null),
    ogs: (S.path || []).map(el => el.type === 'ogs' ? !!el.active : null),
    accel: (S.path || []).map((_, i) => S.accelMarks.includes(i)),
    slots: (S.players || []).map(p => p.supplies.map(s => s.uid)),
    o2: (S.players || []).map(p => p.oxygen.map(c => c.uid)),
  };
}

/** 计算两次渲染之间的状态变化 */
function diffState(a, b) {
  if (a.phase !== 'playing' || b.phase !== 'playing') return null;
  const d = {};
  // AP变化：仅同一位玩家的行动回合内提示（跨回合/回基地不飘字）
  if (a.curPlayer === b.curPlayer && b.turnPhase !== 'idle' && a.ap !== b.ap) {
    d.apDelta = b.ap - a.ap;
  }
  // 板块被拾取
  d.pickedTiles = [];
  b.picked.forEach((v, i) => { if (v && !a.picked[i]) d.pickedTiles.push(i); });
  // 路径上的丢弃物资被拾取（按uid识别，避免路径插入导致索引偏移误判）
  d.pickedDiscs = [];
  b.discUids.forEach((uid, i) => {
    if (uid !== null && uid !== undefined && b.pickedDisc[i]) {
      const oldIdx = a.discUids.indexOf(uid);
      if (oldIdx !== -1 && !a.pickedDisc[oldIdx]) d.pickedDiscs.push(i);
    }
  });
  // 新出现的丢弃物资（按uid识别，随路径插入位置无关）
  d.newDiscarded = [];
  b.discUids.forEach((uid, i) => {
    if (uid !== null && uid !== undefined && !a.discUids.includes(uid)) d.newDiscarded.push(i);
  });
  // OGS 被磁暴摧毁
  d.deadOGS = [];
  b.ogs.forEach((v, i) => { if (!v && a.ogs[i]) d.deadOGS.push(i); });
  // 新放置的加速标记
  d.newAccels = [];
  b.accel.forEach((v, i) => { if (v && !a.accel[i]) d.newAccels.push(i); });
  // 槽位新增物资/氧气卡（按uid识别，避免元素错位误报）
  d.newSupplies = [];
  b.slots.forEach((slots, pi) => {
    const oldSet = new Set(a.slots[pi] || []);
    slots.forEach((uid, si) => { if (uid !== undefined && !oldSet.has(uid)) d.newSupplies.push({ pi, si }); });
  });
  d.newO2 = [];
  b.o2.forEach((cards, pi) => {
    const oldSet = new Set(a.o2[pi] || []);
    cards.forEach((uid, si) => { if (uid !== undefined && !oldSet.has(uid)) d.newO2.push({ pi, si }); });
  });
  return d;
}

/** 渲染后调用：播放本次状态变化对应的动画 */
function playAnimEffects(ctx) {
  _animCtx = null;
  _lastMoveSteps = S._moveSteps || null;
  _lastReturnSteps = S._returnSteps || null;
  if (!ctx || ctx.phase !== 'playing') { _skipNextFlips = false; return; }
  playTokenFlips(ctx.rects);

  // 逐格动画：返回基地动画优先；新steps到达（操作端首帧或观战端收到A）→ 启动；进行中 → 维持原token隐藏
  if (S._returnSteps && S._returnSteps.length >= 1 && !_moveAnim) {
    startMoveAnim(S._returnSteps, S.currentPlayer, true);
  } else if (S._moveSteps && S._moveSteps.length >= 1 && !_moveAnim) {
    const boardRover = !!S._pendingBoardRover;
    delete S._pendingBoardRover;
    startMoveAnim(S._moveSteps, S.currentPlayer, false, boardRover);
  } else if (_moveAnim) {
    const tok = document.querySelector(`#app [data-pid="${_moveAnim.pIdx}"]`);
    if (tok) tok.style.display = 'none';
  }

  const d = ctx.diff;
  if (!d) { _skipNextFlips = false; return; }

  // AP变化：数字bump + 飘字（丢弃操作不飘字）
  if (d.apDelta && d.newDiscarded.length === 0) {
    const el = document.querySelector('.ap-display strong');
    if (el) {
      bump(el);
      floatText(el, (d.apDelta > 0 ? '+' : '') + d.apDelta + ' AP',
        d.apDelta > 0 ? 'float-gain' : 'float-cost', 60);
    }
  }

  // 物资回收：板块闪光 + 飘字
  d.pickedTiles.forEach(i => {
    const tile = document.querySelector(`.tile[data-tileidx="${i}"]`);
    if (tile) {
      tile.classList.add('collect-flash');
      floatText(tile, '📦 回收', 'float-supply');
    }
  });
  d.pickedDiscs.forEach(i => {
    const tile = document.querySelector(`.discarded-supply-tile[data-discidx="${i}"]`);
    if (tile) {
      tile.classList.add('collect-flash');
      floatText(tile, '📦 回收', 'float-supply');
    }
  });

  // 新丢弃的物资：原地pop出现
  d.newDiscarded.forEach(i => {
    const el = document.querySelector(`.discarded-supply-tile[data-discidx="${i}"]`);
    if (el) el.classList.add('discard-pop');
  });

  // 磁暴摧毁：OGS芯片闪烁（弹窗已在showStormModal中延迟）
  d.deadOGS.forEach(i => {
    const chip = document.querySelector(`.ogs-chip[data-ogspos="${i}"]`);
    if (chip) chip.classList.add('die-anim');
  });

  // 新放置的加速标记：电光弹入 + 光圈扩散 + 微震动（标记可能落在板块/损毁OGS/丢弃物资上）
  d.newAccels.forEach(i => {
    const el = pathElByIndex(i);
    if (el) el.classList.add('accel-place');
  });
  _skipNextFlips = false;
}

/** 按路径位置定位板块元素（tile用tileIdx索引，OGS/丢弃物资用路径索引） */
function pathElByIndex(pathIdx) {
  const el = S.path[pathIdx];
  if (!el) return null;
  if (el.type === 'tile') return document.querySelector(`.tile[data-tileidx="${el.tileIdx}"]`);
  if (el.type === 'ogs') return document.querySelector(`.ogs-chip[data-ogspos="${pathIdx}"]`);
  if (el.type === 'discarded') return document.querySelector(`.discarded-supply-tile[data-discidx="${pathIdx}"]`);
  return null;
}

/** FLIP：token 从旧位置补间到新位置（逐格动画时跳过） */
let _skipNextFlips = false;

/** 逐格移动动画状态机（状态驱动，联机两端一致播放） */
let _moveAnim = null;      // { steps, pIdx, returning }：动画进行中
let _lastMoveSteps = null; // 上一次渲染时的 S._moveSteps，用于抑制动画后的 FLIP
let _lastReturnSteps = null; // 上一次渲染时的 S._returnSteps，用于抑制返回后的 FLIP
let _moveGhost = null;     // 动画 ghost：播完后保留在终位，等待最终状态渲染时自然替换
let _ghostCleanupTimer = null; // ghost 保留期间的超时兜底（网络异常防残留）
let _deferRender = false;  // 观战端：动画播放中收到最终状态，渲染延迟到动画播完

/** 移除动画 ghost（并清理兜底定时器） */
function _removeMoveGhost() {
  if (_ghostCleanupTimer) { clearTimeout(_ghostCleanupTimer); _ghostCleanupTimer = null; }
  if (_moveGhost) { _moveGhost.remove(); _moveGhost = null; }
}

/** 兜底：最终状态迟迟未到（网络异常）时强制移除 ghost、恢复 token 可见 */
function _scheduleGhostCleanup(pIdx) {
  if (_ghostCleanupTimer) clearTimeout(_ghostCleanupTimer);
  const ghostEl = _moveGhost;
  _ghostCleanupTimer = setTimeout(() => {
    _ghostCleanupTimer = null;
    // 只清理自己记下的 ghost；若已被新动画的 ghost 替换（如下一玩家快速行动），不能误删
    if (_moveGhost !== ghostEl) return;
    _removeMoveGhost();
    const tok = document.querySelector(`#app [data-pid="${pIdx}"]`);
    if (tok) tok.style.display = '';
  }, 3000);
}

function playTokenFlips(oldRects) {
  if (!oldRects || oldRects.size === 0 || _skipNextFlips) return;
  _skipNextFlips = false;
  document.querySelectorAll('#app [data-pid]').forEach(el => {
    const old = oldRects.get(el.dataset.pid);
    if (!old) return;
    const r = el.getBoundingClientRect();
    const dx = old.l - r.left;
    const dy = old.t - r.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    el.classList.add('flipping');
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.transition = 'none';
    el.getBoundingClientRect(); // 锁定首帧
    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.34s cubic-bezier(0.25, 0.7, 0.3, 1)';
      el.style.transform = 'translate(0, 0)';
    });
    el.addEventListener('transitionend', function cleanup() {
      el.removeEventListener('transitionend', cleanup);
      el.style.transition = '';
      el.style.transform = '';
      el.classList.remove('flipping');
    });
  });
}

/** 数字跳动 */
function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

/** 飘字：fixed定位在锚点元素上方，上浮淡出后移除 */
function floatText(anchorEl, text, cls, offsetX = 0) {
  const r = anchorEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'float-text ' + (cls || '');
  el.textContent = text;
  el.style.left = (r.left + r.width / 2 + offsetX) + 'px';
  el.style.top = r.top + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

/** 基地落点（相对 path-board 的百分比坐标）：该玩家基地token将出现的槽位（已有token之后） */
function baseSlotPos() {
  const board = document.querySelector('.path-board');
  const slots = document.querySelector('.base-tokens');
  const br = board.getBoundingClientRect();
  const sr = slots.getBoundingClientRect();
  let x = sr.left;
  const toks = slots.querySelectorAll('.base-token');
  if (toks.length) {
    x = toks[toks.length - 1].getBoundingClientRect().right + 2;
  }
  const bl = ((x + 12 - br.left) / br.width * 100).toFixed(1);
  const bt = ((sr.top + 12 - br.top) / br.height * 100).toFixed(1);
  return { bl, bt };
}

/** 逐格移动动画：ghost token 沿路径一步步前进/后退（基地出发时先降落到第一格） */
function animateTokenSteps(steps, pIdx) {
  return new Promise(resolve => {
    const from = S.players[pIdx].pos;
    // 基地出发至少1步（基地→第一格），普通移动至少2步才有动画
    if (steps.length < (from === -1 ? 1 : 2)) { resolve(); return; }
    const board = document.querySelector('.path-board');
    if (!board) { resolve(); return; }
    const p = S.players[pIdx];
    const onRover = p.onRover;
    const ghost = document.createElement('div');
    ghost.className = 'token-ghost' + (onRover ? ' rover-ghost' : '');
    // 骑月球车移动：ghost 复刻"人+车"组合，与地图静态渲染一致
    ghost.innerHTML = onRover
      ? `<div class="rover-combo-wrap">
          <div class="rover-combo">
            <div class="rover-combo-token">${tokenSVG(p.color)}</div>
            <div class="rover-combo-icon">${roverSVG(p.color)}</div>
          </div>
        </div>`
      : tokenSVG(p.color);
    board.appendChild(ghost);
    _moveGhost = ghost;

    const numRows = Math.ceil(S.path.length / COLS);
    const boardH = BOARD.y0 + (numRows - 1) * (BOARD.maxTilt + BOARD.rowGap) + BOARD.tileW + 3;

    // 定位 ghost 到起点（无过渡）：基地出发 → 基地token位置；否则 steps[0]
    function posStyle(idx) {
      if (idx === -1) {
        // 返回基地：落到该玩家基地token将出现的位置（已有token之后）
        const { bl, bt } = baseSlotPos();
        if (onRover) return { left: bl, top: bt };
        return { left: `calc(${bl}% - 21px)`, top: `calc(${bt}% - 10px)` };
      }
      const { x, y } = tilePos(idx);
      if (onRover) {
        // 组合ghost与板块等大，且与板块完全同位置（板块left/top是其中心坐标）
        const left = (x - BOARD.tileW / 2).toFixed(1);
        const top = ((y - BOARD.tileW / 2) / boardH * 100).toFixed(1);
        return { left: `${left}%`, top: `${top}%` };
      }
      const left = (x + BOARD.tileW / 2).toFixed(1);
      const top = ((y - BOARD.tileW / 2) / boardH * 100).toFixed(1);
      return { left: `calc(${left}% - 21px)`, top: `calc(${top}% - 10px)` };
    }

    // 每步视觉：奇数行翻转；骑车组合在月球车板块上不缩放（与静态渲染一致）
    function applyStepVisual(idx) {
      const flip = Math.floor(idx / COLS) % 2 === 0;
      if (onRover) {
        ghost.classList.toggle('flip-tok', flip);
        ghost.classList.toggle('tile-rover', idx === tilePathIdx(S.roverPos));
      } else {
        ghost.style.transform = flip ? 'scaleX(-1)' : 'scaleX(1)';
      }
    }

    ghost.style.transition = 'none';
    if (from === -1) {
      // 基地token坐标换算成path-board百分比（必须在token被隐藏前调用）
      const baseTok = document.querySelector(`.base-token[data-pid="${pIdx}"]`);
      const br = board.getBoundingClientRect();
      if (baseTok) {
        const tr = baseTok.getBoundingClientRect();
        const bl = ((tr.left + tr.width / 2 - br.left) / br.width * 100).toFixed(1);
        const bt = ((tr.top + tr.height / 2 - br.top) / br.height * 100).toFixed(1);
        ghost.style.left = `calc(${bl}% - 21px)`;
        ghost.style.top = `calc(${bt}% - 10px)`;
        applyStepVisual(steps[0]);
      } else {
        const s0 = posStyle(steps[0]);
        ghost.style.left = s0.left;
        ghost.style.top = s0.top;
        applyStepVisual(steps[0]);
      }
    } else {
      const s0 = posStyle(steps[0]);
      ghost.style.left = s0.left;
      ghost.style.top = s0.top;
      applyStepVisual(steps[0]);
    }
    ghost.getBoundingClientRect(); // 强制首帧

    ghost.style.transition = 'left 240ms ease-in-out, top 240ms ease-in-out, transform 0ms';

    let i = from === -1 ? 0 : 1;
    function step() {
      // 播完不 remove ghost：由 startMoveAnim 决定移除时机（未提交状态时保留在终位）
      if (i >= steps.length) { resolve(); return; }
      const s = posStyle(steps[i]);
      ghost.style.left = s.left;
      ghost.style.top = s.top;
      applyStepVisual(steps[i]);
      i++;
      if (i >= steps.length) {
        setTimeout(step, 240);
      } else {
        setTimeout(step, 260);
      }
    }
    step();
  });
}

/**
 * 启动逐格移动/返回动画（状态驱动，联机两端一致）：
 * 隐藏原token让ghost看起来是本尊在走；动画完成后仅操作端提交最终位置并同步。
 * @param {boolean} [returning] - 返回基地动画：提交时置 returned、pos=-1
 */
function startMoveAnim(steps, pIdx, returning = false, boardRover = false) {
  const isActor = typeof window._olIsActor !== 'function' || window._olIsActor();
  _moveAnim = { steps, pIdx, from: S.players[pIdx].pos, returning, boardRover };
  document.body.classList.add('anim-moving');
  // 先启动动画（同步完成ghost首帧定位，基地出发需读取base-token坐标），再隐藏原token
  const animPromise = animateTokenSteps(steps, pIdx);
  const tok = document.querySelector(`#app [data-pid="${pIdx}"]`);
  if (tok) tok.style.display = 'none';
  animPromise.then(() => {
    const anim = _moveAnim;
    _moveAnim = null;
    document.body.classList.remove('anim-moving');
    const stepsKey = anim && anim.returning ? '_returnSteps' : '_moveSteps';
    // 最终位置状态已提交（操作端 delete 后 / 观战端收到状态B）：移除 ghost、恢复真实 token
    if (!S[stepsKey]) {
      _removeMoveGhost();
      const tok = document.querySelector(`#app [data-pid="${pIdx}"]`);
      if (tok) tok.style.display = '';
    } else {
      // 状态未提交（操作端随后 delete+render；观战端等 B 推送后 render）：
      // ghost 保留在终位，render 重建 DOM 时自然替换为同位置的真实 token；
      // 超时兜底，防止网络异常导致 ghost 永久残留
      _scheduleGhostCleanup(pIdx);
    }
    if (!isActor || !anim) {
      // 动画播放期间收到过最终状态、渲染被延迟（_deferRender）：
      // 动画播完这一刻 ghost 已在终位，补一次 render 换成同位置的真实 token
      if (_deferRender) { _deferRender = false; render(); }
      return;
    }
    const p = S.players[pIdx];
    // 动画期间位置被其他行动改动过（如返回基地）→ 放弃移动提交，仅清理动画数据
    if (p.pos === anim.from && !p.returned) {
      if (anim.returning) {
        p.pos = -1;
        p.returned = true;
      } else {
        p.pos = anim.steps[anim.steps.length - 1];
        // 登上月球车：动画期间 ghost/地图不展示车，提交时才真正标记（与 executePlayerMove 同步）
        if (anim.boardRover) { p.onRover = true; S.roverUsed = true; }
      }
    }
    delete S[stepsKey];
    saveState();
    render();
    // 提交完成：清掉本动画的兜底定时器与已随 render 销毁的 ghost，
    // 否则残留定时器会在下一玩家动画播放时误删其 ghost
    _removeMoveGhost();
  });
}
