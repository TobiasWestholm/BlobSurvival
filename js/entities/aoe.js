/**
 * BlobSurvival - Area of Effect (AoE) Zones, Persistent Surfaces & Ground Traps
 * 
 * Handles persistent hazard fields, player-laid proximity mines, elemental trails,
 * acid pools, bile mortar pods, and cosmic singularity distortion fields.
 */

// ---------------- 1. Burning Ground Surfaces & Elemental Trails ----------------

class BurningSurface extends Entity {
    constructor(x, y, r, now) {
        super(x, y, r);
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const burnMs = (typeof BURN_MS !== 'undefined') ? BURN_MS : 4000;
        this.expires = curTime + burnMs;
        this.alive = true;
        this.hitCooldown = new Map();
    }
    update(dt, now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        if (curTime > this.expires) { this.alive = false; return; }
        const burnTick = (typeof BURN_TICK !== 'undefined') ? BURN_TICK : 6;

        if (typeof GAME_STATE !== 'undefined' && GAME_STATE.players) {
            for (const p of GAME_STATE.players) {
                if (!p.alive || (p.isOnIce && p.isOnIce())) continue;
                const dx = p.x - this.x, dy = p.y - this.y;
                if (dx * dx + dy * dy < (this.r + p.r) * (this.r + p.r)) {
                    if (!this.hitCooldown.has(p)) {
                        this.hitCooldown.set(p, curTime + 133.3);
                    } else {
                        const nextHit = this.hitCooldown.get(p);
                        if (curTime >= nextHit) {
                            if (p.takeDamage) p.takeDamage(burnTick, curTime, this);
                            this.hitCooldown.set(p, curTime + 133.3);
                        }
                    }
                } else {
                    this.hitCooldown.delete(p);
                }
            }
        }
        if (typeof GAME_STATE !== 'undefined' && GAME_STATE.turrets) {
            for (const t of GAME_STATE.turrets) {
                if (!t.alive) continue;
                const dx = t.x - this.x, dy = t.y - this.y;
                if (dx * dx + dy * dy < (this.r + t.r) * (this.r + t.r)) {
                    if (!this.hitCooldown.has(t)) {
                        this.hitCooldown.set(t, curTime + 133.3);
                    } else {
                        const nextHit = this.hitCooldown.get(t);
                        if (curTime >= nextHit) {
                            if (t.takeDamage) t.takeDamage(burnTick, curTime, this);
                            this.hitCooldown.set(t, curTime + 133.3);
                        }
                    }
                } else {
                    this.hitCooldown.delete(t);
                }
            }
        }
        if (Math.random() < 0.4 && typeof GAME_STATE !== 'undefined' && GAME_STATE.particles && typeof Particle !== 'undefined') {
            const a = Math.random() * Math.PI * 2, rr = Math.random() * this.r;
            GAME_STATE.particles.push(new Particle(
                this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr, 0, -0.6 - Math.random(), '#ff7722', 420));
        }
    }
    draw(now) {
        if (typeof ctx === 'undefined') return;
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const burnMs = (typeof BURN_MS !== 'undefined') ? BURN_MS : 4000;
        const t = Math.max(0, (this.expires - curTime) / burnMs);
        ctx.save();
        ctx.globalAlpha = 0.16 + 0.14 * t;
        ctx.fillStyle = '#ff5500';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.12 + 0.1 * t;
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
}

class BurningTrailSegment extends Entity {
    constructor(x1, y1, x2, y2, now, player) {
        super((x1 + x2) / 2, (y1 + y2) / 2, 22);
        this.x1 = x1; this.y1 = y1;
        this.x2 = x2; this.y2 = y2;
        this.spawnTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        this.duration = 4500;
        this.alive = true;
        this.player = player;
        this.damage = 3;
        this.hitCooldown = new Map();
        
        // Bounding box for fast collision pruning
        this.minX = Math.min(x1, x2) - 25;
        this.maxX = Math.max(x1, x2) + 25;
        this.minY = Math.min(y1, y2) - 25;
        this.maxY = Math.max(y1, y2) + 25;
    }
    update(dt, now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        if (curTime - this.spawnTime > this.duration) {
            this.alive = false;
            return;
        }
        const dmgFactor = (typeof GAME_STATE !== 'undefined' && GAME_STATE.dmgFactor) ? GAME_STATE.dmgFactor : 1.0;
        const dmg = this.damage * (this.player ? this.player.damageModifier : 1.0) * dmgFactor;
        const dx = this.x2 - this.x1;
        const dy = this.y2 - this.y1;
        const len2 = dx * dx + dy * dy;

        if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.queryBox) {
            SPATIAL_GRID.queryBox(this.minX - 85, this.maxX + 85, this.minY - 85, this.maxY + 85, e => {
                if (!e || e.airborne || e.hp <= 0) return;
                if (e.x < this.minX - e.r || e.x > this.maxX + e.r || e.y < this.minY - e.r || e.y > this.maxY + e.r) return;

                const nextHit = this.hitCooldown.get(e) || 0;
                if (curTime < nextHit) return;

                let t = 0;
                if (len2 > 0) {
                    t = ((e.x - this.x1) * dx + (e.y - this.y1) * dy) / len2;
                    t = Math.max(0, Math.min(1, t));
                }
                const closestX = this.x1 + t * dx;
                const closestY = this.y1 + t * dy;
                const edx = e.x - closestX;
                const edy = e.y - closestY;
                if (edx * edx + edy * edy < (22 + e.r) * (22 + e.r)) {
                    e.hp -= dmg;
                    this.hitCooldown.set(e, curTime + 150);
                    if (typeof spawnHitParticles === 'function') spawnHitParticles(e.x, e.y, '#ffaa00');
                }
            });
        }
    }
    draw(now) {
        if (typeof ctx === 'undefined') return;
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const elapsed = curTime - this.spawnTime;
        const t = Math.min(1, elapsed / this.duration);
        const fade = 1 - Math.pow(t, 6);
        ctx.save();
        ctx.lineCap = 'round';
        
        ctx.strokeStyle = '#ff3300';
        ctx.lineWidth = 44 * fade;
        ctx.globalAlpha = 0.05 * fade;
        ctx.beginPath();
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
        ctx.stroke();
        
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 22 * fade;
        ctx.globalAlpha = 0.15 * fade;
        ctx.beginPath();
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
        ctx.stroke();
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6 * fade;
        ctx.globalAlpha = 0.3 * fade;
        ctx.beginPath();
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
        ctx.stroke();
        
        ctx.restore();
    }
}

