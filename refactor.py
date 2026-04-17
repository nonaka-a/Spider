import os
import re

html_path = "/Volumes/NONAKA2020/DATA_B/webゲーム/00ゲームセンター/games/Spider/index.html"
js_path = "/Volumes/NONAKA2020/DATA_B/webゲーム/00ゲームセンター/games/Spider/main.js"

with open(html_path, "r", encoding="utf-8") as f:
    content = f.read()

js_match = re.search(r'<script>\n(.*?)\n</script>', content, re.DOTALL)
js_content = js_match.group(1)

# Apply modifications to js_content
js_content = js_content.replace(
    """let targetOffsetY = 0.0;
let currentOffsetY = 0.0;""",
    """let targetOffsetY = 0.0;
let currentOffsetY = 0.0;
let currentWebScale = 1.0;
let targetWebScale = 1.0;
let currentWebOpacity = 1.0;
let bossWalls = [];
let lastBossWallFrame = 0;"""
)

js_content = js_content.replace(
    """ctx.strokeStyle = CONFIG.COLORS.attackPulse;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 15;
        ctx.shadowColor = CONFIG.COLORS.attackPulse;""",
    """ctx.strokeStyle = CONFIG.COLORS.pulse;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 15;
        ctx.shadowColor = CONFIG.COLORS.pulse;"""
)

js_content = js_content.replace("gamePhase = 'TRANS_ATTACK';", "gamePhase = 'TRANS_ZOOM'; targetWebScale = 8.0;")

# We need to change drawWeb function completely
old_drawWeb = """function drawWeb() {
    ctx.strokeStyle = CONFIG.COLORS.line;
    ctx.lineWidth = 3;

    for (let i = 0; i < CONFIG.LINE_COUNT; i++) {
        const angle = (i * (Math.PI * 2)) / CONFIG.LINE_COUNT;
        const start = toProjected(CONFIG.INNER_RADIUS, angle);
        const end = toProjected(maxRadius, angle);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        // 放射線の入り口（黄色丸）
        ctx.beginPath();
        ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffff00';
        ctx.fill();
    }

    connections.forEach(c => {
        const angleStart = (c.lineIdx * (Math.PI * 2)) / CONFIG.LINE_COUNT;
        let angleEnd = (c.nextIdx * (Math.PI * 2)) / CONFIG.LINE_COUNT;
        
        if (Math.abs(angleEnd - angleStart) > Math.PI) {
             if (angleEnd > angleStart) angleEnd -= Math.PI * 2;
             else angleEnd += Math.PI * 2;
        }
        
        ctx.beginPath();
        const segments = 10;
        for (let i = 0; i <= segments; i++) {
            const currentAngle = angleStart + (angleEnd - angleStart) * (i / segments);
            const pos = toProjected(c.radius, currentAngle);
            if (i === 0) ctx.moveTo(pos.x, pos.y);
            else ctx.lineTo(pos.x, pos.y);
        }
        ctx.stroke();
    });

    const centerPos = toProjected(0, 0);
    ctx.beginPath();
    ctx.arc(centerPos.x, centerPos.y, 15, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.COLORS.spider;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.stroke();
}"""

