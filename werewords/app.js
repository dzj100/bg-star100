// 游戏状态管理
const gameState = {
    playerCount: null,        // 玩家数量
    roles: [],                // 角色数组
    currentPlayerIndex: 0,    // 当前查看身份的玩家索引（0是村长）
    chiefPlayerIndex: 0,      // 村长玩家索引
    viewedPlayers: new Set(), // 已查看身份的玩家集合
    magicWord: '',            // 选定的魔法咒语
    wordOptions: [],          // 5个候选词语
    wordLibrary: [],          // 词库
    wolfPlayers: [],          // 狼人玩家索引数组
    gamePhase: 'home',        // 游戏阶段: home, roulette, chief, chiefWord, role, pass, start
    isMuted: false,           // 是否静音
    isSpinning: false,        // 是否正在转动转盘
    playerNames: [],          // 玩家昵称列表（座位配置）
    currentUserIndex: null,   // 当前用户在昵称列表中的索引
    guessedCorrectly: false   // 是否已猜对魔法咒语
};

// DOM元素
const elements = {
    homeScreen: document.getElementById('homeScreen'),
    rouletteScreen: document.getElementById('rouletteScreen'),
    chiefScreen: document.getElementById('chiefScreen'),
    chiefWordScreen: document.getElementById('chiefWordScreen'),
    roleScreen: document.getElementById('roleScreen'),
    passScreen: document.getElementById('passScreen'),
    startScreen: document.getElementById('startScreen'),
    countButtons: document.getElementById('countButtons'),
    startGameBtn: document.getElementById('startGameBtn'),
    spinRouletteBtn: document.getElementById('spinRouletteBtn'),
    rouletteWheel: document.getElementById('rouletteWheel'),
    rouletteArrow: document.getElementById('rouletteArrow'),
    playerLabels: document.getElementById('playerLabels'),
    rouletteHint: document.getElementById('rouletteHint'),
    chiefConfirmMessage: document.getElementById('chiefConfirmMessage'),
    wordOptions: document.getElementById('wordOptions'),
    confirmChiefRoleBtn: document.getElementById('confirmChiefRoleBtn'),
    confirmChiefBtn: document.getElementById('confirmChiefBtn'),
    chiefCountdown: document.getElementById('chiefCountdown'),
    progressText: document.getElementById('progressText'),
    roleName: document.getElementById('roleName'),
    magicWordDisplay: document.getElementById('magicWordDisplay'),
    wolfTeammates: document.getElementById('wolfTeammates'),
    viewRoleBtn: document.getElementById('viewRoleBtn'),
    confirmRoleBtn: document.getElementById('confirmRoleBtn'),
    roleCountdown: document.getElementById('roleCountdown'),
    nextPlayerBtn: document.getElementById('nextPlayerBtn'),
    timerDisplay: document.getElementById('timerDisplay'),
    gameReadyText: document.getElementById('gameReadyText'),
    timeUpMessage: document.getElementById('timeUpMessage'),
    viewMagicWordBtn: document.getElementById('viewMagicWordBtn'),
    magicWordReveal: document.getElementById('magicWordReveal'),
    restartBtn: document.getElementById('restartBtn'),
    muteBtn: document.getElementById('muteBtn'),
    seatConfigBtn: document.getElementById('seatConfigBtn'),
    seatConfigModal: document.getElementById('seatConfigModal'),
    playerNamesInput: document.getElementById('playerNamesInput'),
    seatConfigHint: document.getElementById('seatConfigHint'),
    confirmSeatConfigBtn: document.getElementById('confirmSeatConfigBtn'),
    clearSeatConfigBtn: document.getElementById('clearSeatConfigBtn'),
    cancelSeatConfigBtn: document.getElementById('cancelSeatConfigBtn'),
    identitySelectModal: document.getElementById('identitySelectModal'),
    identitySelectList: document.getElementById('identitySelectList'),
    rulesBtn: document.getElementById('rulesBtn'),
    rulesModal: document.getElementById('rulesModal'),
    closeRulesBtn: document.getElementById('closeRulesBtn'),
    roleTableBody: document.getElementById('roleTableBody'),
    guessedCorrectlyBtn: document.getElementById('guessedCorrectlyBtn'),
    customConfirmModal: document.getElementById('customConfirmModal'),
    customConfirmMessage: document.getElementById('customConfirmMessage'),
    customConfirmOkBtn: document.getElementById('customConfirmOkBtn'),
    customConfirmCancelBtn: document.getElementById('customConfirmCancelBtn'),
    reviewBtn: document.getElementById('reviewBtn'),
    reviewModal: document.getElementById('reviewModal'),
    reviewTableBody: document.getElementById('reviewTableBody'),
    closeReviewBtn: document.getElementById('closeReviewBtn'),
    toast: document.getElementById('toast')
};

