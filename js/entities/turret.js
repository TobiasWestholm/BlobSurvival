class TurretEntity extends Unit {
    constructor(x, y, player, now) {
        const turretMaxHp = GAME_CONFIG.TURRET.BASE_HP * (player ? player.buildingHealthModifier : 1.0);
        super(x, y, 12, turretMaxHp);
        this.player = player;
        this.spawnTime = now;
        this.duration = (GAME_CONFIG.TURRET.LIFETIME_SEC * 1000) * (player ? player.buildingDurationModifier : 1.0);
        this.hitCooldown = new Map();
        this.isFlamethrower = player ? !!player.turretFlamethrowerEnabled : false;
        this.baseAttackCooldown = GAME_CONFIG.TURRET.ATTACK_COOLDOWN_MS;
        this.attackCount = 0;
        this.flameAttackCount = 0;
        this.lastFire = now;
        this.angle = 0; // Independent angle for Head 1 (Missiles)
        this.flameAngle = 0; // Independent angle for Head 2 (Flamethrower)
        this.baseSpread = 0.18;
        this.baseDamage = GAME_CONFIG.TURRET.BASE_DAMAGE;
        this.flameDamage = GAME_CONFIG.TURRET.BASE_DAMAGE * GAME_CONFIG.TURRET.FLAME_DAMAGE_MULT;
        this.projectileSpeed = GAME_CONFIG.TURRET.PROJECTILE_SPEED;
        this.connections = []; // Array of connected TurretEntity instances

        // Flamethrower sweep animation state
        this.flameActiveUntil = 0;
        this.flameCenterAngle = 0;

        if (this.player && (this.player.laserWallsEnabled || this.player.slowWallsEnabled)) {
            this.linkWalls();
        }
    }
    get flameRange() {
        return (this.player && this.player.turretFullSweepEnabled) ? GAME_CONFIG.TURRET.FLAME_SWEEP_RANGE : GAME_CONFIG.TURRET.FLAME_BASE_RANGE;
    }
    get flameConeWidth() {
        return (this.player && this.player.turretFullSweepEnabled) ? (Math.PI * 2) : (GAME_CONFIG.TURRET.FLAME_BASE_CONE_DEG * Math.PI / 180);
    }

    linkWalls() {
        const MAX_DIST = 300;
        const candidates = [];
        for (const tur of GAME_STATE.turrets) {
            if (tur.alive && tur !== this && tur.connections && tur.connections.length < 2) {
                const dx = tur.x - this.x;
                const dy = tur.y - this.y;
                const d2 = dx * dx + dy * dy;
                if (d2 <= MAX_DIST * MAX_DIST && d2 > 0.001) {
                    candidates.push({ turret: tur, dist2: d2 });
                }
            }
        }

        candidates.sort((a, b) => a.dist2 - b.dist2);

        if (candidates.length === 1) {
            const t0 = candidates[0].turret;
            if (!this.connections.includes(t0)) this.connections.push(t0);
            if (!t0.connections.includes(this)) t0.connections.push(this);
        } else if (candidates.length > 1) {
            const zeroConnIndex = candidates.findIndex(c => c.turret.connections.length === 0);
            if (zeroConnIndex !== -1) {
                const p1 = candidates[zeroConnIndex].turret;
                const remaining = candidates.filter((_, idx) => idx !== zeroConnIndex);
                const p2 = remaining[0].turret;

                if (!this.connections.includes(p1)) this.connections.push(p1);
                if (!p1.connections.includes(this)) p1.connections.push(this);

                if (!this.connections.includes(p2)) this.connections.push(p2);
                if (!p2.connections.includes(this)) p2.connections.push(this);
            } else {
                const t0 = candidates[0].turret;
                if (!this.connections.includes(t0)) this.connections.push(t0);
                if (!t0.connections.includes(this)) t0.connections.push(this);
            }
        }
    }
    dispenseItem(now) {
        const drops = ['health', 'xp_cluster', 'aegis', 'nitro', 'magnet', 'nuke', 'freeze', 'overclock'];
        const type = drops[Math.floor(Math.random() * drops.length)];

        const angle = Math.random() * Math.PI * 2;
        const spd = 1.5 + Math.random() * 2.0;
        const vx = Math.cos(angle) * spd;
        const vy = Math.sin(angle) * spd;

        // Pouch flash color + timing so the turret can signal the payout
        this.lastDispenseColor = type === 'health' ? '#ff3366' : (type === 'xp_cluster' ? '#00ffcc' : '#ffff00');
        this.dispenseFlashUntil = (typeof now === 'number' ? now : gameClock) + 260;

        if (type === 'health') {
            const hp = new HealthPack(this.x, this.y, now);
            hp.vx = vx; hp.vy = vy;
            GAME_STATE.gems.push(hp);
            spawnHitParticles(this.x, this.y, '#ff3366');
        } else if (type === 'xp_cluster') {
            XPGem.createXPGems(this.x, this.y, GAME_CONFIG.SUPPLIES.XP_CLUSTER_XP);
            spawnHitParticles(this.x, this.y, '#00ffcc');
        } else {
            const drop = new SupplyDrop(this.x, this.y, type, now);
            drop.vx = vx; drop.vy = vy;
            GAME_STATE.gems.push(drop);
            spawnHitParticles(this.x, this.y, '#ffff00');
        }
        SoundEngine.supplyDrop();
    }
    takeDamage(amount, now, source) {
        if (!this.isAlive() || amount <= 0) return false;
        if (source) {
            const nextHit = this.hitCooldown.get(source) || 0;
            if (now < nextHit) return false;
            const cooldownMs = (source instanceof Enemy && source.isPassingThroughLaserFence()) ? 500 : 200;
            this.hitCooldown.set(source, now + cooldownMs);
        }
        const reduction = this.player ? this.player.damageReduction : 1.0;
        const effectiveDmg = amount * GAME_STATE.difficulty.takenMult * reduction;
        this.hp = Math.max(0, this.hp - effectiveDmg);
        this.onTakeDamage(effectiveDmg, now, source);

        if (this.hp <= 0) {
            this.hp = 0;
            this.despawn(now, source);
        }
        return true;
    }

    onTakeDamage(amount, now, source) {
        spawnHitParticles(this.x, this.y, '#ffaa00');

        if (source instanceof Enemy && !source.isBoss()) {
            source.turretTarget = this;
            if (source.lunging) {
                source.attackPauseUntil = Math.max(source.attackPauseUntil || 0, (source.lungeUntil || now) + 300);
            } else {
                source.attackPauseUntil = Math.max(source.attackPauseUntil || 0, now + 300);
                source.vx = 0;
                source.vy = 0;
            }
        }

        let reflectTarget = null;
        if (source instanceof Enemy) {
            reflectTarget = source;
        } else if (source && source.sourceEnemy instanceof Enemy) {
            reflectTarget = source.sourceEnemy;
        }
        if (this.player && this.player.reflectDamageEnabled && reflectTarget && typeof reflectTarget.hp === 'number' && reflectTarget.hp > 0) {
            const reflectDmg = this.maxHp * (GAME_CONFIG.UPGRADES.REFLECT_DAMAGE_TURRET_MAX_HP_PCT / 100);
            reflectTarget.hp -= reflectDmg;
            spawnHitParticles(reflectTarget.x, reflectTarget.y, '#ff3333');
        }
    }

    onDeath(now, source) {
        for (const conn of this.connections) {
            const idx = conn.connections.indexOf(this);
            if (idx !== -1) conn.connections.splice(idx, 1);
        }
        this.connections = [];
        for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 1.0 + Math.random() * 3.5;
            GAME_STATE.particles.push(new Particle(this.x, this.y, Math.cos(a) * s, Math.sin(a) * s, '#ff4444', 450));
        }
    }
    update(dt, dtFactor, now) {
        if (now - this.spawnTime >= this.duration) {
            this.despawn(now);
            return;
        }

        // Sawblade Turrets continuation upgrade: continuous 15 dmg/s to all nearby monsters (50px range * Extended Joints)
        if (this.player && this.player.turretSawEnabled) {
            if (!this.sawHitCooldown) this.sawHitCooldown = new Map();
            const sawRadius = GAME_CONFIG.TURRET.SAW_RADIUS * (this.player.meleeRangeModifier || 1.0) * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
            const dmgPerSec = GAME_CONFIG.TURRET.SAW_DPS * this.player.damageModifier * GAME_STATE.dmgFactor;
            const dmgThisFrame = dmgPerSec * (dt / 1000);
            const sawBox = sawRadius + 85;

            SPATIAL_GRID.queryBox(this.x - sawBox, this.x + sawBox, this.y - sawBox, this.y + sawBox, e => {
                if (!isTargetable(e)) return;
                const dx = e.x - this.x;
                const dy = e.y - this.y;
                if (dx * dx + dy * dy <= (sawRadius + e.r) * (sawRadius + e.r) ) {
                    e.hp -= dmgThisFrame;
                    const nextParticleTime = this.sawHitCooldown.get(e) || 0;
                    if (now >= nextParticleTime) {
                        this.sawHitCooldown.set(e, now + 120);
                        spawnHitParticles(e.x, e.y, '#cccccc');
                    }
                }
            });
        }



        // Dispenser chance every interval (scaled by buildingCooldownModifier) if Supply Dispenser is unlocked
        if (this.player && this.player.turretDispenserEnabled) {
            if (!this.lastDispenseCheck) this.lastDispenseCheck = now;
            const dispenserInterval = (GAME_CONFIG.TURRET.DISPENSER_INTERVAL_SEC * 1000) * (this.player.buildingCooldownModifier || 1.0);
            if (now - this.lastDispenseCheck >= dispenserInterval) {
                this.lastDispenseCheck = now;
                if (Math.random() < (GAME_CONFIG.TURRET.DISPENSER_CHANCE_PCT / 100)) {
                    this.dispenseItem(now);
                    // Payout burst: item-colored starburst + soft pouch puff as the drop is expelled
                    const pouchColor = this.lastDispenseColor || '#ffff88';
                    for (let i = 0; i < 12; i++) {
                        const a = Math.random() * Math.PI * 2;
                        const s = 0.8 + Math.random() * 2.2;
                        GAME_STATE.particles.push(new Particle(this.x, this.y - 2, Math.cos(a) * s, -0.4 - Math.random() * 0.9, pouchColor, 480 + Math.random() * 200));
                    }
                    for (let i = 0; i < 6; i++) {
                        const a = Math.random() * Math.PI * 2;
                        const s = 0.6 + Math.random() * 1.4;
                        GAME_STATE.particles.push(new Particle(this.x, this.y - 2, Math.cos(a) * s, Math.sin(a) * s, '#ffffff', 380));
                    }
                    for (let i = 0; i < 5; i++) {
                        const a = Math.random() * Math.PI;
                        const s = 0.4 + Math.random() * 0.8;
                        GAME_STATE.particles.push(new Particle(this.x, this.y + 4, Math.cos(a) * s, -0.3 - Math.random() * 0.5, '#ffffff', 300));
                    }
                }
            }
        }

        // Turret attack speed scales with player.cooldownModifier and Turret Overclock
        const isOverclocked = (GAME_STATE.turretOverclockUntil && now < GAME_STATE.turretOverclockUntil);
        const attackCd = (this.baseAttackCooldown * this.player.cooldownModifier) * (isOverclocked ? 0.5 : 1.0);
        if (now - this.lastFire >= attackCd && GAME_STATE.enemies.length > 0) {
            // --- Head 1: Main Missile/Laser Head (targets closest overall enemy) ---
            const closestMissile = Unit.findClosest(this, GAME_STATE.enemies, Infinity, isTargetable);

            if (closestMissile) {
                this.lastFire = now;
                this.attackCount++;
                const targetAngle = Math.atan2(closestMissile.y - this.y, closestMissile.x - this.x);
                this.angle = targetAngle; // Head 1 independently tracks closest enemy

                const dmg = this.baseDamage * this.player.damageModifier * GAME_STATE.dmgFactor;
                SoundEngine.missileFire(0.20);

                if (this.player && this.player.instantMissileEnabled) {
                    fireInstantMissile(this.x, this.y, closestMissile, dmg, false, 0, now, this.player, this.unitType, true, this);
                } else {
                    const spreadAngle = targetAngle + (Math.random() - 0.5) * this.baseSpread * this.player.accuracyModifier;
                    const kind = (this.player.accuracyModifier === 0) ? 'laser' : 'missile';
                    const effSpeed = this.projectileSpeed * (this.player.accuracyModifier === 0 ? 1.5 : 1.0);
                    const vx = Math.cos(spreadAngle) * effSpeed;
                    const vy = Math.sin(spreadAngle) * effSpeed;

                    const proj = new MagicMissileProjectile(this.x, this.y, vx, vy, dmg, kind, this.player, null, this.unitType, now);
                    proj.sourceTurret = true;
                    GAME_STATE.projectiles.push(proj);
                }

                // Seeking rocket for turrets (5% chance, 50% damage)
                if (this.player && this.player.rocketEnabled && Math.random() < 0.05) {
                    const rAngle = Math.random() * Math.PI * 2;
                    const rDmg = 30 * this.player.damageModifier * GAME_STATE.dmgFactor;
                    GAME_STATE.projectiles.push(new RocketProjectile(this.x, this.y, rAngle, rDmg, this.player, now, this.unitType));
                    SoundEngine.rocketLaunch();
                }

                // Sniper shot for turrets (every 4th attack, 50% damage)
                if (this.player && this.player.sniperShotEnabled && (this.attackCount % 4 === 0)) {
                    let strongest = null;
                    let highestMaxHp = -999999;
                    let minD2 = Infinity;
                    for (const e of GAME_STATE.enemies) {
                        if (!isTargetable(e)) continue;
                        const dx = e.x - this.x;
                        const dy = e.y - this.y;
                        const d2 = dx * dx + dy * dy;
                        const enemyMaxHp = e.maxHp || e.hp;
                        if (enemyMaxHp > highestMaxHp) {
                            highestMaxHp = enemyMaxHp;
                            minD2 = d2;
                            strongest = e;
                        } else if (enemyMaxHp === highestMaxHp && d2 < minD2) {
                            minD2 = d2;
                            strongest = e;
                        }
                    }
                    if (strongest) {
                        const angle = Math.atan2(strongest.y - this.y, strongest.x - this.x);
                        const turretDmg = this.baseDamage * this.player.damageModifier * GAME_STATE.dmgFactor;
                        const mult = this.player.laserSniperEnabled ? 5.0 : 3.0;
                        const sniperDmg = turretDmg * mult * 0.5;
                        GAME_STATE.projectiles.push(new SniperProjectile(this.x, this.y, angle, sniperDmg, this.player, now, this.unitType));
                        SoundEngine.laserSniper();
                    }
                }
            }

            // --- Head 2: Independent Flamethrower Head (targets closest enemy within range) ---
            if (this.isFlamethrower) {
                const closestFlame = Unit.findClosest(this, GAME_STATE.enemies, this.flameRange, isTargetable);

                if (closestFlame) {
                    const flameTargetAngle = Math.atan2(closestFlame.y - this.y, closestFlame.x - this.x);
                    this.flameAngle = flameTargetAngle; // Head 2 independently tracks target
                    this.flameAttackCount++;

                    // Fires every 4th attack cycle ONLY when enemies are in range
                    if (this.flameAttackCount % 4 === 0) {
                        this.flameActiveUntil = now + 400;
                        this.flameCenterAngle = flameTargetAngle;
                        SoundEngine.flamethrower();
                        const fDmg = this.flameDamage * this.player.damageModifier * GAME_STATE.dmgFactor;
                        const coneHalf = this.flameConeWidth / 2;
                        const fRange = this.flameRange;
                        const fRange2 = fRange * fRange;

                        SPATIAL_GRID.queryBox(this.x - fRange - 85, this.x + fRange + 85, this.y - fRange - 85, this.y + fRange + 85, e => {
                            if (!isDamageable(e)) return;
                            const dx = e.x - this.x;
                            const dy = e.y - this.y;
                            const dist2 = dx * dx + dy * dy;
                            if (dist2 <= fRange2) {
                                let enemyAngle = Math.atan2(dy, dx);
                                let diff = enemyAngle - flameTargetAngle;
                                while (diff < -Math.PI) diff += Math.PI * 2;
                                while (diff > Math.PI) diff -= Math.PI * 2;
                                if (Math.abs(diff) <= coneHalf) {
                                    e.hp -= fDmg;
                                    if (this.player.freezeEnabled && !e.isBoss()) {
                                        let dur = (e.type === 'meteor') ? 62.5 : 125;
                                        e.freeze(dur, now);
                                    }
                                    spawnHitParticles(e.x, e.y, '#ff5500');
                                }
                            }
                        });
                    }
                }
            }
        }
    }
    draw(now) {
        ctx.save();
        const pColor = this.player ? this.player.color : '#00ffff';

        // Draw wider, softer sweeping flame cone if active
        if (now < this.flameActiveUntil) {
            const elapsed = 400 - (this.flameActiveUntil - now);
            const t = Math.min(1, elapsed / 400);
            const fRange = this.flameRange;
            const coneHalf = this.flameConeWidth / 2;
            const currentSweepAngle = this.flameCenterAngle - coneHalf + (coneHalf * 2 * t);

            ctx.save();
            const grad = ctx.createRadialGradient(this.x, this.y, 18, this.x, this.y, fRange);
            grad.addColorStop(0, 'rgba(255, 200, 100, 0.40)');
            grad.addColorStop(0.4, 'rgba(255, 120, 0, 0.22)');
            grad.addColorStop(0.8, 'rgba(255, 40, 0, 0.10)');
            grad.addColorStop(1, 'rgba(255, 0, 0, 0)');

            ctx.fillStyle = grad;
            ctx.beginPath();
            if (coneHalf >= Math.PI) {
                ctx.arc(this.x, this.y, fRange, 0, Math.PI * 2);
                ctx.arc(this.x, this.y, 18, Math.PI * 2, 0, true);
            } else {
                ctx.moveTo(this.x + Math.cos(this.flameCenterAngle - coneHalf) * 18, this.y + Math.sin(this.flameCenterAngle - coneHalf) * 18);
                ctx.arc(this.x, this.y, fRange, this.flameCenterAngle - coneHalf, this.flameCenterAngle + coneHalf);
                ctx.lineTo(this.x + Math.cos(this.flameCenterAngle + coneHalf) * 18, this.y + Math.sin(this.flameCenterAngle + coneHalf) * 18);
                ctx.arc(this.x, this.y, 18, this.flameCenterAngle + coneHalf, this.flameCenterAngle - coneHalf, true);
                ctx.closePath();
            }
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 220, 150, 0.45)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.x + Math.cos(currentSweepAngle) * 18, this.y + Math.sin(currentSweepAngle) * 18);
            ctx.lineTo(this.x + Math.cos(currentSweepAngle) * fRange, this.y + Math.sin(currentSweepAngle) * fRange);
            ctx.stroke();
            ctx.restore();
        }

        // 0. Subterranean Seismic Pulse / Bio-Root Waves (Multi-root exploratory probing with post-spawn retraction)
        if (this.pendingExpansion) {
            const pe = this.pendingExpansion;
            const elapsed = Math.max(0, now - pe.startTime);
            const totalDuration = Math.max(1, pe.expandTime - pe.startTime);
            const t = Math.min(1, elapsed / totalDuration); // 0.0 to 1.0

            const x0 = this.x;
            const y0 = this.y;

            ctx.save();

            const roots = pe.roots || [{
                targetX: pe.targetX,
                targetY: pe.targetY,
                dist: Math.hypot(pe.targetX - x0, pe.targetY - y0),
                angle: Math.atan2(pe.targetY - y0, pe.targetX - x0),
                isWinner: true,
                wiggleFreq: 0.14,
                wiggleSeed: 0
            }];

            // All roots expand at the exact same speed over the first 70%
            const growT = Math.min(1, t / 0.70);

            // 1. Batched subtle subterranean trench glow
            ctx.strokeStyle = pColor;
            ctx.lineWidth = 2.0;
            ctx.globalAlpha = 0.04;
            ctx.beginPath();
            for (const root of roots) {
                const curDist = root.dist * growT;
                if (curDist < 2.0) continue;
                ctx.moveTo(x0, y0);
                ctx.lineTo(x0 + Math.cos(root.angle) * curDist, y0 + Math.sin(root.angle) * curDist);
            }
            ctx.stroke();

            // 2. Batched main subterranean root fracture veins
            ctx.beginPath();
            for (const root of roots) {
                const curDist = root.dist * growT;
                if (curDist < 2.0) continue;
                const segments = Math.max(3, Math.floor(curDist / 14));
                ctx.moveTo(x0, y0);
                for (let s = 1; s <= segments; s++) {
                    const segT = s / segments;
                    const segDist = curDist * segT;
                    const lateralOffset = (s === segments) ? 0 : Math.sin(segDist * root.wiggleFreq + root.wiggleSeed + now * 0.005) * 1.8;
                    const px = x0 + Math.cos(root.angle) * segDist - Math.sin(root.angle) * lateralOffset;
                    const py = y0 + Math.sin(root.angle) * segDist + Math.cos(root.angle) * lateralOffset;
                    ctx.lineTo(px, py);
                }
            }
            ctx.strokeStyle = pColor;
            ctx.lineWidth = 1.0;
            ctx.globalAlpha = 0.24;
            ctx.stroke();

            // 3. Delicate inner core filament (re-stroke combined fracture path)
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 0.5;
            ctx.globalAlpha = 0.18;
            ctx.stroke();

            // 4. Subtle digging wave head tip while growing (batched dots)
            if (growT < 1.0) {
                ctx.fillStyle = pColor;
                ctx.globalAlpha = 0.16;
                ctx.beginPath();
                for (const root of roots) {
                    const curDist = root.dist * growT;
                    if (curDist < 2.0) continue;
                    const headX = x0 + Math.cos(root.angle) * curDist;
                    const headY = y0 + Math.sin(root.angle) * curDist;
                    ctx.moveTo(headX + 1.8, headY);
                    ctx.arc(headX, headY, 1.8, 0, Math.PI * 2);
                }
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 0.28;
                ctx.beginPath();
                for (const root of roots) {
                    const curDist = root.dist * growT;
                    if (curDist < 2.0) continue;
                    const headX = x0 + Math.cos(root.angle) * curDist;
                    const headY = y0 + Math.sin(root.angle) * curDist;
                    ctx.moveTo(headX + 0.7, headY);
                    ctx.arc(headX, headY, 0.7, 0, Math.PI * 2);
                }
                ctx.fill();
            }

            // 5. Destination Germination Geyser & Seismic Rings ONLY for the winning destination
            if (t >= 0.35) {
                const destIntensity = (t - 0.35) / 0.65;
                const x1 = pe.targetX;
                const y1 = pe.targetY;

                // Concentric expanding seismic ground shockwave rings rippling outward
                const ringCount = 2;
                for (let r = 0; r < ringCount; r++) {
                    const phase = ((now * 0.003 + r * 0.5) % 1.0);
                    const ringR = 3 + phase * 16 * destIntensity;
                    const ringAlpha = (1 - phase) * 0.30 * destIntensity;

                    ctx.strokeStyle = pColor;
                    ctx.lineWidth = 1.0;
                    ctx.globalAlpha = ringAlpha;
                    ctx.beginPath();
                    ctx.arc(x1, y1, ringR, 0, Math.PI * 2);
                    ctx.stroke();
                }

                // Swirling ground bio-vortex motes around the destination (batched)
                const vortexSpin = now * 0.008;
                const vortexR = 5.5 * destIntensity;
                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 0.40 * destIntensity;
                ctx.beginPath();
                for (let v = 0; v < 4; v++) {
                    const va = vortexSpin + (v / 4) * Math.PI * 2;
                    const vx = x1 + Math.cos(va) * vortexR;
                    const vy = y1 + Math.sin(va) * vortexR;
                    ctx.moveTo(vx + 0.8, vy);
                    ctx.arc(vx, vy, 0.8, 0, Math.PI * 2);
                }
                ctx.fill();

                // Central budding node gestation core swelling at destination
                const budRadius = (1.4 + 3.0 * destIntensity) * (0.85 + 0.15 * Math.sin(now * 0.02));
                const budGrad = ctx.createRadialGradient(x1, y1, 0, x1, y1, budRadius * 1.3);
                budGrad.addColorStop(0, '#ffffff');
                budGrad.addColorStop(0.4, pColor);
                budGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = budGrad;
                ctx.globalAlpha = 0.45 * destIntensity;
                ctx.beginPath();
                ctx.arc(x1, y1, budRadius * 1.3, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        }

        // 0b. Post-Spawn Retraction: Fake/exploratory roots retract back into the parent turret after spawn
        if (this.retractingRoots) {
            const rr = this.retractingRoots;
            const rElapsed = now - rr.startTime;
            if (rElapsed >= rr.duration) {
                this.retractingRoots = null;
            } else {
                const retractT = rElapsed / rr.duration; // 0.0 -> 1.0
                const rootAlpha = Math.max(0, 1 - retractT * 0.85);
                const x0 = this.x;
                const y0 = this.y;

                ctx.save();
                // 1. Batched trench glow
                ctx.strokeStyle = pColor;
                ctx.lineWidth = 2.0;
                ctx.globalAlpha = 0.04 * rootAlpha;
                ctx.beginPath();
                for (const root of rr.roots) {
                    const baseDist = (root.maxReachedDist !== undefined) ? root.maxReachedDist : root.dist;
                    const curDist = baseDist * (1 - retractT);
                    if (curDist < 2.0) continue;
                    ctx.moveTo(x0, y0);
                    ctx.lineTo(x0 + Math.cos(root.angle) * curDist, y0 + Math.sin(root.angle) * curDist);
                }
                ctx.stroke();

                // 2. Batched main root fracture veins
                ctx.beginPath();
                for (const root of rr.roots) {
                    const baseDist = (root.maxReachedDist !== undefined) ? root.maxReachedDist : root.dist;
                    const curDist = baseDist * (1 - retractT);
                    if (curDist < 2.0) continue;
                    const segments = Math.max(3, Math.floor(curDist / 14));
                    ctx.moveTo(x0, y0);
                    for (let s = 1; s <= segments; s++) {
                        const segT = s / segments;
                        const segDist = curDist * segT;
                        const lateralOffset = (s === segments) ? 0 : Math.sin(segDist * root.wiggleFreq + root.wiggleSeed + now * 0.005) * 1.8;
                        const px = x0 + Math.cos(root.angle) * segDist - Math.sin(root.angle) * lateralOffset;
                        const py = y0 + Math.sin(root.angle) * segDist + Math.cos(root.angle) * lateralOffset;
                        ctx.lineTo(px, py);
                    }
                }
                ctx.strokeStyle = pColor;
                ctx.lineWidth = 1.0;
                ctx.globalAlpha = 0.24 * rootAlpha;
                ctx.stroke();

                // 3. Inner filament (re-stroke combined fracture path)
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 0.5;
                ctx.globalAlpha = 0.18 * rootAlpha;
                ctx.stroke();

                ctx.restore();
            }
        }

        // 1. Draw bio-tendril energy network connections between turrets
        for (const conn of this.connections) {
            if (!conn.alive) continue;
            if (this.x < conn.x || (this.x === conn.x && this.y < conn.y)) {
                // Determine direction: from the turret already on the battlefield to the newly spawned turret
                const fromTurret = (this.spawnTime <= conn.spawnTime) ? this : conn;
                const toTurret = (this.spawnTime <= conn.spawnTime) ? conn : this;
                const elapsed = now - toTurret.spawnTime;
                const animDuration = 420 * Math.max(0.6, this.player ? (this.player.buildingCooldownModifier || 1.0) : 1.0);
                const isEstablishing = elapsed < animDuration;

                const isLaserWall = this.player && this.player.laserWallsEnabled;
                const fenceColor = isLaserWall ? '#00ffff' : pColor;
                
                const x0 = fromTurret.x, y0 = fromTurret.y;
                const x1 = toTurret.x, y1 = toTurret.y;
                const midX = (x0 + x1) * 0.5;
                const midY = (y0 + y1) * 0.5 + Math.sin(now * 0.004 + fromTurret.x * 0.04) * 2;

                ctx.save();

                if (isEstablishing) {
                    // Establishing animation: progressive growth from old turret to newly spawned turret
                    const tRaw = Math.max(0, Math.min(1, elapsed / animDuration));
                    const t = 1 - Math.pow(1 - tRaw, 2.2); // Smooth ease-out propagation

                    // Subdivided quadratic Bézier from s = 0 to s = t
                    const p0x = x0, p0y = y0;
                    const pMidX = (1 - t) * x0 + t * midX;
                    const pMidY = (1 - t) * y0 + t * midY;
                    const p1x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * midX + t * t * x1;
                    const p1y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * midY + t * t * y1;

                    // Fast dual-stroke glow: wide translucent pass instead of expensive shadowBlur
                    ctx.strokeStyle = fenceColor;
                    ctx.lineWidth = (isLaserWall ? 4.0 : 2.5) + (isLaserWall ? 8 : 5);
                    ctx.globalAlpha = 0.35;
                    ctx.beginPath();
                    ctx.moveTo(p0x, p0y);
                    ctx.quadraticCurveTo(pMidX, pMidY, p1x, p1y);
                    ctx.stroke();

                    // High-energy laser surge line
                    ctx.lineWidth = isLaserWall ? 4.0 : 2.5;
                    ctx.globalAlpha = 0.95;
                    ctx.beginPath();
                    ctx.moveTo(p0x, p0y);
                    ctx.quadraticCurveTo(pMidX, pMidY, p1x, p1y);
                    ctx.stroke();

                    // Bright inner core
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = isLaserWall ? 1.8 : 1.1;
                    ctx.globalAlpha = 0.90;
                    ctx.stroke();

                    // Leading edge plasma spark head forging the fence (translucent halo instead of shadowBlur)
                    ctx.fillStyle = fenceColor;
                    ctx.globalAlpha = 0.35;
                    ctx.beginPath();
                    ctx.arc(p1x, p1y, (isLaserWall ? 3.5 : 2.4) + 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(p1x, p1y, isLaserWall ? 3.5 : 2.4, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    // Settled, permanent bio-tendril fence cord
                    const pulse = 0.5 + 0.3 * Math.sin(now * 0.006);
                    // Fast dual-stroke glow: wide translucent pass instead of expensive shadowBlur
                    ctx.strokeStyle = fenceColor;
                    ctx.lineWidth = (isLaserWall ? 3.0 : 1.8) + (isLaserWall ? 6 : 4);
                    ctx.globalAlpha = ((isLaserWall ? 0.70 : 0.45) * pulse) * 0.4;
                    ctx.beginPath();
                    ctx.moveTo(x0, y0);
                    ctx.quadraticCurveTo(midX, midY, x1, y1);
                    ctx.stroke();

                    ctx.lineWidth = isLaserWall ? 3.0 : 1.8;
                    ctx.globalAlpha = (isLaserWall ? 0.70 : 0.45) * pulse;
                    ctx.beginPath();
                    ctx.moveTo(x0, y0);
                    ctx.quadraticCurveTo(midX, midY, x1, y1);
                    ctx.stroke();

                    // Luminous inner core along the tendril
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = isLaserWall ? 1.4 : 0.9;
                    ctx.globalAlpha = 0.65;
                    ctx.stroke();
                }

                ctx.restore();
            }
        }

        // 2. Initial Cytoplasmic Hatching Tether & Birth Sac (first 320ms after hatching)
        if (this.player && this.player.alive) {
            const timeSinceSpawn = now - this.spawnTime;
            if (timeSinceSpawn < 320) {
                const tetherProg = timeSinceSpawn / 320;
                const tetherAlpha = (1 - tetherProg);
                const pdx = this.x - this.player.x;
                const pdy = this.y - this.player.y;
                const pdist = Math.hypot(pdx, pdy);
                if (pdist > 0.01 && pdist < 120) {
                    const normX = -pdy / pdist;
                    const normY = pdx / pdist;
                    const midX = (this.player.x + this.x) * 0.5;
                    const midY = (this.player.y + this.y) * 0.5;
                    const pinch = Math.max(1.0, 4.0 * (1 - tetherProg));

                    // Attach cleanly between player boundary and turret soma perimeter
                    const attachTurretX = this.x - (pdx / pdist) * 5.6;
                    const attachTurretY = this.y - (pdy / pdist) * 5.6;

                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(this.player.x + normX * (this.player.r * 0.40), this.player.y + normY * (this.player.r * 0.40));
                    ctx.quadraticCurveTo(midX + normX * pinch, midY + normY * pinch, attachTurretX + normX * 1.5, attachTurretY + normY * 1.5);
                    ctx.lineTo(attachTurretX - normX * 1.5, attachTurretY - normY * 1.5);
                    ctx.quadraticCurveTo(midX - normX * pinch, midY - normY * pinch, this.player.x - normX * (this.player.r * 0.40), this.player.y - normY * (this.player.r * 0.40));
                    ctx.closePath();
                    ctx.fillStyle = pColor;
                    ctx.globalAlpha = tetherAlpha * 0.75;
                    ctx.fill();

                    // Hatching fluid birth envelope around the emerging seed
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.2;
                    ctx.globalAlpha = tetherAlpha * 0.50;
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, 8.0 + (1 - tetherProg) * 4.0, 0, Math.PI * 2);
                    ctx.stroke();

                    ctx.restore();
                }

                // Rapid Deployment deploy burst: expanding shockwave ring + ejection motes
                const rc = this.player ? (this.player.turretCooldownCount || 0) : 0;
                if (rc > 0) {
                    const ringR = 4 + tetherProg * (26 + rc * 2);
                    ctx.strokeStyle = pColor;
                    ctx.lineWidth = 1.6;
                    ctx.globalAlpha = tetherAlpha * 0.55;
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, ringR, 0, Math.PI * 2);
                    ctx.stroke();
                    const moteCount = 3 + rc;
                    for (let i = 0; i < moteCount; i++) {
                        const ma = (i / moteCount) * Math.PI * 2 + now * 0.001;
                        const md = ringR * (0.3 + tetherProg * 0.7);
                        ctx.fillStyle = '#ffffff';
                        ctx.globalAlpha = tetherAlpha;
                        ctx.beginPath();
                        ctx.arc(this.x + Math.cos(ma) * md, this.y + Math.sin(ma) * md, 1.1, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }

        // 3. Whirling Chitin Cilia / Spore Teeth (Sawblade upgrade - Dark Body with Bright Teeth)
        if (this.player && this.player.turretSawEnabled) {
            const sawRadius = 50 * (this.player.meleeRangeModifier || 1.0) * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
            const rotAngle = now * 0.012;
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(rotAngle);

            const teeth = 8;
            const rInner = sawRadius * 0.74;
            const rOuter = sawRadius;

            // 1. Extra dark chitin body fill (deep obsidian base)
            const darkSawFill = shadeHex(pColor, 0.10);
            const darkSawStroke = shadeHex(pColor, 0.22);

            ctx.fillStyle = darkSawFill;
            ctx.strokeStyle = darkSawStroke;
            ctx.lineWidth = 1.0;
            ctx.globalAlpha = 0.55;

            // Hollow annular gear body path
            ctx.beginPath();
            for (let i = 0; i < teeth; i++) {
                const a1 = (i / teeth) * Math.PI * 2;
                const a2 = a1 + (Math.PI / teeth) * 0.5;
                const a3 = ((i + 1) / teeth) * Math.PI * 2;

                if (i === 0) ctx.moveTo(Math.cos(a1) * rInner, Math.sin(a1) * rInner);
                ctx.lineTo(Math.cos(a2) * rOuter, Math.sin(a2) * rOuter);
                ctx.lineTo(Math.cos(a3) * rInner, Math.sin(a3) * rInner);
            }
            ctx.closePath();
            ctx.arc(0, 0, rInner, Math.PI * 2, 0, true);
            ctx.closePath();
            ctx.fill('evenodd');
            ctx.stroke();

            // 2. Subtler Darkened Teeth Tips & Cutting Edges (batched paths)
            const darkToothEdge = shadeHex(pColor, 0.55);
            ctx.strokeStyle = darkToothEdge;
            ctx.lineWidth = 1.1;
            ctx.globalAlpha = 0.65;
            ctx.beginPath();
            for (let i = 0; i < teeth; i++) {
                const a1 = (i / teeth) * Math.PI * 2;
                const a2 = a1 + (Math.PI / teeth) * 0.5;
                const a3 = ((i + 1) / teeth) * Math.PI * 2;
                const tipX = Math.cos(a2) * rOuter;
                const tipY = Math.sin(a2) * rOuter;

                ctx.moveTo(Math.cos(a1) * rInner, Math.sin(a1) * rInner);
                ctx.lineTo(tipX, tipY);
                ctx.lineTo(Math.cos(a3) * rInner, Math.sin(a3) * rInner);
            }
            ctx.stroke();

            // Subtle micro-gleam on tooth tips (batched)
            ctx.fillStyle = darkToothEdge;
            ctx.globalAlpha = 0.70;
            ctx.beginPath();
            for (let i = 0; i < teeth; i++) {
                const a2 = (i / teeth) * Math.PI * 2 + (Math.PI / teeth) * 0.5;
                const tipX = Math.cos(a2) * rOuter;
                const tipY = Math.sin(a2) * rOuter;
                ctx.moveTo(tipX + 0.9, tipY);
                ctx.arc(tipX, tipY, 0.9, 0, Math.PI * 2);
            }
            ctx.fill();

            ctx.restore();
        }

        // 4. Small Dendritic Cell Morphology (Soma nucleus with 6 permanent radiating branched dendrites)
        const isOverclocked = (GAME_STATE.turretOverclockUntil && now < GAME_STATE.turretOverclockUntil);

        ctx.save();
        ctx.translate(this.x, this.y);

        // 4a. Fortified Structures: armored collar hugging the soma core (inside the dendrite
        // field so it never brackets the whole cell). Stack count raises the merlon count.
        const dCount = this.player ? (this.player.buildingDurationCount || 0) : 0;
        const steelTint = shadeHex(pColor, 1.50);
        if (dCount > 0) {
            const collarR = 7.0;
            const merlonH = 1.9;
            const toothCounts = [0, 5, 7, 9, 12];
            const teeth = toothCounts[Math.min(dCount, 4)];
            const merlonW = (Math.PI * 2 / teeth) * 0.5;
            const steelDark = shadeHex(pColor, 0.45);

            // Recessed collar seam just under the ring so it reads as an armored layer
            ctx.beginPath();
            ctx.arc(0, 0, collarR - 0.9, 0, Math.PI * 2);
            ctx.strokeStyle = steelDark;
            ctx.lineWidth = 1.0;
            ctx.globalAlpha = 0.30;
            ctx.stroke();

            // Collar band
            ctx.beginPath();
            ctx.arc(0, 0, collarR, 0, Math.PI * 2);
            ctx.strokeStyle = shadeHex(pColor, 1.25);
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = 0.65;
            ctx.stroke();

            // Short merlon ticks
            ctx.beginPath();
            for (let i = 0; i < teeth; i++) {
                const a = (i + 0.5) / teeth * Math.PI * 2;
                const a0 = a - merlonW * 0.5;
                const a1 = a + merlonW * 0.5;
                ctx.moveTo(Math.cos(a0) * collarR, Math.sin(a0) * collarR);
                ctx.lineTo(Math.cos(a0) * (collarR + merlonH), Math.sin(a0) * (collarR + merlonH));
                ctx.lineTo(Math.cos(a1) * (collarR + merlonH), Math.sin(a1) * (collarR + merlonH));
                ctx.lineTo(Math.cos(a1) * collarR, Math.sin(a1) * collarR);
            }
            ctx.strokeStyle = steelTint;
            ctx.lineWidth = 0.9;
            ctx.globalAlpha = 0.75;
            ctx.stroke();
        }

        const somaR = 5.6;
        const dendriteCount = 6;
        const dendritePoints = [];
        
        // Build permanent 360-degree starry branched dendritic contour in strictly monotonic angular order
        for (let i = 0; i < dendriteCount; i++) {
            const baseAngle = (i / dendriteCount) * Math.PI * 2;
            const swayFreq = isOverclocked ? 0.009 : 0.0025;
            const swayAmp = isOverclocked ? 0.14 : 0.08;
            const sway = Math.sin(now * swayFreq + i * 1.5) * swayAmp;
            const dAngle = baseAngle + sway;

            // Distance boost if close to targeting angle
            let diff = dAngle - this.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const targetProximity = Math.max(0, Math.cos(diff));
            const targetBoost = Math.pow(targetProximity, 3.0) * 3.5;

            const baseReach = 9.2 + dCount * 0.5 + 1.6 * Math.sin((isOverclocked ? now * 0.010 : now * 0.003) + i * 1.8);
            const reach = baseReach + targetBoost;

            // Left base notch
            const leftAngle = dAngle - 0.26;
            dendritePoints.push({
                x: Math.cos(leftAngle) * (somaR * 0.82),
                y: Math.sin(leftAngle) * (somaR * 0.82)
            });

            // Dendrite branch tip
            dendritePoints.push({
                x: Math.cos(dAngle) * reach,
                y: Math.sin(dAngle) * reach
            });

            // Right base notch
            const rightAngle = dAngle + 0.26;
            dendritePoints.push({
                x: Math.cos(rightAngle) * (somaR * 0.82),
                y: Math.sin(rightAngle) * (somaR * 0.82)
            });
        }

        // Draw smooth organic spline through dendritic points
        ctx.beginPath();
        ctx.moveTo(dendritePoints[0].x, dendritePoints[0].y);
        for (let i = 0; i < dendritePoints.length; i++) {
            const curr = dendritePoints[i];
            const next = dendritePoints[(i + 1) % dendritePoints.length];
            const mx = (curr.x + next.x) * 0.5;
            const my = (curr.y + next.y) * 0.5;
            ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
        }
        ctx.closePath();

        // Muted dendritic cytoplasm (when overclocked: core is player color, edges transition to gold; when Inferno Nova: player color infused with volcanic depth)
        const isInfernoNova = this.player && this.player.turretFullSweepEnabled;
        if (isInfernoNova) {
            const grad = ctx.createRadialGradient(0, 0, 1.0, 0, 0, 11.5);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.20, pColor);
            grad.addColorStop(0.70, pColor);
            grad.addColorStop(1.0, shadeHex(pColor, 0.45));
            ctx.fillStyle = grad;
            ctx.globalAlpha = 0.75;
        } else if (isOverclocked) {
            const grad = ctx.createRadialGradient(0, 0, 1.0, 0, 0, 11.5);
            grad.addColorStop(0, pColor);
            grad.addColorStop(0.50, pColor);
            grad.addColorStop(1.0, '#ffd700');
            ctx.fillStyle = grad;
            ctx.globalAlpha = 0.85;
        } else {
            ctx.fillStyle = pColor;
            ctx.globalAlpha = 0.60;
        }
        ctx.fill();
        
        if (isOverclocked) {
            // Fast dual-stroke overclock glow outline
            ctx.strokeStyle = '#ffaa00';
            ctx.lineWidth = 4.5;
            ctx.globalAlpha = 0.45;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }
        ctx.strokeStyle = isInfernoNova ? shadeHex(pColor, 0.60) : (isOverclocked ? '#ffd700' : (this.player ? this.player.ring : '#222'));
        ctx.lineWidth = isOverclocked ? 1.9 : 1.3;
        ctx.stroke();

        // Fine secondary dendritic micro-filaments / spines on each dendrite (or Molten Lava Fissures if Inferno Nova)
        if (isInfernoNova) {
            // Molten Lava Fissure Veins along dendritic branches & Searing branch tips (batched passes)
            const lavaPulse = 0.65 + 0.35 * Math.sin(now * 0.006);
            ctx.beginPath();
            for (let i = 0; i < dendriteCount; i++) {
                const baseAngle = (i / dendriteCount) * Math.PI * 2 + Math.sin(now * 0.003 + i * 1.5) * 0.08;
                const baseReach = 9.2 + dCount * 0.5 + 1.6 * Math.sin(now * 0.004 + i * 1.8);
                const tipX = Math.cos(baseAngle) * baseReach;
                const tipY = Math.sin(baseAngle) * baseReach;
                const midX = tipX * 0.55 + Math.cos(baseAngle + Math.PI / 2) * (1.2 * Math.sin(now * 0.008 + i));
                const midY = tipY * 0.55 + Math.sin(baseAngle + Math.PI / 2) * (1.2 * Math.sin(now * 0.008 + i));

                ctx.moveTo(Math.cos(baseAngle) * 3.5, Math.sin(baseAngle) * 3.5);
                ctx.lineTo(midX, midY);
                ctx.lineTo(tipX, tipY);
            }
            ctx.strokeStyle = '#ff6600';
            ctx.lineWidth = 1.3;
            ctx.globalAlpha = 0.85 * lavaPulse;
            ctx.stroke();

            ctx.strokeStyle = '#ffee44';
            ctx.lineWidth = 0.6;
            ctx.globalAlpha = 0.95 * lavaPulse;
            ctx.stroke();

            // Searing thermal nodes on branch tips (batched)
            ctx.fillStyle = '#ffaa00';
            ctx.globalAlpha = 0.90 * lavaPulse;
            ctx.beginPath();
            for (let i = 0; i < dendriteCount; i++) {
                const baseAngle = (i / dendriteCount) * Math.PI * 2 + Math.sin(now * 0.003 + i * 1.5) * 0.08;
                const baseReach = 9.2 + dCount * 0.5 + 1.6 * Math.sin(now * 0.004 + i * 1.8);
                const tipX = Math.cos(baseAngle) * baseReach;
                const tipY = Math.sin(baseAngle) * baseReach;
                ctx.moveTo(tipX + 1.3, tipY);
                ctx.arc(tipX, tipY, 1.3, 0, Math.PI * 2);
            }
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 1.0;
            ctx.beginPath();
            for (let i = 0; i < dendriteCount; i++) {
                const baseAngle = (i / dendriteCount) * Math.PI * 2 + Math.sin(now * 0.003 + i * 1.5) * 0.08;
                const baseReach = 9.2 + dCount * 0.5 + 1.6 * Math.sin(now * 0.004 + i * 1.8);
                const tipX = Math.cos(baseAngle) * baseReach;
                const tipY = Math.sin(baseAngle) * baseReach;
                ctx.moveTo(tipX + 0.6, tipY);
                ctx.arc(tipX, tipY, 0.6, 0, Math.PI * 2);
            }
            ctx.fill();
        } else {
            ctx.strokeStyle = isOverclocked ? '#ffd700' : (this.player ? this.player.ring : '#333');
            ctx.lineWidth = 0.9;
            ctx.globalAlpha = isOverclocked ? 0.75 : 0.40;
            ctx.beginPath();
            for (let i = 0; i < dendriteCount; i++) {
                const baseAngle = (i / dendriteCount) * Math.PI * 2 + Math.sin((isOverclocked ? now * 0.009 : now * 0.0025) + i * 1.5) * (isOverclocked ? 0.14 : 0.08);
                const baseReach = 9.2 + dCount * 0.5 + 1.6 * Math.sin((isOverclocked ? now * 0.010 : now * 0.003) + i * 1.8);
                const tipX = Math.cos(baseAngle) * baseReach;
                const tipY = Math.sin(baseAngle) * baseReach;
                const b1Angle = baseAngle + 0.45;
                ctx.moveTo(tipX * 0.65, tipY * 0.65);
                ctx.lineTo(tipX * 0.65 + Math.cos(b1Angle) * 3.2, tipY * 0.65 + Math.sin(b1Angle) * 3.2);
            }
            ctx.stroke();
        }

        // Reinforcement struts: subtle steel-toned cross braces across each dendrite shaft (batched)
        if (dCount > 0) {
            ctx.strokeStyle = steelTint;
            ctx.lineWidth = 0.8;
            ctx.globalAlpha = 0.55;
            ctx.beginPath();
            for (let i = 0; i < dendriteCount; i++) {
                const baseAngle = (i / dendriteCount) * Math.PI * 2 + Math.sin((isOverclocked ? now * 0.009 : now * 0.0025) + i * 1.5) * (isOverclocked ? 0.14 : 0.08);
                const baseReach = 9.2 + dCount * 0.5 + 1.6 * Math.sin((isOverclocked ? now * 0.010 : now * 0.003) + i * 1.8);
                const bx = Math.cos(baseAngle) * baseReach * 0.55;
                const by = Math.sin(baseAngle) * baseReach * 0.55;
                const nx = -Math.sin(baseAngle);
                const ny = Math.cos(baseAngle);
                ctx.moveTo(bx + nx * 1.5, by + ny * 1.5);
                ctx.lineTo(bx - nx * 1.5, by - ny * 1.5);
            }
            ctx.stroke();
        }

        // Supply Dispenser pouch: a small vending apron under the soma whose slot charges
        // with the dispense cadence, then pops in the item color on payout
        if (this.player && this.player.turretDispenserEnabled) {
            const dInterval = (GAME_CONFIG.TURRET.DISPENSER_INTERVAL_SEC * 1000) * (this.player.buildingCooldownModifier || 1.0);
            const lastCheck = this.lastDispenseCheck || this.spawnTime;
            const dProg = Math.min(1, Math.max(0, (now - lastCheck) / dInterval));
            const pouchY = 7.6;
            const flash = this.dispenseFlashUntil > now;
            const flashT = flash ? Math.max(0, (this.dispenseFlashUntil - now) / 260) : 0;
            const popA = flash ? Math.pow(flashT, 1.3) : 0;
            const swell = flash ? 1 + 1.5 * Math.pow(flashT, 0.5) : 1;
            const w = 3.4 * swell;
            const slotW = 4.6 * swell;

            // Color pop halo around the pouch during payout
            if (flash) {
                ctx.strokeStyle = shadeHex((this.lastDispenseColor || '#ffff88'), 1.5);
                ctx.lineWidth = 2.2;
                ctx.globalAlpha = 0.55 * popA;
                ctx.beginPath();
                ctx.arc(0, pouchY + 1.0, 6.5 * swell, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Pouch body
            ctx.fillStyle = shadeHex(pColor, 0.55);
            ctx.strokeStyle = steelTint;
            ctx.lineWidth = 1.0;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.moveTo(-w, pouchY - 1.2);
            ctx.quadraticCurveTo(-w - 0.2, pouchY + 2.6, 0, pouchY + 3.4);
            ctx.quadraticCurveTo(w + 0.2, pouchY + 2.6, w, pouchY - 1.2);
            ctx.lineTo(w, pouchY - 0.4);
            ctx.lineTo(-w, pouchY - 0.4);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Charging slot fill (grows with the dispense cadence); hot-white core on payout
            ctx.fillStyle = shadeHex((flash ? (this.lastDispenseColor || '#ffff88') : '#ffff88'), 1.35);
            ctx.globalAlpha = flash ? 1.0 : (0.5 + 0.25 * Math.sin(now * 0.01));
            const fillW = slotW * dProg;
            if (fillW > 0.02) {
                ctx.fillRect(-slotW / 2, pouchY + 0.2, fillW, 2.0);
            }
            if (flash) {
                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 0.9 * popA;
                ctx.fillRect(-slotW / 2, pouchY + 0.8, slotW * Math.max(dProg, 0.9), 0.8);
                // Payout spark at the slot lip
                ctx.fillStyle = shadeHex((this.lastDispenseColor || '#ffff88'), 1.5);
                ctx.globalAlpha = 0.85 * popA;
                ctx.beginPath();
                ctx.arc(0, pouchY + 2.4, 1.4 * (1.2 - flashT * 0.2), 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Central Soma Nucleus Organelle
        if (isInfernoNova) {
            const isFiringNova = this.flameActiveUntil > now;
            const nucleusPulse = isFiringNova ? (1.0 + 0.2 * Math.sin(now * 0.04)) : (0.75 + 0.25 * Math.sin(now * 0.005));
            const nucR = 2.3 * nucleusPulse;

            // Compact molten thermal ring around player nucleus
            ctx.beginPath();
            ctx.arc(0, 0, nucR + 0.9, 0, Math.PI * 2);
            ctx.fillStyle = '#ff4400';
            ctx.globalAlpha = 0.85;
            ctx.fill();

            // Inner player-color core
            ctx.beginPath();
            ctx.arc(0, 0, nucR, 0, Math.PI * 2);
            ctx.fillStyle = isFiringNova ? '#ffffff' : pColor;
            ctx.globalAlpha = 0.95;
            ctx.fill();

            // Searing center glint
            ctx.beginPath();
            ctx.arc(0, 0, nucR * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.90;
            ctx.fill();
        } else {
            const nucleusPulse = isOverclocked ? (0.75 + 0.25 * Math.sin(now * 0.035)) : (0.5 + 0.3 * Math.sin(now * 0.005));
            ctx.fillStyle = isOverclocked ? pColor : '#ffffff';
            ctx.globalAlpha = (isOverclocked ? 0.95 : 0.55) * nucleusPulse;
            ctx.beginPath();
            ctx.arc(0, 0, isOverclocked ? 2.6 : 2.2, 0, Math.PI * 2);
            ctx.fill();
        }

        // 5. Secretory Vesicles & Discharge Pores
        // Primary Discharge Vesicle Pore on targeting direction
        const leadTipX = Math.cos(this.angle) * 12.0;
        const leadTipY = Math.sin(this.angle) * 12.0;
        ctx.fillStyle = isOverclocked ? '#ffd700' : (isInfernoNova ? '#ffee44' : '#ffffff');
        ctx.globalAlpha = 0.90;
        ctx.beginPath();
        ctx.arc(leadTipX, leadTipY, isOverclocked ? 1.6 : 1.3, 0, Math.PI * 2);
        ctx.fill();

        // Head 2: Thermal Exhaust Vent(s) (Quad Omni-Vents if Inferno Nova, Single Vent if standard Flamethrower)
        if (this.isFlamethrower) {
            if (isInfernoNova) {
                // Quad Omni-Directional Thermal Vents (4 nozzles in a cross at 90° intervals)
                const ventR = 8.5;
                const isFiringNova = this.flameActiveUntil > now;
                const spin = now * 0.001; // slow rotation of the omni-vents
                const flareT = isFiringNova ? Math.max(0, (this.flameActiveUntil - now) / 400) : 0;

                for (let v = 0; v < 4; v++) {
                    const vAngle = spin + (v / 4) * (Math.PI * 2);
                    const vx = Math.cos(vAngle) * ventR;
                    const vy = Math.sin(vAngle) * ventR;

                    // 1. Radiant Bloom Halo when firing Inferno Nova
                    if (isFiringNova) {
                        const bloomR = 6.0 + 3.0 * flareT;
                        const bloom = ctx.createRadialGradient(vx, vy, 0, vx, vy, bloomR);
                        bloom.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
                        bloom.addColorStop(0.35, 'rgba(255, 238, 68, 0.80)');
                        bloom.addColorStop(0.70, 'rgba(255, 68, 0, 0.40)');
                        bloom.addColorStop(1.0, 'rgba(255, 0, 0, 0)');
                        ctx.beginPath();
                        ctx.arc(vx, vy, bloomR, 0, Math.PI * 2);
                        ctx.fillStyle = bloom;
                        ctx.globalAlpha = 1.0;
                        ctx.fill();
                    }

                    // 2. Heavy volcanic vent nozzle casing
                    const casingR = isFiringNova ? 2.8 : 2.2;
                    ctx.beginPath();
                    ctx.arc(vx, vy, casingR, 0, Math.PI * 2);
                    ctx.fillStyle = isFiringNova ? '#ff6600' : '#ff4400';
                    ctx.strokeStyle = isFiringNova ? '#ffffff' : '#660000';
                    ctx.lineWidth = isFiringNova ? 1.2 : 1.0;
                    ctx.globalAlpha = 0.95;
                    ctx.fill();
                    ctx.stroke();

                    // 3. Searing thermal core aperture with glow
                    ctx.save();
                    if (isFiringNova) {
                        ctx.fillStyle = '#ffee44';
                        ctx.globalAlpha = 0.45;
                        ctx.beginPath();
                        ctx.arc(vx, vy, 3.0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.beginPath();
                    ctx.arc(vx, vy, isFiringNova ? 1.6 : 1.0, 0, Math.PI * 2);
                    ctx.fillStyle = isFiringNova ? '#ffffff' : '#ffee33';
                    ctx.globalAlpha = 1.0;
                    ctx.fill();
                    ctx.restore();
                }
            } else {
                const ftX = Math.cos(this.flameAngle) * 10.5;
                const ftY = Math.sin(this.flameAngle) * 10.5;
                ctx.fillStyle = '#ff6600';
                ctx.strokeStyle = '#992200';
                ctx.lineWidth = 1.0;
                ctx.globalAlpha = 0.80;
                ctx.beginPath();
                ctx.arc(ftX, ftY, 2.0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                
                ctx.fillStyle = '#ffee44';
                ctx.beginPath();
                ctx.arc(ftX, ftY, 0.9, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 5b. Autonomous Network: Quantum Transmitter Antenna & Relay Capacity Sockets (High-Contrast Option A)
        if (this.player && this.player.turretNetworkEnabled) {
            const connCount = this.connections ? this.connections.filter(c => c.alive).length : 0;
            const hasFreeLink = connCount < 2;
            const isPreExpanding = !!this.pendingExpansion;

            // 1. Dark High-Contrast Mounting Base Collar (separates antenna from player-colored cytoplasm)
            ctx.beginPath();
            ctx.ellipse(0, -3.8, 5.2, 2.4, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#0a1017';
            ctx.strokeStyle = '#e0f0ff';
            ctx.lineWidth = 1.0;
            ctx.globalAlpha = 0.95;
            ctx.fill();
            ctx.stroke();

            // 2. Dual Link Capacity Sockets on the dark mount (batched)
            const sockY = -3.8;
            const sockOffsets = [-3.0, 3.0];
            
            // Outer socket dark bezels
            ctx.beginPath();
            for (let i = 0; i < 2; i++) {
                const sockX = sockOffsets[i];
                ctx.moveTo(sockX + 1.7, sockY);
                ctx.arc(sockX, sockY, 1.7, 0, Math.PI * 2);
            }
            ctx.fillStyle = '#050a10';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 0.8;
            ctx.globalAlpha = 1.0;
            ctx.fill();
            ctx.stroke();

            // Inner diodes
            for (let i = 0; i < 2; i++) {
                const isLinked = i < connCount;
                const sockX = sockOffsets[i];
                const diodePulse = isLinked ? 1.0 : (0.4 + 0.6 * Math.sin(now * 0.008 + i * 2.0));
                ctx.fillStyle = isLinked ? '#00ffcc' : (hasFreeLink ? '#ffcc00' : '#556677');
                ctx.globalAlpha = isLinked ? 1.0 : (0.5 + 0.5 * diodePulse);
                ctx.beginPath();
                ctx.arc(sockX, sockY, 1.0, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 0.95;
                ctx.beginPath();
                ctx.arc(sockX, sockY, 0.45, 0, Math.PI * 2);
                ctx.fill();
            }

            // 3. High-Contrast Antenna Mast (projects above upper dendrite boundary to -12.5px)
            const mastBaseY = -3.8;
            const mastTipY = -12.5;

            // Dark outline underlay for 100% contrast (mast + cross-fin)
            ctx.beginPath();
            ctx.moveTo(0, mastBaseY);
            ctx.lineTo(0, mastTipY);
            ctx.moveTo(-2.8, -8.0);
            ctx.lineTo(2.8, -8.0);
            ctx.strokeStyle = '#050a10';
            ctx.lineWidth = 2.6;
            ctx.globalAlpha = 0.95;
            ctx.stroke();

            // Bright polished titanium core mast
            ctx.beginPath();
            ctx.moveTo(0, mastBaseY);
            ctx.lineTo(0, mastTipY);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.3;
            ctx.globalAlpha = 1.0;
            ctx.stroke();

            // Antenna cross-fin
            ctx.beginPath();
            ctx.moveTo(-2.8, -8.0);
            ctx.lineTo(2.8, -8.0);
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // 4. Pulsing Broadcast Beacon Light at Mast Apex (above the turret body)
            const beaconSpeed = isPreExpanding ? 0.018 : 0.0035;
            const beaconCycle = (now * beaconSpeed) % (Math.PI * 2);
            const beaconPulse = 0.6 + 0.4 * Math.sin(beaconCycle);
            const beaconColor = isPreExpanding ? '#ffffff' : (hasFreeLink ? '#00ffff' : '#ffaa00');

            // Expanding signal ripple from antenna tip
            if (hasFreeLink || isPreExpanding) {
                const waveSpeed = isPreExpanding ? 0.016 : 0.006;
                const waveMaxR = isPreExpanding ? 7.0 : 5.0;
                const waveR = 2.0 + ((now * waveSpeed) % 1.0) * waveMaxR;
                const waveAlpha = Math.max(0, 1 - (waveR - 2.0) / waveMaxR);
                ctx.beginPath();
                ctx.arc(0, mastTipY, waveR, 0, Math.PI * 2);
                ctx.strokeStyle = isPreExpanding ? '#00ffff' : beaconColor;
                ctx.lineWidth = isPreExpanding ? 1.4 : 0.9;
                ctx.globalAlpha = waveAlpha * (isPreExpanding ? 0.85 : 0.55);
                ctx.stroke();
            }

            // Dark bezel backing for the beacon bead
            ctx.beginPath();
            ctx.arc(0, mastTipY, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = '#050a10';
            ctx.globalAlpha = 0.90;
            ctx.fill();

            // Central beacon tip bead
            ctx.beginPath();
            ctx.arc(0, mastTipY, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = beaconColor;
            ctx.globalAlpha = 0.95 * beaconPulse;
            ctx.fill();

            // Searing white center glint
            ctx.beginPath();
            ctx.arc(0, mastTipY, 0.7, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 1.0;
            ctx.fill();
        }

        ctx.restore();

        // 6. Overclock Ambient Kinetic Sparks (subtle gold sparks without outer dashed ring)
        if (isOverclocked && Math.random() < 0.10) {
            const spd = 0.8 + Math.random() * 1.5;
            const spAng = Math.random() * Math.PI * 2;
            GAME_STATE.particles.push(new Particle(
                this.x + Math.cos(spAng) * 6,
                this.y + Math.sin(spAng) * 6,
                Math.cos(spAng) * spd,
                Math.sin(spAng) * spd,
                '#ffd700', 120
            ));
        }

        // 6b. Inferno Nova Ambient Volcanic Embers (tight rising thermal drift)
        if (isInfernoNova && Math.random() < 0.08) {
            const spawnR = Math.random() * 3.5;
            const spAng = Math.random() * Math.PI * 2;
            const vx = (Math.random() - 0.5) * 0.35;
            const vy = -0.35 - Math.random() * 0.40;
            GAME_STATE.particles.push(new Particle(
                this.x + Math.cos(spAng) * spawnR,
                this.y + Math.sin(spAng) * spawnR - 1.0,
                vx,
                vy,
                Math.random() < 0.5 ? '#ff4400' : '#ffee33', 200
            ));
        }

        // 7. Decaying Respiration Lifetime Ring
        const elapsed = now - this.spawnTime;
        const pct = Math.max(0, 1 - elapsed / this.duration);
        ctx.save();
        ctx.strokeStyle = isOverclocked ? '#ffee44' : pColor;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r + 4.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
        ctx.stroke();
        ctx.beginPath();
        ctx.restore();

        // 8. Health bar if damaged
        if (this.hp < this.maxHp) {
            const barW = 24;
            const barH = 3.5;
            const bx = this.x - barW / 2;
            const by = this.y - this.r - 10;
            const hpPct = Math.max(0, this.hp / this.maxHp);

            ctx.save();
            ctx.fillStyle = '#222222';
            ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

            ctx.fillStyle = hpPct > 0.5 ? '#00ffcc' : (hpPct > 0.25 ? '#ffff00' : '#ff3344');
            ctx.fillRect(bx, by, barW * hpPct, barH);
            ctx.restore();
        }

        ctx.restore();
    }
}

window.TurretEntity = TurretEntity;