new_drawWeb = """function drawWeb() {
    if (currentWebOpacity <= 0) return;
    ctx.globalAlpha = currentWebOpacity;
    ctx.strokeStyle = CONFIG.COLORS.line;
    ctx.lineWidth = 3;

    for (let i = 0; i < CONFIG.LINE_COUNT; i++) {
        const angle = (i * (Math.PI * 2)) / CONFIG.LINE_COUNT;
        const start = toProjected(CONFIG.INNER_RADIUS * currentWebScale, angle);
        const end = toProjected(maxRadius * currentWebScale, angle);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(start.x, start.y, 4 * currentWebScale, 0, Math.PI * 2);
        ctx.fillStyle = '#ffff00';
        ctx.fill();
    }

    connections.forEach(c => {
        const angleStart = (c.lineIdx * (Math.PI * 2)) / CONFIG.LINE_COUNT;
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
            const angleStart = (w.lineIdx * (Math.PI * 2)) / CONFIG.LINE_COUNT;
            let angleEnd = (w.nextIdx * (Math.PI * 2)) / CONFIG.LINE_COUNT;
            if (Math.abs(angleEnd - angleStart) > Math.PI) {
                if (angleEnd > angleStart) angleEnd -= Math.PI * 2;
                else angleEnd += Math.PI * 2;
            }
            ctx.beginPath();
            ctx.strokeStyle = '#ff0055';
            ctx.shadowColor = '#ff0055';
            ctx.shadowBlur = 15;
            ctx.lineWidth = 6 * currentWebScale;
            const segments = 10;
            for (let i = 0; i <= segments; i++) {
                const currentAngle = angleStart + (angleEnd - angleStart) * (i / segments);
                const pos = toProjected(w.radius * currentWebScale, currentAngle);
                if (i === 0) ctx.moveTo(pos.x, pos.y);
                else ctx.lineTo(pos.x, pos.y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        });
    }

    if (gamePhase === 'DEFENSE') {
        const centerPos = toProjected(0, 0);
        ctx.beginPath();
        ctx.arc(centerPos.x, centerPos.y, 15 * currentWebScale, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.COLORS.spider;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
}"""

# handle regex replace
js_content = js_content.replace(old_drawWeb, new_drawWeb)

# handle phase logic
old_phase = """function handlePhaseLogic() {
    if (gamePhase === 'DEFENSE') {
        if (enemiesSpawnedThisWave >= waveEnemyCount && enemies.length === 0) {
            gamePhase = 'TRANS_ATTACK';
            targetOffsetY = -0.35; 
            playerAttackLineIdx = Math.floor(CONFIG.LINE_COUNT / 2); 
            
            document.getElementById('phase-ui').style.opacity = 1;
            document.getElementById('phase-ui').style.color = '#ff0000';
            document.getElementById('phase-ui').innerText = 'WARNING: BOSS METAMORPHOSIS';
            
            setTimeout(() => {
                gamePhase = 'ATTACK';
                bossHp = bossMaxHp;
                document.getElementById('phase-ui').style.opacity = 0;
                document.getElementById('btn-attack').style.display = 'block';
            }, 3000); 
        }
    } else if (gamePhase === 'ATTACK') {
        targetViewAngle = Math.PI / 2 - (playerAttackLineIdx * Math.PI * 2 / CONFIG.LINE_COUNT);
        
        if (bossHp <= 0 && bossMaxHp > 0) {
            bossMaxHp = 0; 
            gamePhase = 'TRANS_DEFENSE';
            targetOffsetY = 0.0;
            document.getElementById('btn-attack').style.display = 'none';
            document.getElementById('phase-ui').style.opacity = 1;
            document.getElementById('phase-ui').style.color = '#00ffcc';
            document.getElementById('phase-ui').innerText = 'DEFENSE SEQUENCE INITIATED';
            
            setTimeout(() => {
                gamePhase = 'DEFENSE';
                waveCount++;
                waveEnemyCount = 15 + waveCount * 5;
                enemiesSpawnedThisWave = 0;
                bossMaxHp = 10 + waveCount * 5; 
                document.getElementById('phase-ui').style.opacity = 0;
                document.getElementById('phase-ui').style.color = '#ff0000';
            }, 3000);
        }
    } else if (gamePhase === 'TRANS_ATTACK') {
        targetViewAngle = Math.PI / 2 - (playerAttackLineIdx * Math.PI * 2 / CONFIG.LINE_COUNT);
    }
}"""