// 音频对象
let clickSound = null;

// 初始化音频
function initAudio() {
    // 点击音效
    clickSound = new Audio();
    clickSound.volume = 0.5;
}

// 播放点击音效
function playClickSound() {
    if (gameState.isMuted) return;
    // 创建简单的点击音效
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'square';
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
}

// 切换静音
function toggleMute() {
    gameState.isMuted = !gameState.isMuted;
    elements.muteBtn.textContent = gameState.isMuted ? '🔇' : '🔊';
}

// 生成角色分配（所有玩家都需要分配身份，包括村长）
function generateRoles(playerCount) {
    const roles = [];

    // 固定角色：先知
    roles.push('先知');

    // 狼人数量
    const wolfCount = playerCount <= 6 ? 1 : 2;
    for (let i = 0; i < wolfCount; i++) {
        roles.push('狼人');
    }

    // 剩余为村民（总牌数 = 玩家数 + 1，其中1个是村长额外拿的牌）
    // 所以需要从玩家数中减去特殊角色数量，剩下的是村民
    const villagerCount = playerCount - roles.length;
    for (let i = 0; i < villagerCount; i++) {
        roles.push('村民');
    }

    // 打乱顺序
    return shuffleArray(roles);
}

// 打乱数组
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// 从词库随机选择5个词语
function selectRandomWords() {
    if (!gameState.wordLibrary || gameState.wordLibrary.length === 0) {
        // 如果词库未加载，使用默认词语
        return ['苹果', '太阳', '大海', '月亮', '森林'];
    }

    const shuffled = shuffleArray(gameState.wordLibrary);
    return shuffled.slice(0, 5);
}

// 加载词库
async function loadWordLibrary() {
    try {
        const response = await fetch('words.json');
        const words = await response.json();
        gameState.wordLibrary = words;
    } catch (error) {
        console.error('加载词库失败:', error);
        gameState.wordLibrary = ['苹果', '太阳', '大海', '月亮', '森林'];
    }
}

// Toast提示功能
function showToast(message, duration = 2000) {
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    setTimeout(() => {
        elements.toast.classList.remove('show');
    }, duration);
}

// 自定义Confirm弹窗
function showCustomConfirm(message) {
    return new Promise((resolve) => {
        elements.customConfirmMessage.textContent = message;
        elements.customConfirmModal.style.display = 'flex';
        
        const handleOk = () => {
            elements.customConfirmModal.style.display = 'none';
            cleanup();
            resolve(true);
        };
        
        const handleCancel = () => {
            elements.customConfirmModal.style.display = 'none';
            cleanup();
            resolve(false);
        };
        
        const cleanup = () => {
            elements.customConfirmOkBtn.removeEventListener('click', handleOk);
            elements.customConfirmCancelBtn.removeEventListener('click', handleCancel);
        };
        
        elements.customConfirmOkBtn.addEventListener('click', handleOk);
        elements.customConfirmCancelBtn.addEventListener('click', handleCancel);
    });
}

// 保存座位配置到localStorage
function saveSeatConfig() {
    localStorage.setItem('seatConfig', JSON.stringify(gameState.playerNames));
}

// 从localStorage加载座位配置
function loadSeatConfig() {
    const saved = localStorage.getItem('seatConfig');
    if (saved) {
        try {
            gameState.playerNames = JSON.parse(saved);
        } catch (e) {
            console.error('加载座位配置失败:', e);
            gameState.playerNames = [];
        }
    }
}

