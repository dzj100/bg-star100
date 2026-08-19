/* ============================================================
 * 《深渊回响》Abyss Echo — 数据定义
 * 纯数据文件：禁函数、禁闭包，保证 state 可 JSON 序列化（联机前提）
 * ============================================================ */

/* ---------- 状态效果元信息 ---------- */
const BUFF_META = {
  strength:   { name: '力量', kind: 'buff', desc: '攻击伤害+X' },
  dexterity:  { name: '敏捷', kind: 'buff', desc: '获得护甲+X' },
  regen:      { name: '再生', kind: 'buff', desc: '回合开始回复X生命' },
  draw:       { name: '潮汐预兆', kind: 'buff', desc: '每回合多抽X张牌' },
  energy:     { name: '深渊之眼', kind: 'buff', desc: '每回合+X能量' },
  poison:     { name: '中毒', kind: 'debuff', desc: '回合开始失去X生命，持续整个战斗' },
  vulnerable: { name: '易伤', kind: 'debuff', desc: '每层受到伤害+50%' },
  weak:       { name: '虚弱', kind: 'debuff', desc: '每层造成的伤害-20%（可叠加）' },
  guard:      { name: '守护', kind: 'buff', desc: '代替队友承受伤害' },
  fear:       { name: '恐惧', kind: 'debuff', desc: '回合开始X%概率跳过行动' },
  rage:       { name: '愤怒', kind: 'buff', desc: '每受1次伤攻击+1；当前攻击+X' },
  curse:      { name: '诅咒', kind: 'debuff', desc: '打出攻击牌时损失X生命' },
};

const BUFF_KEYS = Object.keys(BUFF_META);
function emptyBuffs() {
  const b = {};
  for (const k of BUFF_KEYS) b[k] = 0;
  return b;
}

/* ---------- 职业 ---------- */
const CLASSES = {
  warder: {
    id: 'warder', name: '守望者', title: '深渊壁垒的执灯人',
    hp: 80, color: '#4da6ff', img: 'assets/heroes/warder.png',
    desc: '用坚盾与誓言守护队伍的第一道防线，替队友承受深渊的撕咬。',
    mechanic: '守护', mechanicDesc: '打出【守护】效果后，本回合替指定队友承受伤害',
  },
  scholar: {
    id: 'scholar', name: '潮汐学者', title: '诵读潮汐秘卷的求知者',
    hp: 55, color: '#9b6bff', img: 'assets/heroes/scholar.png',
    desc: '驱使潮汐之力倾泻法术，以中毒与虚弱侵蚀深渊的躯壳。',
    mechanic: '潮汐', mechanicDesc: '每打出3张攻击牌，触发1次潮汐爆发（对随机敌人造成6点伤害）',
  },
  hunter: {
    id: 'hunter', name: '深渊猎手', title: '游弋于黑暗中的伏击者',
    hp: 65, color: '#39d98a', img: 'assets/heroes/hunter.png',
    desc: '以连击与多段刺击撕开猎物的甲壳，越战越勇。',
    mechanic: '连击', mechanicDesc: '本回合每打出1张牌，下一张攻击牌伤害+1',
  },
  healer: {
    id: 'healer', name: '圣汐医者', title: '潮汐圣光的持有者',
    hp: 60, color: '#ffd166', img: 'assets/heroes/healer.png',
    desc: '以圣汐之力治愈创伤、净化诅咒，是深渊中最温柔的救赎。',
    mechanic: '净化', mechanicDesc: '打出净化卡成功移除队友负面状态时，获得1点能量',
  },
};

/* ---------- 卡牌 ----------
 * effects 效果数组，元素类型：
 *   {t:'damage', n}                     对目标造成伤害
 *   {t:'multiHit', n, times}            多段伤害
 *   {t:'damageRandom', n, times}        随机敌人n伤×times
 *   {t:'allDamage', n}                  全体敌人伤害
 *   {t:'block', n}                      获得护甲
 *   {t:'allBlock', n}                   全队获得护甲
 *   {t:'draw', n}                       抽牌
 *   {t:'energy', n}                     获得能量
 *   {t:'heal', n}                       治疗
 *   {t:'allHeal', n}                    全队治疗
 *   {t:'applyStatus', status, n}        施加状态（友方/敌方按 target）
 *   {t:'allStatus', status, n}          全体施加状态
 *   {t:'buff', buff, n}                 增益
 *   {t:'allBuff', buff, n}              全队增益
 *   {t:'loseHp', n}                     失去生命
 *   {t:'removeDebuff', n}               移除n层负面状态（目标）
 *   {t:'pierce'}                        本次攻击无视护甲（修饰符）
 *   {t:'cond', cond:'hurt|poisoned|combo', n}  条件增伤（本回合受伤/目标中毒/本回合出牌数）
 *   {t:'guard', n}                      守护效果
 *   {t:'exhaust'}                       消耗此牌（修饰符，也可用卡牌字段 exhaust:true）
 * 目标：target:'enemy'|'ally'|'allEnemies'|'allParty'|'self'|'randomEnemy'
 * 升级：upgEffects 覆盖 effects（无则自动按统一规则 +30%）
 * ----------------------------------- */

