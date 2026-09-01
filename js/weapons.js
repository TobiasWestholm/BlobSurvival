/**
 * BlobSurvival - Modular Weapons System
 * 
 * Defines the Weapon base class and concrete player weapons:
 * - MagicMissile: Auto-targeting missile battery with multishot, sniper, and rocket synergies
 * - MeleeSweep: Directional close-range sweeping blade and heavy Sledge Hammer slam
 * - ProximityMine: Deployable mine layer with throw, scatter, and volatile powder synergies
 * - TurretWeapon: Deployable autonomous turret layer with laser wall linking
 * - FireRing: Orbiting fire projectiles controller
 * - DeflectorShields: CCW projectile absorption orbiters controller
 * - PlayerFlail: Physics-driven flagellar cytoskeleton chain and spiked flail nucleus
 * 
 * Also contains combat coordination helpers:
 * - fireInstantMissile: Instant beam precision raycast & collision resolution
 * - updateLaserFences: Fast bounding-box turret laser wall intersection & slow processing
 */

// ---------------- Base Weapon Class ----------------

class Weapon {
    /**
     * @param {Player} player The player owner of this weapon
     * @param {string} id Unique weapon identifier
     * @param {number} baseCooldown Base attack cooldown in ms
     * @param {number} damage Base weapon damage
     */
    constructor(player, id, baseCooldown = 1000, damage = 0) {
        this.player = player;
        this.id = id;
        this.baseCooldown = baseCooldown;
        this.damage = damage;
        this.lastFire = -99999;
    }

    /**
     * Calculates the effective cooldown taking player modifiers into account.
     */
    getCooldown() {
        return this.baseCooldown * (this.player ? (this.player.cooldownModifier || 1.0) : 1.0);
    }

    /**
     * Calculates the scaled damage taking player modifiers and game difficulty into account.
     */
    getDamage() {
        const pMod = this.player ? (this.player.damageModifier || 1.0) : 1.0;
        const dmgFactor = (typeof GAME_STATE !== "undefined" && GAME_STATE.dmgFactor) ? GAME_STATE.dmgFactor : 1.0;
        return this.damage * pMod * dmgFactor;
    }

    /**
     * Checks if the weapon is off cooldown and ready to fire.
     */
    isReady(now) {
        return (now - this.lastFire) >= this.getCooldown();
    }

    /**
     * Per-frame update logic. Subclasses implement specific firing and targeting mechanics.
     * @param {number} now Current timestamp in ms
     * @param {number} [dt] Delta time in ms
     */
    update(now, dt) {
        // Implemented by subclasses
    }

    /**
     * Optional visual rendering pass for weapons with persistent physical appendages.
     * @param {CanvasRenderingContext2D} ctx 
     * @param {number} now 
     */
    draw(ctx, now) {
        // Optional override by subclasses (e.g. PlayerFlail)
    }

    /**
     * Resets weapon cooldowns and active volley state.
     */
    reset() {
        this.lastFire = -99999;
    }
}

// ---------------- Magic Missile Weapon ----------------

class MagicMissile extends Weapon {
    constructor(player) {
        super(player, "magic_missile", 1170, 8);
        this.speed = 7.3;
        this.baseSpread = 0.18;
        this.staggerMs = 5;
        this.volley = [];
        this.nextShotAt = 0;
        this.volleyCount = 0;
    }

