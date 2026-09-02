// Base Enemy Superclass & Modular Subclasses
// Blob Survival Game Engine

class Enemy extends Unit {
    constructor(x, y, type = 'brute', now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), r = 15, hp = 100, speed = 0.9, damage = 4, color = '#ff4444', xpValue = 0) {
        super(x, y, r, hp);
        if (new.target === Enemy) {
            return Enemy.create(type, x, y, now);
        }
        this.type = type;
        this.speed = speed;
        this.damage = damage;
        this.color = color;
        this.xpValue = xpValue || 0;
        this.airborne = false;
        this.frozenUntil = 0;
        this.frozenStart = 0;
        this.attackPauseUntil = 0;
        this.turretTarget = null;
        this.inLaserFence = false;
        this.lastLaserFenceParticle = 0;
    }

    static create(type, x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        switch (type) {
            case 'brute':
            case 'mega_brute':
            case 'brute_lord':
            case 'swarm':
                return new BruteEnemy(x, y, type, now);
            case 'speeder':
                return new SpeederEnemy(x, y, now);
            case 'meteor':
                return new MeteorEnemy(x, y, now);
            case 'dasher':
                return new DasherEnemy(x, y, now);
            case 'shooter':
                return new ShooterEnemy(x, y, now);
            case 'spiky':
                return new SpikyEnemy(x, y, now);
            case 'baneling':
                return new BanelingEnemy(x, y, now);
            case 'marauder':
                return new MarauderEnemy(x, y, now);
            case 'stalker':
                return new StalkerEnemy(x, y, now);
            case 'zergling':
                return new ZerglingEnemy(x, y, now);
            case 'spine_crawler':
                return new SpineCrawlerEnemy(x, y, now);
            case 'sentry':
                return new SentryEnemy(x, y, now);
            case 'medivac':
                return new MedivacEnemy(x, y, now);
            case 'warp_anomaly':
                return new WarpAnomalyEnemy(x, y, now);
            case 'hellion':
                return new HellionEnemy(x, y, now);
            case 'shield_bearer':
                return new ShieldBearerEnemy(x, y, now);
            case 'viper':
                return new ViperEnemy(x, y, now);
            case 'octopus':
            case 'boss':
                return new OctopusBoss(x, y, now);
            case 'felhound':
                return new FelhoundBoss(x, y, now);
            case 'behemoth':
                return new BehemothBoss(x, y, now);
            default:
                return new BruteEnemy(x, y, 'swarm', now);
        }
    }

    isBoss() {
        return false;
    }

    isPhase2Unit() {
        const sc2Types = ['baneling', 'marauder', 'zergling', 'spine_crawler', 'stalker', 'sentry', 'medivac', 'warp_anomaly', 'hellion', 'shield_bearer', 'viper', 'behemoth'];
        return sc2Types.includes(this.type);
    }

    isOnIce() {
        if (!GAME_STATE.iceTrails || GAME_STATE.iceTrails.length === 0) return false;
        const numTrails = GAME_STATE.iceTrails.length;
        for (let i = 0; i < numTrails; i++) {
            const hz = GAME_STATE.iceTrails[i];
            if (!hz.alive) continue;
            if (this.x < hz.minX - this.r || this.x > hz.maxX + this.r || this.y < hz.minY - this.r || this.y > hz.maxY + this.r) continue;
            const dx = hz.x2 - hz.x1;
            const dy = hz.y2 - hz.y1;
            const len2 = dx * dx + dy * dy;
            let t = 0;
            if (len2 > 0) {
                t = ((this.x - hz.x1) * dx + (this.y - hz.y1) * dy) / len2;
                t = Math.max(0, Math.min(1, t));
            }
            const closestX = hz.x1 + t * dx;
            const closestY = hz.y1 + t * dy;
            const edx = this.x - closestX;
            const edy = this.y - closestY;
            if (edx * edx + edy * edy < (this.r + 22) * (this.r + 22)) {
                return true;
            }
        }
        return false;
    }

    isPassingThroughLaserFence() {
        return this.inLaserFence;
    }

    isTargetable() {
        return this.isAlive() && !this.burrowed && !this.airborne && !this.invisible && this.type !== 'warp_anomaly' && isOnPlayableArea(this);
    }

    isDamageable() {
        return this.isAlive() && !this.airborne && isOnPlayableArea(this);
    }

    freeze(dur, now) {
        if (this.isBoss()) return;
        if (now >= this.frozenUntil) {
            this.frozenStart = now;
            SoundEngine.enemyFreeze();
        }
        this.frozenUntil = now + dur;
    }

    applySlow(pct, dur) {
        // Standard slow hook
    }

    drawCryoOverlay(now) {
        if (this.isBoss() || now >= this.frozenUntil) return;
        const fadeIn = this.frozenStart ? Math.min(1, (now - this.frozenStart) / 100) : 1;
        const fadeOut = Math.min(1, (this.frozenUntil - now) / 150);
        const intensity = Math.min(fadeIn, fadeOut);
        if (intensity <= 0) return;
        
        ctx.save();
        ctx.fillStyle = '#00f0ff';
        ctx.globalAlpha = 0.18 * intensity;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r + 5, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#99e6ff';
        ctx.globalAlpha = 0.32 * intensity;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.globalAlpha = 0.60 * intensity;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    checkTurretContact(now) {
        if (!GAME_STATE.turrets || GAME_STATE.turrets.length === 0) return false;
        const numTurrets = GAME_STATE.turrets.length;
        for (let ti = 0; ti < numTurrets; ti++) {
            const t = GAME_STATE.turrets[ti];
            if (!t.alive) continue;
            if (Math.abs(t.x - this.x) > 35 || Math.abs(t.y - this.y) > 35) continue;
            const tdx = t.x - this.x, tdy = t.y - this.y;
            if (tdx * tdx + tdy * tdy < (t.r + this.r) * (t.r + this.r)) {
                if (typeof this.detonateBaneling === 'function') {
                    this.detonateBaneling(now);
                    return true;
                }
                t.takeDamage(this.damage, now, this);
            }
        }
        return false;
    }

    getSpeed(now) {
        if (this.isBoss()) return this.speed;
        if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) return this.speed;
        let s = this.speed;
        let isAuraSlowed = false;
        for (const p of GAME_STATE.players) {
            if (!p.alive && p.martyrdomAuraEnabled) {
                const auraRadius = 110 * (p.martyrsPresenceEnabled ? (1 + GAME_CONFIG.UPGRADES.MARTYRS_PRESENCE_RADIUS_BOOST_PCT / 100) : 1.0) * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
                const dx = this.x - p.x;
                const dy = this.y - p.y;
                if (dx * dx + dy * dy < auraRadius * auraRadius) {
                    s *= 0.5;
                    isAuraSlowed = true;
                    break;
                }
            }
        }
        if (!isAuraSlowed) {
            if (this.isOnIce()) {
                s *= 0.5;
            }
            if (this.isPassingThroughLaserFence()) {
                s *= 0.60;
            }
        }
        if (this.isPhase2Unit() && now < this.frozenUntil) {
            s *= 0.50;
        }
        return s;
    }

    getTarget(now) {
        let target = null, best = Infinity;
        let targetIsMine = false;
        let targetIsViperAttractor = false;

        if (this.isBoss()) {
            this.turretTarget = null;
            for (const p of GAME_STATE.players) {
                if (!p.alive || p.spawnInvuln > 0) continue;
                const dx = p.x - this.x, dy = p.y - this.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < best) { best = d2; target = p; }
            }
            return { target, distSq: best, isMine: false, isViper: false };
        }

        if (this.turretTarget) {
            if (this.turretTarget.alive) {
                target = this.turretTarget;
                const tdx = target.x - this.x, tdy = target.y - this.y;
                best = tdx * tdx + tdy * tdy;
            } else {
                this.turretTarget = null;
            }
        }

        if (!target) {
            let provokedTarget = null;
            let provokedBestD2 = Infinity;
            if (GAME_STATE.players.some(p => p.alive && p.martyrsPresenceEnabled && p.spawnInvuln <= 0)) {
                for (const p of GAME_STATE.players) {
                    if (!p.alive || p.spawnInvuln > 0 || !p.martyrsPresenceEnabled) continue;
                    const dx = p.x - this.x, dy = p.y - this.y;
                    const d2 = dx * dx + dy * dy;
                    const mineRadius = 50 * p.mineAoeModifier * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
                    if (d2 <= mineRadius * mineRadius && d2 < provokedBestD2) {
                        provokedBestD2 = d2;
                        provokedTarget = p;
                    }
                }
            }

            if (provokedTarget) {
                target = provokedTarget;
                best = provokedBestD2;
            } else {
                let viperAttractor = null;
                let viperBestD2 = Infinity;
                if (this.type !== 'viper' && this.type !== 'medivac' && GAME_STATE.attractingVipers.length > 0) {
                    for (let vi = 0; vi < GAME_STATE.attractingVipers.length; vi++) {
                        const e = GAME_STATE.attractingVipers[vi];
                        if (e !== this && e.hp > 0 && e.viperState === 'stopped_attracting') {
                            const vdx = e.x - this.x, vdy = e.y - this.y;
                            const vd2 = vdx * vdx + vdy * vdy;
                            const attractRadius = 260;
                            if (vd2 <= attractRadius * attractRadius && vd2 < viperBestD2) {
                                viperBestD2 = vd2;
                                viperAttractor = e;
                            }
                        }
                    }
                }

                if (viperAttractor) {
                    target = viperAttractor;
                    best = viperBestD2;
                    targetIsViperAttractor = true;
                } else {
                    for (const p of GAME_STATE.players) {
                        if (!p.alive || p.spawnInvuln > 0) continue;
                        const dx = p.x - this.x, dy = p.y - this.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < best) { best = d2; target = p; }
                    }

                    const ignoresMagneticMines = this.type === 'medivac' || this.type === 'warp_anomaly' || this.type === 'shield_bearer' || this.type === 'viper';
                    if (!ignoresMagneticMines) {
                        for (const m of GAME_STATE.magneticMines) {
                            const dx = m.x - this.x, dy = m.y - this.y;
                            const d2 = dx * dx + dy * dy;
                            if (d2 < best) {
                                best = d2;
                                target = m;
                                targetIsMine = true;
                            }
                        }
                    }
                }
            }
        }

        return { target, distSq: best, isMine: targetIsMine, isViper: targetIsViperAttractor };
    }

    updateKnockbackAirborne(now) {
        if (!this.isKnockbackAirborne) return false;
        const elapsed = now - this.knockbackStart;
        const progress = Math.min(1, elapsed / this.knockbackDuration);
        this.x = this.knockbackStartX + (this.knockbackTargetX - this.knockbackStartX) * progress;
        this.y = this.knockbackStartY + (this.knockbackTargetY - this.knockbackStartY) * progress;
        if (progress >= 1) {
            this.airborne = false;
            this.isKnockbackAirborne = false;
        }
        return true;
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (now < (this.attackPauseUntil || 0) && !this.lunging) {
            this.vx = 0;
            this.vy = 0;
            return;
        }
        if (this.updateKnockbackAirborne(now)) return;
        if (this.airborne) {
            if (now >= this.landAt && typeof this.land === 'function') this.land(now);
            return;
        }

        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const d = Math.sqrt(dx * dx + dy * dy);

        if (info.isViper) {
            const stopDist = target.r + this.r + 28;
            if (d > stopDist) {
                const nx = dx / d, ny = dy / d;
                const spd = this.getSpeed(now);
                this.x += nx * spd * dtFactor;
                this.y += ny * spd * dtFactor;
            }
            return;
        }

        const nx = d > 0.001 ? dx / d : 0;
        const ny = d > 0.001 ? dy / d : 0;
        const spd = this.getSpeed(now);
        this.x += nx * spd * dtFactor;
        this.y += ny * spd * dtFactor;

        if (this.checkTurretContact(now)) return;

        if (target.takeDamage && d < target.r + this.r) {
            target.takeDamage(this.damage, now, this);
            this.attackPauseUntil = now + 300;
        }
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        const glow = this.type === 'meteor' || this.type === 'shooter' || this.type === 'dasher';
        ctx.save();
        if (glow) {
            ctx.save();
            ctx.fillStyle = this.color;
            ctx.globalAlpha = 0.35;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r + 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = (this.color === '#000000') ? '#555555' : '#111111';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        
        this.drawCryoOverlay(now);
    }
}

// -------------------------------------------------------------
// Base Boss Superclass
// -------------------------------------------------------------
class BossEnemy extends Enemy {
    constructor(x, y, type, now, r, hp, speed, damage, color, xpValue) {
        super(x, y, type, now, r, hp, speed, damage, color, xpValue);
        this.isBossUnit = true;
    }

    isBoss() {
        return true;
    }

    freeze(dur, now) {
        // Bosses are immune to freeze
    }

    applySlow(pct, dur) {
        // Bosses are immune to crowd-control slows
    }

    getSpeed(now) {
        return this.speed;
    }
}

// -------------------------------------------------------------
// Standard Mob Classes
// -------------------------------------------------------------
class BruteEnemy extends Enemy {
    constructor(x, y, type = 'brute', now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        let hp = 30, speed = 0.8, damage = 6, color = '#cc2222', r = 18, xp = (typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.brute : 10);
        if (type === 'mega_brute') {
            hp = 70; speed = 0.6; damage = 12; color = '#990606'; r = 28; xp = (typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.mega_brute : 30);
        } else if (type === 'brute_lord') {
            hp = 200; speed = 0.5; damage = 20; color = '#770000'; r = 38; xp = (typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.brute_lord : 100);
        } else if (type === 'swarm') {
            hp = 10; speed = 0.9; damage = 4; color = '#ff4444'; r = 10; xp = (typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.swarm : 5);
        }
        super(x, y, type, now, r, hp, speed, damage, color, xp);
    }
}

class SpeederEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.speeder : 15;
        super(x, y, 'speeder', now, 11, 30, 1.42, 6, '#ff7700', xp);
    }
}

class DasherEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.dasher : 25;
        super(x, y, 'dasher', now, 13, 50, 0.9, 6, '#ff3344', xp);
        this.lunging = false;
        this.lungeUntil = 0;
        this.lungeReady = now + 800;
        this.lungeVx = 0;
        this.lungeVy = 0;
        this.sideDashing = false;
        this.sideUntil = now + 200 + Math.random() * 200;
        this.sideDir = Math.random() < 0.5 ? 1 : -1;
    }

    updateDasher(dtFactor, now, target, d, dx, dy) {
        const nx = d > 0.001 ? dx / d : 0;
        const ny = d > 0.001 ? dy / d : 0;
        if (this.lunging) {
            this.x += this.lungeVx * dtFactor;
            this.y += this.lungeVy * dtFactor;
            if (now >= this.lungeUntil) {
                this.lunging = false;
                this.lungeReady = now + DASHER_LUNGE_COOLDOWN;
            }
        } else {
            if (now < (this.attackPauseUntil || 0)) {
                this.vx = 0;
                this.vy = 0;
                return;
            }
            let mvx = nx * this.getSpeed(now), mvy = ny * this.getSpeed(now);
            // periodic sideways dashes (perpendicular to the approach), alternating sides
            if (now >= this.sideUntil) {
                this.sideDashing = !this.sideDashing;
                this.sideUntil = now + (this.sideDashing ? DASHER_SIDE_MS : DASHER_SIDE_GAP);
                if (this.sideDashing) this.sideDir *= -1;
            }
            if (this.sideDashing) {
                mvx += -ny * DASHER_SIDE_SPEED * this.sideDir;
                mvy += nx * DASHER_SIDE_SPEED * this.sideDir;
            }
            this.x += mvx * dtFactor;
            this.y += mvy * dtFactor;
            // lunge straight at the player, but only from outside the fire ring's reach
            if (now >= this.lungeReady && d <= DASHER_LUNGE_RANGE && d >= DASHER_LUNGE_MINDIST) {
                this.lunging = true;
                const projSpeedMult = 1 / (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0);
                this.lungeUntil = now + (DASHER_LUNGE_MS / projSpeedMult); // scales duration so travel distance remains identical
                this.lungeVx = nx * DASHER_LUNGE_SPEED * projSpeedMult;
                this.lungeVy = ny * DASHER_LUNGE_SPEED * projSpeedMult;
                SoundEngine.dasherJump();
            }
        }
        // keep on-screen (the lunge is fast)
        this.x = Math.max(-30, Math.min(W + 30, this.x));
        this.y = Math.max(-30, Math.min(H + 30, this.y));
        // contact damage (post-move so a fast lunge can't tunnel past)
        const cdx = target.x - this.x, cdy = target.y - this.y;
        const targetIsMine = target instanceof PlayerMine;
        if (!targetIsMine && typeof target.takeDamage === 'function' && cdx * cdx + cdy * cdy < (target.r + this.r) * (target.r + this.r)) {
            target.takeDamage(this.damage, now, this, true);
        }
        this.checkTurretContact(now);
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (this.updateKnockbackAirborne(now)) return;
        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x, dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        this.updateDasher(dtFactor, now, target, d, dx, dy);
    }
}

class ShooterEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.shooter : 25;
        super(x, y, 'shooter', now, 14, 50, 0.35, 5, '#661144', xp);
        this.fireReady = now + 1200;
        this.fireCooldown = 4200;
        this.shotDamage = 6;
        this.shotSpeed = 4.5 / (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0);
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (this.updateKnockbackAirborne(now)) return;
        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x, dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        const nx = d > 0.001 ? dx / d : 0;
        const ny = d > 0.001 ? dy / d : 0;
        const spd = this.getSpeed(now);
        this.x += nx * spd * dtFactor;
        this.y += ny * spd * dtFactor;

        if (this.checkTurretContact(now)) return;
        if (now >= this.fireReady && isOnPlayableArea(this)) {
            const attackMult = this.isPassingThroughLaserFence() ? 2.5 : 1.0;
            this.fireReady = now + this.fireCooldown * attackMult;
            const a = Math.atan2(target.y - this.y, target.x - this.x);
            GAME_STATE.enemyProjectiles.push(new ShooterProjectile(
                this.x, this.y, Math.cos(a) * this.shotSpeed, Math.sin(a) * this.shotSpeed, this.shotDamage, this, now));
            SoundEngine.shooterFire();
        }
    }
}

class MeteorEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.meteor : 40;
        super(x, y, 'meteor', now, 24, 120, 1.2, 12, '#ff4500', xp);
        this.airborne = true;
        if (GAME_STATE.activeBoss === 'horde') {
            const ang = Math.random() * Math.PI * 2;
            const dist = Math.random() * 160;
            this.x = W / 2 + Math.cos(ang) * dist;
            this.landY = H / 2 + Math.sin(ang) * dist;
        } else {
            this.landY = y;
        }
        const warnMult = GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0;
        this.fallDuration = METEOR_FALL_MS * warnMult;
        this.landAt = now + this.fallDuration;
        this.fallHeight = 340;
        this.blastDamage = 20;
        this.blastRadius = 80;
        SoundEngine.meteorFall(this.fallDuration / 1000);
    }

    land(now) {
        this.airborne = false;
        this.y = this.landY;
        GAME_STATE.hazards.push(new MineExplosion(this.x, this.y, this.blastRadius, now, null));
        GAME_STATE.hazards.push(new BurningSurface(this.x, this.landY, this.blastRadius, now));
        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const dx = p.x - this.x, dy = p.y - this.y;
            if (dx * dx + dy * dy < (this.blastRadius + p.r) * (this.blastRadius + p.r)) {
                p.takeDamage(this.blastDamage, now, this);
            }
        }
        for (const t of GAME_STATE.turrets) {
            if (!t.alive) continue;
            const dx = t.x - this.x, dy = t.y - this.y;
            if (dx * dx + dy * dy < (this.blastRadius + t.r) * (this.blastRadius + t.r)) {
                t.takeDamage(this.blastDamage, now, this);
            }
        }
        for (let i = 0; i < 20; i++) {
            const a = Math.random() * Math.PI * 2, s = 1.0 + Math.random() * 4.0;
            GAME_STATE.particles.push(new Particle(this.x, this.y, Math.cos(a) * s, Math.sin(a) * s, '#ff5500', 400));
        }
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.airborne) {
            const dur = this.fallDuration || METEOR_FALL_MS;
            const frac = Math.max(0, Math.min(1, 1 - (this.landAt - now) / dur));
            ctx.save();
            ctx.strokeStyle = `rgba(255,90,0,${0.25 + 0.5 * frac})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.landY, this.blastRadius * (0.45 + 0.55 * frac), 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            const drawY = this.landY - this.fallHeight * (1 - frac);
            ctx.save();
            ctx.save();
            ctx.fillStyle = '#ffcc00';
            ctx.globalAlpha = 0.35;
            ctx.beginPath();
            ctx.arc(this.x, drawY, this.r + 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            
            ctx.fillStyle = this.color;
            ctx.beginPath(); ctx.arc(this.x, drawY, this.r, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 0.35;
            ctx.beginPath(); ctx.arc(this.x, drawY - this.r * 1.4, this.r * 0.7, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            return;
        }
        super.draw(now);
    }
}

class SpikyEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.spiky : 80;
        super(x, y, 'spiky', now, 54, 400, 0.6, 25, '#ff1100', xp);
    }

    triggerSpikeExplosion(now) {
        SoundEngine.mineExplosion();
        const count = 12;
        const speed = 3.0 / (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0);
        const damage = 10;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            GAME_STATE.enemyProjectiles.push(new SpikyProjectile(this.x, this.y, vx, vy, damage, this, now));
        }
        for (let i = 0; i < 20; i++) {
            const a = Math.random() * Math.PI * 2, s = 1.0 + Math.random() * 3.0;
            GAME_STATE.particles.push(new Particle(this.x, this.y, Math.cos(a) * s, Math.sin(a) * s, '#ff1100', 400));
        }
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'spiky') {
            ctx.save();
            const pulse = 1.0 + 0.04 * Math.sin(now / 120);
            const radius = this.r * pulse;
            const isFrozen = now < this.frozenUntil;
            
            // Draw spikes sticking out (original colors)
            ctx.fillStyle = '#ff3300';
            ctx.strokeStyle = '#ffcc00';
            ctx.lineWidth = 1.5;
            const spikeCount = 8;
            for (let i = 0; i < spikeCount; i++) {
                const angle = (i / spikeCount) * Math.PI * 2 + (isFrozen ? 0 : (now / 1500)); // stop rotating spikes if frozen!
                ctx.beginPath();
                ctx.moveTo(this.x + Math.cos(angle) * radius * 1.35, this.y + Math.sin(angle) * radius * 1.35);
                ctx.lineTo(this.x + Math.cos(angle - 0.25) * radius * 0.9, this.y + Math.sin(angle - 0.25) * radius * 0.9);
                ctx.lineTo(this.x + Math.cos(angle + 0.25) * radius * 0.9, this.y + Math.sin(angle + 0.25) * radius * 0.9);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
            
            // Main body core (original colors)
            ctx.fillStyle = '#cc0000'; // dark crimson core
            ctx.strokeStyle = '#ff1100'; // bright red border
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            ctx.restore();
            
            this.drawCryoOverlay(now);
            return;
        }
    }
}

// -------------------------------------------------------------
// SC2 & Tactical Mob Classes
// -------------------------------------------------------------
class BanelingEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.baneling : 60;
        super(x, y, 'baneling', now, 13, 250, 1.75, 40, '#4d7c0f', xp);
        this.banelingDetonated = false;
        this.burrowed = false;
        this.burrowTriggerRadius = 42;
    }

    detonateBaneling(now) {
        if (this.banelingDetonated) return;
        this.banelingDetonated = true;
        this.hp = 0;
        const blastRadius = 75 / ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
        const blastDamage = 55 * GAME_STATE.difficulty.takenMult;

        // Visual acid explosion hazard
        GAME_STATE.hazards.push(new MineExplosion(this.x, this.y, blastRadius, now, null));

        // Damage players in radius
        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const dx = p.x - this.x;
            const dy = p.y - this.y;
            if (dx * dx + dy * dy <= (blastRadius + p.r) * (blastRadius + p.r)) {
                p.takeDamage(blastDamage, now, this);
            }
        }

        // Damage turrets in radius
        for (const t of GAME_STATE.turrets) {
            if (!t.alive) continue;
            const dx = t.x - this.x;
            const dy = t.y - this.y;
            if (dx * dx + dy * dy <= (blastRadius + t.r) * (blastRadius + t.r)) {
                t.takeDamage(blastDamage, now, this);
            }
        }

        // Acid splash particles — more of them to sell the larger explosion feel
        for (let i = 0; i < 32; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 2.0 + Math.random() * 5.0;
            GAME_STATE.particles.push(new Particle(this.x, this.y, Math.cos(a) * s, Math.sin(a) * s, '#65a30d', 550));
        }
        // Inner toxic flash particles
        for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 0.5 + Math.random() * 2.0;
            GAME_STATE.particles.push(new Particle(this.x, this.y, Math.cos(a) * s, Math.sin(a) * s, '#84cc16', 300));
        }
    }

    burrowBaneling(now, chance) {
        if (this.burrowed || !isOnPlayableArea(this)) return;
        const randNumber = Math.random();
        if (randNumber < chance) {
            this.burrowed = true;
            this.speed = 0;
        }
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (this.updateKnockbackAirborne(now)) return;
        this.burrowBaneling(now, 0.001);
        if (this.burrowed) {
            const triggerR = this.burrowTriggerRadius || 42;
            for (const p of GAME_STATE.players) {
                if (!p.alive) continue;
                const maxDist = triggerR + p.r;
                if (this.distanceToSq(p) <= maxDist * maxDist) {
                    this.detonateBaneling(now);
                    return;
                }
            }
            return;
        }
        super.update(dtFactor, now);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'baneling') {
            if (!this.burrowed) {
                ctx.save();
                const pulse = 1.0 + 0.08 * Math.sin(now / 90);
                const radius = this.r * pulse;

                // Acidic aura glow (toned down luminosity)
                ctx.save();
                ctx.fillStyle = '#65a30d';
                ctx.globalAlpha = 0.18;
                ctx.beginPath();
                ctx.arc(this.x, this.y, radius + 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                // Acidic body core (rich organic toxic green)
                ctx.fillStyle = '#4d7c0f';
                ctx.strokeStyle = '#65a30d';
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Acid sac swell on top (subdued toxic yellow-green)
                ctx.fillStyle = '#84cc16';
                ctx.beginPath();
                ctx.arc(this.x - 2, this.y - 3, radius * 0.55, 0, Math.PI * 2);
                ctx.fill();

                ctx.restore();
                this.drawCryoOverlay(now);
                return;
            } else {
                ctx.save();
                const triggerRadius = this.burrowTriggerRadius || 42;

                // 1. Dark Subterranean Encircling (matches exact trigger radius)
                const groundGrad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, triggerRadius);
                groundGrad.addColorStop(0, 'rgba(0, 0, 0, 0.78)');
                groundGrad.addColorStop(0.60, 'rgba(10, 18, 5, 0.65)');
                groundGrad.addColorStop(0.85, 'rgba(20, 32, 10, 0.45)');
                groundGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
                ctx.fillStyle = groundGrad;
                ctx.beginPath();
                ctx.arc(this.x, this.y, triggerRadius, 0, Math.PI * 2);
                ctx.fill();

                // Faint dark perimeter boundary ring showing exact trigger perimeter
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.60)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(this.x, this.y, triggerRadius, 0, Math.PI * 2);
                ctx.stroke();

                // Subterranean soil fissures radiating from center
                ctx.strokeStyle = '#142005';
                ctx.lineWidth = 1.2;
                for (let i = 0; i < 5; i++) {
                    const crackAngle = (i / 5) * Math.PI * 2 + 0.25;
                    const cx1 = this.x + Math.cos(crackAngle) * (this.r * 0.4);
                    const cy1 = this.y + Math.sin(crackAngle) * (this.r * 0.4);
                    const cx2 = this.x + Math.cos(crackAngle + 0.18) * (triggerRadius * 0.88);
                    const cy2 = this.y + Math.sin(crackAngle + 0.18) * (triggerRadius * 0.88);
                    ctx.beginPath();
                    ctx.moveTo(cx1, cy1);
                    ctx.lineTo(cx2, cy2);
                    ctx.stroke();
                }

                // 2. Dark Burrowed Baneling Body (submerged dormant organism)
                const radius = this.r * 0.85;

                // Dark earthy submerged crust
                ctx.fillStyle = '#142603';
                ctx.strokeStyle = '#050a01';
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Dormant dark toxic acid sac swell (subdued murky olive)
                ctx.fillStyle = '#2d4a0a';
                ctx.beginPath();
                ctx.arc(this.x - 1, this.y - 1, radius * 0.55, 0, Math.PI * 2);
                ctx.fill();

                // Faint subterranean toxic spore pulse in the center
                const dormantPulse = 0.22 + 0.12 * Math.abs(Math.sin(now / 380));
                ctx.fillStyle = `rgba(77, 124, 15, ${dormantPulse})`;
                ctx.beginPath();
                ctx.arc(this.x - 1, this.y - 1, radius * 0.32, 0, Math.PI * 2);
                ctx.fill();

                ctx.restore();
                this.drawCryoOverlay(now);
                return;
            }
            
        }
    }
}

class MarauderEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.marauder : 90;
        super(x, y, 'marauder', now, 16, 500, 1.25, 30, '#37474f', xp);
        this.firingRange = 260;
        this.aiming = false;
        this.aimUntil = 0;
        this.aimAngle = 0;
        this.fireReady = now + 800;
        this.fireCooldown = 2600;
        this.shotDamage = 22;
        this.shotSpeed = 8.5 / (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0);
    }

    updateMarauder(dtFactor, now, target, d, dx, dy) {
        // SC2 Marauder: advances toward target, stops at firing range,
        // winds up with an aim telegraph, then fires a fast concussive missile
        const nx = d > 0.001 ? dx / d : 0;
        const ny = d > 0.001 ? dy / d : 0;

        if (this.aiming) {
            // Windup / aim phase: stay put and wait
            if (now >= this.aimUntil) {
                // FIRE: launch fast missile locked on target's current position
                this.aiming = false;
                this.fireReady = now + this.fireCooldown;
                const ax = Math.cos(this.aimAngle);
                const ay = Math.sin(this.aimAngle);
                GAME_STATE.enemyProjectiles.push(new MarauderMissile(
                    this.x, this.y,
                    ax * this.shotSpeed,
                    ay * this.shotSpeed,
                    this.shotDamage,
                    this
                ));
                SoundEngine.rocketLaunch();
            }
            // Stay stationary while aiming
            return;
        }

        // --- Chase phase: move toward target ---
        if (d > this.firingRange || !isOnPlayableArea(this)) {
            this.x += nx * this.getSpeed(now) * dtFactor;
            this.y += ny * this.getSpeed(now) * dtFactor;
        }

        // Clamp to screen
        this.x = Math.max(-30, Math.min(W + 30, this.x));
        this.y = Math.max(-30, Math.min(H + 30, this.y));

        // --- Enter aim windup when in range and cooldown elapsed ---
        if (d <= this.firingRange && now >= this.fireReady && isOnPlayableArea(this)) {
            this.aiming = true;
            this.aimAngle = Math.atan2(target.y - this.y, target.x - this.x);
            const warnMult = GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0;
            this.aimDuration = 650 * warnMult;
            this.aimUntil = now + this.aimDuration; // aim telegraph scaled by difficulty
        }

        // --- Melee contact damage as fallback ---
        const targetIsMine = target instanceof PlayerMine;
        const cdx = target.x - this.x, cdy = target.y - this.y;
        if (!targetIsMine && typeof target.takeDamage === 'function' && cdx * cdx + cdy * cdy < (target.r + this.r) * (target.r + this.r)) {
            target.takeDamage(this.damage, now, this, true);
        }
        this.checkTurretContact(now);
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (this.updateKnockbackAirborne(now)) return;
        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x, dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        this.updateMarauder(dtFactor, now, target, d, dx, dy);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'marauder') {
            ctx.save();

            // --- Aim telegraph: pulsing orange warning ring + direction line ---
            if (this.aiming) {
                const aimProgress = Math.max(0, 1 - (this.aimUntil - now) / (this.aimDuration || 650));
                const ringAlpha = 0.25 + 0.55 * Math.abs(Math.sin(now / 60));
                ctx.globalAlpha = ringAlpha;
                ctx.strokeStyle = '#ff6600';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.r + 10 + aimProgress * 12, 0, Math.PI * 2);
                ctx.stroke();

                // Targeting line in aim direction
                ctx.globalAlpha = 0.55 * aimProgress;
                ctx.strokeStyle = '#ffcc00';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 5]);
                ctx.beginPath();
                ctx.moveTo(this.x + Math.cos(this.aimAngle) * (this.r + 8),
                           this.y + Math.sin(this.aimAngle) * (this.r + 8));
                ctx.lineTo(this.x + Math.cos(this.aimAngle) * 200,
                           this.y + Math.sin(this.aimAngle) * 200);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalAlpha = 1.0;
            }

            // Body glow (dark teal hint)
            ctx.globalAlpha = 0.30;
            ctx.fillStyle = '#546e7a';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r + 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // Main armored body
            ctx.fillStyle = '#37474f';
            ctx.strokeStyle = '#263238';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Chest plate (lighter grey panel)
            ctx.fillStyle = '#546e7a';
            ctx.beginPath();
            ctx.arc(this.x, this.y - 2, this.r * 0.65, 0, Math.PI);
            ctx.fill();

            // Visor / eye strip (orange)
            ctx.fillStyle = this.aiming ? '#ff6600' : '#ff8c00';
            ctx.fillRect(this.x - this.r * 0.55, this.y - 5, this.r * 1.1, 4);

            // Left shoulder pad
            ctx.fillStyle = '#455a64';
            ctx.strokeStyle = '#263238';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(this.x - this.r - 2, this.y - 3, 7, 5, -0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Right shoulder pad
            ctx.beginPath();
            ctx.ellipse(this.x + this.r + 2, this.y - 3, 7, 5, 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class StalkerEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.stalker : 50;
        super(x, y, 'stalker', now, 14, 200, 1.5, 25, '#7e22ce', xp);
        this.blinkRange = 300;
        this.blinkLandDist = 50 * (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0);
        this.blinked = false;
        this.blinkCooldown = 5000;
        this.nextBlinkReady = now + 800;
        this.blinkFlashUntil = 0;
        this.blinkPauseUntil = 0;
    }

    updateStalker(dtFactor, now, target, d, dx, dy) {
        // SC2 Blink Stalker: advances toward target; when within blinkRange, blinks
        // past the fire ring orbit to just outside melee contact range, then walks in.
        const nx = d > 0.001 ? dx / d : 0;
        const ny = d > 0.001 ? dy / d : 0;

        // Blink trigger: within marauder range AND cooldown elapsed AND not already inside
        if (d <= this.blinkRange && d > this.blinkLandDist + 5 && now >= this.nextBlinkReady) {
            // Teleport to blinkLandDist from target
            this.x = target.x - nx * this.blinkLandDist;
            this.y = target.y - ny * this.blinkLandDist;
            this.nextBlinkReady = now + this.blinkCooldown;
            this.blinkFlashUntil = now + 350; // brief visual flash
            const difficultyMultiplier = GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0;
            this.blinkPauseUntil = now + 300 * difficultyMultiplier; // post-blink movement pause scaled by difficulty
            SoundEngine.stalkerBlink();
            // Recalculate d after blink
            const bdx = target.x - this.x, bdy = target.y - this.y;
            d = Math.sqrt(bdx * bdx + bdy * bdy);
        }

        // Standard chase movement (walk toward player after 0.3s post-blink pause)
        if (d > this.r + target.r && now >= (this.blinkPauseUntil || 0)) {
            this.x += nx * this.getSpeed(now) * dtFactor;
            this.y += ny * this.getSpeed(now) * dtFactor;
        }

        this.x = Math.max(-30, Math.min(W + 30, this.x));
        this.y = Math.max(-30, Math.min(H + 30, this.y));

        // Contact damage
        const targetIsMine = target instanceof PlayerMine;
        const cdx = target.x - this.x, cdy = target.y - this.y;
        const cd = Math.sqrt(cdx * cdx + cdy * cdy);
        if (!targetIsMine && typeof target.takeDamage === 'function' && cd < target.r + this.r) {
            target.takeDamage(this.damage, now, this, true);
        }
        this.checkTurretContact(now);
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (this.updateKnockbackAirborne(now)) return;
        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x, dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        this.updateStalker(dtFactor, now, target, d, dx, dy);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'stalker') {
            ctx.save();

            // Blink flash: bright void purple afterimage that fades out
            if (this.blinkFlashUntil && now < this.blinkFlashUntil) {
                const flashFrac = (this.blinkFlashUntil - now) / 350;
                ctx.globalAlpha = flashFrac * 0.85;
                ctx.fillStyle = '#e9d5ff';
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.r + 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }

            // Outer glow (deep void purple)
            ctx.globalAlpha = 0.28;
            ctx.fillStyle = '#7e22ce';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r + 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // 4 Angular Mechanical Quadruped Strider Legs (purple crystal striders)
            ctx.strokeStyle = '#581c87';
            ctx.lineWidth = 2.5;
            for (let j = 0; j < 4; j++) {
                const legBaseAngle = (j / 4) * Math.PI * 2 + Math.PI * 0.25;
                const lx1 = this.x + Math.cos(legBaseAngle) * (this.r * 0.7);
                const ly1 = this.y + Math.sin(legBaseAngle) * (this.r * 0.7);
                const kneeX = this.x + Math.cos(legBaseAngle) * (this.r + 6);
                const kneeY = this.y + Math.sin(legBaseAngle) * (this.r + 6) - 3;
                const footX = this.x + Math.cos(legBaseAngle) * (this.r + 10);
                const footY = this.y + Math.sin(legBaseAngle) * (this.r + 10) + 4;

                ctx.beginPath();
                ctx.moveTo(lx1, ly1);
                ctx.lineTo(kneeX, kneeY);
                ctx.lineTo(footX, footY);
                ctx.stroke();

                // Knee joint cap (bright purple crystal dot)
                ctx.fillStyle = '#c084fc';
                ctx.beginPath();
                ctx.arc(kneeX, kneeY, 2.2, 0, Math.PI * 2);
                ctx.fill();
            }

            // Main body — vibrant void purple Protoss carapace
            ctx.fillStyle = '#4c1d95';
            ctx.strokeStyle = '#2e1065';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Angular upper carapace plate (amethyst violet plate)
            ctx.fillStyle = '#6b21a8';
            ctx.strokeStyle = '#a855f7';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(this.x - this.r * 0.7, this.y - 2);
            ctx.lineTo(this.x, this.y - this.r * 0.85);
            ctx.lineTo(this.x + this.r * 0.7, this.y - 2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Glowing crystal core (pulsing void purple)
            const corePulse = 0.7 + 0.3 * Math.abs(Math.sin(now / 200));
            // Fast glow: translucent halo pass instead of expensive shadowBlur
            ctx.fillStyle = '#a855f7';
            ctx.globalAlpha = 0.35 * corePulse;
            ctx.beginPath();
            ctx.arc(this.x, this.y + 2, this.r * 0.32 * 1.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.fillStyle = `rgba(168, 85, 247, ${corePulse})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y + 2, this.r * 0.32, 0, Math.PI * 2);
            ctx.fill();

            // Crystal highlight dot
            ctx.fillStyle = '#f3e8ff';
            ctx.beginPath();
            ctx.arc(this.x - 2, this.y, this.r * 0.12, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class ZerglingEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.zergling : 15;
        const speed = 2.7 / ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
        super(x, y, 'zergling', now, 7, 200, speed, 20, '#556b2f', xp);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'zergling') {
            ctx.save();
            // Tiny chitinous body — brownish green with dark swamp carapace
            ctx.fillStyle = '#556b2f';
            ctx.strokeStyle = '#283618';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Muted olive / earthy dorsal highlight
            ctx.fillStyle = '#6b8e23';
            ctx.beginPath();
            ctx.arc(this.x - 1, this.y - 2, this.r * 0.55, 0, Math.PI * 2);
            ctx.fill();

            // Two small claw marks (bone olive)
            ctx.strokeStyle = '#a3b18a';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(this.x - 4, this.y + 1); ctx.lineTo(this.x - 1, this.y + 4);
            ctx.moveTo(this.x - 2, this.y + 1); ctx.lineTo(this.x + 1, this.y + 4);
            ctx.stroke();

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class SpineCrawlerEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.spine_crawler : 200;
        super(x, y, 'spine_crawler', now, 24, 1200, 0.5, 55, '#4e342e', xp);
        this.spawnedZerglings = false;
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'spine_crawler') {
            ctx.save();
            const hpFrac = Math.max(0, this.hp / this.maxHp);

            // 1. Subterranean toxic moss & acid seepage aura
            const auraPulse = 0.14 + 0.08 * Math.abs(Math.sin(now / 350));
            ctx.globalAlpha = auraPulse;
            ctx.fillStyle = '#4d7c0f';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r + 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // 2. 6 Protruding, twitching Zergling scythe talons anchoring into the earth
            ctx.strokeStyle = '#5d4037';
            ctx.lineWidth = 3.2;
            for (let j = 0; j < 6; j++) {
                const twitch = Math.sin(now / 150 + j * 1.4) * 0.10;
                const legAngle = (j / 6) * Math.PI * 2 + twitch;
                const lx1 = this.x + Math.cos(legAngle) * (this.r * 0.65);
                const ly1 = this.y + Math.sin(legAngle) * (this.r * 0.65);
                const lx2 = this.x + Math.cos(legAngle) * (this.r + 13);
                const ly2 = this.y + Math.sin(legAngle) * (this.r + 13);
                const mx = (lx1 + lx2) / 2 + Math.cos(legAngle + Math.PI / 2) * 5;
                const my = (ly1 + ly2) / 2 + Math.sin(legAngle + Math.PI / 2) * 5;

                ctx.beginPath();
                ctx.moveTo(lx1, ly1);
                ctx.lineTo(mx, my);
                ctx.lineTo(lx2, ly2);
                ctx.stroke();

                // Brown-russet keratin talon claw anchor tip
                ctx.fillStyle = '#853812';
                ctx.beginPath();
                ctx.arc(lx2, ly2, 2.6, 0, Math.PI * 2);
                ctx.fill();

                // Small zergling winglet spur at knee
                ctx.fillStyle = '#795548';
                ctx.beginPath();
                ctx.arc(mx, my, 2.0, 0, Math.PI * 2);
                ctx.fill();
            }

            // 3. Underlying deep organic sinew bed
            ctx.fillStyle = '#271406';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * 0.95, 0, Math.PI * 2);
            ctx.fill();

            // 4. Bubbly, Bulbous Aggregate of 7 Bulging Zergling Pods
            const numPods = 7;
            for (let i = 0; i < numPods; i++) {
                const baseAngle = (i / numPods) * Math.PI * 2;
                // Asynchronous bubbling / swelling pulse per pod
                const bubblePulse = Math.sin(now / 140 + i * 1.5) * 2.2;
                const dist = this.r * 0.58 + bubblePulse;
                const bx = this.x + Math.cos(baseAngle) * dist;
                const by = this.y + Math.sin(baseAngle) * dist;
                const br = this.r * 0.44 + Math.sin(now / 200 + i * 2.1) * 1.2;

                // Bulbous brownish green bubble pod dome
                ctx.fillStyle = '#556b2f';
                ctx.strokeStyle = '#283618';
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.arc(bx, by, br, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Earth-bark dorsal carapace shell capping each bubble
                ctx.fillStyle = '#4e342e';
                ctx.beginPath();
                ctx.ellipse(bx - Math.cos(baseAngle) * 2, by - Math.sin(baseAngle) * 2, br * 0.62, br * 0.48, baseAngle, 0, Math.PI * 2);
                ctx.fill();

                // Curled zergling body highlight (brownish-olive)
                ctx.fillStyle = '#6b8e23';
                ctx.beginPath();
                ctx.arc(bx - Math.cos(baseAngle) * 2.5, by - Math.sin(baseAngle) * 2.5, br * 0.38, 0, Math.PI * 2);
                ctx.fill();

                // Visible embryonic zergling claw marks on pod (brown-russet)
                ctx.strokeStyle = '#853812';
                ctx.lineWidth = 1.2;
                const cAng = baseAngle + Math.PI * 0.5;
                const c1x = bx + Math.cos(cAng) * 2, c1y = by + Math.sin(cAng) * 2;
                const c2x = bx - Math.cos(cAng) * 2, c2y = by - Math.sin(cAng) * 2;
                ctx.beginPath();
                ctx.moveTo(c1x - Math.cos(baseAngle) * 2.5, c1y - Math.sin(baseAngle) * 2.5);
                ctx.lineTo(c1x + Math.cos(baseAngle) * 2.5, c1y + Math.sin(baseAngle) * 2.5);
                ctx.moveTo(c2x - Math.cos(baseAngle) * 2.5, c2y - Math.sin(baseAngle) * 2.5);
                ctx.lineTo(c2x + Math.cos(baseAngle) * 2.5, c2y + Math.sin(baseAngle) * 2.5);
                ctx.stroke();

                // Glowing zergling nodule eye on bubble surface
                const eyeX = bx + Math.cos(baseAngle) * (br * 0.55);
                const eyeY = by + Math.sin(baseAngle) * (br * 0.55);
                ctx.fillStyle = hpFrac > 0.4 ? '#853812' : '#c2410c';
                ctx.beginPath();
                ctx.arc(eyeX, eyeY, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }

            // 5. Surface Slime Vesicles / Micro-bubbles along pod seams
            for (let k = 0; k < 5; k++) {
                const va = (k / 5) * Math.PI * 2 + Math.PI * 0.1;
                const vr = 2.8 + Math.sin(now / 110 + k) * 0.8;
                const vx = this.x + Math.cos(va) * (this.r * 0.35);
                const vy = this.y + Math.sin(va) * (this.r * 0.35);
                ctx.fillStyle = '#6b8e23';
                ctx.strokeStyle = '#283618';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(vx, vy, Math.max(1, vr), 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }

            // 6. Central Impaling Spine Tip (Hardened Segmented Brown-Russet Horn)
            ctx.fillStyle = hpFrac > 0.4 ? '#6e3019' : '#c2410c';
            ctx.strokeStyle = '#3d1308';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * 0.36, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Dark brown-russet chitin horn needle core
            ctx.fillStyle = '#853812';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * 0.16, 0, Math.PI * 2);
            ctx.fill();

            // Suture bands binding pods to central spine (rupture when HP < 0.4)
            if (hpFrac < 0.4) {
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 1.2;
                for (let k = 0; k < 4; k++) {
                    const fa = (k / 4) * Math.PI * 2 + now / 250;
                    ctx.beginPath();
                    ctx.moveTo(this.x, this.y);
                    ctx.lineTo(this.x + Math.cos(fa) * (this.r * 0.8), this.y + Math.sin(fa) * (this.r * 0.8));
                    ctx.stroke();
                }
            }

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class SentryEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.sentry : 180;
        super(x, y, 'sentry', now, 15, 1200, 0.5, 30, '#94a3b8', xp);
        this.shieldRadius = 160;
        this.shieldAngle = 0;
        GAME_STATE.activeSentries.push(this);
    }

    updateSentry(dtFactor, now, target, d, dx, dy) {
        // Slow chase toward target, deals contact damage.
        // Shield logic is handled centrally in the main loop (HP snapshot + restore).
        this.shieldAngle += 0.018 * dtFactor; // rotate shield ring visual
        if (d > this.shieldRadius-this.r) {
            const nx = dx / d, ny = dy / d;
            this.x += nx * this.getSpeed(now) * dtFactor;
            this.y += ny * this.getSpeed(now) * dtFactor;
        }
        this.x = Math.max(-30, Math.min(W + 30, this.x));
        this.y = Math.max(-30, Math.min(H + 30, this.y));
        // Contact damage
        const targetIsMine = target instanceof PlayerMine;
        if (!targetIsMine && typeof target.takeDamage === 'function' && d < target.r + this.r) {
            target.takeDamage(this.damage, now, this, true);
        }
        this.checkTurretContact(now);
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (this.updateKnockbackAirborne(now)) return;
        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x, dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        this.updateSentry(dtFactor, now, target, d, dx, dy);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'sentry') {
            ctx.save();

            // Guardian Shield aura — soft, subtle matte platinum dome visible on the ground
            ctx.globalAlpha = 0.020 + 0.008 * Math.abs(Math.sin(now / 800));
            ctx.fillStyle = '#64748b';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.shieldRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 0.06 + 0.02 * Math.abs(Math.sin(now / 800));
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.shieldRadius, 0, Math.PI * 2);
            ctx.stroke();

            // Faint high-tech dashed outer boundary
            ctx.globalAlpha = 0.05;
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 8]);
            ctx.lineDashOffset = -(now / 60);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.shieldRadius - 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1.0;

            // Main body — matte brushed steel chrome casing
            ctx.fillStyle = '#cbd5e1';
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Inner graphite armor trim ring
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * 0.72, 0, Math.PI * 2);
            ctx.stroke();

            // Platinum Crystal Core (matte, non-luminous beryl crystal)
            ctx.fillStyle = '#94a3b8';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * 0.38, 0, Math.PI * 2);
            ctx.fill();

            // 6 rotating orbiting matte steel prisms
            const nodeCount = 6;
            for (let i = 0; i < nodeCount; i++) {
                const a = this.shieldAngle + (i / nodeCount) * Math.PI * 2;
                const nx = this.x + Math.cos(a) * (this.r + 7);
                const ny = this.y + Math.sin(a) * (this.r + 7);
                ctx.fillStyle = '#cbd5e1';
                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(nx, ny, 3.0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class MedivacEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.medivac : 220;
        super(x, y, 'medivac', now, 18, 1800, 0, 0, '#b02b1d', xp);
        this.vx = 0;
        this.vy = 0;
        this.maxSpd = 3.8;
        this.accel = 0.20;
        this.healRange = 200;
        this.healPerTick = 60;
        this.healTickMs = 100;
        this.nextHealTick = 0;
        this.healTargets = [];
    }

    updateMedivac(dtFactor, now) {
        // --- Throttled wounded search pass: only search when heal tick is due or current targets are invalid ---
        const needsSearch = (!this.healTargets || this.healTargets.length === 0 || now >= (this.nextTargetSearch || 0) || this.healTargets.some(t => !t || t.hp <= 0 || t.hp >= t.maxHp));
        
        if (needsSearch) {
            this.nextTargetSearch = now + 100; // Search at 10 Hz instead of 60 Hz
            let wounded1 = null, woundedDist1 = Infinity;
            let wounded2 = null, woundedDist2 = Infinity;
            let closestMonster = null, closestDist = Infinity;
            const range2 = this.healRange * this.healRange;

            for (let i = 0; i < GAME_STATE.enemies.length; i++) {
                const e = GAME_STATE.enemies[i];
                if (e === this || e.type === 'medivac') continue;
                const exdx = e.x - this.x, exdy = e.y - this.y;
                const d2 = exdx * exdx + exdy * exdy;

                // Track closest overall monster for follow-behind
                if (isTargetable(e) && d2 < closestDist) {
                    closestDist = d2;
                    closestMonster = e;
                }

                // Track wounded allies in heal range
                if (e.hp > 0 && e.hp < e.maxHp && d2 <= range2) {
                    if (d2 < woundedDist1) {
                        wounded2 = wounded1;
                        woundedDist2 = woundedDist1;
                        wounded1 = e;
                        woundedDist1 = d2;
                    } else if (d2 < woundedDist2) {
                        wounded2 = e;
                        woundedDist2 = d2;
                    }
                }
            }

            this.healTargets = [];
            if (wounded1) this.healTargets.push(wounded1);
            if (wounded2) this.healTargets.push(wounded2);
            this.cachedClosestMonster = closestMonster;
            this.cachedClosestDist = closestDist;
        }

        if (this.healTargets && this.healTargets.length > 0) {
            // Stand still — decelerate smoothly
            this.vx *= Math.pow(0.85, dtFactor);
            this.vy *= Math.pow(0.85, dtFactor);
            // Heal tick: apply to all active targets
            if (now >= this.nextHealTick) {
                this.nextHealTick = now + this.healTickMs;
                if (typeof SoundEngine !== 'undefined' && SoundEngine.medivacHeal) {
                    SoundEngine.medivacHeal();
                }
                for (let ti = 0; ti < this.healTargets.length; ti++) {
                    const t = this.healTargets[ti];
                    const scaleMult = 1 / (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0);
                    t.hp = Math.min(t.maxHp, t.hp + this.healPerTick * scaleMult);
                    if (Math.random() < 0.45) {
                        const a = Math.random() * Math.PI * 2;
                        GAME_STATE.particles.push(new Particle(
                            t.x + Math.cos(a) * t.r * 0.5,
                            t.y + Math.sin(a) * t.r * 0.5,
                            Math.cos(a) * 0.3, -0.7 - Math.random() * 0.5,
                            '#b02b1d', 350 + Math.random() * 150
                        ));
                    }
                }
            }
        } else if (this.cachedClosestMonster && this.cachedClosestMonster.hp > 0) {
            const closestMonster = this.cachedClosestMonster;
            const exdx = closestMonster.x - this.x, exdy = closestMonster.y - this.y;
            const d2 = exdx * exdx + exdy * exdy;
            const ed = Math.sqrt(d2);
            const nx = ed > 0.001 ? exdx / ed : 0;
            const ny = ed > 0.001 ? exdy / ed : 0;
            const followDist = closestMonster.r + this.r + 15;
            if (ed < followDist) {
                this.vx *= Math.pow(0.88, dtFactor);
                this.vy *= Math.pow(0.88, dtFactor);
            } else {
                const isFrozen = (this.isPhase2Unit() && now < this.frozenUntil);
                const effAccel = isFrozen ? this.accel * 0.5 : this.accel;
                const effMaxSpd = isFrozen ? this.maxSpd * 0.5 : this.maxSpd;
                this.vx += nx * effAccel * dtFactor;
                this.vy += ny * effAccel * dtFactor;
                const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                if (spd > effMaxSpd) {
                    this.vx = (this.vx / spd) * effMaxSpd;
                    this.vy = (this.vy / spd) * effMaxSpd;
                }
            }
        } else {
            // No monsters anywhere — idle friction
            this.vx *= Math.pow(0.95, dtFactor);
            this.vy *= Math.pow(0.95, dtFactor);
        }

        this.x += this.vx * dtFactor;
        this.y += this.vy * dtFactor;
        this.x = Math.max(20, Math.min(W - 20, this.x));
        this.y = Math.max(20, Math.min(H - 20, this.y));
        // Medivac does 0 damage — no contact handling
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (this.updateKnockbackAirborne(now)) return;
        this.updateMedivac(dtFactor, now);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'medivac') {
            ctx.save();

            // 1. Biological Latching Tentacles & Rejuvenating Liquid Pumping (Glowing Vermilion Nectar)
            const isHealing = this.healTargets && this.healTargets.length > 0;
            if (isHealing) {
                for (let bi = 0; bi < this.healTargets.length; bi++) {
                    const ht = this.healTargets[bi];
                    if (!ht || ht.hp <= 0 || ht.hp >= ht.maxHp) continue;
                    const tx = ht.x, ty = ht.y;
                    const startX = this.x;
                    const startY = this.y + this.r * 0.4;

                    // Dynamic organic tentacle curve reaching down to target
                    const dx = tx - startX;
                    const dy = ty - startY;
                    const dist = Math.hypot(dx, dy);
                    const normX = dist > 0.001 ? dx / dist : 0;
                    const normY = dist > 0.001 ? dy / dist : 1;
                    const perpX = -normY;
                    const perpY = normX;
                    const sway = Math.sin(now / 110 + bi * 1.5) * Math.min(18, dist * 0.15);
                    const cpX = (startX + tx) / 2 + perpX * sway;
                    const cpY = (startY + ty) / 2 + perpY * sway;

                    // Thick muscular tentacle outer sheath (Deep Dark Visceral Sinew)
                    ctx.strokeStyle = '#2e0906';
                    ctx.lineWidth = 4.4;
                    ctx.beginPath();
                    ctx.moveTo(startX, startY);
                    ctx.quadraticCurveTo(cpX, cpY, tx, ty);
                    ctx.stroke();

                    // Inner translucent bio-fluid conduit (Darkened Vermilion Sinew)
                    ctx.strokeStyle = '#66150a';
                    ctx.lineWidth = 2.4;
                    ctx.beginPath();
                    ctx.moveTo(startX, startY);
                    ctx.quadraticCurveTo(cpX, cpY, tx, ty);
                    ctx.stroke();

                    // Pumping Boluses of Rejuvenating Liquid travelling rapidly down the tentacle
                    const numBoluses = 4;
                    for (let b = 0; b < numBoluses; b++) {
                        const prog = ((now / 320) + (b / numBoluses) + bi * 0.25) % 1.0;
                        const t = prog;
                        const it = 1 - t;
                        const bx = it * it * startX + 2 * it * t * cpX + t * t * tx;
                        const by = it * it * startY + 2 * it * t * cpY + t * t * ty;
                        const bolusRadius = 2.8 + 1.2 * Math.sin(prog * Math.PI);

                        // Liquid bolus glow & core (Darkened Blood-Vermilion)
                        ctx.fillStyle = '#b02b1d';
                        ctx.strokeStyle = '#c2410c';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.arc(bx, by, bolusRadius, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                    }

                    // Latching Suction Collar & Gripping Claws on Target Body
                    ctx.fillStyle = '#220604';
                    ctx.strokeStyle = '#360b07';
                    ctx.lineWidth = 1.8;
                    ctx.beginPath();
                    ctx.arc(tx, ty, ht.r * 0.45 + 3, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();

                    // Injection point at center of latch
                    ctx.fillStyle = '#b02b1d';
                    ctx.beginPath();
                    ctx.arc(tx, ty, ht.r * 0.25, 0, Math.PI * 2);
                    ctx.fill();

                    // Restorative mist & splash ripples around latch site
                    const rippleRad = (ht.r + 4) * (0.6 + 0.4 * Math.sin(now / 140 + bi));
                    ctx.strokeStyle = '#b02b1d';
                    ctx.lineWidth = 1.2;
                    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now / 120 + bi);
                    ctx.beginPath();
                    ctx.arc(tx, ty, rippleRad, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            }

            // 2. Meaty Blood-Russet Multi-Lobed Body & Visceral Sinew
            // Underlying deep organic sinew bed
            ctx.fillStyle = '#270d0b';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * 0.95, 0, Math.PI * 2);
            ctx.fill();

            // 6 Interconnected Pulsating Fleshy Muscle Lobes
            const numLobes = 6;
            for (let i = 0; i < numLobes; i++) {
                const la = (i / numLobes) * Math.PI * 2 + now / 500;
                const lPulse = Math.sin(now / 130 + i * 1.4) * 1.8;
                const lx = this.x + Math.cos(la) * (this.r * 0.44 + lPulse);
                const ly = this.y + Math.sin(la) * (this.r * 0.38 + lPulse);
                const lr = this.r * 0.46 + Math.sin(now / 160 + i * 2.1) * 1.0;

                // Fleshy blood-russet muscle dome
                ctx.fillStyle = '#882519';
                ctx.strokeStyle = '#3d0e0b';
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                ctx.arc(lx, ly, lr, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Fleshy dorsal muscle highlight (flame-russet)
                ctx.fillStyle = '#b02b1d';
                ctx.beginPath();
                ctx.arc(lx - Math.cos(la) * 1.8, ly - Math.sin(la) * 1.8, lr * 0.42, 0, Math.PI * 2);
                ctx.fill();
            }

            // Central Translucent Rejuvenating Liquid Reservoir Belly
            const liquidPulse = isHealing ? 65 : 180;
            const liquidScale = 0.55 + 0.12 * Math.abs(Math.sin(now / liquidPulse));
            const liquidYOffset = this.y + this.r * 0.10;

            ctx.fillStyle = isHealing ? 'rgba(236, 78, 40, 0.79)' : 'rgba(207, 51, 25, 0.58)';
            ctx.strokeStyle = '#882519';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.ellipse(this.x, liquidYOffset, this.r * liquidScale * 1.1, this.r * liquidScale * 0.85, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Swirling internal restorative liquid vesicles / bubbles (vermilion droplets)
            for (let k = 0; k < 4; k++) {
                const va = (now / (isHealing ? 140 : 260)) + k * (Math.PI * 2 / 4);
                const vDistX = this.r * 0.36 * (0.8 + 0.2 * Math.sin(now / 200 + k));
                const vDistY = this.r * 0.28 * (0.8 + 0.2 * Math.cos(now / 200 + k));
                const vx = this.x + Math.cos(va) * vDistX;
                const vy = liquidYOffset + Math.sin(va) * vDistY;
                ctx.fillStyle = '#fcaf8c';
                ctx.beginPath();
                ctx.arc(vx, vy, 2.0, 0, Math.PI * 2);
                ctx.fill();
            }

            // Visceral Meaty Sinew Strands crossing across lobes
            ctx.strokeStyle = '#5b1e18';
            ctx.lineWidth = 1.4;
            for (let s = 0; s < 3; s++) {
                const sa = (s / 3) * Math.PI + now / 600;
                ctx.beginPath();
                ctx.moveTo(this.x + Math.cos(sa) * (this.r * 0.7), this.y + Math.sin(sa) * (this.r * 0.7));
                ctx.quadraticCurveTo(this.x, this.y, this.x - Math.cos(sa) * (this.r * 0.7), this.y - Math.sin(sa) * (this.r * 0.7));
                ctx.stroke();
            }

            // 3. Sensory Amoebic Eyes embedded in fleshy orbital folds
            let eyeLookAngle = Math.PI / 2;
            if (isHealing && this.healTargets[0]) {
                eyeLookAngle = Math.atan2(this.healTargets[0].y - this.y, this.healTargets[0].x - this.x);
            } else if (Math.hypot(this.vx, this.vy) > 0.1) {
                eyeLookAngle = Math.atan2(this.vy, this.vx);
            }

            const eyeY = this.y - this.r * 0.22;
            for (const side of [-1, 1]) {
                const ex = this.x + side * (this.r * 0.44);
                // Deep fleshy orbital socket
                ctx.fillStyle = '#270d0b';
                ctx.beginPath();
                ctx.ellipse(ex, eyeY, 3.8, 4.2, 0, 0, Math.PI * 2);
                ctx.fill();

                // Warm vermilion sensory cornea
                const pupilX = ex + Math.cos(eyeLookAngle) * 1.5;
                const pupilY = eyeY + Math.sin(eyeLookAngle) * 1.5;
                ctx.fillStyle = '#f45b2d';
                ctx.beginPath();
                ctx.arc(pupilX, pupilY, 2.0, 0, Math.PI * 2);
                ctx.fill();

                // Glint highlight
                ctx.fillStyle = '#fedccd';
                ctx.beginPath();
                ctx.arc(pupilX - 0.6, pupilY - 0.6, 0.7, 0, Math.PI * 2);
                ctx.fill();
            }

            // Fleshy blood-russet pseudopod ripples when idling (tucked in when healing)
            if (!isHealing) {
                for (let k = 0; k < 3; k++) {
                    const px = this.x + (k - 1) * (this.r * 0.45);
                    const py = this.y + this.r * 0.85;
                    const pWave = Math.sin(now / 140 + k * 1.4) * 3;
                    ctx.fillStyle = '#882519';
                    ctx.strokeStyle = '#3d0e0b';
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.arc(px + pWave * 0.5, py + 2, 2.8, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
            }

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class WarpAnomalyEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.warp_anomaly : 300;
        super(x, y, 'warp_anomaly', now, 18, 2000, 0.55, 50, 'transparent', xp);
        this.invisible = true;
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'warp_anomaly') {
            ctx.save();
            const lensR = this.r * 4.2; // visual warping area is much larger than hitbox (r=18 * 4.2 ≈ 75px)

            // Optical Magnification Lens on underlying canvas (grid, terrain, hazards, floor)
            if (ctx.canvas && this.x >= -lensR && this.x <= W + lensR && this.y >= -lensR && this.y <= H + lensR) {
                const srcR = lensR * 0.65; // 1.54x optical zoom
                const sx = Math.max(0, Math.min(W - srcR * 2, this.x - srcR));
                const sy = Math.max(0, Math.min(H - srcR * 2, this.y - srcR));
                const sw = Math.min(W - sx, srcR * 2);
                const sh = Math.min(H - sy, srcR * 2);

                ctx.save();
                ctx.beginPath();
                ctx.arc(this.x, this.y, lensR, 0, Math.PI * 2);
                ctx.clip();
                try {
                    ctx.drawImage(
                        ctx.canvas,
                        sx, sy, sw, sh,
                        this.x - lensR, this.y - lensR, lensR * 2, lensR * 2
                    );
                } catch (e) {}
                ctx.restore();
            }

            // Transparent lens refraction gradient with very subtle edge tint
            const grad = ctx.createRadialGradient(this.x, this.y, lensR * 0.45, this.x, this.y, lensR);
            grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.0)');
            grad.addColorStop(0.7, 'rgba(100, 220, 255, 0.02)');
            grad.addColorStop(0.92, 'rgba(180, 100, 255, 0.06)');
            grad.addColorStop(1.0, 'rgba(0, 229, 255, 0.09)');

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(this.x, this.y, lensR, 0, Math.PI * 2);
            ctx.fill();

            // Very faint distortion boundary ripple
            const ripple = lensR + Math.sin(now / 140) * 2.5;
            ctx.strokeStyle = 'rgba(140, 230, 255, 0.10)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, Math.max(2, ripple), 0, Math.PI * 2);
            ctx.stroke();

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class HellionEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.hellion : 150;
        super(x, y, 'hellion', now, 16, 1000, 2.2, 70, '#c2410c', xp);
        this.targetCoord = null;
        this.nextDecisionTime = 0;
        this.action = 'move';
        this.aiming = false;
        this.aimUntil = 0;
        this.aimAngle = 0;
        this.fireReady = now + 800;
        this.fireCooldown = 1800;
        this.shotDamage = 70;
        this.shotSpeed = 9.0;
    }

    updateHellion(dtFactor, now, target, d, dx, dy) {
        if (!target) return;

        // --- 1. Committed Firing State: once decided to fire, cannot flee or change mind until complete ---
        if (this.aiming) {
            if (now >= this.aimUntil) {
                // FIRE! Straight line of fire (180px range)
                this.aiming = false;
                this.fireReady = now + this.fireCooldown;
                SoundEngine.hellionFlame();
                const fireLen = 180;
                const endX = this.x + Math.cos(this.aimAngle) * fireLen;
                const endY = this.y + Math.sin(this.aimAngle) * fireLen;
                this.flameLine = { x1: this.x, y1: this.y, x2: endX, y2: endY };
                this.flameBeamUntil = now + 300;

                // Instant damage to all players in line of fire
                for (const p of GAME_STATE.players) {
                    if (!p.alive || p.isOnIce()) continue;
                    if (pointToSegmentDistance(p.x, p.y, this.x, this.y, endX, endY) <= p.r + 16) {
                        p.takeDamage(this.damage, now, this, true);
                        spawnHitParticles(p.x, p.y, '#ff5722');
                    }
                }
                // Instant damage to turrets in line of fire
                for (const t of GAME_STATE.turrets) {
                    if (!t.alive) continue;
                    if (pointToSegmentDistance(t.x, t.y, this.x, this.y, endX, endY) <= t.r + 16) {
                        t.takeDamage(this.damage, now, this);
                    }
                }
            }
            // Stay put while aiming telegraph runs; cannot flee
            return;
        }

        // --- 2. Decision interval: re-evaluate decision every 0.4s (400ms) ---
        if (now >= this.nextDecisionTime) {
            this.nextDecisionTime = now + 400; // 0.4s

            if (d < 95) {
                // Too close (inside/near fire ring): Flee!
                this.action = 'flee';
            } else if (d <= 180 && now >= this.fireReady) {
                // Safe distance & in attack range (<= 180px): Decide to Fire!
                this.action = 'fire';
                this.aiming = true;
                const warnMult = GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0;
                this.aimDuration = 400 * warnMult;
                this.aimUntil = now + this.aimDuration; // windup scaled by difficulty
                this.aimAngle = Math.atan2(target.y - this.y, target.x - this.x);
                return; // start aiming immediately
            } else {
                // Safe distance but not firing: Reposition!
                this.action = 'move';
                const angle = Math.random() * Math.PI * 2;
                const dist = 110 + Math.random() * 70; // 110px to 180px from player (outside fire ring)
                let tx = target.x + Math.cos(angle) * dist;
                let ty = target.y + Math.sin(angle) * dist;
                tx = Math.max(30, Math.min(W - 30, tx));
                ty = Math.max(30, Math.min(H - 30, ty));
                this.targetCoord = { x: tx, y: ty };
            }
        }

        // --- 3. Execute movement based on decision ---
        if (this.action === 'flee' || d < 95) {
            if (d > 0.001) {
                const awayX = -dx / d;
                const awayY = -dy / d;
                const spd = this.getSpeed(now);
                this.x += awayX * spd * dtFactor;
                this.y += awayY * spd * dtFactor;
            }
        } else if (this.action === 'move' && this.targetCoord) {
            const tdx = this.targetCoord.x - this.x;
            const tdy = this.targetCoord.y - this.y;
            const td = Math.hypot(tdx, tdy);
            if (td > 5) {
                const spd = this.getSpeed(now);
                this.x += (tdx / td) * spd * dtFactor;
                this.y += (tdy / td) * spd * dtFactor;
            }
        }

        this.x = Math.max(-30, Math.min(W + 30, this.x));
        this.y = Math.max(-30, Math.min(H + 30, this.y));

        // Melee contact damage fallback
        const targetIsMine = target instanceof PlayerMine;
        if (!targetIsMine && typeof target.takeDamage === 'function' && d < target.r + this.r) {
            target.takeDamage(this.damage, now, this, true);
        }
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (this.updateKnockbackAirborne(now)) return;
        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x, dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        this.updateHellion(dtFactor, now, target, d, dx, dy);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'hellion') {
            ctx.save();

            // Aiming / Telegraph line (0.4s windup)
            if (this.aiming) {
                const aimLen = 180;
                const ax = this.x + Math.cos(this.aimAngle) * aimLen;
                const ay = this.y + Math.sin(this.aimAngle) * aimLen;

                // Soft translucent red/orange threat beam telegraph
                const pulse = 0.5 + 0.5 * Math.abs(Math.sin(now / 70));
                ctx.strokeStyle = `rgba(194, 65, 12, ${pulse * 0.30})`;
                ctx.lineWidth = 16;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(ax, ay);
                ctx.stroke();

                ctx.globalAlpha = 0.4;
                ctx.strokeStyle = '#fdba74';
                ctx.lineWidth = 1.2;
                ctx.setLineDash([8, 6]);
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(ax, ay);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalAlpha = 1.0;
            }

            // Firing flame beam visual (subdued, less luminous)
            if (this.flameBeamUntil && now < this.flameBeamUntil && this.flameLine) {
                const frac = (this.flameBeamUntil - now) / 300;
                const fl = this.flameLine;

                // Outer flame aura
                ctx.globalAlpha = frac * 0.30;
                ctx.strokeStyle = '#c2410c';
                ctx.lineWidth = 30;
                ctx.beginPath();
                ctx.moveTo(fl.x1, fl.y1);
                ctx.lineTo(fl.x2, fl.y2);
                ctx.stroke();

                // Core flame
                ctx.globalAlpha = frac * 0.45;
                ctx.strokeStyle = '#ea580c';
                ctx.lineWidth = 14;
                ctx.beginPath();
                ctx.moveTo(fl.x1, fl.y1);
                ctx.lineTo(fl.x2, fl.y2);
                ctx.stroke();

                // Center line
                ctx.globalAlpha = frac * 0.50;
                ctx.strokeStyle = '#fed7aa';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(fl.x1, fl.y1);
                ctx.lineTo(fl.x2, fl.y2);
                ctx.stroke();

                ctx.globalAlpha = 1.0;
            }

            // Ring-shaped monster body
            ctx.save();
            ctx.translate(this.x, this.y);

            // Outer ring border & filled body (rich burnt ember terracotta)
            ctx.fillStyle = '#c2410c';
            ctx.strokeStyle = '#7c2d12';
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.arc(0, 0, this.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Inner flame core (warm amber rather than glaring yellow)
            const corePulse = 0.50 + 0.25 * Math.abs(Math.sin(now / 180));
            ctx.globalAlpha = corePulse;
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.arc(0, 0, this.r * 0.45, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // Directional nozzle indicator on ring
            const facingAngle = this.aiming ? this.aimAngle : (this.targetCoord ? Math.atan2(this.targetCoord.y - this.y, this.targetCoord.x - this.x) : 0);
            ctx.rotate(facingAngle);
            ctx.fillStyle = '#7c2d12';
            ctx.beginPath();
            ctx.arc(this.r * 0.75, 0, 3.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class ShieldBearerEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.shield_bearer : 350;
        super(x, y, 'shield_bearer', now, 28, 3500, 0.70, 50, '#92400e', xp);
        this.facingAngle = 0;
        this.shieldRadius = 100;
        this.shieldHalfArc = Math.PI * 0.5;
        GAME_STATE.shieldBearers.push(this);
    }

    updateShieldBearer(dtFactor, now, target, d, dx, dy) {
        if (target) {
            this.facingAngle = Math.atan2(dy, dx);
        }

        // Check if any alive player is in contact with the shield arc or tips
        let playerTouchingShield = false;
        const sR = this.shieldRadius || 100;
        const sArc = this.shieldHalfArc || Math.PI * 0.5;

        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const pdx = p.x - this.x, pdy = p.y - this.y;
            const pdist = Math.hypot(pdx, pdy);

            // 1. Tip contact
            for (const side of [-1, 1]) {
                const tipAngle = this.facingAngle + side * sArc;
                const tx = this.x + Math.cos(tipAngle) * sR;
                const ty = this.y + Math.sin(tipAngle) * sR;
                const maxTipDist = p.r + 9;
                const dxTip = p.x - tx, dyTip = p.y - ty;
                if (dxTip * dxTip + dyTip * dyTip <= maxTipDist * maxTipDist) {
                    playerTouchingShield = true;
                    break;
                }
            }
            if (playerTouchingShield) break;

            // 2. Arc wall contact
            if (pdist > 0.001) {
                const angleToPlayer = Math.atan2(pdy, pdx);
                let angleDiff = Math.abs(angleToPlayer - this.facingAngle);
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                angleDiff = Math.abs(angleDiff);

                if (angleDiff <= sArc) {
                    if (Math.abs(pdist - sR) <= p.r + 7) {
                        playerTouchingShield = true;
                        break;
                    }
                }
            }
        }

        // Stop walking when the player is in contact with the shield
        if (!playerTouchingShield && d > 0.001) {
            const currentSpeed = this.getSpeed(now);
            this.x += (dx / d) * currentSpeed * dtFactor;
            this.y += (dy / d) * currentSpeed * dtFactor;
        }

        // Melee contact damage if player touches the bearer's body
        const targetIsMine = target instanceof PlayerMine;
        if (!targetIsMine && typeof target.takeDamage === 'function' && d < target.r + this.r) {
            target.takeDamage(this.damage, now, this, true);
        }

        // Turret damage
        for (const t of GAME_STATE.turrets) {
            if (!t.alive) continue;
            const tdx = t.x - this.x, tdy = t.y - this.y;
            if (tdx * tdx + tdy * tdy < (t.r + this.r) * (t.r + this.r)) {
                t.takeDamage(this.damage, now, this);
            }
        }
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (this.updateKnockbackAirborne(now)) return;
        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x, dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        this.updateShieldBearer(dtFactor, now, target, d, dx, dy);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'shield_bearer') {
            ctx.save();
            const facing = this.facingAngle || 0;
            const sR = this.shieldRadius || 100;
            const sArc = this.shieldHalfArc || Math.PI * 0.5;

            // 1. Heavy Armored Body (dark tungsten/iron armor)
            ctx.fillStyle = '#171717';
            ctx.strokeStyle = '#78350f';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Inner core reactor (dark amber bronze)
            ctx.fillStyle = '#92400e';
            ctx.beginPath();
            ctx.arc(this.x, this.y, 8, 0, Math.PI * 2);
            ctx.fill();

            // 2. Half-Circle Frontal Energy Shield Field (dark translucent amber-bronze barrier)
            ctx.fillStyle = 'rgba(120, 53, 15, 0.045)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, sR, facing - sArc, facing + sArc);
            ctx.lineTo(this.x, this.y);
            ctx.closePath();
            ctx.fill();

            // 3. Half-Circle Curved Shield Arc (dark matte burnt-amber barrier)
            // Fast dual-stroke glow: wide translucent pass instead of expensive shadowBlur
            ctx.strokeStyle = '#78350f';
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(this.x, this.y, sR, facing - sArc, facing + sArc);
            ctx.stroke();
            ctx.strokeStyle = '#92400e';
            ctx.globalAlpha = 1;
            ctx.lineWidth = 4.5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, sR, facing - sArc, facing + sArc);
            ctx.stroke();

            // Inner subtle bronze accent stripe
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, sR, facing - sArc * 0.96, facing + sArc * 0.96);
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            // Heavy metallic emitter brackets at the shield tips
            ctx.fillStyle = '#1c1917';
            ctx.strokeStyle = '#78350f';
            ctx.lineWidth = 1.5;
            for (const side of [-1, 1]) {
                const tipAngle = facing + side * sArc;
                const tx = this.x + Math.cos(tipAngle) * sR;
                const ty = this.y + Math.sin(tipAngle) * sR;
                ctx.beginPath();
                ctx.arc(tx, ty, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class ViperEnemy extends Enemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.viper : 400;
        super(x, y, 'viper', now, 32, 3500, 0.85, 15, '#dc2626', xp);
        this.vx = 0;
        this.vy = 0;
        this.accel = 0.22;
        this.maxSpd = 2.2;
        this.airborne = false;
        this.viperState = 'following';
        this.followUntil = now + 1200 + Math.random() * 1800;
        this.shootTongueAt = 0;
        this.tongueRange = 1500;
        this.tongueSpeed = 11.0;
        this.heldPlayer = null;
        this.isDraggingPlayer = false;
        this.tongueActive = false;
        this.tongueTipX = this.x;
        this.tongueTipY = this.y;
        this.tongueTargetX = 0;
        this.tongueAimAngle = 0;
        this.tongueAimWarning = false;
        this.tongueAimTargetX = 0;
        this.tongueAimTargetY = 0;
    }

    updateViper(dtFactor, now, target, d, dx, dy) {
        // --- State 1: Holding / Dragging Player ---
        if (this.viperState === 'holding' || this.heldPlayer) {
            // Check if player is still alive and held by THIS viper
            if (!this.heldPlayer || !this.heldPlayer.alive || this.heldPlayer.viperGrabber !== this) {
                this.heldPlayer = null;
                this.isDraggingPlayer = false;
                this.tongueActive = false;
                // Transition back to following player for a random duration (max 3s)!
                this.viperState = 'following';
                this.followUntil = now + 1200 + Math.random() * 1800;
            } else {
                const pdx = this.x - this.heldPlayer.x;
                const pdy = this.y - this.heldPlayer.y;
                const pdist = Math.hypot(pdx, pdy);
                const holdDist = this.r + this.heldPlayer.r + 6;

                if (this.isDraggingPlayer) {
                    // Quickly drag the player in!
                    const dragSpeed = 13.5 * dtFactor;
                    if (pdist <= holdDist || pdist <= dragSpeed) {
                        // Arrived! Lock into pinned hold
                        this.isDraggingPlayer = false;
                        const nx = pdist > 0.001 ? pdx / pdist : 1;
                        const ny = pdist > 0.001 ? pdy / pdist : 0;
                        this.heldPlayer.x = this.x - nx * holdDist;
                        this.heldPlayer.y = this.y - ny * holdDist;
                    } else {
                        const nx = pdx / pdist;
                        const ny = pdy / pdist;
                        this.heldPlayer.x += nx * dragSpeed;
                        this.heldPlayer.y += ny * dragSpeed;
                    }
                    this.heldPlayer.clampToArena();
                } else {
                    // Pinned hold in place! Player stays locked next to the viper
                    const nx = pdist > 0.001 ? pdx / pdist : 1;
                    const ny = pdist > 0.001 ? pdy / pdist : 0;
                    this.heldPlayer.x = this.x - nx * holdDist;
                    this.heldPlayer.y = this.y - ny * holdDist;
                    this.heldPlayer.clampToArena();
                }

                // Viper stays in place as long as player is grabbed
                this.vx *= Math.pow(0.85, dtFactor);
                this.vy *= Math.pow(0.85, dtFactor);
                this.x += this.vx * dtFactor;
                this.y += this.vy * dtFactor;
                this.x = Math.max(30, Math.min(W - 30, this.x));
                this.y = Math.max(30, Math.min(H - 30, this.y));
                return;
            }
        }

        // --- State 2: Tongue Firing (in flight) ---
        if (this.viperState === 'tongue_firing' || (this.tongueActive && !this.heldPlayer)) {
            const tdx = this.tongueTargetX - this.tongueTipX;
            const tdy = this.tongueTargetY - this.tongueTipY;
            const tdist = Math.hypot(tdx, tdy);
            const step = this.tongueSpeed * dtFactor;

            if (tdist > 0.001) {
                const moveDist = Math.min(step, tdist);
                this.tongueTipX += (tdx / tdist) * moveDist;
                this.tongueTipY += (tdy / tdist) * moveDist;
            }

            // Check collision with all alive players
            let caughtPlayer = null;
            for (const p of GAME_STATE.players) {
                if (!p.alive) continue;
                const maxDist = p.r + 10;
                const dx = p.x - this.tongueTipX, dy = p.y - this.tongueTipY;
                if (dx * dx + dy * dy <= maxDist * maxDist) {
                    caughtPlayer = p;
                    break;
                }
            }

            if (caughtPlayer) {
                // If player was held by another viper, release previous viper
                if (caughtPlayer.viperGrabber && caughtPlayer.viperGrabber !== this) {
                    caughtPlayer.viperGrabber.heldPlayer = null;
                    caughtPlayer.viperGrabber.isDraggingPlayer = false;
                    caughtPlayer.viperGrabber.tongueActive = false;
                    caughtPlayer.viperGrabber.viperState = 'following';
                    caughtPlayer.viperGrabber.followUntil = now + 1200 + Math.random() * 1800;
                }

                // Latch onto player & transition to holding state
                caughtPlayer.viperGrabber = this;
                this.heldPlayer = caughtPlayer;
                this.isDraggingPlayer = true;
                this.tongueActive = true;
                this.viperState = 'holding';
                spawnHitParticles(this.tongueTipX, this.tongueTipY, '#a855f7');
            } else if (tdist <= step) {
                // Tongue reached max target distance without hitting -> missed!
                this.tongueActive = false;
                // Starts following the player for a random duration again (max 3s)!
                this.viperState = 'following';
                this.followUntil = now + 1200 + Math.random() * 1800;
            }

            // Stays in place while shooting tongue
            this.vx *= Math.pow(0.85, dtFactor);
            this.vy *= Math.pow(0.85, dtFactor);
            this.x += this.vx * dtFactor;
            this.y += this.vy * dtFactor;
            this.x = Math.max(30, Math.min(W - 30, this.x));
            this.y = Math.max(30, Math.min(H - 30, this.y));
            return;
        }

        // --- State 3: Following the Player for a random duration ---
        if (this.viperState === 'following') {
            // Follow player directly
            if (target && d > 0.001) {
                const nx = dx / d, ny = dy / d;
                const spd = this.getSpeed(now);
                this.x += nx * spd * dtFactor;
                this.y += ny * spd * dtFactor;
            }

            this.x = Math.max(30, Math.min(W - 30, this.x));
            this.y = Math.max(30, Math.min(H - 30, this.y));

            // When random follow duration expires -> stop and start attracting enemies!
            if (now >= this.followUntil) {
                this.viperState = 'stopped_attracting';
                if (!GAME_STATE.attractingVipers.includes(this)) {
                    GAME_STATE.attractingVipers.push(this);
                }
                this.vx = 0;
                this.vy = 0;
                // Wait while attracting monsters before shooting tongue (warning scaled by difficulty)
                const warnMult = GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0;
                const warnDuration = 600 * warnMult;
                this.warnDuration = warnDuration;
                this.shootTongueAt = now + warnDuration + 300 + Math.random() * 600;
            }
            return;
        }

        // --- State 4: Stopped & Attracting Enemies ---
        if (this.viperState === 'stopped_attracting') {
            if (!GAME_STATE.attractingVipers.includes(this)) {
                GAME_STATE.attractingVipers.push(this);
            }
            // Viper is stopped in place
            this.vx *= Math.pow(0.85, dtFactor);
            this.vy *= Math.pow(0.85, dtFactor);
            this.x += this.vx * dtFactor;
            this.y += this.vy * dtFactor;
            this.x = Math.max(30, Math.min(W - 30, this.x));
            this.y = Math.max(30, Math.min(H - 30, this.y));

            const warnMult = GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0;
            const warnDuration = 600 * warnMult; // Warning line scaled by difficulty
            this.warnDuration = warnDuration;
            if (this.shootTongueAt && now >= this.shootTongueAt - warnDuration) {
                // Find closest alive player in range (or target player)
                let bestPlayer = null, bestDistSq = Infinity;
                for (const p of GAME_STATE.players) {
                    if (!p.alive) continue;
                    const pdSq = this.distanceToSq(p);
                    if (pdSq < bestDistSq) {
                        bestDistSq = pdSq;
                        bestPlayer = p;
                    }
                }
                if (bestPlayer) {
                    this.tongueAimAngle = Math.atan2(bestPlayer.y - this.y, bestPlayer.x - this.x);
                    this.tongueAimTargetX = bestPlayer.x;
                    this.tongueAimTargetY = bestPlayer.y;
                    this.tongueAimWarning = true;
                } else {
                    this.tongueAimWarning = false;
                }
            } else {
                this.tongueAimWarning = false;
            }

            // When timer triggers, shoot tongue at player!
            if (now >= this.shootTongueAt) {
                this.tongueAimWarning = false;
                // Remove from attracting array immediately on tongue shoot
                const vIdx = GAME_STATE.attractingVipers.indexOf(this);
                if (vIdx !== -1) GAME_STATE.attractingVipers.splice(vIdx, 1);

                let bestPlayer = null, bestDistSq = Infinity;
                for (const p of GAME_STATE.players) {
                    if (!p.alive) continue;
                    const pdSq = this.distanceToSq(p);
                    if (pdSq < bestDistSq) {
                        bestDistSq = pdSq;
                        bestPlayer = p;
                    }
                }

                if (bestPlayer) {
                    // Shoot tongue! (Monsters stop being attracted because state changes to 'tongue_firing')
                    this.viperState = 'tongue_firing';
                    this.tongueActive = true;
                    if (typeof SoundEngine !== 'undefined' && SoundEngine.viperTongue) {
                        SoundEngine.viperTongue();
                    }
                    this.tongueTipX = this.x;
                    this.tongueTipY = this.y;
                    const angle = (typeof this.tongueAimAngle === 'number') ? this.tongueAimAngle : Math.atan2(bestPlayer.y - this.y, bestPlayer.x - this.x);
                    this.tongueTargetX = this.x + Math.cos(angle) * (this.tongueRange + 30);
                    this.tongueTargetY = this.y + Math.sin(angle) * (this.tongueRange + 30);
                } else {
                    // No valid players, return to following
                    this.viperState = 'following';
                    this.followUntil = now + 1200 + Math.random() * 1800;
                }
            }
            return;
        }
    }

    update(dtFactor = 1.0, now) {
        if (now < this.frozenUntil && !this.isPhase2Unit()) return;
        if (this.updateKnockbackAirborne(now)) return;
        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x, dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        this.updateViper(dtFactor, now, target, d, dx, dy);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'viper') {
            ctx.save();

            // 1. Draw Attached / Dragging / Pinned Tongue to player
            if (this.heldPlayer && this.heldPlayer.alive && this.heldPlayer.viperGrabber === this) {
                ctx.save();
                const px = this.heldPlayer.x, py = this.heldPlayer.y;

                // Fleshy abduct frog tongue cord (crimson blood red)
                ctx.strokeStyle = '#dc2626';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(px, py);
                ctx.stroke();

                // Inner pale tendon core
                ctx.strokeStyle = '#fee2e2';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(px, py);
                ctx.stroke();

                // Organic pulsating nodes along the tongue (deep dark red)
                const segCount = 4;
                ctx.fillStyle = '#991b1b';
                for (let i = 1; i < segCount; i++) {
                    const frac = i / segCount;
                    const nx = this.x + (px - this.x) * frac;
                    const ny = this.y + (py - this.y) * frac;
                    const nodePulse = 3.5 + Math.sin(now / 80 + i) * 1.5;
                    ctx.beginPath();
                    ctx.arc(nx, ny, nodePulse, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Tongue barb head latching onto player
                ctx.fillStyle = '#ef4444';
                ctx.strokeStyle = '#7f1d1d';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(px, py, 9, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.restore();
            } else if (this.tongueActive) {
                // Tongue tip in flight towards target
                ctx.save();
                ctx.strokeStyle = '#dc2626';
                ctx.lineWidth = 3.5;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.tongueTipX, this.tongueTipY);
                ctx.stroke();

                // Barbed tongue tip
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(this.tongueTipX, this.tongueTipY, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            // Pheromone attraction pulse ring when stopped and gathering monsters
            if (this.viperState === 'stopped_attracting') {
                ctx.save();
                const attractPulse = (now % 1000) / 1000;
                const ringR = 20 + attractPulse * 160;
                ctx.strokeStyle = `rgba(185, 28, 28, ${0.45 * (1 - attractPulse)})`;
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 6]);
                ctx.beginPath();
                ctx.arc(this.x, this.y, ringR, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();

                // Warning telegraph line just before shooting tongue
                const warnDuration = this.warnDuration || (600 * (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0));
                if (this.shootTongueAt && now >= this.shootTongueAt - warnDuration && now < this.shootTongueAt) {
                    const warnProgress = Math.min(1.0, Math.max(0.0, (now - (this.shootTongueAt - warnDuration)) / warnDuration));
                    const aimAngle = (typeof this.tongueAimAngle === 'number') ? this.tongueAimAngle : 0;
                    const aimLen = this.tongueRange || 1500;
                    const endX = this.x + Math.cos(aimAngle) * aimLen;
                    const endY = this.y + Math.sin(aimAngle) * aimLen;

                    ctx.save();
                    // 1. Soft glowing threat corridor (pulsing crimson danger beam)
                    const pulse = 0.6 + 0.4 * Math.sin(now / 50);
                    ctx.strokeStyle = `rgba(220, 38, 38, ${(0.18 + warnProgress * 0.35) * pulse})`;
                    ctx.lineWidth = 12 * (0.6 + 0.4 * warnProgress);
                    ctx.beginPath();
                    ctx.moveTo(this.x, this.y);
                    ctx.lineTo(endX, endY);
                    ctx.stroke();

                    // 2. Animated dashed tracking beam (flowing forward toward target)
                    ctx.strokeStyle = `rgba(254, 202, 202, ${0.5 + 0.5 * warnProgress})`;
                    ctx.lineWidth = 2.0;
                    ctx.setLineDash([12, 8]);
                    ctx.lineDashOffset = -(now / 15);
                    ctx.beginPath();
                    ctx.moveTo(this.x, this.y);
                    ctx.lineTo(endX, endY);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // 3. Target lock crosshair indicator at target player position
                    if (typeof this.tongueAimTargetX === 'number' && typeof this.tongueAimTargetY === 'number') {
                        const reticleR = Math.max(14, 36 * (1.0 - warnProgress * 0.6));
                        ctx.strokeStyle = '#ef4444';
                        ctx.lineWidth = 2.0;
                        ctx.beginPath();
                        ctx.arc(this.tongueAimTargetX, this.tongueAimTargetY, reticleR, 0, Math.PI * 2);
                        ctx.stroke();

                        // Crosshair notches
                        for (let i = 0; i < 4; i++) {
                            const ca = (Math.PI / 2) * i;
                            ctx.beginPath();
                            ctx.moveTo(this.tongueAimTargetX + Math.cos(ca) * (reticleR - 4), this.tongueAimTargetY + Math.sin(ca) * (reticleR - 4));
                            ctx.lineTo(this.tongueAimTargetX + Math.cos(ca) * (reticleR + 5), this.tongueAimTargetY + Math.sin(ca) * (reticleR + 5));
                            ctx.stroke();
                        }
                    }

                    // 4. Glowing mouth charging flare
                    const flareR = 3 + warnProgress * 7 + Math.sin(now / 40) * 2;
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
                    ctx.beginPath();
                    ctx.arc(this.x, this.y + 11, flareR * 1.6, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = '#ef4444';
                    ctx.beginPath();
                    ctx.arc(this.x, this.y + 11, flareR, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.restore();
                }
            }

            // 2. Viper Body — Writhing, Squirming "Ball of Tongues"
            const hoverOffset = Math.sin(now / 130) * 3.5;
            const drawY = this.y + hoverOffset;

            // Faint ground shadow
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.beginPath();
            ctx.ellipse(this.x, this.y + 18, this.r * 0.95, this.r * 0.45, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.save();

            // A. Base pulsing visceral meat core
            const pulseR = this.r * (0.88 + 0.08 * Math.sin(now / 100));
            ctx.fillStyle = '#7f1d1d';
            ctx.strokeStyle = '#450a0a';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, drawY, pulseR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // B. Perimeter writhing tongue loops (8 fleshy tentacles flexing and curling outwards)
            const numLoops = 8;
            for (let i = 0; i < numLoops; i++) {
                const baseAngle = (i / numLoops) * Math.PI * 2;
                const wave = Math.sin(now / 110 + i * 1.4);
                const loopAngle = baseAngle + wave * 0.25;
                const reach = this.r * (0.95 + 0.32 * Math.abs(wave));
                const midDist = this.r * 0.65;

                // Tongue path curve
                const startX = this.x + Math.cos(loopAngle - 0.22) * midDist;
                const startY = drawY + Math.sin(loopAngle - 0.22) * midDist;
                const tipX = this.x + Math.cos(loopAngle) * reach;
                const tipY = drawY + Math.sin(loopAngle) * reach;
                const cpX = this.x + Math.cos(loopAngle + 0.35) * (reach * 1.12);
                const cpY = drawY + Math.sin(loopAngle + 0.35) * (reach * 1.12);

                // Thick fleshy tongue muscle
                ctx.strokeStyle = '#dc2626';
                ctx.lineWidth = 5.5;
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
                ctx.stroke();

                // Pale inner tendon stripe
                ctx.strokeStyle = '#fee2e2';
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
                ctx.stroke();

                // Barbed tip
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(tipX, tipY, 4, 0, Math.PI * 2);
                ctx.fill();
            }

            // C. Interwoven foreground cross-tongues spanning the spherical body
            const numCross = 5;
            for (let i = 0; i < numCross; i++) {
                const crossAngle = (i / numCross) * Math.PI + Math.sin(now / 140 + i) * 0.15;
                const x1 = this.x + Math.cos(crossAngle) * (this.r * 0.82);
                const y1 = drawY + Math.sin(crossAngle) * (this.r * 0.82);
                const x2 = this.x - Math.cos(crossAngle) * (this.r * 0.82);
                const y2 = drawY - Math.sin(crossAngle) * (this.r * 0.82);
                const bow = Math.sin(now / 90 + i * 1.8) * 8;
                const midX = (x1 + x2) / 2 + Math.cos(crossAngle + Math.PI / 2) * bow;
                const midY = (y1 + y2) / 2 + Math.sin(crossAngle + Math.PI / 2) * bow;

                // Fleshy strand
                ctx.strokeStyle = '#b91c1c';
                ctx.lineWidth = 6;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.quadraticCurveTo(midX, midY, x2, y2);
                ctx.stroke();

                // Muscle highlight
                ctx.strokeStyle = '#f87171';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.quadraticCurveTo(midX, midY, x2, y2);
                ctx.stroke();

                // Organic papillae / nodes along the strand
                for (let frac of [0.3, 0.7]) {
                    const px = x1 + (x2 - x1) * frac + Math.cos(crossAngle + Math.PI / 2) * (bow * 0.5);
                    const py = y1 + (y2 - y1) * frac + Math.sin(crossAngle + Math.PI / 2) * (bow * 0.5);
                    ctx.fillStyle = '#fee2e2';
                    ctx.beginPath();
                    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // D. Central gaping abduct maw
            const mawR = 9 + (this.tongueActive || this.viperState === 'stopped_attracting' ? 4 : 0);
            ctx.fillStyle = '#260404';
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(this.x, drawY, mawR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Glowing throat depth
            ctx.fillStyle = '#dc2626';
            ctx.beginPath();
            ctx.arc(this.x, drawY, mawR * 0.45, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

// -------------------------------------------------------------
// Boss Subclasses (extends BossEnemy)
// -------------------------------------------------------------
class OctopusBoss extends BossEnemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.octopus : 1000;
        super(x, y, 'octopus', now, 60, 10000, 0.48, 25, '#2e0854', xp);
        this.airborne = true;
        this.landX = W / 2;
        this.landY = H / 2;
        this.landAt = now + 2000;
        this.fallHeight = 450;
        this.tentacles = [];
        this.nextTentacleTime = now + 4000;
    }

    land(now) {
        this.airborne = false;
        this.x = this.landX;
        this.y = this.landY;
        GAME_STATE.hazards.push(new MineExplosion(this.x, this.y, 220, now, null));
        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const dx = p.x - this.x, dy = p.y - this.y;
            if (dx * dx + dy * dy < (220 + p.r) * (220 + p.r)) {
                p.takeDamage(40, now, this);
            }
        }
        for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2, s = 2.0 + Math.random() * 5.0;
            GAME_STATE.particles.push(new Particle(this.x, this.y, Math.cos(a) * s, Math.sin(a) * s, '#9b5de5', 600));
        }

        // Destroy all other monsters on the battlefield instantly, just like the Behemoth
        for (const e of GAME_STATE.enemies) {
            if (e !== this) {
                e.hp = 0;
                if (typeof spawnHitParticles === 'function') {
                    spawnHitParticles(e.x, e.y, '#9b5de5');
                }
            }
        }
        GAME_STATE.enemies = [this];
        GAME_STATE.activeSentries = [];
        GAME_STATE.shieldBearers = [];
        GAME_STATE.attractingVipers = [];
    }

    triggerSpikeExplosion(now) {
        SoundEngine.mineExplosion();
        const count = 12;
        const speed = 3.0 / (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0);
        const damage = 10;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            GAME_STATE.enemyProjectiles.push(new SpikyProjectile(this.x, this.y, vx, vy, damage, this, now));
        }
        for (let i = 0; i < 20; i++) {
            const a = Math.random() * Math.PI * 2, s = 1.0 + Math.random() * 3.0;
            GAME_STATE.particles.push(new Particle(this.x, this.y, Math.cos(a) * s, Math.sin(a) * s, '#ff1100', 400));
        }
    }

    updateOctopus(dtFactor, now, target, d, dx, dy) {
        // Move towards target player
        if (target) {
            const nx = d > 0.001 ? dx / d : 0;
            const ny = d > 0.001 ? dy / d : 0;
            const currentSpeed = this.getSpeed(now);
            this.x += nx * currentSpeed * dtFactor;
            this.y += ny * currentSpeed * dtFactor;
        }

        // Keep inside arena boundaries
        this.x = Math.max(this.r, Math.min(W - this.r, this.x));
        this.y = Math.max(this.r, Math.min(H - this.r, this.y));

        // Spawning tentacles at uneven timings, multiple tentacles, random directions
        if (target && now >= this.nextTentacleTime) {
            const count = Math.random() < 0.18 ? 4 : (Math.random() < 0.38 ? 3 : (Math.random() < 0.65 ? 2 : 1));
            for (let i = 0; i < count; i++) {
                let angle = Math.atan2(target.y - this.y, target.x - this.x);
                angle += (Math.random() - 0.5) * 2.6; // wider random offset of up to ~74.5 degrees (~149 degree total cone)
                const length = 360 + Math.random() * 240; // varied lengths from 360px up to 600px
                
                const warnMult = GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0;
                const warnDuration = 500 * warnMult;
                this.tentacles.push({
                    state: 'telegraph',
                    dunkSoundPlayed: false,
                    timer: now + warnDuration, // warning phase scaled by difficulty
                    warnDuration: warnDuration,
                    angle: angle,
                    length: length,
                    startX: this.x,
                    startY: this.y,
                    endX: this.x + Math.cos(angle) * length,
                    endY: this.y + Math.sin(angle) * length,
                    dmgApplied: false,
                    lashStartTime: 0
                });
            }
            // Cooldown: uneven timings (0.5s to 1.8s)
            this.nextTentacleTime = now + 600 + Math.random() * 1300;
        }

        // Segment intersection helper for checking damage
        const distToSeg = (px, py, x1, y1, x2, y2) => {
            const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
            if (l2 === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
            let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
            t = Math.max(0, Math.min(1, t));
            const projX = x1 + t * (x2 - x1);
            const projY = y1 + t * (y2 - y1);
            const dx = px - projX;
            const dy = py - projY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        // Update active tentacles (traveling with the octopus body as it walks)
        for (const t of this.tentacles) {
            t.startX = this.x;
            t.startY = this.y;
            t.endX = this.x + Math.cos(t.angle) * t.length;
            t.endY = this.y + Math.sin(t.angle) * t.length;

            if (t.state === 'telegraph') {
                if (now >= t.timer) {
                    t.state = 'lashing';
                    t.timer = now + 350; // Active lash duration
                    t.lashStartTime = now;
                    t.hitUnits = new Set();
                    SoundEngine.tentacleLash();
                }
            } else if (t.state === 'lashing') {
                // Determine current extension progress of the tentacle
                const ratioProgress = Math.min(1.0, (now - t.lashStartTime) / 350);
                const currentEndX = t.startX + (t.endX - t.startX) * ratioProgress;
                const currentEndY = t.startY + (t.endY - t.startY) * ratioProgress;
                
                if (Math.floor(t.timer - now) == 100 && t.dunkSoundPlayed === false) {
                    SoundEngine.flailHit(2);
                    t.dunkSoundPlayed = true;
                }

                if (!t.hitUnits) t.hitUnits = new Set();
                
                // Check all players caught in the currently extended lash segment
                for (const p of GAME_STATE.players) {
                    if (!p.alive || t.hitUnits.has(p)) continue;
                    const dist = distToSeg(p.x, p.y, t.startX, t.startY, currentEndX, currentEndY);
                    if (dist <= 25 + p.r) {
                        t.hitUnits.add(p);
                        p.takeDamage(60, now, this);
                        spawnHitParticles(p.x, p.y, '#ff00aa');
                    }
                }

                // Check all turrets caught in the tentacle lash segment
                for (const tur of GAME_STATE.turrets) {
                    if (!tur.alive || t.hitUnits.has(tur)) continue;
                    const dist = distToSeg(tur.x, tur.y, t.startX, t.startY, currentEndX, currentEndY);
                    if (dist <= 25 + tur.r) {
                        t.hitUnits.add(tur);
                        tur.takeDamage(60, now, this);
                        spawnHitParticles(tur.x, tur.y, '#ff00aa');
                    }
                }

                // Check all other enemy units caught in the tentacle lash segment
                for (const e of GAME_STATE.enemies) {
                    if (e === this || e.hp <= 0 || e.airborne || t.hitUnits.has(e)) continue;
                    const dist = distToSeg(e.x, e.y, t.startX, t.startY, currentEndX, currentEndY);
                    if (dist <= 25 + e.r) {
                        t.hitUnits.add(e);
                        e.hp -= 60;
                        spawnHitParticles(e.x, e.y, '#ff00aa');
                    }
                }
                
                if (now >= t.timer) {
                    t.state = 'done';
                    SoundEngine.flailHit(2);
                }
            }
        }
        
        // Clear finished tentacles
        this.tentacles = this.tentacles.filter(t => t.state !== 'done');

        // Contact damage with the boss body (deals damage to all units)
        // 1. Players
        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const pdx = p.x - this.x, pdy = p.y - this.y;
            if (pdx * pdx + pdy * pdy < (p.r + this.r) * (p.r + this.r)) {
                p.takeDamage(this.damage, now, this, true);
            }
        }
        // 2. Turrets
        for (const tur of GAME_STATE.turrets) {
            if (!tur.alive) continue;
            const tdx = tur.x - this.x, tdy = tur.y - this.y;
            if (tdx * tdx + tdy * tdy < (tur.r + this.r) * (this.r + tur.r)) {
                tur.takeDamage(this.damage, now, this);
            }
        }
        // 3. Other Enemies
        for (const e of GAME_STATE.enemies) {
            if (e === this || e.hp <= 0 || e.airborne) continue;
            const edx = e.x - this.x, edy = e.y - this.y;
            if (edx * edx + edy * edy < (e.r + this.r) * (e.r + this.r)) {
                e.hp -= this.damage;
                spawnHitParticles(e.x, e.y, '#ff00aa');
            }
        }
    }

    update(dtFactor = 1.0, now) {
        if (this.updateKnockbackAirborne(now)) return;
        if (this.airborne) {
            if (now >= this.landAt) this.land(now);
            return;
        }
        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x, dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        this.updateOctopus(dtFactor, now, target, d, dx, dy);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'octopus' || this.type === 'boss') {
            if (this.airborne) {
                const frac = Math.max(0, Math.min(1, 1 - (this.landAt - now) / 2000));
                // growing impact marker on the ground
                ctx.save();
                ctx.strokeStyle = `rgba(148,0,211,${0.25 + 0.5 * frac})`;
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.arc(this.x, this.landY, 200 * (0.45 + 0.55 * frac), 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                
                // falling boss core
                const drawY = this.landY - this.fallHeight * (1 - frac);
                ctx.save();
                ctx.save();
                ctx.fillStyle = '#da70d6';
                ctx.globalAlpha = 0.35;
                ctx.beginPath();
                ctx.arc(this.x, drawY, this.r + 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                
                ctx.fillStyle = this.color;
                ctx.beginPath(); ctx.arc(this.x, drawY, this.r, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
                return;
            }
            
            // Draw health bar above head
            const barW = 120;
            const barH = 8;
            const bx = this.x - barW / 2;
            const by = this.y - this.r - 20;
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(bx, by, barW, barH);
            ctx.fillStyle = '#ff2200';
            ctx.fillRect(bx, by, barW * (this.hp / this.maxHp), barH);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(bx, by, barW, barH);
            ctx.restore();
            
            // Draw boss body
            ctx.save();
            const pulse = 1.0 + 0.05 * Math.sin(now / 100);
            
            // Draw outer pulsing glowing aura
            ctx.fillStyle = 'rgba(148, 0, 211, 0.22)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * 1.35 * pulse, 0, Math.PI * 2);
            ctx.fill();
            
            // Inner body
            ctx.fillStyle = '#1c053a'; // deep purple black
            ctx.strokeStyle = '#ba55d3'; // medium orchid border
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * pulse, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
            
            // Draw tentacle states
            for (const t of this.tentacles) {
                if (t.state === 'telegraph') {
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255, 0, 100, 0.65)';
                    ctx.lineWidth = 6;
                    ctx.setLineDash([12, 8]);
                    ctx.beginPath();
                    ctx.moveTo(t.startX, t.startY);
                    ctx.lineTo(t.endX, t.endY);
                    ctx.stroke();
                    ctx.restore();
                } else if (t.state === 'lashing') {
                    ctx.save();
                    const elapsed = now - (t.timer - 350);
                    const ratioProgress = Math.min(1.0, elapsed / 350);
                    const segments = 18;
                    const dx = t.endX - t.startX;
                    const dy = t.endY - t.startY;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    const perpX = length > 0.01 ? -dy / length : 0;
                    const perpY = length > 0.01 ? dx / length : 1;
                    
                    for (let i = 0; i <= segments; i++) {
                        const ratio = i / segments;
                        const wave = 8 * Math.sin(ratio * 4.5 - now * 0.02) * ratio * (1 - ratio);
                        const sx = t.startX + dx * ratioProgress * ratio + perpX * wave;
                        const sy = t.startY + dy * ratioProgress * ratio + perpY * wave;
                        const radius = 22 * (1 - ratio * 0.55);
                        ctx.fillStyle = '#2d004d';
                        ctx.strokeStyle = '#ff1493';
                        ctx.lineWidth = 2.5;
                        ctx.beginPath();
                        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
                        ctx.fill();
ctx.stroke();
                }
                ctx.restore();
            }
            }
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class FelhoundBoss extends BossEnemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.felhound : 2000;
        super(x, y, 'felhound', now, 35, 100000, 0, 2000, '#6a0dad', xp);
        this.killPauseUntil = 0;
        const startAngle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(startAngle) * 1.5;
        this.vy = Math.sin(startAngle) * 1.5;
        this.targetPlayer = null;
        this.retargetCooldown = 0;
        this.gallopDist = 0;
    }

    updateFelhound(dtFactor, now) {
        if (now < (this.killPauseUntil || 0)) {
            this.vx = 0;
            this.vy = 0;
            return; // stop movement for 1s after killing a player
        }

        // --- Targeting: pick closest alive player, re-evaluate every 2s ---
        if (!this.targetPlayer || !this.targetPlayer.alive || now >= this.retargetCooldown) {
            let bestDist = Infinity, bestPlayer = null;
            for (const p of GAME_STATE.players) {
                if (!p.alive) continue;
                const dx = p.x - this.x, dy = p.y - this.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < bestDist) { bestDist = d2; bestPlayer = p; }
            }
            this.targetPlayer = bestPlayer;
            this.retargetCooldown = now + 2000;
        }
        if (!this.targetPlayer) return;

        const target = this.targetPlayer;

        // --- Wave progress: 0 at start -> 1 at 2 minutes ---
        const WAVE_DURATION = 120000;
        const elapsed = Math.max(0, now - (GAME_STATE.activeBossStartTime || now));
        const waveFrac = Math.min(1, elapsed / WAVE_DURATION);

        // Max speed ramps: very slow start, threatening by the end
        const maxSpeed = 2.0 + waveFrac * 3.0;   // 2.0 -> 5.0 px/frame

        // Steering acceleration toward target — low relative to speed so orbits form
        const accel = 0.02 + waveFrac * 0.3;    // 0.08 -> 0.22 px/frame²

        // Apply steering: accelerate toward target
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0.001) {
            this.vx += (dx / d) * accel * dtFactor;
            this.vy += (dy / d) * accel * dtFactor;
        }

        // Radial collapse force: bleed tangential momentum inward, proportional to current speed.
        // This guarantees the orbit is ALWAYS unstable — the faster it goes, the faster it spirals in.
        const spd0 = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        const collapseMult = 1 / (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0);
        const collapseRate = (0.0005 + waveFrac * 0.045) * spd0 * collapseMult; // grows with both waveFrac and speed, scaled by difficulty
        if (d > 0.001 && spd0 > 0.001) {
            this.vx += (dx / d) * collapseRate * dtFactor;
            this.vy += (dy / d) * collapseRate * dtFactor;
        }

        // Cap to max speed (preserve direction)
        const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (spd > maxSpeed) {
            this.vx = (this.vx / spd) * maxSpeed;
            this.vy = (this.vy / spd) * maxSpeed;
        }

        // Move by velocity
        this.x += this.vx * dtFactor;
        this.y += this.vy * dtFactor;

        // Galloping footstep sound: frequency scales directly with movement speed
        if (spd > 0.1) {
            this.gallopDist = (this.gallopDist || 0) + spd * dtFactor;
            if (this.gallopDist >= 65) {
                this.gallopDist %= 65;
                SoundEngine.felhoundGallop();
            }
        }

        // Bounce off arena walls (reflect velocity component)
        if (this.x < this.r)     { this.x = this.r;     this.vx =  Math.abs(this.vx); }
        if (this.x > W - this.r) { this.x = W - this.r; this.vx = -Math.abs(this.vx); }
        if (this.y < this.r)     { this.y = this.r;     this.vy =  Math.abs(this.vy); }
        if (this.y > H - this.r) { this.y = H - this.r; this.vy = -Math.abs(this.vy); }

        // Contact damage to all players
        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const pdx = p.x - this.x, pdy = p.y - this.y;
            if (pdx * pdx + pdy * pdy < (p.r + this.r) * (p.r + this.r)) {
                const wasAlive = p.alive;
                p.takeDamage(this.damage, now, this, true);
                if (wasAlive && !p.alive) {
                    // Felhound killed player: stop & vibrate for 1 second, then retarget
                    this.killPauseUntil = now + 1000;
                    this.vx = 0;
                    this.vy = 0;
                    this.targetPlayer = null;
                    this.retargetCooldown = 0;
                    return;
                }
            }
        }
        // Contact damage to all turrets
        for (const t of GAME_STATE.turrets) {
            if (!t.alive) continue;
            const tdx = t.x - this.x, tdy = t.y - this.y;
            if (tdx * tdx + tdy * tdy < (t.r + this.r) * (t.r + this.r)) {
                t.takeDamage(this.damage, now, this);
            }
        }
        // Contact damage to all other enemy units
        for (const e of GAME_STATE.enemies) {
            if (e === this || e.hp <= 0 || e.airborne) continue;
            const edx = e.x - this.x, edy = e.y - this.y;
            if (edx * edx + edy * edy < (e.r + this.r) * (e.r + this.r)) {
                e.hp -= this.damage;
                spawnHitParticles(e.x, e.y, '#6a0dad');
            }
        }

        // Trailing energy particle emitted during update
        if (Math.random() < 0.45 + waveFrac * 0.3) {
            const a = Math.random() * Math.PI * 2;
            const s = (0.3 + Math.random() * 1.2) * (1 + waveFrac);
            const col = waveFrac > 0.5 ? '#ff6d00' : '#ce93d8';
            GAME_STATE.particles.push(new Particle(
                this.x + Math.cos(a) * this.r * 0.7,
                this.y + Math.sin(a) * this.r * 0.7,
                Math.cos(a) * s, Math.sin(a) * s, col, 280 + Math.random() * 120
            ));
        }
    }

    update(dtFactor = 1.0, now) {
        if (this.updateKnockbackAirborne(now)) return;
        this.updateFelhound(dtFactor, now);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        if (this.type === 'felhound') {
            ctx.save();
            if (now < (this.killPauseUntil || 0)) {
                ctx.translate((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
            }

            // Wave progress for visual escalation
            const WAVE_DURATION = 120000;
            const waveFrac = GAME_STATE.bossLvl3Start
                ? Math.min(1, Math.max(0, now - GAME_STATE.bossLvl3Start) / WAVE_DURATION)
                : 0;

            // Pulsing outer aura — brighter and more frantic as wave progresses
            const auraSize = this.r + 16 + waveFrac * 14;
            const auraPulse = 0.15 + 0.2 * waveFrac + 0.12 * Math.abs(Math.sin(now / (300 - waveFrac * 200)));
            ctx.globalAlpha = auraPulse;
            ctx.fillStyle = waveFrac > 0.6 ? '#ff1744' : '#7b1fa2';
            ctx.beginPath();
            ctx.arc(this.x, this.y, auraSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;

            // Main body — deep purple shifting toward fel-red at high waveFrac
            const bodyHue = Math.floor(270 - waveFrac * 90); // purple→red
            ctx.fillStyle = `hsl(${bodyHue}, 80%, 22%)`;
            ctx.strokeStyle = `hsl(${bodyHue - 20}, 90%, 12%)`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Target hunting direction
            const targetP = (this.targetPlayer && this.targetPlayer.alive) ? this.targetPlayer : GAME_STATE.players.find(p => p.alive);
            const huntAngle = targetP ? Math.atan2(targetP.y - this.y, targetP.x - this.x) : (Math.atan2(this.vy, this.vx) || 0);

            // --- Rotated Creature Features (Horns/Ears, Snake Hairs, Jaws, Eyes) ---
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(huntAngle);

            // 1. Undulating Snake Hairs / Sensory Tendrils (trailing backward from head)
            for (const side of [-1, 1]) {
                for (let k = 0; k < 2; k++) {
                    const sway = Math.sin(now / 110 + k * 2.0 + side) * (5 + waveFrac * 4);
                    const baseX = -this.r * (0.3 + k * 0.18);
                    const baseY = side * this.r * (0.45 + k * 0.32);
                    const midX = -this.r * (0.9 + k * 0.3);
                    const midY = side * this.r * (0.75 + k * 0.4) + sway;
                    const tipX = -this.r * (1.45 + k * 0.4);
                    const tipY = side * this.r * (0.9 + k * 0.45) + sway * 1.5;

                    // Snake body strand
                    ctx.strokeStyle = `hsl(${bodyHue - 25}, 90%, 14%)`;
                    ctx.lineWidth = 4.5 - k * 1.2;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(baseX, baseY);
                    ctx.quadraticCurveTo(midX, midY, tipX, tipY);
                    ctx.stroke();

                    // Inner snake energy vein
                    ctx.strokeStyle = waveFrac > 0.5 ? '#ff1744' : '#00e676';
                    ctx.lineWidth = 1.8;
                    ctx.beginPath();
                    ctx.moveTo(baseX, baseY);
                    ctx.quadraticCurveTo(midX, midY, tipX, tipY);
                    ctx.stroke();

                    // Glowing snake head / barbed tip
                    ctx.fillStyle = waveFrac > 0.5 ? '#ff6d00' : '#76ff03';
                    ctx.beginPath();
                    ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // 2. Jagged Demon Horns / Ears (sweeping backward along rear flanks)
            ctx.fillStyle = '#4a0080';
            ctx.strokeStyle = '#1a0033';
            ctx.lineWidth = 1.8;
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(-this.r * 0.2, side * this.r * 0.45);
                ctx.lineTo(-this.r * 1.35, side * this.r * 0.95);
                ctx.lineTo(-this.r * 0.55, side * this.r * 0.28);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            // 3. Predatory Jaws pointing in the direction of the hunted player
            const chompCycle = Math.sin(now / 95);
            const jawSpread = 0.32 + 0.14 * Math.abs(chompCycle); // snapping chomping motion
            const jawLength = this.r * 1.55;
            const jawColor = `hsl(${bodyHue - 15}, 85%, 18%)`;
            const jawBorder = `hsl(${bodyHue - 30}, 95%, 10%)`;

            // Inner gaping maw glow
            ctx.fillStyle = waveFrac > 0.5 ? 'rgba(255, 23, 68, 0.55)' : 'rgba(0, 230, 118, 0.45)';
            ctx.beginPath();
            ctx.moveTo(this.r * 0.3, 0);
            ctx.lineTo(this.r * 1.15 * Math.cos(jawSpread), this.r * 1.15 * Math.sin(jawSpread));
            ctx.lineTo(this.r * 0.7, 0);
            ctx.lineTo(this.r * 1.15 * Math.cos(-jawSpread), this.r * 1.15 * Math.sin(-jawSpread));
            ctx.closePath();
            ctx.fill();

            // Upper & Lower Mandibles / Jaws
            for (const side of [-1, 1]) {
                const jAngle = side * jawSpread;
                ctx.fillStyle = jawColor;
                ctx.strokeStyle = jawBorder;
                ctx.lineWidth = 2.5;

                ctx.beginPath();
                // Outer curving mandible flank
                ctx.moveTo(this.r * 0.75 * Math.cos(jAngle + side * 0.4), this.r * 0.75 * Math.sin(jAngle + side * 0.4));
                ctx.quadraticCurveTo(
                    this.r * 1.35 * Math.cos(jAngle + side * 0.25), this.r * 1.35 * Math.sin(jAngle + side * 0.25),
                    jawLength * Math.cos(jAngle), jawLength * Math.sin(jAngle) // Sharp front fang tip
                );
                // Inner serrated jaw line back into mouth
                ctx.lineTo(this.r * 1.1 * Math.cos(jAngle * 0.65), this.r * 1.1 * Math.sin(jAngle * 0.65));
                ctx.lineTo(this.r * 0.8 * Math.cos(jAngle * 0.3), this.r * 0.8 * Math.sin(jAngle * 0.3));
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Sharp gleaming teeth along inner mandible
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#ffeeaa';
                ctx.lineWidth = 1;

                // Main front canine
                ctx.beginPath();
                ctx.moveTo(jawLength * Math.cos(jAngle), jawLength * Math.sin(jAngle));
                ctx.lineTo(
                    (jawLength - 14) * Math.cos(jAngle + side * 0.1),
                    (jawLength - 14) * Math.sin(jAngle + side * 0.1)
                );
                ctx.lineTo(
                    (jawLength - 15) * Math.cos(jAngle * 0.55),
                    (jawLength - 15) * Math.sin(jAngle * 0.55)
                );
                ctx.closePath();
                ctx.fill();

                // Secondary serrated tooth
                const midToothX = this.r * 1.18 * Math.cos(jAngle * 0.75);
                const midToothY = this.r * 1.18 * Math.sin(jAngle * 0.75);
                ctx.beginPath();
                ctx.moveTo(midToothX, midToothY);
                ctx.lineTo(
                    this.r * 1.05 * Math.cos(jAngle * 0.25),
                    this.r * 1.05 * Math.sin(jAngle * 0.25)
                );
                ctx.lineTo(
                    this.r * 1.28 * Math.cos(jAngle * 0.45),
                    this.r * 1.28 * Math.sin(jAngle * 0.45)
                );
                ctx.closePath();
                ctx.fill();
            }

            // 4. Glowing ember eyes (oriented forward along hunting direction)
            ctx.fillStyle = waveFrac > 0.5 ? '#ff6d00' : '#aeea00';
            ctx.beginPath();
            ctx.arc(this.r * 0.35, -this.r * 0.28, 4, 0, Math.PI * 2);
            ctx.arc(this.r * 0.35, this.r * 0.28, 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();

            // Fel energy core (pulsing green-to-orange)
            const coreColor = waveFrac < 0.5 ? '#00e676' : `hsl(${60 - waveFrac * 60}, 100%, 55%)`;
            const corePulse = 0.6 + 0.4 * Math.abs(Math.sin(now / 180));
            ctx.globalAlpha = corePulse;
            ctx.fillStyle = coreColor;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * 0.45, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;

            // HP bar above the felhound
            const barW = 60, barH = 6;
            const bx = this.x - barW / 2, by = this.y - this.r - 16;
            ctx.fillStyle = '#333';
            ctx.fillRect(bx, by, barW, barH);
            const hpFrac = Math.max(0, this.hp / this.maxHp);
            ctx.fillStyle = hpFrac > 0.5 ? '#76ff03' : hpFrac > 0.25 ? '#ffab00' : '#ff1744';
            ctx.fillRect(bx, by, barW * hpFrac, barH);
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            ctx.strokeRect(bx, by, barW, barH);

            ctx.restore();
            this.drawCryoOverlay(now);
            return;
        }
    }
}

class BehemothBoss extends BossEnemy {
    constructor(x, y, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const xp = typeof MONSTER_BASE_XP !== 'undefined' ? MONSTER_BASE_XP.behemoth : 5000;
        super(x, y, 'behemoth', now, 65, 500000, 1.0, 2500, '#1b4332', xp);
        this.airborne = false;
        this.nydusEmerging = true;
        this.nydusStartTime = now;
        this.nydusDuration = 3200;
        this.nydusEndTime = now + 3200;
        this.nydusRoarPlayed = false;
        this.trailStartX = this.x < W / 2 ? -80 : W + 80;
        this.trailStartY = this.y < H / 2 ? -80 : H + 80;
        this.trailAngle = Math.atan2(this.y - this.trailStartY, this.x - this.trailStartX);
        this.facingAngle = this.trailAngle;
        this.behemothState = 'pursuit';
        this.stateTimer = 0;
        this.lastCleaveTime = 0;
        this.mortarRoundsLeft = 0;
        this.nextMortarRoundTime = 0;
        this.burrowTrail = [];
        this.eruptStartTime = 0;
        this.eruptDuration = 2200;
        this.nextCleaveReady = now + 3000 + 3200;
        this.nextMortarReady = now + 6000 + 3200;
        this.nextBurrowReady = now + 15000 + 3200;
        this.nextChargeReady = now + 22000 + 3200;
        this.nextTongueReady = now + 9000 + 3200;
        this.tongueActive = false;
        this.tongueTipX = this.x;
        this.tongueTipY = this.y;
        this.tongueTargetX = 0;
        this.tongueTargetY = 0;
        this.tongueSpeed = 16.0;
        this.tongueRange = 2000;
        this.heldPlayer = null;
        this.wallPieceX = 0;
        this.wallPieceY = 0;
        this.wallPieceAngle = 0;
        this.wallPiecePinnedPlayers = [];
        this.cleaveArc = Math.PI * 0.85;
        this.cleaveRadius = 240;
        this.burrowMoundX = this.x;
        this.burrowMoundY = this.y;
        this.chargeAngle = 0;
        this.chargeSpeed = 6.0;
        this.tuskFlex = 0;
        this.burrowed = false;
    }

    launchBileMortars(now) {
        // Launches 12 acid mortar pods with broad spread across players and arena
        const alivePlayers = GAME_STATE.players.filter(p => p.alive);
        if (alivePlayers.length === 0) return;

        const podCount = 12;
        for (let i = 0; i < podCount; i++) {
            const p = alivePlayers[i % alivePlayers.length];
            const ang = (i / podCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
            const dist = 70 + Math.random() * 260;
            let tx = p.x + Math.cos(ang) * dist;
            let ty = p.y + Math.sin(ang) * dist;

            // Dispersion across arena zones for broad artillery coverage
            if (i >= 6) {
                tx = W * 0.15 + Math.random() * (W * 0.7);
                ty = H * 0.15 + Math.random() * (H * 0.7);
            }
            tx = Math.max(35, Math.min(W - 35, tx));
            ty = Math.max(35, Math.min(H - 35, ty));

            const flightTime = 1000 + (i % 6) * 180 + Math.random() * 160;
            GAME_STATE.hazards.push(new BileMortarPod(this.x, this.y, tx, ty, now, now + flightTime));
        }
    }

    performKaiserCleave(now) {
        SoundEngine.behemothCleave();
        this.lastCleaveTime = now;
        const cleaveRange = this.cleaveRadius + 15;
        const halfArc = this.cleaveArc / 2;

        // Damage and knock back players in frontal arc
        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const maxDist = cleaveRange + p.r;
            if (this.distanceToSq(p) <= maxDist * maxDist) {
                const dx = p.x - this.x, dy = p.y - this.y;
                let pAngle = Math.atan2(dy, dx);
                let diff = pAngle - this.facingAngle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                if (Math.abs(diff) <= halfArc) {
                    p.takeDamage(100, now, this);
                    p.isKnockbackAirborne = true;
                    p.knockbackStartX = p.x;
                    p.knockbackStartY = p.y;
                    p.knockbackTargetX = Math.max(20, Math.min(W - 20, p.x + Math.cos(pAngle) * 160));
                    p.knockbackTargetY = Math.max(20, Math.min(H - 20, p.y + Math.sin(pAngle) * 160));
                    p.knockbackStart = now;
                    p.knockbackDuration = 450;
                    spawnHitParticles(p.x, p.y, '#76ff03');
                }
            }
        }

        // Damage turrets in cleave arc
        for (const t of GAME_STATE.turrets) {
            if (!t.alive) continue;
            const maxDist = cleaveRange + t.r;
            if (this.distanceToSq(t) <= maxDist * maxDist) {
                const dx = t.x - this.x, dy = t.y - this.y;
                let tAngle = Math.atan2(dy, dx);
                let diff = tAngle - this.facingAngle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                if (Math.abs(diff) <= halfArc) {
                    t.takeDamage(120, now, this);
                }
            }
        }

        // Cleave slash particles
        for (let i = -10; i <= 10; i++) {
            const a = this.facingAngle + (i / 10) * halfArc;
            const d = this.r + 20 + Math.random() * (this.cleaveRadius - this.r);
            const px = this.x + Math.cos(a) * d;
            const py = this.y + Math.sin(a) * d;
            GAME_STATE.particles.push(new Particle(
                px, py,
                Math.cos(a) * 3, Math.sin(a) * 3,
                Math.random() < 0.6 ? '#76ff03' : '#aeea00', 350
            ));
        }
    }

    performBurrowEruption(now) {
        SoundEngine.mineExplosion(1.4);
        const nydusEruptRadius = 190;

        // Damage and launch players airborne from the Nydus Worm eruption bite & shockwave
        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const maxDist = nydusEruptRadius + p.r;
            const dSq = this.distanceToSq(p);
            if (dSq <= maxDist * maxDist) {
                p.takeDamage(140, now, this);
                const a = dSq > 0.001 ? this.angleTo(p) : Math.random() * Math.PI * 2;
                p.isKnockbackAirborne = true;
                p.knockbackStartX = p.x;
                p.knockbackStartY = p.y;
                p.knockbackTargetX = Math.max(20, Math.min(W - 20, p.x + Math.cos(a) * 220));
                p.knockbackTargetY = Math.max(20, Math.min(H - 20, p.y + Math.sin(a) * 220));
                p.knockbackStart = now;
                p.knockbackDuration = 520;
                spawnHitParticles(p.x, p.y, '#76ff03');
            }
        }

        // Damage turrets in eruption radius
        for (const t of GAME_STATE.turrets) {
            if (!t.alive) continue;
            const maxDist = nydusEruptRadius + t.r;
            if (this.distanceToSq(t) <= maxDist * maxDist) {
                t.takeDamage(150, now, this);
            }
        }

        // Massive Nydus eruption rock, acid, and zerg slime particles
        for (let i = 0; i < 50; i++) {
            const a = Math.random() * Math.PI * 2;
            const spd = 2.0 + Math.random() * 6.5;
            GAME_STATE.particles.push(new Particle(
                this.x, this.y,
                Math.cos(a) * spd, Math.sin(a) * spd,
                Math.random() < 0.4 ? '#76ff03' : (Math.random() < 0.7 ? '#4a148c' : '#3e2723'), 550
            ));
        }
    }

    updateBehemoth(dtFactor, now, target, d, dx, dy) {
        // --- 0. Starcraft 2 Nydus Worm Emergence Sequence ---
        if (this.nydusEmerging) {
            if (typeof SoundEngine !== 'undefined' && SoundEngine.titanUnderground) {
                SoundEngine.titanUnderground();
            }
            const elapsed = now - this.nydusStartTime;
            const progress = Math.max(0, Math.min(1, elapsed / this.nydusDuration));

            if (!this.nydusRoarPlayed && progress >= 0.45) {
                this.nydusRoarPlayed = true;
                SoundEngine.nukeExplosion();
            }

            // Subterranean underground trail particles (progress < 0.35)
            if (progress < 0.35) {
                const sx = this.trailStartX || (this.x < W / 2 ? -80 : W + 80);
                const sy = this.trailStartY || (this.y < H / 2 ? -80 : H + 80);
                const trailFrac = progress / 0.35;
                const curX = sx + (this.x - sx) * trailFrac;
                const curY = sy + (this.y - sy) * trailFrac;
                if (Math.random() < 0.75) {
                    const ang = Math.random() * Math.PI * 2;
                    const spd = 1.5 + Math.random() * 3.5;
                    GAME_STATE.particles.push(new Particle(
                        curX + (Math.random() - 0.5) * 25, curY + (Math.random() - 0.5) * 25,
                        Math.cos(ang) * spd, Math.sin(ang) * spd,
                        Math.random() < 0.5 ? '#5d4037' : '#3e2723', 350
                    ));
                }
            } else {
                // Churning Nydus canal ground particles (progress >= 0.35)
                if (Math.random() < 0.65) {
                    const ang = Math.random() * Math.PI * 2;
                    const dist = Math.random() * 85;
                    const spd = 1.0 + Math.random() * 3.0;
                    GAME_STATE.particles.push(new Particle(
                        this.x + Math.cos(ang) * dist, this.y + Math.sin(ang) * dist,
                        Math.cos(ang) * spd, Math.sin(ang) * spd,
                        Math.random() < 0.4 ? '#76ff03' : (Math.random() < 0.7 ? '#4a148c' : '#3e2723'), 450
                    ));
                }
            }

            if (now >= this.nydusEndTime) {
                this.nydusEmerging = false;
                SoundEngine.mineExplosion(1.4);

                // Destroy all other monsters on the battlefield instantly
                for (const e of GAME_STATE.enemies) {
                    if (e !== this) {
                        e.hp = 0;
                        spawnHitParticles(e.x, e.y, '#76ff03');
                    }
                }
                GAME_STATE.enemies = [this];

                // Massive seismic Nydus eruption hazard shockwave
                GAME_STATE.hazards.push(new NukeExplosion(this.x, this.y, 650, now));
                for (let i = 0; i < 50; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const spd = 2.5 + Math.random() * 6.5;
                    GAME_STATE.particles.push(new Particle(
                        this.x, this.y,
                        Math.cos(a) * spd, Math.sin(a) * spd,
                        Math.random() < 0.4 ? '#76ff03' : (Math.random() < 0.7 ? '#4a148c' : '#5d4037'), 600
                    ));
                }
            }
            return;
        }

        if (!target) return;

        // Keep inside arena boundaries
        this.x = Math.max(this.r, Math.min(W - this.r, this.x));
        this.y = Math.max(this.r, Math.min(H - this.r, this.y));

        const targetAngle = Math.atan2(target.y - this.y, target.x - this.x);

        // Turn towards target smoothly unless locked in charge or burrowed
        if (this.behemothState !== 'trample_charging' && this.behemothState !== 'subterranean_travel') {
            let angleDiff = targetAngle - this.facingAngle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            this.facingAngle += angleDiff * Math.min(1.0, 0.08 * dtFactor);
        }

        // Tusk flexing animation
        this.tuskFlex = Math.sin(now / 180) * 0.15;

        // --- State 1: Pursuit ---
        if (this.behemothState === 'pursuit') {
            // Check attack availability before moving
            const warnMult = GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0;
            if (now >= this.nextBurrowReady) {
                this.behemothState = 'burrowing';
                this.burrowWindupDuration = 650 * warnMult;
                this.stateTimer = now + this.burrowWindupDuration;
                SoundEngine.behemothBurrow();
                return;
            } else if (now >= this.nextMortarReady) {
                this.behemothState = 'mortar_firing';
                this.mortarRoundsLeft = 3;
                this.nextMortarRoundTime = now + 250 * warnMult; // Fire 1st round after windup
                this.stateTimer = now + 2500;
                this.nextMortarReady = now + 12000 + Math.random() * 3000;
                return;
            } else if (now >= this.nextChargeReady && d >= 220) {
                this.behemothState = 'charge_windup';
                this.chargeWindupDuration = 300 * Math.pow(warnMult, 2);
                this.stateTimer = now + this.chargeWindupDuration;
                this.chargeAngle = targetAngle;
                this.nextChargeReady = now + 16000 + Math.random() * 4000;
                return;
            } else if (now >= this.nextTongueReady && d >= 160) {
                this.behemothState = 'tongue_windup';
                this.tongueWindupDuration = 500 * warnMult;
                this.stateTimer = now + this.tongueWindupDuration; // warning line telegraph
                this.tongueAimAngle = targetAngle;
                this.tongueTargetX = this.x + Math.cos(targetAngle) * this.tongueRange;
                this.tongueTargetY = this.y + Math.sin(targetAngle) * this.tongueRange;
                this.heldPlayer = null;
                this.wallPiecePinnedPlayers = [];
                this.nextTongueReady = now + 12000 + Math.random() * 3000;
                return;
            } else if (d <= this.cleaveRadius && now >= this.nextCleaveReady) {
                this.behemothState = 'cleave_windup';
                this.cleaveWindupDuration = 650 * warnMult;
                this.stateTimer = now + this.cleaveWindupDuration;
                this.nextCleaveReady = now + 3600 + Math.random() * 1000;
                return;
            }

            // Movement towards target
            if (d > 0.001) {
                const spd = this.getSpeed(now);
                this.x += Math.cos(this.facingAngle) * spd * dtFactor;
                this.y += Math.sin(this.facingAngle) * spd * dtFactor;
            }

            // Contact damage
            if (d < target.r + this.r && typeof target.takeDamage === 'function') {
                target.takeDamage(this.damage, now, this, true);
            }
        }

        // --- State 2: Cleave Windup ---
        else if (this.behemothState === 'cleave_windup') {
            // Slight slide towards target during windup
            const spd = this.getSpeed(now) * 0.3;
            this.x += Math.cos(this.facingAngle) * spd * dtFactor;
            this.y += Math.sin(this.facingAngle) * spd * dtFactor;

            if (now >= this.stateTimer) {
                this.performKaiserCleave(now);
                this.behemothState = 'pursuit';
            }
        }

        // --- State 3: Mortar Firing (Stands still and fires 3 rounds of acid mortars) ---
        else if (this.behemothState === 'mortar_firing') {
            // Stand completely still (no movement applied)

            // Emits acid vapor and glowing green spores while channeled
            if (Math.random() < 0.6) {
                const a = Math.random() * Math.PI * 2;
                const spd = 1.0 + Math.random() * 2.5;
                GAME_STATE.particles.push(new Particle(
                    this.x + Math.cos(a) * 25, this.y + Math.sin(a) * 25,
                    Math.cos(a) * spd, -1.8 - Math.random() * 2.2,
                    Math.random() < 0.7 ? '#76ff03' : '#aeea00', 400
                ));
            }

            // Shoot rounds at scheduled intervals
            if (this.mortarRoundsLeft > 0 && now >= this.nextMortarRoundTime) {
                this.launchBileMortars(now);
                SoundEngine.behemothMortar();
                this.mortarRoundsLeft--;
                if (this.mortarRoundsLeft > 0) {
                    this.nextMortarRoundTime = now + 650; // 650ms between rounds
                } else {
                    this.stateTimer = now + 400; // 400ms post-barrage recovery before pursuit
                }

                // Explosive launch plume particles from dorsal cannons
                for (let i = 0; i < 16; i++) {
                    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
                    const spd = 3.0 + Math.random() * 4.0;
                    GAME_STATE.particles.push(new Particle(
                        this.x, this.y,
                        Math.cos(ang) * spd, Math.sin(ang) * spd,
                        Math.random() < 0.5 ? '#76ff03' : '#00e676', 450
                    ));
                }
            }

            // Return to pursuit after all 3 rounds are fired and recovery is done
            if (this.mortarRoundsLeft === 0 && now >= this.stateTimer) {
                this.behemothState = 'pursuit';
            }
        }

        // --- State 4: Burrowing into the ground ---
        else if (this.behemothState === 'burrowing') {
            if (typeof SoundEngine !== 'undefined' && SoundEngine.titanUnderground) {
                SoundEngine.titanUnderground();
            }
            if (now >= this.stateTimer) {
                this.burrowed = true;
                this.behemothState = 'subterranean_travel';
                this.stateTimer = now + 2800; // 2.8s underground pursuit
                this.burrowMoundX = this.x;
                this.burrowMoundY = this.y;
                this.burrowTrail = [{ x: this.x, y: this.y }];
            }
        }

        // --- State 5: Subterranean Travel (Wide tunnel pursuit) ---
        else if (this.behemothState === 'subterranean_travel') {
            if (typeof SoundEngine !== 'undefined' && SoundEngine.titanUnderground) {
                SoundEngine.titanUnderground();
            }
            // Move rapidly underground towards closest player until fully underneath
            const tdx = target.x - this.x, tdy = target.y - this.y;
            const td = Math.hypot(tdx, tdy);
            const subSpeed = 3.0;
            if (td > 0.001) {
                const step = subSpeed * dtFactor;
                if (td <= step) {
                    this.x = target.x;
                    this.y = target.y;
                } else {
                    this.x += (tdx / td) * step;
                    this.y += (tdy / td) * step;
                }
            }

            // Append trail points along underground path
            if (!this.burrowTrail) this.burrowTrail = [];
            const lastPt = this.burrowTrail[this.burrowTrail.length - 1];
            const d2 = lastPt ? (this.x - lastPt.x) ** 2 + (this.y - lastPt.y) ** 2 : 0;
            if (!lastPt || d2 >= 324) {
                this.burrowTrail.push({ x: this.x, y: this.y });
                if (this.burrowTrail.length > 60) this.burrowTrail.shift();
            }

            // Dirt churning particles
            if (Math.random() < 0.6) {
                const a = Math.random() * Math.PI * 2;
                const s = 1.0 + Math.random() * 2.5;
                GAME_STATE.particles.push(new Particle(
                    this.x + (Math.random() - 0.5) * 35, this.y + (Math.random() - 0.5) * 35,
                    Math.cos(a) * s, Math.sin(a) * s,
                    Math.random() < 0.5 ? '#5d4037' : '#3e2723', 300
                ));
            }

            // Erupt when fully underneath target player (td <= 10) or when subterranean travel time expires
            const reachedTarget = this.distanceToSq(target) <= 100;
            if (reachedTarget || now >= this.stateTimer) {
                if (reachedTarget) {
                    this.x = target.x;
                    this.y = target.y;
                }
                this.performBurrowEruption(now);
                this.burrowed = false;
                this.behemothState = 'erupting';
                this.eruptStartTime = now;
                this.eruptDuration = 2200;
                this.stateTimer = now + 2200;
            }
        }

        // --- State 6: Erupting from ground (Nydus Worm emergence animation) ---
        else if (this.behemothState === 'erupting') {
            if (now >= this.stateTimer) {
                this.burrowed = false;
                this.behemothState = 'pursuit';
                this.nextBurrowReady = now + 18000 + Math.random() * 4000;
            }
        }

        // --- State 7: Charge Windup ---
        else if (this.behemothState === 'charge_windup') {
            // Stomp dust particles
            if (Math.random() < 0.5) {
                const a = Math.random() * Math.PI * 2;
                GAME_STATE.particles.push(new Particle(
                    this.x + Math.cos(a) * 35, this.y + Math.sin(a) * 35,
                    Math.cos(a) * 2, Math.sin(a) * 2,
                    '#ff1744', 250
                ));
            }

            if (now >= this.stateTimer) {
                this.behemothState = 'trample_charging';
                this.stateTimer = now + 1300; // 1.3s high speed sprint
                if (typeof SoundEngine !== 'undefined' && SoundEngine.titanSprint) {
                    SoundEngine.titanSprint();
                } else {
                    SoundEngine.mineExplosion(1.4);
                }
            }
        }

        // --- State 8: Trample Charging ---
        else if (this.behemothState === 'trample_charging') {
            const spd = this.chargeSpeed * dtFactor;
            this.x += Math.cos(this.chargeAngle) * spd;
            this.y += Math.sin(this.chargeAngle) * spd;

            // Trample trail particles
            for (let i = 0; i < 2; i++) {
                const a = this.chargeAngle + Math.PI + (Math.random() - 0.5) * 1.2;
                const ps = 2.0 + Math.random() * 3.0;
                GAME_STATE.particles.push(new Particle(
                    this.x, this.y,
                    Math.cos(a) * ps, Math.sin(a) * ps,
                    Math.random() < 0.5 ? '#ff1744' : '#76ff03', 300
                ));
            }

            // Damage players in direct path
            for (const p of GAME_STATE.players) {
                if (!p.alive) continue;
                const maxDist = this.r + p.r + 10;
                if (this.distanceToSq(p) <= maxDist * maxDist) {
                    p.takeDamage(90, now, this);
                    // Knockback airborne
                    p.isKnockbackAirborne = true;
                    p.knockbackStartX = p.x;
                    p.knockbackStartY = p.y;
                    p.knockbackTargetX = Math.max(20, Math.min(W - 20, p.x + Math.cos(this.chargeAngle) * 180));
                    p.knockbackTargetY = Math.max(20, Math.min(H - 20, p.y + Math.sin(this.chargeAngle) * 180));
                    p.knockbackStart = now;
                    p.knockbackDuration = 450;
                    spawnHitParticles(p.x, p.y, '#ff1744');
                }
            }

            // Destroy turrets in path
            for (const t of GAME_STATE.turrets) {
                if (!t.alive) continue;
                const maxDist = this.r + t.r + 10;
                if (this.distanceToSq(t) <= maxDist * maxDist) {
                    t.takeDamage(t.hp + 10, now, this);
                }
            }

            // End charge if reached edge or timer expires
            const hitEdge = (this.x <= this.r + 5 || this.x >= W - this.r - 5 || this.y <= this.r + 5 || this.y >= H - this.r - 5);
            if (now >= this.stateTimer || hitEdge) {
                this.behemothState = 'pursuit';
            }
        }

        // --- State 8: Viper Tongue Windup & Warning Line ---
        else if (this.behemothState === 'tongue_windup') {
            if (now >= this.stateTimer) {
                this.behemothState = 'tongue_firing';
                this.tongueActive = true;
                if (typeof SoundEngine !== 'undefined' && SoundEngine.viperTongue) {
                    SoundEngine.viperTongue();
                }
                this.tongueTipX = this.x;
                this.tongueTipY = this.y;
                this.heldPlayer = null;
                this.wallPiecePinnedPlayers = [];
            }
        }

        // --- State 9: Viper Tongue Firing ---
        else if (this.behemothState === 'tongue_firing') {
            const tdx = this.tongueTargetX - this.tongueTipX;
            const tdy = this.tongueTargetY - this.tongueTipY;
            const tdist = Math.hypot(tdx, tdy);
            const step = this.tongueSpeed * dtFactor;

            if (tdist > 0.001) {
                const moveDist = Math.min(step, tdist);
                this.tongueTipX += (tdx / tdist) * moveDist;
                this.tongueTipY += (tdy / tdist) * moveDist;
            }

            // Check collision with alive players
            let caughtPlayer = null;
            for (const p of GAME_STATE.players) {
                if (!p.alive) continue;
                const maxDist = p.r + 16;
                const dx = p.x - this.tongueTipX, dy = p.y - this.tongueTipY;
                if (dx * dx + dy * dy <= maxDist * maxDist) {
                    caughtPlayer = p;
                    break;
                }
            }

            if (caughtPlayer) {
                if (caughtPlayer.viperGrabber && caughtPlayer.viperGrabber !== this) {
                    caughtPlayer.viperGrabber.heldPlayer = null;
                    caughtPlayer.viperGrabber.tongueActive = false;
                }
                caughtPlayer.viperGrabber = this;
                this.heldPlayer = caughtPlayer;
                this.behemothState = 'tongue_dragging_player';
                spawnHitParticles(this.tongueTipX, this.tongueTipY, '#a855f7');
                SoundEngine.meleeSweep(true);
                return;
            }

            // Check collision with battlefield border
            const hitBorder = this.tongueTipX <= 6 || this.tongueTipX >= W - 6 || this.tongueTipY <= 6 || this.tongueTipY >= H - 6;
            if (hitBorder) {
                this.tongueTipX = Math.max(6, Math.min(W - 6, this.tongueTipX));
                this.tongueTipY = Math.max(6, Math.min(H - 6, this.tongueTipY));
                this.wallPieceX = this.tongueTipX;
                this.wallPieceY = this.tongueTipY;
                // Wall slab orientation is orthogonal (perpendicular) to the tongue trajectory
                this.wallPieceAngle = Math.atan2(this.y - this.tongueTipY, this.x - this.tongueTipX) + Math.PI / 2;
                this.wallPiecePinnedPlayers = [];
                this.behemothState = 'tongue_dragging_wall';
                SoundEngine.meleeSweep(true);

                // Wall debris rupture particles
                for (let i = 0; i < 30; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const spd = 2.0 + Math.random() * 5.5;
                    GAME_STATE.particles.push(new Particle(
                        this.wallPieceX, this.wallPieceY,
                        Math.cos(a) * spd, Math.sin(a) * spd,
                        Math.random() < 0.5 ? '#37474f' : (Math.random() < 0.7 ? '#ffd600' : '#76ff03'), 450
                    ));
                }
                return;
            }

            if (tdist <= step) {
                this.tongueActive = false;
                this.behemothState = 'pursuit';
            }
        }

        // --- State 10: Viper Tongue Dragging Player ---
        else if (this.behemothState === 'tongue_dragging_player') {
            if (!this.heldPlayer || !this.heldPlayer.alive || this.heldPlayer.viperGrabber !== this) {
                this.heldPlayer = null;
                this.tongueActive = false;
                this.behemothState = 'pursuit';
                return;
            }

            const pdx = this.x - this.heldPlayer.x, pdy = this.y - this.heldPlayer.y;
            const pdist = Math.hypot(pdx, pdy);
            const dragSpeed = 15.0 * dtFactor;
            const holdDist = this.r + this.heldPlayer.r + 10;

            if (pdist <= holdDist || pdist <= dragSpeed) {
                this.heldPlayer.viperGrabber = null;
                this.heldPlayer = null;
                this.tongueActive = false;
                // Follow up immediately with Kaiser Cleave!
                this.behemothState = 'cleave_windup';
                this.stateTimer = now + 400;
            } else {
                this.heldPlayer.x += (pdx / pdist) * dragSpeed;
                this.heldPlayer.y += (pdy / pdist) * dragSpeed;
                this.heldPlayer.clampToArena();
                this.tongueTipX = this.heldPlayer.x;
                this.tongueTipY = this.heldPlayer.y;
            }
        }

        // --- State 11: Viper Tongue Dragging Torn Wall Piece ---
        else if (this.behemothState === 'tongue_dragging_wall') {
            const wdx = this.x - this.wallPieceX, wdy = this.y - this.wallPieceY;
            const wdist = Math.hypot(wdx, wdy);
            const dragSpeed = 11.5 * dtFactor;
            const targetDist = this.r + 42;

            if (wdist > 0.001) {
                const step = Math.min(dragSpeed, wdist);
                this.wallPieceX += (wdx / wdist) * step;
                this.wallPieceY += (wdy / wdist) * step;
                this.tongueTipX = this.wallPieceX;
                this.tongueTipY = this.wallPieceY;
            }

            // Scraping dust particles
            if (Math.random() < 0.45) {
                const a = Math.random() * Math.PI * 2;
                const spd = 1.0 + Math.random() * 2.5;
                GAME_STATE.particles.push(new Particle(
                    this.wallPieceX + (Math.random() - 0.5) * 20, this.wallPieceY + (Math.random() - 0.5) * 20,
                    Math.cos(a) * spd, Math.sin(a) * spd,
                    Math.random() < 0.5 ? '#37474f' : '#ffd600', 300
                ));
            }

            // Check collision with players during drag (wide orthogonal box)
            const cos = Math.cos(-this.wallPieceAngle);
            const sin = Math.sin(-this.wallPieceAngle);
            for (const p of GAME_STATE.players) {
                if (!p.alive) continue;
                const dx = p.x - this.wallPieceX, dy = p.y - this.wallPieceY;
                const lx = cos * dx - sin * dy;
                const ly = sin * dx + cos * dy;
                const cx = Math.max(-95, Math.min(95, lx));
                const cy = Math.max(-22, Math.min(22, ly));
                const dist = Math.hypot(lx - cx, ly - cy);
                if (dist <= p.r) {
                    if (!this.wallPiecePinnedPlayers.includes(p)) {
                        this.wallPiecePinnedPlayers.push(p);
                        p.takeDamage(60, now, this);
                        SoundEngine.meleeSweep(true);
                        spawnHitParticles(p.x, p.y, '#a8a29e');
                    }
                    // Player is dragged with the wall piece
                    p.x = this.wallPieceX;
                    p.y = this.wallPieceY;
                    p.clampToArena();
                }
            }

            // Wall reached Titan
            if (wdist <= targetDist || wdist <= dragSpeed) {
                this.tongueActive = false;

                // Launch pinned players airborne with knockback
                for (const p of this.wallPiecePinnedPlayers) {
                    if (p.alive) {
                        p.isKnockbackAirborne = true;
                        p.knockbackStartX = p.x;
                        p.knockbackStartY = p.y;
                        p.knockbackTargetX = Math.max(20, Math.min(W - 20, p.x + (p.x - this.x) * 1.5));
                        p.knockbackTargetY = Math.max(20, Math.min(H - 20, p.y + (p.y - this.y) * 1.5));
                        p.knockbackStart = now;
                        p.knockbackDuration = 350;
                    }
                }
                this.wallPiecePinnedPlayers = [];

                // Leave wall piece as permanent wide cliff obstacle in GAME_STATE.terrains
                if (!GAME_STATE.terrains) GAME_STATE.terrains = [];
                GAME_STATE.terrains.push(new WallDebrisObstacle(this.wallPieceX, this.wallPieceY, 95, 22, this.wallPieceAngle));
                SoundEngine.meleeSweep(true);

                this.behemothState = 'pursuit';
            }
        }
    }

    drawSubterraneanTunnel(points, headX, headY, drawHead = true, now) {
        if (!points || points.length === 0) return;
        ctx.save();

        // 1. Outer Massive Churned Dirt Furrow (Wide tunnel scaled for Titan)
        ctx.strokeStyle = '#2d1b00';
        ctx.lineWidth = 76;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.lineTo(headX, headY);
        ctx.stroke();

        // 2. Inner Deep Subterranean Trench
        ctx.strokeStyle = '#081c15';
        ctx.lineWidth = 46;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.lineTo(headX, headY);
        ctx.stroke();

        // 3. Glowing Toxic Fissure Centerline
        ctx.strokeStyle = 'rgba(118, 255, 3, 0.7)';
        ctx.lineWidth = 5;
        ctx.setLineDash([14, 10]);
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.lineTo(headX, headY);
        ctx.stroke();
        ctx.setLineDash([]);

        // 4. Heavy Churned Dirt Humps along the trail
        const humpPoints = [];
        if (points.length > 1) {
            for (const p of points) humpPoints.push(p);
        } else if (points.length === 1) {
            const sx = points[0].x, sy = points[0].y;
            const dist = Math.hypot(headX - sx, headY - sy);
            const count = Math.max(1, Math.floor(dist / 24));
            for (let i = 0; i <= count; i++) {
                const t = i / count;
                humpPoints.push({ x: sx + (headX - sx) * t, y: sy + (headY - sy) * t });
            }
        }
        for (let i = 0; i < humpPoints.length; i++) {
            const p = humpPoints[i];
            const humpR = 24 + Math.sin(i * 1.6 + now * 0.008) * 6;
            ctx.fillStyle = '#3e2723';
            ctx.strokeStyle = '#5d4037';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, humpR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // 5. Churning Burrowing Head Mound at the front
        if (drawHead) {
            const headPulse = 1.0 + 0.15 * Math.sin(now * 0.02);
            const headR = this.r * 0.85 * headPulse;

            // Pulsating seismic shockwave ring around head
            ctx.strokeStyle = 'rgba(118, 255, 3, 0.6)';
            ctx.lineWidth = 3.5;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.arc(headX, headY, headR + 18, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Main dirt mound
            ctx.fillStyle = '#5d4037';
            ctx.strokeStyle = '#76ff03';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(headX, headY, headR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Radial Toxic Fissures
            ctx.strokeStyle = '#76ff03';
            ctx.lineWidth = 2.5;
            for (let i = 0; i < 5; i++) {
                const fa = i * (Math.PI * 2 / 5) + now * 0.003;
                ctx.beginPath();
                ctx.moveTo(headX, headY);
                ctx.lineTo(headX + Math.cos(fa) * headR * 0.95, headY + Math.sin(fa) * headR * 0.95);
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    drawNydusCanalMaw(x, y, progress, now) {
        ctx.save();

        // 1. Expanding Zerg Creep Mound on the Ground
        const creepR = (this.r + 38) * Math.min(1.0, progress * 1.4);
        const creepGrad = ctx.createRadialGradient(x, y, 8, x, y, creepR);
        creepGrad.addColorStop(0, '#10002b');
        creepGrad.addColorStop(0.5, '#240046');
        creepGrad.addColorStop(0.85, '#3c096c');
        creepGrad.addColorStop(1, 'rgba(60, 9, 108, 0)');
        ctx.fillStyle = creepGrad;
        ctx.beginPath();
        ctx.arc(x, y, creepR, 0, Math.PI * 2);
        ctx.fill();

        // 2. Pulsating Seismic Ground Fissures & Shockwave Rings
        const ringPulse = (now * 0.006) % 1;
        ctx.strokeStyle = `rgba(118, 255, 3, ${0.75 * (1 - ringPulse)})`;
        ctx.lineWidth = 3.5;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(x, y, (this.r + 12) + ringPulse * 75, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Radial Toxic Fissures
        ctx.strokeStyle = '#76ff03';
        ctx.lineWidth = 2.5;
        for (let i = 0; i < 6; i++) {
            const fa = i * (Math.PI / 3) + Math.sin(now * 0.003 + i) * 0.2;
            const fLen = creepR * 0.9 * Math.min(1.0, progress * 1.8);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(fa) * fLen, y + Math.sin(fa) * fLen);
            ctx.stroke();
        }

        // 3. Erupting Ground Crater with Inward Chitinous Teeth
        const craterR = this.r * 0.85 * Math.min(1.0, progress * 1.3);
        ctx.fillStyle = '#0a0908';
        ctx.strokeStyle = '#5a189a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, craterR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 4. Towering Animated Nydus Worm Body & Gaping Biting Maw (Active during 0.10 <= progress <= 0.92)
        if (progress >= 0.10 && progress <= 0.92) {
            let wormFrac = 0;
            if (progress < 0.45) {
                wormFrac = (progress - 0.10) / 0.35; // Rising up
            } else if (progress <= 0.70) {
                wormFrac = 1.0; // Thrashing at full height
            } else {
                wormFrac = 1.0 - (progress - 0.70) / 0.22; // Submerging back
            }

            const wormH = 88 * Math.sin(wormFrac * Math.PI / 2);
            const wormTopY = y - wormH;
            const mawRadius = this.r * (0.65 + 0.22 * wormFrac);

            // A. Segmented Ribbed Worm Body Column rising from ground (x, y) to (x, wormTopY)
            const segCount = 4;
            for (let i = 0; i < segCount; i++) {
                const segFrac = i / segCount;
                const segY = y - wormH * segFrac;
                const segR = this.r * (0.82 - segFrac * 0.18);

                ctx.fillStyle = i % 2 === 0 ? '#10002b' : '#240046';
                ctx.strokeStyle = '#5a189a';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.ellipse(x, segY, segR, segR * 0.45, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Segment bio-luminescent acid spine pulse
                ctx.fillStyle = '#76ff03';
                ctx.beginPath();
                ctx.arc(x - segR * 0.45, segY, 3.5, 0, Math.PI * 2);
                ctx.arc(x + segR * 0.45, segY, 3.5, 0, Math.PI * 2);
                ctx.fill();
            }

            // B. Gaping Nydus Maw Top Ring & Bio-Plasma Vortex
            ctx.save();
            ctx.translate(x, wormTopY);

            // Outer chitin head collar
            ctx.fillStyle = '#0a0908';
            ctx.strokeStyle = '#76ff03';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.ellipse(0, 0, mawRadius, mawRadius * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Inner glowing bio-plasma vortex
            const vortexGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, mawRadius * 0.75);
            vortexGrad.addColorStop(0, '#76ff03');
            vortexGrad.addColorStop(0.4, '#00e676');
            vortexGrad.addColorStop(0.8, '#1b4332');
            vortexGrad.addColorStop(1, '#081c15');
            ctx.fillStyle = vortexGrad;
            ctx.beginPath();
            ctx.ellipse(0, 0, mawRadius * 0.75, mawRadius * 0.45, 0, 0, Math.PI * 2);
            ctx.fill();

            // C. 4 Massive Outer Mandible Fangs / Pincers that snap & bite
            const mandibleOpen = (1.0 - wormFrac) * 0.35 + Math.sin(now * 0.015) * 0.08;
            for (let m = 0; m < 4; m++) {
                const baseAng = (m * Math.PI / 2) + Math.PI / 4;
                const jawAng = baseAng + (m % 2 === 0 ? mandibleOpen : -mandibleOpen);
                const fangBaseX = Math.cos(jawAng) * (mawRadius * 0.85);
                const fangBaseY = Math.sin(jawAng) * (mawRadius * 0.55);
                const fangTipX = Math.cos(jawAng) * (mawRadius * 1.5);
                const fangTipY = Math.sin(jawAng) * (mawRadius * 1.1) - 10;

                ctx.fillStyle = '#e8f5e9';
                ctx.strokeStyle = '#1b4332';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(fangBaseX - 6, fangBaseY);
                ctx.quadraticCurveTo(fangBaseX * 1.3, fangBaseY * 1.3, fangTipX, fangTipY);
                ctx.quadraticCurveTo(fangBaseX * 0.9, fangBaseY * 0.9, fangBaseX + 6, fangBaseY);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Toxic venom edge on mandible tips
                ctx.strokeStyle = '#76ff03';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(fangBaseX, fangBaseY);
                ctx.lineTo(fangTipX, fangTipY);
                ctx.stroke();
            }

            // D. Inner Ring of 8 Sharp Razor Teeth
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#1b4332';
            ctx.lineWidth = 1.2;
            for (let t = 0; t < 8; t++) {
                const ta = (t / 8) * Math.PI * 2 + now * 0.002;
                const tbX = Math.cos(ta) * (mawRadius * 0.7);
                const tbY = Math.sin(ta) * (mawRadius * 0.42);
                const tipX = Math.cos(ta) * (mawRadius * 0.32);
                const tipY = Math.sin(ta) * (mawRadius * 0.2);

                ctx.beginPath();
                ctx.moveTo(tbX - 4, tbY);
                ctx.lineTo(tipX, tipY);
                ctx.lineTo(tbX + 4, tbY);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            // E. Spewing Green Acid Plume & Spores while Nydus is erupted
            if (wormFrac > 0.4) {
                ctx.fillStyle = '#76ff03';
                for (let s = 0; s < 4; s++) {
                    const sa = (now * 0.01 + s * 1.5) % (Math.PI * 2);
                    const sDist = (now * 0.06 + s * 12) % 35;
                    ctx.beginPath();
                    ctx.arc(Math.cos(sa) * sDist, -sDist * 0.8, 3 + (s % 2), 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            ctx.restore();
        }

        // 5. Emerging Titan Head / Tusks rising up through the Nydus Maw (0.35 <= progress <= 1.0)
        if (progress > 0.35) {
            const riseFrac = (progress - 0.35) / 0.65;
            const headScale = 0.35 + 0.65 * riseFrac;
            const headOffsetY = (1 - riseFrac) * 36;

            ctx.save();
            ctx.translate(x, y - headOffsetY);
            ctx.scale(headScale, headScale);

            // Rising Carapace
            ctx.fillStyle = '#081c15';
            ctx.strokeStyle = '#76ff03';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(0, 0, this.r * 0.7, this.r * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Tusks
            for (const side of [-1, 1]) {
                const tuskTipX = side * this.r * 1.4;
                const tuskTipY = -this.r * 0.6;
                ctx.fillStyle = '#e8f5e9';
                ctx.strokeStyle = '#76ff03';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(side * this.r * 0.4, 0);
                ctx.quadraticCurveTo(side * this.r * 1.1, 0, tuskTipX, tuskTipY);
                ctx.quadraticCurveTo(side * this.r * 0.8, -this.r * 0.3, side * this.r * 0.2, -this.r * 0.2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            // Glowing eyes
            ctx.fillStyle = '#ffea00';
            ctx.beginPath();
            ctx.arc(-12, -10, 5, 0, Math.PI * 2);
            ctx.arc(12, -10, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }

        ctx.restore();
    }

    drawBehemoth(now) {
        // --- 0. Starcraft 2 Nydus Worm Emergence & Subterranean Trail Visual (Entrance) ---
        if (this.nydusEmerging) {
            const elapsed = now - this.nydusStartTime;
            const progress = Math.max(0, Math.min(1, elapsed / this.nydusDuration));
            const sx = this.trailStartX || (this.x < W / 2 ? -80 : W + 80);
            const sy = this.trailStartY || (this.y < H / 2 ? -80 : H + 80);
            const trailFrac = Math.min(1.0, progress / 0.35); // trail reaches destination at 35%
            const curHeadX = sx + (this.x - sx) * trailFrac;
            const curHeadY = sy + (this.y - sy) * trailFrac;

            // Generate full breadcrumb trail points from spawn edge to head
            const entranceTrail = [];
            const totalDist = Math.hypot(curHeadX - sx, curHeadY - sy);
            const stepCount = Math.max(1, Math.floor(totalDist / 20));
            for (let i = 0; i <= stepCount; i++) {
                const t = i / stepCount;
                entranceTrail.push({
                    x: sx + (curHeadX - sx) * t,
                    y: sy + (curHeadY - sy) * t
                });
            }

            // Draw wide subterranean digging tunnel with churning head mound
            this.drawSubterraneanTunnel(entranceTrail, curHeadX, curHeadY, progress < 0.35, now);

            // Once trail reaches destination (progress >= 0.25), Nydus Canal expands and erupts
            if (progress >= 0.25) {
                const nydusFrac = (progress - 0.25) / 0.75;
                this.drawNydusCanalMaw(this.x, this.y, nydusFrac, now);
            }
            return;
        }

        // --- 1. Subterranean Eruption Visual (Nydus Worm Emergence Animation mid-fight) ---
        if (this.behemothState === 'erupting') {
            const eruptFrac = Math.max(0, Math.min(1, (now - this.eruptStartTime) / (this.eruptDuration || 2200)));
            this.drawSubterraneanTunnel(this.burrowTrail || [{ x: this.x, y: this.y }], this.x, this.y, false, now);
            this.drawNydusCanalMaw(this.x, this.y, eruptFrac, now);
            return;
        }

        // --- 2. Burrowing Down Animation ---
        if (this.behemothState === 'burrowing') {
            const elapsed = 650 - (this.stateTimer - now);
            const sinkFrac = Math.max(0, Math.min(1, elapsed / 650));
            ctx.save();

            // Expanding churning dirt mound & seismic fissure ring
            ctx.fillStyle = '#3e2723';
            ctx.strokeStyle = '#76ff03';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * (0.6 + 0.4 * sinkFrac), 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Sinking Titan scale/offset
            const sinkScale = Math.max(0.1, 1.0 - 0.75 * sinkFrac);
            ctx.translate(this.x, this.y);
            ctx.scale(sinkScale, sinkScale);
            ctx.rotate(this.facingAngle);

            // Sinking carapace & tusks
            ctx.fillStyle = '#081c15';
            ctx.strokeStyle = '#76ff03';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(0, 0, this.r * 0.9, this.r * 0.7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            for (const side of [-1, 1]) {
                const tuskTipX = side * this.r * 1.4;
                const tuskTipY = -this.r * 0.6;
                ctx.fillStyle = '#e8f5e9';
                ctx.strokeStyle = '#76ff03';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(side * this.r * 0.4, 0);
                ctx.quadraticCurveTo(side * this.r * 1.1, 0, tuskTipX, tuskTipY);
                ctx.quadraticCurveTo(side * this.r * 0.8, -this.r * 0.3, side * this.r * 0.2, -this.r * 0.2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            ctx.restore();
            return;
        }

        // --- 3. Subterranean Pursuit Visual (Wide Tunnel & Churned Mound) ---
        if (this.behemothState === 'subterranean_travel') {
            this.drawSubterraneanTunnel(this.burrowTrail || [{ x: this.x, y: this.y }], this.x, this.y, true, now);
            return;
        }

        // --- 2. Cleave Warning Arc Telegraph ---
        if (this.behemothState === 'cleave_windup') {
            ctx.save();
            const windup = this.cleaveWindupDuration || 650;
            const elapsed = windup - (this.stateTimer - now);
            const frac = Math.max(0, Math.min(1, elapsed / windup));
            const halfArc = this.cleaveArc / 2;

            // Warning sweep cone
            ctx.fillStyle = `rgba(255, 23, 68, ${0.15 + 0.25 * frac})`;
            ctx.strokeStyle = `rgba(255, 82, 82, ${0.5 + 0.5 * frac})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.arc(this.x, this.y, this.cleaveRadius * frac, this.facingAngle - halfArc, this.facingAngle + halfArc);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        // --- 4. Sprint / Charge Corridor Telegraph ---
        if (this.behemothState === 'charge_windup') {
            ctx.save();
            const windup = this.chargeWindupDuration || 450;
            const elapsed = windup - (this.stateTimer - now);
            const frac = Math.max(0, Math.min(1, elapsed / windup));
            const beamLen = 1100;
            const halfWidth = this.r + 8;
            const cos = Math.cos(this.chargeAngle), sin = Math.sin(this.chargeAngle);
            const perpX = -sin * halfWidth, perpY = cos * halfWidth;

            ctx.fillStyle = `rgba(255, 23, 68, ${0.12 + 0.25 * frac})`;
            ctx.strokeStyle = `rgba(255, 23, 68, ${0.45 + 0.55 * frac})`;
            ctx.lineWidth = 3;
            ctx.setLineDash([10, 8]);
            ctx.beginPath();
            ctx.moveTo(this.x + perpX, this.y + perpY);
            ctx.lineTo(this.x + cos * beamLen + perpX, this.y + sin * beamLen + perpY);
            ctx.lineTo(this.x + cos * beamLen - perpX, this.y + sin * beamLen - perpY);
            ctx.lineTo(this.x - perpX, this.y - perpY);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        // --- 4. Main Behemoth Titan Body ---
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.facingAngle);

        // Ground shadow
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.ellipse(0, 8, this.r * 1.15, this.r * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 4 Spiked Chitinous Flank Legs
        ctx.fillStyle = '#081c15';
        ctx.strokeStyle = '#1b4332';
        ctx.lineWidth = 3;
        for (const side of [-1, 1]) {
            for (let leg = 0; leg < 2; leg++) {
                const legAngle = side * (0.6 + leg * 0.7) + Math.sin(now / 110 + leg) * 0.1;
                const legLen = this.r * (1.1 + leg * 0.15);
                ctx.beginPath();
                ctx.moveTo(0, side * this.r * 0.5);
                ctx.lineTo(Math.cos(legAngle) * legLen, Math.sin(legAngle) * legLen);
                ctx.stroke();

                // Spiked claw tip
                ctx.beginPath();
                ctx.arc(Math.cos(legAngle) * legLen, Math.sin(legAngle) * legLen, 5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Segmented Chitinous Dorsal Carapace (4 overlapping plates)
        const plateColors = ['#081c15', '#1b4332', '#2d6a4f', '#40916c'];
        // Subterranean Tremor Dust & Acid Bubble Ripples when emerging
        if (this.behemothState === 'erupting') {
            const eruptProgress = Math.max(0, (this.stateTimer - now) / 450);
            ctx.strokeStyle = `rgba(118, 255, 3, ${0.8 * eruptProgress})`;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, 0, this.r * (1.2 + 0.8 * (1 - eruptProgress)), 0, Math.PI * 2);
            ctx.stroke();
        }

        // 1. Massive segmented chitin carapace backplates
        for (let i = 4; i >= 0; i--) {
            const plateR = this.r * (0.85 - i * 0.08);
            const plateX = -i * (this.r * 0.24);
            const breathe = Math.sin(now / 180 + i) * 2;

            ctx.fillStyle = i % 2 === 0 ? '#081c15' : '#1b4332';
            ctx.strokeStyle = '#2d6a4f';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(plateX, 0, plateR + breathe, plateR * 0.85 + breathe, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // Bio-luminescent Acid Spine Conduits
        const isMortar = this.behemothState === 'mortar_firing';
        ctx.fillStyle = isMortar ? '#aeea00' : '#76ff03';
        for (let i = 0; i < 5; i++) {
            const nodeX = -this.r * 0.55 + i * (this.r * 0.25);
            const nodePulse = (isMortar ? 6.5 : 4.5) + Math.sin(now / (isMortar ? 50 : 100) + i) * (isMortar ? 2.5 : 1.5);
            ctx.beginPath();
            ctx.arc(nodeX, 0, nodePulse, 0, Math.PI * 2);
            ctx.fill();
            // Glow layer
            ctx.fillStyle = isMortar ? 'rgba(174, 234, 0, 0.4)' : 'rgba(118, 255, 3, 0.4)';
            ctx.beginPath();
            ctx.arc(nodeX, 0, nodePulse * 1.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = isMortar ? '#aeea00' : '#76ff03';
        }

        // Dual Massive Curved Kaiser Scythe Tusks (Animated Pushing / Slicing Motion)
        let flex = this.tuskFlex || 0;
        let tuskThrust = 0;
        if (this.behemothState === 'cleave_windup') {
            const windupFrac = Math.max(0, Math.min(1, (650 - (this.stateTimer - now)) / 650));
            flex = -0.55 * windupFrac;
        } else if (this.lastCleaveTime && now - this.lastCleaveTime < 450) {
            const sliceFrac = (now - this.lastCleaveTime) / 450;
            flex = 1.15 * Math.sin((1 - sliceFrac) * Math.PI);
            tuskThrust = 28 * Math.sin((1 - sliceFrac) * Math.PI);
        } else if (this.behemothState === 'trample_charging') {
            flex = 0.45 + 0.35 * Math.sin(now / 45);
            tuskThrust = 16 * Math.abs(Math.sin(now / 45));
        } else if (this.behemothState === 'erupting') {
            const eruptFrac = Math.max(0, (this.stateTimer - now) / 450);
            flex = 0.85 * Math.sin(eruptFrac * Math.PI);
            tuskThrust = 22 * Math.sin(eruptFrac * Math.PI);
        }

        const tuskLen = this.r * 1.85 + tuskThrust;
        for (const side of [-1, 1]) {
            const baseAngle = side * (0.45 + flex * 0.7);
            const tuskTipAngle = side * (0.15 - flex * 0.55);

            ctx.fillStyle = '#e8f5e9';
            ctx.strokeStyle = '#1b4332';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(this.r * 0.3 + tuskThrust * 0.3, side * this.r * 0.6);
            ctx.quadraticCurveTo(
                this.r * 1.2 * Math.cos(baseAngle) + tuskThrust * 0.5, this.r * 1.2 * Math.sin(baseAngle),
                tuskLen * Math.cos(tuskTipAngle), tuskLen * Math.sin(tuskTipAngle)
            );
            ctx.quadraticCurveTo(
                this.r * 1.1 * Math.cos(baseAngle * 0.7) + tuskThrust * 0.3, this.r * 1.1 * Math.sin(baseAngle * 0.7),
                this.r * 0.7 + tuskThrust * 0.3, side * this.r * 0.25
            );
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.strokeStyle = '#76ff03';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(this.r * 0.3 + tuskThrust * 0.3, side * this.r * 0.6);
            ctx.quadraticCurveTo(
                this.r * 1.2 * Math.cos(baseAngle) + tuskThrust * 0.5, this.r * 1.2 * Math.sin(baseAngle),
                tuskLen * Math.cos(tuskTipAngle), tuskLen * Math.sin(tuskTipAngle)
            );
            ctx.stroke();
        }

        // Heavy Armored Head & Glowing Amber/Green Eyes
        ctx.fillStyle = '#081c15';
        ctx.strokeStyle = '#2d6a4f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(this.r * 0.5, 0, this.r * 0.35, this.r * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffea00';
        ctx.beginPath();
        ctx.arc(this.r * 0.65, -8, 4, 0, Math.PI * 2);
        ctx.arc(this.r * 0.65, 8, 4, 0, Math.PI * 2);
        ctx.fill();
        // Eye Glow
        ctx.fillStyle = 'rgba(255, 234, 0, 0.4)';
        ctx.beginPath();
        ctx.arc(this.r * 0.65, -8, 7, 0, Math.PI * 2);
        ctx.arc(this.r * 0.65, 8, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // --- 5. Titan Viper Tongue & Wall Drag Warning Area Telegraph ---
        if (this.behemothState === 'tongue_windup' || this.behemothState === 'tongue_firing' || this.behemothState === 'tongue_dragging_wall') {
            ctx.save();

            const aimAngle = (typeof this.tongueAimAngle === 'number') ? this.tongueAimAngle : this.facingAngle;
            const cosA = Math.cos(aimAngle);
            const sinA = Math.sin(aimAngle);
            const minBorder = 6;
            const maxBorderX = W - 6;
            const maxBorderY = H - 6;

            let tBorder = Infinity;
            if (cosA > 0.0001) {
                const t = (maxBorderX - this.x) / cosA;
                if (t > 0 && t < tBorder) tBorder = t;
            } else if (cosA < -0.0001) {
                const t = (minBorder - this.x) / cosA;
                if (t > 0 && t < tBorder) tBorder = t;
            }
            if (sinA > 0.0001) {
                const t = (maxBorderY - this.y) / sinA;
                if (t > 0 && t < tBorder) tBorder = t;
            } else if (sinA < -0.0001) {
                const t = (minBorder - this.y) / sinA;
                if (t > 0 && t < tBorder) tBorder = t;
            }
            if (!Number.isFinite(tBorder)) tBorder = this.tongueRange || 1500;

            const borderX = Math.max(minBorder, Math.min(maxBorderX, this.x + cosA * tBorder));
            const borderY = Math.max(minBorder, Math.min(maxBorderY, this.y + sinA * tBorder));

            const startDragX = (this.behemothState === 'tongue_dragging_wall' && typeof this.wallPieceX === 'number') ? this.wallPieceX : borderX;
            const startDragY = (this.behemothState === 'tongue_dragging_wall' && typeof this.wallPieceY === 'number') ? this.wallPieceY : borderY;

            const targetDist = this.r + 42;
            const destAngle = Math.atan2(startDragY - this.y, startDragX - this.x);
            const destX = this.x + Math.cos(destAngle) * targetDist;
            const destY = this.y + Math.sin(destAngle) * targetDist;

            const wallAngle = Math.atan2(this.y - startDragY, this.x - startDragX) + Math.PI / 2;
            const perpX = Math.cos(wallAngle);
            const perpY = Math.sin(wallAngle);
            const halfW = 95;
            const halfH = 22;

            const p1x = startDragX + perpX * halfW, p1y = startDragY + perpY * halfW;
            const p2x = startDragX - perpX * halfW, p2y = startDragY - perpY * halfW;
            const p3x = destX - perpX * halfW, p3y = destY - perpY * halfW;
            const p4x = destX + perpX * halfW, p4y = destY + perpY * halfW;

            const pulse = 0.5 + 0.5 * Math.sin(now / 70);

            ctx.fillStyle = `rgba(239, 68, 68, ${0.08 + 0.08 * pulse})`;
            ctx.beginPath();
            ctx.moveTo(p1x, p1y);
            ctx.lineTo(p2x, p2y);
            ctx.lineTo(p3x, p3y);
            ctx.lineTo(p4x, p4y);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = `rgba(245, 158, 11, ${0.55 + 0.35 * pulse})`;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([14, 10]);
            ctx.lineDashOffset = -(now / 20);

            ctx.beginPath();
            ctx.moveTo(p1x, p1y);
            ctx.lineTo(p4x, p4y);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(p2x, p2y);
            ctx.lineTo(p3x, p3y);
            ctx.stroke();
            ctx.setLineDash([]);

            const dragDist = Math.hypot(destX - startDragX, destY - startDragY);
            if (dragDist > 60) {
                const chevronCount = Math.floor(dragDist / 70);
                const inwardAngle = Math.atan2(this.y - startDragY, this.x - startDragX);
                const animOffset = ((now / 25) % 70) / dragDist;

                ctx.strokeStyle = `rgba(255, 234, 0, ${0.4 + 0.4 * pulse})`;
                ctx.lineWidth = 2.5;
                ctx.lineCap = 'round';
                for (let i = 0; i <= chevronCount; i++) {
                    const frac = (i / chevronCount + animOffset) % 1.0;
                    const cx = startDragX + (destX - startDragX) * frac;
                    const cy = startDragY + (destY - startDragY) * frac;

                    const wingLen = 22;
                    const wingAng1 = inwardAngle + Math.PI * 0.75;
                    const wingAng2 = inwardAngle - Math.PI * 0.75;
                    ctx.beginPath();
                    ctx.moveTo(cx + Math.cos(wingAng1) * wingLen, cy + Math.sin(wingAng1) * wingLen);
                    ctx.lineTo(cx, cy);
                    ctx.lineTo(cx + Math.cos(wingAng2) * wingLen, cy + Math.sin(wingAng2) * wingLen);
                    ctx.stroke();
                }
            }

            ctx.save();
            ctx.translate(borderX, borderY);
            ctx.rotate(wallAngle);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.7 + 0.3 * pulse})`;
            ctx.lineWidth = 2.0;
            ctx.setLineDash([8, 6]);
            ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);
            ctx.fillStyle = `rgba(239, 68, 68, ${0.15 + 0.1 * pulse})`;
            ctx.fillRect(-halfW, -halfH, halfW * 2, halfH * 2);
            ctx.restore();

            ctx.save();
            ctx.translate(destX, destY);
            ctx.rotate(wallAngle);
            ctx.strokeStyle = `rgba(245, 158, 11, ${0.6 + 0.3 * pulse})`;
            ctx.lineWidth = 2.0;
            ctx.setLineDash([6, 6]);
            ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);
            ctx.fillStyle = `rgba(245, 158, 11, 0.10)`;
            ctx.fillRect(-halfW, -halfH, halfW * 2, halfH * 2);
            ctx.restore();

            if (this.behemothState === 'tongue_windup') {
                const elapsed = 500 - (this.stateTimer - now);
                const frac = Math.max(0, Math.min(1, elapsed / 500));
                const mx = this.x + Math.cos(this.facingAngle) * (this.r * 0.6);
                const my = this.y + Math.sin(this.facingAngle) * (this.r * 0.6);

                ctx.strokeStyle = `rgba(220, 38, 38, ${0.4 + 0.6 * frac})`;
                ctx.lineWidth = 3 + 4 * frac;
                ctx.setLineDash([12, 8]);
                ctx.beginPath();
                ctx.moveTo(mx, my);
                ctx.lineTo(borderX, borderY);
                ctx.stroke();

                ctx.strokeStyle = `rgba(254, 202, 202, ${0.7 + 0.3 * frac})`;
                ctx.lineWidth = 2;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(mx, my);
                ctx.lineTo(borderX, borderY);
                ctx.stroke();
            }

            ctx.restore();
        }

        // --- 6. Titan Viper Tongue & Dragged Wall Piece Visual ---
        if (this.tongueActive || this.behemothState === 'tongue_firing' || this.behemothState === 'tongue_dragging_player' || this.behemothState === 'tongue_dragging_wall') {
            ctx.save();
            const mx = this.x + Math.cos(this.facingAngle) * (this.r * 0.6);
            const my = this.y + Math.sin(this.facingAngle) * (this.r * 0.6);
            const tx = this.tongueTipX, ty = this.tongueTipY;

            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(tx, ty);
            ctx.stroke();

            ctx.strokeStyle = '#fee2e2';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(tx, ty);
            ctx.stroke();

            const cordDist = Math.hypot(tx - mx, ty - my);
            const segCount = Math.max(3, Math.floor(cordDist / 38));
            ctx.fillStyle = '#991b1b';
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1.5;
            for (let i = 1; i < segCount; i++) {
                const frac = i / segCount;
                const nx = mx + (tx - mx) * frac;
                const ny = my + (ty - my) * frac;
                const nodePulse = 5 + Math.sin(now / 80 + i) * 2;
                ctx.beginPath();
                ctx.arc(nx, ny, nodePulse, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }

            ctx.fillStyle = '#ef4444';
            ctx.strokeStyle = '#7f1d1d';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(tx, ty, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.restore();

            if (this.behemothState === 'tongue_dragging_wall') {
                const tempObstacle = new WallDebrisObstacle(this.wallPieceX, this.wallPieceY, 95, 22, this.wallPieceAngle);
                tempObstacle.draw(now);
            }
        }

        // --- 6. Floating Boss HP Bar & Label ---
        const barW = 110, barH = 9;
        const bx = this.x - barW / 2, by = this.y - this.r - 22;
        ctx.save();
        ctx.fillStyle = '#111';
        ctx.fillRect(bx, by, barW, barH);
        const hpFrac = Math.max(0, this.hp / this.maxHp);
        ctx.fillStyle = hpFrac > 0.5 ? '#76ff03' : hpFrac > 0.25 ? '#ffea00' : '#ff1744';
        ctx.fillRect(bx, by, barW * hpFrac, barH);
        ctx.strokeStyle = '#76ff03';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, barW, barH);

        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx + barW * 0.5, by); ctx.lineTo(bx + barW * 0.5, by + barH);
        ctx.moveTo(bx + barW * 0.25, by); ctx.lineTo(bx + barW * 0.25, by + barH);
        ctx.stroke();

        ctx.fillStyle = '#000000';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('THE BEHEMOTH', this.x + 1, by - 4);
        ctx.fillStyle = '#76ff03';
        ctx.fillText('THE BEHEMOTH', this.x, by - 5);
        ctx.restore();
    }

    update(dtFactor = 1.0, now) {
        if (this.updateKnockbackAirborne(now)) return;
        const info = this.getTarget(now);
        const target = info.target;
        if (!target) return;
        const dx = target.x - this.x, dy = target.y - this.y;
        const d = Math.hypot(dx, dy);
        this.updateBehemoth(dtFactor, now, target, d, dx, dy);
    }

    draw(now) {
        if (!this.alive || this.hp <= 0) return;
        this.drawBehemoth(now);
        this.drawCryoOverlay(now);
    }
}

// Global Window Exports
window.Enemy = Enemy;
window.BossEnemy = BossEnemy;
window.BruteEnemy = BruteEnemy;
window.SpeederEnemy = SpeederEnemy;
window.DasherEnemy = DasherEnemy;
window.ShooterEnemy = ShooterEnemy;
window.MeteorEnemy = MeteorEnemy;
window.SpikyEnemy = SpikyEnemy;
window.BanelingEnemy = BanelingEnemy;
window.MarauderEnemy = MarauderEnemy;
window.StalkerEnemy = StalkerEnemy;
window.ZerglingEnemy = ZerglingEnemy;
window.SpineCrawlerEnemy = SpineCrawlerEnemy;
window.SentryEnemy = SentryEnemy;
window.MedivacEnemy = MedivacEnemy;
window.WarpAnomalyEnemy = WarpAnomalyEnemy;
window.HellionEnemy = HellionEnemy;
window.ShieldBearerEnemy = ShieldBearerEnemy;
window.ViperEnemy = ViperEnemy;
window.OctopusBoss = OctopusBoss;
window.FelhoundBoss = FelhoundBoss;
window.BehemothBoss = BehemothBoss;