const CARDS = {
  /* ========== 守望者 Warder ========== */
  warder_strike: { id:'warder_strike', name:'深渊猛击', cost:1, type:'attack', target:'enemy', rarity:'starter',
    desc:'造成6点伤害', effects:[{t:'damage',n:6}], upgEffects:[{t:'damage',n:9}] },
  warder_defend: { id:'warder_defend', name:'深渊护盾', cost:1, type:'skill', target:'self', rarity:'starter',
    desc:'获得5点护甲', effects:[{t:'block',n:5}], upgEffects:[{t:'block',n:8}] },
  warder_vow: { id:'warder_vow', name:'守护之誓', cost:1, type:'skill', target:'allParty', rarity:'starter',
    desc:'全队获得2层守护，抽1张牌', effects:[{t:'guard',n:2},{t:'draw',n:1}], upgEffects:[{t:'guard',n:3},{t:'draw',n:1}] },
  warder_bulwark: { id:'warder_bulwark', name:'深海壁垒', cost:2, type:'skill', target:'self', rarity:'common', exhaust:true,
    desc:'获得15点护甲。消耗', effects:[{t:'block',n:15}], upgEffects:[{t:'block',n:20}] },
  warder_hammer: { id:'warder_hammer', name:'深渊重锤', cost:2, type:'attack', target:'enemy', rarity:'common',
    desc:'造成10点伤害，施加1层易伤', effects:[{t:'damage',n:10},{t:'applyStatus',status:'vulnerable',n:1}], upgEffects:[{t:'damage',n:14},{t:'applyStatus',status:'vulnerable',n:1}] },
  warder_tidewall: { id:'warder_tidewall', name:'潮汐壁垒', cost:2, type:'skill', target:'allParty', rarity:'common',
    desc:'全队获得4点护甲', effects:[{t:'allBlock',n:4}], upgEffects:[{t:'allBlock',n:6}] },
  warder_stance: { id:'warder_stance', name:'铁壁姿态', cost:1, type:'power', target:'self', rarity:'uncommon',
    desc:'获得1层敏捷（每回合护甲+1）', effects:[{t:'buff',buff:'dexterity',n:1}], upgEffects:[{t:'buff',buff:'dexterity',n:2}] },
  warder_venge: { id:'warder_venge', name:'复仇深渊', cost:2, type:'attack', target:'enemy', rarity:'uncommon',
    desc:'造成8点伤害；本回合若受过伤，再造成8点伤害', effects:[{t:'damage',n:8},{t:'cond',cond:'hurt',n:8}], upgEffects:[{t:'damage',n:11},{t:'cond',cond:'hurt',n:11}] },
  warder_aegis: { id:'warder_aegis', name:'深渊巨盾', cost:1, type:'skill', target:'self', rarity:'common',
    desc:'获得5点护甲，抽1张牌', effects:[{t:'block',n:5},{t:'draw',n:1}], upgEffects:[{t:'block',n:8},{t:'draw',n:1}] },
  warder_taunt: { id:'warder_taunt', name:'深海嘲讽', cost:1, type:'skill', target:'allEnemies', rarity:'uncommon',
    desc:'所有敌人获得1层易伤', effects:[{t:'allStatus',status:'vulnerable',n:1}], upgEffects:[{t:'allStatus',status:'vulnerable',n:2}] },
  warder_watch: { id:'warder_watch', name:'不灭守望', cost:2, type:'power', target:'self', rarity:'rare',
    desc:'获得3层力量（攻击伤害+3）和3层敏捷（每回合护甲+3）', effects:[{t:'buff',buff:'strength',n:3},{t:'buff',buff:'dexterity',n:3}], upgEffects:[{t:'buff',buff:'strength',n:4},{t:'buff',buff:'dexterity',n:4}] },
  warder_echo: { id:'warder_echo', name:'深渊回响', cost:1, type:'attack', target:'enemy', rarity:'common',
    desc:'造成4点伤害，获得4点护甲', effects:[{t:'damage',n:4},{t:'block',n:4}], upgEffects:[{t:'damage',n:6},{t:'block',n:6}] },
  warder_brace: { id:'warder_brace', name:'战备姿态', cost:1, type:'skill', target:'self', rarity:'common',
    desc:'获得2点能量', effects:[{t:'energy',n:2}], upgEffects:[{t:'energy',n:3}] },
  warder_link: { id:'warder_link', name:'守护链接', cost:1, type:'skill', target:'allParty', rarity:'common',
    desc:'全队获得2点护甲和1层守护', effects:[{t:'allBlock',n:2},{t:'guard',n:1}], upgEffects:[{t:'allBlock',n:3},{t:'guard',n:2}] },

  /* ========== 潮汐学者 Tide Scholar ========== */
  scholar_strike: { id:'scholar_strike', name:'深渊弹幕', cost:1, type:'attack', target:'enemy', rarity:'starter',
    desc:'造成7点伤害', effects:[{t:'damage',n:7}], upgEffects:[{t:'damage',n:10}] },
  scholar_defend: { id:'scholar_defend', name:'潮汐屏障', cost:1, type:'skill', target:'self', rarity:'starter',
    desc:'获得5点护甲', effects:[{t:'block',n:5}], upgEffects:[{t:'block',n:8}] },
  scholar_surge: { id:'scholar_surge', name:'潮汐涌动', cost:1, type:'skill', target:'self', rarity:'starter',
    desc:'获得2点能量，抽1张牌', effects:[{t:'energy',n:2},{t:'draw',n:1}], upgEffects:[{t:'energy',n:3},{t:'draw',n:1}] },
  scholar_corrosion: { id:'scholar_corrosion', name:'腐蚀之触', cost:1, type:'skill', target:'enemy', rarity:'common',
    desc:'施加4层中毒', effects:[{t:'applyStatus',status:'poison',n:4}], upgEffects:[{t:'applyStatus',status:'poison',n:6}] },
  scholar_vortex: { id:'scholar_vortex', name:'深渊漩涡', cost:2, type:'attack', target:'allEnemies', rarity:'common',
    desc:'对所有敌人造成6点伤害', effects:[{t:'allDamage',n:6}], upgEffects:[{t:'allDamage',n:9}] },
  scholar_burst: { id:'scholar_burst', name:'潮汐爆发', cost:2, type:'attack', target:'enemy', rarity:'common',
    desc:'造成16点伤害', effects:[{t:'damage',n:16}], upgEffects:[{t:'damage',n:22}] },
  scholar_erosion: { id:'scholar_erosion', name:'精神侵蚀', cost:1, type:'skill', target:'enemy', rarity:'common',
    desc:'施加2层虚弱，抽1张牌', effects:[{t:'applyStatus',status:'weak',n:2},{t:'draw',n:1}], upgEffects:[{t:'applyStatus',status:'weak',n:3},{t:'draw',n:1}] },
  scholar_wisdom: { id:'scholar_wisdom', name:'深渊智慧', cost:1, type:'skill', target:'self', rarity:'common',
    desc:'抽2张牌', effects:[{t:'draw',n:2}], upgEffects:[{t:'draw',n:3}] },
  scholar_fury: { id:'scholar_fury', name:'潮汐之怒', cost:1, type:'power', target:'self', rarity:'uncommon',
    desc:'获得1层力量（攻击伤害+1）', effects:[{t:'buff',buff:'strength',n:1}], upgEffects:[{t:'buff',buff:'strength',n:2}] },
  scholar_nova: { id:'scholar_nova', name:'深渊新星', cost:3, type:'attack', target:'allEnemies', rarity:'rare',
    desc:'对所有敌人造成10点伤害', effects:[{t:'allDamage',n:10}], upgEffects:[{t:'allDamage',n:14}] },
  scholar_curse: { id:'scholar_curse', name:'深渊诅咒', cost:2, type:'skill', target:'allEnemies', rarity:'uncommon',
    desc:'所有敌人获得3层中毒', effects:[{t:'allStatus',status:'poison',n:3}], upgEffects:[{t:'allStatus',status:'poison',n:5}] },
  scholar_vision: { id:'scholar_vision', name:'潮汐预兆', cost:1, type:'power', target:'self', rarity:'rare',
    desc:'每回合多抽1张牌', effects:[{t:'buff',buff:'draw',n:1}], upgEffects:[{t:'buff',buff:'draw',n:2}] },
  scholar_echo: { id:'scholar_echo', name:'回响术', cost:1, type:'attack', target:'enemy', rarity:'common',
    desc:'造成5点伤害，抽1张牌', effects:[{t:'damage',n:5},{t:'draw',n:1}], upgEffects:[{t:'damage',n:8},{t:'draw',n:1}] },
  scholar_drain: { id:'scholar_drain', name:'灵魂虹吸', cost:2, type:'attack', target:'enemy', rarity:'uncommon',
    desc:'造成8点伤害，治疗自己3点生命', effects:[{t:'damage',n:8},{t:'heal',n:3}], upgEffects:[{t:'damage',n:12},{t:'heal',n:5}] },

  /* ========== 深渊猎手 Abyss Hunter ========== */
  hunter_strike: { id:'hunter_strike', name:'鱼叉刺击', cost:1, type:'attack', target:'enemy', rarity:'starter',
    desc:'造成5点伤害', effects:[{t:'damage',n:5}], upgEffects:[{t:'damage',n:8}] },
  hunter_defend: { id:'hunter_defend', name:'闪避步法', cost:1, type:'skill', target:'self', rarity:'starter',
    desc:'获得5点护甲', effects:[{t:'block',n:5}], upgEffects:[{t:'block',n:8}] },
  hunter_twin: { id:'hunter_twin', name:'双刃鱼叉', cost:1, type:'attack', target:'enemy', rarity:'starter',
    desc:'造成4点伤害2次', effects:[{t:'multiHit',n:4,times:2}], upgEffects:[{t:'multiHit',n:6,times:2}] },
  hunter_step: { id:'hunter_step', name:'暗影步', cost:1, type:'skill', target:'self', rarity:'common',
    desc:'获得2层敏捷（每回合护甲+1），抽1张牌', effects:[{t:'buff',buff:'dexterity',n:2},{t:'draw',n:1}], upgEffects:[{t:'buff',buff:'dexterity',n:3},{t:'draw',n:1}] },
  hunter_instinct: { id:'hunter_instinct', name:'猎杀本能', cost:1, type:'power', target:'self', rarity:'common',
    desc:'获得1层力量（攻击伤害+1）', effects:[{t:'buff',buff:'strength',n:1}], upgEffects:[{t:'buff',buff:'strength',n:2}] },
  hunter_venom: { id:'hunter_venom', name:'淬毒匕首', cost:1, type:'attack', target:'enemy', rarity:'common',
    desc:'造成3点伤害，施加3层中毒', effects:[{t:'damage',n:3},{t:'applyStatus',status:'poison',n:3}], upgEffects:[{t:'damage',n:5},{t:'applyStatus',status:'poison',n:4}] },
  hunter_chain: { id:'hunter_chain', name:'连环穿刺', cost:2, type:'attack', target:'enemy', rarity:'uncommon',
    desc:'造成5点伤害3次', effects:[{t:'multiHit',n:5,times:3}], upgEffects:[{t:'multiHit',n:7,times:3}] },
  hunter_pierce: { id:'hunter_pierce', name:'破甲猎手', cost:2, type:'attack', target:'enemy', rarity:'uncommon',
    desc:'造成10点伤害，无视护甲', effects:[{t:'damage',n:10},{t:'pierce'}], upgEffects:[{t:'damage',n:14},{t:'pierce'}] },
  hunter_lethal: { id:'hunter_lethal', name:'致命连击', cost:2, type:'attack', target:'enemy', rarity:'rare',
    desc:'造成4点伤害；本回合每打出过1张牌，额外造成2点伤害', effects:[{t:'damage',n:4},{t:'cond',cond:'combo',n:2}], upgEffects:[{t:'damage',n:6},{t:'cond',cond:'combo',n:3}] },
  hunter_blood: { id:'hunter_blood', name:'血猎之刃', cost:1, type:'attack', target:'enemy', rarity:'common',
    desc:'造成6点伤害，治疗自己2点生命', effects:[{t:'damage',n:6},{t:'heal',n:2}], upgEffects:[{t:'damage',n:9},{t:'heal',n:3}] },
  hunter_watch: { id:'hunter_watch', name:'深渊哨戒', cost:1, type:'power', target:'self', rarity:'uncommon',
    desc:'获得1层敏捷（每回合护甲+1）', effects:[{t:'buff',buff:'dexterity',n:1}], upgEffects:[{t:'buff',buff:'dexterity',n:2}] },
  hunter_lurk: { id:'hunter_lurk', name:'深渊潜伏', cost:1, type:'skill', target:'self', rarity:'common',
    desc:'抽2张牌', effects:[{t:'draw',n:2}], upgEffects:[{t:'draw',n:3}] },
  hunter_focus: { id:'hunter_focus', name:'专注猎手', cost:1, type:'skill', target:'self', rarity:'common',
    desc:'获得2点能量', effects:[{t:'energy',n:2}], upgEffects:[{t:'energy',n:3}] },
  hunter_snare: { id:'hunter_snare', name:'缠网陷阱', cost:1, type:'skill', target:'allEnemies', rarity:'common',
    desc:'所有敌人获得1层虚弱', effects:[{t:'allStatus',status:'weak',n:1}], upgEffects:[{t:'allStatus',status:'weak',n:2}] },

  /* ========== 圣汐医者 Tide Healer ========== */
  healer_sooth: { id:'healer_sooth', name:'圣汐抚慰', cost:1, type:'skill', target:'ally', rarity:'starter',
    desc:'治疗5点生命', effects:[{t:'heal',n:5}], upgEffects:[{t:'heal',n:8}] },
  healer_defend: { id:'healer_defend', name:'圣水屏障', cost:1, type:'skill', target:'self', rarity:'starter',
    desc:'获得5点护甲', effects:[{t:'block',n:5}], upgEffects:[{t:'block',n:8}] },
  healer_deep: { id:'healer_deep', name:'深海治愈', cost:2, type:'skill', target:'ally', rarity:'starter',
    desc:'治疗12点生命', effects:[{t:'heal',n:12}], upgEffects:[{t:'heal',n:18}] },
  healer_purify: { id:'healer_purify', name:'净化之潮', cost:1, type:'skill', target:'ally', rarity:'common',
    desc:'移除1层负面状态，治疗5点生命', effects:[{t:'removeDebuff',n:1},{t:'heal',n:5}], upgEffects:[{t:'removeDebuff',n:1},{t:'heal',n:8}] },
  healer_wash: { id:'healer_wash', name:'圣汐洗涤', cost:2, type:'skill', target:'allParty', rarity:'uncommon',
    desc:'全队各移除1层负面状态', effects:[{t:'removeDebuffAll',n:1}], upgEffects:[{t:'removeDebuffAll',n:2}] },
  healer_bless: { id:'healer_bless', name:'赐福', cost:1, type:'skill', target:'allParty', rarity:'common',
    desc:'全队获得3点护甲，抽1张牌', effects:[{t:'allBlock',n:3},{t:'draw',n:1}], upgEffects:[{t:'allBlock',n:5},{t:'draw',n:1}] },
  healer_mark: { id:'healer_mark', name:'圣印守护', cost:1, type:'skill', target:'allParty', rarity:'common',
    desc:'全队获得1层守护', effects:[{t:'guard',n:1}], upgEffects:[{t:'guard',n:2}] },
  healer_hymn: { id:'healer_hymn', name:'潮汐圣歌', cost:2, type:'power', target:'self', rarity:'uncommon',
    desc:'获得2层再生（回合开始回复2生命）', effects:[{t:'buff',buff:'regen',n:2}], upgEffects:[{t:'buff',buff:'regen',n:3}] },
  healer_bolt: { id:'healer_bolt', name:'圣光弹', cost:1, type:'attack', target:'enemy', rarity:'common',
    desc:'造成6点伤害', effects:[{t:'damage',n:6}], upgEffects:[{t:'damage',n:9}] },
  healer_redemption: { id:'healer_redemption', name:'深渊救赎', cost:3, type:'skill', target:'allParty', rarity:'rare',
    desc:'全队治疗8点生命', effects:[{t:'allHeal',n:8}], upgEffects:[{t:'allHeal',n:12}] },
  healer_ring: { id:'healer_ring', name:'护佑之环', cost:2, type:'skill', target:'allParty', rarity:'uncommon',
    desc:'全队获得5点护甲', effects:[{t:'allBlock',n:5}], upgEffects:[{t:'allBlock',n:8}] },
  healer_guide: { id:'healer_guide', name:'灵汐引导', cost:1, type:'skill', target:'self', rarity:'common',
    desc:'抽2张牌', effects:[{t:'draw',n:2}], upgEffects:[{t:'draw',n:3}] },
  healer_verdict: { id:'healer_verdict', name:'圣者裁决', cost:2, type:'attack', target:'enemy', rarity:'uncommon',
    desc:'造成12点伤害；若目标中毒，额外6点伤害', effects:[{t:'damage',n:12},{t:'cond',cond:'poisoned',n:6}], upgEffects:[{t:'damage',n:16},{t:'cond',cond:'poisoned',n:8}] },
  healer_tide: { id:'healer_tide', name:'不息潮涌', cost:1, type:'power', target:'self', rarity:'uncommon',
    desc:'获得1层敏捷（每回合护甲+1）', effects:[{t:'buff',buff:'dexterity',n:1}], upgEffects:[{t:'buff',buff:'dexterity',n:2}] },
  healer_lustre: { id:'healer_lustre', name:'圣辉闪烁', cost:1, type:'skill', target:'self', rarity:'common',
    desc:'获得2点能量', effects:[{t:'energy',n:2}], upgEffects:[{t:'energy',n:3}] },

  /* ========== 中立 Neutral ========== */
  neutral_shard: { id:'neutral_shard', name:'深渊碎片', cost:0, type:'attack', target:'enemy', rarity:'common',
    desc:'造成3点伤害', effects:[{t:'damage',n:3}], upgEffects:[{t:'damage',n:5}] },
  neutral_prep: { id:'neutral_prep', name:'深潜准备', cost:0, type:'skill', target:'self', rarity:'common',
    desc:'抽1张牌', effects:[{t:'draw',n:1}], upgEffects:[{t:'draw',n:2}] },
  neutral_shell: { id:'neutral_shell', name:'应急甲壳', cost:1, type:'skill', target:'self', rarity:'common',
    desc:'获得4点护甲', effects:[{t:'block',n:4}], upgEffects:[{t:'block',n:7}] },
  neutral_barrier: { id:'neutral_barrier', name:'珊瑚屏障', cost:2, type:'skill', target:'self', rarity:'common',
    desc:'获得9点护甲', effects:[{t:'block',n:9}], upgEffects:[{t:'block',n:13}] },
  neutral_swarm: { id:'neutral_swarm', name:'深渊鱼群', cost:1, type:'attack', target:'enemy', rarity:'common',
    desc:'造成2点伤害3次', effects:[{t:'multiHit',n:2,times:3}], upgEffects:[{t:'multiHit',n:3,times:3}] },
  neutral_mist: { id:'neutral_mist', name:'迷雾诅咒', cost:1, type:'skill', target:'allEnemies', rarity:'uncommon',
    desc:'所有敌人获得1层虚弱', effects:[{t:'allStatus',status:'weak',n:1}], upgEffects:[{t:'allStatus',status:'weak',n:2}] },
  neutral_breath: { id:'neutral_breath', name:'深海呼吸', cost:1, type:'skill', target:'ally', rarity:'common',
    desc:'治疗3点生命', effects:[{t:'heal',n:3}], upgEffects:[{t:'heal',n:6}] },
  neutral_blessing: { id:'neutral_blessing', name:'潮汐祝福', cost:1, type:'skill', target:'allParty', rarity:'uncommon',
    desc:'全队获得2点护甲', effects:[{t:'allBlock',n:2}], upgEffects:[{t:'allBlock',n:4}] },
  neutral_sacrifice: { id:'neutral_sacrifice', name:'献祭仪式', cost:2, type:'skill', target:'self', rarity:'uncommon',
    desc:'失去3点生命，抽3张牌', effects:[{t:'loseHp',n:3},{t:'draw',n:3}], upgEffects:[{t:'loseHp',n:3},{t:'draw',n:4}] },
  neutral_eye: { id:'neutral_eye', name:'深渊之眼', cost:1, type:'power', target:'self', rarity:'rare',
    desc:'获得1层力量（攻击伤害+1）', effects:[{t:'buff',buff:'strength',n:1}], upgEffects:[{t:'buff',buff:'strength',n:2}] },
  neutral_compass: { id:'neutral_compass', name:'潮汐罗盘', cost:1, type:'power', target:'self', rarity:'rare',
    desc:'每回合多抽1张牌', effects:[{t:'buff',buff:'draw',n:1}], upgEffects:[{t:'buff',buff:'draw',n:2}] },
  neutral_lure: { id:'neutral_lure', name:'深海诱饵', cost:1, type:'skill', target:'allParty', rarity:'common',
    desc:'全队治疗2点生命，抽1张牌', effects:[{t:'allHeal',n:2},{t:'draw',n:1}], upgEffects:[{t:'allHeal',n:3},{t:'draw',n:2}] },
};

