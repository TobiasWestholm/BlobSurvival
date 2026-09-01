class Collectible extends Entity {
    constructor(x, y, r = 6, vx = 0, vy = 0, magnetRange = 120, pullSpeed = 5.0, lifespan = Infinity, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        super(x, y, r);
        this.clampToArena(0, 0, typeof W !== 'undefined' ? W : 1512, typeof H !== 'undefined' ? H : 900, 15);
        this.vx = vx;
        this.vy = vy;
        this.attracted = false;
        this.magnetRange = magnetRange;
        this.pullSpeed = pullSpeed;
        this.createdTime = now;
        this.spawnTime = now;
        this.lifespan = lifespan;
    }

    isExpired(now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        return this.lifespan !== Infinity && (now - this.createdTime >= this.lifespan);
    }

    updatePhysics(dtFactor = 1.0) {
        if (this.vx || this.vy) {
            this.x += this.vx * dtFactor;
            this.y += this.vy * dtFactor;
            const decay = Math.pow(0.85, dtFactor);
            this.vx *= decay;
            this.vy *= decay;
            if (Math.abs(this.vx) < 0.05) this.vx = 0;
            if (Math.abs(this.vy) < 0.05) this.vy = 0;
            this.clampToArena(0, 0, typeof W !== 'undefined' ? W : 1512, typeof H !== 'undefined' ? H : 900, 15);
        }
    }

    pullTowardsPlayer(dtFactor = 1.0, filterFn = null) {
        const range = this.attracted ? Infinity : this.magnetRange;
        const player = Entity.findClosest(this, GAME_STATE.players, range, filterFn);
        if (!player) return null;

        this.attracted = true;
        const angle = this.angleTo(player);
        this.x += Math.cos(angle) * this.pullSpeed * dtFactor;
        this.y += Math.sin(angle) * this.pullSpeed * dtFactor;

        if (this.collidesWith(player)) {
            return player;
        }
        return null;
    }
}

class XPGem extends Collectible {
    constructor(x, y, value = 5, vx = 0, vy = 0) {
        const r = value >= 1000 ? 13 : (value >= 500 ? 9.5 : (value >= 100 ? 6.4 : (value >= 25 ? 3.9 : 2.65)));
        super(x, y, r, vx, vy, 100, 5.0, Infinity);
        this.value = value;
    }
    static createXPGems(x, y, xpValue, spreadFactor = 1) {
        if (!xpValue || xpValue <= 0) return;
        let gemValue = 0;
        if (xpValue > 500 && Math.random() < xpValue / 1000) {
            gemValue = 1000;
        } else if (xpValue <= 500 && xpValue > 100 && Math.random() < xpValue / 500) {
            gemValue = 500;
        } else if (xpValue <= 100 && xpValue > 25 && Math.random() < xpValue / 100) {
            gemValue = 100;
        } else if (xpValue <= 25 && xpValue > 5 && Math.random() < xpValue / 25) {
            gemValue = 25;
        } else if (xpValue <= 5 && Math.random() < xpValue / 5) {
            gemValue = 5;
        } else {
            return; // No gem spawned
        }

        const ang = Math.random() * Math.PI * 2;
        const popSpeed = 1.5 + Math.random() * 2.0 * spreadFactor;
        const vx = Math.cos(ang) * popSpeed;
        const vy = Math.sin(ang) * popSpeed;
        const gem = new XPGem(x, y, gemValue, vx, vy);
        GAME_STATE.gems.push(gem);
        // Tag the very first gem of the game for the XP tutorial arrow (only once per game)
        if (!GAME_STATE.xpArrowDone && !GAME_STATE.firstXpGem) {
            GAME_STATE.firstXpGem = gem;
        }
    }
    update(dtFactor = 1.0) {
        this.updatePhysics(dtFactor);
        const collectedPlayer = this.pullTowardsPlayer(dtFactor);
        if (collectedPlayer) {
            this.despawn();
            SoundEngine.gemPickup();
            addXp(this.value);
        }
    }
    draw() {
        ctx.save();
        ctx.fillStyle = '#a3a380';
        ctx.beginPath();
        ctx.moveTo(this.x, this.y - this.r);     // Top
        ctx.lineTo(this.x + this.r, this.y);     // Right
        ctx.lineTo(this.x, this.y + this.r);     // Bottom
        ctx.lineTo(this.x - this.r, this.y);     // Left
        ctx.closePath();
        ctx.fill();

        // Draw a shiny small dark core inside the gem
        ctx.fillStyle = '#999960';
        ctx.beginPath();
        const coreSize = this.r * 0.4;
        ctx.moveTo(this.x, this.y - coreSize);
        ctx.lineTo(this.x + coreSize, this.y);
        ctx.lineTo(this.x, this.y + coreSize);
        ctx.lineTo(this.x - coreSize, this.y);
        ctx.closePath();
        ctx.fill();
        
        ctx.restore();
    }
}

