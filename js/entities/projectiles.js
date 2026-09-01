class Projectile extends Entity {
    constructor(x = 0, y = 0, vx = 0, vy = 0, damage = 10, r = 4, owner = null, ignoreTarget = null, lifespan = 2000, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        super(x, y, (typeof r === 'number' ? r : 4));
        if (new.target === Projectile) {
            // Polymorphic dispatch when called with kind string as 6th argument
            if (typeof r === 'string') {
                const kind = r;
                const player = owner;
                const ignoreEnemy = ignoreTarget;
                const sourceUnitType = (typeof lifespan === 'string') ? lifespan : (player && player.unitType ? player.unitType : 'player');
                const spawnTime = (typeof now === 'number') ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
                if (kind === 'missile' || kind === 'laser') {
                    return new MagicMissileProjectile(x, y, vx, vy, damage, kind, player, ignoreEnemy, sourceUnitType, spawnTime);
                } else if (kind === 'shrapnel') {
                    return new ShrapnelProjectile(x, y, vx, vy, damage, player, ignoreEnemy, false, 0, sourceUnitType, spawnTime);
                }
            }
        }
        this.vx = vx;
        this.vy = vy;
        this.angle = Math.atan2(vy, vx);
        this.damage = damage;
        this.owner = owner;
        this.ignoreTarget = ignoreTarget;
        this.spawnTime = now;
        this.lifespan = (typeof lifespan === 'number') ? lifespan : 2000;
        this.pierce = 0;
        this.hitTargets = new Set();
    }

    setTrajectory(angle, speed) {
        this.angle = angle;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
    }

    get player() {
        return (typeof Player !== 'undefined' && this.owner instanceof Player) ? this.owner : (this.owner && this.owner.player ? this.owner.player : (this.owner || null));
    }

    isExpired(now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        if ((now - this.spawnTime) >= this.lifespan) {
            this.despawn();
            return true;
        }
        return false;
    }

    hasHit(target) {
        return this.hitTargets.has(target);
    }

    registerHit(target) {
        this.hitTargets.add(target);
        if (this.hitTargets.size > this.pierce) {
            this.despawn();
        }
    }

    updatePhysics(dtFactor = 1.0) {
        this.x += this.vx * dtFactor;
        this.y += this.vy * dtFactor;
    }

    checkBounds(minX = -50, minY = -50, maxX = (typeof W !== 'undefined' ? W + 50 : 1562), maxY = (typeof H !== 'undefined' ? H + 50 : 950)) {
        if (this.x < minX || this.y < minY || this.x > maxX || this.y > maxY) {
            this.despawn();
            return true;
        }
        return false;
    }
}

class RocketProjectile extends Projectile {
    constructor(x, y, angle, damage, player, now, sourceUnitType) {
        const speed = 7.5;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        super(x, y, vx, vy, damage, 13, player, null, 4000, now);
        this.angle = angle;
        this.isRocket = true;
        this.rocketStage = 0; // 0 = outward random, 1 = homing
        this.homingRadius = 250;
        this.sourceUnitType = sourceUnitType;
    }
    update(dt, dtFactor = 1.0, now) {
        const elapsed = now - this.spawnTime;
        if (elapsed > this.lifespan) {
            this.alive = false;
            return;
        }
        if (this.x < -50 || this.y < -50 || this.x > W + 50 || this.y > H + 50) {
            this.alive = false;
            return;
        }

        // Exhaust trail flames
        if (gameClock % 2 === 0) {
            const oppositeAngle = Math.atan2(this.vy, this.vx) + Math.PI;
            const px = this.x + Math.cos(oppositeAngle) * 8;
            const py = this.y + Math.sin(oppositeAngle) * 8;
            GAME_STATE.particles.push(new Particle(
                px, py,
                Math.cos(oppositeAngle + (Math.random() * 0.4 - 0.2)) * 1.5,
                Math.sin(oppositeAngle + (Math.random() * 0.4 - 0.2)) * 1.5,
                '#ffaa00', 300
            ));
        }

        if (this.rocketStage === 0) {
            this.x += this.vx * dtFactor;
            this.y += this.vy * dtFactor;
            if (elapsed >= 250) {
                this.rocketStage = 1;
            }
        } else {
            // Homing: Seek closest enemy with highest maxhp inside range
            let strongest = null;
            let highestMaxHp = -99999;
            let targetD2 = Infinity;
            const r2 = this.homingRadius * this.homingRadius;
            for (const e of GAME_STATE.enemies) {
                if (!isTargetable(e)) continue;
                const dx = e.x - this.x;
                const dy = e.y - this.y;
                const d2 = dx * dx + dy * dy;
                if (d2 <= r2) {
                    const enemyMaxHp = e.maxHp || e.hp;
                    if (enemyMaxHp > highestMaxHp) {
                        highestMaxHp = enemyMaxHp;
                        targetD2 = d2;
                        strongest = e;
                    } else if (enemyMaxHp === highestMaxHp && d2 < targetD2) {
                        targetD2 = d2;
                        strongest = e;
                    }
                }
            }

            if (strongest) {
                const dist = Math.sqrt(targetD2);
                if (dist > 0.1) {
                    const dx = strongest.x - this.x;
                    const dy = strongest.y - this.y;
                    const tx = (dx / dist) * 7.5;
                    const ty = (dy / dist) * 7.5;
                    const decay = Math.pow(0.90, dtFactor);
                    this.vx = this.vx * decay + tx * (1 - decay);
                    this.vy = this.vy * decay + ty * (1 - decay);
                }
                
                // Explode exactly when reaching the target's body boundary
                if (dist <= strongest.r + 5) {
                    this.detonate(now);
                    return;
                }
            }

            const prevX = this.x;
            const prevY = this.y;
            this.x += this.vx * dtFactor;
            this.y += this.vy * dtFactor;

            // Shield and Titan wall collision check for rockets
            if (GAME_STATE.shieldBearers.length > 0) {
                for (let i = 0; i < GAME_STATE.shieldBearers.length; i++) {
                    const e = GAME_STATE.shieldBearers[i];
                    if (e.hp > 0) {
                        const hit = testShieldArcHit(prevX, prevY, this.x, this.y, this.r, e.x, e.y, e.shieldRadius || 100, e.facingAngle || 0, e.shieldHalfArc || Math.PI * 0.5);
                        if (hit.hit) {
                            this.x = hit.hitX;
                            this.y = hit.hitY;
                            this.detonate(now, e);
                            return;
                        }
                    }
                }
            }
            if (GAME_STATE.activeBoss === 'behemoth') {
                for (let i = 0; i < GAME_STATE.enemies.length; i++) {
                    const e = GAME_STATE.enemies[i];
                    if (e.type === 'behemoth' && e.behemothState === 'tongue_dragging_wall' && e.hp > 0 && typeof e.wallPieceX === 'number') {
                        const hit = testOrientedBoxHit(prevX, prevY, this.x, this.y, this.r, e.wallPieceX, e.wallPieceY, 95, 22, e.wallPieceAngle || 0);
                        if (hit.hit) {
                            this.x = hit.hitX;
                            this.y = hit.hitY;
                            this.detonate(now, { x: e.wallPieceX, y: e.wallPieceY, isWallObstacle: true, halfW: 95, halfH: 22, angle: e.wallPieceAngle || 0 });
                            return;
                        }
                    }
                }
            }

            if (GAME_STATE.terrains && GAME_STATE.terrains.length > 0) {
                for (const t of GAME_STATE.terrains) {
                    if (t.isWallObstacle) {
                        const hit = testOrientedBoxHit(prevX, prevY, this.x, this.y, this.r, t.x, t.y, t.halfW || 95, t.halfH || 22, t.angle || 0);
                        if (hit.hit) {
                            this.x = hit.hitX;
                            this.y = hit.hitY;
                            this.detonate(now, t);
                            return;
                        }
                    } else if (!t.isExpired || !t.isExpired(now)) {
                        const hit = testShieldArcHit(prevX, prevY, this.x, this.y, this.r, t.x, t.y, t.r || 100, t.facingAngle || 0, t.shieldHalfArc || Math.PI * 0.5);
                        if (hit.hit) {
                            this.x = hit.hitX;
                            this.y = hit.hitY;
                            this.detonate(now, t);
                            return;
                        }
                    }
                }
            }
        }
    }
    detonate(now, hitObstacle = null) {
        this.alive = false;
        const blastRadius = 90 * (this.player ? this.player.mineAoeModifier : 1.0) * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
        const dmg = this.damage * this.player.damageModifier * GAME_STATE.dmgFactor;
        GAME_STATE.hazards.push(new MineExplosion(this.x, this.y, blastRadius, now, this.player));
        let totalRocketDmg = 0;
        const rocketHitEnemies = [];
        for (const e of GAME_STATE.enemies) {
            if (!isDamageable(e)) continue;
            const dx = e.x - this.x;
            const dy = e.y - this.y;
            if (dx * dx + dy * dy <= (blastRadius + e.r) * (blastRadius + e.r)) {
                // If detonation occurred on a shield or wall, verify line of sight
                if (hitObstacle) {
                    if (hitObstacle.isWallObstacle) {
                        const hitCheck = testOrientedBoxHit(this.x, this.y, e.x, e.y, e.r, hitObstacle.x, hitObstacle.y, hitObstacle.halfW || 95, hitObstacle.halfH || 22, hitObstacle.angle || 0);
                        if (hitCheck.hit) continue;
                    } else {
                        const sX = hitObstacle.x, sY = hitObstacle.y;
                        const sR = hitObstacle.shieldRadius || hitObstacle.r || 100;
                        const sFacing = hitObstacle.facingAngle || 0;
                        const sHalfArc = hitObstacle.shieldHalfArc || Math.PI * 0.5;
                        const hitCheck = testShieldArcHit(this.x, this.y, e.x, e.y, e.r, sX, sY, sR, sFacing, sHalfArc);
                        if (hitCheck.hit) continue;
                    }
                }
                e.hp -= dmg;
                totalRocketDmg += dmg;
                rocketHitEnemies.push(e);
                if(this.player.projectileLifedrainEnabled && this.sourceUnitType == 'player'){
                    this.player.heal(PROJECTILE_HEAL*dmg);
                    this.player.triggerLifestealVisual(e.x, e.y);
                }
                spawnHitParticles(e.x, e.y, this.player ? this.player.color : '#ff4400');
            }
        }
        applyExplosionHealing(this.x, this.y, blastRadius, totalRocketDmg, this.player, rocketHitEnemies);
    }
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(Math.atan2(this.vy, this.vx));
        ctx.scale(2.2, 2.2); // make the rocket look 2.2x larger visually to match the new collision radius!
        