/* 初始卡组（每职业） */
const STARTER_DECKS = {
  warder: ['warder_strike','warder_strike','warder_strike','warder_strike','warder_strike',
           'warder_defend','warder_defend','warder_defend','warder_defend','warder_vow'],
  scholar: ['scholar_strike','scholar_strike','scholar_strike','scholar_strike','scholar_strike',
            'scholar_defend','scholar_defend','scholar_defend','scholar_defend','scholar_surge'],
  hunter: ['hunter_strike','hunter_strike','hunter_strike','hunter_strike','hunter_strike',
           'hunter_defend','hunter_defend','hunter_defend','hunter_defend','hunter_twin'],
  healer: ['healer_sooth','healer_sooth',
           'healer_bolt','healer_bolt','healer_bolt',
           'healer_defend','healer_defend','healer_defend',
           'healer_deep','healer_purify'],
};

/* 职业卡池（奖励三选一） */
const CLASS_POOLS = {
  warder: ['warder_bulwark','warder_hammer','warder_tidewall','warder_stance','warder_venge',
           'warder_aegis','warder_taunt','warder_watch','warder_echo','warder_brace','warder_link'],
  scholar: ['scholar_corrosion','scholar_vortex','scholar_burst','scholar_erosion','scholar_wisdom',
            'scholar_fury','scholar_nova','scholar_curse','scholar_vision','scholar_echo','scholar_drain'],
  hunter: ['hunter_step','hunter_instinct','hunter_venom','hunter_chain','hunter_pierce',
           'hunter_lethal','hunter_blood','hunter_watch','hunter_lurk','hunter_focus','hunter_snare'],
  healer: ['healer_purify','healer_wash','healer_mark','healer_hymn','healer_bolt','healer_redemption',
           'healer_ring','healer_guide','healer_verdict','healer_tide','healer_lustre','healer_deep'],
};
const NEUTRAL_POOL = [
  'neutral_shard','neutral_prep','neutral_shell','neutral_barrier','neutral_swarm','neutral_mist',
  'neutral_breath','neutral_blessing','neutral_sacrifice','neutral_eye','neutral_compass','neutral_lure',
];

