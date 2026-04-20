const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('score-val');
const bgm = document.getElementById('bgm');
let bgmStarted = false;

const playerImg = new Image();
playerImg.src = 'images/P_back.png';

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const seLeft = new Audio('sounds/left.mp3');
const seRight = new Audio('sounds/right.mp3');

// Lottie(Bodymovin)関連の設定
let playerAnimation;
const lottieCanvas = document.createElement('canvas');
// JSONの設定(w:600, h:600)に合わせて設定
lottieCanvas.width = 600;
lottieCanvas.height = 600;
const lottieCtx = lottieCanvas.getContext('2d');

// FPS固定用の変数
let lastTime = 0;
const targetFPS = 60;
const fpsInterval = 1000 / targetFPS;

// Android等のモバイル端末でのオーディオ再生制限を解除する関数
function unlockAudio() {
    if (bgmStarted) return;
    
    // BGMの再生試行
    bgm.play().then(() => {
        bgmStarted = true;
        console.log("Audio Unlocked");
    }).catch(e => {
        console.log("Audio unlocking waiting for more direct interaction:", e);
    });

    // AudioContextの再開
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// 初回のタップ/クリックでオーディオをアンロック
window.addEventListener('click', unlockAudio, { once: true });
window.addEventListener('touchstart', unlockAudio, { once: true });

const CONFIG = {
    LINE_COUNT: 16,
    RING_COUNT: 5,
    PULSE_SPEED: 16,
    PULSE_LENGTH: 120,
    ENEMY_SPEED: 0.5,
    PERSPECTIVE_Y: 0.4,
    OFFSET_Y: 0.0,
    INNER_RADIUS: 80,
    PULSE_COOLDOWN: 10,
    COLORS: {
        bg: '#050505',
        line: '#1a3333',
        pulse: '#00ffff',
        attackPulse: '#ff3366',
        crawler: '#ff00ff',
        flyer: '#ffff00',
        spider: '#0066ff',
        boss: '#ff0000'
    }
};

let width, height, centerX, centerY, maxRadius;
let pulses = [];
let attackPulses = [];
let bossPulses = [];
let enemies = [];
let connections = [];
let score = 0;
let energy = 100;
let frame = 0;
let isMouseDown = false;
let lastFireFrame = 0;
let currentLineIdx = 0;
let viewAngle = 0;
let targetViewAngle = 0;
let particles = [];

// Phase State
let gamePhase = 'DEFENSE'; // DEFENSE, TRANS_ATTACK, ATTACK, TRANS_DEFENSE
let waveEnemyCount = 15;
let enemiesSpawnedThisWave = 0;
let waveCount = 1;
let bossHp = 0;
let bossMaxHp = 40;
let playerAttackLineIdx = 0;
let targetOffsetY = 0.0;
let currentOffsetY = 0.0;
let currentWebScale = 1.0;
let targetWebScale = 1.0;
let currentWebOpacity = 1.0;
let ringStep = 0.0;
let bossWalls = [];
let lastBossWallFrame = 0;
let lastBossAttackFrame = 0;

let currentPerspectiveY = CONFIG.PERSPECTIVE_Y;
let targetPerspectiveY = CONFIG.PERSPECTIVE_Y;

let playerDisplayAngle = 0; // スムーズな移動用

function init() {
    resize();
    generateWeb();
    bgm.load(); // BGMの読み込みを開始
    initLottie(); // Lottieの初期化
    animate();
}

function initLottie() {
    playerAnimation = lottie.loadAnimation({
        renderer: 'canvas',
        loop: true,
        autoplay: true,
        path: 'json/p_back.json',
        assetsPath: 'images/',
        rendererSettings: {
            context: lottieCtx,
            preserveAspectRatio: 'xMidYMid meet',
            clearCanvas: true
        }
    });

    // サブフレームレンダリング（補間）を無効にし、30FPSのコマ打ち感を再現
    playerAnimation.setSubframe(false);

    // 初期状態としてIdleアニメーション(0-30)をループ再生
    playerAnimation.addEventListener('DOMLoaded', () => {
        playerAnimation.playSegments([0, 30], true);
    });

    // 移動アニメーション等の単発再生が終わったらIdleに戻る
    playerAnimation.addEventListener('complete', () => {
        playerAnimation.setLoop(true);
        playerAnimation.playSegments([0, 30], true);
    });
}

function resize() {
    // 内部解像度を1200x600に固定
    width = canvas.width = 1200;
    height = canvas.height = 600;
    
    centerX = width / 2;
    centerY = height * (0.5 + currentOffsetY);
    // 画面の横長に合わせて最大半径を調整
    maxRadius = 520;
    ringStep = maxRadius / (CONFIG.RING_COUNT + 1.5);
}

function toProjected(r, angle) {
    // 1200x600の横長画面に合わせてX軸を1.4倍に広げる
    const x = centerX + Math.cos(angle + viewAngle) * r * 1.4;
    const y = centerY + Math.sin(angle + viewAngle) * r * currentPerspectiveY;
    return { x, y };
}

function playZapSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function generateWeb() {
    connections = [];
    for (let r = 1; r <= CONFIG.RING_COUNT; r++) {
        const radius = ringStep * r;
        for (let l = 0; l < CONFIG.LINE_COUNT; l++) {
            // 最内周（ring 1）には横の繋がりを作らない（中央をスッキリさせる）
            if (r === 1) continue;

            // あみだくじのルール：同じ高さで一つの点から左右に分岐しないようにする
            if (Math.random() > 0.4) {
                // 最後の線が0番に繋がる際、0番がすでに右（1番）に繋がっていないかチェック
                if (l === CONFIG.LINE_COUNT - 1) {
                    const isLine0Connected = connections.some(c => c.ring === r && c.lineIdx === 0);
                    if (isLine0Connected) continue;
                }

                connections.push({
                    ring: r,
                    lineIdx: l,
                    nextIdx: (l + 1) % CONFIG.LINE_COUNT,
                    radius: radius
                });
                // 隣接する接続を避けるため、次のインデックスをスキップ
                l++;
            }
        }
    }
}

class Pulse {
    constructor(lineIdx) {
        this.distance = 0;
        this.active = true;
        this.pathNodes = this.buildPath(lineIdx);
        this.totalLength = this.pathNodes[this.pathNodes.length - 1].accumDist;
    }

    // 発生時にルート全体を事前計算する
    buildPath(startLineIdx) {
        let nodes = [];
        let currentLine = startLineIdx;
        let accumDist = 0;
        
        nodes.push({ r: 0, l: currentLine, accumDist: 0 });

        for (let ring = 1; ring <= CONFIG.RING_COUNT; ring++) {
            const r = ring * ringStep;
            const dist = r - nodes[nodes.length - 1].r;
            accumDist += dist;
            nodes.push({ r: r, l: currentLine, accumDist: accumDist });

            const conn = connections.find(c => c.ring === ring && (c.lineIdx === currentLine || c.nextIdx === currentLine));
            if (conn) {
                const nextLine = (conn.lineIdx === currentLine) ? conn.nextIdx : conn.lineIdx;
                let startAngle = (currentLine * Math.PI * 2) / CONFIG.LINE_COUNT;
                let endAngle = (nextLine * Math.PI * 2) / CONFIG.LINE_COUNT;
                
                if (Math.abs(endAngle - startAngle) > Math.PI) {
                    if (endAngle > startAngle) endAngle -= Math.PI * 2;
                    else endAngle += Math.PI * 2;
                }
                const arcDist = Math.abs(endAngle - startAngle) * r;
                
                accumDist += arcDist;
                nodes.push({ r: r, l: nextLine, accumDist: accumDist, isArcEnd: true, arcStartL: currentLine, ring: ring });
                currentLine = nextLine;
            }
        }
        
        const endR = maxRadius + 100;
        accumDist += (endR - nodes[nodes.length - 1].r);
        nodes.push({ r: endR, l: currentLine, accumDist: accumDist });
        
        return nodes;
    }

    // 進行距離から現在の極座標を取得
    getPosAtDistance(targetDist) {
        if (targetDist <= 0) return { r: 0, l: this.pathNodes[0].l };
        if (targetDist >= this.totalLength) {
            const last = this.pathNodes[this.pathNodes.length - 1];
            return { r: last.r + (targetDist - this.totalLength), l: last.l };
        }

        for (let i = 1; i < this.pathNodes.length; i++) {
            const prev = this.pathNodes[i - 1];
            const curr = this.pathNodes[i];

            if (targetDist <= curr.accumDist) {
                const segmentDist = curr.accumDist - prev.accumDist;
                const ratio = segmentDist === 0 ? 0 : (targetDist - prev.accumDist) / segmentDist;

                if (curr.isArcEnd) {
                    let startA = (curr.arcStartL * Math.PI * 2) / CONFIG.LINE_COUNT;
                    let endA = (curr.l * Math.PI * 2) / CONFIG.LINE_COUNT;
                    if (Math.abs(endA - startA) > Math.PI) {
                        if (endA > startA) endA -= Math.PI * 2;
                        else endA += Math.PI * 2;
                    }
                    const a = startA + (endA - startA) * ratio;
                    return { r: curr.r, angle: a };
                } else {
                    const r = prev.r + (curr.r - prev.r) * ratio;
                    return { r: r, l: curr.l };
                }
            }
        }
        return { r: 0, l: 0 };
    }

    getProjectedPosAt(dist) {
        const pos = this.getPosAtDistance(dist);
        const angle = pos.angle !== undefined ? pos.angle : (pos.l * Math.PI * 2) / CONFIG.LINE_COUNT;
        return toProjected(pos.r * currentWebScale, angle);
    }

    update() {
        this.distance += CONFIG.PULSE_SPEED;
        if (this.distance > this.totalLength + CONFIG.PULSE_LENGTH) {
            this.active = false;
        }
    }

    draw() {
        ctx.beginPath();
        ctx.strokeStyle = CONFIG.COLORS.pulse;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 10;
        ctx.shadowColor = CONFIG.COLORS.pulse;

        const startDist = Math.max(0, this.distance - CONFIG.PULSE_LENGTH);
        const endDist = this.distance;
        
        let first = true;
        // 5px刻みで軌跡をなぞり、ノイズを加えて描画
        for (let d = startDist; d <= endDist; d += 5) {
            const p = this.getProjectedPosAt(d);
            const noiseX = (Math.random() - 0.5) * 6;
            const noiseY = (Math.random() - 0.5) * 6;
            
            if (first) {
                ctx.moveTo(p.x + noiseX, p.y + noiseY);
                first = false;
            } else {
                ctx.lineTo(p.x + noiseX, p.y + noiseY);
            }
        }
        
        // 先端を描画
        const head = this.getProjectedPosAt(endDist);
        ctx.lineTo(head.x, head.y);

        ctx.stroke();
        ctx.shadowBlur = 0;
    }
}

class Enemy {
    constructor(type) {
        this.type = type;
        this.distance = maxRadius;
        this.lineIdx = Math.floor(Math.random() * CONFIG.LINE_COUNT);
        this.active = true;
        this.lastRingHit = CONFIG.RING_COUNT + 2;
        
        // スライド移動用ステート
        this.isSliding = false;
        this.slideProgress = 0;
        this.slideStartLine = 0;
        this.slideEndLine = 0;
        this.slideRadius = 0;
    }

    update() {
        if (this.isSliding) {
            this.slideProgress += 0.05; // スライド速度
            if (this.slideProgress >= 1) {
                this.isSliding = false;
                this.lineIdx = this.slideEndLine;
                this.distance = this.slideRadius;
            }
            return;
        }

        this.distance -= CONFIG.ENEMY_SPEED * (this.type === 'flyer' ? 1.5 : 1);

        if (this.type === 'crawler') {
            const currentRing = Math.ceil(this.distance / ringStep);
            if (currentRing < this.lastRingHit && currentRing > 0 && currentRing <= CONFIG.RING_COUNT) {
                const ringRadius = ringStep * currentRing;
                const conn = connections.find(c => c.ring === currentRing && (c.lineIdx === this.lineIdx || c.nextIdx === this.lineIdx));
                if (conn) {
                    this.isSliding = true;
                    this.slideProgress = 0;
                    this.slideStartLine = this.lineIdx;
                    this.slideEndLine = (conn.lineIdx === this.lineIdx) ? conn.nextIdx : conn.lineIdx;
                    this.slideRadius = ringRadius;
                    this.distance = ringRadius;
                }
                this.lastRingHit = currentRing;
            }
        }

        if (this.distance <= 10) {
            this.active = false;
            energy = Math.max(0, energy - 10);
        }
    }

    draw() {
        const pos = this.getPos();
        ctx.beginPath();
        if (this.type === 'crawler') {
            ctx.rect(pos.x - 12, pos.y - 12, 24, 24);
            ctx.fillStyle = CONFIG.COLORS.crawler;
        } else {
            ctx.moveTo(pos.x, pos.y - 24);
            ctx.lineTo(pos.x + 16, pos.y + 8);
            ctx.lineTo(pos.x - 16, pos.y + 8);
            ctx.closePath();
            ctx.fillStyle = CONFIG.COLORS.flyer;
        }
        ctx.fill();
    }
    
    getPos() {
        if (this.isSliding) {
            let startA = (this.slideStartLine * Math.PI * 2) / CONFIG.LINE_COUNT;
            let endA = (this.slideEndLine * Math.PI * 2) / CONFIG.LINE_COUNT;
            if (Math.abs(endA - startA) > Math.PI) {
                if (endA > startA) endA -= Math.PI * 2;
                else endA += Math.PI * 2;
            }
            const a = startA + (endA - startA) * this.slideProgress;
            return toProjected(this.slideRadius * currentWebScale, a);
        }
        const angle = (this.lineIdx * (Math.PI * 2)) / CONFIG.LINE_COUNT;
        return toProjected(this.distance * currentWebScale, angle);
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.vx = (Math.random() - 0.5) * 8;
        this.vy = (Math.random() - 0.5) * 8;
        this.life = 1.0;
        this.decay = Math.random() * 0.03 + 0.02;
        this.size = Math.random() * 4 + 2;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
        this.vx *= 0.95;
        this.vy *= 0.95;
    }
    draw() {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, Math.max(0, this.size * this.life), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.shadowBlur = 0;
    }
}

function handlePhaseLogic() {
    if (gamePhase === 'DEFENSE') {
        if (enemiesSpawnedThisWave >= waveEnemyCount && enemies.length === 0) {
            gamePhase = 'TRANS_ZOOM'; targetWebScale = 8.0;
            targetOffsetY = -0.05; // -0.35 から変更（位置を下げる）
            
            document.getElementById('controls').style.opacity = '0';
            document.getElementById('controls').style.pointerEvents = 'none';
            
            playerAttackLineIdx = Math.floor(CONFIG.LINE_COUNT / 2); 
            let targetBase = Math.PI / 2 - (playerAttackLineIdx * Math.PI * 2 / CONFIG.LINE_COUNT);
            while (targetBase > targetViewAngle + Math.PI) targetBase -= Math.PI * 2;
            while (targetBase < targetViewAngle - Math.PI) targetBase += Math.PI * 2;
            targetViewAngle = targetBase;
            
            document.getElementById('phase-ui').style.opacity = 1;
            document.getElementById('phase-ui').style.color = '#ff0000';
            document.getElementById('phase-ui').innerText = 'APPROACHING NEXT SECTOR';
            
            setTimeout(() => {
                generateWeb();
                bossWalls = [];
                // 手前から入ってくる演出のため、初期スケールを大きくし、透明度を0にする
                currentWebScale = 8.0;
                currentWebOpacity = 0.0;
                
                // ボス戦用の視点調整：俯瞰を抑える（0.4 -> 0.22）
                targetPerspectiveY = 0.22;
                
                // 俯瞰の変化を考慮してスケールを再計算（0.70からさらに下げて0.55に）
                let desiredScale = (height * 0.55 - (height * (0.5 + targetOffsetY))) / (maxRadius * targetPerspectiveY);
                targetWebScale = Math.max(1.5, desiredScale);
                
                gamePhase = 'TRANS_ATTACK';
                document.getElementById('phase-ui').innerText = 'WARNING: BOSS DETECTED';
                
                setTimeout(() => {
                    gamePhase = 'ATTACK';
                    bossHp = bossMaxHp;
                    document.getElementById('phase-ui').style.opacity = 0;
                    document.getElementById('controls').style.opacity = '1';
                    document.getElementById('controls').style.pointerEvents = 'auto';
                }, 2000); 
            }, 1500); 
        }
    } else if (gamePhase === 'ATTACK') {
        if (frame - lastBossWallFrame > 120 && bossWalls.length < 10) {
            let availableConns = connections.filter(c => !bossWalls.some(w => w.conn === c));
            if (availableConns.length > 0) {
                const randomConn = availableConns[Math.floor(Math.random() * availableConns.length)];
                bossWalls.push({ conn: randomConn, hp: 20 });
                lastBossWallFrame = frame;
            }
        }

        // ボスの攻撃ロジック：プレイヤー周辺（手前側）のラインのみ狙う
        if (frame - lastBossAttackFrame > 60) {
            const offset = Math.floor(Math.random() * 9) - 4; // -4 to +4 の範囲
            const targetLine = (playerAttackLineIdx + offset + CONFIG.LINE_COUNT) % CONFIG.LINE_COUNT;
            bossPulses.push(new BossPulse(targetLine));
            lastBossAttackFrame = frame;
        }
        
        if (bossHp <= 0 && bossMaxHp > 0) {
            bossMaxHp = 0; 
            gamePhase = 'TRANS_DEFENSE';
            targetOffsetY = 0.0;
            targetWebScale = 1.0;
            document.getElementById('phase-ui').style.opacity = 1;
            document.getElementById('phase-ui').style.color = '#00ffcc';
            document.getElementById('phase-ui').innerText = 'DEFENSE SEQUENCE INITIATED';
            
            document.getElementById('controls').style.opacity = '0';
            document.getElementById('controls').style.pointerEvents = 'none';
            
            setTimeout(() => {
                gamePhase = 'DEFENSE';
                waveCount++;
                waveEnemyCount = 15 + waveCount * 5;
                enemiesSpawnedThisWave = 0;
                bossMaxHp = 40 + waveCount * 10; 
                document.getElementById('phase-ui').style.opacity = 0;
                document.getElementById('phase-ui').style.color = '#ff0000';
                
                // 通常視点に戻す
                targetPerspectiveY = CONFIG.PERSPECTIVE_Y;
                
                document.getElementById('controls').style.opacity = '1';
                document.getElementById('controls').style.pointerEvents = 'auto';
            }, 3000);
        }
    }
}

function drawBoss() {
    const centerPos = toProjected(0, 0);
    const pulseScale = 1 + Math.sin(frame * 0.1) * 0.1;
    ctx.beginPath();
    // サイズを2倍（40 -> 80）に拡大
    ctx.arc(centerPos.x, centerPos.y, 80 * pulseScale, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.COLORS.boss;
    ctx.shadowBlur = 20;
    ctx.shadowColor = CONFIG.COLORS.boss;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (gamePhase === 'ATTACK') {
        const hpRatio = Math.max(0, bossHp / bossMaxHp);
        ctx.fillStyle = '#333';
        ctx.fillRect(centerPos.x - 50, centerPos.y - 70, 100, 10);
        ctx.fillStyle = '#ff3333';
        ctx.fillRect(centerPos.x - 50, centerPos.y - 70, 100 * hpRatio, 10);
    }
}

function drawPlayerOuter() {
    // 角度をスムーズに補間
    let targetAngle = (playerAttackLineIdx * Math.PI * 2) / CONFIG.LINE_COUNT;
    
    // 短い方の距離で補間するための処理
    let diff = targetAngle - playerDisplayAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    playerDisplayAngle += diff * 0.15;

    const pos = toProjected(maxRadius * currentWebScale, playerDisplayAngle);
    
    // 引いたカメラに合わせてサイズを再調整
    const size = 324 * currentWebScale;
    // 位置をさらに上げる
    // playerImgの代わりにlottieCanvasを描画
    ctx.drawImage(lottieCanvas, pos.x - size / 2, pos.y - size * 0.2 - 100, size, size);
    
    // 既存の光の演出を残す（オプション：不要なら削除可能だが、デザイン統一のため配置のみ維持）
    /*
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 15 * currentWebScale, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.COLORS.pulse;
    ctx.shadowBlur = 15;
    ctx.shadowColor = CONFIG.COLORS.pulse;
    ctx.fill();
    ctx.shadowBlur = 0;
    */
}

class AttackPulse {
    constructor(startLineIdx) {
        this.distance = 0;
        this.active = true;
        this.pathNodes = this.buildPath(startLineIdx);
        this.totalLength = this.pathNodes[this.pathNodes.length - 1].accumDist;
    }

    buildPath(startOuterLineIdx) {
        let nodes = [];
        let currentLine = startOuterLineIdx;
        let accumDist = 0;
        
        const startR = maxRadius; 
        nodes.push({ r: startR, l: currentLine, accumDist: 0 });

        for (let ring = CONFIG.RING_COUNT; ring >= 1; ring--) {
            const r = ring * ringStep;
            const dist = nodes[nodes.length - 1].r - r;
            accumDist += dist;
            nodes.push({ r: r, l: currentLine, accumDist: accumDist });

            const conn = connections.find(c => c.ring === ring && (c.lineIdx === currentLine || c.nextIdx === currentLine));
            if (conn) {
                const nextLine = (conn.lineIdx === currentLine) ? conn.nextIdx : conn.lineIdx;
                let startAngle = (currentLine * Math.PI * 2) / CONFIG.LINE_COUNT;
                let endAngle = (nextLine * Math.PI * 2) / CONFIG.LINE_COUNT;
                
                if (Math.abs(endAngle - startAngle) > Math.PI) {
                    if (endAngle > startAngle) endAngle -= Math.PI * 2;
                    else endAngle += Math.PI * 2;
                }
                const arcDist = Math.abs(endAngle - startAngle) * r;
                
                accumDist += arcDist;
                nodes.push({ r: r, l: nextLine, accumDist: accumDist, isArcEnd: true, arcStartL: currentLine, ring: ring });
                currentLine = nextLine;
            }
        }
        
        accumDist += nodes[nodes.length - 1].r; 
        nodes.push({ r: 0, l: currentLine, accumDist: accumDist });
        
        return nodes;
    }

    getPosAtDistance(targetDist) {
        if (targetDist <= 0) return { r: maxRadius, l: this.pathNodes[0].l };
        if (targetDist >= this.totalLength) {
            return { r: 0, l: this.pathNodes[this.pathNodes.length - 1].l };
        }

        for (let i = 1; i < this.pathNodes.length; i++) {
            const prev = this.pathNodes[i - 1];
            const curr = this.pathNodes[i];

            if (targetDist <= curr.accumDist) {
                const segmentDist = curr.accumDist - prev.accumDist;
                const ratio = segmentDist === 0 ? 0 : (targetDist - prev.accumDist) / segmentDist;

                if (curr.isArcEnd) {
                    let startA = (curr.arcStartL * Math.PI * 2) / CONFIG.LINE_COUNT;
                    let endA = (curr.l * Math.PI * 2) / CONFIG.LINE_COUNT;
                    if (Math.abs(endA - startA) > Math.PI) {
                        if (endA > startA) endA -= Math.PI * 2;
                        else endA += Math.PI * 2;
                    }
                    const a = startA + (endA - startA) * ratio;
                    return { r: curr.r, angle: a };
                } else {
                    const r = prev.r + (curr.r - prev.r) * ratio;
                    return { r: r, l: curr.l };
                }
            }
        }
        return { r: 0, l: 0 };
    }

    getProjectedPosAt(dist) {
        const pos = this.getPosAtDistance(dist);
        const angle = pos.angle !== undefined ? pos.angle : (pos.l * Math.PI * 2) / CONFIG.LINE_COUNT;
        return toProjected(pos.r * currentWebScale, angle);
    }

    update() {
        this.distance += CONFIG.PULSE_SPEED;
        if (this.distance > this.totalLength + CONFIG.PULSE_LENGTH) {
            this.active = false;
        }
    }

    draw() {
        ctx.beginPath();
        ctx.strokeStyle = CONFIG.COLORS.pulse;
        ctx.lineWidth = 8; // 4 -> 8 に強化
        ctx.shadowBlur = 30; // 15 -> 30 に強化
        ctx.shadowColor = CONFIG.COLORS.pulse;

        const startDist = Math.max(0, this.distance - CONFIG.PULSE_LENGTH);
        const endDist = Math.min(this.totalLength, this.distance); 
        
        let first = true;
        for (let d = startDist; d <= endDist; d += 4) { // 間隔を細かく
            const p = this.getProjectedPosAt(d);
            // ノイズを大きく (4 -> 12)
            const noiseX = (Math.random() - 0.5) * 12;
            const noiseY = (Math.random() - 0.5) * 12;
            
            if (first) {
                ctx.moveTo(p.x + noiseX, p.y + noiseY);
                first = false;
            } else {
                ctx.lineTo(p.x + noiseX, p.y + noiseY);
            }
        }
        
        const head = this.getProjectedPosAt(endDist);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();

        // 白い芯を追加して迫力を出す
        ctx.beginPath();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 0;
        first = true;
        for (let d = startDist; d <= endDist; d += 8) {
            const p = this.getProjectedPosAt(d);
            if (first) { ctx.moveTo(p.x, p.y); first = false; }
            else { ctx.lineTo(p.x, p.y); }
        }
        ctx.stroke();
        
        ctx.shadowBlur = 0;
    }
}

class BossPulse {
    constructor(lineIdx) {
        this.lineIdx = lineIdx;
        this.distance = 0;
        this.active = true;
        this.speed = 10;
        this.length = 150;
    }

    update() {
        this.distance += this.speed;
        if (this.distance > maxRadius + this.length) {
            this.active = false;
        }

        // プレイヤーへの当たり判定（外周付近に到達した時）
        if (this.distance >= maxRadius - 20 && this.distance <= maxRadius + 20) {
            if (this.lineIdx === playerAttackLineIdx) {
                this.active = false;
                energy = Math.max(0, energy - 10);
                playZapSound();
                // 画面を揺らす演出とかほしくなる
            }
        }
    }

    draw() {
        const angle = (this.lineIdx * Math.PI * 2) / CONFIG.LINE_COUNT;
        const startDist = Math.max(0, this.distance - this.length);
        const endDist = Math.min(maxRadius, this.distance);

        ctx.beginPath();
        ctx.strokeStyle = '#ff0033';
        ctx.lineWidth = 5;
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ff0000';

        let first = true;
        for (let d = startDist; d <= endDist; d += 10) {
            const pos = toProjected(d * currentWebScale, angle);
            const noiseX = (Math.random() - 0.5) * 10;
            const noiseY = (Math.random() - 0.5) * 10;
            if (first) {
                ctx.moveTo(pos.x + noiseX, pos.y + noiseY);
                first = false;
            } else {
                ctx.lineTo(pos.x + noiseX, pos.y + noiseY);
            }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
}

function drawWeb(side = 'ALL') {
    if (currentWebOpacity <= 0) return;
    ctx.globalAlpha = currentWebOpacity;
    
    // フェーズに応じて線の色を変更（ボス戦は赤系）
    if (gamePhase === 'ATTACK' || gamePhase === 'TRANS_ATTACK') {
        ctx.strokeStyle = '#660011';
    } else {
        ctx.strokeStyle = CONFIG.COLORS.line;
    }
    
    ctx.lineWidth = 2; // 3 から 2 へ細く

    for (let i = 0; i < CONFIG.LINE_COUNT; i++) {
        const angle = (i * (Math.PI * 2)) / CONFIG.LINE_COUNT;
        const sinVal = Math.sin(angle + viewAngle);
        
        // side引数に基づいて奥(BACK)か手前(FRONT)か判定
        if (side === 'BACK' && sinVal >= 0) continue;
        if (side === 'FRONT' && sinVal < 0) continue;

        const start = toProjected(CONFIG.INNER_RADIUS * currentWebScale, angle);
        const end = toProjected(maxRadius * currentWebScale, angle);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(start.x, start.y, 4 * currentWebScale, 0, Math.PI * 2);
        
        // フェーズに応じて円の色を変更
        if (gamePhase === 'ATTACK' || gamePhase === 'TRANS_ATTACK') {
            ctx.fillStyle = '#ff8800'; // オレンジ
        } else {
            ctx.fillStyle = '#00ffff'; // 水色
        }
        
        ctx.fill();
    }

    connections.forEach(c => {
        const angleStart = (c.lineIdx * (Math.PI * 2)) / CONFIG.LINE_COUNT;
        const sinStart = Math.sin(angleStart + viewAngle);
        
        if (side === 'BACK' && sinStart >= 0) return;
        if (side === 'FRONT' && sinStart < 0) return;

        let angleEnd = (c.nextIdx * (Math.PI * 2)) / CONFIG.LINE_COUNT;
        
        if (Math.abs(angleEnd - angleStart) > Math.PI) {
             if (angleEnd > angleStart) angleEnd -= Math.PI * 2;
             else angleEnd += Math.PI * 2;
        }
        
        ctx.beginPath();
        const segments = 10;
        for (let i = 0; i <= segments; i++) {
            const currentAngle = angleStart + (angleEnd - angleStart) * (i / segments);
            const pos = toProjected(c.radius * currentWebScale, currentAngle);
            if (i === 0) ctx.moveTo(pos.x, pos.y);
            else ctx.lineTo(pos.x, pos.y);
        }
        ctx.stroke();
    });

    if (gamePhase === 'ATTACK' || gamePhase === 'TRANS_ATTACK') {
        bossWalls.forEach(w => {
            const c = w.conn;
            const angleStart = (c.lineIdx * (Math.PI * 2)) / CONFIG.LINE_COUNT;
            const sinStart = Math.sin(angleStart + viewAngle);
            if (side === 'BACK' && sinStart >= 0) return;
            if (side === 'FRONT' && sinStart < 0) return;

            let angleEnd = (c.nextIdx * (Math.PI * 2)) / CONFIG.LINE_COUNT;
            if (Math.abs(angleEnd - angleStart) > Math.PI) {
                if (angleEnd > angleStart) angleEnd -= Math.PI * 2;
                else angleEnd += Math.PI * 2;
            }
            ctx.beginPath();
            // HPに応じて色を微調整（残りHPが少ないと白っぽく発光）
            const glow = Math.floor((1 - w.hp / 20) * 155);
            ctx.strokeStyle = `rgb(255, ${glow}, ${85 + glow})`;
            ctx.shadowColor = '#ff0055';
            ctx.shadowBlur = 15;
            ctx.lineWidth = 3 * currentWebScale; // 6 から 3 へ細く
            const segments = 10;
            for (let i = 0; i <= segments; i++) {
                const currentAngle = angleStart + (angleEnd - angleStart) * (i / segments);
                const pos = toProjected(c.radius * currentWebScale, currentAngle);
                if (i === 0) ctx.moveTo(pos.x, pos.y);
                else ctx.lineTo(pos.x, pos.y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        });
    }

    if (gamePhase === 'DEFENSE' && side !== 'BACK') {
        const centerPos = toProjected(0, 0);
        
        // 画像の描画（サイズを1.5倍の90に調整）
        const size = 90 * currentWebScale;
        // playerImgの代わりにlottieCanvasを描画
        ctx.drawImage(lottieCanvas, centerPos.x - size / 2, centerPos.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1.0;
}

function spawnEnemy() {
    if (frame % 40 === 0 && enemiesSpawnedThisWave < waveEnemyCount && gamePhase === 'DEFENSE') {
        const type = Math.random() > 0.3 ? 'crawler' : 'flyer';
        enemies.push(new Enemy(type));
        enemiesSpawnedThisWave++;
    }
}

function checkCollisions() {
    attackPulses.forEach(p => {
        if (!p.active) return;
        
        let hitWall = false;
        for (let i = 1; i < p.pathNodes.length; i++) {
            const prev = p.pathNodes[i - 1];
            const curr = p.pathNodes[i];
            if (p.distance >= prev.accumDist && p.distance <= curr.accumDist) {
                if (curr.isArcEnd) {
                    const wall = bossWalls.find(w => 
                        w.conn.ring === curr.ring && 
                        (w.conn.lineIdx === curr.arcStartL || w.conn.nextIdx === curr.arcStartL)
                    );
                    if (wall) {
                        p.active = false;
                        wall.hp--;
                        if (wall.hp <= 0) {
                            bossWalls = bossWalls.filter(w => w !== wall);
                        }
                        playZapSound();
                        const pPos = p.getProjectedPosAt(p.distance);
                        for (let j = 0; j < 10; j++) {
                            particles.push(new Particle(pPos.x, pPos.y, '#ffea00')); // ヒット時は黄色い火花
                        }
                        hitWall = true;
                    }
                }
            }
        }
        if (hitWall) return;

        const pHead = p.getProjectedPosAt(p.distance);
        const centerPos = toProjected(0, 0);
        const distToCenter = Math.hypot(pHead.x - centerPos.x, pHead.y - centerPos.y);
        if (distToCenter < 50 && gamePhase === 'ATTACK') {
            p.active = false;
            bossHp--;
            playZapSound(); // Use playZapSound for hit sound for now
            for (let i = 0; i < 20; i++) {
                particles.push(new Particle(centerPos.x, centerPos.y, '#ff0000'));
            }
        }
    });

    pulses.forEach(p => {
        if (!p.active) return;
        // 電撃の先端座標を取得（変更点）
        const pHead = p.getProjectedPosAt(p.distance);
        
        enemies.forEach(e => {
            if (e.active) {
                const ePos = e.getPos();
                const dist = Math.hypot(pHead.x - ePos.x, pHead.y - ePos.y);
                if (dist < 35) {
                    e.active = false;
                    p.active = false;
                    score += 100;
                    scoreDisplay.innerText = score;

                    // パーティクル発生
                    const color = e.type === 'crawler' ? CONFIG.COLORS.crawler : CONFIG.COLORS.flyer;
                    for (let i = 0; i < 15; i++) {
                        particles.push(new Particle(ePos.x, ePos.y, color));
                    }
                }
            }
        });
    });
}

function animate(currentTime) {
    requestAnimationFrame(animate);

    // FPS制御
    if (!currentTime) currentTime = performance.now();
    const elapsed = currentTime - lastTime;

    if (elapsed < fpsInterval) return;

    // 誤差を考慮してlastTimeを更新
    lastTime = currentTime - (elapsed % fpsInterval);

    ctx.fillStyle = CONFIG.COLORS.bg;
    ctx.fillRect(0, 0, width, height);

    // カメラ回転とYオフセットの補間
    viewAngle += (targetViewAngle - viewAngle) * 0.1;
    currentOffsetY += (targetOffsetY - currentOffsetY) * 0.05;
    centerY = height * (0.5 + currentOffsetY);
    
    currentWebScale += (targetWebScale - currentWebScale) * 0.05;
    currentPerspectiveY += (targetPerspectiveY - currentPerspectiveY) * 0.05;

    if (gamePhase === 'TRANS_ZOOM') {
        currentWebOpacity += (0.0 - currentWebOpacity) * 0.03;
    } else {
        currentWebOpacity += (1.0 - currentWebOpacity) * 0.1;
    }

    handlePhaseLogic();

    // 1. 奥側のウェブを描画 (BACK side)
    drawWeb('BACK');

    // 2. ボスを真ん中に描画
    if (gamePhase === 'ATTACK' || gamePhase === 'TRANS_ATTACK' || gamePhase === 'TRANS_DEFENSE') {
        drawBoss();
    }
    
    // 3. 手前側のウェブを描画 (FRONT side)
    drawWeb('FRONT');

    if (gamePhase === 'DEFENSE') {
        spawnEnemy();
    }

    pulses = pulses.filter(p => p.active);
    pulses.forEach(p => {
        p.update();
        p.draw();
    });

    attackPulses = attackPulses.filter(p => p.active);
    attackPulses.forEach(p => {
        p.update();
        p.draw();
    });

    bossPulses = bossPulses.filter(p => p.active);
    bossPulses.forEach(p => {
        p.update();
        p.draw();
    });

    // 攻撃フェーズのプレイヤーをウェブの上に描画
    if (gamePhase === 'ATTACK' || gamePhase === 'TRANS_ATTACK') {
        drawPlayerOuter();
    }

    enemies = enemies.filter(e => e.active);
    enemies.forEach(e => {
        e.update();
        e.draw();
    });

    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
        p.update();
        p.draw();
    });

    checkCollisions();

    // オート連射処理
    if (gamePhase === 'DEFENSE' && isMouseDown && frame - lastFireFrame >= CONFIG.PULSE_COOLDOWN) {
        firePulse(currentLineIdx);
        lastFireFrame = frame;
    }

    frame++;
}

function firePulse(lineIdx) {
    if (!bgmStarted) {
        bgm.play().catch(e => console.log("BGM Play Error:", e));
        bgmStarted = true;
    }
    pulses.push(new Pulse(lineIdx));
    playZapSound();
}

function triggerAttackPulse() {
    if (!bgmStarted) {
        bgm.play().catch(e => console.log("BGM Play Error:", e));
        bgmStarted = true;
    }
    attackPulses.push(new AttackPulse(playerAttackLineIdx));
    playZapSound();
}

window.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('nav-btn')) return;
    
    if (gamePhase === 'ATTACK') {
        if (frame - lastFireFrame >= CONFIG.PULSE_COOLDOWN) {
            triggerAttackPulse();
            lastFireFrame = frame;
        }
        return;
    }
    
    if (gamePhase !== 'DEFENSE') return;
    isMouseDown = true;
    updateMousePosition(e.clientX, e.clientY);
    if (frame - lastFireFrame >= CONFIG.PULSE_COOLDOWN) {
        firePulse(currentLineIdx);
        lastFireFrame = frame;
    }
});

window.addEventListener('mouseup', () => {
    isMouseDown = false;
});

window.addEventListener('mousemove', (e) => {
    updateMousePosition(e.clientX, e.clientY);
});

window.addEventListener('touchstart', (e) => {
    if (e.target.classList.contains('nav-btn')) return;
    e.preventDefault();
    
    if (gamePhase === 'ATTACK') {
        if (frame - lastFireFrame >= CONFIG.PULSE_COOLDOWN) {
            triggerAttackPulse();
            lastFireFrame = frame;
        }
        return;
    }

    if (gamePhase !== 'DEFENSE') return;
    isMouseDown = true;
    const touch = e.touches[0];
    updateMousePosition(touch.clientX, touch.clientY);
    if (frame - lastFireFrame >= CONFIG.PULSE_COOLDOWN) {
        firePulse(currentLineIdx);
        lastFireFrame = frame;
    }
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    updateMousePosition(touch.clientX, touch.clientY);
}, { passive: false });

window.addEventListener('touchend', (e) => {
    isMouseDown = false;
});

function updateMousePosition(x, y) {
    const rect = canvas.getBoundingClientRect();
    const internalX = (x - rect.left) * (canvas.width / rect.width);
    const internalY = (y - rect.top) * (canvas.height / rect.height);

    // X軸の1.4倍スケーリングを考慮して逆計算
    const dx = (internalX - centerX) / 1.4;
    const dy = (internalY - centerY) / currentPerspectiveY;
    const angle = Math.atan2(dy, dx);
    let normalizedAngle = angle - viewAngle;
    while (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
    while (normalizedAngle >= Math.PI * 2) normalizedAngle -= Math.PI * 2;
    currentLineIdx = Math.round(normalizedAngle / (Math.PI * 2 / CONFIG.LINE_COUNT)) % CONFIG.LINE_COUNT;
}

const btnLeft = document.getElementById('rot-left');
const btnRight = document.getElementById('rot-right');

// 移動時の火花パーティクル生成
function spawnMoveSparks(dir) {
    const pos = toProjected(maxRadius * currentWebScale, playerDisplayAngle);
    // 画面の下端いっぱい（内部解像度の下限付近）に調整
    const spawnY = height - 20;
    // 発生位置を移動方向の逆（後方）にずらす
    const spawnX = pos.x + (dir === 'left' ? 40 : -40);
    
    for (let i = 0; i < 45; i++) {
        const p = new Particle(spawnX, spawnY, '#ffaa00');
        // 移動方向と逆方向に飛ばす
        const baseVx = (dir === 'left' ? 1 : -1) * (Math.random() * 15 + 5);
        p.vx = baseVx + (Math.random() - 0.5) * 12;
        p.vy = (Math.random() - 0.5) * 15 - 5; // より広範囲に飛ぶ
        p.size = Math.random() * 3 + 0.5;
        p.decay = 0.02 + Math.random() * 0.03; // 若干長持ちさせる
        particles.push(p);
    }
}

function handleRotateLeft(e) {
    if(e) { e.preventDefault(); e.stopPropagation(); }
    if (gamePhase.startsWith('TRANS_')) return;
    if (gamePhase === 'ATTACK') {
        let oldIdx = playerAttackLineIdx;
        playerAttackLineIdx = (playerAttackLineIdx + 1) % CONFIG.LINE_COUNT;
        targetViewAngle -= Math.PI * 2 / CONFIG.LINE_COUNT;
        
        // 移動音の再生
        seLeft.currentTime = 0;
        seLeft.play().catch(e => console.log("SE Play Error:", e));

        if (oldIdx === CONFIG.LINE_COUNT - 1 && playerAttackLineIdx === 0) {
            targetViewAngle += Math.PI * 2;
            viewAngle += Math.PI * 2;
        }

        // Lottieアニメーションの切り替え (left: 80-100)
        if (playerAnimation) {
            playerAnimation.setLoop(false);
            playerAnimation.playSegments([80, 100], true);
        }

        // 足元から火花 (左移動なので右に飛ばす)
        spawnMoveSparks('left');
    } else {
        targetViewAngle += Math.PI / 4;
    }
}

function handleRotateRight(e) {
    if(e) { e.preventDefault(); e.stopPropagation(); }
    if (gamePhase.startsWith('TRANS_')) return;
    if (gamePhase === 'ATTACK') {
        let oldIdx = playerAttackLineIdx;
        playerAttackLineIdx = (playerAttackLineIdx - 1 + CONFIG.LINE_COUNT) % CONFIG.LINE_COUNT;
        targetViewAngle += Math.PI * 2 / CONFIG.LINE_COUNT;
        
        // 移動音の再生
        seRight.currentTime = 0;
        seRight.play().catch(e => console.log("SE Play Error:", e));

        if (oldIdx === 0 && playerAttackLineIdx === CONFIG.LINE_COUNT - 1) {
            targetViewAngle -= Math.PI * 2;
            viewAngle -= Math.PI * 2;
        }

        // Lottieアニメーションの切り替え (right: 60-80)
        if (playerAnimation) {
            playerAnimation.setLoop(false);
            playerAnimation.playSegments([60, 80], true);
        }

        // 足元から火花 (右移動なので左に飛ばす)
        spawnMoveSparks('right');
    } else {
        targetViewAngle -= Math.PI / 4;
    }
}

window.addEventListener('keydown', (e) => {
    if (e.repeat) return; // 押しっぱなしによる連続入力を防止
    if (e.key === 'ArrowLeft') handleRotateLeft();
    if (e.key === 'ArrowRight') handleRotateRight();
});

btnLeft.addEventListener('mousedown', handleRotateLeft);
btnLeft.addEventListener('touchstart', handleRotateLeft, { passive: false });
btnRight.addEventListener('mousedown', handleRotateRight);
btnRight.addEventListener('touchstart', handleRotateRight, { passive: false });

window.addEventListener('resize', resize);
init();