class LaserTrailSegment extends Entity {
    constructor(x1, y1, x2, y2, now, player) {
        super((x1 + x2) / 2, (y1 + y2) / 2, 15);
        this.x1 = x1; this.y1 = y1;
        this.x2 = x2; this.y2 = y2;
        this.spawnTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        this.duration = 4500;
        this.alive = true;
        this.player = player;
        this.damage = 0.2;
        this.hitCooldown = new Map();
        
        // Bounding box for fast collision pruning
        this.minX = Math.min(x1, x2) - 15;
        this.maxX = Math.max(x1, x2) + 15;
        this.minY = Math.min(y1, y2) - 15;
        this.maxY = Math.max(y1, y2) + 15;
    }
    update(dt, now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        if (curTime - this.spawnTime > this.duration) {
            this.alive = false;
            return;
        }
        const dx = this.x2 - this.x1;
        const dy = this.y2 - this.y1;
        const len2 = dx * dx + dy * dy;
        const dmgFactor = (typeof GAME_STATE !== 'undefined' && GAME_STATE.dmgFactor) ? GAME_STATE.dmgFactor : 1.0;
        const dmg = this.damage * (this.player ? this.player.damageModifier : 1.0) * dmgFactor;
        
        if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.queryBox) {
            SPATIAL_GRID.queryBox(this.minX - 85, this.maxX + 85, this.minY - 85, this.maxY + 85, e => {
                if (typeof isDamageable === 'function' && !isDamageable(e)) return;
                if (!e || e.hp <= 0) return;
                
                if (e.x < this.minX - e.r || e.x > this.maxX + e.r || e.y < this.minY - e.r || e.y > this.maxY + e.r) {
                    return;
                }
                
                let t_val = 0;
                if (len2 > 0) {
                    t_val = ((e.x - this.x1) * dx + (e.y - this.y1) * dy) / len2;
                    t_val = Math.max(0, Math.min(1, t_val));
                }
                const closestX = this.x1 + t_val * dx;
                const closestY = this.y1 + t_val * dy;
                const edx = e.x - closestX;
                const edy = e.y - closestY;
                
                if (edx * edx + edy * edy < e.r * e.r) {
                    const nextHit = this.hitCooldown.get(e) || 0;
                    if (curTime >= nextHit) {
                        e.hp -= dmg;
                        this.hitCooldown.set(e, curTime + 150);
                        if (typeof spawnHitParticles === 'function') spawnHitParticles(e.x, e.y, this.player ? this.player.color : '#33ccff');
                    }
                }
            });
        }
    }
    draw(now) {
        if (typeof ctx === 'undefined') return;
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const elapsed = curTime - this.spawnTime;
        const t = Math.min(1, elapsed / this.duration);
        const fade = 1 - Math.pow(t, 8);
        ctx.save();
        ctx.lineCap = 'round';
        
        ctx.strokeStyle = this.player ? this.player.color : '#33ccff';
        ctx.lineWidth = 3.5 * fade;
        ctx.globalAlpha = 0.2 * fade;
        ctx.beginPath();
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
        ctx.stroke();
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.0 * fade;
        ctx.globalAlpha = 0.2 * fade;
        ctx.beginPath();
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
        ctx.stroke();
        ctx.restore();
    }
}

class IceTrailSegment extends Entity {
    constructor(x1, y1, x2, y2, now, player) {
        super((x1 + x2) / 2, (y1 + y2) / 2, 25);
        this.x1 = x1; this.y1 = y1;
        this.x2 = x2; this.y2 = y2;
        this.spawnTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        this.duration = 4500;
        this.alive = true;
        this.player = player;
        
        // Bounding box for fast collision pruning
        this.minX = Math.min(x1, x2) - 25;
        this.maxX = Math.max(x1, x2) + 25;
        this.minY = Math.min(y1, y2) - 25;
        this.maxY = Math.max(y1, y2) + 25;

        if (typeof GAME_STATE !== 'undefined' && GAME_STATE.iceTrails) {
            GAME_STATE.iceTrails.push(this);
        }
    }
    update(dt, now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        if (curTime - this.spawnTime > this.duration) {
            this.alive = false;
        }
    }
    draw(now) {
        if (typeof ctx === 'undefined') return;
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const elapsed = curTime - this.spawnTime;
        const t = Math.min(1, elapsed / this.duration);
        const fade = 1 - Math.pow(t, 8);
        ctx.save();
        ctx.lineCap = 'round';
        
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 44 * fade;
        ctx.globalAlpha = 0.01 * fade;
        ctx.beginPath();
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
        ctx.stroke();
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 10 * fade;
        ctx.globalAlpha = 0.01 * fade;
        ctx.beginPath();
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
        ctx.stroke();
        ctx.restore();
    }
}

// ---------------- 2. Player Proximity Mines & Biological Vesicles ----------------