    update(now) {
        const cd = this.getCooldown();
        if (this.volley.length === 0 && now - this.lastFire >= cd && GAME_STATE.enemies.length > 0) {
            const shots = 1 + (this.player ? this.player.multiShot : 0);
            const ranked = [];
            let maxRankedD2 = Infinity;
            
            for (let i = 0; i < GAME_STATE.enemies.length; i++) {
                const e = GAME_STATE.enemies[i];
                if (!isTargetable(e)) continue;
                const dx = e.x - this.player.x;
                const dy = e.y - this.player.y;
                const d2 = dx * dx + dy * dy;
                
                if (ranked.length < shots) {
                    ranked.push({ e, d2 });
                    if (ranked.length === shots) {
                        ranked.sort((a, b) => a.d2 - b.d2);
                        maxRankedD2 = ranked[shots - 1].d2;
                    }
                } else if (d2 < maxRankedD2) {
                    ranked[shots - 1] = { e, d2 };
                    ranked.sort((a, b) => a.d2 - b.d2);
                    maxRankedD2 = ranked[shots - 1].d2;
                }
            }
            if (ranked.length > 1 && ranked.length < shots) {
                ranked.sort((a, b) => a.d2 - b.d2);
            }
            if (ranked.length > 0) {
                this.volley = ranked;
                this.lastFire = now;
                this.nextShotAt = now;
                this.volleyCount++;
                
                // Seeking Rocket Chance on Volley Trigger
                if (this.player.rocketEnabled && Math.random() < (GAME_CONFIG.UPGRADES.ROCKET_PLAYER_CHANCE_PCT / 100)) {
                    const rAngle = Math.random() * Math.PI * 2;
                    const rDmg = 60;
                    const spawnDist = this.player.r * 0.35;
                    const spawnX = this.player.x + Math.cos(rAngle) * spawnDist;
                    const spawnY = this.player.y + Math.sin(rAngle) * spawnDist;
                    GAME_STATE.projectiles.push(new RocketProjectile(spawnX, spawnY, rAngle, rDmg, this.player, now, this.player.unitType));
                    if (typeof SoundEngine !== "undefined" && SoundEngine && SoundEngine.rocketLaunch) {
                        SoundEngine.rocketLaunch();
                    }

                    // Trigger reversed phagocytosis / exocytosis ejection pore animation on player blob
                    this.player.rocketAnimation = {
                        angle: rAngle,
                        startTime: now,
                        duration: 650
                    };
                }

                // Sniper Shot Interval Check
                if (this.player.sniperShotEnabled && (this.volleyCount % GAME_CONFIG.UPGRADES.SNIPER_SHOT_INTERVAL === 0)) {
                    const strongest = Unit.findStrongestClosest(this.player.x, this.player.y);
                    if (strongest) {
                        const angle = Math.atan2(strongest.y - this.player.y, strongest.x - this.player.x);
                        const mmDmg = this.getDamage();
                        const mult = this.player.laserSniperEnabled ? GAME_CONFIG.UPGRADES.LASER_SNIPER_DAMAGE_MULT : GAME_CONFIG.UPGRADES.SNIPER_SHOT_DAMAGE_MULT;
                        const sniperDmg = mmDmg * mult;
                        this.player.sniperCharge = {
                            startTime: now,
                            preFireDuration: 200,
                            totalDuration: 300,
                            target: strongest,
                            angle: angle,
                            damage: sniperDmg,
                            unitType: this.player.unitType,
                            fired: false
                        };
                    }
                }
            }
        }

        if (this.volley.length === 0 || now < this.nextShotAt) return;

        let dmg;
        let isExplosive = false;
        let aoeRadius = 0;
        if (this.player && this.player.clusterShotEnabled) {
            const baseMineDmg = 18;
            dmg = baseMineDmg * 0.5 * this.player.mineDamageModifier * GAME_STATE.dmgFactor;
            isExplosive = true;
            aoeRadius = (50 / 3) * this.player.mineAoeModifier * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
        } else {
            dmg = this.getDamage();
        }

        const spread = this.baseSpread * (this.player ? this.player.accuracyModifier : 1.0);
        const { e } = this.volley.shift();
        this.nextShotAt = now + this.staggerMs;
        if (typeof SoundEngine !== "undefined" && SoundEngine && SoundEngine.missileFire) {
            SoundEngine.missileFire();
        }

        if (this.player && this.player.instantMissileEnabled) {
            fireInstantMissile(this.player.x, this.player.y, e, dmg, isExplosive, aoeRadius, now, this.player, this.player.unitType, false, this.player);
        } else {
            let angle = Math.atan2(e.y - this.player.y, e.x - this.player.x);
            angle += (Math.random() * 2 - 1) * spread;
            const effSpeed = this.speed * (this.player && this.player.accuracyModifier === 0 ? 1.5 : 1.0);
            const vx = Math.cos(angle) * effSpeed;
            const vy = Math.sin(angle) * effSpeed;
            const kind = (this.player && this.player.accuracyModifier === 0) ? "laser" : "missile";
            
            // Start the mitosis bud right at the player boundary
            const spawnDist = Math.max(0, this.player.r - 2);
            const sx = this.player.x + Math.cos(angle) * spawnDist;
            const sy = this.player.y + Math.sin(angle) * spawnDist;
            const proj = new MagicMissileProjectile(sx, sy, vx, vy, dmg, kind, this.player, null, this.player.unitType, now);
            proj.spawnAngle = angle;
            if (isExplosive) {
                proj.isExplosive = true;
                proj.aoeRadius = aoeRadius;
            }
            GAME_STATE.projectiles.push(proj);

            // Record budding membrane ripple on player
            this.player.mitosisBuds = this.player.mitosisBuds || [];
            this.player.mitosisBuds.push({ angle, time: now, duration: 150 });
        }
    }
}

// ---------------- Melee Sweep & Sledge Hammer Weapon ----------------

class MeleeSweep extends Weapon {
    constructor(player) {
        super(player, "melee_sweep", 1400, 8);
        this.lastSledgeFire = -99999;
        this.sweepDuration = 200;
    }

    get range() {
        const diffMult = (typeof GAME_STATE !== "undefined" && GAME_STATE.difficulty)
            ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0)
            : 1.0;
        return 55 * (diffMult / 2 + 0.5);
    }

    getRange() {
        const mod = (this.player && this.player.meleeRangeModifier) ? this.player.meleeRangeModifier : 1.0;
        return this.range * mod;
    }

    update(now) {
        const cd = this.getCooldown();
        
        // Normal Melee sweep triggers on cooldown (1400ms base)
        if (now - this.lastFire >= cd) {
            this.lastFire = now;
            if (typeof SoundEngine !== "undefined" && SoundEngine && SoundEngine.meleeSweep) {
                SoundEngine.meleeSweep(false);
            }
            const dmg = this.getDamage();
            
            // Sweep damage to close enemies
            const touchRange = this.getRange();
            const sBox = touchRange + 85;
            if (typeof SPATIAL_GRID !== "undefined" && SPATIAL_GRID.queryBox) {
                SPATIAL_GRID.queryBox(this.player.x - sBox, this.player.x + sBox, this.player.y - sBox, this.player.y + sBox, e => {
                    if (!isDamageable(e) || e.burrowed) return;
                    const dx = e.x - this.player.x;
                    const dy = e.y - this.player.y;
                    if (dx * dx + dy * dy <= (touchRange + e.r) * (touchRange + e.r)) {
                        e.hp -= dmg;
                        if (typeof spawnHitParticles === "function") {
                            spawnHitParticles(e.x, e.y, "#ffffff");
                        }
                    }
                });
            }
        }

        // Sledge Hammer forward cone slam (400% damage, 120px reach, wide cone)
        // Fires half as often as the normal melee weapon (2x cooldown = 2800ms base)
        if (this.player && this.player.sledgeEnabled && now - this.lastSledgeFire >= cd * 2) {
            this.lastSledgeFire = now;
            if (typeof SoundEngine !== "undefined" && SoundEngine && SoundEngine.meleeSweep) {
                SoundEngine.meleeSweep(true);
            }
            const dmg = this.getDamage();
            const sledgeDmg = dmg * (GAME_CONFIG.UPGRADES.MELEE_SLEDGE_DAMAGE_PCT / 100);
            const radius = 100 * this.player.meleeRangeModifier * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
            const coneAngle = Math.PI / 2;
            const angle = this.player.facingAngle;

            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            const handleW = 18 * this.player.meleeRangeModifier;
            const headLength = radius * 0.48;
            const handleLength = radius * 0.52;
            const headWidth = radius * 0.95; // Wider impact zone
            const sBox = radius + 85;

            if (typeof SPATIAL_GRID !== "undefined" && SPATIAL_GRID.queryBox) {
                SPATIAL_GRID.queryBox(this.player.x - sBox, this.player.x + sBox, this.player.y - sBox, this.player.y + sBox, e => {
                    if (!isDamageable(e) || e.burrowed) return;
                    const dx = e.x - this.player.x;
                    const dy = e.y - this.player.y;
                    
                    // Project onto attack direction
                    const rx = dx * cosA + dy * sinA;
                    const ry = -dx * sinA + dy * cosA;
                    
                    // 1. Collision with handle stalk
                    const hitHandle = (rx >= 0 && rx <= handleLength && Math.abs(ry) <= (handleW / 2 + e.r));
                    // 2. Collision with wide bulbous head
                    const hitHead = (rx >= handleLength && rx <= (radius + e.r) && Math.abs(ry) <= (headWidth / 2 + e.r));
                    
                    if (hitHandle || hitHead) {
                        e.hp -= sledgeDmg;
                        if (typeof spawnHitParticles === "function") {
                            spawnHitParticles(e.x, e.y, this.player.color);
                        }
                    }
                });
            }

            // Morph the central player blob during the hammer slam
            this.player.sledgeHammerAnimation = {
                startTime: now,
                duration: 240,
                angle: angle
            };

            GAME_STATE.hazards.push(new SledgeHitVisual(this.player.x, this.player.y, radius, coneAngle, angle, now, this.player));
        }
    }
}