new_phase = """function handlePhaseLogic() {
    if (gamePhase === 'DEFENSE') {
        if (enemiesSpawnedThisWave >= waveEnemyCount && enemies.length === 0) {
            gamePhase = 'TRANS_ZOOM';
            targetWebScale = 8.0; // Zoom forward
            
            playerAttackLineIdx = Math.floor(CONFIG.LINE_COUNT / 2); 
            targetViewAngle = Math.PI / 2 - (playerAttackLineIdx * Math.PI * 2 / CONFIG.LINE_COUNT);
            
            document.getElementById('phase-ui').style.opacity = 1;
            document.getElementById('phase-ui').style.color = '#ff0000';
            document.getElementById('phase-ui').innerText = 'APPROACHING NEXT SECTOR';
            
            setTimeout(() => {
                generateWeb();
                bossWalls = [];
                currentWebScale = 0.0;
                targetWebScale = 1.0;
                targetOffsetY = -0.35; 
                gamePhase = 'TRANS_ATTACK';
                document.getElementById('phase-ui').innerText = 'WARNING: BOSS DETECTED';
                
                setTimeout(() => {
                    gamePhase = 'ATTACK';
                    bossHp = bossMaxHp;
                    document.getElementById('phase-ui').style.opacity = 0;
                    if (document.getElementById('btn-attack')) document.getElementById('btn-attack').style.display = 'block';
                }, 2000); 
            }, 1500); 
        }
    } else if (gamePhase === 'ATTACK') {
        targetViewAngle = Math.PI / 2 - (playerAttackLineIdx * Math.PI * 2 / CONFIG.LINE_COUNT);
        
        if (frame - lastBossWallFrame > 120 && bossWalls.length < 10) {
            let availableConns = connections.filter(c => !bossWalls.includes(c));
            if (availableConns.length > 0) {
                const randomConn = availableConns[Math.floor(Math.random() * availableConns.length)];
                bossWalls.push(randomConn);
                lastBossWallFrame = frame;
            }
        }
        
        if (bossHp <= 0 && bossMaxHp > 0) {
            bossMaxHp = 0; 
            gamePhase = 'TRANS_DEFENSE';
            targetOffsetY = 0.0;
            if (document.getElementById('btn-attack')) document.getElementById('btn-attack').style.display = 'none';
            document.getElementById('phase-ui').style.opacity = 1;
            document.getElementById('phase-ui').style.color = '#00ffcc';
            document.getElementById('phase-ui').innerText = 'DEFENSE SEQUENCE INITIATED';
            
            setTimeout(() => {
                gamePhase = 'DEFENSE';
                waveCount++;
                waveEnemyCount = 15 + waveCount * 5;
                enemiesSpawnedThisWave = 0;
                bossMaxHp = 10 + waveCount * 5; 
                document.getElementById('phase-ui').style.opacity = 0;
                document.getElementById('phase-ui').style.color = '#ff0000';
            }, 3000);
        }
    } else if (gamePhase === 'TRANS_ATTACK' || gamePhase === 'TRANS_ZOOM' || gamePhase === 'TRANS_DEFENSE') {
        if (gamePhase === 'TRANS_ATTACK' || gamePhase === 'TRANS_ZOOM') {
            targetViewAngle = Math.PI / 2 - (playerAttackLineIdx * Math.PI * 2 / CONFIG.LINE_COUNT);
        }
    }
}"""

js_content = js_content.replace(old_phase, new_phase)

# Modify animate to include scale fading
old_animate_cam = """    viewAngle += (targetViewAngle - viewAngle) * 0.1;
    currentOffsetY += (targetOffsetY - currentOffsetY) * 0.05;
    centerY = height * (0.5 + currentOffsetY);"""
new_animate_cam = """    viewAngle += (targetViewAngle - viewAngle) * 0.1;
    currentOffsetY += (targetOffsetY - currentOffsetY) * 0.05;
    centerY = height * (0.5 + currentOffsetY);
    
    currentWebScale += (targetWebScale - currentWebScale) * 0.05;
    if (gamePhase === 'TRANS_ZOOM') {
        currentWebOpacity += (0.0 - currentWebOpacity) * 0.03;
    } else {
        currentWebOpacity += (1.0 - currentWebOpacity) * 0.1;
    }"""