function drawCryoMineFrost(ctx, x, y, r, now) {
    ctx.save();
    const segs = 16;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const nz = r * 0.10 * Math.sin(a * 3 + now * 0.0035 + 2.1) + r * 0.08 * Math.sin(a * 8 + now * 0.005 + 0.4);
        const rr = r * 1.22 + nz;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgb(120, 190, 255)';
    ctx.lineWidth = Math.max(2, r * 0.45);
    ctx.globalAlpha = 0.13;
    ctx.stroke();

    const plumeCount = 5;
    const riseH = r * 0.32;
    ctx.fillStyle = 'rgb(150, 220, 255)';
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    for (let i = 0; i < plumeCount; i++) {
        const baseAng = (i / plumeCount) * Math.PI * 2 + (i % 2) * 0.28 + now * 0.0004;
        const ox = x + Math.cos(baseAng) * (r * 1.35);
        const oy = y + Math.sin(baseAng) * (r * 1.35);
        const speed = 0.00035 + ((i * 37) % 5) * 0.00006;
        const front = (now * speed + i * 0.43) % 1;
        const steps = 3;
        for (let k = 0; k < steps; k++) {
            const hf = front - k / steps;
            if (hf < 0) continue;
            const sway = Math.sin(hf * 3.0 + now * 0.006 + i * 2.4) * (r * 0.6 * hf);
            const px = ox + sway;
            const py = oy - hf * riseH;
            const pr = r * (0.07 + 0.12 * hf);
            ctx.moveTo(px + pr, py);
            ctx.arc(px, py, pr, 0, Math.PI * 2);
        }
    }
    ctx.fill();
    ctx.restore();
}