// ---------------- Proximity Mine Weapon ----------------

class ProximityMine extends Weapon {
    constructor(player) {
        super(player, "proximity_mine", 2400, 18);
    }

    getCooldown() {
        return this.baseCooldown * (this.player ? this.player.mineCooldownModifier : 1.0);
    }

    update(now) {
        const cd = this.getCooldown();
        if (now - this.lastFire >= cd && GAME_STATE.enemies.length > 0) {
            this.lastFire = now;
            const dropAngle = (this.player.facingAngle || 0) - Math.PI;
            const spawnDist = Math.max(0, this.player.r - 2);
            const sx = this.player.x + Math.cos(dropAngle) * spawnDist;
            const sy = this.player.y + Math.sin(dropAngle) * spawnDist;
            const mine = new PlayerMine(sx, sy, 8, this.damage, this.player, now);
            GAME_STATE.hazards.push(mine);

            // Register secretion ripple on player cell wall
            this.player.mitosisBuds = this.player.mitosisBuds || [];
            this.player.mitosisBuds.push({ angle: dropAngle, time: now, duration: 240 });

            // Organic oviposition protrusion: Volatile Powder deformation
            if ((this.player.mineAoeCount || 0) > 0 || this.player.scatterMinesEnabled) {
                this.player.mineLaunchAnimation = {
                    angle: dropAngle,
                    startTime: now,
                    duration: 380,
                    stacks: this.player.mineAoeCount || 0,
                    mine
                };
            }
            
            // Forward Throwing Mine Launcher
            if (this.player.mineThrowEnabled) {
                const angle = this.player.facingAngle;
                const speed = 12.0;
                const tsx = this.player.x + Math.cos(angle) * (this.player.r - 2);
                const tsy = this.player.y + Math.sin(angle) * (this.player.r - 2);
                const thrownMine = new PlayerMine(tsx, tsy, 8, this.damage, this.player, now);
                thrownMine.vx = Math.cos(angle) * speed;
                thrownMine.vy = Math.sin(angle) * speed;
                GAME_STATE.hazards.push(thrownMine);

                // Register forward nozzle extrusion & hydrostatic recoil warp on player blob
                this.player.mineLaunchAnimation = {
                    angle: angle,
                    startTime: now,
                    duration: 260
                };
            }
            
            // Scatter Charges upgrade
            if (this.player.scatterMinesEnabled && Math.random() < (GAME_CONFIG.UPGRADES.MINE_SCATTER_CHANCE_PCT / 100)) {
                const count = GAME_CONFIG.UPGRADES.MINE_SCATTER_MIN + Math.floor(Math.random() * (GAME_CONFIG.UPGRADES.MINE_SCATTER_MAX - GAME_CONFIG.UPGRADES.MINE_SCATTER_MIN + 1));
                for (let i = 0; i < count; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 3.0 + Math.random() * 4.0;
                    const extraMine = new PlayerMine(this.player.x, this.player.y, 8, this.damage, this.player, now);
                    extraMine.vx = Math.cos(angle) * speed;
                    extraMine.vy = Math.sin(angle) * speed;
                    GAME_STATE.hazards.push(extraMine);
                }
            }
        }
    }
}

// ---------------- Turret Weapon ----------------

class TurretWeapon extends Weapon {
    constructor(player) {
        super(player, "turret", GAME_CONFIG.TURRET.PLACEMENT_INTERVAL_SEC * 1000, 0);
    }

    getCooldown() {
        return this.baseCooldown * (this.player ? this.player.buildingCooldownModifier : 1.0);
    }