        ctx.fillStyle = '#cfd8dc';
        ctx.strokeStyle = '#37474f';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(-10, -3, 14, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = this.player ? this.player.color : '#ff3333';
        ctx.beginPath();
        ctx.moveTo(4, -3);
        ctx.lineTo(10, 0);
        ctx.lineTo(4, 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, -3);
        ctx.lineTo(-13, -6);
        ctx.lineTo(-10, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-10, 3);
        ctx.lineTo(-13, 6);
        ctx.lineTo(-10, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();
    }
}

class SniperProjectile extends Projectile {
    constructor(x, y, angle, damage, player, now, sourceUnitType) {
        const speed = 48.0; // Extremely high-speed laser beam projectile
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        super(x, y, vx, vy, damage, 8, player, null, 2000, now);
        this.angle = angle;
        this.hitEnemies = new Set();
        this.sourceUnitType = sourceUnitType;
    }
    update(dt, dtFactor = 1.0, now) {
        if (now - this.spawnTime > this.lifespan) {
            this.alive = false;
            return;
        }
        const prevX = this.x;
        const prevY = this.y;
        const nextX = this.x + this.vx * dtFactor;
        const nextY = this.y + this.vy * dtFactor;

        // 1. Raycast continuous step from (prevX, prevY) to (nextX, nextY) against all shield bearers & titan walls
        const shieldCheck = findShieldArcIntersection(prevX, prevY, nextX, nextY, null);
        if (shieldCheck && shieldCheck.blocked) {
            this.x = shieldCheck.hitX;
            this.y = shieldCheck.hitY;
            if (this.player && this.player.laserSniperEnabled) {
                GAME_STATE.hazards.push(new LaserTrailSegment(prevX, prevY, this.x, this.y, now, this.player));
            }
            this.alive = false;
            spawnHitParticles(this.x, this.y, shieldCheck.isWallObstacle ? '#a8a29e' : '#ff8f00');
            return;
        }

        // 2. Point/proximity check against Shield Bearer shields, dropped shield terrains & Titan walls at next position
        if (GAME_STATE.shieldBearers.length > 0) {
            for (let i = 0; i < GAME_STATE.shieldBearers.length; i++) {
                const e = GAME_STATE.shieldBearers[i];
                if (e.hp > 0) {
                    const hit = testShieldArcHit(prevX, prevY, nextX, nextY, this.r, e.x, e.y, e.shieldRadius || 100, e.facingAngle || 0, e.shieldHalfArc || Math.PI * 0.5);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        if (this.player && this.player.laserSniperEnabled) {
                            GAME_STATE.hazards.push(new LaserTrailSegment(prevX, prevY, this.x, this.y, now, this.player));
                        }
                        this.alive = false;
                        spawnHitParticles(this.x, this.y, '#ff8f00');
                        return;
                    }
                }
            }
        }
        if (GAME_STATE.activeBoss === 'behemoth') {
            for (let i = 0; i < GAME_STATE.enemies.length; i++) {
                const e = GAME_STATE.enemies[i];
                if (e.type === 'behemoth' && e.behemothState === 'tongue_dragging_wall' && e.hp > 0 && typeof e.wallPieceX === 'number') {
                    const hit = testOrientedBoxHit(prevX, prevY, nextX, nextY, this.r, e.wallPieceX, e.wallPieceY, 95, 22, e.wallPieceAngle || 0);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        if (this.player && this.player.laserSniperEnabled) {
                            GAME_STATE.hazards.push(new LaserTrailSegment(prevX, prevY, this.x, this.y, now, this.player));
                        }
                        this.alive = false;
                        spawnHitParticles(this.x, this.y, '#a8a29e');
                        return;
                    }
                }
            }
        }
        if (GAME_STATE.terrains && GAME_STATE.terrains.length > 0) {
            for (const t of GAME_STATE.terrains) {
                if (t.isWallObstacle) {
                    const hit = testOrientedBoxHit(prevX, prevY, nextX, nextY, this.r, t.x, t.y, t.halfW || 95, t.halfH || 22, t.angle || 0);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        if (this.player && this.player.laserSniperEnabled) {
                            GAME_STATE.hazards.push(new LaserTrailSegment(prevX, prevY, this.x, this.y, now, this.player));
                        }
                        this.alive = false;
                        spawnHitParticles(this.x, this.y, '#a8a29e');
                        return;
                    }
                } else if (!t.isExpired || !t.isExpired(now)) {
                    const hit = testShieldArcHit(prevX, prevY, nextX, nextY, this.r, t.x, t.y, t.r || 100, t.facingAngle || 0, t.shieldHalfArc || Math.PI * 0.5);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        if (this.player && this.player.laserSniperEnabled) {
                            GAME_STATE.hazards.push(new LaserTrailSegment(prevX, prevY, this.x, this.y, now, this.player));
                        }
                        this.alive = false;
                        spawnHitParticles(this.x, this.y, '#ff8f00');
                        return;
                    }
                }
            }
        }

        // 3. If unblocked by shields, advance position and spawn laser trail segment
        this.x = nextX;
        this.y = nextY;
        if (this.player && this.player.laserSniperEnabled) {
            GAME_STATE.hazards.push(new LaserTrailSegment(prevX, prevY, this.x, this.y, now, this.player));
        }
        if (this.x < -150 || this.y < -150 || this.x > W + 150 || this.y > H + 150) {
            this.alive = false;
            return;
        }

        // 4. Damage monsters along the unblocked path using swept segment continuous collision detection
        const sX1 = prevX, sY1 = prevY;
        const sX2 = this.x, sY2 = this.y;
        const sDxSeg = sX2 - sX1, sDySeg = sY2 - sY1;
        const sLenSq = sDxSeg * sDxSeg + sDySeg * sDySeg;
        const sMinX = sX1 < sX2 ? sX1 : sX2;
        const sMaxX = sX1 > sX2 ? sX1 : sX2;
        const sMinY = sY1 < sY2 ? sY1 : sY2;
        const sMaxY = sY1 > sY2 ? sY1 : sY2;

        for (let i = 0; i < GAME_STATE.enemies.length; i++) {
            const e = GAME_STATE.enemies[i];
            if (!isTargetable(e)) continue;
            if (this.hitEnemies.has(e)) continue;

            const er = e.r + this.r;
            if (e.x < sMinX - er || e.x > sMaxX + er || e.y < sMinY - er || e.y > sMaxY + er) continue;

            let distSq;
            if (sLenSq === 0) {
                const dx = e.x - sX1, dy = e.y - sY1;
                distSq = dx * dx + dy * dy;
            } else {
                const wx = e.x - sX1, wy = e.y - sY1;
                const t = (wx * sDxSeg + wy * sDySeg) / sLenSq;
                const tClamped = t < 0 ? 0 : (t > 1 ? 1 : t);
                const px = sX1 + tClamped * sDxSeg, py = sY1 + tClamped * sDySeg;
                const ex = e.x - px, ey = e.y - py;
                distSq = ex * ex + ey * ey;
            }

            if (distSq <= er * er) {
                // If the enemy itself is a shield bearer, check if hit is in front arc
                if (e.type === 'shield_bearer') {
                    const angleToHit = Math.atan2(prevY - e.y, prevX - e.x);
                    let diff = Math.abs(angleToHit - (e.facingAngle || 0));
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    diff = Math.abs(diff);
                    if (diff <= (e.shieldHalfArc || Math.PI * 0.5)) {
                        this.alive = false;
                        spawnHitParticles(this.x, this.y, '#ff8f00');
                        return;
                    }
                }
                this.hitEnemies.add(e);
                e.hp -= this.damage;
                if (this.player && this.player.projectileLifedrainEnabled && this.sourceUnitType === 'player') {
                    this.player.heal(PROJECTILE_HEAL * this.damage);
                    this.player.triggerLifestealVisual(e.x, e.y);
                }
                if (this.player && this.player.freezeEnabled && !e.isBoss()) {
                    const dur = (e.type === 'meteor') ? 125 : 250;
                    e.freeze(dur, now);
                }
                const particleColor = this.player ? this.player.color : '#00ffff';
                spawnHitParticles(e.x, e.y, particleColor);
            }
        }
    }
    draw() {
        const length = 120;
        const x1 = this.x - Math.cos(this.angle) * length;
        const y1 = this.y - Math.sin(this.angle) * length;

        ctx.save();
        // Cyan / player color outer glow tracer line
        ctx.strokeStyle = this.player ? this.player.color : '#00ffff';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(this.x, this.y);
        ctx.stroke();

        // Intense white inner core line
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(this.x, this.y);
        ctx.stroke();

        // Front glowing pulse bead
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(this.x, this.y, 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

function checkDeflectorOrbiterBlock(proj, now) {
    if (!proj || !proj.alive) return false;
    for (const p of GAME_STATE.players) {
        if (!p.alive) continue;
        const deflectorWeapon = p.weapons ? p.weapons.find(w => w.id === 'projectile_shield') : null;
        if (!deflectorWeapon || !deflectorWeapon.orbiters) continue;
        for (const orb of deflectorWeapon.orbiters) {
            if (now < orb.inactiveUntil) continue;
            const dx = proj.x - orb.x, dy = proj.y - orb.y;
            const touch = orb.r + (proj.r || 6) + 4;
            if (dx * dx + dy * dy < touch * touch) {
                proj.alive = false;
                orb.inactiveUntil = now + 3000; // Shield destroyed: respawns in 3s
                SoundEngine.shieldBlock();
                orb.lastBlockTime = now;
                if (p.mitosisBuds) {
                    p.mitosisBuds.push({ angle: orb.angle, time: now, duration: 260 });
                }
                for (let i = 0; i < 10; i++) {
                    const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 2.8;
                    const col = (i % 2 === 0) ? p.color : '#ffffff';
                    GAME_STATE.particles.push(new Particle(proj.x, proj.y, Math.cos(a) * s, Math.sin(a) * s, col, 350));
                }
                return true;
            }
        }
    }
    return false;
}

window.checkDeflectorOrbiterBlock = checkDeflectorOrbiterBlock;

class MarauderMissile extends Projectile {
    // Fast, undodgeable concussive shell fired by Marauder enemies.
    // Applies Concussive Shells: slows target by 40% for 2 seconds on impact.
    constructor(x, y, vx, vy, damage, sourceEnemy) {
        super(x, y, vx, vy, damage, 7, sourceEnemy, null, 5000);
        this.sourceEnemy = sourceEnemy;
        this.life = 5000;
        this.trailParticleTimer = 0;
    }
    update(dt, dtFactor = 1.0, now) {
        this.x += this.vx * dtFactor;
        this.y += this.vy * dtFactor;
        this.life -= dt;

        // Spawn small exhaust trail particles
        this.trailParticleTimer += dt;
        if (this.trailParticleTimer >= 25) {
            this.trailParticleTimer = 0;
            const backX = this.x - Math.cos(this.angle) * 10;
            const backY = this.y - Math.sin(this.angle) * 10;
            GAME_STATE.particles.push(new Particle(
                backX + (Math.random() - 0.5) * 4,
                backY + (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 0.4,
                (Math.random() - 0.5) * 0.4,
                Math.random() < 0.5 ? '#ff8c00' : '#ffcc44',
                200
            ));
        }

        if (this.life <= 0) this.alive = false;
        if (this.x < -50 || this.y < -50 || this.x > W + 50 || this.y > H + 50) this.alive = false;

        // Deflector Orbiters interception check (Marauder missiles)
        if (checkDeflectorOrbiterBlock(this, now)) return;

        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const dx = p.x - this.x, dy = p.y - this.y;
            if (dx * dx + dy * dy < (p.r + this.r) * (p.r + this.r)) {
                p.takeDamage(this.damage, now, this);
                // Concussive Shells: 40% slow for 2 seconds
                p.slowUntil = Math.max(p.slowUntil || 0, now + 2000);
                this.alive = false;
                // Blue-grey impact burst
                for (let i = 0; i < 10; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const s = 1.5 + Math.random() * 2.5;
                    GAME_STATE.particles.push(new Particle(
                        this.x, this.y,
                        Math.cos(a) * s, Math.sin(a) * s,
                        i < 5 ? '#90a4ae' : '#ff8c00', 350
                    ));
                }
                break;
            }
        }
    }
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // Outer glow ring (blue-grey)
        ctx.globalAlpha = 0.30;
        ctx.fillStyle = '#78909c';
        ctx.beginPath();
        ctx.arc(0, 0, this.r + 5, 0, Math.PI * 2);
        ctx.fill();

        // Grenade body (elongated grey-blue capsule)
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#546e7a';
        ctx.beginPath();
        ctx.ellipse(0, 0, this.r + 2, this.r - 1, 0, 0, Math.PI * 2);
        ctx.fill();

        // Dark nose cone
        ctx.fillStyle = '#263238';
        ctx.beginPath();
        ctx.ellipse(this.r + 1, 0, 4, this.r - 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Yellow-white highlight stripe
        ctx.strokeStyle = '#eceff1';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-this.r + 2, -2);
        ctx.lineTo(this.r - 2, -2);
        ctx.stroke();

        ctx.restore();
    }
}

class ShooterProjectile extends Projectile {
    constructor(x, y, vx, vy, damage, sourceEnemy = null, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        super(x, y, vx, vy, damage, 6, sourceEnemy, null, 4000, now);
        this.sourceEnemy = sourceEnemy;
        this.kind = 'shooter_bolt';
    }
    update(dt, dtFactor = 1.0, now) {
        this.updatePhysics(dtFactor);
        if (this.isExpired(now) || this.checkBounds(-40, -40, W + 40, H + 40)) return;
        
        // Deflector Orbiters interception check (Shooter bolts)
        if (typeof checkDeflectorOrbiterBlock === 'function' && checkDeflectorOrbiterBlock(this, now)) return;
        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const dx = p.x - this.x, dy = p.y - this.y;
            if (dx * dx + dy * dy < (p.r + this.r) * (p.r + this.r)) {
                p.takeDamage(this.damage, now, this);
                this.despawn();
                const pColor = (this.sourceEnemy && this.sourceEnemy.color) ? brightenColor(this.sourceEnemy.color, 1.8) : '#bb44ff';
                spawnHitParticles(this.x, this.y, pColor);
                break;
            }
        }
    }
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        const baseColor = (this.sourceEnemy && this.sourceEnemy.color) ? this.sourceEnemy.color : '#bb44ff';
        const bodyColor = brightenColor(baseColor, 1.8);
        const glowColor = brightenColor(baseColor, 2.2);

        // Outer glowing oval
        ctx.fillStyle = glowColor;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.ellipse(0, 0, (this.r + 3) * 1.5, (this.r + 2) * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Core oval
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(0, 0, this.r * 1.5, this.r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = '#1a0033'; // Dark outline around projectile
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }
}

class SpikyProjectile extends Projectile {
    constructor(x, y, vx, vy, damage, sourceEnemy = null, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        super(x, y, vx, vy, damage, 4, sourceEnemy, null, 700, now);
        this.sourceEnemy = sourceEnemy;
        this.kind = 'spike';
    }
    update(dt, dtFactor = 1.0, now) {
        this.updatePhysics(dtFactor);
        if (this.isExpired(now) || this.checkBounds(-40, -40, W + 40, H + 40)) return;
        
        // Deflector Orbiters interception check (Spikes)
        if (typeof checkDeflectorOrbiterBlock === 'function' && checkDeflectorOrbiterBlock(this, now)) return;
        for (const p of GAME_STATE.players) {
            if (!p.alive) continue;
            const dx = p.x - this.x, dy = p.y - this.y;
            if (dx * dx + dy * dy < (p.r + this.r) * (p.r + this.r)) {
                p.takeDamage(this.damage, now, this);
                this.despawn();
                spawnHitParticles(this.x, this.y, '#ff1100');
                break;
            }
        }
    }
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.fillStyle = '#ff1100';
        ctx.strokeStyle = '#110000'; // Dark border for high threat spikes
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-6, -4);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-6, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}