// 校验玩家昵称列表
function validatePlayerNames(names) {
    // 去除空行和首尾空格
    const cleaned = names
        .split('\n')
        .map(name => name.trim())
        .filter(name => name.length > 0);
    
    // 至少需要4个玩家
    if (cleaned.length < 4) {
        return { valid: false, message: '至少需要4个玩家' };
    }
    
    // 最多10个玩家
    if (cleaned.length > 10) {
        return { valid: false, message: '最多支持10个玩家' };
    }
    
    // 检查重复
    const unique = new Set(cleaned);
    if (unique.size !== cleaned.length) {
        return { valid: false, message: '存在重复的昵称' };
    }
    
    // 检查特殊字符（防止XSS）
    const forbiddenChars = /[<>&"']/;
    for (const name of cleaned) {
        if (forbiddenChars.test(name)) {
            return { valid: false, message: '昵称包含非法字符 (<>&"\')' };
        }
        if (name.length > 20) {
            return { valid: false, message: `昵称"${name}"过长，最多20个字符` };
        }
        if (name.length === 0) {
            return { valid: false, message: '存在空昵称' };
        }
    }
    
    return { valid: true, names: cleaned };
}

// 根据索引获取玩家昵称（带循环保护）
function getPlayerNameByIndex(index, totalPlayers) {
    if (!gameState.playerNames || gameState.playerNames.length === 0) {
        return null;
    }
    // 确保索引不越界
    const safeIndex = ((index % totalPlayers) + totalPlayers) % totalPlayers;
    return gameState.playerNames[safeIndex];
}

// 获取下一个玩家的索引（顺时针传递）
function getNextPlayerIndex(currentIndex, totalPlayers) {
    return (currentIndex + 1) % totalPlayers;
}

// 生成身份配置表
function generateRoleTable() {
    const roleConfig = [
        { players: 4, chief: 1, prophet: 1, wolf: 1, villager: 2 },
        { players: 5, chief: 1, prophet: 1, wolf: 1, villager: 3 },
        { players: 6, chief: 1, prophet: 1, wolf: 1, villager: 4 },
        { players: 7, chief: 1, prophet: 1, wolf: 2, villager: 4 },
        { players: 8, chief: 1, prophet: 1, wolf: 2, villager: 5 },
        { players: 9, chief: 1, prophet: 1, wolf: 2, villager: 6 },
        { players: 10, chief: 1, prophet: 1, wolf: 2, villager: 7 }
    ];
    
    elements.roleTableBody.innerHTML = '';
    roleConfig.forEach(config => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="padding: 10px; border: 1px solid #444; text-align: center;">${config.players}人</td>
            <td style="padding: 10px; border: 1px solid #444; text-align: center;">${config.chief}</td>
            <td style="padding: 10px; border: 1px solid #444; text-align: center;">${config.prophet}</td>
            <td style="padding: 10px; border: 1px solid #444; text-align: center;">${config.wolf}</td>
            <td style="padding: 10px; border: 1px solid #444; text-align: center;">${config.villager}</td>
        `;
        elements.roleTableBody.appendChild(row);
    });
}

// 生成本局复盘表
function generateReviewTable() {
    elements.reviewTableBody.innerHTML = '';
    
    gameState.roles.forEach((role, index) => {
        const row = document.createElement('tr');
        
        // 获取玩家名称（如果有座位配置）
        let playerName = `${index + 1}号`;
        if (gameState.playerNames.length > 0) {
            playerName = getPlayerNameByIndex(index, gameState.playerCount);
        }
        
        row.innerHTML = `
            <td style="padding: 12px; border: 1px solid #444; text-align: center;">${playerName}</td>
            <td style="padding: 12px; border: 1px solid #444; text-align: center;">${role}</td>
        `;
        elements.reviewTableBody.appendChild(row);
    });
}

// 显示指定屏幕
function showScreen(screenName) {
    // 隐藏所有屏幕
    Object.values(elements).forEach(el => {
        if (el && el.classList && (el.classList.contains('home-screen') ||
            el.classList.contains('roulette-screen') ||
            el.classList.contains('role-screen') ||
            el.classList.contains('pass-screen') ||
            el.classList.contains('start-screen'))) {
            el.style.display = 'none';
        }
    });

    // 显示指定屏幕
    switch (screenName) {
        case 'home':
            elements.homeScreen.style.display = 'block';
            break;
        case 'roulette':
            elements.rouletteScreen.style.display = 'block';
            break;
        case 'chief':
            elements.chiefScreen.style.display = 'block';
            break;
        case 'chiefWord':
            elements.chiefWordScreen.style.display = 'block';
            break;
        case 'role':
            elements.roleScreen.style.display = 'block';
            break;
        case 'pass':
            elements.passScreen.style.display = 'block';
            break;
        case 'start':
            elements.startScreen.style.display = 'block';
            break;
    }

    gameState.gamePhase = screenName;

    const footerCredit = document.getElementById('footerCredit');
    if (footerCredit) {
        footerCredit.style.display = screenName === 'home' ? 'block' : 'none';
    }
}

// 倒计时功能
function startCountdown(element, duration, callback) {
    element.classList.remove('hidden');
    let count = duration;
    element.textContent = count;

    const interval = setInterval(() => {
        count--;
        element.textContent = count;

        if (count <= 0) {
            clearInterval(interval);
            if (callback) callback();
        }
    }, 1000);

    return interval;
}

// 初始化转盘
function initRoulette() {
    // 不需要初始化任何元素，只显示中间箭头
}

// 转动转盘
function spinRoulette() {
    // 防止重复点击
    if (gameState.isSpinning) return;
    gameState.isSpinning = true;

    playClickSound();

    // 重置页面状态
    elements.spinRouletteBtn.classList.remove('hidden');
    elements.spinRouletteBtn.disabled = true;
    elements.spinRouletteBtn.textContent = '转动中...';
    elements.rouletteHint.classList.remove('hidden');
    elements.chiefConfirmMessage.classList.add('hidden');
    elements.confirmChiefRoleBtn.classList.add('hidden');

    // 重置箭头位置和transition
    elements.rouletteArrow.style.transition = 'none';
    elements.rouletteArrow.style.transform = `translate(-50%, -100%) rotate(0deg)`;

    const selectedIndex = Math.floor(Math.random() * gameState.playerCount);

    // 计算箭头需要旋转的角度（指向选中的玩家）
    const anglePerPlayer = 360 / gameState.playerCount;
    const targetAngle = selectedIndex * anglePerPlayer - 90; // -90度使箭头指向正上方
    const totalRotations = 5 + Math.random() * 3; // 5-8圈
    const finalRotation = totalRotations * 360 + targetAngle;

    // 使用CSS transition实现丝滑动画
    elements.rouletteArrow.style.transition = 'transform 3s cubic-bezier(0.25, 0.1, 0.25, 1)';
    elements.rouletteArrow.style.transform = `translate(-50%, -100%) rotate(${finalRotation}deg)`;

    // 动画结束后显示村长提示
    setTimeout(() => {
        gameState.isSpinning = false;
        gameState.chiefPlayerIndex = selectedIndex;
        
        // 隐藏转动按钮
        elements.spinRouletteBtn.classList.add('hidden');
        
        // 显示村长提示和确认按钮
        elements.chiefConfirmMessage.classList.remove('hidden');
        elements.confirmChiefRoleBtn.classList.remove('hidden');
    }, 3000);
}

// 设置村长选词
function setupChiefWordSelection(chiefIndex) {
    gameState.wordOptions = selectRandomWords();

    // 显示词语选项
    elements.wordOptions.innerHTML = '';
    gameState.wordOptions.forEach((word, index) => {
        const option = document.createElement('div');
        option.className = 'word-option';
        option.textContent = word;
        option.dataset.index = index;

        option.addEventListener('click', () => {
            playClickSound();
            
            // 取消其他选项的选中状态
            elements.wordOptions.querySelectorAll('.word-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
            gameState.magicWord = word;

            // 如果倒计时还未开始，则禁用确认按钮并开始倒计时
            if (elements.chiefCountdown.classList.contains('hidden')) {
                elements.confirmChiefBtn.disabled = true;
                startCountdownForChief();
            }
        });

        elements.wordOptions.appendChild(option);
    });

    showScreen('chiefWord');
}

// 确认担任村长
function confirmChiefRole() {
    playClickSound();
    
    // 如果有座位配置，让用户选择自己是哪位玩家
    if (gameState.playerNames.length > 0) {
        showIdentitySelectionModal();
    } else {
        // 没有座位配置，沿用原有逻辑
        gameState.currentPlayerIndex = 0;
        showRoleScreen();
    }
}

// 显示身份选择弹窗
function showIdentitySelectionModal() {
    elements.identitySelectList.innerHTML = '';
    
    gameState.playerNames.forEach((name, index) => {
        const label = document.createElement('label');
        label.style.cssText = `
            padding: 8px 16px;
            background: #0f3460;
            border: 2px solid transparent;
            border-radius: 20px;
            color: #fff;
            cursor: pointer;
            font-size: 14px;
            user-select: none;
            -webkit-tap-highlight-color: transparent;
        `;
        label.textContent = name;
        
        label.addEventListener('click', () => {
            playClickSound();
            gameState.currentUserIndex = index;
            gameState.currentPlayerIndex = index;
            elements.identitySelectModal.style.display = 'none';
            showRoleScreen();
        });
        
        elements.identitySelectList.appendChild(label);
    });
    
    elements.identitySelectModal.style.display = 'flex';
}

// 村长确认倒计时
function startCountdownForChief() {
    elements.chiefCountdown.classList.remove('hidden');
    elements.confirmChiefBtn.disabled = true;

    let count = 3;
    elements.chiefCountdown.textContent = count;

    const interval = setInterval(() => {
        count--;
        elements.chiefCountdown.textContent = count;

        if (count <= 0) {
            clearInterval(interval);
            elements.confirmChiefBtn.disabled = false;
        }
    }, 1000);
}

// 确认村长选择
function confirmChiefSelection() {
    playClickSound();

    // 标记村长已查看
    gameState.viewedPlayers.add(gameState.currentPlayerIndex);
    
    // 顺时针传递给下一个玩家
    gameState.currentPlayerIndex = getNextPlayerIndex(gameState.currentPlayerIndex, gameState.playerCount);

    // 显示传递界面
    showPassScreen();
}

// 显示传递界面
function showPassScreen() {
    if (gameState.currentPlayerIndex >= gameState.playerCount) {
        // 所有玩家都已查看完毕
        showStartScreen();
        return;
    }

    showScreen('pass');
}

// 下一位玩家
function nextPlayer() {
    playClickSound();

    // 显示当前玩家的身份
    showRoleScreen();
}

// 显示身份查看界面
function showRoleScreen() {
    const currentIndex = gameState.currentPlayerIndex;
    
    // 所有玩家（包括村长）都从roles数组中获取身份
    const role = gameState.roles[currentIndex];

    // 更新进度文本（村长恒为1号，左手边为2号...）
    elements.progressText.textContent = `${currentIndex + 1}/${gameState.playerCount}`;

    // 重置界面
    // 如果有座位配置，显示玩家昵称
    if (gameState.playerNames.length > 0) {
        const playerName = getPlayerNameByIndex(currentIndex, gameState.playerCount);
        document.querySelector('.role-title').textContent = `${playerName}，你的身份是`;
    } else {
        document.querySelector('.role-title').textContent = '你的身份是';
    }
    
    elements.roleName.textContent = '';
    elements.magicWordDisplay.classList.add('hidden');
    elements.viewRoleBtn.classList.remove('hidden');
    elements.confirmRoleBtn.classList.add('hidden');
    elements.roleCountdown.classList.add('hidden');

    showScreen('role');
}

// 查看身份
function viewRole() {
    playClickSound();

    const currentIndex = gameState.currentPlayerIndex;
    const role = gameState.roles[currentIndex];

    // 如果有昵称列表，显示对应昵称
    if (gameState.playerNames.length > 0) {
        const playerName = getPlayerNameByIndex(currentIndex, gameState.playerCount);
        document.querySelector('.role-title').textContent = `${playerName}，你的身份是`;
    } else {
        document.querySelector('.role-title').textContent = '你的身份是';
    }

    elements.roleName.textContent = role;
    elements.viewRoleBtn.classList.add('hidden');
    elements.confirmRoleBtn.classList.remove('hidden');

    // 重置狼人队友显示
    elements.wolfTeammates.classList.add('hidden');
    elements.wolfTeammates.textContent = '';

    // 如果不是村民且不是第一个查看的人（村长），显示魔法咒语
    // 第一个查看的人（村长）此时还没选词，所以不显示
    if (role !== '村民' && gameState.viewedPlayers.size > 0) {
        elements.magicWordDisplay.textContent = `魔法咒语：${gameState.magicWord}`;
        elements.magicWordDisplay.classList.remove('hidden');
    } else {
        elements.magicWordDisplay.classList.add('hidden');
    }

    // 如果是狼人，显示队友信息
    if (role === '狼人') {
        // 过滤出其他狼人（排除自己）
        // wolfPlayers存储的是1-based玩家编号，currentIndex是0-based数组索引
        const currentPlayerNumber = currentIndex + 1;
        const otherWolves = gameState.wolfPlayers.filter(idx => idx !== currentPlayerNumber);
        
        if (otherWolves.length > 0) {
            let teammateText;
            // 如果有昵称列表，显示昵称
            if (gameState.playerNames.length > 0) {
                const teammateNames = otherWolves.map(idx => {
                    // idx是1-based，需要转换为0-based索引
                    return getPlayerNameByIndex(idx - 1, gameState.playerCount);
                });
                teammateText = teammateNames.join('、');
                elements.wolfTeammates.textContent = `你的狼人队友：${teammateText}`;
            } else {
                // 没有昵称列表，显示编号
                const teammateNumbers = otherWolves.map(idx => `${idx}号`).join('、');
                elements.wolfTeammates.textContent = `你的狼人队友：${teammateNumbers}`;
            }
            elements.wolfTeammates.classList.remove('hidden');
        }
    }

    // 开始倒计时
    startCountdownForRole();
}

// 身份确认倒计时
function startCountdownForRole() {
    elements.roleCountdown.classList.remove('hidden');
    elements.confirmRoleBtn.disabled = true;

    let count = 3;
    elements.roleCountdown.textContent = count;

    const interval = setInterval(() => {
        count--;
        elements.roleCountdown.textContent = count;

        if (count <= 0) {
            clearInterval(interval);
            elements.confirmRoleBtn.disabled = false;
        }
    }, 1000);
}

// 确认身份查看
function confirmRoleView() {
    playClickSound();

    // 标记当前玩家已查看
    gameState.viewedPlayers.add(gameState.currentPlayerIndex);

    // 隐藏狼人队友信息
    elements.wolfTeammates.classList.add('hidden');
    
    // 如果是村长（第一个查看的人），确认后进入选词环节
    if (gameState.viewedPlayers.size === 1) {
        setupChiefWordSelection();
    } else {
        // 其他玩家，按顺时针顺序传递到下一个
        if (gameState.playerNames.length > 0) {
            // 有昵称列表时，按顺时针传递
            gameState.currentPlayerIndex = getNextPlayerIndex(gameState.currentPlayerIndex, gameState.playerCount);
        } else {
            // 没有昵称列表，沿用原有逻辑
            gameState.currentPlayerIndex++;
        }
        
        // 检查是否所有玩家都已查看完毕
        if (gameState.viewedPlayers.size >= gameState.playerCount) {
            showStartScreen();
        } else {
            // 显示传递界面
            showPassScreen();
        }
    }
}

// 显示游戏开始界面
function showStartScreen() {
    showScreen('start');
    startGameTimer();
}

// 开始游戏计时器（4分钟）
let timerGeneration = 0;

function startGameTimer() {
    timerGeneration++;
    const currentGeneration = timerGeneration;
    let seconds = 4 * 60; // 测试用0.2分钟（12秒）

    // 重置UI状态
    elements.gameReadyText.classList.remove('hidden');
    elements.timerDisplay.classList.remove('hidden');
    elements.timeUpMessage.classList.add('hidden');
    elements.viewMagicWordBtn.classList.add('hidden');
    elements.magicWordReveal.classList.add('hidden');
    elements.restartBtn.classList.add('hidden');
    elements.guessedCorrectlyBtn.classList.remove('hidden');

    function updateTimer() {
        if (currentGeneration !== timerGeneration) return;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        elements.timerDisplay.textContent =
            `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        if (seconds > 0) {
            seconds--;
            setTimeout(updateTimer, 1000);
        } else {
            timerFinished();
        }
    }

    updateTimer();
}

// 计时器结束处理
function timerFinished() {
    // 如果已猜对，不显示"时间到了"和"查看咒语"
    if (gameState.guessedCorrectly) {
        return;
    }
    
    elements.gameReadyText.classList.add('hidden');
    elements.timerDisplay.classList.add('hidden');
    elements.timeUpMessage.classList.remove('hidden');
    elements.viewMagicWordBtn.classList.remove('hidden');
    elements.guessedCorrectlyBtn.classList.add('hidden');
}

// 查看咒语
function viewMagicWord() {
    // 如果已猜对，不执行
    if (gameState.guessedCorrectly) {
        return;
    }
    
    playClickSound();

    elements.timeUpMessage.classList.add('hidden');
    elements.viewMagicWordBtn.classList.add('hidden');

    elements.magicWordReveal.textContent = gameState.magicWord;
    elements.magicWordReveal.classList.remove('hidden');
    elements.restartBtn.classList.remove('hidden');
    elements.reviewBtn.classList.remove('hidden');
}

// 重新开始游戏
function restartGame() {
    playClickSound();

    // 保存座位配置（不重置）
    const savedPlayerNames = [...gameState.playerNames];
    
    // 重置状态
    gameState.playerCount = null;
    gameState.roles = [];
    gameState.currentPlayerIndex = 0;
    gameState.chiefPlayerIndex = 0;
    gameState.viewedPlayers.clear();
    gameState.magicWord = '';
    gameState.wordOptions = [];
    gameState.wolfPlayers = [];
    gameState.isSpinning = false;
    gameState.currentUserIndex = null;
    gameState.guessedCorrectly = false;
    // 保留词库和座位配置，不需要重置
    gameState.gamePhase = 'home';
    gameState.playerNames = savedPlayerNames;

    // 重置UI
    elements.countButtons.querySelectorAll('.count-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    elements.startGameBtn.disabled = true;
    
    // 如果有座位配置，自动选中对应人数
    if (gameState.playerNames.length > 0) {
        const playerCount = gameState.playerNames.length;
        gameState.playerCount = playerCount;
        elements.countButtons.querySelectorAll('.count-btn').forEach(btn => {
            const count = parseInt(btn.dataset.count);
            if (count === playerCount) {
                btn.classList.add('selected');
            }
        });
        elements.startGameBtn.disabled = false;
    }
    
    // 重置转盘页面状态
    elements.spinRouletteBtn.classList.remove('hidden');
    elements.spinRouletteBtn.disabled = false;
    elements.spinRouletteBtn.textContent = '转动箭头';
    elements.rouletteHint.classList.remove('hidden');
    elements.chiefConfirmMessage.classList.add('hidden');
    elements.confirmChiefRoleBtn.classList.add('hidden');
    
    // 重置箭头位置
    elements.rouletteArrow.style.transition = 'none';
    elements.rouletteArrow.style.transform = `translate(-50%, -100%) rotate(0deg)`;
    
    // 重置村长选词页面状态
    elements.confirmChiefBtn.disabled = true;
    elements.chiefCountdown.classList.add('hidden');
    elements.wordOptions.innerHTML = '';
    
    // 重置"已猜对了"按钮状态
    elements.guessedCorrectlyBtn.classList.add('hidden');
    
    // 清除狼人找先知提示
    const wolfFindProphetMsg = document.getElementById('wolfFindProphetMsg');
    if (wolfFindProphetMsg) {
        wolfFindProphetMsg.remove();
    }
    
    // 隐藏"本局复盘"按钮
    elements.reviewBtn.classList.add('hidden');
    
    // 关闭复盘弹窗（如果打开）
    elements.reviewModal.style.display = 'none';

    showScreen('home');
}

// 事件绑定
function bindEvents() {
    // 人数选择
    elements.countButtons.addEventListener('click', (e) => {
        if (e.target.classList.contains('count-btn')) {
            playClickSound();

            // 如果有座位配置，提示用户去座位配置中修改
            if (gameState.playerNames.length > 0) {
                showToast('请在【座位配置】中修改玩家列表');
                return;
            }

            elements.countButtons.querySelectorAll('.count-btn').forEach(btn => {
                btn.classList.remove('selected');
            });
            e.target.classList.add('selected');

            gameState.playerCount = parseInt(e.target.dataset.count);
            elements.startGameBtn.disabled = false;
        }
    });

    // 座位配置按钮
    elements.seatConfigBtn.addEventListener('click', () => {
        playClickSound();
        // 加载当前配置到输入框
        elements.playerNamesInput.value = gameState.playerNames.join('\n');
        elements.seatConfigHint.textContent = '';
        elements.seatConfigModal.style.display = 'flex';
    });

    // 确认座位配置
    elements.confirmSeatConfigBtn.addEventListener('click', () => {
        const input = elements.playerNamesInput.value;
        const validation = validatePlayerNames(input);
        
        if (!validation.valid) {
            elements.seatConfigHint.textContent = validation.message;
            elements.seatConfigHint.style.color = '#e94560';
            showToast(validation.message);
            return;
        }
        
        gameState.playerNames = validation.names;
        saveSeatConfig();
        elements.seatConfigModal.style.display = 'none';
        
        // 根据昵称列表自动选中对应人数
        const playerCount = gameState.playerNames.length;
        gameState.playerCount = playerCount;
        
        // 更新UI显示
        elements.countButtons.querySelectorAll('.count-btn').forEach(btn => {
            btn.classList.remove('selected');
            const count = parseInt(btn.dataset.count);
            if (count === playerCount) {
                btn.classList.add('selected');
            }
        });
        
        elements.startGameBtn.disabled = false;
        showToast(`已配置 ${playerCount} 位玩家`);
    });

    // 取消座位配置
    elements.cancelSeatConfigBtn.addEventListener('click', () => {
        elements.seatConfigModal.style.display = 'none';
    });

    // 清空座位配置
    elements.clearSeatConfigBtn.addEventListener('click', () => {
        gameState.playerNames = [];
        saveSeatConfig();
        elements.seatConfigModal.style.display = 'none';
        
        // 重置人数选择
        gameState.playerCount = null;
        elements.countButtons.querySelectorAll('.count-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
        elements.startGameBtn.disabled = true;
        
        showToast('已清空座位配置');
    });

    // 规则查看
    elements.rulesBtn.addEventListener('click', () => {
        playClickSound();
        generateRoleTable();
        elements.rulesModal.style.display = 'flex';
    });

    // 关闭规则弹窗
    elements.closeRulesBtn.addEventListener('click', () => {
        elements.rulesModal.style.display = 'none';
    });

    // 开始游戏
    elements.startGameBtn.addEventListener('click', () => {
        playClickSound();

        // 生成角色
        gameState.roles = generateRoles(gameState.playerCount);
        
        // 记录狼人玩家索引（从1开始，因为0是村长）
        gameState.wolfPlayers = [];
        gameState.roles.forEach((role, index) => {
            if (role === '狼人') {
                gameState.wolfPlayers.push(index + 1); // +1是因为显示时从1开始编号
            }
        });

        // 初始化并显示转盘
        initRoulette();
        showScreen('roulette');
    });

    // 转动转盘
    elements.spinRouletteBtn.addEventListener('click', spinRoulette);

    // 确认担任村长
    elements.confirmChiefRoleBtn.addEventListener('click', confirmChiefRole);

    // 村长确认选词
    elements.confirmChiefBtn.addEventListener('click', confirmChiefSelection);

    // 下一位玩家
    elements.nextPlayerBtn.addEventListener('click', nextPlayer);

    // 查看身份
    elements.viewRoleBtn.addEventListener('click', viewRole);

    // 确认身份
    elements.confirmRoleBtn.addEventListener('click', confirmRoleView);

    // 查看咒语
    elements.viewMagicWordBtn.addEventListener('click', viewMagicWord);

    // 重新开始
    elements.restartBtn.addEventListener('click', restartGame);

    // 已猜对了
    elements.guessedCorrectlyBtn.addEventListener('click', async () => {
        playClickSound();
        
        // 显示自定义确认提示
        const confirmed = await showCustomConfirm('确定魔法咒语已经被猜对了吗？');
        if (!confirmed) {
            return;
        }
        
        // 设置标志
        gameState.guessedCorrectly = true;
        
        // 隐藏准备就绪文字和倒计时
        elements.gameReadyText.classList.add('hidden');
        elements.timerDisplay.classList.add('hidden');
        
        // 显示狼人找先知的提示
        const wolfFindProphetMsg = document.createElement('div');
        wolfFindProphetMsg.id = 'wolfFindProphetMsg';
        wolfFindProphetMsg.style.cssText = `
            font-size: 20px;
            color: #e94560;
            margin: 30px 0;
            padding: 20px;
            background: rgba(233, 69, 96, 0.1);
            border-radius: 15px;
            border: 2px solid #e94560;
            animation: pulse 1s infinite;
        `;
        wolfFindProphetMsg.innerHTML = `
            <p style="margin-bottom: 10px;">🎉 恭喜猜对魔法咒语了！</p>
            <p>狼人请揭示身份并找出先知</p>
        `;
        
        // 插入到timerDisplay后面
        elements.timerDisplay.parentNode.insertBefore(wolfFindProphetMsg, elements.timerDisplay.nextSibling);
        
        // 显示魔法咒语和重新开始按钮
        elements.magicWordReveal.textContent = gameState.magicWord;
        elements.magicWordReveal.classList.remove('hidden');
        elements.restartBtn.classList.remove('hidden');
        elements.reviewBtn.classList.remove('hidden');
        
        // 隐藏其他按钮
        elements.viewMagicWordBtn.classList.add('hidden');
        elements.guessedCorrectlyBtn.classList.add('hidden');
    });

    // 静音切换
    elements.muteBtn.addEventListener('click', toggleMute);

    // 本局复盘
    elements.reviewBtn.addEventListener('click', () => {
        playClickSound();
        generateReviewTable();
        elements.reviewModal.style.display = 'flex';
    });

    // 关闭复盘弹窗
    elements.closeReviewBtn.addEventListener('click', () => {
        elements.reviewModal.style.display = 'none';
    });
}

// 初始化
async function init() {
    await loadWordLibrary();
    loadSeatConfig(); // 加载座位配置
    initAudio();
    bindEvents();
    
    // 如果有座位配置，自动选中对应人数
    if (gameState.playerNames.length > 0) {
        const playerCount = gameState.playerNames.length;
        gameState.playerCount = playerCount;
        elements.countButtons.querySelectorAll('.count-btn').forEach(btn => {
            const count = parseInt(btn.dataset.count);
            if (count === playerCount) {
                btn.classList.add('selected');
            }
        });
        elements.startGameBtn.disabled = false;
    }
    
    showScreen('home');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);