    update(now) {
        const cd = this.getCooldown();
        if (now - this.lastFire >= cd && GAME_STATE.enemies.length > 0) {
            this.lastFire = now;
            const spawnAngle = (this.player.facingAngle || 0) - Math.PI;
            const spawnDist = Math.max(0, this.player.r - 2);
            const spawnX = this.player.x + Math.cos(spawnAngle) * spawnDist;
            const spawnY = this.player.y + Math.sin(spawnAngle) * spawnDist;
            const turret = new TurretEntity(spawnX, spawnY, this.player, now);
            GAME_STATE.turrets.push(turret);

            // Register cell hatching animation on player (snappier with Rapid Deployment stacks)
            const rc = this.player ? (this.player.turretCooldownCount || 0) : 0;
            const hatchDuration = 520 * Math.pow(0.85, rc);
            this.player.hatchAnimation = {
                startTime: now,
                duration: hatchDuration,
                angle: spawnAngle
            };
            if (this.player.mitosisBuds) {
                this.player.mitosisBuds.push({ angle: spawnAngle, time: now, duration: hatchDuration });
            }

            // Rapid Deployment: ejection spores scatter outward from deploy burst
            if (this.player) {
                const sporeCount = 3 + Math.min(rc, 3);
                for (let i = 0; i < sporeCount; i++) {
                    const sa = spawnAngle + (i - (sporeCount - 1) / 2) * 0.34 + (Math.random() - 0.5) * 0.28;
                    const sd = 1.3 + rc * 0.5 + Math.random() * 1.3;
                    GAME_STATE.particles.push(new Particle(spawnX, spawnY, Math.cos(sa) * sd, Math.sin(sa) * sd, this.player.color, 500 + Math.random() * 250));
                }
            }
        }
    }
}

// ---------------- Fire Ring Weapon ----------------

class FireRing extends Weapon {
    constructor(player) {
        super(player, "fire_ring", 0, 5);
        this.rotSpeed = 0.03;
        this.radius = 70;
        this.orbiters = [];
        this.initialized = false;
    }

    update(now) {
        if (!this.initialized) {
            this.initialized = true;
            const count = 4;
            const dmg = this.getDamage();
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2;
                const orb = new OrbitProjectile(this.player, angle, this.rotSpeed, this.radius, dmg, Infinity, now);
                this.orbiters.push(orb);
                GAME_STATE.projectiles.push(orb);
            }
        } else {
            const dmg = this.getDamage();
            for (const orb of this.orbiters) {
                orb.damage = dmg;
                orb.expires = now + 99999;
                if (!orb.alive && this.player && this.player.alive) {
                    orb.alive = true;
                    GAME_STATE.projectiles.push(orb);
                }
            }
        }
    }
}

// ---------------- Deflector Shields Weapon ----------------

class DeflectorShields extends Weapon {
    constructor(player) {
        super(player, "projectile_shield", 0, 0);
        this.rotSpeed = -0.075; // CCW rotation
        this.radius = 40;
        this.orbiters = [];
        this.initialized = false;
    }

    update(now) {
        if (!this.initialized) {
            this.initialized = true;
            const count = GAME_CONFIG.UPGRADES.DEFLECTOR_ORBITERS_COUNT;
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2;
                const orb = new DeflectorOrbiter(this.player, angle, this.rotSpeed, this.radius, Infinity, now);
                this.orbiters.push(orb);
                GAME_STATE.projectiles.push(orb);
            }
        } else {
            for (const orb of this.orbiters) {
                orb.duration = Infinity;
                if (!orb.alive && this.player && this.player.alive) {
                    orb.alive = true;
                    GAME_STATE.projectiles.push(orb);
                }
            }
        }
    }
}

// ---------------- Player Flail Weapon ----------------

class PlayerFlail extends Weapon {
    constructor(player) {
        super(player, "player_flail", 0, 2.4);
        this.r = this.baseR;
        
        // Cartesian state vectors
        this.x = player.x;
        this.y = player.y + this.length;
        this.vx = 0;
        this.vy = 0;
        
        // Track previous frame player velocity to compute acceleration
        this.lastPvx = 0;
        this.lastPvy = 0;
        
        this.hitCooldown = new Map(); // enemy -> next allowed ball hit time
        this.chainHitCooldown = new Map(); // enemy -> next allowed chain hit time
        this.lastUpdate = 0;
    }