js_content = js_content.replace(old_animate_cam, new_animate_cam)


# Modify inner collision loop to check for Boss Walls
old_collision = """    attackPulses.forEach(p => {
        if (!p.active) return;
        const pHead = p.getProjectedPosAt(p.distance);"""
        
new_collision = """    attackPulses.forEach(p => {
        if (!p.active) return;
        
        let hitWall = false;
        for (let i = 1; i < p.pathNodes.length; i++) {
            const prev = p.pathNodes[i - 1];
            const curr = p.pathNodes[i];
            if (p.distance >= prev.accumDist && p.distance <= curr.accumDist) {
                if (curr.isArcEnd) {
                    const wallIdx = bossWalls.findIndex(w => 
                        w.ring === curr.ring && 
                        (w.lineIdx === curr.arcStartL || w.nextIdx === curr.arcStartL)
                    );
                    if (wallIdx !== -1) {
                        p.active = false;
                        bossWalls.splice(wallIdx, 1);
                        playZapSound();
                        const pPos = p.getProjectedPosAt(p.distance);
                        for (let j = 0; j < 15; j++) {
                            particles.push(new Particle(pPos.x, pPos.y, '#ff0055'));
                        }
                        hitWall = true;
                    }
                }
            }
        }
        if (hitWall) return;

        const pHead = p.getProjectedPosAt(p.distance);"""
js_content = js_content.replace(old_collision, new_collision)

# Update buildPath in Pulse and AttackPulse to include ring
old_pulse_arc = "nodes.push({ r: r, l: nextLine, accumDist: accumDist, isArcEnd: true, arcStartL: currentLine });"
new_pulse_arc = "nodes.push({ r: r, l: nextLine, accumDist: accumDist, isArcEnd: true, arcStartL: currentLine, ring: ring });"
js_content = js_content.replace(old_pulse_arc, new_pulse_arc)

# Apply scale to all getProjectedPosAt inner implementations
js_content = js_content.replace("return toProjected(pos.r, angle);", "return toProjected(pos.r * currentWebScale, angle);")
# For Enemy, `toProjected(this.slideRadius, a)`
js_content = js_content.replace("return toProjected(this.slideRadius, a);", "return toProjected(this.slideRadius * currentWebScale, a);")
js_content = js_content.replace("return toProjected(this.distance, angle);", "return toProjected(this.distance * currentWebScale, angle);")

# Save main.js
with open(js_path, "w", encoding="utf-8") as f:
    f.write(js_content)

# Save totally new index.html
new_html = """<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>スパイダーイーター</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div id="ui">
        <div class="stats">SCORE: <span id="score-val">0</span></div>
        <div style="font-size: 0.8rem; opacity: 0.7;">CLICK TO SHOOT PULSE</div>
    </div>
    <canvas id="gameCanvas"></canvas>
    <div id="controls">
        <button id="rot-left" class="nav-btn">◀︎</button>
        <button id="btn-attack" class="nav-btn" style="display: none; width: 80px; height: 80px; background: rgba(0, 255, 255, 0.2); border: 2px solid #00ffff; position: absolute; left: 50%; transform: translateX(-50%); bottom: -10px; z-index: 10; color: #00ffff; text-shadow: 0 0 5px #00ffff;">FIRE</button>
        <button id="rot-right" class="nav-btn">▶︎</button>
    </div>
    <div id="phase-ui" style="position: absolute; top: 100px; width: 100%; text-align: center; color: #ff0000; font-size: 2rem; font-weight: bold; pointer-events: none; opacity: 0; transition: opacity 0.5s;">WARNING: BOSS APPROACHING</div>
    <audio id="bgm" src="BGM.mp3" loop></audio>

    <script src="main.js"></script>
</body>
</html>
"""
with open(html_path, "w", encoding="utf-8") as f:
    f.write(new_html)