/* ---------- 敌人 ----------
 * intents：循环模式（round % length）或加权随机（weighted:true 时按 w 权重）
 * 意图类型：{t:'attack',n} {t:'multi',n,times} {t:'allAttack',n} {t:'block',n}
 *          {t:'buff',buff,n} {t:'debuff',status,n} {t:'allDebuff',status,n}
 *          {t:'summon',enemy} {t:'heal',n}
 * boss 三阶段：phaseIntents 数组按 hp 比例 [>66%, 33-66%, <33%]
 * ----------------------------------- */
const ENEMIES = {
  /* 普通：层1 */
  deep_one: { id:'deep_one', name:'深潜者', hp:22, desc:'半人半鱼的信徒，以利爪撕扯入侵者。',
    img:'assets/enemies/deep_one.png',
    intents:[{t:'attack',n:6},{t:'attack',n:6},{t:'block',n:8},{t:'debuff',status:'weak',n:1}] },
  tentacle: { id:'tentacle', name:'触手怪', hp:18, desc:'蠕动的深渊触须。',
    img:'assets/enemies/tentacle.png',
    intents:[{t:'attack',n:5},{t:'attack',n:7}] },
  crawler: { id:'crawler', name:'深渊爬虫', hp:15, desc:'附骨而生的腐蚀毒虫。',
    img:'assets/enemies/crawler.png',
    intents:[{t:'attack',n:4},{t:'debuff',status:'poison',n:2}] },
  /* 普通：层2 */
  priest: { id:'priest', name:'潮汐祭司', hp:30, desc:'向深渊祈祷的狂信者。',
    img:'assets/enemies/priest.png',
    intents:[{t:'attack',n:8},{t:'buff',buff:'strength',n:1},{t:'attack',n:8}] },
  guard: { id:'guard', name:'深渊守卫', hp:35, desc:'披甲的古生物守卫。',
    img:'assets/enemies/guard.png',
    intents:[{t:'block',n:10},{t:'attack',n:9}] },
  jelly: { id:'jelly', name:'腐蚀水母', hp:25, desc:'剧毒的漂浮体。',
    img:'assets/enemies/jelly.png',
    intents:[{t:'attack',n:5},{t:'debuff',status:'poison',n:2},{t:'attack',n:7}] },
  /* 普通：层3 */
  fanatic: { id:'fanatic', name:'深渊狂信徒', hp:40, desc:'舍弃理智的疯狂信徒。',
    img:'assets/enemies/fanatic.png',
    intents:[{t:'attack',n:12},{t:'debuff',status:'curse',n:1},{t:'attack',n:12}] },
  devourer: { id:'devourer', name:'深渊吞噬者', hp:45, desc:'吞噬一切的深海巨口。',
    img:'assets/enemies/devourer.png',
    intents:[{t:'attack',n:15},{t:'heal',n:10},{t:'attack',n:15}] },
  /* 精英 */
  abomination: { id:'abomination', name:'深渊憎恶', hp:55, elite:true, desc:'扭曲缝合的深渊造物。',
    img:'assets/enemies/abomination.png',
    intents:[{t:'attack',n:9},{t:'attack',n:9},{t:'summon',enemy:'tentacle'},{t:'block',n:8}] },
  tide_lord: { id:'tide_lord', name:'潮汐领主', hp:75, elite:true, desc:'驾驭潮汐的深渊贵族。',
    img:'assets/enemies/tide_lord.png',
    intents:[{t:'allAttack',n:6},{t:'buff',buff:'strength',n:2},{t:'attack',n:10}] },
  /* Boss */
  great_eye: { id:'great_eye', name:'深渊巨目', hp:90, boss:true, desc:'第一层深渊的看守者，一只注视一切的眼。',
    title:'深渊之口的看守者', lore:'"你不该看到我。所有见过我的人，都已经成为我的眼睛。"',
    img:'assets/enemies/great_eye.png',
    intents:[{t:'attack',n:6},{t:'summon',enemy:'tentacle'},{t:'attack',n:8},{t:'multi',n:4,times:2}] },
  tide_matron: { id:'tide_matron', name:'潮汐主母', hp:140, boss:true, desc:'第二层深渊的女王，潮汐因她而涨落。',
    title:'潮汐回廊的女王', lore:'"潮起时我哭泣，潮落时我歌唱。你们将永远听见——"',
    img:'assets/enemies/tide_matron.png',
    intents:[{t:'allAttack',n:8},{t:'allDebuff',status:'poison',n:3},{t:'summon',enemy:'jelly'},{t:'allAttack',n:10}] },
  abyssal_will: { id:'abyssal_will', name:'深渊意志', hp:200, boss:true, desc:'沉睡于最深处的一切的意志本身。',
    title:'一切意志的根源', lore:'"核心……归还……我。你们的烛火，不过是黑暗里最后的叹息。"',
    img:'assets/enemies/abyssal_will.png',
    phaseIntents:[
      [{t:'attack',n:10},{t:'block',n:12},{t:'attack',n:10},{t:'debuff',status:'vulnerable',n:2}],
      [{t:'allAttack',n:8},{t:'allDebuff',status:'fear',n:1},{t:'attack',n:14},{t:'summon',enemy:'crawler'}],
      [{t:'multi',n:8,times:2},{t:'allAttack',n:10},{t:'attack',n:20},{t:'heal',n:15}],
    ] },
};