function drawBioMineVesicle(ctx, x, y, r, now, player, isTriggered = false, triggeredTime = 0, attractsEnemies = false, powder = 0) {
    ctx.save();
    const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
    const stks = Math.min(3, Math.max(0, Math.floor(powder)));
    const pulseSpeed = isTriggered ? 0.025 : 0.005;
    const wobble = Math.sin(curTime * pulseSpeed + (x * 0.05)) * 0.08;
    const curR = r * (1 + wobble);

    // Outer translucent lipid vesicle membrane
    ctx.fillStyle = player ? player.color + '55' : 'rgba(100, 255, 100, 0.35)';
    ctx.beginPath();
    ctx.arc(x, y, curR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = player ? (player.ring || '#225522') : '#225522';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Inner glowing chemical core (digestive enzymes / volatile plasma)
    let coreColor = '#aaff00';
    let coreGlow = 0;
    if (isTriggered) {
        const progress = Math.min(1, (curTime - triggeredTime) / 2500);
        const flash = Math.floor(curTime / Math.max(40, 220 - 180 * progress)) % 2 === 0;
        coreColor = flash ? '#ff2200' : '#ff8800';
        coreGlow = flash ? 10 : 4;
    } else {
        const glowPulse = 0.5 + 0.5 * Math.sin(curTime * 0.006);
        coreColor = glowPulse > 0.5 ? (player ? player.color : '#aaff00') : '#99802f';
    }

    if (coreGlow > 0) {
        ctx.fillStyle = coreColor;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(x, y, curR * (isTriggered ? 0.70 : 0.55), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = coreColor;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(x, y, curR * (isTriggered ? 0.55 : 0.42 + stks * 0.015), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // 3D Liquid bubble gloss highlight (top-left)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.beginPath();
    ctx.arc(x - curR * 0.35, y - curR * 0.35, Math.max(1, curR * 0.28), 0, Math.PI * 2);
    ctx.fill();

    // Volatile Powder charge rings
    if (stks > 0) {
        const ringLife = 850;
        const stagger = ringLife / (stks * 1.4);
        const pulseMs = ringLife + stagger * (stks - 1);
        const pElapsed = curTime % pulseMs;
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth = Math.max(0.6, curR * 0.04);
        for (let i = 0; i < stks; i++) {
            const birth = i * stagger;
            if (pElapsed < birth) continue;
            const ringT = Math.min(1, (pElapsed - birth) / ringLife);
            const ringR = curR * (1 + ringT * 1.7);
            ctx.globalAlpha = (1 - ringT) * 0.75;
            ctx.beginPath();
            ctx.arc(x, y, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // Magnetic Attraction Ring (Bio-Pheromone wave)
    if (attractsEnemies) {
        const speedFactor = isTriggered ? 3 : 1;
        const pPulse = 1.2 + 0.35 * Math.sin(curTime / (160 / speedFactor));
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1.8;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.arc(x, y, curR * pPulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    if (player && player.cryoMineBuffed) {
        drawCryoMineFrost(ctx, x, y, curR, curTime);
    }

    ctx.restore();
}

class PlayerMine extends Entity {
    constructor(x, y, r, damage, player, now) {
        super(x, y, r);
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        this.damage = damage;
        this.player = player;
        this.spawnTime = curTime;
        this.alive = true;
        const diffMult = (typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty) ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0;
        this.explosionRadius = 50 * (player ? player.mineAoeModifier : 1.0) * (diffMult / 2 + 0.5);
        this.powderStacks = player ? (player.mineAoeCount || 0) : 0;
        const attractChance = (player && player.mineAttractEnabled && typeof GAME_CONFIG !== 'undefined') ? (GAME_CONFIG.UPGRADES.MINE_ATTRACT_CHANCE_PCT / 100) : 0;
        this.attractsEnemies = Math.random() < attractChance;
        this.triggeredTime = 0;
        this.vx = 0;
        this.vy = 0;
        this.friction = 0.92;
        if (this.attractsEnemies && typeof GAME_STATE !== 'undefined' && GAME_STATE.magneticMines) {
            GAME_STATE.magneticMines.push(this);
        }
        PlayerMine.enforceCap();
    }
    static enforceCap() {
        const maxMines = (typeof GAME_CONFIG !== 'undefined' && GAME_CONFIG.UPGRADES && GAME_CONFIG.UPGRADES.MAX_ACTIVE_MINES) || 200;
        if (typeof GAME_STATE === 'undefined' || !GAME_STATE.hazards) return;
        const activeMines = [];
        for (const h of GAME_STATE.hazards) {
            if (h instanceof PlayerMine && h.alive) {
                activeMines.push(h);
            }
        }
        const excess = activeMines.length - (maxMines - 1);
        if (excess > 0) {
            activeMines.sort((a, b) => a.spawnTime - b.spawnTime);
            for (let i = 0; i < excess; i++) {
                activeMines[i].despawn();
            }
        }
    }
    despawn() {
        this.alive = false;
        if (this.attractsEnemies && typeof GAME_STATE !== 'undefined' && GAME_STATE.magneticMines) {
            GAME_STATE.magneticMines = GAME_STATE.magneticMines.filter(m => m !== this);
        }
    }
    update(dt, now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const curW = (typeof W !== 'undefined') ? W : 1920;
        const curH = (typeof H !== 'undefined') ? H : 1080;

        if (Math.abs(this.vx) > 0.01 || Math.abs(this.vy) > 0.01) {
            this.x += this.vx;
            this.y += this.vy;
            this.vx *= this.friction;
            this.vy *= this.friction;
            this.x = Math.max(10, Math.min(curW - 10, this.x));
            this.y = Math.max(10, Math.min(curH - 10, this.y));
        }

        if (this.triggeredTime > 0) {
            const attractDurationSec = (typeof GAME_CONFIG !== 'undefined' && GAME_CONFIG.UPGRADES) ? (GAME_CONFIG.UPGRADES.MINE_ATTRACT_DURATION_SEC || 2.5) : 2.5;
            if (curTime - this.triggeredTime >= attractDurationSec * 1000) {
                let inContact = false;
                const mBox = this.r + 85;
                if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.queryBox) {
                    SPATIAL_GRID.queryBox(this.x - mBox, this.x + mBox, this.y - mBox, this.y + mBox, e => {
                        if (typeof isTargetable === 'function' && !isTargetable(e)) return;
                        const dx = e.x - this.x;
                        const dy = e.y - this.y;
                        const touch = this.r + e.r;
                        if (dx * dx + dy * dy <= touch * touch) {
                            inContact = true;
                            return false;
                        }
                    });
                }
                if (inContact) {
                    this.explode(curTime);
                } else {
                    this.triggeredTime = 0;
                }
            }
            return;
        }

        const mBox = this.r + 85;
        let triggered = false;
        if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.queryBox) {
            SPATIAL_GRID.queryBox(this.x - mBox, this.x + mBox, this.y - mBox, this.y + mBox, e => {
                if (typeof isTargetable === 'function' && !isTargetable(e)) return;
                const dx = e.x - this.x;
                const dy = e.y - this.y;
                const dist2 = dx * dx + dy * dy;
                const touch = this.r + e.r;
                if (dist2 <= touch * touch) {
                    triggered = true;
                    return false;
                }
            });
        }
        if (triggered) {
            if (this.attractsEnemies) {
                this.triggeredTime = curTime;
            } else {
                this.explode(curTime);
            }
        }
    }
    explode(now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        this.despawn();
        const dmgFactor = (typeof GAME_STATE !== 'undefined' && GAME_STATE.dmgFactor) ? GAME_STATE.dmgFactor : 1.0;
        const dmg = this.damage * (this.player ? this.player.mineDamageModifier : 1.0) * dmgFactor;
        let totalMineDmg = 0;
        const mineHitEnemies = [];
        const hitSet = new Set();
        const expBox = this.explosionRadius + 85;

        if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.queryBox) {
            SPATIAL_GRID.queryBox(this.x - expBox, this.x + expBox, this.y - expBox, this.y + expBox, e => {
                if (hitSet.has(e) || (typeof isDamageable === 'function' && !isDamageable(e))) return;
                const dx = e.x - this.x;
                const dy = e.y - this.y;
                if (dx * dx + dy * dy <= (this.explosionRadius + e.r) * (this.explosionRadius + e.r)) {
                    hitSet.add(e);
                    e.hp -= dmg;
                    totalMineDmg += dmg;
                    mineHitEnemies.push(e);
                    if (this.player && this.player.freezeEnabled && !e.isBoss()) {
                        e.freeze(e.type === 'meteor' ? 125 : 250, curTime);
                    }
                    if (typeof spawnHitParticles === 'function') spawnHitParticles(e.x, e.y, '#ffaa00');
                }
            });
        }

        applyExplosionHealing(this.x, this.y, this.explosionRadius, totalMineDmg, this.player, mineHitEnemies);

        // Volatile Powder spore cloud
        const stks = Math.min(3, Math.max(0, this.powderStacks || 0));
        if (stks > 0 && typeof GAME_STATE !== 'undefined' && GAME_STATE.particles && typeof Particle !== 'undefined') {
            const sporeCount = 4 + stks * 3;
            for (let i = 0; i < sporeCount; i++) {
                const spAng = Math.random() * Math.PI * 2;
                const spDist = Math.random() * this.explosionRadius;
                const spSpd = 0.5 + Math.random() * 1.5;
                GAME_STATE.particles.push(new Particle(
                    this.x + Math.cos(spAng) * spDist, this.y + Math.sin(spAng) * spDist,
                    Math.cos(spAng) * spSpd, Math.sin(spAng) * spSpd,
                    '#ffd54f', 400 + Math.random() * 200
                ));
            }
        }

        if (typeof GAME_STATE !== 'undefined' && GAME_STATE.hazards && typeof MineExplosion !== 'undefined') {
            GAME_STATE.hazards.push(new MineExplosion(this.x, this.y, this.explosionRadius, curTime, this.player));
        }
    }
    draw(now) {
        if (typeof ctx === 'undefined') return;
        ctx.save();
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());

        // 1. Viscous Secretion Bridge: Liquid tether connecting mother cell to newly secreted vacuole drop
        if (this.player && this.player.alive && this.spawnTime && (curTime - this.spawnTime < 240)) {
            const pdx = this.x - this.player.x;
            const pdy = this.y - this.player.y;
            const pdist = Math.hypot(pdx, pdy);
            const r1 = this.player.r || 12;
            const r2 = this.r + 1.0;
            const maxBridge = r1 + r2 + 28;

            if (pdist > 0.001 && pdist < maxBridge) {
                const u = Math.max(0, Math.min(1, (pdist - (r1 + r2 * 0.5)) / 28));
                const gamma = Math.atan2(pdy, pdx);
                const spread1 = (Math.PI * 0.45) * (1 - u * 0.65);
                const spread2 = (Math.PI * 0.45) * (1 - u * 0.65);

                const ax1 = this.player.x + Math.cos(gamma + spread1) * r1;
                const ay1 = this.player.y + Math.sin(gamma + spread1) * r1;
                const bx1 = this.player.x + Math.cos(gamma - spread1) * r1;
                const by1 = this.player.y + Math.sin(gamma - spread1) * r1;

                const ax2 = this.x + Math.cos(gamma + Math.PI - spread2) * r2;
                const ay2 = this.y + Math.sin(gamma + Math.PI - spread2) * r2;
                const bx2 = this.x + Math.cos(gamma - Math.PI + spread2) * r2;
                const by2 = this.y + Math.sin(gamma - Math.PI + spread2) * r2;

                const midX = (this.player.x + this.x) / 2;
                const midY = (this.player.y + this.y) / 2;
                const nx = -Math.sin(gamma);
                const ny = Math.cos(gamma);
                const waist = Math.max(0.3, (1 - u) * ((r1 + r2) * 0.32));

                ctx.fillStyle = this.player.color || '#4ade80';
                ctx.beginPath();
                ctx.moveTo(ax1, ay1);
                ctx.quadraticCurveTo(midX + nx * waist, midY + ny * waist, ax2, ay2);
                ctx.lineTo(bx2, by2);
                ctx.quadraticCurveTo(midX - nx * waist, midY - ny * waist, bx1, by1);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = this.player.ring || '#000';
                ctx.lineWidth = 1.8;
                ctx.beginPath();
                ctx.moveTo(ax1, ay1);
                ctx.quadraticCurveTo(midX + nx * waist, midY + ny * waist, ax2, ay2);
                ctx.moveTo(bx2, by2);
                ctx.quadraticCurveTo(midX - nx * waist, midY - ny * waist, bx1, by1);
                ctx.stroke();
            }
        }

        // 2. Translucent Bio-Chemical Vacuole / Lipid Vesicle Body
        drawBioMineVesicle(ctx, this.x, this.y, this.r, curTime, this.player, this.triggeredTime > 0, this.triggeredTime, this.attractsEnemies, this.powderStacks);
        ctx.restore();
    }
}

// ---------------- 3. Acid Hazards & Mortar Pods ----------------

class AcidPoolHazard extends Entity {
    constructor(x, y, r, now, duration = 5000) {
        super(x, y, r);
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        this.spawnTime = curTime;
        this.duration = duration;
        this.alive = true;
        this.lastDamageTick = 0;
    }
    update(dt, now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        if (curTime - this.spawnTime >= this.duration) {
            this.alive = false;
            return;
        }

        const canTick = (curTime - this.lastDamageTick >= 200);
        if (typeof GAME_STATE !== 'undefined' && GAME_STATE.players) {
            for (const p of GAME_STATE.players) {
                if (!p.alive) continue;
                const maxDist = this.r + p.r;
                if (this.distanceToSq(p) <= maxDist * maxDist) {
                    p.acidSlowUntil = Math.max(p.acidSlowUntil || 0, curTime + 300);
                    if (canTick && p.takeDamage) {
                        p.takeDamage(12, curTime, null);
                        if (typeof spawnHitParticles === 'function') spawnHitParticles(p.x, p.y, '#76ff03');
                    }
                }
            }
        }
        if (canTick) this.lastDamageTick = curTime;

        if (Math.random() < 0.25 && typeof GAME_STATE !== 'undefined' && GAME_STATE.particles && typeof Particle !== 'undefined') {
            const ang = Math.random() * Math.PI * 2;
            const d = Math.random() * this.r * 0.8;
            GAME_STATE.particles.push(new Particle(
                this.x + Math.cos(ang) * d, this.y + Math.sin(ang) * d,
                (Math.random() - 0.5) * 0.4, -0.6 - Math.random() * 0.8,
                Math.random() < 0.5 ? '#76ff03' : '#aeea00', 350
            ));
        }
    }
    draw(now) {
        if (typeof ctx === 'undefined') return;
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const elapsed = curTime - this.spawnTime;
        const remain = this.duration - elapsed;
        const fade = Math.min(1, remain / 600);
        ctx.save();
        ctx.globalAlpha = 0.65 * fade;

        const grad = ctx.createRadialGradient(this.x, this.y, this.r * 0.2, this.x, this.y, this.r);
        grad.addColorStop(0, '#76ff03');
        grad.addColorStop(0.6, '#388e3c');
        grad.addColorStop(1, 'rgba(27, 94, 32, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();

        const bubblePulse = 1.0 + 0.08 * Math.sin(curTime / 140 + this.x);
        ctx.fillStyle = '#aeea00';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r * 0.55 * bubblePulse, 0, Math.PI * 2);
        ctx.fill();

        for (let i = 0; i < 3; i++) {
            const bAngle = (curTime * 0.003 + i * 2.1) % (Math.PI * 2);
            const bDist = this.r * 0.35 * Math.sin(curTime * 0.002 + i);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(this.x + Math.cos(bAngle) * bDist, this.y + Math.sin(bAngle) * bDist, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}

class BileMortarPod extends Entity {
    constructor(startX, startY, targetX, targetY, spawnTime, landTime) {
        super(startX, startY, 14);
        this.startX = startX;
        this.startY = startY;
        this.targetX = targetX;
        this.targetY = targetY;
        this.spawnTime = spawnTime;
        this.landTime = landTime;
        this.duration = landTime - spawnTime;
        this.alive = true;
    }
    update(dt, now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        if (curTime >= this.landTime) {
            this.alive = false;
            if (typeof GAME_STATE !== 'undefined' && GAME_STATE.hazards) {
                GAME_STATE.hazards.push(new AcidPoolHazard(this.targetX, this.targetY, 65, curTime, 5000));
            }
            if (typeof GAME_STATE !== 'undefined' && GAME_STATE.players) {
                for (const p of GAME_STATE.players) {
                    if (!p.alive) continue;
                    const maxDist = 65 + p.r;
                    const dx = p.x - this.targetX, dy = p.y - this.targetY;
                    if (dx * dx + dy * dy <= maxDist * maxDist) {
                        if (p.takeDamage) p.takeDamage(35, curTime, { type: 'behemoth' });
                    }
                }
            }
            if (typeof GAME_STATE !== 'undefined' && GAME_STATE.particles && typeof Particle !== 'undefined') {
                for (let i = 0; i < 18; i++) {
                    const ang = Math.random() * Math.PI * 2;
                    const spd = 1.5 + Math.random() * 3.5;
                    GAME_STATE.particles.push(new Particle(
                        this.targetX, this.targetY,
                        Math.cos(ang) * spd, Math.sin(ang) * spd,
                        Math.random() < 0.6 ? '#76ff03' : '#aeea00', 400 + Math.random() * 200
                    ));
                }
            }
        }
    }
    draw(now) {
        if (typeof ctx === 'undefined') return;
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const elapsed = curTime - this.spawnTime;
        const progress = Math.max(0, Math.min(1, elapsed / this.duration));

        ctx.save();
        const pulse = 0.8 + 0.2 * Math.sin(curTime * 0.01);
        ctx.strokeStyle = 'rgba(118, 255, 3, ' + (0.4 + 0.4 * progress) + ')';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(this.targetX, this.targetY, 65 * pulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(118, 255, 3, ' + (0.2 + 0.3 * progress) + ')';
        ctx.beginPath();
        ctx.arc(this.targetX, this.targetY, 65 * progress, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        const curX = this.startX + (this.targetX - this.startX) * progress;
        const curY = this.startY + (this.targetY - this.startY) * progress;
        const heightArc = Math.sin(progress * Math.PI) * 220;
        const podDrawY = curY - heightArc;

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.4 * (1 - heightArc / 250)) + ')';
        ctx.beginPath();
        ctx.ellipse(curX, curY, 14 * (1 - heightArc / 300), 7 * (1 - heightArc / 300), 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#76ff03';
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(curX, podDrawY, 16, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.arc(curX, podDrawY, 11, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(curX - 3, podDrawY - 3, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

// ---------------- 4. Cosmic Singularity Fields (Warp Anomaly) ----------------

class WhiteHolePush extends Entity {
    constructor(x, y, r, now) {
        super(x, y, r);
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        this.spawnTime = curTime;
        this.duration = 850;
        this.alive = true;
    }
    update(dt, now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        if (curTime - this.spawnTime > this.duration) {
            this.alive = false;
        }
    }
    draw(now) {
        if (typeof ctx === 'undefined') return;
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const elapsed = curTime - this.spawnTime;
        const t = Math.min(1, elapsed / this.duration);
        ctx.save();

        const currentR = this.r * Math.pow(t, 0.45);
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, currentR);
        grad.addColorStop(0.0, 'rgba(255, 255, 255, ' + (0.95 * (1 - t)) + ')');
        grad.addColorStop(0.35, 'rgba(221, 214, 254, ' + (0.65 * (1 - t)) + ')');
        grad.addColorStop(0.7, 'rgba(168, 85, 247, ' + (0.35 * (1 - t)) + ')');
        grad.addColorStop(1.0, 'rgba(168, 85, 247, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        ctx.fill();

        for (let i = 0; i < 3; i++) {
            const ringProg = (t * 2.2 - i * 0.3);
            if (ringProg > 0 && ringProg <= 1) {
                const ringR = this.r * Math.pow(ringProg, 0.45);
                ctx.strokeStyle = i === 0 ? '#ffffff' : (i === 1 ? '#ddd6fe' : '#a855f7');
                ctx.lineWidth = (6 - i * 1.5) * (1 - ringProg);
                ctx.globalAlpha = (0.9 - i * 0.2) * (1 - ringProg);
                ctx.beginPath();
                ctx.arc(this.x, this.y, ringR, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        ctx.fillStyle = '#a855f7';
        ctx.globalAlpha = 0.35 * (1 - t);
        ctx.beginPath();
        ctx.arc(this.x, this.y, Math.max(0, (1 - t) * 32), 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(this.x, this.y, Math.max(0, (1 - t) * 22), 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

class BlackHolePull extends Entity {
    constructor(x, y, r, now) {
        super(x, y, r);
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        this.spawnTime = curTime;
        this.duration = 900;
        this.alive = true;
    }
    update(dt, now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        if (curTime - this.spawnTime > this.duration) {
            this.alive = false;
        }
    }
    draw(now) {
        if (typeof ctx === 'undefined') return;
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const elapsed = curTime - this.spawnTime;
        const t = Math.min(1, elapsed / this.duration);
        ctx.save();

        const outerR = this.r * (1 - t * 0.7);
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, outerR);
        grad.addColorStop(0.0, 'rgba(0, 0, 0, ' + (0.95 * (1 - t * 0.3)) + ')');
        grad.addColorStop(0.3, 'rgba(33, 0, 60, ' + (0.75 * (1 - t * 0.3)) + ')');
        grad.addColorStop(0.65, 'rgba(124, 77, 255, ' + (0.45 * (1 - t)) + ')');
        grad.addColorStop(0.9, 'rgba(168, 85, 247, ' + (0.25 * (1 - t)) + ')');
        grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, outerR, 0, Math.PI * 2);
        ctx.fill();

        const spinAngle = (curTime - this.spawnTime) * 0.008;
        for (let i = 0; i < 4; i++) {
            const spiralR = outerR * (0.85 - i * 0.18);
            if (spiralR > 2) {
                ctx.strokeStyle = (i % 2 === 0) ? '#d500f9' : '#a855f7';
                ctx.lineWidth = 2.5 * (1 - t);
                ctx.globalAlpha = 0.75 * (1 - t);
                ctx.beginPath();
                ctx.arc(this.x, this.y, spiralR, spinAngle + i * Math.PI * 0.5, spinAngle + (i + 1.2) * Math.PI * 0.5);
                ctx.stroke();
            }
        }

        const eventHorizonR = Math.max(0, (1 - t) * 32);
        ctx.strokeStyle = '#d500f9';
        ctx.lineWidth = 6;
        ctx.globalAlpha = 0.35 * (1 - t * 0.5);
        ctx.beginPath();
        ctx.arc(this.x, this.y, eventHorizonR + 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 0.98 * (1 - t * 0.5);
        ctx.fillStyle = '#000000';
        ctx.strokeStyle = '#d500f9';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, eventHorizonR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }
}

// ---------------- 5. AoE Helper Routines ----------------

function applyExplosionHealing(x, y, radius, totalDmg, causingPlayer, hitEnemies = null) {
    if (!causingPlayer || !causingPlayer.explosionHealEnabled || totalDmg <= 0) return;
    const healPct = (typeof GAME_CONFIG !== 'undefined' && GAME_CONFIG.UPGRADES) ? (GAME_CONFIG.UPGRADES.EXPLOSION_HEAL_PCT || 10) : 10;
    const healAmt = totalDmg * (healPct / 100);
    const healedPlayers = [];
    if (typeof GAME_STATE !== 'undefined' && GAME_STATE.players) {
        for (const p of GAME_STATE.players) {
            if (!p.isAlive || !p.isAlive()) continue;
            const dx = p.x - x;
            const dy = p.y - y;
            if (dx * dx + dy * dy <= (radius + p.r) * (radius + p.r)) {
                if (p.heal) p.heal(healAmt);
                if (typeof spawnHitParticles === 'function') spawnHitParticles(p.x, p.y, '#00ffcc');
                healedPlayers.push(p);
            }
        }
    }
    if (healedPlayers.length > 0 && typeof GAME_STATE !== 'undefined' && GAME_STATE.particles && typeof LifestealWisp !== 'undefined') {
        let sources = hitEnemies;
        if (!Array.isArray(sources) || sources.length === 0) {
            const blastR2 = radius * radius;
            sources = [];
            if (GAME_STATE.enemies) {
                for (const e of GAME_STATE.enemies) {
                    const edx = e.x - x;
                    const edy = e.y - y;
                    if (edx * edx + edy * edy <= blastR2) sources.push(e);
                }
            }
        }
        const wispCap = 28;
        let spawned = 0;
        for (const p of healedPlayers) {
            for (const e of sources) {
                if (spawned >= wispCap) break;
                const w = new LifestealWisp(e.x, e.y, p, 1.4, 0.05);
                w.lifetime = 750 + Math.random() * 350;
                w.maxLifetime = w.lifetime;
                GAME_STATE.particles.push(w);
                spawned++;
            }
        }
    }
}

function triggerWarpAnomalyDeathEffect(x, y, radius = 320, now) {
    const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
    if (typeof SoundEngine !== 'undefined' && SoundEngine.warpAnomaly) {
        SoundEngine.warpAnomaly();
    }
    const isPush = Math.random() < 0.5;
    const forceDist = isPush ? 240 : -240;

    const curW = typeof W !== 'undefined' ? W : 1512;
    const curH = typeof H !== 'undefined' ? H : 900;

    // 1. Affect Players (airborne physics & loss of steer control)
    if (typeof GAME_STATE !== 'undefined' && GAME_STATE.players) {
        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const dx = p.x - x;
            const dy = p.y - y;
            const dist = Math.hypot(dx, dy);
            if (dist <= radius && dist > 0.001) {
                const nx = dx / dist;
                const ny = dy / dist;
                const factor = (1 - dist / radius);
                const impulse = forceDist * factor;

                p.airborne = true;
                p.isKnockbackAirborne = true;
                p.knockbackStartX = p.x;
                p.knockbackStartY = p.y;
                p.knockbackTargetX = Math.max(20, Math.min(curW - 20, p.x + nx * impulse));
                p.knockbackTargetY = Math.max(20, Math.min(curH - 20, p.y + ny * impulse));
                p.knockbackStart = curTime;
                p.knockbackDuration = 550;
            }
        }
    }

    // 2. Affect Enemies (knockback airborne physics)
    if (typeof GAME_STATE !== 'undefined' && GAME_STATE.enemies) {
        const affectedEnemies = new Set();
        if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.queryBox) {
            SPATIAL_GRID.queryBox(x - radius, x + radius, y - radius, y + radius, e => {
                if (affectedEnemies.has(e) || (typeof isTargetable === 'function' && !isTargetable(e))) return;
                const dx = e.x - x;
                const dy = e.y - y;
                const dist = Math.hypot(dx, dy);
                if (dist <= radius && dist > 0.001) {
                    affectedEnemies.add(e);
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const factor = (1 - dist / radius);
                    const impulse = forceDist * factor;

                    e.airborne = true;
                    e.isKnockbackAirborne = true;
                    e.knockbackStartX = e.x;
                    e.knockbackStartY = e.y;
                    e.knockbackTargetX = Math.max(10, Math.min(curW - 10, e.x + nx * impulse));
                    e.knockbackTargetY = Math.max(10, Math.min(curH - 10, e.y + ny * impulse));
                    e.knockbackStart = curTime;
                    e.knockbackDuration = 500;
                }
            });
        }
    }

    // 3. Visual Cosmic Hazard (White Hole Push or Black Hole Pull)
    if (typeof GAME_STATE !== 'undefined' && GAME_STATE.hazards) {
        if (isPush) {
            GAME_STATE.hazards.push(new WhiteHolePush(x, y, radius, curTime));
            if (typeof GAME_STATE.particles !== 'undefined' && typeof Particle !== 'undefined') {
                for (let i = 0; i < 65; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 3.5 + Math.random() * 6.5;
                    GAME_STATE.particles.push(new Particle(
                        x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
                        Math.random() < 0.4 ? '#ffffff' : (Math.random() < 0.7 ? '#ddd6fe' : '#a855f7'), 550
                    ));
                }
            }
        } else {
            GAME_STATE.hazards.push(new BlackHolePull(x, y, radius, curTime));
            if (typeof GAME_STATE.particles !== 'undefined' && typeof Particle !== 'undefined') {
                for (let i = 0; i < 65; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const spawnDist = radius * (0.35 + Math.random() * 0.65);
                    const px = x + Math.cos(angle) * spawnDist;
                    const py = y + Math.sin(angle) * spawnDist;
                    const speed = (spawnDist / 320) * 8.5;
                    GAME_STATE.particles.push(new Particle(
                        px, py, -Math.cos(angle) * speed, -Math.sin(angle) * speed,
                        Math.random() < 0.5 ? '#d500f9' : (Math.random() < 0.8 ? '#a855f7' : '#7c4dff'), 500
                    ));
                }
            }
        }
    }
}

function triggerFullBoardMineExplosion(now) {
    const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
    const curW = (typeof W !== 'undefined') ? W : 1920;
    const curH = (typeof H !== 'undefined') ? H : 1080;
    const maxDim = Math.hypot(curW, curH);

    if (typeof GAME_STATE !== 'undefined' && GAME_STATE.hazards && typeof NukeExplosion !== 'undefined') {
        GAME_STATE.hazards.push(new NukeExplosion(curW / 2, curH / 2, maxDim * 0.85, curTime));
    }
    
    if (typeof GAME_STATE !== 'undefined' && GAME_STATE.particles && typeof Particle !== 'undefined') {
        for (let i = 0; i < 180; i++) {
            const px = Math.random() * curW;
            const py = Math.random() * curH;
            const a = Math.random() * Math.PI * 2;
            const s = 2.0 + Math.random() * 8.0;
            GAME_STATE.particles.push(new Particle(
                px, py, Math.cos(a) * s, Math.sin(a) * s,
                i % 3 === 0 ? '#ff2200' : (i % 3 === 1 ? '#ff8800' : '#ffff00'),
                600 + Math.random() * 600
            ));
        }
    }

    if (typeof SoundEngine !== 'undefined' && SoundEngine.nukeExplosion) {
        SoundEngine.nukeExplosion();
    }

    const nukeDamage = 180 * (typeof GAME_STATE !== 'undefined' ? GAME_STATE.dmgFactor : 1.0);
    if (typeof GAME_STATE !== 'undefined' && GAME_STATE.enemies) {
        for (const e of GAME_STATE.enemies) {
            if (typeof isDamageable === 'function' && !isDamageable(e)) continue;
            e.hp -= nukeDamage;
            if (typeof spawnHitParticles === 'function') spawnHitParticles(e.x, e.y, '#ffffff');
        }
    }

    if (typeof GAME_STATE !== 'undefined' && GAME_STATE.hazards) {
        for (const h of GAME_STATE.hazards) {
            if (h instanceof PlayerMine && h.alive) {
                h.despawn();
            }
        }
    }
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== 'undefined') {
    window.BurningSurface = BurningSurface;
    window.BurningTrailSegment = BurningTrailSegment;
    window.LaserTrailSegment = LaserTrailSegment;
    window.IceTrailSegment = IceTrailSegment;
    window.drawCryoMineFrost = drawCryoMineFrost;
    window.drawBioMineVesicle = drawBioMineVesicle;
    window.PlayerMine = PlayerMine;
    window.AcidPoolHazard = AcidPoolHazard;
    window.BileMortarPod = BileMortarPod;
    window.WhiteHolePush = WhiteHolePush;
    window.BlackHolePull = BlackHolePull;
    window.applyExplosionHealing = applyExplosionHealing;
    window.triggerWarpAnomalyDeathEffect = triggerWarpAnomalyDeathEffect;
    window.triggerFullBoardMineExplosion = triggerFullBoardMineExplosion;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        BurningSurface,
        BurningTrailSegment,
        LaserTrailSegment,
        IceTrailSegment,
        drawCryoMineFrost,
        drawBioMineVesicle,
        PlayerMine,
        AcidPoolHazard,
        BileMortarPod,
        WhiteHolePush,
        BlackHolePull,
        applyExplosionHealing,
        triggerWarpAnomalyDeathEffect,
        triggerFullBoardMineExplosion
    };
}
