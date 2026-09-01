/**
 * BlobSurvival - 2D Canvas Renderer & Viewport Manager
 */

// Mobile device detection
const isMobile = (typeof window !== 'undefined') && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent));
if (isMobile && typeof document !== 'undefined' && document.body) {
    document.body.classList.add('mobile-device');
}

let canvas = (typeof document !== 'undefined') ? document.getElementById('gameCanvas') : null;
let ctx = canvas ? canvas.getContext('2d') : null;
let W = (typeof window !== 'undefined') ? window.innerWidth : 1512;
let H = (typeof window !== 'undefined') ? window.innerHeight : 900;
let isGameEngineReady = true;

function initCanvasElements() {
    if (typeof document !== 'undefined') {
        if (!canvas) canvas = document.getElementById('gameCanvas');
        if (canvas && !ctx) ctx = canvas.getContext('2d');
    }
    if (!ctx) {
        if (typeof window !== 'undefined' && window.ctx) ctx = window.ctx;
        else if (typeof global !== 'undefined' && global.ctx) ctx = global.ctx;
    }
}

function resizeCanvas() {
    initCanvasElements();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const rawW = (rect && rect.width > 0) ? rect.width : (typeof window !== 'undefined' ? window.innerWidth : 1512);
    const rawH = (rect && rect.height > 0) ? rect.height : (typeof window !== 'undefined' ? window.innerHeight : 900);

    const targetArenaWidth = isMobile ? 600 : 1512;
    const scale = targetArenaWidth / rawW;
    W = Math.round(rawW * scale);
    H = Math.round(rawH * scale);
    canvas.width = W;
    canvas.height = H;

    if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.init) {
        SPATIAL_GRID.init(W, H);
    }

    // Push / clamp all active entities within new boundaries if resized mid-game
    if (typeof GAME_STATE !== 'undefined') {
        if (GAME_STATE.players) {
            for (const p of GAME_STATE.players) {
                if (p && typeof p.clampToArena === 'function') p.clampToArena();
            }
        }
        if (GAME_STATE.turrets) {
            for (const t of GAME_STATE.turrets) {
                t.x = Math.max(15, Math.min(W - 15, t.x));
                t.y = Math.max(15, Math.min(H - 15, t.y));
            }
        }
        if (GAME_STATE.hazards) {
            for (const h of GAME_STATE.hazards) {
                if (h.x !== undefined) h.x = Math.max(15, Math.min(W - 15, h.x));
                if (h.y !== undefined) h.y = Math.max(15, Math.min(H - 15, h.y));
                if (h.x1 !== undefined) h.x1 = Math.max(15, Math.min(W - 15, h.x1));
                if (h.y1 !== undefined) h.y1 = Math.max(15, Math.min(H - 15, h.y1));
                if (h.x2 !== undefined) h.x2 = Math.max(15, Math.min(W - 15, h.x2));
                if (h.y2 !== undefined) h.y2 = Math.max(15, Math.min(H - 15, h.y2));
            }
        }
        if (GAME_STATE.magneticMines) {
            for (const m of GAME_STATE.magneticMines) {
                m.x = Math.max(15, Math.min(W - 15, m.x));
                m.y = Math.max(15, Math.min(H - 15, m.y));
            }
        }
        if (GAME_STATE.gems) {
            for (const g of GAME_STATE.gems) {
                g.x = Math.max(15, Math.min(W - 15, g.x));
                g.y = Math.max(15, Math.min(H - 15, g.y));
            }
        }
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('resize', resizeCanvas);
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', resizeCanvas);
    } else {
        resizeCanvas();
    }
}

// ---------------- Color Shaders & Math ----------------
const _shadeHexCache = new Map();
function shadeHex(hex, factor) {
    const key = hex + '_' + factor;
    const cached = _shadeHexCache.get(key);
    if (cached !== undefined) return cached;

    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!m) {
        _shadeHexCache.set(key, hex);
        return hex;
    }
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const num = parseInt(h, 16);
    const comps = [(num >> 16) & 255, (num >> 8) & 255, num & 255].map(v => Math.max(0, Math.min(255, Math.round(v * factor))));
    const res = '#' + comps.map(v => v.toString(16).padStart(2, '0')).join('');
    _shadeHexCache.set(key, res);
    return res;
}