/* 普通遭遇组合（按层索引） */
const ENCOUNTERS = [
  [['deep_one'], ['deep_one','tentacle'], ['crawler','crawler'], ['tentacle','crawler']],
  [['priest'], ['guard','jelly'], ['priest','tentacle'], ['guard','crawler']],
  [['fanatic'], ['devourer'], ['fanatic','jelly'], ['devourer','tentacle']],
];
const ELITES = [['abomination'], ['tide_lord']];

/* 层数曲线 */
const FLOOR_SCALE = [1, 1.3, 1.6];

/* 层间过渡叙事（换层时黑屏滚动展示） */
const FLOOR_STORY = {
  1: `烛火在水面之下最后一次摇曳，
你们踏入了被海水淹没的先民遗迹。
深渊之口在脚下张开，
黑暗里，有什么东西在注视着你。
而回去的路，已经被潮水封死。

第一层 · 深渊之口`,
  2: `越过深渊巨目残存的注视，
你继续向黑暗中下潜。
水压在耳膜深处轰鸣，
暗流中，有什么巨大的东西翻了个身——
潮汐，开始有规律地呼吸。
潮汐主母，已在回廊深处苏醒。

第二层 · 潮汐回廊`,
  3: `海水在这里变得粘稠，
光与声音都被彻底吞没。
你脚下的纹路在蠕动——
那不是岩石的纹理，
那是意志本身的脉络。
深渊意志的呼吸，与你同步。

第三层 · 意志之渊`,
};