class OrbitProjectile extends Projectile {
    constructor(player, angle, rotSpeed, radius, damage, duration, now) {
        const x = player.x + Math.cos(angle) * radius;
        const y = player.y + Math.sin(angle) * radius;
        super(x, y, 0, 0, damage, 10, player, null, duration, now);
        this.angle = angle;
        this.rotSpeed = rotSpeed;
        this.radius = radius;
        this.expires = now + duration;
        this.active = true; // active state for mine ring respawns
        this.respawnTime = 0;
        this.hitCooldown = new Map(); // enemy -> nextHitTime
    }
    update(dt, dtFactor = 1.0, now) {
        if (now > this.expires || !this.player.alive) { this.alive = false; return; }
        
        // Always update angle and coordinates so it keeps its place in the rotating ring
        this.angle += (this.rotSpeed / this.player.cooldownModifier) * dtFactor;
        this.x = this.player.x + Math.cos(this.angle) * this.radius;
        this.y = this.player.y + Math.sin(this.angle) * this.radius;

        if (this.player.mineRingEnabled && !this.active) {
            if (now >= this.respawnTime) {
                this.active = true;
                this.respawnAnimation = {
                    startTime: now,
                    duration: 380
                };
                this.player.mitosisBuds = this.player.mitosisBuds || [];
                this.player.mitosisBuds.push({ angle: this.angle, time: now, duration: 380 });
            } else {
                return; // invisible and non-colliding
            }
        }

        const orbBox = this.r + 85;
        let exploded = false;

        SPATIAL_GRID.queryBox(this.x - orbBox, this.x + orbBox, this.y - orbBox, this.y + orbBox, e => {
            if (!isTargetable(e)) return;
            const dx = e.x - this.x, dy = e.y - this.y;
            if (dx * dx + dy * dy < (e.r + this.r) * (e.r + this.r)) {
                if (this.player.mineRingEnabled) {
                    exploded = true;
                    return false; // early out
                } else {
                    const next = this.hitCooldown.get(e) || 0;
                    if (now >= next) {
                        e.hp -= this.damage;
                        const hitDelay = Math.max(50, 400 * this.player.cooldownModifier);
                        this.hitCooldown.set(e, now + hitDelay);
                        spawnHitParticles(e.x, e.y, this.player.color);
                        SoundEngine.fireRingHit();
                    }
                }
            }
        });
        if (exploded) {
            this.explode(now);
        }
    }
    explode(now) {
        this.active = false;
        const pm = this.player.weapons.find(w => w.id === 'proximity_mine');
        const baseDmg = pm ? pm.damage : 18;
        const dmg = baseDmg * this.player.mineDamageModifier * GAME_STATE.dmgFactor;
        const explosionRadius = 50 * this.player.mineAoeModifier * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
        const cooldown = pm ? pm.baseCooldown * this.player.mineCooldownModifier : 2400 * this.player.mineCooldownModifier;
        this.respawnTime = now + cooldown;

        let totalOrbiterExpDmg = 0;
        const orbiterHitEnemies = [];
        const hitSet = new Set();
        const expBox = explosionRadius + 85;

        SPATIAL_GRID.queryBox(this.x - expBox, this.x + expBox, this.y - expBox, this.y + expBox, e => {
            if (hitSet.has(e) || !isDamageable(e)) return;
            const dx = e.x - this.x;
            const dy = e.y - this.y;
            if (dx * dx + dy * dy <= (explosionRadius + e.r) * (explosionRadius + e.r)) {
                hitSet.add(e);
                e.hp -= dmg;
                totalOrbiterExpDmg += dmg;
                orbiterHitEnemies.push(e);
                if (this.player.freezeEnabled && !e.isBoss()) {
                    let dur = (e.type === 'meteor') ? 500 : 1000;
                    if (this.player.cryoMineBuffed) dur *= 2;
                    e.freeze(dur, now);
                }
                spawnHitParticles(e.x, e.y, '#ffcc00');
            }
        });
        applyExplosionHealing(this.x, this.y, explosionRadius, totalOrbiterExpDmg, this.player, orbiterHitEnemies);
        for (let i = 0; i < 15; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.0 + Math.random() * 2.5;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            GAME_STATE.particles.push(new Particle(
                this.x, this.y, vx, vy, '#ff5500', 300 + Math.random() * 200
            ));
        }
        GAME_STATE.hazards.push(new MineExplosion(this.x, this.y, explosionRadius, now, this.player));
    }
    draw(now = gameClock) {
        if (this.player.mineRingEnabled && !this.active) return;
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : gameClock;
        
        ctx.save();
        if (this.player.mineRingEnabled) {
            let mineDrawX = this.x;
            let mineDrawY = this.y;
            let mineScale = 1.0;

            // Protruding arm animation placing the newly respawned mine into orbit
            if (this.respawnAnimation) {
                const elapsed = curTime - this.respawnAnimation.startTime;
                if (elapsed < this.respawnAnimation.duration) {
                    const t = elapsed / this.respawnAnimation.duration;
                    let reach = 0;
                    let armAlpha = 1.0;
                    if (t < 0.45) {
                        const extendT = t / 0.45;
                        reach = Math.sin(extendT * Math.PI * 0.5);
                        mineScale = 0.35 + 0.65 * reach;
                    } else {
                        const retractT = (t - 0.45) / 0.55;
                        reach = 1.0 - retractT;
                        armAlpha = 1.0 - retractT * 0.7;
                        mineScale = 1.0;
                    }

                    // Root position on player perimeter
                    const rootX = this.player.x + Math.cos(this.angle) * this.player.r;
                    const rootY = this.player.y + Math.sin(this.angle) * this.player.r;
                    const normX = -Math.sin(this.angle);
                    const normY = Math.cos(this.angle);

                    // Current reach distance along current orbiting angle
                    const currentDist = this.player.r + (this.radius - this.player.r) * reach;
                    const tipX = this.player.x + Math.cos(this.angle) * currentDist;
                    const tipY = this.player.y + Math.sin(this.angle) * currentDist;

                    if (t < 0.45) {
                        mineDrawX = tipX;
                        mineDrawY = tipY;
                    }

                    // Render organic protruding arm stalk
                    if (reach > 0.02) {
                        const rootWidth = Math.max(2.0, 5.0 * Math.min(1.0, reach * 2.0));
                        const tipWidth = Math.max(1.2, 3.2 * reach);
                        
                        const rLx = rootX + normX * rootWidth;
                        const rLy = rootY + normY * rootWidth;
                        const rRx = rootX - normX * rootWidth;
                        const rRy = rootY - normY * rootWidth;

                        const tLx = tipX + normX * tipWidth;
                        const tLy = tipY + normY * tipWidth;
                        const tRx = tipX - normX * tipWidth;
                        const tRy = tipY - normY * tipWidth;

                        const midDist = (this.player.r + currentDist) * 0.5;
                        const midX = this.player.x + Math.cos(this.angle) * midDist;
                        const midY = this.player.y + Math.sin(this.angle) * midDist;
                        const waist = Math.max(1.0, (rootWidth + tipWidth) * 0.35);

                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(rLx, rLy);
                        ctx.quadraticCurveTo(midX + normX * waist, midY + normY * waist, tLx, tLy);
                        ctx.lineTo(tRx, tRy);
                        ctx.quadraticCurveTo(midX - normX * waist, midY - normY * waist, rRx, rRy);
                        ctx.closePath();

                        ctx.fillStyle = this.player.color;
                        ctx.globalAlpha = 0.90 * armAlpha;
                        ctx.fill();

                        ctx.strokeStyle = this.player.ring || '#000000';
                        ctx.lineWidth = 1.3;
                        ctx.stroke();

                        // Knuckle node on the arm
                        ctx.fillStyle = this.player.ring || '#222222';
                        ctx.beginPath();
                        ctx.arc(midX, midY, Math.max(1.0, 2.2 * reach), 0, Math.PI * 2);
                        ctx.fill();
                        ctx.restore();
                    }
                } else {
                    this.respawnAnimation = null;
                }
            }

            // Draw matching the new translucent bio-vesicle mine style
            drawBioMineVesicle(ctx, mineDrawX, mineDrawY, this.r * mineScale, curTime, this.player, false, 0, false);
        } else {
            // Draw as fire ball
            ctx.fillStyle = '#ff6600';
            ctx.shadowColor = this.player ? this.player.color : '#ff9900';
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

class DeflectorOrbiter extends Projectile {
    constructor(player, startAngle, rotSpeed, radius, duration, now) {
        const orbitRadius = radius || (player.r + 14);
        const x = player.x + Math.cos(startAngle) * orbitRadius;
        const y = player.y + Math.sin(startAngle) * orbitRadius;
        super(x, y, 0, 0, 0, 13, player, null, duration, now);
        this.angle = startAngle;
        this.rotSpeed = rotSpeed;
        this.orbitRadius = orbitRadius;
        this.inactiveUntil = 0;
        this.lastBlockTime = 0;
        this.growth = 0.0;
    }
    update(dt, dtFactor = 1.0, now) {
        if (now - this.spawnTime > this.lifespan || !this.player.alive) {
            this.alive = false;
            return;
        }

        // Dynamic Attack Speed scaling
        const attackSpeedRatio = 1.0 / (this.player.cooldownModifier || 1.0);
        const shieldSpeedScale = attackSpeedRatio;
        this.angle += this.rotSpeed * shieldSpeedScale * dtFactor;

        // Dynamic Growth State (growing out on spawn/respawn, contracting on break)
        const respawnMs = GAME_CONFIG.UPGRADES.DEFLECTOR_ORBITERS_RESPAWN_SEC * 1000;
        if (now < this.inactiveUntil) {
            const timeSinceBreak = now - (this.inactiveUntil - respawnMs);
            if (timeSinceBreak < 250) {
                // Retraction phase after destruction
                this.growth = Math.max(0, 1.0 - (timeSinceBreak / 250));
            } else if (now >= this.inactiveUntil - 800) {
                // Growth / emergence phase before full respawn
                const t = (now - (this.inactiveUntil - 800)) / 800;
                this.growth = t * t * (3 - 2 * t); // smooth cubic ease 0 to 1
            } else {
                this.growth = 0.0;
            }
        } else {
            // Active state (smooth initial emergence)
            const elapsed = now - this.spawnTime;
            this.growth = Math.min(1.0, elapsed / 300);
        }

        const maxExtension = 14;
        this.orbitRadius = this.player.r + 2 + maxExtension * this.growth;
        
        const prevX = this.x;
        const prevY = this.y;
        this.x = this.player.x + Math.cos(this.angle) * this.orbitRadius;
        this.y = this.player.y + Math.sin(this.angle) * this.orbitRadius;

        if (now < this.inactiveUntil) {
            return;
        }

        // Collide and destroy enemy projectiles
        const dx_sweep = this.x - prevX;
        const dy_sweep = this.y - prevY;
        const sweepLen2 = dx_sweep * dx_sweep + dy_sweep * dy_sweep;

        for (const proj of GAME_STATE.enemyProjectiles) {
            if (!proj.alive) continue;
            
            let dist2;
            if (sweepLen2 > 0) {
                const t = Math.max(0, Math.min(1, ((proj.x - prevX) * dx_sweep + (proj.y - prevY) * dy_sweep) / sweepLen2));
                const cx = prevX + t * dx_sweep;
                const cy = prevY + t * dy_sweep;
                const pdx = proj.x - cx;
                const pdy = proj.y - cy;
                dist2 = pdx * pdx + pdy * pdy;
            } else {
                const pdx = proj.x - this.x;
                const pdy = proj.y - this.y;
                dist2 = pdx * pdx + pdy * pdy;
            }

            const touch = this.r + (proj.r || 6) + 4;
            if (dist2 < touch * touch) {
                proj.alive = false;
                this.inactiveUntil = now + respawnMs; // Shield destroyed: respawns in config seconds
                this.lastBlockTime = now;
                if (this.player.mitosisBuds) {
                    this.player.mitosisBuds.push({ angle: this.angle, time: now, duration: 260 });
                }
                for (let i = 0; i < 10; i++) {
                    const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 2.8;
                    const col = (i % 2 === 0) ? this.player.color : '#ffffff';
                    GAME_STATE.particles.push(new Particle(proj.x, proj.y, Math.cos(a) * s, Math.sin(a) * s, col, 350));
                }
                break;
            }
        }
    }
    draw(now = performance.now()) {
        if (this.growth <= 0.01) return;

        ctx.save();

        const rootX = this.player.x + Math.cos(this.angle) * this.player.r;
        const rootY = this.player.y + Math.sin(this.angle) * this.player.r;
        const normX = -Math.sin(this.angle);
        const normY = Math.cos(this.angle);

        // 1. Organic Pedicle Arm connecting root on blob to the plate
        if (this.growth > 0.05) {
            const armRootW = Math.max(1.5, 2.8 * this.growth);
            const armTipW = Math.max(1.0, 1.5 * this.growth);
            
            const rLx = rootX + normX * armRootW;
            const rLy = rootY + normY * armRootW;
            const rRx = rootX - normX * armRootW;
            const rRy = rootY - normY * armRootW;

            const tLx = this.x + normX * armTipW;
            const tLy = this.y + normY * armTipW;
            const tRx = this.x - normX * armTipW;
            const tRy = this.y - normY * armTipW;

            // Draw tapering muscular arm
            ctx.beginPath();
            ctx.moveTo(rLx, rLy);
            ctx.lineTo(tLx, tLy);
            ctx.lineTo(tRx, tRy);
            ctx.lineTo(rRx, rRy);
            ctx.closePath();

            ctx.fillStyle = this.player.color;
            ctx.globalAlpha = 0.85 * this.growth;
            ctx.fill();
            ctx.strokeStyle = this.player.ring || '#000000';
            ctx.lineWidth = 1.0;
            ctx.stroke();

            // Chitin joint node on the arm
            const midArmX = (rootX + this.x) * 0.5;
            const midArmY = (rootY + this.y) * 0.5;
            ctx.fillStyle = this.player.ring || '#222222';
            ctx.beginPath();
            ctx.arc(midArmX, midArmY, Math.max(1.0, 1.8 * this.growth), 0, Math.PI * 2);
            ctx.fill();
        }

        // 2. Clear Chitin Carapace Plating mounted furthest out on the arm
        ctx.translate(this.x, this.y);
        // Flipped along radial axis so the convex arch points forward in the spin direction
        ctx.rotate(this.angle - Math.PI / 2);
        ctx.scale(this.growth, this.growth);

        const isRecentBlock = (now - this.lastBlockTime < 350);
        if (isRecentBlock) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4.5;
            ctx.globalAlpha = 0.45;
            ctx.stroke();
        }

        const plateH = 4.8;
        const curveR = 11.5;

        // Clear plating contour
        ctx.beginPath();
        ctx.arc(0, 0, curveR + plateH * 0.5, -Math.PI * 0.36, Math.PI * 0.36);
        ctx.arc(
            Math.cos(Math.PI * 0.36) * curveR,
            Math.sin(Math.PI * 0.36) * curveR,
            plateH * 0.5,
            Math.PI * 0.36,
            Math.PI * 0.36 + Math.PI
        );
        ctx.arc(0, 0, Math.max(2, curveR - plateH * 0.5), Math.PI * 0.36, -Math.PI * 0.36, true);
        ctx.arc(
            Math.cos(-Math.PI * 0.36) * curveR,
            Math.sin(-Math.PI * 0.36) * curveR,
            plateH * 0.5,
            -Math.PI * 0.36 + Math.PI,
            -Math.PI * 0.36
        );
        ctx.closePath();

        // Hardened chitin carapace plate fill
        ctx.fillStyle = this.player ? this.player.color : '#33ccff';
        ctx.globalAlpha = 0.95;
        ctx.fill();

        // Thickened membrane border
        ctx.strokeStyle = this.player ? this.player.ring : '#111111';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // Bioluminescent Structural Ribs (3 transverse luminous ridges)
        const bioGlowPulse = 0.5 + 0.5 * Math.sin(now * 0.006 + this.angle);
        ctx.strokeStyle = isRecentBlock ? '#ffffff' : (this.player ? this.player.color : '#ffffff');
        ctx.lineWidth = 1.1;
        ctx.globalAlpha = 0.70 + 0.30 * bioGlowPulse;

        for (let i = -1; i <= 1; i++) {
            const ribAngle = i * (Math.PI * 0.22);
            const inX = Math.cos(ribAngle) * (curveR - plateH * 0.4);
            const inY = Math.sin(ribAngle) * (curveR - plateH * 0.4);
            const outX = Math.cos(ribAngle) * (curveR + plateH * 0.4);
            const outY = Math.sin(ribAngle) * (curveR + plateH * 0.4);
            ctx.beginPath();
            ctx.moveTo(inX, inY);
            ctx.lineTo(outX, outY);
            ctx.stroke();
        }

        // Hardened outer shield crest (protective gleam)
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = 0.90;
        ctx.beginPath();
        ctx.arc(0, 0, curveR + plateH * 0.5, -Math.PI * 0.25, Math.PI * 0.25);
        ctx.stroke();

        ctx.restore();
    }
}


class ShrapnelProjectile extends Projectile {
    constructor(x, y, vx, vy, damage, player = null, ignoreEnemy = null, isExplosive = false, aoeRadius = 0, sourceUnitType = "player", now = (typeof gameClock !== "undefined" ? gameClock : performance.now())) {
        super(x, y, vx, vy, damage, 1.0, player, ignoreEnemy, 800, now);
        this.kind = "shrapnel";
        this.isExplosive = isExplosive;
        this.aoeRadius = aoeRadius;
        this.sourceUnitType = sourceUnitType;
    }
    update(dt, dtFactor = 1.0, now) {
        const prevX = this.x;
        const prevY = this.y;
        this.updatePhysics(dtFactor);
        if (this.isExpired(now) || this.checkBounds()) return;

        // Barrier interception checks (Shield Bearer, Behemoth tongue wall, dropped shield terrains)
        if (GAME_STATE.shieldBearers && GAME_STATE.shieldBearers.length > 0) {
            for (let i = 0; i < GAME_STATE.shieldBearers.length; i++) {
                const e = GAME_STATE.shieldBearers[i];
                if (e.hp > 0) {
                    const hit = testShieldArcHit(prevX, prevY, this.x, this.y, this.r, e.x, e.y, e.shieldRadius || 100, e.facingAngle || 0, e.shieldHalfArc || Math.PI * 0.5);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        if (this.isExplosive) {
                            this.explode(now, null, e);
                        } else {
                            this.despawn();
                            spawnHitParticles(this.x, this.y, "#ff8f00");
                        }
                        return;
                    }
                }
            }
        }
        if (GAME_STATE.activeBoss === "behemoth") {
            for (let i = 0; i < GAME_STATE.enemies.length; i++) {
                const e = GAME_STATE.enemies[i];
                if (e.type === "behemoth" && e.behemothState === "tongue_dragging_wall" && e.hp > 0 && typeof e.wallPieceX === "number") {
                    const hit = testOrientedBoxHit(prevX, prevY, this.x, this.y, this.r, e.wallPieceX, e.wallPieceY, 95, 22, e.wallPieceAngle || 0);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        const wallObj = { x: e.wallPieceX, y: e.wallPieceY, isWallObstacle: true, halfW: 95, halfH: 22, angle: e.wallPieceAngle || 0 };
                        if (this.isExplosive) {
                            this.explode(now, null, wallObj);
                        } else {
                            this.despawn();
                            spawnHitParticles(this.x, this.y, "#a8a29e");
                        }
                        return;
                    }
                }
            }
        }
        if (GAME_STATE.terrains && GAME_STATE.terrains.length > 0) {
            for (const t of GAME_STATE.terrains) {
                if (t.isWallObstacle) {
                    const hit = testOrientedBoxHit(prevX, prevY, this.x, this.y, this.r, t.x, t.y, t.halfW || 95, t.halfH || 22, t.angle || 0);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        if (this.isExplosive) {
                            this.explode(now, null, t);
                        } else {
                            this.despawn();
                            spawnHitParticles(this.x, this.y, "#a8a29e");
                        }
                        return;
                    }
                } else if (!t.isExpired || !t.isExpired(now)) {
                    const hit = testShieldArcHit(prevX, prevY, this.x, this.y, this.r, t.x, t.y, t.r || 100, t.facingAngle || 0, t.shieldHalfArc || Math.PI * 0.5);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        if (this.isExplosive) {
                            this.explode(now, null, t);
                        } else {
                            this.despawn();
                            spawnHitParticles(this.x, this.y, "#ff8f00");
                        }
                        return;
                    }
                }
            }
        }

        // Continuous Collision Detection (CCD)
        const x1 = prevX, y1 = prevY;
        const x2 = this.x, y2 = this.y;
        const dxSeg = x2 - x1, dySeg = y2 - y1;
        const lenSq = dxSeg * dxSeg + dySeg * dySeg;
        const minX = x1 < x2 ? x1 : x2;
        const maxX = x1 > x2 ? x1 : x2;
        const minY = y1 < y2 ? y1 : y2;
        const maxY = y1 > y2 ? y1 : y2;

        if (this.isExplosive) {
            // Explosive shrapnel detonates on the first contacted enemy
            let closestEnemy = null;
            let closestT = Infinity;
            const pad = this.r + 85;
            SPATIAL_GRID.queryBox(minX - pad, maxX + pad, minY - pad, maxY + pad, e => {
                if (e.hp <= 0 || e.burrowed || e.airborne || !isOnPlayableArea(e)) return;
                if (e === this.ignoreTarget) return;

                const er = e.r + this.r;
                if (e.x < minX - er || e.x > maxX + er || e.y < minY - er || e.y > maxY + er) return;

                let tClamped, distSq;
                if (lenSq === 0) {
                    const dx = e.x - x1, dy = e.y - y1;
                    distSq = dx * dx + dy * dy;
                    tClamped = 0;
                } else {
                    const wx = e.x - x1, wy = e.y - y1;
                    const t = (wx * dxSeg + wy * dySeg) / lenSq;
                    tClamped = t < 0 ? 0 : (t > 1 ? 1 : t);
                    const px = x1 + tClamped * dxSeg, py = y1 + tClamped * dySeg;
                    const ex = e.x - px, ey = e.y - py;
                    distSq = ex * ex + ey * ey;
                }

                if (distSq <= er * er) {
                    if (e.type === "shield_bearer") {
                        const angleToProj = Math.atan2(y2 - e.y, x2 - e.x);
                        let angleDiff = Math.abs(angleToProj - (e.facingAngle || 0));
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        angleDiff = Math.abs(angleDiff);
                        const shieldHalfArc = e.shieldHalfArc || Math.PI * 0.5;
                        if (angleDiff <= shieldHalfArc) return;
                    }
                    if (tClamped < closestT) {
                        closestT = tClamped;
                        closestEnemy = e;
                    }
                }
            });

            if (closestEnemy) {
                this.x = x1 + closestT * dxSeg;
                this.y = y1 + closestT * dySeg;
                this.explode(now, closestEnemy);
                return;
            }
        } else {
            // Piercing non-explosive shrapnel damages all enemies intersected along trajectory
            const pad = this.r + 85;
            SPATIAL_GRID.queryBox(minX - pad, maxX + pad, minY - pad, maxY + pad, e => {
                if (e.hp <= 0 || e.burrowed || e.airborne || !isOnPlayableArea(e)) return;
                if (e === this.ignoreTarget) return;
                if (this.hasHit(e)) return;

                const er = e.r + this.r;
                if (e.x < minX - er || e.x > maxX + er || e.y < minY - er || e.y > maxY + er) return;

                let distSq;
                if (lenSq === 0) {
                    const dx = e.x - x1, dy = e.y - y1;
                    distSq = dx * dx + dy * dy;
                } else {
                    const wx = e.x - x1, wy = e.y - y1;
                    const t = (wx * dxSeg + wy * dySeg) / lenSq;
                    const tClamped = t < 0 ? 0 : (t > 1 ? 1 : t);
                    const px = x1 + tClamped * dxSeg, py = y1 + tClamped * dySeg;
                    const ex = e.x - px, ey = e.y - py;
                    distSq = ex * ex + ey * ey;
                }

                if (distSq <= er * er) {
                    if (e.type === "shield_bearer") {
                        const angleToProj = Math.atan2(y2 - e.y, x2 - e.x);
                        let angleDiff = Math.abs(angleToProj - (e.facingAngle || 0));
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        angleDiff = Math.abs(angleDiff);
                        const shieldHalfArc = e.shieldHalfArc || Math.PI * 0.5;
                        if (angleDiff <= shieldHalfArc) return;
                    }

                    this.hitTargets.add(e);
                    e.hp -= this.damage;
                    if (this.player && this.player.projectileLifedrainEnabled && this.sourceUnitType === "player") {
                        this.player.heal(PROJECTILE_HEAL * this.damage);
                        this.player.triggerLifestealVisual(e.x, e.y);
                    }
                    spawnHitParticles(this.x, this.y, "#ffaa00");
                }
            });
        }
    }
    explode(now, hitTarget = null, hitObstacle = null) {
        this.despawn();
        const radius = this.aoeRadius || (18 * (this.player ? this.player.mineAoeModifier : 1) * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5));
        
        let totalProjExpDmg = 0;
        const projExpHitEnemies = [];
        const hitSet = new Set();
        const expBox = radius + 85;

        SPATIAL_GRID.queryBox(this.x - expBox, this.x + expBox, this.y - expBox, this.y + expBox, e => {
            if (hitSet.has(e) || !isDamageable(e)) return;
            const dx = e.x - this.x;
            const dy = e.y - this.y;
            if (dx * dx + dy * dy <= (radius + e.r) * (radius + e.r)) {
                if (hitObstacle) {
                    if (hitObstacle.isWallObstacle) {
                        const hitCheck = testOrientedBoxHit(this.x, this.y, e.x, e.y, e.r, hitObstacle.x, hitObstacle.y, hitObstacle.halfW || 95, hitObstacle.halfH || 22, hitObstacle.angle || 0);
                        if (hitCheck.hit) return;
                    } else {
                        const sX = hitObstacle.x, sY = hitObstacle.y;
                        const sR = hitObstacle.shieldRadius || hitObstacle.r || 100;
                        const sFacing = hitObstacle.facingAngle || 0;
                        const sHalfArc = hitObstacle.shieldHalfArc || Math.PI * 0.5;
                        const hitCheck = testShieldArcHit(this.x, this.y, e.x, e.y, e.r, sX, sY, sR, sFacing, sHalfArc);
                        if (hitCheck.hit) return;
                    }
                }
                hitSet.add(e);
                e.hp -= this.damage;
                totalProjExpDmg += this.damage;
                projExpHitEnemies.push(e);
                if (this.player && this.player.projectileLifedrainEnabled && this.sourceUnitType === "player") {
                    this.player.heal(PROJECTILE_HEAL * this.damage);
                    this.player.triggerLifestealVisual(e.x, e.y);
                }
                if (this.player && this.player.freezeEnabled && !e.isBoss()) {
                    let dur = (e.type === "meteor") ? 125 : 250;
                    if (this.sourceTurret) dur *= 0.5;
                    e.freeze(dur, now);
                }
                spawnHitParticles(e.x, e.y, "#ffaa00");
            }
        });
        applyExplosionHealing(this.x, this.y, radius, totalProjExpDmg, this.player, projExpHitEnemies);
        
        GAME_STATE.hazards.push(new MineExplosion(this.x, this.y, radius, now, this.player));
    }
    draw() {
        ctx.save();
        if (this.isExplosive) {
            ctx.fillStyle = "rgba(255, 68, 0, 0.4)";
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r + 3.5, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = "#ff4400";
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r * 1.4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = "rgba(255,170,0,0.35)";
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r + 1.5, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = this.player ? this.player.color : "#ffaa00";
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

class MagicMissileProjectile extends Projectile {
    constructor(x, y, vx, vy, damage, kind = "missile", player = null, ignoreEnemy = null, sourceUnitType = "player", now = (typeof gameClock !== "undefined" ? gameClock : performance.now())) {
        const radius = 1.8;
        super(x, y, vx, vy, damage, radius, player, ignoreEnemy, 2000, now);
        this.kind = kind; // "missile" or "laser"
        this.sourceUnitType = sourceUnitType;
        this.isExplosive = false;
        this.aoeRadius = 0;
    }
    update(dt, dtFactor = 1.0, now) {
        const prevX = this.x;
        const prevY = this.y;
        this.updatePhysics(dtFactor);
        if (this.isExpired(now) || this.checkBounds()) return;
        
        // Barrier interception checks (Shield Bearer, Behemoth tongue wall, dropped shield terrains)
        if (GAME_STATE.shieldBearers.length > 0) {
            for (let i = 0; i < GAME_STATE.shieldBearers.length; i++) {
                const e = GAME_STATE.shieldBearers[i];
                if (e.hp > 0) {
                    const hit = testShieldArcHit(prevX, prevY, this.x, this.y, this.r, e.x, e.y, e.shieldRadius || 100, e.facingAngle || 0, e.shieldHalfArc || Math.PI * 0.5);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        if (this.isExplosive) {
                            this.explode(now, null, e);
                        } else {
                            this.despawn();
                            if (this.player && this.player.buckshotEnabled && (this.kind === "missile" || this.kind === "laser")) {
                                this.spawnBuckshot({ x: this.x, y: this.y, r: 0 }, now, e);
                            }
                            spawnHitParticles(this.x, this.y, "#ff8f00");
                        }
                        return;
                    }
                }
            }
        }
        if (GAME_STATE.activeBoss === "behemoth") {
            for (let i = 0; i < GAME_STATE.enemies.length; i++) {
                const e = GAME_STATE.enemies[i];
                if (e.type === "behemoth" && e.behemothState === "tongue_dragging_wall" && e.hp > 0 && typeof e.wallPieceX === "number") {
                    const hit = testOrientedBoxHit(prevX, prevY, this.x, this.y, this.r, e.wallPieceX, e.wallPieceY, 95, 22, e.wallPieceAngle || 0);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        const wallObj = { x: e.wallPieceX, y: e.wallPieceY, isWallObstacle: true, halfW: 95, halfH: 22, angle: e.wallPieceAngle || 0 };
                        if (this.isExplosive) {
                            this.explode(now, null, wallObj);
                        } else {
                            this.despawn();
                            if (this.player && this.player.buckshotEnabled && (this.kind === "missile" || this.kind === "laser")) {
                                this.spawnBuckshot({ x: this.x, y: this.y, r: 0 }, now, wallObj);
                            }
                            spawnHitParticles(this.x, this.y, "#a8a29e");
                        }
                        return;
                    }
                }
            }
        }
        if (GAME_STATE.terrains && GAME_STATE.terrains.length > 0) {
            for (const t of GAME_STATE.terrains) {
                if (t.isWallObstacle) {
                    const hit = testOrientedBoxHit(prevX, prevY, this.x, this.y, this.r, t.x, t.y, t.halfW || 95, t.halfH || 22, t.angle || 0);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        if (this.isExplosive) {
                            this.explode(now, null, t);
                        } else {
                            this.despawn();
                            if (this.player && this.player.buckshotEnabled && (this.kind === "missile" || this.kind === "laser")) {
                                this.spawnBuckshot({ x: this.x, y: this.y, r: 0 }, now, t);
                            }
                            spawnHitParticles(this.x, this.y, "#a8a29e");
                        }
                        return;
                    }
                } else if (!t.isExpired || !t.isExpired(now)) {
                    const hit = testShieldArcHit(prevX, prevY, this.x, this.y, this.r, t.x, t.y, t.r || 100, t.facingAngle || 0, t.shieldHalfArc || Math.PI * 0.5);
                    if (hit.hit) {
                        this.x = hit.hitX;
                        this.y = hit.hitY;
                        if (this.isExplosive) {
                            this.explode(now, null, t);
                        } else {
                            this.despawn();
                            if (this.player && this.player.buckshotEnabled && (this.kind === "missile" || this.kind === "laser")) {
                                this.spawnBuckshot({ x: this.x, y: this.y, r: 0 }, now, t);
                            }
                            spawnHitParticles(this.x, this.y, "#ff8f00");
                        }
                        return;
                    }
                }
            }
        }

        // Continuous Collision Detection (CCD): Find closest enemy along trajectory
        const x1 = prevX, y1 = prevY;
        const x2 = this.x, y2 = this.y;
        const dxSeg = x2 - x1, dySeg = y2 - y1;
        const lenSq = dxSeg * dxSeg + dySeg * dySeg;
        const minX = x1 < x2 ? x1 : x2;
        const maxX = x1 > x2 ? x1 : x2;
        const minY = y1 < y2 ? y1 : y2;
        const maxY = y1 > y2 ? y1 : y2;
        const pad = this.r + 85;

        let bestEnemy = null;
        let bestDistToASq = Infinity;

        SPATIAL_GRID.queryBox(minX - pad, maxX + pad, minY - pad, maxY + pad, e => {
            if (e.hp <= 0 || e.burrowed || e.airborne || !isOnPlayableArea(e)) return;
            if (e === this.ignoreTarget) return;

            const er = e.r + this.r;
            if (e.x < minX - er || e.x > maxX + er || e.y < minY - er || e.y > maxY + er) return;

            let distSq;
            if (lenSq === 0) {
                const dx = e.x - x1, dy = e.y - y1;
                distSq = dx * dx + dy * dy;
            } else {
                const wx = e.x - x1, wy = e.y - y1;
                const t = (wx * dxSeg + wy * dySeg) / lenSq;
                const tClamped = t < 0 ? 0 : (t > 1 ? 1 : t);
                const px = x1 + tClamped * dxSeg, py = y1 + tClamped * dySeg;
                const ex = e.x - px, ey = e.y - py;
                distSq = ex * ex + ey * ey;
            }

            if (distSq <= er * er) {
                if (e.type === "shield_bearer") {
                    const angleToProj = Math.atan2(y2 - e.y, x2 - e.x);
                    let angleDiff = Math.abs(angleToProj - (e.facingAngle || 0));
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    angleDiff = Math.abs(angleDiff);
                    const shieldHalfArc = e.shieldHalfArc || Math.PI * 0.5;
                    if (angleDiff <= shieldHalfArc) return;
                }

                const distToASq = (e.x - x1) * (e.x - x1) + (e.y - y1) * (e.y - y1);
                if (distToASq < bestDistToASq) {
                    bestDistToASq = distToASq;
                    bestEnemy = e;
                }
            }
        });

        if (bestEnemy) {
            if (this.isExplosive) {
                this.explode(now, bestEnemy);
            } else {
                bestEnemy.hp -= this.damage;
                if (this.player && this.player.projectileLifedrainEnabled && this.sourceUnitType === "player") {
                    this.player.heal(PROJECTILE_HEAL * this.damage);
                    this.player.triggerLifestealVisual(bestEnemy.x, bestEnemy.y);
                }
                this.despawn();
                if (this.player && this.player.freezeEnabled && !bestEnemy.isBoss()) {
                    let dur = (bestEnemy.type === "meteor") ? 125 : 250;
                    if (this.sourceTurret) dur *= 0.5;
                    bestEnemy.freeze(dur, now);
                }
                if (this.player && this.player.buckshotEnabled && (this.kind === "missile" || this.kind === "laser")) {
                    this.spawnBuckshot(bestEnemy, now);
                }
                const particleColor = (this.kind === "laser") ? (this.player ? this.player.color : "#33ccff") : (this.player ? this.player.color : "#ffff66");
                spawnHitParticles(this.x, this.y, particleColor);
            }
        }
    }
    explode(now, hitTarget = null, hitObstacle = null) {
        this.despawn();
        const radius = this.aoeRadius || (18 * (this.player ? this.player.mineAoeModifier : 1) * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5));
        
        let totalProjExpDmg = 0;
        const projExpHitEnemies = [];
        const hitSet = new Set();
        const expBox = radius + 85;

        SPATIAL_GRID.queryBox(this.x - expBox, this.x + expBox, this.y - expBox, this.y + expBox, e => {
            if (hitSet.has(e) || !isDamageable(e)) return;
            const dx = e.x - this.x;
            const dy = e.y - this.y;
            if (dx * dx + dy * dy <= (radius + e.r) * (radius + e.r)) {
                if (hitObstacle) {
                    if (hitObstacle.isWallObstacle) {
                        const hitCheck = testOrientedBoxHit(this.x, this.y, e.x, e.y, e.r, hitObstacle.x, hitObstacle.y, hitObstacle.halfW || 95, hitObstacle.halfH || 22, hitObstacle.angle || 0);
                        if (hitCheck.hit) return;
                    } else {
                        const sX = hitObstacle.x, sY = hitObstacle.y;
                        const sR = hitObstacle.shieldRadius || hitObstacle.r || 100;
                        const sFacing = hitObstacle.facingAngle || 0;
                        const sHalfArc = hitObstacle.shieldHalfArc || Math.PI * 0.5;
                        const hitCheck = testShieldArcHit(this.x, this.y, e.x, e.y, e.r, sX, sY, sR, sFacing, sHalfArc);
                        if (hitCheck.hit) return;
                    }
                }
                hitSet.add(e);
                e.hp -= this.damage;
                totalProjExpDmg += this.damage;
                projExpHitEnemies.push(e);
                if (this.player && this.player.projectileLifedrainEnabled && this.sourceUnitType === "player") {
                    this.player.heal(PROJECTILE_HEAL * this.damage);
                    this.player.triggerLifestealVisual(e.x, e.y);
                }
                if (this.player && this.player.freezeEnabled && !e.isBoss()) {
                    let dur = (e.type === "meteor") ? 125 : 250;
                    if (this.sourceTurret) dur *= 0.5;
                    e.freeze(dur, now);
                }
                spawnHitParticles(e.x, e.y, "#ffaa00");
            }
        });
        applyExplosionHealing(this.x, this.y, radius, totalProjExpDmg, this.player, projExpHitEnemies);
        
        if (this.player && this.player.buckshotEnabled && (this.kind === "missile" || this.kind === "laser")) {
            this.spawnBuckshot(hitTarget || { x: this.x, y: this.y, r: 0 }, now, hitObstacle);
        }
        
        GAME_STATE.hazards.push(new MineExplosion(this.x, this.y, radius, now, this.player));
    }
    spawnBuckshot(e, now, hitObstacle = null) {
        const angle = Math.atan2(this.vy, this.vx);
        const speed = Math.hypot(this.vx, this.vy);
        const spreadLimit = 0.35; // about 20 degrees spread
        
        let dmg;
        let isExplosive = false;
        let aoeRadius = 0;
        if (this.player && this.player.clusterShotEnabled) {
            const baseMineDmg = 18;
            dmg = (baseMineDmg / 3) * this.player.mineDamageModifier * GAME_STATE.dmgFactor;
            isExplosive = true;
            aoeRadius = (50 / 3) * this.player.mineAoeModifier * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
        } else {
            dmg = this.damage / 3;
        }
        
        for (let i = 0; i < 3; i++) {
            const a = angle + (Math.random() * 2 - 1) * spreadLimit;
            if (hitObstacle) {
                if (isExplosive) {
                    const fragX = this.x + (Math.random() * 8 - 4);
                    const fragY = this.y + (Math.random() * 8 - 4);
                    const expRadius = aoeRadius || (18 * (this.player ? this.player.mineAoeModifier : 1) * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5));
                    GAME_STATE.hazards.push(new MineExplosion(fragX, fragY, expRadius, now, this.player));
                    spawnHitParticles(fragX, fragY, hitObstacle.isWallObstacle ? "#a8a29e" : "#ff8f00");
                } else {
                    spawnHitParticles(this.x + Math.cos(a) * 4, this.y + Math.sin(a) * 4, hitObstacle.isWallObstacle ? "#a8a29e" : "#ff8f00");
                }
            } else {
                const sx = e.x + Math.cos(a) * (e.r + 2);
                const sy = e.y + Math.sin(a) * (e.r + 2);
                const vx = Math.cos(a) * speed;
                const vy = Math.sin(a) * speed;
                const proj = new ShrapnelProjectile(sx, sy, vx, vy, dmg, this.player, e, isExplosive, aoeRadius, this.sourceUnitType, now);
                GAME_STATE.projectiles.push(proj);
            }
        }
    }
    draw(now = performance.now()) {
        if (this.kind === "laser") {
            const angle = Math.atan2(this.vy, this.vx);
            const length = 20;
            const x1 = this.x - Math.cos(angle) * length;
            const y1 = this.y - Math.sin(angle) * length;
            
            ctx.strokeStyle = this.player ? this.player.color : "#33ccff";
            ctx.lineWidth = 1.8;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(this.x, this.y);
            ctx.stroke();
            
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(this.x, this.y);
            ctx.stroke();
            
            ctx.lineWidth = 1;
            ctx.lineCap = "butt";
        } else {
            // Magic Missile: Lava Lamp Bubble Separation & Micro-Droplet
            const curTime = now || performance.now();
            ctx.save();

            if (this.player && this.player.alive && this.spawnTime) {
                const pdx = this.x - this.player.x;
                const pdy = this.y - this.player.y;
                const pdist = Math.hypot(pdx, pdy);
                const r1 = this.player.r;
                const r2 = this.r + 1.2;
                const maxBridge = r1 + r2 + 28;
                
                if (pdist > 0.001 && pdist < maxBridge && (curTime - this.spawnTime < 190)) {
                    const u = Math.max(0, Math.min(1, (pdist - (r1 + r2 * 0.5)) / 28));
                    const gamma = Math.atan2(pdy, pdx);
                    
                    const spread1 = (Math.PI * 0.48) * (1 - u * 0.65);
                    const spread2 = (Math.PI * 0.48) * (1 - u * 0.65);

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
                    
                    const waist = Math.max(0.3, (1 - u) * ((r1 + r2) * 0.35));

                    const cax = midX + nx * waist;
                    const cay = midY + ny * waist;
                    const cbx = midX - nx * waist;
                    const cby = midY - ny * waist;

                    ctx.fillStyle = this.player.color;
                    ctx.beginPath();
                    ctx.moveTo(ax1, ay1);
                    ctx.quadraticCurveTo(cax, cay, ax2, ay2);
                    ctx.lineTo(bx2, by2);
                    ctx.quadraticCurveTo(cbx, cby, bx1, by1);
                    ctx.closePath();
                    ctx.fill();

                    ctx.strokeStyle = this.player.ring || "#003322";
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(ax1, ay1);
                    ctx.quadraticCurveTo(cax, cay, ax2, ay2);
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.moveTo(bx2, by2);
                    ctx.quadraticCurveTo(cbx, cby, bx1, by1);
                    ctx.stroke();
                }
            }

            const heading = Math.atan2(this.vy, this.vx);
            const playerCol = (this.player && this.player.color) ? this.player.color : "#00ffcc";
            const playerRing = (this.player && this.player.ring) ? this.player.ring : "#003322";
            
            ctx.translate(this.x, this.y);
            ctx.rotate(heading);
            
            const age = this.spawnTime ? (curTime - this.spawnTime) : 0;
            const wobble = Math.sin(age * 0.035) * 0.18;
            const radX = (this.r + 1.0) * (1.30 + wobble);
            const radY = (this.r + 1.0) * (0.88 - wobble * 0.5);

            ctx.fillStyle = playerCol;
            ctx.beginPath();
            ctx.ellipse(0, 0, radX, radY, 0, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.strokeStyle = playerRing;
            ctx.lineWidth = 1.2;
            ctx.stroke();

            ctx.fillStyle = "#ffffff";
            ctx.globalAlpha = 0.70;
            ctx.beginPath();
            ctx.ellipse(-radX * 0.15, 0, Math.max(0.5, radX * 0.35), Math.max(0.5, radY * 0.45), 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 0.85;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(-radX * 0.25, -radY * 0.25, Math.max(0.4, radY * 0.25), 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }
    }
}

// Forward Projectile constructor calls to MagicMissileProjectile / ShrapnelProjectile
function createProjectile(x, y, vx, vy, damage, kind = "missile", player = null, ignoreEnemy = null, sourceUnitType = "player", now) {
    if (kind === "shrapnel") {
        return new ShrapnelProjectile(x, y, vx, vy, damage, player, ignoreEnemy, false, 0, sourceUnitType, now);
    }
    return new MagicMissileProjectile(x, y, vx, vy, damage, kind, player, ignoreEnemy, sourceUnitType, now);
}

window.Projectile = Projectile;
window.MagicMissileProjectile = MagicMissileProjectile;
window.ShrapnelProjectile = ShrapnelProjectile;
window.RocketProjectile = RocketProjectile;
window.SniperProjectile = SniperProjectile;
window.MarauderMissile = MarauderMissile;
window.ShooterProjectile = ShooterProjectile;
window.EnemyProjectile = ShooterProjectile; // Legacy compatibility alias
window.SpikyProjectile = SpikyProjectile;
window.OrbitProjectile = OrbitProjectile;
window.DeflectorOrbiter = DeflectorOrbiter;