function brightenColor(hex, factor = 1.8) {
    if (!hex || hex[0] !== '#' || hex.length !== 7) return '#dd88ff';
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.min(255, Math.round(r * factor + 50));
    g = Math.min(255, Math.round(g * factor + 50));
    b = Math.min(255, Math.round(b * factor + 50));
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function drawBattlefieldBorder(now) {
    const isOnlineClient = (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager && netManager.isClient);
    const hostW = GAME_STATE.hostW || W;
    const hostH = GAME_STATE.hostH || H;

    // Render boundary on clients or whenever battlefield bounds differ from canvas
    if (!isOnlineClient && hostW === W && hostH === H) return;

    ctx.save();

    // 1. Darken out-of-bounds area outside the host battlefield
    ctx.fillStyle = 'rgba(8, 10, 14, 0.65)';
    if (W > hostW) {
        ctx.fillRect(hostW, 0, W - hostW, H);
    }
    if (H > hostH) {
        ctx.fillRect(0, hostH, Math.min(W, hostW), H - hostH);
    }

    // Subtle decorative diagonal hatch lines in off-limits area
    if (W > hostW || H > hostH) {
        ctx.save();
        ctx.beginPath();
        if (W > hostW) ctx.rect(hostW, 0, W - hostW, H);
        if (H > hostH) ctx.rect(0, hostH, Math.min(W, hostW), H - hostH);
        ctx.clip();
        
        ctx.strokeStyle = 'rgba(0, 255, 204, 0.05)';
        ctx.lineWidth = 1.5;
        const step = 32;
        ctx.beginPath();
        for (let x = -H; x < W + H; x += step) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x + H, H);
        }
        ctx.stroke();
        ctx.restore();
    }

    // 2. Smokey teal glowing border line around [0, 0, hostW, hostH]
    const pulse = 0.70 + 0.30 * Math.sin(now * 0.004);
    
    // Outer diffuse smoke glow
    ctx.save();
    ctx.strokeStyle = `rgba(0, 230, 200, ${(0.35 * pulse).toFixed(2)})`;
    ctx.lineWidth = 6;
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 14 + 6 * pulse;
    ctx.strokeRect(0, 0, hostW, hostH);
    ctx.restore();

    // Middle smokey teal line
    ctx.save();
    ctx.strokeStyle = `rgba(0, 245, 215, ${(0.75 + 0.25 * pulse).toFixed(2)})`;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(0, 0, hostW, hostH);
    ctx.restore();

    // Futuristic corner brackets at all 4 battlefield corners
    const cSize = Math.min(28, Math.min(hostW, hostH) * 0.1);
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'square';
    // Top-Left
    ctx.beginPath(); ctx.moveTo(0, cSize); ctx.lineTo(0, 0); ctx.lineTo(cSize, 0); ctx.stroke();
    // Top-Right
    ctx.beginPath(); ctx.moveTo(hostW - cSize, 0); ctx.lineTo(hostW, 0); ctx.lineTo(hostW, cSize); ctx.stroke();
    // Bottom-Left
    ctx.beginPath(); ctx.moveTo(0, hostH - cSize); ctx.lineTo(0, hostH); ctx.lineTo(cSize, hostH); ctx.stroke();
    // Bottom-Right
    ctx.beginPath(); ctx.moveTo(hostW - cSize, hostH); ctx.lineTo(hostW, hostH); ctx.lineTo(hostW, hostH - cSize); ctx.stroke();

    ctx.restore();
}