/* ---------- 遗物 ---------- */
const RELICS = {
  abyss_charm: { id:'abyss_charm', name:'深渊护符', desc:'战斗开始时，全队获得8点护甲' },
  tide_compass: { id:'tide_compass', name:'潮汐罗盘', desc:'每回合多抽1张牌' },
  coral_heart: { id:'coral_heart', name:'珊瑚之心', desc:'战斗开始时，全队治疗5点生命' },
  abyss_eye: { id:'abyss_eye', name:'深渊之眼', desc:'每回合获得1点额外能量' },
  ink_sac: { id:'ink_sac', name:'墨鱼囊', desc:'回合结束时，全队获得4点护甲' },
  pearl_necklace: { id:'pearl_necklace', name:'珍珠项链', desc:'获得的金币+20%' },
  deep_one_scale: { id:'deep_one_scale', name:'深潜者之鳞', desc:'受到的伤害-2' },
  tide_chalice: { id:'tide_chalice', name:'潮汐圣杯', desc:'治疗量+5' },
  abyss_beacon: { id:'abyss_beacon', name:'深渊信标', desc:'精英战斗的奖励多1张卡牌选择' },
  ancient_tablet: { id:'ancient_tablet', name:'远古石板', desc:'休息点可以同时选择两个选项' },
};