    get baseR() {
        const diffMult = (typeof GAME_STATE !== "undefined" && GAME_STATE.difficulty)
            ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0)
            : 1.0;
        return 13.5 * (diffMult / 2 + 0.5);
    }

    get length() {
        const diffMult = (typeof GAME_STATE !== "undefined" && GAME_STATE.difficulty)
            ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0)
            : 1.0;
        return 90 * (diffMult / 2 + 0.5);
    }

    update(now) {
        if (!this.lastUpdate) this.lastUpdate = now;
        const dt = now - this.lastUpdate;
        this.lastUpdate = now;
        if (dt <= 0) return;
        
        // 0. Dynamically scale the flail ball radius when Extended Joints is active
        this.r = this.baseR * (this.player.meleeRangeModifier > 1.0 ? 1.5 : 1.0);
        
        // 1. Calculate player velocity in this frame
        const pdx = this.player.x - this.player.lastX;
        const pdy = this.player.y - this.player.lastY;
        
        // Calculate player acceleration vector
        const pax = pdx - this.lastPvx;
        const pay = pdy - this.lastPvy;
        
        // Save current player velocity for the next frame
        this.lastPvx = pdx;
        this.lastPvy = pdy;
        
        // 2. Fictitious inertial force from player acceleration
        const massFactor = 0.8;
        const fax = -pax * massFactor;
        const fay = -pay * massFactor;
        
        this.vx += fax;
        this.vy += fay;
        
        // 3. Air resistance / damping (Verlet friction)
        const drag = 0.995;
        this.vx *= drag;
        this.vy *= drag;
        
        // 4. Verlet-style prediction
        const oldX = this.x;
        const oldY = this.y;
        
        const predX = this.x + this.vx;
        const predY = this.y + this.vy;
        
        // 5. Rigid distance constraint to the player
        let dx = predX - this.player.x;
        let dy = predY - this.player.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        const restLen = this.length * (this.player.meleeRangeModifier || 1.0);
        
        if (dist < 0.01) {
            dx = 0;
            dy = restLen;
            dist = restLen;
        }
        
        this.x = this.player.x + (dx / dist) * restLen;
        this.y = this.player.y + (dy / dist) * restLen;
        
        // 6. Update flail velocity based on constrained displacement
        this.vx = this.x - oldX;
        this.vy = this.y - oldY;
        
        if (this.player.flailLaserEnabled && (oldX !== this.x || oldY !== this.y)) {
            GAME_STATE.hazards.push(new LaserTrailSegment(oldX, oldY, this.x, this.y, now, this.player));
        }
        
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        
        // 7. Collision logic: speed scales damage and decreases hit cooldowns
        const speedMultiplier = 1.0 + speed * 2.5;
        const dmg = this.getDamage() * speedMultiplier;
        const chainDmg = dmg * 0.20; // Chain deals 20% of ball damage
        
        // Clean up dead enemies from cooldown maps to prevent leaks
        for (const e of this.hitCooldown.keys()) {
            if (e.hp <= 0) this.hitCooldown.delete(e);
        }
        for (const e of this.chainHitCooldown.keys()) {
            if (e.hp <= 0) this.chainHitCooldown.delete(e);
        }
        
        const flailMinX = Math.min(this.player.x, this.x) - this.r - 35;
        const flailMaxX = Math.max(this.player.x, this.x) + this.r + 35;
        const flailMinY = Math.min(this.player.y, this.y) - this.r - 35;
        const flailMaxY = Math.max(this.player.y, this.y) + this.r + 35;

        for (const e of GAME_STATE.enemies) {
            if (!isDamageable(e)) continue;
            if (e.x < flailMinX || e.x > flailMaxX || e.y < flailMinY || e.y > flailMaxY) continue;
            
            // A. Check ball collision
            const edx = e.x - this.x;
            const edy = e.y - this.y;
            const touchBall = this.r + e.r;
            if (edx * edx + edy * edy < touchBall * touchBall) {
                const nextHit = this.hitCooldown.get(e) || 0;
                if (now >= nextHit) {
                    e.hp -= dmg;
                    const cd = Math.max(75, 240 - speed * 12);
                    this.hitCooldown.set(e, now + cd);
                    if (typeof spawnHitParticles === "function") {
                        spawnHitParticles(e.x, e.y, this.player.color);
                    }
                    if (typeof SoundEngine !== "undefined" && SoundEngine && SoundEngine.flailHit) {
                        SoundEngine.flailHit(speed);
                    }
                    
                    if (this.player.freezeEnabled && speed >= 5.0 && !e.isBoss()) {
                        const baseDur = this.player.cryoMineBuffed ? 500 : 250;
                        const speedScale = this.player.cryoMineBuffed ? 200 : 100;
                        const dur = baseDur + (speed - 5.0) * speedScale;
                        e.freeze(dur, now);
                    }
                }
                continue; // Skip chain collision check if ball hit registered
            }
            
            // B. Check chain segment collision
            const ax = this.player.x;
            const ay = this.player.y;
            const bx = this.x;
            const by = this.y;
            const cx = e.x;
            const cy = e.y;
            
            const abx = bx - ax;
            const aby = by - ay;
            const acx = cx - ax;
            const acy = cy - ay;
            
            const abLen2 = abx * abx + aby * aby;
            let t = 0;
            if (abLen2 > 0.01) {
                t = (acx * abx + acy * aby) / abLen2;
                t = Math.max(0, Math.min(1, t));
            }
            
            const closestX = ax + t * abx;
            const closestY = ay + t * aby;
            const cdx = cx - closestX;
            const cdy = cy - closestY;
            const dist2 = cdx * cdx + cdy * cdy;
            const touchChain = e.r + 4; // chain link radius is 4
            
            if (dist2 < touchChain * touchChain) {
                const nextChainHit = this.chainHitCooldown.get(e) || 0;
                if (now >= nextChainHit) {
                    e.hp -= chainDmg;
                    const cd = Math.max(75, 240 - speed * 12);
                    this.chainHitCooldown.set(e, now + cd);
                    if (Math.random() < 0.3 && typeof spawnHitParticles === "function") {
                        spawnHitParticles(closestX, closestY, "#b0b5bc");
                    }
                }
            }
        }
    }

    draw(now = performance.now()) {
        if (typeof ctx === "undefined" || !ctx) return;
        ctx.save();
        
        const dx = this.x - this.player.x;
        const dy = this.y - this.player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        
        // Speed-dependent dynamic visibility:
        // Fully visible (1.0) when still, fades to lowest visibility (0.35) at low movement (~1.2 speed),
        // and increases in visibility as speed picks up, reaching maximum visibility (1.0) at max speed (~6.0+).
        let flailAlpha = 1.0;
        if (speed <= 1.2) {
            const t = speed / 1.2;
            flailAlpha = 1.0 - 0.65 * t;
        } else {
            const t = Math.min(1.0, (speed - 1.2) / 4.8);
            flailAlpha = 0.35 + 0.65 * t;
        }
        ctx.globalAlpha = flailAlpha;
        
        if (dist > 5) {
            // 1. Biological Flagellar Spine & Segmented Cytoskeleton Tail
            const normalX = -Math.sin(angle);
            const normalY = Math.cos(angle);
            
            // Whip flex dynamics (subtle lateral curve from swing inertia)
            const swingLag = Math.min(15, Math.max(-15, (this.vx * -normalY + this.vy * normalX) * 1.2));
            const midX = (this.player.x + this.x) * 0.5 + normalX * swingLag;
            const midY = (this.player.y + this.y) * 0.5 + normalY * swingLag;
            
            // Number of flagellar segments / vertebrae
            const segments = Math.max(7, Math.floor(dist / 8.5));
            const spinePoints = [];
            
            for (let i = 0; i <= segments; i++) {
                const t = i / segments; // 0 at player root, 1 at tip
                const omt = 1 - t;
                const px = omt * omt * this.player.x + 2 * omt * t * midX + t * t * this.x;
                const py = omt * omt * this.player.y + 2 * omt * t * midY + t * t * this.y;
                
                // Segment radius: tapers organically and slenderly from root to tip
                const nodePulse = Math.sin(t * Math.PI * segments * 0.75) * 0.35;
                const segR = Math.max(1.6, ((1 - t) * (this.player.r * 0.22) + t * 2.6) + nodePulse * (1 - t * 0.5));
                spinePoints.push({ x: px, y: py, r: segR, t: t });
            }
            
            // Construct left & right contour along the spine
            const leftContour = [];
            const rightContour = [];
            
            for (let i = 0; i < spinePoints.length; i++) {
                const p = spinePoints[i];
                let segAngle = angle;
                if (i < spinePoints.length - 1) {
                    const next = spinePoints[i + 1];
                    segAngle = Math.atan2(next.y - p.y, next.x - p.x);
                } else if (i > 0) {
                    const prev = spinePoints[i - 1];
                    segAngle = Math.atan2(p.y - prev.y, p.x - prev.x);
                }
                const segNx = -Math.sin(segAngle);
                const segNy = Math.cos(segAngle);
                
                // Natural fluid undulating wave ripple
                const ripple = Math.sin(now * 0.007 - p.t * Math.PI * 3.5) * (0.9 * (1 - p.t * 0.5));
                
                leftContour.push({
                    x: p.x + segNx * (p.r + ripple),
                    y: p.y + segNy * (p.r + ripple)
                });
                rightContour.push({
                    x: p.x - segNx * (p.r + ripple),
                    y: p.y - segNy * (p.r + ripple)
                });
            }
            
            // Draw flagellum outer body with smooth spline interpolation
            ctx.beginPath();
            ctx.moveTo(leftContour[0].x, leftContour[0].y);
            for (let i = 0; i < leftContour.length - 1; i++) {
                const xc = (leftContour[i].x + leftContour[i + 1].x) / 2;
                const yc = (leftContour[i].y + leftContour[i + 1].y) / 2;
                ctx.quadraticCurveTo(leftContour[i].x, leftContour[i].y, xc, yc);
            }
            ctx.lineTo(leftContour[leftContour.length - 1].x, leftContour[leftContour.length - 1].y);
            ctx.lineTo(rightContour[rightContour.length - 1].x, rightContour[rightContour.length - 1].y);
            for (let i = rightContour.length - 1; i > 0; i--) {
                const xc = (rightContour[i].x + rightContour[i - 1].x) / 2;
                const yc = (rightContour[i].y + rightContour[i - 1].y) / 2;
                ctx.quadraticCurveTo(rightContour[i].x, rightContour[i].y, xc, yc);
            }
            ctx.closePath();
            
            ctx.fillStyle = this.player.color;
            ctx.fill();
            ctx.strokeStyle = this.player.ring || "#000";
            ctx.lineWidth = 1.4;
            ctx.stroke();
            
            // Draw internal organic node beads
            for (let i = 2; i < spinePoints.length - 1; i += 2) {
                const p = spinePoints[i];
                ctx.beginPath();
                ctx.fillStyle = this.player.ring || "#222";
                ctx.arc(p.x, p.y, Math.max(1.0, p.r * 0.45), 0, Math.PI * 2);
                ctx.fill();
            }

            // Dorsal fluid gloss highlight line along the inner spine
            ctx.save();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.40)";
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.moveTo(spinePoints[0].x, spinePoints[0].y);
            for (let i = 1; i < spinePoints.length; i++) {
                ctx.lineTo(spinePoints[i].x, spinePoints[i].y);
            }
            ctx.stroke();
            ctx.restore();
            
            // Bio-luminescent electric laser filament when Laser Flail is active
            if (this.player.flailLaserEnabled) {
                ctx.save();
                ctx.strokeStyle = "#00f0ff";
                ctx.lineWidth = 4.5;
                ctx.globalAlpha = 0.35;
                ctx.beginPath();
                ctx.moveTo(spinePoints[0].x, spinePoints[0].y);
                for (let i = 1; i < spinePoints.length; i++) {
                    ctx.lineTo(spinePoints[i].x, spinePoints[i].y);
                }
                ctx.stroke();
                
                ctx.lineWidth = 1.8;
                ctx.globalAlpha = 0.95;
                ctx.stroke();
                ctx.restore();
            }
        }
        
        // 2. Draw Spiked Cytoskeleton Flail Nucleus Core (Tip bulb)
        ctx.save();
        ctx.translate(this.x, this.y);
        
        const rotSpeed = 0.0025 * now + speed * 0.06;
        
        // Velocity-based glowing aura
        if ((this.player.freezeEnabled && speed > 5) || speed > 1.2) {
            const auraCol = (this.player.freezeEnabled && speed > 5) ? "#00f0ff" : this.player.color;
            ctx.fillStyle = auraCol;
            ctx.globalAlpha = flailAlpha * Math.min(0.35, speed * 0.04);
            ctx.beginPath();
            ctx.arc(0, 0, this.r + Math.min(10, speed * 1.3), 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = flailAlpha;
        }
        
        // Curved living chitin thorns / spikes
        const spikeCount = 6;
        ctx.fillStyle = this.player.ring || "#222222";
        ctx.strokeStyle = this.player.color;
        ctx.lineWidth = 1.2;
        
        for (let i = 0; i < spikeCount; i++) {
            const spikeAngle = (i / spikeCount) * Math.PI * 2 + rotSpeed;
            const tipDist = this.r + 6.5;
            const baseDist = this.r - 2.5;
            
            const tipX = Math.cos(spikeAngle) * tipDist;
            const tipY = Math.sin(spikeAngle) * tipDist;
            const base1X = Math.cos(spikeAngle - 0.32) * baseDist;
            const base1Y = Math.sin(spikeAngle - 0.32) * baseDist;
            const base2X = Math.cos(spikeAngle + 0.32) * baseDist;
            const base2Y = Math.sin(spikeAngle + 0.32) * baseDist;
            
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.quadraticCurveTo(
                Math.cos(spikeAngle + 0.15) * (this.r + 2),
                Math.sin(spikeAngle + 0.15) * (this.r + 2),
                base2X, base2Y
            );
            ctx.lineTo(base1X, base1Y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        
        // Spiked Nucleus Body
        ctx.fillStyle = this.player.color;
        ctx.strokeStyle = this.player.ring || "#000000";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // Specular gloss highlight (top-left)
        ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
        ctx.beginPath();
        ctx.arc(-this.r * 0.32, -this.r * 0.32, this.r * 0.30, 0, Math.PI * 2);
        ctx.fill();
        
        // Tip gleam spark on leading spike when swinging fast
        if (speed > 4.0) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            const gleamAng = rotSpeed;
            ctx.arc(Math.cos(gleamAng) * (this.r + 6.5), Math.sin(gleamAng) * (this.r + 6.5), 2.5, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        ctx.restore();
        ctx.restore();
    }
}

// ---------------- Instant Precision & Edge Hit Helper ----------------

function fireInstantMissile(sourceX, sourceY, targetEnemy, dmg, isExplosive, aoeRadius, now, player, sourceUnitType = "player", sourceTurret = false, sourceObj = null) {
    if (!targetEnemy || targetEnemy.hp <= 0) return;

    const pColor = player ? player.color : "#00ffff";
    const particleColor = (player && player.accuracyModifier === 0) ? (player ? player.color : "#33ccff") : (player ? player.color : "#ffff66");

    // Muzzle flash animation on the shooter pointing in the firing direction
    const shootAngle = Math.atan2(targetEnemy.y - sourceY, targetEnemy.x - sourceX);
    const shooterRadius = sourceTurret ? 12 : (player ? player.r : 12);
    const muzzleX = sourceX + Math.cos(shootAngle) * shooterRadius;
    const muzzleY = sourceY + Math.sin(shootAngle) * shooterRadius;
    const sourceEntity = sourceObj || (sourceTurret ? null : player);
    GAME_STATE.hazards.push(new InstantMuzzleFlash(muzzleX, muzzleY, shootAngle, pColor, now, sourceEntity, shooterRadius));

    // Record organic budding membrane ripple on player blob
    if (player) {
        player.mitosisBuds = player.mitosisBuds || [];
        player.mitosisBuds.push({ angle: shootAngle, time: now, duration: 150 });
    }

    // Line-of-fire check against Shield Bearer arc
    const shieldCheck = (typeof findShieldArcIntersection === "function")
        ? findShieldArcIntersection(sourceX, sourceY, targetEnemy.x, targetEnemy.y, targetEnemy)
        : { blocked: false };

    if (shieldCheck.blocked) {
        // Intercepted by shield arc or wall
        const hx = shieldCheck.hitX, hy = shieldCheck.hitY;
        if (isExplosive) {
            GAME_STATE.hazards.push(new MineExplosion(hx, hy, aoeRadius, now, player));
        } else if (typeof spawnHitParticles === "function") {
            spawnHitParticles(hx, hy, shieldCheck.isWallObstacle ? "#a8a29e" : "#ff8f00");
        }
        return;
    }

    // Direct hit on monster edge facing the shooter
    const hitAngle = Math.atan2(sourceY - targetEnemy.y, sourceX - targetEnemy.x);
    const edgeX = targetEnemy.x + Math.cos(hitAngle) * targetEnemy.r;
    const edgeY = targetEnemy.y + Math.sin(hitAngle) * targetEnemy.r;

    // Spawn narrow piercing hit impact animation and particles
    GAME_STATE.hazards.push(new InstantHitImpact(edgeX, edgeY, hitAngle, pColor, now, targetEnemy.r));
    if (typeof spawnHitParticles === "function") {
        spawnHitParticles(edgeX, edgeY, particleColor);
    }

    if (isExplosive) {
        GAME_STATE.hazards.push(new MineExplosion(edgeX, edgeY, aoeRadius, now, player));
        let totalClusterDmg = 0;
        const clusterHitEnemies = [];
        for (const e of GAME_STATE.enemies) {
            if (!isDamageable(e)) continue;
            const dx = e.x - edgeX;
            const dy = e.y - edgeY;
            if (dx * dx + dy * dy <= (aoeRadius + e.r) * (aoeRadius + e.r)) {
                e.hp -= dmg;
                totalClusterDmg += dmg;
                clusterHitEnemies.push(e);
                if (player && player.freezeEnabled && !e.isBoss()) {
                    let dur = (e.type === "meteor") ? 125 : 250;
                    if (player.cryoMineBuffed) dur *= (1 + GAME_CONFIG.UPGRADES.CRYO_MINE_BOOST_PCT / 100);
                    e.freeze(dur, now);
                }
            }
        }
        if (player && player.explosionHealEnabled && typeof applyExplosionHealing === "function") {
            applyExplosionHealing(edgeX, edgeY, aoeRadius, totalClusterDmg, player, clusterHitEnemies);
        }
    } else {
        targetEnemy.hp -= dmg;
        if (player && player.projectileLifedrainEnabled && sourceUnitType === "player") {
            const healRatio = (GAME_CONFIG.UPGRADES.PROJECTILE_LIFEDRAIN_PCT || 10) / 100;
            const healAmt = dmg * healRatio;
            if (healAmt > 0) {
                player.heal(healAmt);
                player.triggerLifestealVisual(edgeX, edgeY);
            }
        }
        if (player && player.freezeEnabled && !targetEnemy.isBoss()) {
            const dur = (targetEnemy.type === "meteor") ? 125 : 250;
            targetEnemy.freeze(dur, now);
        }
    }

    // Buckshot Volley support (if taken) — runs independently of explosive/direct path
    if (player && player.buckshotEnabled && !sourceTurret) {
        const speed = 7.3 * (player.accuracyModifier === 0 ? 1.5 : 1.0);
        const spreadLimit = 0.35;
        let buckshotDmg;
        let buckshotExplosive = false;
        let buckshotAoe = 0;
        if (player.clusterShotEnabled) {
            const baseMineDmg = 18;
            buckshotDmg = (baseMineDmg / 3) * player.mineDamageModifier * GAME_STATE.dmgFactor;
            buckshotExplosive = true;
            buckshotAoe = (50 / 3) * player.mineAoeModifier * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
        } else {
            buckshotDmg = dmg / 3;
        }
        // Direction of fire is from shooter to monster
        const forwardAngle = Math.atan2(targetEnemy.y - sourceY, targetEnemy.x - sourceX);
        for (let i = 0; i < 3; i++) {
            const a = forwardAngle + (Math.random() * 2 - 1) * spreadLimit;
            const sx = edgeX + Math.cos(a) * 4;
            const sy = edgeY + Math.sin(a) * 4;
            const svx = Math.cos(a) * speed;
            const svy = Math.sin(a) * speed;
            const sProj = new ShrapnelProjectile(sx, sy, svx, svy, buckshotDmg, player, targetEnemy, buckshotExplosive, buckshotAoe, sourceUnitType, now);
            GAME_STATE.projectiles.push(sProj);
        }
    }
}

// ---------------- Laser Fences Network Update Helper ----------------

function updateLaserFences(dt, now) {
    // 1. Fast reset inLaserFence on all active enemies
    const enemies = GAME_STATE.enemies;
    const numEnemies = enemies.length;
    for (let i = 0; i < numEnemies; i++) {
        enemies[i].inLaserFence = false;
    }

    const turrets = GAME_STATE.turrets;
    const numTurrets = turrets.length;
    if (numTurrets === 0 || numEnemies === 0) return;

    // 2. Collect unique active laser fence segments
    const segments = [];
    for (let i = 0; i < numTurrets; i++) {
        const tur = turrets[i];
        if (!tur.alive || !tur.connections || tur.connections.length === 0) continue;
        if (!tur.player || (!tur.player.laserWallsEnabled && !tur.player.slowWallsEnabled)) continue;

        const conns = tur.connections;
        const numConns = conns.length;
        for (let c = 0; c < numConns; c++) {
            const conn = conns[c];
            if (!conn.alive) continue;
            if (tur.x < conn.x || (tur.x === conn.x && tur.y < conn.y)) {
                const dx = conn.x - tur.x;
                const dy = conn.y - tur.y;
                const len2 = dx * dx + dy * dy;
                if (len2 < 0.001) continue;

                const fenceRadius = 14;
                const minX = Math.min(tur.x, conn.x) - fenceRadius - 20;
                const maxX = Math.max(tur.x, conn.x) + fenceRadius + 20;
                const minY = Math.min(tur.y, conn.y) - fenceRadius - 20;
                const maxY = Math.max(tur.y, conn.y) + fenceRadius + 20;

                const isDamaging = !!(tur.player && tur.player.laserWallsEnabled);
                const dmgPerSec = isDamaging ? (GAME_CONFIG.TURRET.LASER_WALL_DPS * tur.player.damageModifier * GAME_STATE.dmgFactor) : 0;
                const dmgThisFrame = dmgPerSec * (dt / 1000);

                segments.push({
                    x0: tur.x, y0: tur.y,
                    dx, dy, invLen2: 1.0 / len2,
                    minX, maxX, minY, maxY,
                    dmgThisFrame, isDamaging
                });
            }
        }
    }

    const numSegments = segments.length;
    if (numSegments === 0) return;

    // 3. Process enemies against active segments with bounding-box pre-filtering
    const fenceRadius = 14;
    for (let s = 0; s < numSegments; s++) {
        const seg = segments[s];
        const { x0, y0, dx, dy, invLen2, minX, maxX, minY, maxY, dmgThisFrame, isDamaging } = seg;

        for (let i = 0; i < numEnemies; i++) {
            const e = enemies[i];
            if (e.hp <= 0 || e.burrowed || e.airborne || e.isBoss()) continue;
            if (e.x < minX || e.x > maxX || e.y < minY || e.y > maxY) continue;

            let t = ((e.x - x0) * dx + (e.y - y0) * dy) * invLen2;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            const closestX = x0 + t * dx;
            const closestY = y0 + t * dy;
            const edx = e.x - closestX;
            const edy = e.y - closestY;
            const hitR = e.r + fenceRadius;

            if (edx * edx + edy * edy < hitR * hitR) {
                e.inLaserFence = true;
                if (isDamaging && dmgThisFrame > 0) {
                    e.hp -= dmgThisFrame;
                    if (!e.lastLaserFenceParticle || now >= e.lastLaserFenceParticle) {
                        e.lastLaserFenceParticle = now + 140;
                        if (typeof spawnHitParticles === "function") {
                            spawnHitParticles(e.x, e.y, "#00ffcc");
                        }
                    }
                }
            }
        }
    }
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== "undefined") {
    window.Weapon = Weapon;
    window.MagicMissile = MagicMissile;
    window.MeleeSweep = MeleeSweep;
    window.ProximityMine = ProximityMine;
    window.TurretWeapon = TurretWeapon;
    window.FireRing = FireRing;
    window.DeflectorShields = DeflectorShields;
    window.PlayerFlail = PlayerFlail;
    window.fireInstantMissile = fireInstantMissile;
    window.updateLaserFences = updateLaserFences;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        Weapon,
        MagicMissile,
        MeleeSweep,
        ProximityMine,
        TurretWeapon,
        FireRing,
        DeflectorShields,
        PlayerFlail,
        fireInstantMissile,
        updateLaserFences
    };
}