function drawGems(now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
    if (!ctx) initCanvasElements();
    if (!ctx) return;
    const gems = GAME_STATE.gems;
    const len = gems.length;
    if (len === 0) return;

    // Pass 1: Outer diamond body for all standard XP gems (batched into 1 draw call)
    ctx.fillStyle = '#a3a380';
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
        const g = gems[i];
        if (g instanceof XPGem) {
            const gx = g.x, gy = g.y, gr = g.r;
            ctx.moveTo(gx, gy - gr);
            ctx.lineTo(gx + gr, gy);
            ctx.lineTo(gx, gy + gr);
            ctx.lineTo(gx - gr, gy);
            ctx.closePath();
        }
    }
    ctx.fill();

    // Pass 2: Inner shiny core diamond for all standard XP gems (batched into 1 draw call)
    ctx.fillStyle = '#999960';
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
        const g = gems[i];
        if (g instanceof XPGem) {
            const gx = g.x, gy = g.y, cr = g.r * 0.4;
            ctx.moveTo(gx, gy - cr);
            ctx.lineTo(gx + cr, gy);
            ctx.lineTo(gx, gy + cr);
            ctx.lineTo(gx - cr, gy);
            ctx.closePath();
        }
    }
    ctx.fill();

    // Pass 3: Dedicated rendering pass for custom non-XPGem items (HealthPack, SupplyDrop)
    for (let i = 0; i < len; i++) {
        const g = gems[i];
        if (!(g instanceof XPGem) && typeof g.draw === 'function') {
            g.draw(now);
        }
    }
}

function drawParticles() {
    const particles = GAME_STATE.particles;
    const len = particles.length;
    if (len === 0) return;
    for (let i = 0; i < len; i++) {
        const p = particles[i];
        if (typeof p.draw === 'function' && !(p instanceof Particle)) {
            p.draw(); // Custom complex particles (e.g. GoldenPillarParticle, LifestealWisp)
        } else {
            ctx.globalAlpha = (typeof p.getLifetimePercent === 'function') ? p.getLifetimePercent() : Math.max(0, (p.lifetime !== undefined ? p.lifetime : p.life) / (p.maxLifetime || p.maxLife || 1));
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
        }
    }
    ctx.globalAlpha = 1.0;
}