class HealthPack extends Collectible {
    constructor(x, y, nowTime = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        super(x, y, 10, 0, 0, 120, 5.5, 180000, nowTime);
    }
    update(dtFactor = 1.0, now = gameClock) {
        this.updatePhysics(dtFactor);
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : gameClock;
        if (this.isExpired(curTime)) {
            this.despawn();
            return;
        }
        const collectedPlayer = this.pullTowardsPlayer(dtFactor, p => p.hp < p.maxHp);
        if (collectedPlayer) {
            this.despawn();
            const healAmount = GAME_CONFIG.SUPPLIES.HEALTH_PACK_HP;
            collectedPlayer.heal(healAmount);
            if (typeof SoundEngine !== 'undefined' && SoundEngine.heal) {
                SoundEngine.heal('low');
            }
            for (let i = 0; i < 8; i++) {
                const a = Math.random() * Math.PI * 2, s = 1.0 + Math.random() * 2;
                GAME_STATE.particles.push(new Particle(this.x, this.y, Math.cos(a) * s, Math.sin(a) * s, '#ff3366', 300));
            }
        }
    }
    draw() {
        ctx.save();
        ctx.fillStyle = '#ff1155';
        ctx.shadowColor = '#ff1155';
        ctx.shadowBlur = 15;
        const size = this.r * 1.6;
        ctx.fillRect(this.x - size / 2, this.y - size / 2, size, size);
        
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 0;
        ctx.fillRect(this.x - size * 0.35, this.y - size * 0.1, size * 0.7, size * 0.2);
        ctx.fillRect(this.x - size * 0.1, this.y - size * 0.35, size * 0.2, size * 0.7);
        ctx.restore();
    }
}

class SupplyDrop extends Collectible {
    constructor(x, y, type, nowTime = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        super(x, y, 11, 0, 0, 120, 6.0, 120000, nowTime);
        this.type = type; // 'aegis', 'nitro', 'magnet', 'nuke', 'freeze', 'overclock'
    }
    update(dtFactor = 1.0, now = gameClock) {
        this.updatePhysics(dtFactor);
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : gameClock;
        if (this.isExpired(curTime)) {
            this.despawn();
            return;
        }
        const collectedPlayer = this.pullTowardsPlayer(dtFactor);
        if (collectedPlayer) {
            this.despawn();
            this.onCollect(collectedPlayer, curTime);
        }
    }
    onCollect(player, now = gameClock) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : gameClock;
        if (this.type === 'aegis') {
            player.aegisUntil = Math.max(player.aegisUntil || 0, curTime + GAME_CONFIG.SUPPLIES.AEGIS_DURATION_SEC * 1000);
            spawnHitParticles(this.x, this.y, '#00ffff');
        } else if (this.type === 'nitro') {
            player.nitroUntil = curTime + GAME_CONFIG.SUPPLIES.NITRO_DURATION_SEC * 1000;
            spawnHitParticles(this.x, this.y, '#ffaa00');
        } else if (this.type === 'magnet') {
            // Pull gems in large radius around collecting player
            const magRad = GAME_CONFIG.SUPPLIES.MAGNET_RADIUS;
            for (const g of GAME_STATE.gems) {
                if (g.alive) {
                    const gdx = g.x - player.x, gdy = g.y - player.y;
                    if (gdx * gdx + gdy * gdy <= magRad * magRad) {
                        g.attracted = true;
                    }
                }
            }
            spawnHitParticles(this.x, this.y, '#aa00ff');
        } else if (this.type === 'nuke') {
            // Shockwave blast centered at player
            const dmg = GAME_CONFIG.SUPPLIES.NUKE_DAMAGE * GAME_STATE.dmgFactor;
            const rad = GAME_CONFIG.SUPPLIES.NUKE_RADIUS;
            const px = player.x, py = player.y;
            GAME_STATE.hazards.push(new NukeExplosion(px, py, rad, curTime));
            for (const e of GAME_STATE.enemies) {
                if (e.hp > 0) {
                    const edx = e.x - px, edy = e.y - py;
                    const ed2 = edx * edx + edy * edy;
                    if (ed2 <= rad * rad) {
                        e.hp -= dmg;
                        const dist = Math.sqrt(ed2) || 1;
                        e.x += (edx / dist) * 45;
                        e.y += (edy / dist) * 45;
                    }
                }
            }
            spawnHitParticles(px, py, '#ff3300');
        } else if (this.type === 'freeze') {
            // Freeze centered at player
            const px = player.x, py = player.y;
            const rad = GAME_CONFIG.SUPPLIES.FREEZE_RADIUS;
            const dur = GAME_CONFIG.SUPPLIES.FREEZE_DURATION_SEC * 1000;
            GAME_STATE.hazards.push(new FreezeBlastVisual(px, py, rad, curTime));
            for (const e of GAME_STATE.enemies) {
                if (e.hp > 0 && !e.isBoss()) {
                    const edx = e.x - px, edy = e.y - py;
                    if (edx * edx + edy * edy <= rad * rad) {
                        e.freeze(dur, curTime);
                    }
                }
            }
            spawnHitParticles(px, py, '#00ffcc');
        } else if (this.type === 'overclock') {
            // Double attack speed of all active turrets
            GAME_STATE.turretOverclockUntil = curTime + GAME_CONFIG.SUPPLIES.OVERCLOCK_DURATION_SEC * 1000;
            spawnHitParticles(player.x, player.y, '#ffff00');
        }
    }
    draw(now = gameClock) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : gameClock;
        ctx.save();
        ctx.translate(this.x, this.y);
        const pulse = 1 + 0.15 * Math.sin(curTime * 0.01);
        ctx.scale(pulse, pulse);

        let color = '#ffffff', icon = 'S';
        if (this.type === 'aegis') { color = '#00ffff'; icon = '🛡️'; }
        else if (this.type === 'nitro') { color = '#ffaa00'; icon = '⚡'; }
        else if (this.type === 'magnet') { color = '#aa00ff'; icon = '🧲'; }
        else if (this.type === 'nuke') { color = '#ff3300'; icon = '💣'; }
        else if (this.type === 'freeze') { color = '#00ffcc'; icon = '❄️'; }
        else if (this.type === 'overclock') { color = '#ffff00'; icon = '⚙️'; }

        ctx.fillStyle = '#151515';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, 0, 1);
        ctx.restore();
    }
}

window.Collectible = Collectible;
window.Collectable = Collectible;
window.XPGem = XPGem;
window.HealthPack = HealthPack;
window.SupplyDrop = SupplyDrop;