/* ---------- 事件 ---------- */
const EVENTS = {
  sunken_temple: { id:'sunken_temple', name:'沉没神庙', desc:'一座爬满藤壶的古老神庙矗立在黑暗中，门扉半掩，深处传来诵经般的低语。',
    options:[
      { label:'祈祷', desc:'在祭坛前祈祷，恢复10点生命', eff:{t:'heal',n:10}, result:'诵经声渐渐平息，潮汐的微光拂过你们的伤口。' },
      { label:'亵渎', desc:'搜刮圣物，获得60金币', eff:{t:'gold',n:60}, result:'圣物在你手中化作冰冷的金币，神殿深处传来一声叹息。' },
      { label:'探索', desc:'深入探索，获得1张随机卡牌', eff:{t:'card'}, result:'你在残骸深处找到一张铭刻符文的卡牌。' },
    ] },
  lost_sailor: { id:'lost_sailor', name:'迷途水手', desc:'一名面色惨白的水手卡在礁石间，他央求你带他离开这鬼地方。',
    options:[
      { label:'救援', desc:'救他上船——但他其实已经疯了，战斗！胜利后获得1件遗物', eff:{t:'fight',enemy:'deep_one',reward:'relic'}, result:'你解开绳索的瞬间，水手突然咧开嘴，露出一排尖牙……' },
      { label:'无视', desc:'绕过他继续前行，获得20金币', eff:{t:'gold',n:20}, result:'你从水手褴褛的口袋里摸出些金币，他的喊声渐渐沉入黑暗。' },
    ] },
  tide_pool: { id:'tide_pool', name:'潮汐圣池', desc:'一池泛着幽蓝光芒的圣水，据说浸泡后能治愈一切创伤。',
    options:[
      { label:'浸泡', desc:'恢复30%最大生命', eff:{t:'healPercent',n:0.3}, result:'圣水浸透骨髓，寒意与伤痛一同褪去。' },
      { label:'献祭', desc:'割开手掌献祭——失去10生命，获得1件遗物', eff:{t:'loseHp',n:10,then:'relic'}, result:'你的血没入圣池，池底泛起幽暗的金光。' },
    ] },
  abyss_whisper: { id:'abyss_whisper', name:'深渊低语', desc:'深渊在你耳边呢喃，许诺力量……只要你愿意倾听。',
    options:[
      { label:'接受', desc:'全员获得1层永久力量', eff:{t:'allBuff',buff:'strength',n:1}, result:'低语渗入你们的血脉，力量在血管中涌动。' },
      { label:'抵抗', desc:'捂住耳朵，但发现了一枚被遗落的护符，获得遗物【深渊护符】', eff:{t:'relic',id:'abyss_charm'}, result:'你捂住耳朵，脚下却踢到了一枚被遗落的护符。' },
    ] },
  abandoned_supply: { id:'abandoned_supply', name:'废弃补给', desc:'一艘沉船残骸中似乎还有完好的补给箱，但也可能有东西住在里面。',
    options:[
      { label:'搜刮', desc:'获得40金币（可能遭遇敌人）', eff:{t:'gold',n:40,risk:0.3}, result:'你撬开补给箱——里面除了金币，还有……' },
      { label:'绕过', desc:'谨慎起见，离开这里', eff:{t:'nothing'}, result:'你绕开了沉船，黑暗里似乎有什么松了口气。' },
    ] },
  deep_altar: { id:'deep_altar', name:'深海祭坛', desc:'一座黑曜石祭坛，刻着"献上财宝，换取知识"。',
    options:[
      { label:'献上50金币', desc:'换取1张稀有卡牌', eff:{t:'goldPay',n:50,then:'card',rarity:'rare'}, result:'金币没入祭坛，一张卡牌从石缝中缓缓浮出。' },
      { label:'摧毁祭坛', desc:'激怒祭坛守卫——精英战斗！胜利后获得遗物+金币', eff:{t:'fight',elite:true,reward:'relic'}, result:'你砸向祭坛，黑曜石裂开，守卫从裂缝中苏醒……' },
      { label:'离开', desc:'这不是你该碰的东西', eff:{t:'nothing'}, result:'你转身离开，祭坛上的符文黯淡了下去。' },
    ] },
};

/* ---------- 地图配置 ---------- */
const MAP_ROWS = [2, 3, 3, 2];           // 每行节点数
const NODE_WEIGHTS = { combat: 40, event: 30, shop: 15, rest: 15 };
const CARD_RARITY_WEIGHT = { common: 60, uncommon: 30, rare: 10 };
const SHOP_PRICES = { cardCommon: 45, cardUncommon: 75, cardRare: 110, relic: 130, remove: 75, heal: 50 };