function draw(now) {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    // subtle grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    const grid = 80;
    for (let x = 0; x < W; x += grid) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += grid) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Draw Smokey Teal Host Battlefield Border
    drawBattlefieldBorder(now);

    // Draw Martyrdom Auras
    for (const p of GAME_STATE.players) {
        if (!p.alive && p.martyrdomAuraEnabled) {
            ctx.save();
            const baseRadius = 110 * (p.martyrsPresenceEnabled ? (1 + GAME_CONFIG.UPGRADES.MARTYRS_PRESENCE_RADIUS_BOOST_PCT / 100) : 1.0) * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
            const pulse = 1 + Math.sin(now * 0.005) * 0.06;
            const radius = baseRadius * pulse;
            const grad = ctx.createRadialGradient(p.x, p.y, 5, p.x, p.y, radius);
            grad.addColorStop(0, 'rgba(255, 215, 0, 0.25)'); // Golden center
            grad.addColorStop(0.7, 'rgba(255, 223, 0, 0.1)'); // Soft fade
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Fully transparent edge
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    if (GAME_STATE.terrains) {
        for (const t of GAME_STATE.terrains) t.draw(now);
    }
    for (const t of GAME_STATE.turrets) t.draw(now);
    for (const hz of GAME_STATE.hazards) hz.draw(now);
    drawGems(now);

    // XP Tutorial arrow: point at the very first gem until it is picked up
    if (GAME_STATE.firstXpGem && GAME_STATE.firstXpGem.alive) {
        const gem = GAME_STATE.firstXpGem;
        // Find closest living player to base the arrow origin on
        let playerX = W / 2, playerY = H / 2;
        for (const p of GAME_STATE.players) {
            if (p.alive) { playerX = p.x; playerY = p.y; break; }
        }
        const adx = gem.x - playerX;
        const ady = gem.y - playerY;
        const aDist = Math.sqrt(adx * adx + ady * ady);
        // Only show arrow when gem is more than 40px away (not already overlapping)
        if (aDist > 40) {
            const ax = Math.cos(Math.atan2(ady, adx));
            const ay = Math.sin(Math.atan2(ady, adx));
            // Place the arrowhead offset just beyond the gem's edge
            const arrowTipX = gem.x + ax * (gem.r + 16);
            const arrowTipY = gem.y + ay * (gem.r + 16);
            const arrowLen = 26;
            const arrowSpread = 0.46; // ~26 deg half-angle
            const tailX = arrowTipX + ax * arrowLen;
            const tailY = arrowTipY + ay * arrowLen;

            ctx.save();
            ctx.globalAlpha = 0.82 + 0.18 * Math.sin(now / 280);
            ctx.strokeStyle = '#e2e060';
            ctx.fillStyle = '#e2e060';
            ctx.lineWidth = 2;

            // Arrow triangle head
            ctx.beginPath();
            ctx.moveTo(arrowTipX, arrowTipY);
            ctx.lineTo(tailX + Math.cos(Math.atan2(ady, adx) + Math.PI - arrowSpread) * 16,
                       tailY + Math.sin(Math.atan2(ady, adx) + Math.PI - arrowSpread) * 16);
            ctx.lineTo(tailX + Math.cos(Math.atan2(ady, adx) + Math.PI + arrowSpread) * 16,
                       tailY + Math.sin(Math.atan2(ady, adx) + Math.PI + arrowSpread) * 16);
            ctx.closePath();
            ctx.fill();

            // "XP" label just behind the tail
            const labelX = tailX + ax * 18;
            const labelY = tailY + ay * 18;
            ctx.font = 'bold 14px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#e2e060';
            ctx.fillText('XP', labelX, labelY);
            ctx.restore();
        }
    } else if (GAME_STATE.firstXpGem && !GAME_STATE.firstXpGem.alive) {
        GAME_STATE.firstXpGem = null;
        GAME_STATE.xpArrowDone = true; // Never show the arrow again this game
    }
    drawParticles();
    for (const e of GAME_STATE.enemies) {
        if (e && e.alive && e.hp > 0) e.draw(now);
    }
    for (const p of GAME_STATE.projectiles) p.draw(now);
    for (const ep of GAME_STATE.enemyProjectiles) ep.draw();
    for (const p of GAME_STATE.players) {
        if (p && !p.disconnected && !p.kicked) p.draw(now);
    }

    // 1. Boss pre-warning banners (5 seconds BEFORE boss minute starts)
    for (const key of Object.keys(BOSS_CONFIGS)) {
        const cfg = BOSS_CONFIGS[key];
        const preWarningStart = cfg.startMs - 5000;
        if (GAME_STATE.elapsed >= preWarningStart && GAME_STATE.elapsed < cfg.startMs && !GAME_STATE.completedBosses.has(cfg.id)) {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff1100';
            ctx.font = 'bold 36px sans-serif';
            if (cfg.id === 'octopus') {
                ctx.fillText('WARNING: IMMINENT THREAT...', W / 2, H / 2 - 20);
                ctx.font = '20px sans-serif';
                ctx.fillStyle = '#ffaa00';
                ctx.fillText('PREPARE FOR BOSS BATTLE', W / 2, H / 2 + 20);
            } else if (cfg.id === 'horde') {
                ctx.fillText('WARNING: HORDE APPROACHING...', W / 2, H / 2 - 20);
                ctx.font = '20px sans-serif';
                ctx.fillStyle = '#ffaa00';
                ctx.fillText('PREPARE YOUR DEFENSES', W / 2, H / 2 + 20);
            } else if (cfg.id === 'felhound') {
                ctx.fillText('WARNING: HUNGRY FELHOUND APPROACHING...', W / 2, H / 2 - 20);
                ctx.font = '20px sans-serif';
                ctx.fillStyle = '#ffaa00';
                ctx.fillText('PREPARE FOR BOSS BATTLE', W / 2, H / 2 + 20);
            } else if (cfg.id === 'behemoth') {
                ctx.fillText('WARNING: IMMINENT DEATH APPROACHING...', W / 2, H / 2 - 20);
                ctx.font = '20px sans-serif';
                ctx.fillStyle = '#76ff03';
                ctx.fillText('PREPARE FOR BOSS BATTLE', W / 2, H / 2 + 20);
            }
            ctx.restore();
            break;
        }
    }

    // 2. Active boss banners & countdowns
    if (GAME_STATE.activeBoss) {
        ctx.save();
        ctx.textAlign = 'center';
        const bossId = GAME_STATE.activeBoss;

        if (bossId === 'horde') {
            const hordeElapsed = now - GAME_STATE.hordeStartTime;
            if (hordeElapsed >= 52000 && hordeElapsed < 57000) {
                const secsLeft = Math.max(1, Math.ceil((57000 - hordeElapsed) / 1000));
                ctx.font = 'bold 32px sans-serif';
                ctx.fillStyle = '#ffaa00';
                ctx.fillText(`HORDE ENDS IN ${secsLeft}...`, W / 2, 45);
            } else {
                ctx.fillStyle = '#ff1100';
                ctx.font = 'bold 24px sans-serif';
                ctx.fillText('SURVIVE THE HORDE EVENT!', W / 2, 45);
            }
        }
        ctx.restore();
    }

    // 3. Upgrade menu, countdown & pause menu focus: darken canvas background and highlight active players with fat arrows
    if (GAME_STATE.current === STATES.LEVEL_UP || GAME_STATE.current === STATES.WEAPON_SELECT || GAME_STATE.current === STATES.COUNTDOWN || GAME_STATE.current === STATES.PAUSED) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();

        for (const p of GAME_STATE.players) {
            if (!p || !p.alive || p.disconnected || p.kicked) continue;

            // Soft radial spotlight behind player
            ctx.save();
            const glowR = Math.max(40, p.r * 3.0);
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
            grad.addColorStop(0, p.color + '55');
            grad.addColorStop(0.45, p.color + '22');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Redraw active player with full brightness above the dark overlay
            p.draw(now);

            // Draw animated fat focus arrow pointing at player
            drawPlayerFocusArrow(p, now);
        }
    }
}

function drawPlayerFocusArrow(p, now) {
    if (!p || !p.alive || p.disconnected || p.kicked) return;
    const bob = Math.sin(performance.now() * 0.008) * 6;
    const pointDown = p.y >= 85;
    const headWidth = 32;
    const headHeight = 17;
    const shaftWidth = 16;
    const shaftHeight = 17;
    const totalHeight = headHeight + shaftHeight;

    ctx.save();

    const drawPill = (pillX, pillY, pillW, pillH, r) => {
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(pillX, pillY, pillW, pillH, r);
        } else {
            ctx.rect(pillX, pillY, pillW, pillH);
        }
        ctx.fill();
        ctx.stroke();
    };

    // 1. Singleplayer: never display any weapon/upgrade badge over player.
    // 2. Multiplayer: display starting weapon once picked in lobby, then display chosen upgrade during level up.
    const isMultiplayer = (GAME_STATE.gameMode === 'local' || GAME_STATE.gameMode === 'online' || GAME_STATE.players.length > 1);
    let badgeText = null;
    if (isMultiplayer) {
        if (GAME_STATE.current === STATES.WEAPON_SELECT && p.selectedWeaponLabel) {
            badgeText = p.selectedWeaponLabel;
        } else if (GAME_STATE.current === STATES.LEVEL_UP && p.currentLevelUpgradeName) {
            badgeText = p.currentLevelUpgradeName;
        }
    }

    if (pointDown) {
        const tipX = p.x;
        const tipY = p.y - p.r - 12 + bob;
        const topY = tipY - totalHeight;

        // Draw fat downward-pointing arrow
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - headWidth / 2, tipY - headHeight);
        ctx.lineTo(tipX - shaftWidth / 2, tipY - headHeight);
        ctx.lineTo(tipX - shaftWidth / 2, topY);
        ctx.lineTo(tipX + shaftWidth / 2, topY);
        ctx.lineTo(tipX + shaftWidth / 2, tipY - headHeight);
        ctx.lineTo(tipX + headWidth / 2, tipY - headHeight);
        ctx.closePath();

        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = p.color;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.3;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Player Label Pill above arrow
        const labelText = `P${p.index + 1}`;
        ctx.font = 'bold 13px sans-serif';
        const textW = ctx.measureText(labelText).width;
        const pillW = textW + 14;
        const pillH = 18;
        const pillX = tipX - pillW / 2;
        const pillY = topY - pillH - 4;

        ctx.fillStyle = 'rgba(10, 10, 15, 0.92)';
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        drawPill(pillX, pillY, pillW, pillH, 5);

        ctx.fillStyle = p.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, tipX, pillY + pillH / 2);

        // Weapon/Upgrade label badge above the player pill
        if (badgeText) {
            ctx.font = 'bold 12px sans-serif';
            const wTextW = ctx.measureText(badgeText).width;
            const wPillW = wTextW + 16;
            const wPillH = 20;
            const wPillX = tipX - wPillW / 2;
            const wPillY = pillY - wPillH - 4;

            ctx.shadowColor = p.color;
            ctx.shadowBlur = 8;
            ctx.fillStyle = 'rgba(12, 12, 18, 0.95)';
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            drawPill(wPillX, wPillY, wPillW, wPillH, 6);

            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(badgeText, tipX, wPillY + wPillH / 2);
        }
    } else {
        // Point UP from below player when player is near the top edge
        const tipX = p.x;
        const tipY = p.y + p.r + 12 - bob;
        const bottomY = tipY + totalHeight;

        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - headWidth / 2, tipY + headHeight);
        ctx.lineTo(tipX - shaftWidth / 2, tipY + headHeight);
        ctx.lineTo(tipX - shaftWidth / 2, bottomY);
        ctx.lineTo(tipX + shaftWidth / 2, bottomY);
        ctx.lineTo(tipX + shaftWidth / 2, tipY + headHeight);
        ctx.lineTo(tipX + headWidth / 2, tipY + headHeight);
        ctx.closePath();

        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = p.color;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.3;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Player Label Pill below arrow
        const labelText = `P${p.index + 1}`;
        ctx.font = 'bold 13px sans-serif';
        const textW = ctx.measureText(labelText).width;
        const pillW = textW + 14;
        const pillH = 18;
        const pillX = tipX - pillW / 2;
        const pillY = bottomY + 4;

        ctx.fillStyle = 'rgba(10, 10, 15, 0.92)';
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        drawPill(pillX, pillY, pillW, pillH, 5);

        ctx.fillStyle = p.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, tipX, pillY + pillH / 2);

        // Weapon/Upgrade label badge below the player pill
        if (badgeText) {
            ctx.font = 'bold 12px sans-serif';
            const wTextW = ctx.measureText(badgeText).width;
            const wPillW = wTextW + 16;
            const wPillH = 20;
            const wPillX = tipX - wPillW / 2;
            const wPillY = pillY + pillH + 4;

            ctx.shadowColor = p.color;
            ctx.shadowBlur = 8;
            ctx.fillStyle = 'rgba(12, 12, 18, 0.95)';
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            drawPill(wPillX, wPillY, wPillW, wPillH, 6);

            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(badgeText, tipX, wPillY + wPillH / 2);
        }
    }
    ctx.restore();
}

if (typeof window !== 'undefined') {
    window.isMobile = isMobile;
    window.canvas = canvas;
    window.ctx = ctx;
    window.W = W;
    window.H = H;
    window.resizeCanvas = resizeCanvas;
    window.shadeHex = shadeHex;
    window.brightenColor = brightenColor;
    window.drawBattlefieldBorder = drawBattlefieldBorder;
    window.drawGems = drawGems;
    window.drawParticles = drawParticles;
    window.drawPlayerFocusArrow = drawPlayerFocusArrow;
    window.draw = draw;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isMobile,
        canvas,
        ctx,
        W,
        H,
        resizeCanvas,
        shadeHex,
        brightenColor,
        drawBattlefieldBorder,
        drawGems,
        drawParticles,
        drawPlayerFocusArrow,
        draw
    };
}