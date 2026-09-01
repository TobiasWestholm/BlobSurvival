class Player extends Unit {
    constructor(index, def) {
        const startX = W / 2 + (index - 0.5) * 60;
        const startY = H / 2 + (index % 2 === 0 ? -40 : 40);
        super(startX, startY, 15, 100);
        this.index = index;
        if (GAME_STATE.gameMode === 'online') {
            this.keysText = 'WASD';
            this.keymap = { up: ['w', 'arrowup'], left: ['a', 'arrowleft'], down: ['s', 'arrowdown'], right: ['d', 'arrowright'] };
        } else {
            this.keysText = def.keysText;
            this.keymap = def.keys;
        }
        this.color = def.color;
        this.ring = def.ring;
        this.damageModifier = 1.0;
        this.mineDamageModifier = 1.0;
        this.damageUpgradeCount = 0;
        this.cooldownModifier = 1.0;
        this.mineCooldownModifier = 1.0;
        this.accuracyModifier = 1.0; // multiplies projectile spread; lower = more accurate
        this.multiShot = 0;          // extra Magic Missile targets (2nd closest, 3rd closest, ...)
        this.weapons = [];
        this.facingAngle = 0;
        this.mineAoeModifier = 1.0;
        this.mineAoeCount = 0;
        this.attackSpeedCount = 0;
        this.invuln = 0;
        this.spawnInvuln = 0; // separate from hit-invuln; while >0 enemies ignore this player
        this.deadAt = 0;
        this.reviveTimeModifier = 1.0;
        this.takenOneShots = new Set(); // one-time upgrades this player has claimed
        // Phase Dash (double-tap to dash + missile burst)
        this.dashEnabled = false;
        this.freezeEnabled = false;
        this.cryoMineBuffed = false;
        this.mineAttractEnabled = false;
        this.scatterMinesEnabled = false;
        this.healPackEnabled = false;
        this.sledgeEnabled = false;
        this.chainEnabled = false;
        this.buckshotEnabled = false;
        this.damageReduction = 1.0;
        this.reflectDamageEnabled = false;
        this.campervanUntil = 0;
        this.campervanSoundPending = false;
        this.finalBlastEnabled = false;
        this.dashing = false;
        this.dashUntil = 0;
        this.dashCooldownUntil = 0;
        this.dashVx = 0; this.dashVy = 0;
        this.lastTapDir = null; this.lastTapTime = 0;
        this.inputHistory = [];
        this.dashCooldown = PLAYER_DASH_COOLDOWN;
        this.dashLvl2 = false;
        this.agilityBoostEnabled = false;
        this.agilityFade = 0.0;
        this.speedLvl2 = false;
        this.meleeRangeModifier = 1.0;
        this.lastX = this.x;
        this.lastY = this.y;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.moveSpeed = 0.0;
        this.martyrdomAuraEnabled = false;
        this.carapaceHealerEnabled = false;
        this.iceTrailEnabled = false;
        this.lastMeleeHitTime = new Map();
        this.hitFlashUntil = 0;
        this.slowUntil = 0; // Marauder Concussive Shells slow expiry timestamp
        this.aegisUntil = 0; // Dispensed Aegis invulnerability timestamp
        this.secondWindCount = 0;
        this.mineThrowEnabled = false;
        this.mineRingEnabled = false;
        this.clusterShotEnabled = false;
        this.projectileLifedrainEnabled = false;
        this.lifestealPulseUntil = 0;
        this.sniperShotEnabled = false;
        this.laserSniperEnabled = false;
        this.instantMissileEnabled = false;
        this.explosionHealEnabled = false;
        this.phaseDetonationEnabled = false;
        this.flailLaserEnabled = false;
        this.martyrsPresenceEnabled = false;
        this.sacrificialAegisEnabled = false;
        this.lastDamagedTime = 0;
        this.lastSacrificeTime = 0;
        this.lastSacrificedAlly = null;
        this.slowWallsEnabled = false;
        this.laserWallsEnabled = false;
        this.buildingDurationModifier = 1.0;
        this.buildingHealthModifier = 1.0;
        this.buildingCooldownModifier = 1.0;
        this.turretFlamethrowerEnabled = false;
        this.turretNetworkEnabled = false;
        this.lastNetworkExpansion = 0;
        this.turretDispenserEnabled = false;
        this.unitType = 'player';
        this.viperGrabber = null;
        this.airborne = false;
        this.isKnockbackAirborne = false;
        this.knockbackStartX = 0;
        this.knockbackStartY = 0;
        this.knockbackTargetX = 0;
        this.knockbackTargetY = 0;
        this.knockbackStart = 0;
        this.knockbackDuration = 550;
    }

    unlockWeapon(id) {
        if (id === 'fire_ring' && !this.weapons.some(w => w.id === 'fire_ring')) {
            this.weapons.push(new FireRing(this));
        } else if (id === 'magic_missile' && !this.weapons.some(w => w.id === 'magic_missile')) {
            this.weapons.push(new MagicMissile(this));
        } else if (id === 'melee_sweep' && !this.weapons.some(w => w.id === 'melee_sweep')) {
            this.weapons.push(new MeleeSweep(this));
        } else if (id === 'proximity_mine' && !this.weapons.some(w => w.id === 'proximity_mine')) {
            this.weapons.push(new ProximityMine(this));
        } else if (id === 'projectile_shield' && !this.weapons.some(w => w.id === 'projectile_shield')) {
            this.weapons.push(new DeflectorShields(this));
        } else if (id === 'player_flail' && !this.weapons.some(w => w.id === 'player_flail')) {
            this.weapons.push(new PlayerFlail(this));
        } else if (id === 'turret' && !this.weapons.some(w => w.id === 'turret')) {
            this.weapons.push(new TurretWeapon(this));
        }
    }

    isTargetable() {
        return this.isAlive() && !this.disconnected && !this.kicked && this.spawnInvuln <= 0;
    }

    isDamageable() {
        return this.isAlive() && !this.disconnected && !this.kicked && this.invuln <= 0 && this.spawnInvuln <= 0;
    }

    triggerLifestealVisual(x, y) {
        this.lifestealPulseUntil = gameClock + 220;
        const count = 2 + (Math.random() < 0.4 ? 1 : 0);
        for (let i = 0; i < count; i++) {
            GAME_STATE.particles.push(new LifestealWisp(x, y, this));
        }
    }
    updateWeapons(now, dt = 16, dtFactor = 1.0) {
        if (!GAME_STATE.isOnline || GAME_STATE.isHost) {
            for (const w of this.weapons) w.update(now);
        } else {
            const flail = this.weapons.find(w => w.id === 'player_flail');
            if (flail) flail.update(dt, dtFactor, now);
        }
    }
    update(dt, dtFactor, now) {
        if (this.invuln > 0) this.invuln -= dt;
        if (this.spawnInvuln > 0) this.spawnInvuln -= dt;

        // Airborne knockback mechanics (e.g. launched by black/white hole explosion)
        if (this.isKnockbackAirborne) {
            const elapsed = now - this.knockbackStart;
            const progress = Math.min(1, elapsed / this.knockbackDuration);
            this.x = this.knockbackStartX + (this.knockbackTargetX - this.knockbackStartX) * progress;
            this.y = this.knockbackStartY + (this.knockbackTargetY - this.knockbackStartY) * progress;
            this.clampToArena();

            // Handle laser and ice trails during airborne flight
            if (this.lastX !== this.x || this.lastY !== this.y) {
                this.spawnLaserTrails(this.lastX, this.lastY, this.x, this.y, now);
            }
            if (this.iceTrailEnabled && (this.lastX !== this.x || this.lastY !== this.y)) {
                GAME_STATE.hazards.push(new IceTrailSegment(this.lastX, this.lastY, this.x, this.y, now, this));
            }
            this.lastX = this.x;
            this.lastY = this.y;

            this.updateWeapons(now, dt, dtFactor);

            if (progress >= 1) {
                this.airborne = false;
                this.isKnockbackAirborne = false;
            }
            return; // Player loses steer control while airborne
        }

        // If grabbed/dragged/held by a Viper: player cannot move or dash!
        if (this.viperGrabber && this.viperGrabber.hp > 0) {
            this.dashing = false;
            this.lastX = this.x;
            this.lastY = this.y;
            this.updateWeapons(now, dt, dtFactor);
            return;
        }

        if (this.campervanUntil > now) {
            // Invulnerable campervan: kills everything it touches
            for (const e of GAME_STATE.enemies) {
                if (e.airborne || e.hp <= 0) continue;
                const dx = e.x - this.x;
                const dy = e.y - this.y;
                const touchRange = this.r + e.r + 15;
                if (dx * dx + dy * dy < touchRange * touchRange) {
                    e.hp = 0; // crushed!
                    spawnHitParticles(e.x, e.y, e.color);
                    for (let i = 0; i < 4; i++) {
                        const a = Math.random() * Math.PI * 2, s = 1.0 + Math.random() * 2;
                        GAME_STATE.particles.push(new Particle(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, '#ffaa00', 300));
                    }
                }
            }
        }


        if (this.dashing) {
            this.isMoving = true;
            this.moveSpeed = 1.4;
            // dash overrides normal movement for its short duration
            this.x += this.dashVx * dtFactor;
            this.y += this.dashVy * dtFactor;
            this.clampToArena();
            GAME_STATE.particles.push(new Particle(this.x, this.y, 0, 0, this.color, 180)); // trail
            
            if (now >= this.dashUntil) {
                if (!this.dashBurstFired) {
                    this.dashBurstFired = true;
                    this.fireDashBurst(now);
                }
                this.dashing = false;
                this.dashCooldownUntil = now + this.dashCooldown;
            }
            this.updateWeapons(now, dt, dtFactor);
            
            // Handle laser, fire, and ice trails at the end of dash frame
            if (this.lastX !== this.x || this.lastY !== this.y) {
                this.spawnLaserTrails(this.lastX, this.lastY, this.x, this.y, now);
                if (this.dashLvl2) {
                    GAME_STATE.hazards.push(new BurningTrailSegment(this.lastX, this.lastY, this.x, this.y, now, this));
                }
                if (this.iceTrailEnabled) {
                    GAME_STATE.hazards.push(new IceTrailSegment(this.lastX, this.lastY, this.x, this.y, now, this));
                }
            }
            this.agilityFade = Math.min(1.0, (this.agilityFade || 0) + (dt || 16.6) / 100);
            this.lastX = this.x;
            this.lastY = this.y;
            return;
        }

        let moveX = 0, moveY = 0;
        let hasJoystick = false;

        // In online mode: local player reads joystick/local keyboard, remote player reads network remoteInput only
        const isOnline = (typeof netManager !== 'undefined' && netManager && (netManager.isOnline || (typeof GAME_STATE !== 'undefined' && GAME_STATE.gameMode === 'online')));
        const localIndex = (typeof netManager !== 'undefined' && netManager && netManager.localPlayerIndex !== undefined) ? netManager.localPlayerIndex : 0;
        const isLocalPlayer = isOnline ? (this.index === localIndex) : (this.index === 0);

        if (isOnline) {
            if (isLocalPlayer) {
                if (typeof joystickInstance !== 'undefined' && joystickInstance && joystickInstance.vector && joystickInstance.vector.active) {
                    moveX = joystickInstance.vector.x;
                    moveY = joystickInstance.vector.y;
                    this.facingAngle = joystickInstance.vector.angle;
                    hasJoystick = true;
                } else {
                    let dx = 0, dy = 0;
                    if (anyKey(this.keymap.up) || anyKey(['arrowup'])) dy -= 1;
                    if (anyKey(this.keymap.down) || anyKey(['arrowdown'])) dy += 1;
                    if (anyKey(this.keymap.left) || anyKey(['arrowleft'])) dx -= 1;
                    if (anyKey(this.keymap.right) || anyKey(['arrowright'])) dx += 1;

                    this.inputHistory.push({ dx, dy, time: now });
                    if (this.inputHistory.length > 10) this.inputHistory.shift();

                    if (dx !== 0 || dy !== 0) {
                        let ndx = dx, ndy = dy;
                        if (ndx !== 0 && ndy !== 0) { ndx *= 0.7071; ndy *= 0.7071; }
                        const targetAngle = Math.atan2(ndy, ndx);

                        let angleDiff = targetAngle - this.facingAngle;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                        const angularTurnRate = (Math.abs(angleDiff) > Math.PI * 0.6) ? 0.38 : 0.22;
                        this.facingAngle += angleDiff * Math.min(1.0, angularTurnRate * dtFactor);

                        moveX = ndx;
                        moveY = ndy;
                    } else {
                        for (let i = this.inputHistory.length - 1; i >= 0; i--) {
                            const hist = this.inputHistory[i];
                            if (now - hist.time > 150) break;
                            if (hist.dx !== 0 && hist.dy !== 0) {
                                const targetAngle = Math.atan2(hist.dy, hist.dx);
                                let angleDiff = targetAngle - this.facingAngle;
                                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                                this.facingAngle += angleDiff * Math.min(1.0, 0.22 * dtFactor);
                                break;
                            }
                        }
                    }
                }
            } else {
                // Remote peer in online mode (Host simulation reads client input; Client ignores remote local keyboard)
                if (this.remoteInput) {
                    moveX = this.remoteInput.moveX || 0;
                    moveY = this.remoteInput.moveY || 0;
                    if (this.remoteInput.angle !== undefined) {
                        const targetAngle = this.remoteInput.angle;
                        let angleDiff = targetAngle - this.facingAngle;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                        const angularTurnRate = (Math.abs(angleDiff) > Math.PI * 0.6) ? 0.38 : 0.22;
                        this.facingAngle += angleDiff * Math.min(1.0, angularTurnRate * dtFactor);
                    }
                }
            }
        } else {
            // Local singleplayer / local co-op
            if (this.index === 0 && typeof joystickInstance !== 'undefined' && joystickInstance && joystickInstance.vector && joystickInstance.vector.active) {
                moveX = joystickInstance.vector.x;
                moveY = joystickInstance.vector.y;
                this.facingAngle = joystickInstance.vector.angle;
                hasJoystick = true;
            } else {
                let dx = 0, dy = 0;
                const isSinglePlayer = (typeof GAME_STATE !== 'undefined' && GAME_STATE.players && GAME_STATE.players.length === 1);
                if (anyKey(this.keymap.up) || (isSinglePlayer && anyKey(['arrowup']))) dy -= 1;
                if (anyKey(this.keymap.down) || (isSinglePlayer && anyKey(['arrowdown']))) dy += 1;
                if (anyKey(this.keymap.left) || (isSinglePlayer && anyKey(['arrowleft']))) dx -= 1;
                if (anyKey(this.keymap.right) || (isSinglePlayer && anyKey(['arrowright']))) dx += 1;

                this.inputHistory.push({ dx, dy, time: now });
                if (this.inputHistory.length > 10) this.inputHistory.shift();

                if (dx !== 0 || dy !== 0) {
                    let ndx = dx, ndy = dy;
                    if (ndx !== 0 && ndy !== 0) { ndx *= 0.7071; ndy *= 0.7071; }
                    const targetAngle = Math.atan2(ndy, ndx);

                    let angleDiff = targetAngle - this.facingAngle;
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                    const angularTurnRate = (Math.abs(angleDiff) > Math.PI * 0.6) ? 0.38 : 0.22;
                    this.facingAngle += angleDiff * Math.min(1.0, angularTurnRate * dtFactor);

                    moveX = ndx;
                    moveY = ndy;
                } else {
                    for (let i = this.inputHistory.length - 1; i >= 0; i--) {
                        const hist = this.inputHistory[i];
                        if (now - hist.time > 150) break;
                        if (hist.dx !== 0 && hist.dy !== 0) {
                            const targetAngle = Math.atan2(hist.dy, hist.dx);
                            let angleDiff = targetAngle - this.facingAngle;
                            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                            this.facingAngle += angleDiff * Math.min(1.0, 0.22 * dtFactor);
                            break;
                        }
                    }
                }
            }
        }
        
        const isMovingNow = (moveX !== 0 || moveY !== 0);
        this.isMoving = isMovingNow;
        this.moveSpeed = isMovingNow ? 1.0 : 0.0;
        if (isMovingNow) {
            this.agilityFade = Math.min(1.0, (this.agilityFade || 0) + (dt || 16.6) / 100);
        } else {
            this.agilityFade = Math.max(0.0, (this.agilityFade || 0) - (dt || 16.6) / 100);
        }

        const hasMelee = this.weapons.some(w => w.id === 'melee_sweep');
        const activeNitro = (this.nitroUntil && now < this.nitroUntil) ? 1.50 : 1.0;
        const activeSlow = (this.slowUntil && now < this.slowUntil) ? 0.60 : 1.0;
        const activeAcidSlow = (this.acidSlowUntil && now < this.acidSlowUntil) ? 0.75 : 1.0;
        const activeSpeed = (this.spawnInvuln > 0 ? this.speed * 1.5 : this.speed) * activeNitro * activeSlow * activeAcidSlow * (hasMelee ? 1.08 : 1.0);

        this.vx = Number.isFinite(this.vx) ? this.vx : 0;
        this.vy = Number.isFinite(this.vy) ? this.vy : 0;

        if (hasJoystick) {
            this.vx = moveX * activeSpeed;
            this.vy = moveY * activeSpeed;
        } else {
            const targetVx = moveX * activeSpeed;
            const targetVy = moveY * activeSpeed;

            if (isMovingNow) {
                const curSpd = Math.hypot(this.vx, this.vy);
                // Dot product to detect sharp turnarounds vs gentle curves
                const dot = curSpd > 0.1 ? (this.vx * moveX + this.vy * moveY) / curSpd : 1.0;

                // High traction on sharp reversals (dot < 0.2), smooth continuous curve on steering
                const steerRate = dot < 0.2 ? 0.45 : 0.24;
                this.vx += (targetVx - this.vx) * Math.min(1.0, steerRate * dtFactor);
                this.vy += (targetVy - this.vy) * Math.min(1.0, steerRate * dtFactor);
            } else {
                // Quick deceleration to stop
                this.vx *= Math.pow(0.70, dtFactor);
                this.vy *= Math.pow(0.70, dtFactor);
                if (this.vx * this.vx + this.vy * this.vy < 0.0025) {
                    this.vx = 0;
                    this.vy = 0;
                }
            }
        }

        this.x += this.vx * dtFactor;
        this.y += this.vy * dtFactor;
        this.clampToArena();

        if (GAME_STATE.current === STATES.WEAPON_SELECT) {
            return; // In pre-game lobby: do not fire weapons or process combat
        }

        this.updateWeapons(now, dt, dtFactor);

        this.updateNetworkExpansion(now);

        // Handle sniper shot elongation charge & discharge
        if (this.sniperCharge) {
            const elapsed = now - this.sniperCharge.startTime;

            // Continuously track target during aim animation until firing
            if (!this.sniperCharge.fired) {
                let target = this.sniperCharge.target;
                if (!target || !target.isTargetable()) {
                    target = Unit.findStrongestClosest(this.x, this.y);
                    this.sniperCharge.target = target;
                }
                if (target) {
                    this.sniperCharge.angle = Math.atan2(target.y - this.y, target.x - this.x);
                }
            }

            if (!this.sniperCharge.fired && elapsed >= this.sniperCharge.preFireDuration) {
                this.sniperCharge.fired = true;

                // Final precision lock right at the moment of firing
                let target = this.sniperCharge.target;
                if (!target || !target.isTargetable()) {
                    target = Unit.findStrongestClosest(this.x, this.y);
                }
                if (target) {
                    this.sniperCharge.angle = Math.atan2(target.y - this.y, target.x - this.x);
                }

                SoundEngine.laserSniper();
                const tipDist = this.r * 3.8;
                const tipX = this.x + Math.cos(this.sniperCharge.angle) * tipDist;
                const tipY = this.y + Math.sin(this.sniperCharge.angle) * tipDist;
                GAME_STATE.projectiles.push(new SniperProjectile(tipX, tipY, this.sniperCharge.angle, this.sniperCharge.damage, this, now, this.sniperCharge.unitType));

                // Violent muzzle blast particles & shockwave
                for (let i = 0; i < 14; i++) {
                    const spread = (Math.random() - 0.5) * 0.6;
                    const spd = 3.5 + Math.random() * 5.5;
                    const col = (i % 2 === 0) ? '#ffffff' : this.color;
                    GAME_STATE.particles.push(new Particle(
                        tipX, tipY,
                        Math.cos(this.sniperCharge.angle + spread) * spd,
                        Math.sin(this.sniperCharge.angle + spread) * spd,
                        col, 260
                    ));
                }
            }
            if (elapsed >= this.sniperCharge.totalDuration) {
                this.sniperCharge = null;
            }
        }

        // Handle laser and ice trails at the end of movement frame
        if (this.lastX !== this.x || this.lastY !== this.y) {
            this.spawnLaserTrails(this.lastX, this.lastY, this.x, this.y, now);
        }
        if (this.iceTrailEnabled && (this.lastX !== this.x || this.lastY !== this.y)) {
            GAME_STATE.hazards.push(new IceTrailSegment(this.lastX, this.lastY, this.x, this.y, now, this));
        }
        this.lastX = this.x;
        this.lastY = this.y;
    }
    clampToArena() {
        const boundW = (GAME_STATE.gameMode === 'online' && GAME_STATE.hostW) ? GAME_STATE.hostW : W;
        const boundH = (GAME_STATE.gameMode === 'online' && GAME_STATE.hostH) ? GAME_STATE.hostH : H;
        if (this.x < this.r) this.x = this.r;
        if (this.y < this.r) this.y = this.r;
        if (this.x > boundW - this.r) this.x = boundW - this.r;
        if (this.y > boundH - this.r) this.y = boundH - this.r;
    }
    updateNetworkExpansion(now) {
        if (!this.turretNetworkEnabled) return;
        if (!this.lastNetworkExpansion) this.lastNetworkExpansion = now;
        const interval = (GAME_CONFIG.TURRET.NETWORK_INTERVAL_SEC * 1000) * (this.buildingCooldownModifier || 1.0);
        const nextExpansionTime = this.lastNetworkExpansion + interval;
        const preExpansionDuration = 3000; // 3 seconds preparation phase

        // 1. Stage pending expansions 3 seconds before the actual expansion triggers
        if (now >= nextExpansionTime - preExpansionDuration) {
            const eligibleTurrets = GAME_STATE.turrets.filter(tur =>
                tur.alive &&
                tur.player === this &&
                (now - tur.spawnTime) > 50
            );

            for (const orig of eligibleTurrets) {
                // If turret already reached 2 connections, cancel pending expansion and retract all roots!
                if (orig.connections && orig.connections.length >= 2) {
                    if (orig.pendingExpansion) {
                        if (orig.pendingExpansion.roots && orig.pendingExpansion.roots.length > 0) {
                            const pe = orig.pendingExpansion;
                            const growT = Math.min(1, Math.max(0, (now - pe.startTime) / (pe.expandTime - pe.startTime)) / 0.70);
                            for (const r of pe.roots) {
                                r.maxReachedDist = r.dist * growT;
                            }
                            orig.retractingRoots = {
                                roots: pe.roots,
                                startTime: now,
                                duration: 600
                            };
                        }
                        orig.pendingExpansion = null;
                    }
                    continue;
                }

                if (!orig.pendingExpansion && orig.connections && orig.connections.length < 2) {
                    const dist = 50 + Math.random() * 250; // 50 to 300px
                    let angle = 0;
                    if (orig.connections.length === 0) {
                        angle = Math.random() * Math.PI * 2;
                    } else {
                        const exist = orig.connections[0];
                        const existAngle = Math.atan2(exist.y - orig.y, exist.x - orig.x);
                        const awayAngle = existAngle + Math.PI;
                        angle = awayAngle + (Math.random() - 0.5) * Math.PI;
                    }

                    let nx = orig.x + Math.cos(angle) * dist;
                    let ny = orig.y + Math.sin(angle) * dist;
                    nx = Math.max(15, Math.min(W - 15, nx));
                    ny = Math.max(15, Math.min(H - 15, ny));

                    // Generate 3-4 multi-directional probing roots (1 winning branch, rest are exploratory)
                    const totalRoots = 3 + Math.floor(Math.random() * 2);
                    const roots = [];

                    // 1. The winning root leading to the spawn target
                    roots.push({
                        targetX: nx,
                        targetY: ny,
                        dist: Math.hypot(nx - orig.x, ny - orig.y),
                        angle: Math.atan2(ny - orig.y, nx - orig.x),
                        isWinner: true,
                        wiggleFreq: 0.12 + Math.random() * 0.05,
                        wiggleSeed: Math.random() * 50
                    });

                    // 2. Exploratory roots fanning out in other directions that will pull back in
                    for (let r = 1; r < totalRoots; r++) {
                        const fanSign = (r % 2 === 1) ? 1 : -1;
                        const fanIndex = Math.ceil(r / 2);
                        const probeAngle = angle + fanSign * (0.35 + fanIndex * 0.30) + (Math.random() - 0.5) * 0.20;
                        const probeDist = Math.max(45, Math.min(220, dist * (0.55 + Math.random() * 0.45)));
                        let px = orig.x + Math.cos(probeAngle) * probeDist;
                        let py = orig.y + Math.sin(probeAngle) * probeDist;
                        px = Math.max(15, Math.min(W - 15, px));
                        py = Math.max(15, Math.min(H - 15, py));

                        roots.push({
                            targetX: px,
                            targetY: py,
                            dist: Math.hypot(px - orig.x, py - orig.y),
                            angle: Math.atan2(py - orig.y, px - orig.x),
                            isWinner: false,
                            wiggleFreq: 0.12 + Math.random() * 0.05,
                            wiggleSeed: Math.random() * 50
                        });
                    }

                    orig.pendingExpansion = {
                        targetX: nx,
                        targetY: ny,
                        roots: roots,
                        startTime: Math.max(now, nextExpansionTime - preExpansionDuration),
                        expandTime: nextExpansionTime
                    };
                }
            }
        }

        // 2. Trigger expansion once the interval has fully elapsed
        if (now >= nextExpansionTime) {
            this.lastNetworkExpansion = now;

            const expandingTurrets = GAME_STATE.turrets.filter(tur =>
                tur.alive &&
                tur.player === this &&
                tur.pendingExpansion
            );

            for (const orig of expandingTurrets) {
                // If turret cannot spawn (dead or >= 2 connections), retract ALL roots smoothly!
                if (!orig.alive || (orig.connections && orig.connections.length >= 2)) {
                    if (orig.pendingExpansion && orig.pendingExpansion.roots && orig.pendingExpansion.roots.length > 0) {
                        for (const r of orig.pendingExpansion.roots) {
                            r.maxReachedDist = r.dist;
                        }
                        orig.retractingRoots = {
                            roots: orig.pendingExpansion.roots,
                            startTime: now,
                            duration: 600
                        };
                    }
                    orig.pendingExpansion = null;
                    continue;
                }

                // If turret successfully spawns, retract only the fake/exploratory roots!
                if (orig.pendingExpansion && orig.pendingExpansion.roots) {
                    const fakeRoots = orig.pendingExpansion.roots.filter(r => !r.isWinner);
                    if (fakeRoots.length > 0) {
                        for (const r of fakeRoots) {
                            r.maxReachedDist = r.dist;
                        }
                        orig.retractingRoots = {
                            roots: fakeRoots,
                            startTime: now,
                            duration: 600
                        };
                    }
                }

                const nx = orig.pendingExpansion.targetX;
                const ny = orig.pendingExpansion.targetY;
                orig.pendingExpansion = null;

                const childTurret = new TurretEntity(nx, ny, this, now);
                if (!orig.connections.includes(childTurret)) orig.connections.push(childTurret);
                if (!childTurret.connections.includes(orig)) childTurret.connections.push(orig);

                GAME_STATE.turrets.push(childTurret);
                SoundEngine.autonomousNetwork();
            }
        }
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
    fireDashBurst(now = gameClock) {
        const mm = this.weapons.find(w => w.id === 'magic_missile');
        const rangeMultiplier = this.dashLvl2 ? (1 + GAME_CONFIG.DASH.LVL2_RANGE_BOOST_PCT / 100) : 1.0;
        const speed = (mm ? mm.speed : 7.3) * rangeMultiplier * (this.accuracyModifier === 0 ? 1.5 : 1.0);
        const burstCount = Math.round(PLAYER_DASH_BURST * rangeMultiplier);
        const kind = (this.accuracyModifier === 0) ? 'laser' : 'missile';

        if (this.phaseDetonationEnabled) {
            const pm = this.weapons.find(w => w.id === 'proximity_mine');
            const baseMineDmg = pm ? pm.damage : 18;
            const mineDmg = baseMineDmg * this.mineDamageModifier * GAME_STATE.dmgFactor;
            const mineRadius = 50 * this.mineAoeModifier * rangeMultiplier * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);

            // Trigger landing mine explosion
            GAME_STATE.hazards.push(new MineExplosion(this.x, this.y, mineRadius, now, this));
            let totalDashExpDmg = 0;
            const dashHitEnemies = [];
            for (const e of GAME_STATE.enemies) {
                if (!isDamageable(e)) continue;
                const dx = e.x - this.x;
                const dy = e.y - this.y;
                if (dx * dx + dy * dy <= (mineRadius + e.r) * (mineRadius + e.r)) {
                    e.hp -= mineDmg;
                    totalDashExpDmg += mineDmg;
                    dashHitEnemies.push(e);
                    if (this.freezeEnabled && !e.isBoss()) {
                        const dur = (e.type === 'meteor') ? (GAME_CONFIG.UPGRADES.FREEZE_PROJECTILE_DURATION_SEC * 500) : (GAME_CONFIG.UPGRADES.FREEZE_PROJECTILE_DURATION_SEC * 1000);
                        e.freeze(dur, now);
                    }
                    spawnHitParticles(e.x, e.y, '#ffaa00');
                }
            }
            applyExplosionHealing(this.x, this.y, mineRadius, totalDashExpDmg, this, dashHitEnemies);

            // Burst explosive missiles (1/2 mine damage, 1/3 AoE)
            const burstDmg = baseMineDmg * 0.5 * this.mineDamageModifier * GAME_STATE.dmgFactor;
            const burstAoe = (50 / 3) * this.mineAoeModifier * rangeMultiplier * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
            for (let i = 0; i < burstCount; i++) {
                const a = (i / burstCount) * Math.PI * 2;
                const proj = new MagicMissileProjectile(
                    this.x, this.y, Math.cos(a) * speed, Math.sin(a) * speed, burstDmg, kind, this, null, this.unitType, now);
                proj.isExplosive = true;
                proj.aoeRadius = burstAoe;
                GAME_STATE.projectiles.push(proj);
            }
        } else {
            const dmg = (mm ? mm.damage : 8) * this.damageModifier * GAME_STATE.dmgFactor;
            for (let i = 0; i < burstCount; i++) {
                const a = (i / burstCount) * Math.PI * 2;
                GAME_STATE.projectiles.push(new MagicMissileProjectile(
                    this.x, this.y, Math.cos(a) * speed, Math.sin(a) * speed, dmg, kind, this, null, this.unitType, now));
            }
        }
        spawnHitParticles(this.x, this.y, this.color);
    }
    takeDamage(amount, now, source, isMeleeContact = false, isRedirected = false) {
        if (!this.isAlive() || this.invuln > 0 || this.dashing || this.campervanUntil > now || (this.aegisUntil && now < this.aegisUntil)) return false;
        if (this.isKnockbackAirborne && isMeleeContact) return false; // In the air, avoids melee ground contact
        // Level 2 Dash invulnerability check
        if (this.dashLvl2 && (this.dashCooldownUntil - now) > this.dashCooldown / 2) return false;

        if (isMeleeContact && source instanceof Enemy) {
            const lastHit = this.lastMeleeHitTime.get(source) || 0;
            const hitInterval = 500 * (source.isPassingThroughLaserFence() ? 2.5 : 1.0);
            if (now - lastHit < hitInterval) return false;
            this.lastMeleeHitTime.set(source, now);

            // Non-boss monsters stand still for 0.3 seconds after hitting a player with a normal proximity attack
            if (!source.isBoss()) {
                if (source.lunging) {
                    source.attackPauseUntil = Math.max(source.attackPauseUntil || 0, (source.lungeUntil || now) + 300);
                } else {
                    source.attackPauseUntil = Math.max(source.attackPauseUntil || 0, now + 300);
                    source.vx = 0;
                    source.vy = 0;
                }
            }
        }

        let effectiveDmg = amount;
        if (!isRedirected) {
            effectiveDmg *= GAME_STATE.difficulty.takenMult * this.damageReduction;

            // Check for nearby living allies with Sacrificial Aegis protecting this player
            const protectors = [];
            for (const op of GAME_STATE.players) {
                if (op !== this && op.alive && op.sacrificialAegisEnabled) {
                    const dx = op.x - this.x;
                    const dy = op.y - this.y;
                    const radius = 50 * op.mineAoeModifier * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
                    if (dx * dx + dy * dy <= radius * radius) {
                        protectors.push(op);
                    }
                }
            }
            if (protectors.length > 0) {
                const blockedDmg = effectiveDmg * (GAME_CONFIG.UPGRADES.SACRIFICIAL_AEGIS_ALLY_REDUCTION_PCT / 100);
                effectiveDmg -= blockedDmg;
                const dmgPerProtector = blockedDmg / protectors.length;
                for (const protector of protectors) {
                    protector.lastSacrificeTime = now;
                    protector.lastSacrificedAlly = this;
                    protector.takeDamage(dmgPerProtector, now, source, false, true);
                }
            }
        }

        if (isRedirected) {
            spawnHitParticles(this.x, this.y, '#ff4455');
        }

        this.hp = Math.max(0, this.hp - effectiveDmg);
        this.onTakeDamage(effectiveDmg, now, source, isRedirected);

        if (this.hp <= 0) {
            this.hp = 0;
            this.despawn(now, source);
        } else {
            const isFromTitan = source && (source.type === 'behemoth' || (source.sourceEnemy && source.sourceEnemy.type === 'behemoth'));
            if (isFromTitan && !isRedirected) {
                if (!source.lastCleaveTime || source.lastCleaveTime !== now) {
                    SoundEngine.meleeSweep(true);
                }
            } else {
                SoundEngine.playerDamaged();
            }
        }
        return true;
    }

    onTakeDamage(amount, now, source, isRedirected = false) {
        this.hitFlashUntil = now + 150;
        this.lastDamagedTime = now;
        if (this.carapaceHealerEnabled) {
            const healAmt = this.maxHp * (GAME_CONFIG.UPGRADES.CARAPACE_HEALER_TEAM_HEAL_PCT / 100);
            for (const p of GAME_STATE.players) {
                if (p.alive) p.heal(healAmt);
            }
        }
        let reflectTarget = null;
        if (source instanceof Enemy) {
            reflectTarget = source;
        } else if (source && source.sourceEnemy instanceof Enemy) {
            reflectTarget = source.sourceEnemy;
        }
        if (this.reflectDamageEnabled && reflectTarget && typeof reflectTarget.hp === 'number' && reflectTarget.hp > 0) {
            const reflectDmg = this.maxHp * (GAME_CONFIG.UPGRADES.REFLECT_DAMAGE_PLAYER_MAX_HP_PCT / 100);
            reflectTarget.hp -= reflectDmg;
            spawnHitParticles(reflectTarget.x, reflectTarget.y, '#ff3333');
        }
    }

    onDeath(now, source) {
        this.deadAt = now;
        SoundEngine.playerDeath();
        if (this.viperGrabber) {
            if (this.viperGrabber.heldPlayer === this) {
                this.viperGrabber.heldPlayer = null;
                this.viperGrabber.isDraggingPlayer = false;
                this.viperGrabber.tongueActive = false;
            }
            this.viperGrabber = null;
        }
        if (this.finalBlastEnabled || this.martyrdomAuraEnabled || this.martyrsPresenceEnabled || this.sacrificialAegisEnabled) {
            this.triggerFinalBlast(now);
        }
        // Instant game over only if everyone is simultaneously down.
        if (!GAME_STATE.players.some(p => p.alive)) gameOver();
    }
    spawnLaserTrails(x1, y1, x2, y2, now) {
        if (!this.speedLvl2) return;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return;

        if (this.iceTrailEnabled) {
            // Perpendicular unit vector
            const nx = -dy / len;
            const ny = dx / len;
            
            // Left border (22px offset)
            const lx1 = x1 - 22 * nx;
            const ly1 = y1 - 22 * ny;
            const lx2 = x2 - 22 * nx;
            const ly2 = y2 - 22 * ny;
            GAME_STATE.hazards.push(new LaserTrailSegment(lx1, ly1, lx2, ly2, now, this));

            // Right border (22px offset)
            const rx1 = x1 + 22 * nx;
            const ry1 = y1 + 22 * ny;
            const rx2 = x2 + 22 * nx;
            const ry2 = y2 + 22 * ny;
            GAME_STATE.hazards.push(new LaserTrailSegment(rx1, ry1, rx2, ry2, now, this));
        } else {
            GAME_STATE.hazards.push(new LaserTrailSegment(x1, y1, x2, y2, now, this));
        }
    }
    triggerFinalBlast(now) {
        const dmg = this.maxHp * this.damageModifier * GAME_STATE.dmgFactor;
        let radius = 230 * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
        if (this.mineAoeCount > 0) radius *= Math.pow(1 + GAME_CONFIG.UPGRADES.MARTYRDOM_AOE_BOOST_PCT / 100, this.mineAoeCount);
        for (const e of GAME_STATE.enemies) {
            if (!isDamageable(e)) continue;
            const dx = e.x - this.x;
            const dy = e.y - this.y;
            if (dx * dx + dy * dy <= radius * radius) {
                e.hp -= dmg;
                spawnHitParticles(e.x, e.y, '#ff3300');
                if (e.hp > 0 && this.martyrsPresenceEnabled && !e.burrowed) {
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const nx = dist > 0.001 ? dx / dist : (Math.random() < 0.5 ? -1 : 1);
                    const ny = dist > 0.001 ? dy / dist : 0;
                    const knockbackDist = Math.max(110, radius - dist + 60)*((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
                    e.airborne = true;
                    e.isKnockbackAirborne = true;
                    e.knockbackStartX = e.x;
                    e.knockbackStartY = e.y;
                    e.knockbackTargetX = Math.max(10, Math.min(W - 10, e.x + nx * knockbackDist));
                    e.knockbackTargetY = Math.max(10, Math.min(H - 10, e.y + ny * knockbackDist));
                    e.knockbackStart = now;
                    e.knockbackDuration = 600;
                }
            }
        }
        GAME_STATE.hazards.push(new NukeExplosion(this.x, this.y, radius, now));
        
        // Spawn massive fire debris particles (white, orange, yellow)
        for (let i = 0; i < 100; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 3.0 + Math.random() * 8.0;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            const color = (Math.random() < 0.3) ? '#ffffff' : (Math.random() < 0.6 ? '#ffcc00' : '#ff3300');
            GAME_STATE.particles.push(new Particle(this.x, this.y, vx, vy, color, 500 + Math.random() * 500));
        }
        // Spawn grey smoke mushroom cloud particles
        for (let i = 0; i < 35; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.6 + Math.random() * 2.5;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            GAME_STATE.particles.push(new Particle(this.x, this.y, vx, vy, '#555555', 800 + Math.random() * 400));
        }
    }
    revive() {
        this.alive = true;
        this.hp = this.maxHp;
        this.invuln = REVIVE_INVULN;
        this.spawnInvuln = REVIVE_INVULN;
        SoundEngine.playerRevived();
        // Golden pillar animation on revive
        if (typeof triggerReviveAnimation === 'function') triggerReviveAnimation(this, gameClock);
        // reappears exactly where it fell
    }
    draw(now) {
        if (this.alive) {
            const flail = this.weapons.find(w => w.id === 'player_flail');
            if (flail) flail.draw(now);

            if (this.campervanUntil > now) {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate(this.facingAngle);
                
                const w = 48; // length
                const h = 26; // width
                
                // Fast translucent glow pass for campervan invulnerability
                ctx.strokeStyle = '#33ccff';
                ctx.lineWidth = 5;
                ctx.globalAlpha = 0.35;
                ctx.strokeRect(-w/2 - 1, -h/2 - 1, w + 2, h + 2);
                ctx.globalAlpha = 1.0;
                
                // Wheels
                ctx.fillStyle = '#111111';
                ctx.fillRect(-w/2 + 6, -h/2 - 2, 8, 4);
                ctx.fillRect(w/2 - 14, -h/2 - 2, 8, 4);
                ctx.fillRect(-w/2 + 6, h/2 - 2, 8, 4);
                ctx.fillRect(w/2 - 14, h/2 - 2, 8, 4);
                
                // Main Campervan Body
                ctx.fillStyle = '#f5f5f5'; // cream-white
                ctx.fillRect(-w/2, -h/2, w, h);
                
                // Stripe (Player color)
                ctx.fillStyle = this.color;
                ctx.fillRect(-w/2, -3, w, 6);
                
                // Front windshield (facing right)
                ctx.fillStyle = '#33ccff';
                ctx.fillRect(w/2 - 8, -h/2 + 2, 6, h - 4);
                
                // Side windows
                ctx.fillStyle = '#333333';
                ctx.fillRect(-w/2 + 6, -h/2 + 3, 8, 5);
                ctx.fillRect(-w/2 + 18, -h/2 + 3, 8, 5);
                ctx.fillRect(-w/2 + 6, h/2 - 8, 8, 5);
                ctx.fillRect(-w/2 + 18, h/2 - 8, 8, 5);
                
                // Headlights
                ctx.fillStyle = '#ffff33';
                ctx.beginPath();
                ctx.arc(w/2, -h/2 + 4, 2, 0, Math.PI * 2);
                ctx.arc(w/2, h/2 - 4, 2, 0, Math.PI * 2);
                ctx.fill();
                
                // Headlight beams
                ctx.fillStyle = 'rgba(255, 255, 100, 0.15)';
                ctx.beginPath();
                ctx.moveTo(w/2, -h/2 + 4);
                ctx.lineTo(w/2 + 40, -h/2 - 10);
                ctx.lineTo(w/2 + 40, -h/2 + 15);
                ctx.closePath();
                ctx.fill();
                
                ctx.beginPath();
                ctx.moveTo(w/2, h/2 - 4);
                ctx.lineTo(w/2 + 40, h/2 - 15);
                ctx.lineTo(w/2 + 40, h/2 + 10);
                ctx.closePath();
                ctx.fill();
                
                ctx.restore();
                this.drawHpBar(now);
                return;
            }

            // Calculate parabolic altitude arc and ground shadow for airborne player
            let drawX = this.x;
            let drawY = this.y;
            let drawR = this.r;
            if (this.isKnockbackAirborne) {
                const elapsed = now - this.knockbackStart;
                const progress = Math.max(0, Math.min(1, elapsed / this.knockbackDuration));
                const altitude = Math.sin(progress * Math.PI) * 45; // 45px apex height in the air

                // Draw ground shadow beneath airborne player
                ctx.save();
                ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
                ctx.beginPath();
                ctx.ellipse(this.x, this.y + 4, Math.max(2, this.r * (1 - altitude / 120)), Math.max(1, this.r * 0.5 * (1 - altitude / 120)), 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                drawY = this.y - altitude;
                drawR = this.r * (1 + altitude / 140);
            }

            ctx.save();
            const isFlashed = (this.invuln > 0 && Math.floor(this.invuln / 60) % 2 === 0) || 
                              (this.hitFlashUntil > now && Math.floor((this.hitFlashUntil - now) / 30) % 2 === 0);
            if (isFlashed) ctx.globalAlpha = 0.5;
            // Hero Ground Beacon & Rotating Halo
            ctx.save();
            const beaconR = drawR + 6;
            
            // 1. Soft ground disc under player
            ctx.fillStyle = this.color + '22';
            ctx.beginPath();
            ctx.arc(drawX, drawY, beaconR, 0, Math.PI * 2);
            ctx.fill();

            // 2. Solid base beacon ring
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = 0.55;
            ctx.beginPath();
            ctx.arc(drawX, drawY, beaconR, 0, Math.PI * 2);
            ctx.stroke();

            // 3. Rotating dashed energy halo with Second Wind emerald gems inlaid in the gaps
            const haloR = drawR + 4;
            const haloCircumference = Math.PI * 2 * haloR;
            const slotCount = Math.max(8, Math.round(haloCircumference / 10));
            const slotAngle = (Math.PI * 2) / slotCount;
            const spinOffset = (-now * 0.012) / haloR;
            const secondWindStacks = this.secondWindCount || 0;

            // Dynamic Cardiac Heartbeat Pulse (Lub-Dub rhythm, speeds up if low HP)
            const isLowHp = this.hp < this.maxHp * 0.35;
            const heartFreq = isLowHp ? 0.0032 : 0.0016;
            const cardiacCycle = (now * heartFreq) % 1.0;
            let cardiacPulse = 0;
            if (cardiacCycle < 0.12) {
                cardiacPulse = Math.sin((cardiacCycle / 0.12) * Math.PI); // Lub
            } else if (cardiacCycle >= 0.16 && cardiacCycle < 0.28) {
                cardiacPulse = Math.sin(((cardiacCycle - 0.16) / 0.12) * Math.PI) * 0.75; // Dub
            }
            const isFlash = this.hitFlashUntil > now;
            const pulseScale = isFlash ? 1.4 : (1.0 + cardiacPulse * 0.25);

            // Determine which gap slots contain emerald gems (evenly distributed around the ring)
            const filledGaps = new Set();
            if (secondWindStacks > 0) {
                const gemsToPlace = Math.min(slotCount, secondWindStacks);
                for (let g = 0; g < gemsToPlace; g++) {
                    const slotIdx = Math.floor(g * (slotCount / gemsToPlace));
                    filledGaps.add(slotIdx);
                }
            }

            for (let s = 0; s < slotCount; s++) {
                const baseA = spinOffset + s * slotAngle;
                const dashStartA = baseA;
                const dashEndA = baseA + slotAngle * 0.48;
                const gapStartA = baseA + slotAngle * 0.52;
                const gapEndA = baseA + slotAngle * 0.98;

                // 3a. Player's energy halo dash segment
                ctx.beginPath();
                ctx.arc(drawX, drawY, haloR, dashStartA, dashEndA);
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 1.8;
                ctx.globalAlpha = 0.75;
                ctx.stroke();

                // 3b. Second Wind: Sharp emerald diamond crystal inlaid in the space between the dashes
                if (filledGaps.has(s)) {
                    // Traveling vitality wave across the ring
                    const wavePhase = (now * 0.003 - (s / slotCount) * Math.PI * 2) % (Math.PI * 2);
                    const waveGlow = Math.max(0, Math.sin(wavePhase));
                    const pipGlow = Math.max(cardiacPulse, waveGlow * 0.7);

                    const midA = (gapStartA + gapEndA) * 0.5;
                    const cx = drawX + Math.cos(midA) * haloR;
                    const cy = drawY + Math.sin(midA) * haloR;

                    // Tangent and normal vectors for sharp diamond orientation
                    const nx = Math.cos(midA);
                    const ny = Math.sin(midA);
                    const tx = -ny;
                    const ty = nx;

                    const scale = (drawR / 20) * pulseScale;
                    const radialH = Math.max(3.2, 4.4 * scale);
                    const tangentW = Math.max(3.4, 4.8 * scale);

                    // 1. Soft atmospheric emerald glow halo behind the gem
                    ctx.save();
                    const glowRadius = radialH * 2.6;
                    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
                    glowGrad.addColorStop(0, isFlash ? 'rgba(167, 255, 235, 0.85)' : 'rgba(0, 255, 136, 0.60)');
                    glowGrad.addColorStop(0.5, 'rgba(0, 230, 118, 0.22)');
                    glowGrad.addColorStop(1, 'rgba(0, 200, 83, 0)');
                    ctx.beginPath();
                    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
                    ctx.fillStyle = glowGrad;
                    ctx.globalAlpha = 1;
                    ctx.fill();
                    ctx.restore();

                    // 2. Inlaid emerald channel line along the gap
                    ctx.beginPath();
                    ctx.arc(drawX, drawY, haloR, gapStartA, gapEndA);
                    ctx.strokeStyle = isFlash ? '#ffffff' : (pipGlow > 0.4 ? '#69f0ae' : '#00e676');
                    ctx.lineWidth = Math.max(1.8, 2.2 * pulseScale);
                    ctx.globalAlpha = 0.95;
                    ctx.stroke();

                    // 3. Sharp faceted diamond crystal geometry (4 vertices)
                    const pOutX = cx + nx * radialH;
                    const pOutY = cy + ny * radialH;
                    const pInX = cx - nx * radialH;
                    const pInY = cy - ny * radialH;
                    const pLeadX = cx + tx * tangentW;
                    const pLeadY = cy + ty * tangentW;
                    const pTrailX = cx - tx * tangentW;
                    const pTrailY = cy - ty * tangentW;

                    ctx.save();

                    // Outer bright facet (pOut -> pLead -> cx -> pTrail)
                    ctx.beginPath();
                    ctx.moveTo(pLeadX, pLeadY);
                    ctx.lineTo(pOutX, pOutY);
                    ctx.lineTo(pTrailX, pTrailY);
                    ctx.lineTo(cx, cy);
                    ctx.closePath();
                    ctx.fillStyle = isFlash ? '#ffffff' : '#a7ffeb';
                    ctx.globalAlpha = 0.98;
                    ctx.fill();

                    // Inner deep facet (pIn -> pLead -> cx -> pTrail)
                    ctx.beginPath();
                    ctx.moveTo(pLeadX, pLeadY);
                    ctx.lineTo(pInX, pInY);
                    ctx.lineTo(pTrailX, pTrailY);
                    ctx.lineTo(cx, cy);
                    ctx.closePath();
                    ctx.fillStyle = isFlash ? '#a7ffeb' : '#00b060';
                    ctx.globalAlpha = 0.95;
                    ctx.fill();

                    // Sharp outer facet contour & border
                    ctx.beginPath();
                    ctx.moveTo(pOutX, pOutY);
                    ctx.lineTo(pLeadX, pLeadY);
                    ctx.lineTo(pInX, pInY);
                    ctx.lineTo(pTrailX, pTrailY);
                    ctx.closePath();
                    ctx.strokeStyle = isFlash ? '#ffffff' : '#004d40';
                    ctx.lineWidth = 1.1;
                    ctx.stroke();

                    // Sharp central facet ridge spine (bright glint line)
                    ctx.beginPath();
                    ctx.moveTo(pOutX, pOutY);
                    ctx.lineTo(pInX, pInY);
                    ctx.moveTo(pLeadX, pLeadY);
                    ctx.lineTo(pTrailX, pTrailY);
                    ctx.strokeStyle = isFlash ? '#ffffff' : '#ffffff';
                    ctx.lineWidth = 1.0;
                    ctx.globalAlpha = 0.85 + 0.15 * pipGlow;
                    ctx.stroke();

                    // Center white highlight gleam
                    ctx.beginPath();
                    ctx.arc(cx, cy, Math.max(0.9, 1.4 * (drawR / 20)), 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.globalAlpha = 1.0;
                    ctx.fill();

                    ctx.restore();
                }
            }

            // 3c. If stack count > slotCount, radiating super-vitality sparks & outer aura
            if (secondWindStacks > slotCount) {
                const superPulse = 1.0 + 0.12 * Math.sin(now * 0.005);
                ctx.beginPath();
                ctx.arc(drawX, drawY, haloR + 2.5 * superPulse, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(167, 255, 235, 0.40)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // 4. Directional pointer notch (soft rounded organic pip with lower profile height)
            const notchAngle = this.facingAngle || 0;
            const baseDist = beaconR + 0.5;
            const pointerHeight = 3.6; // Decreased height
            const baseHalfW = 4.2;

            ctx.save();
            ctx.translate(drawX, drawY);
            ctx.rotate(notchAngle);

            ctx.fillStyle = this.color;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            // Start at bottom-left corner with rounded transition
            ctx.moveTo(baseDist, -baseHalfW);
            // Smooth curved flank to rounded apex
            ctx.quadraticCurveTo(baseDist + pointerHeight * 0.45, -baseHalfW * 0.45, baseDist + pointerHeight - 0.7, -0.9);
            // Rounded tip apex
            ctx.quadraticCurveTo(baseDist + pointerHeight, 0, baseDist + pointerHeight - 0.7, 0.9);
            // Smooth curved flank back to bottom-right corner
            ctx.quadraticCurveTo(baseDist + pointerHeight * 0.45, baseHalfW * 0.45, baseDist, baseHalfW);
            // Soft rounded inner base matching beacon curve
            ctx.quadraticCurveTo(baseDist + 0.5, 0, baseDist, -baseHalfW);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            ctx.restore();

            // 4b. Rapid Deployment: brood-pouch charge ring refilling toward the next turret deploy
            const turretWeapon = this.weapons ? this.weapons.find(w => w.id === 'turret') : null;
            const rcCount = this.turretCooldownCount || 0;
            if (turretWeapon && rcCount > 0) {
                const cd = turretWeapon.basePlacementCooldown * (this.buildingCooldownModifier || 1.0);
                const prog = Math.min(1, Math.max(0, (now - turretWeapon.lastPlacement) / cd));
                const rR = beaconR + 2.5;
                const span = Math.PI * 2;
                const startA = (this.facingAngle || 0) - Math.PI;
                const endA = startA + span * prog;
                const halfSpan = span / 2;
                ctx.lineCap = 'round';
                ctx.strokeStyle = rcCount >= 4 ? shadeHex(this.color, 1.5) : this.color;
                ctx.globalAlpha = 0.8;
                if (rcCount >= 3) {
                    // Split into two fill segments forming one full ring as the charge completes
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.arc(drawX, drawY, rR, startA, startA + halfSpan * prog);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(drawX, drawY, rR, startA + halfSpan, startA + halfSpan + halfSpan * prog);
                    ctx.stroke();
                } else {
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.arc(drawX, drawY, rR, startA, endA);
                    ctx.stroke();
                }
                // Leading charge pip at the growing tip
                if (prog > 0.02 && prog < 1) {
                    const tipA = rcCount >= 3 ? startA + halfSpan * prog : endA;
                    ctx.fillStyle = '#ffffff';
                    ctx.globalAlpha = 0.9;
                    ctx.beginPath();
                    ctx.arc(drawX + Math.cos(tipA) * rR, drawY + Math.sin(tipA) * rR, 1.5, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.lineCap = 'butt';
            }

            // 1. Calculate Melee Sweep Pseudopod Extension (if active)
            let pseudopod = null;
            const melee = this.weapons.find(w => w.id === 'melee_sweep');
            if (melee && melee.lastFire > 0 && now - melee.lastFire < melee.sweepDuration) {
                const elapsed = now - melee.lastFire;
                const t = elapsed / melee.sweepDuration; // 0 to 1
                
                // Spin full 360 degrees around the player
                const startAng = (this.facingAngle || 0) - Math.PI;
                const sweepAngle = startAng + t * (Math.PI * 2);
                
                // Reach curve: shoots out, sweeps full 360 circle, retracts
                const reachProgress = Math.sin(t * Math.PI);
                const maxRange = melee.range * this.meleeRangeModifier;
                const extensionReach = (maxRange - drawR) * reachProgress;

                pseudopod = {
                    angle: sweepAngle,
                    reach: extensionReach,
                    halfWidth: 0.40,
                    t: t,
                    startAng: startAng,
                    currentReach: drawR + extensionReach
                };

                // Draw full hit circle & sweeping energy wave
                ctx.save();
                const hitRadius = melee.range * this.meleeRangeModifier;
                const arcLength = Math.PI * 0.85;

                // Faint full-radius circular reach indicator (softer & less prominent)
                ctx.beginPath();
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 1.0;
                ctx.globalAlpha = 0.11 * (1 - t * 0.4);
                ctx.arc(drawX, drawY, hitRadius, 0, Math.PI * 2);
                ctx.stroke();

                // Outer sweeping blade arc
                ctx.beginPath();
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 4.5 * (1 - t * 0.6);
                ctx.globalAlpha = 0.70 * (1 - t * 0.4);
                ctx.arc(drawX, drawY, hitRadius, sweepAngle - arcLength, sweepAngle);
                ctx.stroke();

                // Crisp inner white blade line
                ctx.beginPath();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.8 * (1 - t * 0.6);
                ctx.globalAlpha = 0.85 * (1 - t * 0.3);
                ctx.arc(drawX, drawY, hitRadius, sweepAngle - arcLength * 0.35, sweepAngle);
                ctx.stroke();

                ctx.restore();
            }

            // 2. Calculate Flagellum Whip Root Tension (if player has Scourge Flail)
            let flagellum = null;
            if (flail) {
                const fdx = flail.x - drawX;
                const fdy = flail.y - drawY;
                const fdist = Math.hypot(fdx, fdy);
                const fAngle = Math.atan2(fdy, fdx);
                const speed = Math.hypot(flail.vx, flail.vy);
                const tension = Math.min(1.0, 0.35 + speed * 0.10);
                flagellum = {
                    active: true,
                    angle: fAngle,
                    tension: tension,
                    dist: fdist
                };
            }

            // 3. Collect active Deflector Shield roots for membrane deformation
            const deflectorWeapon = this.weapons.find(w => w.id === 'projectile_shield');
            const deflectorRoots = [];
            if (deflectorWeapon && deflectorWeapon.orbiters) {
                for (const orb of deflectorWeapon.orbiters) {
                    if (orb.growth && orb.growth > 0.01) {
                        deflectorRoots.push({
                            angle: orb.angle,
                            growth: orb.growth
                        });
                    }
                }
            }

            // 4. Calculate Sniper Shot violent pre-fire elongation deformation
            let sniperDeform = null;
            if (this.sniperCharge) {
                const elapsed = now - this.sniperCharge.startTime;
                let intensity = 0;
                if (elapsed < this.sniperCharge.preFireDuration) {
                    const t = elapsed / this.sniperCharge.preFireDuration;
                    intensity = Math.pow(t, 1.5); // Rapid exponential surge
                } else {
                    const t = (elapsed - this.sniperCharge.preFireDuration) / (this.sniperCharge.totalDuration - this.sniperCharge.preFireDuration);
                    intensity = (1 - t) * Math.cos(t * Math.PI * 3.0);
                }
                if (Math.abs(intensity) > 0.001) {
                    sniperDeform = {
                        angle: this.sniperCharge.angle,
                        intensity: intensity
                    };
                }
            }

            // 5. Calculate Turret Hatching brood pouch deformation
            let hatchDeform = null;
            if (this.hatchAnimation) {
                const elapsed = now - this.hatchAnimation.startTime;
                if (elapsed < this.hatchAnimation.duration) {
                    const t = elapsed / this.hatchAnimation.duration;
                    let intensity = 0;
                    if (t < 0.40) {
                        intensity = Math.sin((t / 0.40) * (Math.PI * 0.5));
                    } else {
                        const post = (t - 0.40) / 0.60;
                        intensity = (1 - post) * Math.cos(post * Math.PI * 2.0);
                    }
                    if (Math.abs(intensity) > 0.001) {
                        hatchDeform = {
                            angle: this.hatchAnimation.angle,
                            intensity: Math.max(-0.25, intensity)
                        };
                    }
                } else {
                    this.hatchAnimation = null;
                }
            }

            // 6. Calculate Sledge Hammer bio-club slam deformation
            let sledgeDeform = null;
            if (this.sledgeHammerAnimation) {
                const elapsed = now - this.sledgeHammerAnimation.startTime;
                if (elapsed < this.sledgeHammerAnimation.duration) {
                    const t = elapsed / this.sledgeHammerAnimation.duration;
                    let intensity = 0;
                    if (t < 0.38) {
                        intensity = Math.sin((t / 0.38) * (Math.PI * 0.5));
                    } else {
                        const post = (t - 0.38) / 0.62;
                        intensity = (1 - post) * Math.cos(post * Math.PI * 1.5);
                    }
                    if (Math.abs(intensity) > 0.001) {
                        sledgeDeform = {
                            angle: this.sledgeHammerAnimation.angle,
                            intensity: intensity
                        };
                    }
                } else {
                    this.sledgeHammerAnimation = null;
                }
            }

            // 7. Calculate Mine Launcher forward ejection warp deformation
            let mineLaunchDeform = null;
            if (this.mineLaunchAnimation) {
                const elapsed = now - this.mineLaunchAnimation.startTime;
                if (elapsed < this.mineLaunchAnimation.duration) {
                    const t = elapsed / this.mineLaunchAnimation.duration;
                    let intensity = 0;
                    if (t < 0.35) {
                        intensity = Math.sin((t / 0.35) * (Math.PI * 0.5));
                    } else {
                        const post = (t - 0.35) / 0.65;
                        intensity = (1 - post) * Math.cos(post * Math.PI * 2.0);
                    }
                    if (Math.abs(intensity) > 0.001) {
                        const oStackFactor = 1 + (this.mineLaunchAnimation.stacks || 0) * 0.3;
                        let oLaunchAngle = this.mineLaunchAnimation.angle;
                        const trackMine = this.mineLaunchAnimation.mine;
                        if (trackMine && trackMine.alive) {
                            oLaunchAngle = Math.atan2(trackMine.y - drawY, trackMine.x - drawX);
                        }
                        mineLaunchDeform = {
                            angle: oLaunchAngle,
                            intensity: intensity * oStackFactor,
                            warty: !!this.scatterMinesEnabled
                        };
                    }
                } else {
                    this.mineLaunchAnimation = null;
                }
            }

            // 8. Calculate Rocket reversed phagocytosis exocytosis ejection deformation
            let rocketDeform = null;
            if (this.rocketAnimation) {
                const elapsed = now - this.rocketAnimation.startTime;
                if (elapsed < this.rocketAnimation.duration) {
                    const t = elapsed / this.rocketAnimation.duration;
                    let intensity = 0;
                    if (t < 0.35) {
                        intensity = Math.sin((t / 0.35) * (Math.PI * 0.5));
                    } else {
                        const post = (t - 0.35) / 0.65;
                        intensity = (1 - post) * Math.cos(post * Math.PI * 2.0);
                    }
                    if (Math.abs(intensity) > 0.001) {
                        rocketDeform = {
                            angle: this.rocketAnimation.angle,
                            intensity: intensity
                        };
                    }
                } else {
                    this.rocketAnimation = null;
                }
            }

            // 9. Calculate Phase Dash propulsion & thrust socket deformation
            let dashLaunchDeform = null;
            if (this.dashLaunchEffect) {
                const elapsed = now - this.dashLaunchEffect.startTime;
                if (elapsed < this.dashLaunchEffect.duration) {
                    const dashProg = Math.min(1.0, elapsed / this.dashLaunchEffect.dashDuration);
                    let intensity = 0;
                    if (dashProg < 1.0) {
                        intensity = 1.0 - dashProg * 0.4;
                    } else {
                        const retractT = (elapsed - this.dashLaunchEffect.dashDuration) / (this.dashLaunchEffect.duration - this.dashLaunchEffect.dashDuration);
                        intensity = (1.0 - retractT) * 0.6;
                    }
                    if (intensity > 0.01) {
                        dashLaunchDeform = {
                            angle: this.dashLaunchEffect.angle,
                            intensity: intensity
                        };
                    }
                }
            }

            // Draw Phase Dash launch push protrusion from starting location to current blob position
            if (this.dashLaunchEffect) {
                const effect = this.dashLaunchEffect;
                const elapsed = now - effect.startTime;
                if (elapsed < effect.duration) {
                    const sx = effect.startX;
                    const sy = effect.startY;
                    const sAngle = effect.angle;
                    const normX = -Math.sin(sAngle);
                    const normY = Math.cos(sAngle);

                    let rootX, rootY, tipX, tipY, rootWidth, tipWidth, footRadius, stalkAlpha;

                    // Tip is anchored into the rear of the player blob
                    tipX = this.x - Math.cos(sAngle) * (this.r * 0.4);
                    tipY = this.y - Math.sin(sAngle) * (this.r * 0.4);

                    if (elapsed <= effect.dashDuration) {
                        // Launch phase: root stays firmly anchored at start coordinates
                        rootX = sx;
                        rootY = sy;
                        footRadius = this.r * 0.90;
                        rootWidth = footRadius * 0.88;
                        tipWidth = Math.max(3, this.r * 0.55);
                        stalkAlpha = 1.0;
                    } else {
                        // Retraction phase: root lifts and zips forward into the player blob
                        const pullT = (elapsed - effect.dashDuration) / (effect.duration - effect.dashDuration);
                        const easePull = Math.sin(pullT * Math.PI * 0.5);
                        rootX = sx + (tipX - sx) * easePull;
                        rootY = sy + (tipY - sy) * easePull;
                        const remaining = (1.0 - pullT);
                        footRadius = this.r * 0.90 * remaining;
                        rootWidth = footRadius * 0.88;
                        tipWidth = Math.max(2, this.r * 0.55 * remaining);
                        stalkAlpha = Math.max(0, 1.0 - pullT * 0.35);
                    }

                    const distToTip = Math.hypot(tipX - rootX, tipY - rootY);

                    if (distToTip > 2 && stalkAlpha > 0.01 && footRadius > 0.5) {
                        ctx.save();
                        ctx.globalAlpha = 0.92 * stalkAlpha;

                        // 1. Root foot (pulling into player)
                        ctx.fillStyle = this.color;
                        ctx.strokeStyle = this.ring || '#000000';
                        ctx.lineWidth = 2.0;
                        ctx.beginPath();
                        ctx.ellipse(rootX, rootY, footRadius * 1.15, footRadius * 0.85, sAngle, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();

                        // 2. Muscular pushing & contracting protrusion stalk extending to blob
                        const rLx = rootX + normX * rootWidth;
                        const rLy = rootY + normY * rootWidth;
                        const rRx = rootX - normX * rootWidth;
                        const rRy = rootY - normY * rootWidth;

                        const tLx = tipX + normX * tipWidth;
                        const tLy = tipY + normY * tipWidth;
                        const tRx = tipX - normX * tipWidth;
                        const tRy = tipY - normY * tipWidth;

                        const midDist = distToTip * 0.5;
                        const midX = rootX + Math.cos(sAngle) * midDist;
                        const midY = rootY + Math.sin(sAngle) * midDist;
                        const waist = Math.max(2, (rootWidth + tipWidth) * 0.42);

                        ctx.beginPath();
                        ctx.moveTo(rLx, rLy);
                        ctx.quadraticCurveTo(midX + normX * waist, midY + normY * waist, tLx, tLy);
                        ctx.lineTo(tRx, tRy);
                        ctx.quadraticCurveTo(midX - normX * waist, midY - normY * waist, rRx, rRy);
                        ctx.closePath();

                        ctx.fillStyle = this.color;
                        ctx.fill();
                        ctx.strokeStyle = this.ring || '#000000';
                        ctx.lineWidth = 2.0;
                        ctx.stroke();

                        // 3. Kinetic energy spine
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.70)';
                        ctx.lineWidth = 1.8;
                        ctx.beginPath();
                        ctx.moveTo(rootX, rootY);
                        ctx.lineTo(tipX, tipY);
                        ctx.stroke();

                        ctx.restore();
                    }
                } else {
                    this.dashLaunchEffect = null;
                }
            }

            const isMoving = !!(this.isMoving || this.dashing);
            const moveSpd = this.moveSpeed || (isMoving ? 1.0 : 0.0);
            const facing = this.facingAngle || 0;

            // 10. Calculate Laser Teardrop Taper Deformation (Only when moving)
            let laserSnailDeform = null;
            if (this.speedLvl2 && isMoving) {
                laserSnailDeform = {
                    facingAngle: facing,
                    intensity: this.dashing ? 1.4 : 1.0,
                    dualTails: !!this.iceTrailEnabled
                };
            }

            // Filter out expired budding ripples
            if (this.mitosisBuds && this.mitosisBuds.length > 0) {
                this.mitosisBuds = this.mitosisBuds.filter(b => now - b.time < b.duration);
            }

            // Draw reshapable organic fluid blob — unified contour extending roots, limbs, hammer, hatching pouch, mine nozzle, exocytic crater, dash thrust socket & teardrop laser tail!
            drawOrganicBlobPath(ctx, drawX, drawY, drawR, now, facing, moveSpd, this.mitosisBuds, pseudopod, flagellum, deflectorRoots, sniperDeform, hatchDeform, sledgeDeform, mineLaunchDeform, rocketDeform, dashLaunchDeform, laserSnailDeform);
            ctx.fillStyle = this.color;
            ctx.fill();
            ctx.strokeStyle = this.ring;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Heavy Impact: Internal Bio-Plasma Nucleus (Suspended deep in the translucent cytoplasm)
            const damageStacks = this.damageUpgradeCount || 0;
            if (damageStacks > 0) {
                ctx.save();
                ctx.beginPath();
                drawOrganicBlobPath(ctx, drawX, drawY, drawR, now, facing, moveSpd, this.mitosisBuds, pseudopod, flagellum, deflectorRoots, sniperDeform, hatchDeform, sledgeDeform, mineLaunchDeform, rocketDeform, dashLaunchDeform, laserSnailDeform);
                ctx.clip();

                const recentAttack = this.weapons.some(w => (now - (w.lastFire || 0)) < 160);
                const attackFlare = recentAttack ? 1.40 : 1.0;
                const breath = 1.0 + 0.05 * Math.sin(now * 0.0035);

                // 1. Fluid inertia & buoyant slosh lag (depth parallax: floats inside cytoplasm)
                const fluidLagX = Math.max(-drawR * 0.28, Math.min(drawR * 0.28, (this.vx || 0) * 0.40));
                const fluidLagY = Math.max(-drawR * 0.28, Math.min(drawR * 0.28, (this.vy || 0) * 0.40));
                const bobX = Math.sin(now * 0.0028 + 1.1) * (drawR * 0.035);
                const bobY = Math.cos(now * 0.0023) * (drawR * 0.035);
                const nX = drawX - fluidLagX + bobX;
                const nY = drawY - fluidLagY + bobY;

                // Color tiering based on stack level
                let coreColor, glowColor, rimColor;
                if (damageStacks === 1) {
                    coreColor = 'rgba(255, 240, 130, 0.95)';
                    glowColor = 'rgba(255, 175, 20, 0.55)';
                    rimColor = 'rgba(255, 120, 10, 0.70)';
                } else if (damageStacks === 2) {
                    coreColor = 'rgba(255, 245, 150, 0.98)';
                    glowColor = 'rgba(255, 140, 10, 0.62)';
                    rimColor = 'rgba(255, 80, 0, 0.78)';
                } else if (damageStacks === 3) {
                    coreColor = 'rgba(255, 250, 170, 1.0)';
                    glowColor = 'rgba(255, 95, 10, 0.68)';
                    rimColor = 'rgba(255, 40, 0, 0.85)';
                } else if (damageStacks <= 5) {
                    coreColor = 'rgba(255, 255, 210, 1.0)';
                    glowColor = 'rgba(255, 65, 0, 0.75)';
                    rimColor = 'rgba(230, 20, 0, 0.90)';
                } else {
                    coreColor = 'rgba(255, 255, 255, 1.0)';
                    glowColor = 'rgba(255, 45, 45, 0.85)';
                    rimColor = 'rgba(200, 0, 40, 0.98)';
                }

                // 2. Deep Subsurface Bioluminescence (Internal fluid illumination)
                const auraRadius = drawR * (0.32 + Math.min(0.26, damageStacks * 0.035)) * breath * attackFlare;
                const auraGrad = ctx.createRadialGradient(nX, nY, 0, nX, nY, auraRadius);
                auraGrad.addColorStop(0, glowColor);
                auraGrad.addColorStop(0.50, glowColor.replace(/[\d\.]+\)$/, '0.22)'));
                auraGrad.addColorStop(1, 'rgba(255, 120, 0, 0)');
                ctx.beginPath();
                ctx.arc(nX, nY, auraRadius, 0, Math.PI * 2);
                ctx.fillStyle = auraGrad;
                ctx.globalAlpha = 1;
                ctx.fill();

                // 3. Radiating Submerged Energy Tendrils (Exact count = damageStacks, up to 10)
                const filamentCount = Math.min(10, damageStacks);
                const rotBase = now * 0.0012;
                ctx.lineWidth = Math.max(1, 1.4 * (drawR / 20));
                ctx.strokeStyle = rimColor;
                for (let f = 0; f < filamentCount; f++) {
                    const fAngle = rotBase + (f / filamentCount) * (Math.PI * 2);
                    const fReach = drawR * (0.45 + 0.03 * Math.min(10, damageStacks)) * (0.94 + 0.08 * Math.sin(now * 0.005 + f * 2.1));
                    const fx = nX + Math.cos(fAngle) * fReach;
                    const fy = nY + Math.sin(fAngle) * fReach;

                    const midDist = fReach * 0.52;
                    const perpAngle = fAngle + Math.PI / 2;
                    const waveMag = drawR * 0.07 * Math.sin(now * 0.007 + f * 3.3);
                    const cx = nX + Math.cos(fAngle) * midDist + Math.cos(perpAngle) * waveMag;
                    const cy = nY + Math.sin(fAngle) * midDist + Math.sin(perpAngle) * waveMag;

                    ctx.beginPath();
                    ctx.moveTo(nX, nY);
                    ctx.quadraticCurveTo(cx, cy, fx, fy);
                    ctx.globalAlpha = 0.60 * attackFlare;
                    ctx.stroke();

                    // Soft diffuse filament tip spark
                    ctx.fillStyle = coreColor;
                    ctx.beginPath();
                    ctx.arc(fx, fy, Math.max(1, drawR * 0.032), 0, Math.PI * 2);
                    ctx.fill();
                }

                // 4. Discrete Node Cluster Geometry per Level
                const nodeOrbitRadius = drawR * (0.15 + Math.min(0.12, damageStacks * 0.015)) * breath;
                const nodeOrbRadius = drawR * (damageStacks === 1 ? 0.20 : Math.max(0.085, 0.16 - damageStacks * 0.008)) * attackFlare;
                const nodePositions = [];

                if (damageStacks === 1) {
                    nodePositions.push({ x: nX, y: nY, r: nodeOrbRadius });
                } else if (damageStacks === 2) {
                    const spin = now * 0.0025;
                    for (let i = 0; i < 2; i++) {
                        const a = spin + i * Math.PI;
                        nodePositions.push({
                            x: nX + Math.cos(a) * nodeOrbitRadius,
                            y: nY + Math.sin(a) * nodeOrbitRadius,
                            r: nodeOrbRadius
                        });
                    }
                } else if (damageStacks === 3) {
                    const spin = now * 0.0022;
                    for (let i = 0; i < 3; i++) {
                        const a = spin + (i / 3) * Math.PI * 2;
                        nodePositions.push({
                            x: nX + Math.cos(a) * nodeOrbitRadius,
                            y: nY + Math.sin(a) * nodeOrbitRadius,
                            r: nodeOrbRadius
                        });
                    }
                } else if (damageStacks === 4) {
                    const spin = now * 0.0020;
                    for (let i = 0; i < 4; i++) {
                        const a = spin + (i / 4) * Math.PI * 2;
                        nodePositions.push({
                            x: nX + Math.cos(a) * nodeOrbitRadius,
                            y: nY + Math.sin(a) * nodeOrbitRadius,
                            r: nodeOrbRadius
                        });
                    }
                } else {
                    nodePositions.push({ x: nX, y: nY, r: drawR * 0.16 * attackFlare });
                    const satellites = Math.min(9, damageStacks - 1);
                    const spin = now * 0.0018;
                    for (let i = 0; i < satellites; i++) {
                        const a = spin + (i / satellites) * Math.PI * 2;
                        nodePositions.push({
                            x: nX + Math.cos(a) * nodeOrbitRadius * 1.3,
                            y: nY + Math.sin(a) * nodeOrbitRadius * 1.3,
                            r: nodeOrbRadius * 0.85
                        });
                    }
                }

                // 5. Connecting Plasma Bridge Filaments between cluster nodes
                if (nodePositions.length > 1) {
                    ctx.beginPath();
                    ctx.strokeStyle = glowColor;
                    ctx.lineWidth = Math.max(1, 1.8 * (drawR / 20));
                    ctx.globalAlpha = 0.75 * attackFlare;
                    if (damageStacks === 2) {
                        ctx.moveTo(nodePositions[0].x, nodePositions[0].y);
                        ctx.lineTo(nodePositions[1].x, nodePositions[1].y);
                    } else if (damageStacks <= 4) {
                        for (let i = 0; i < nodePositions.length; i++) {
                            const next = (i + 1) % nodePositions.length;
                            ctx.moveTo(nodePositions[i].x, nodePositions[i].y);
                            ctx.lineTo(nodePositions[next].x, nodePositions[next].y);
                        }
                    } else {
                        const center = nodePositions[0];
                        for (let i = 1; i < nodePositions.length; i++) {
                            ctx.moveTo(center.x, center.y);
                            ctx.lineTo(nodePositions[i].x, nodePositions[i].y);
                            const next = i === nodePositions.length - 1 ? 1 : i + 1;
                            ctx.moveTo(nodePositions[i].x, nodePositions[i].y);
                            ctx.lineTo(nodePositions[next].x, nodePositions[next].y);
                        }
                    }
                    ctx.stroke();
                }

                // 6. Draw Subsurface Plasma Node Orbs with Soft Volumetric Depth
                for (let i = 0; i < nodePositions.length; i++) {
                    const node = nodePositions[i];
                    const nodeGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.r);
                    nodeGrad.addColorStop(0, coreColor);
                    nodeGrad.addColorStop(0.40, glowColor);
                    nodeGrad.addColorStop(0.80, rimColor);
                    nodeGrad.addColorStop(1, 'rgba(160, 0, 0, 0)');

                    ctx.beginPath();
                    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
                    ctx.fillStyle = nodeGrad;
                    ctx.globalAlpha = 0.95;
                    ctx.fill();

                    // Hot white-gold internal nucleus core pip
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, Math.max(1, node.r * 0.32), 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.globalAlpha = 0.88 * attackFlare;
                    ctx.fill();
                }

                // 7. Translucent Cytoplasm Fluid Wash (Covers the organelle in colored jelly)
                ctx.fillStyle = this.color;
                ctx.globalAlpha = 0.38;
                ctx.beginPath();
                ctx.arc(drawX, drawY, drawR * 1.5, 0, Math.PI * 2);
                ctx.fill();

                // 8. 3D Spherical Vignette & Inner Membrane Rim Shadow (Creates deep spherical chamber)
                const depthGrad = ctx.createRadialGradient(drawX, drawY, drawR * 0.20, drawX, drawY, drawR);
                depthGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
                depthGrad.addColorStop(0.65, 'rgba(0, 0, 0, 0.08)');
                depthGrad.addColorStop(0.92, 'rgba(0, 0, 0, 0.40)');
                depthGrad.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
                ctx.beginPath();
                ctx.arc(drawX, drawY, drawR, 0, Math.PI * 2);
                ctx.fillStyle = depthGrad;
                ctx.globalAlpha = 0.75;
                ctx.fill();

                ctx.restore();
            }

            // Iron Carapace: riveted iron scales plated over the body, tinted from the player color
            // so the organic tone shows through between plates (translucent shell, not opaque gray)
            if (this.damageReduction && this.damageReduction < 1) {
                const plateFill = shadeHex(this.color, 0.70);
                const plateSeam = shadeHex(this.color, 0.40);
                const plateRim = shadeHex(this.color, 1.38);
                ctx.save();
                ctx.beginPath();
                drawOrganicBlobPath(ctx, drawX, drawY, drawR, now, facing, moveSpd, this.mitosisBuds, pseudopod, flagellum, deflectorRoots, sniperDeform, hatchDeform, sledgeDeform, mineLaunchDeform, rocketDeform, dashLaunchDeform, laserSnailDeform);
                ctx.clip();

                const rings = 4;
                for (let k = 0; k < rings; k++) {
                    const f0 = 0.18 + k * 0.22;
                    const f1 = f0 + 0.30;
                    const counts = Math.round(4 + (k + 1) * 1.0);
                    const step = (Math.PI * 2) / counts;
                    const off = (k % 2) * 0.5 * step;
                    const r0 = drawR * f0;
                    const r1 = drawR * f1;
                    for (let c = 0; c < counts; c++) {
                        const a = off + c * step;
                        const aw = step * 0.5;
                        ctx.beginPath();
                        ctx.arc(drawX, drawY, r1, a - aw, a + aw);
                        ctx.arc(drawX, drawY, r0, a + aw, a - aw, true);
                        ctx.closePath();
                        ctx.globalAlpha = 0.80;
                        ctx.fillStyle = plateFill;
                        ctx.fill();
                        ctx.globalAlpha = 1;
                        ctx.strokeStyle = plateSeam;
                        ctx.lineWidth = 1;
                        ctx.stroke();
                        ctx.strokeStyle = plateRim;
                        ctx.globalAlpha = 0.6;
                        ctx.lineWidth = 0.8;
                        ctx.beginPath();
                        ctx.arc(drawX, drawY, r1 * 0.97, a - aw * 0.7, a + aw * 0.7);
                        ctx.stroke();
                    }
                }

                // Barbed Carapace: thorns scattered across the plates, warping with the shell
                if (this.reflectDamageEnabled) {
                    const barbFill = shadeHex(this.color, 0.60);
                    const barbSeam = shadeHex(this.color, 0.32);
                    const barbGlint = shadeHex(this.color, 1.32);
                    const barbRings = [0.36, 0.58, 0.80];
                    const ringCounts = [6, 9, 12];
                    for (let k = 0; k < barbRings.length; k++) {
                        const f = barbRings[k];
                        const r0 = drawR * f;
                        const cnt = ringCounts[k];
                        for (let c = 0; c < cnt; c++) {
                            const a = (c / cnt) * Math.PI * 2 + (k % 2) * (Math.PI / cnt) + Math.sin(now * 0.0005 + k * 2.7 + c) * 0.045;
                            const bl = drawR * (0.16 + 0.06 * ((c + k) % 2));
                            const tipR = r0 + bl;
                            const bw = drawR * 0.085;
                            const bx = drawX + Math.cos(a) * r0;
                            const by = drawY + Math.sin(a) * r0;
                            const tx2 = drawX + Math.cos(a) * tipR;
                            const ty2 = drawY + Math.sin(a) * tipR;
                            const txx = -Math.sin(a) * bw;
                            const tyy = Math.cos(a) * bw;
                            ctx.beginPath();
                            ctx.moveTo(bx - txx, by - tyy);
                            ctx.lineTo(tx2, ty2);
                            ctx.lineTo(bx + txx, by + tyy);
                            ctx.closePath();
                            ctx.fillStyle = barbFill;
                            ctx.globalAlpha = 0.95;
                            ctx.fill();
                            ctx.globalAlpha = 1;
                            ctx.strokeStyle = barbSeam;
                            ctx.lineWidth = 1.2;
                            ctx.stroke();
                            ctx.fillStyle = barbGlint;
                            ctx.globalAlpha = 0.6;
                            ctx.beginPath();
                            ctx.arc(tx2, ty2, Math.max(1, drawR * 0.035), 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                }
                ctx.restore();
            }

            // Barbed Carapace: longer outer barbs ringing the beacon ring the direction pointer sits on
            if (this.reflectDamageEnabled) {
                ctx.save();
                ctx.lineJoin = 'round';
                const outerCount = 10;
                const outerFill = shadeHex(this.color, 0.58);
                const outerSeam = shadeHex(this.color, 0.30);
                const outerGlint = shadeHex(this.color, 1.34);
                for (let s = 0; s < outerCount; s++) {
                    const a = (s / outerCount) * Math.PI * 2 + Math.sin(now * 0.0005 + s * 1.9) * 0.05;
                    const len = (s % 2 === 0) ? drawR * 0.24 : drawR * 0.16;
                    const baseR = beaconR + 1;
                    const tipR = baseR + len;
                    const bw = drawR * 0.075;
                    const bx2 = drawX + Math.cos(a) * baseR;
                    const by2 = drawY + Math.sin(a) * baseR;
                    const ax2 = drawX + Math.cos(a) * tipR;
                    const ay2 = drawY + Math.sin(a) * tipR;
                    const txx = -Math.sin(a) * bw;
                    const tyy = Math.cos(a) * bw;
                    ctx.beginPath();
                    ctx.moveTo(bx2 - txx, by2 - tyy);
                    ctx.quadraticCurveTo(ax2 - txx * 0.45, ay2 - tyy * 0.45, ax2, ay2);
                    ctx.quadraticCurveTo(ax2 + txx * 0.45, ay2 + tyy * 0.45, bx2 + txx, by2 + tyy);
                    ctx.closePath();
                    ctx.fillStyle = outerFill;
                    ctx.globalAlpha = 0.9;
                    ctx.fill();
                    ctx.globalAlpha = 1;
                    ctx.strokeStyle = outerSeam;
                    ctx.lineWidth = 1.1;
                    ctx.stroke();
                    ctx.fillStyle = outerGlint;
                    ctx.globalAlpha = 0.6;
                    ctx.beginPath();
                    ctx.arc(ax2, ay2, Math.max(1, drawR * 0.03), 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            // Cryo Freeze: frost-blue smoke rising between the blob body and the beacon ring,
            // closely mirroring the Blast Mending smokey look but hugging inside the ring
            if (this.freezeEnabled) {
                ctx.save();
                const segs = 56;
                let cfx, cfy, nnz, cfoo;
                // Thin wavy frost ring running in the gap between the body and the ring
                ctx.beginPath();
                for (let i = 0; i <= segs; i++) {
                    const a = (i / segs) * Math.PI * 2;
                    nnz = drawR * 0.05 * Math.sin(a * 4 + now * 0.004) + drawR * 0.04 * Math.sin(a * 9 + now * 0.006 + 1.7);
                    cfoo = drawR + 3 + nnz;
                    cfx = drawX + Math.cos(a) * cfoo;
                    cfy = drawY + Math.sin(a) * cfoo;
                    if (i === 0) ctx.moveTo(cfx, cfy);
                    else ctx.lineTo(cfx, cfy);
                }
                ctx.closePath();
                ctx.strokeStyle = 'rgb(140, 210, 255)';
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.28;
                ctx.stroke();

                // Frosty haze hugging just inside the beacon ring
                ctx.beginPath();
                for (let i = 0; i <= segs; i++) {
                    const a = (i / segs) * Math.PI * 2;
                    nnz = drawR * 0.09 * Math.sin(a * 3 + now * 0.0035 + 2.1) + drawR * 0.07 * Math.sin(a * 8 + now * 0.005 + 0.4);
                    cfoo = beaconR - 1.5 + nnz;
                    cfx = drawX + Math.cos(a) * cfoo;
                    cfy = drawY + Math.sin(a) * cfoo;
                    if (i === 0) ctx.moveTo(cfx, cfy);
                    else ctx.lineTo(cfx, cfy);
                }
                ctx.closePath();
                ctx.strokeStyle = 'rgb(120, 190, 255)';
                ctx.lineWidth = 6;
                ctx.globalAlpha = 0.10;
                ctx.stroke();

                // Frost smoke columns rising from between the body and the ring
                const plumeCount = 6;
                const riseH = drawR * 0.4;
                ctx.fillStyle = 'rgb(150, 220, 255)';
                for (let i = 0; i < plumeCount; i++) {
                    const baseAng = -Math.PI / 2 + (i / plumeCount) * 2.6 - 1.3 + Math.sin(now * 0.0007 + i * 2.3) * 0.35;
                    const ox = drawX + Math.cos(baseAng) * (beaconR - 1);
                    const oy = drawY + Math.sin(baseAng) * (beaconR - 1);
                    const front = (now * 0.00035 + i * 0.27) % 1;
                    const steps = 7;
                    for (let k = 0; k < steps; k++) {
                        const hf = front - k / steps;
                        if (hf < 0) continue;
                        const sway = Math.sin(hf * 3.0 + now * 0.005 + i * 2.4) * (drawR * 0.45 * hf);
                        cfx = ox + sway;
                        cfy = oy - hf * riseH;
                        cfoo = drawR * (0.05 + 0.11 * hf);
                        ctx.globalAlpha = Math.max(0, (1 - hf)) * 0.20;
                        ctx.beginPath();
                        ctx.arc(cfx, cfy, cfoo, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                ctx.globalAlpha = 1;
                ctx.restore();
            }

            // Blast Mending smokey aura: thin lifesteal-red fringe just outside the beacon ring,
            // plus smoke rising off that ring like smoke from a fire
            if (this.explosionHealEnabled) {
                ctx.save();
                const segs = 56;
                let a, px, py, nz, rr;
                ctx.beginPath();
                for (let i = 0; i <= segs; i++) {
                    a = (i / segs) * Math.PI * 2;
                    nz = drawR * 0.05 * Math.sin(a * 4 + now * 0.004) + drawR * 0.04 * Math.sin(a * 9 + now * 0.006 + 1.7);
                    rr = beaconR + 1.5 + nz;
                    px = drawX + Math.cos(a) * rr;
                    py = drawY + Math.sin(a) * rr;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.strokeStyle = 'rgb(224, 74, 152)';
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.28;
                ctx.stroke();

                ctx.beginPath();
                for (let i = 0; i <= segs; i++) {
                    a = (i / segs) * Math.PI * 2;
                    nz = drawR * 0.09 * Math.sin(a * 3 + now * 0.0035 + 2.1) + drawR * 0.07 * Math.sin(a * 8 + now * 0.005 + 0.4);
                    rr = beaconR + 5 + nz;
                    px = drawX + Math.cos(a) * rr;
                    py = drawY + Math.sin(a) * rr;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.strokeStyle = 'rgb(180, 58, 130)';
                ctx.lineWidth = 6;
                ctx.globalAlpha = 0.10;
                ctx.stroke();

                // Rising smoke columns from the top of the ring, curling and fading like fire smoke
                const plumeCount = 6;
                const riseH = drawR * 1.0;
                ctx.fillStyle = 'rgb(224, 74, 152)';
                for (let i = 0; i < plumeCount; i++) {
                    const baseAng = -Math.PI / 2 + (i / plumeCount) * 2.6 - 1.3 + Math.sin(now * 0.0007 + i * 2.3) * 0.35;
                    const ox = drawX + Math.cos(baseAng) * (beaconR + 2);
                    const oy = drawY + Math.sin(baseAng) * (beaconR + 2);
                    const front = (now * 0.00035 + i * 0.27) % 1;
                    const steps = 7;
                    for (let k = 0; k < steps; k++) {
                        const hf = front - k / steps;
                        if (hf < 0) continue;
                        const sway = Math.sin(hf * 3.0 + now * 0.005 + i * 2.4) * (drawR * 0.45 * hf);
                        px = ox + sway;
                        py = oy - hf * riseH;
                        rr = drawR * (0.08 + 0.13 * hf);
                        ctx.globalAlpha = Math.max(0, (1 - hf)) * 0.20;
                        ctx.beginPath();
                        ctx.arc(px, py, rr, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                ctx.restore();
            }

            // Magnetic Core: bar-magnet field loops wrapping the north-south axis, drawn with a
            // half side / half top 3/4 view — each loop sits in a vertical plane at its own
            // azimuth around the axis, foreshortened and dimmed by depth like an ellipsoid lattice
            if (this.mineAttractEnabled) {
                ctx.save();
                ctx.lineCap = 'round';
                const fieldCount = 7;
                for (let i = 0; i < fieldCount; i++) {
                    const phi = -1.2 + (i / (fieldCount - 1)) * 2.4;
                    const u = 0.35 + (i / (fieldCount - 1)) * 0.60;
                    const shimmer = 0.5 + 0.5 * Math.sin(now * 0.0025 + i * 1.7);
                    const depth = 0.5 + 0.5 * Math.cos(phi);
                    ctx.strokeStyle = `rgba(122, 199, 255, ${(0.34 + 0.16 * shimmer) * depth})`;
                    ctx.lineWidth = 1.3;
                    ctx.beginPath();
                    const steps = 48;
                    for (let s = 0; s <= steps; s++) {
                        const tA = (s / steps) * Math.PI * 2;
                        const rr = drawR * (1 + Math.pow(Math.abs(Math.sin(tA)), 1.4) * u) + 2;
                        const horiz = Math.sin(tA) * rr * (Math.cos(phi) * 0.92 + Math.sin(phi) * 0.38);
                        const vert = -Math.cos(tA) * rr * 0.9;
                        const fx = drawX + horiz;
                        const fy = drawY + vert;
                        if (s === 0) ctx.moveTo(fx, fy);
                        else ctx.lineTo(fx, fy);
                    }
                    ctx.stroke();
                }

                // Steady flow: arrows travel along each loop so they always fall from the
                // north pole (top) down to the south pole (bottom) across the near side
                ctx.lineJoin = 'round';
                const arrowsPerLoop = 3;
                for (let i = 0; i < fieldCount; i++) {
                    const phi = -1.2 + (i / (fieldCount - 1)) * 2.4;
                    const u = 0.35 + (i / (fieldCount - 1)) * 0.60;
                    const dirs = Math.abs(phi) < 0.0005 ? [-1, 1] : [-Math.sign(phi)];
                    for (let d = 0; d < dirs.length; d++) {
                        const dir = dirs[d];
                        for (let q = 0; q < arrowsPerLoop; q++) {
                            const tw = ((q / arrowsPerLoop) * Math.PI * 2 + dir * now * 0.0016) % (Math.PI * 2);
                            const rr = drawR * (1 + Math.pow(Math.abs(Math.sin(tw)), 1.4) * u) + 2;
                            const px = drawX + Math.sin(tw) * rr * (Math.cos(phi) * 0.92 + Math.sin(phi) * 0.38);
                            const py = drawY - Math.cos(tw) * rr * 0.9;
                            const dt = 0.03;
                            const tf = tw + dir * dt;
                            const rrF = drawR * (1 + Math.pow(Math.abs(Math.sin(tf)), 1.4) * u) + 2;
                            const px2 = drawX + Math.sin(tf) * rrF * (Math.cos(phi) * 0.92 + Math.sin(phi) * 0.38);
                            const py2 = drawY - Math.cos(tf) * rrF * 0.9;
                            const ang = Math.atan2(py2 - py, px2 - px);
                            const al = drawR * 0.14;
                            const aw2 = drawR * 0.075;
                            const nearSide = Math.abs(phi) < 0.0005
                                ? (dir === -1 ? Math.sin(tw) < 0 : Math.sin(tw) >= 0)
                                : (Math.sin(tw) * Math.sin(phi) <= 0);
                            if (!nearSide) continue;
                            ctx.fillStyle = 'rgba(200, 232, 255, 0.92)';
                            ctx.save();
                            ctx.translate(px, py);
                            ctx.rotate(ang);
                            ctx.beginPath();
                            ctx.moveTo(al, 0);
                            ctx.lineTo(-al * 0.6, aw2);
                            ctx.lineTo(-al * 0.6, -aw2);
                            ctx.closePath();
                            ctx.fill();
                            ctx.restore();
                        }
                    }
                }
                ctx.restore();
            }

            // Martyrdom marks: a blood drop on the front of the blob. Martyr's Aura adds a red ring
            // around it, Martyr's Presence adds provocation ripples spilling from the drop, and
            // Sacrificial Aegis streams red smoke toward each ally (streaming into the drop when damaged)
            if (this.finalBlastEnabled) {
                const dropAngle = facing;
                const dropSize = drawR * 0.34;

                // Sample the deformed skin around the drop's spot so the drop rides the wiggling body
                const blobPts = drawOrganicBlobPath(ctx, drawX, drawY, drawR, now, facing, moveSpd, this.mitosisBuds, pseudopod, flagellum, deflectorRoots, sniperDeform, hatchDeform, sledgeDeform, mineLaunchDeform, rocketDeform, dashLaunchDeform, laserSnailDeform);
                const surfaceRadiusAt = (ang) => {
                    let a = ang % (Math.PI * 2);
                    if (a < 0) a += Math.PI * 2;
                    const n = blobPts.length;
                    const i = Math.floor((a / (Math.PI * 2)) * n) % n;
                    const j = (i + 1) % n;
                    const frac = (a / (Math.PI * 2)) * n - i;
                    const r1 = Math.hypot(blobPts[i].x - drawX, blobPts[i].y - drawY);
                    const r2 = Math.hypot(blobPts[j].x - drawX, blobPts[j].y - drawY);
                    return r1 + (r2 - r1) * frac;
                };
                const spread = 0.24;
                const sMid = surfaceRadiusAt(dropAngle);
                const sL = surfaceRadiusAt(dropAngle - spread);
                const sR = surfaceRadiusAt(dropAngle + spread);
                const radialScale = Math.max(0.35, sMid / drawR);
                const latScale = Math.max(0.35, (sL + sR) / (2 * drawR));
                const tilt = Math.atan2(sR - sL, sMid * 2 * spread) * 0.6;
                const dropCenterDist = sMid * 0.92;
                const ddX = drawX + Math.cos(dropAngle) * dropCenterDist;
                const ddY = drawY + Math.sin(dropAngle) * dropCenterDist;

                ctx.save();

                // Martyr's Presence: provocation ripples spawning right at the drop and expanding outward (taunt call)
                if (this.martyrsPresenceEnabled) {
                    const pp = (now * 0.00045 + 0.37) % 1;
                    ctx.strokeStyle = 'rgba(200, 40, 60, 1)';
                    ctx.lineWidth = 1.8;
                    for (let w = 0; w < 2; w++) {
                        const p = (pp + w * 0.5) % 1;
                        const rr2 = dropSize * 1.6 + p * drawR * 2.2;
                        ctx.globalAlpha = (1 - p) * 0.45;
                        ctx.beginPath();
                        ctx.arc(ddX, ddY, rr2, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                    ctx.globalAlpha = 1;
                }

                // Sacrificial Aegis: red smoke clouds centered around the blood drop pointing at each respective ally,
                // streaming inward toward the blood drop whenever an ally takes damage
                if (this.sacrificialAegisEnabled) {
                    const livingAllies = GAME_STATE.players.filter(p => p !== this && p.alive);
                    const targets = livingAllies.length > 0
                        ? livingAllies
                        : [{ x: ddX + Math.cos(facing) * 100, y: ddY + Math.sin(facing) * 100, lastDamagedTime: 0, hitFlashUntil: 0 }];

                    for (const ally of targets) {
                        const dx = ally.x - ddX;
                        const dy = ally.y - ddY;
                        const dist = Math.hypot(dx, dy) || 1;
                        const angle = Math.atan2(dy, dx);
                        const ux = Math.cos(angle);
                        const uy = Math.sin(angle);
                        const px = -uy;
                        const py = ux;

                        const isAllyDamaged = (ally.lastDamagedTime && (now - ally.lastDamagedTime < 700)) || (ally.hitFlashUntil && ally.hitFlashUntil > now);
                        const isSelfDamaged = (this.lastSacrificeTime && (now - this.lastSacrificeTime < 700) && this.lastSacrificedAlly === ally) || (this.hitFlashUntil && this.hitFlashUntil > now);
                        const isDamaged = isAllyDamaged || isSelfDamaged;

                        // Cloud plume reach toward the ally
                        const maxReach = Math.min(drawR * 4.8, Math.max(drawR * 2.2, dist * 0.45));

                        // 1. Soft atmospheric base ambient cloud glow along the ally direction vector
                        const cloudBlobs = 4;
                        for (let b = 0; b < cloudBlobs; b++) {
                            const bProg = (b + 0.8) / (cloudBlobs + 0.8);
                            const bDist = bProg * maxReach;
                            const bRadius = drawR * (0.24 + 0.32 * bProg);
                            const bx = ddX + ux * bDist;
                            const by = ddY + uy * bDist;
                            const bgGrad = ctx.createRadialGradient(bx, by, 0, bx, by, bRadius);
                            bgGrad.addColorStop(0, isDamaged ? 'rgba(235, 45, 65, 0.20)' : 'rgba(180, 25, 40, 0.12)');
                            bgGrad.addColorStop(0.7, isDamaged ? 'rgba(200, 30, 50, 0.08)' : 'rgba(150, 20, 35, 0.04)');
                            bgGrad.addColorStop(1, 'rgba(140, 15, 25, 0)');
                            ctx.beginPath();
                            ctx.arc(bx, by, bRadius, 0, Math.PI * 2);
                            ctx.fillStyle = bgGrad;
                            ctx.globalAlpha = 1;
                            ctx.fill();
                        }

                        // 2. Multi-strand billowy red smoke cloud puffs
                        const strandCount = 4;
                        for (let s = 0; s < strandCount; s++) {
                            const sOffset = s / strandCount;
                            const puffCount = 9;
                            for (let p = 0; p < puffCount; p++) {
                                let prog;
                                if (isDamaged) {
                                    // Streaming rapidly inward toward the blood drop
                                    prog = 1 - ((now * 0.0016 + sOffset + p / puffCount) % 1);
                                } else {
                                    // Gently wafting and billowing outward toward this specific ally
                                    prog = (now * 0.00055 + sOffset + p / puffCount) % 1;
                                }

                                const curDist = prog * maxReach;
                                const swayFreq = isDamaged ? 7.0 : 3.2;
                                const swayAmp = drawR * (isDamaged ? 0.22 : 0.18) * Math.sin(prog * Math.PI);
                                const sway = Math.sin(prog * swayFreq + now * (isDamaged ? 0.009 : 0.0028) + s * 1.7) * swayAmp;

                                const sx = ddX + ux * curDist + px * sway;
                                const sy = ddY + uy * curDist + py * sway;

                                const puffR = isDamaged
                                    ? drawR * (0.08 + 0.18 * prog)
                                    : drawR * (0.07 + 0.18 * prog);

                                let alpha;
                                if (isDamaged) {
                                    alpha = (0.28 + 0.65 * (1 - prog * 0.4)) * 0.55;
                                } else {
                                    alpha = Math.sin(prog * Math.PI) * 0.30;
                                }

                                ctx.beginPath();
                                ctx.arc(sx, sy, Math.max(1, puffR), 0, Math.PI * 2);
                                ctx.fillStyle = isDamaged ? 'rgb(245, 45, 68)' : 'rgb(205, 30, 48)';
                                ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
                                ctx.fill();
                            }
                        }

                        // 3. When damaged, fast streaming crimson filaments / motes rushing directly into the drop
                        if (isDamaged) {
                            const filamentCount = 6;
                            for (let k = 0; k < filamentCount; k++) {
                                const fp = (now * 0.003 + k / filamentCount) % 1;
                                const fDist = (1 - fp) * maxReach * 1.15;
                                const fSway = Math.sin(fp * 9.0 + now * 0.012 + k * 1.8) * (drawR * 0.14 * (1 - fp));
                                const fx = ddX + ux * fDist + px * fSway;
                                const fy = ddY + uy * fDist + py * fSway;

                                ctx.beginPath();
                                ctx.arc(fx, fy, Math.max(1, drawR * (0.05 + 0.035 * (1 - fp))), 0, Math.PI * 2);
                                ctx.fillStyle = 'rgb(255, 125, 140)';
                                ctx.globalAlpha = (1 - fp) * 0.80;
                                ctx.fill();
                            }
                        }
                    }

                    // 4. Central Blood Drop core absorption glow
                    const anyAllyDamaged = livingAllies.some(a => (a.lastDamagedTime && (now - a.lastDamagedTime < 700)) || (a.hitFlashUntil && a.hitFlashUntil > now));
                    const isAnyDamaged = anyAllyDamaged || (this.hitFlashUntil && this.hitFlashUntil > now);
                    const coreR = drawR * (isAnyDamaged ? 0.48 : 0.30);
                    const coreGrad = ctx.createRadialGradient(ddX, ddY, 0, ddX, ddY, coreR);
                    coreGrad.addColorStop(0, isAnyDamaged ? 'rgba(255, 55, 75, 0.55)' : 'rgba(200, 30, 45, 0.22)');
                    coreGrad.addColorStop(0.6, isAnyDamaged ? 'rgba(220, 35, 50, 0.25)' : 'rgba(170, 20, 35, 0.08)');
                    coreGrad.addColorStop(1, 'rgba(150, 15, 25, 0)');
                    ctx.beginPath();
                    ctx.arc(ddX, ddY, coreR, 0, Math.PI * 2);
                    ctx.fillStyle = coreGrad;
                    ctx.globalAlpha = 1;
                    ctx.fill();

                    ctx.globalAlpha = 1;
                }

                // Martyr's Aura: pulsing red ring directly around the drop (heal / damage / slow zone mark)
                if (this.martyrdomAuraEnabled) {
                    const pulse = 1 + 0.05 * Math.sin(now * 0.003);
                    const ringR = dropSize * 1.55 * pulse;
                    ctx.strokeStyle = 'rgba(255, 120, 130, 0.40)';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.arc(ddX, ddY, ringR + 2, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.strokeStyle = 'rgba(210, 40, 60, 0.8)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(ddX, ddY, ringR, 0, Math.PI * 2);
                    ctx.stroke();
                }

                // The blood drop: clipped to the deforming body so it embeds at the skin, then scaled
                // and leaned by the local surface deformation so it stretches with the wiggles
                ctx.beginPath();
                drawOrganicBlobPath(ctx, drawX, drawY, drawR, now, facing, moveSpd, this.mitosisBuds, pseudopod, flagellum, deflectorRoots, sniperDeform, hatchDeform, sledgeDeform, mineLaunchDeform, rocketDeform, dashLaunchDeform, laserSnailDeform);
                ctx.clip();

                ctx.translate(ddX, ddY);
                ctx.rotate(dropAngle + tilt);
                ctx.scale(radialScale, latScale);
                
                // Fast soft edge under drop
                ctx.strokeStyle = 'rgba(150, 10, 20, 0.45)';
                ctx.lineWidth = 3.0;
                ctx.beginPath();
                ctx.moveTo(dropSize, 0);
                ctx.bezierCurveTo(dropSize * 0.35, dropSize * 0.42, -dropSize * 0.55, dropSize * 0.5, -dropSize * 0.75, 0);
                ctx.bezierCurveTo(-dropSize * 0.55, -dropSize * 0.5, dropSize * 0.35, -dropSize * 0.42, dropSize, 0);
                ctx.closePath();
                ctx.stroke();
                ctx.fillStyle = '#6d0a10';
                ctx.fill();

                ctx.beginPath();
                ctx.moveTo(dropSize * 0.7, 0);
                ctx.bezierCurveTo(dropSize * 0.28, dropSize * 0.3, -dropSize * 0.32, dropSize * 0.33, -dropSize * 0.52, 0);
                ctx.bezierCurveTo(-dropSize * 0.32, -dropSize * 0.33, dropSize * 0.28, -dropSize * 0.3, dropSize * 0.7, 0);
                ctx.closePath();
                ctx.fillStyle = '#a31a22';
                ctx.fill();
                ctx.fillStyle = 'rgba(255, 200, 205, 0.85)';
                ctx.beginPath();
                ctx.arc(dropSize * 0.05, -dropSize * 0.18, dropSize * 0.10, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

// 12. Laser Teardrop Trail Apex Secretion & Viscoelastic Laser Threads (Only when moving)
            if (this.speedLvl2 && isMoving) {
                ctx.save();
                const rearAngle = facing + Math.PI;
                const normAngle = facing + Math.PI / 2;
                const normX = Math.cos(normAngle);
                const normY = Math.sin(normAngle);

                if (this.iceTrailEnabled) {
                    // Twin laser secretion apexes reaching precisely to the ±22px laser spawning points
                    const rearReach = drawR * 0.55;
                    const trailAngleOffset = Math.atan2(22, rearReach);
                    const apexDist = Math.hypot(rearReach, 22);

                    for (const side of [-1, 1]) {
                        const tailAngle = rearAngle + side * trailAngleOffset;
                        const apexX = drawX + Math.cos(tailAngle) * apexDist;
                        const apexY = drawY + Math.sin(tailAngle) * apexDist;
                        const trailEmergenceX = apexX + Math.cos(rearAngle) * (drawR * 0.35);
                        const trailEmergenceY = apexY + Math.sin(rearAngle) * (drawR * 0.35);

                        // Viscoelastic laser thread extending from droplet apex to ground trail
                        ctx.strokeStyle = '#33ccff';
                        ctx.lineWidth = 2.4;
                        ctx.globalAlpha = 0.85;
                        ctx.beginPath();
                        ctx.moveTo(apexX, apexY);
                        ctx.lineTo(trailEmergenceX, trailEmergenceY);
                        ctx.stroke();

                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1.0;
                        ctx.globalAlpha = 0.95;
                        ctx.beginPath();
                        ctx.moveTo(apexX, apexY);
                        ctx.lineTo(trailEmergenceX, trailEmergenceY);
                        ctx.stroke();

                        // Glowing apex emission bead on each tail tip
                        ctx.fillStyle = '#00ffff';
                        ctx.beginPath();
                        ctx.arc(apexX, apexY, 2.5, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.fillStyle = '#ffffff';
                        ctx.beginPath();
                        ctx.arc(apexX, apexY, 1.2, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else {
                    // Central teardrop apex laser filament shedding into trail
                    const tipApexDist = drawR * (1.45 + 0.03 * Math.sin(now * 0.015));
                    const apexX = drawX + Math.cos(rearAngle) * tipApexDist;
                    const apexY = drawY + Math.sin(rearAngle) * tipApexDist;
                    const trailEmergenceX = apexX + Math.cos(rearAngle) * (drawR * 0.35);
                    const trailEmergenceY = apexY + Math.sin(rearAngle) * (drawR * 0.35);

                    // Viscoelastic laser filament connecting teardrop tip to ground trail
                    ctx.strokeStyle = this.color || '#33ccff';
                    ctx.lineWidth = 2.6;
                    ctx.globalAlpha = 0.85;
                    ctx.beginPath();
                    ctx.moveTo(apexX, apexY);
                    ctx.lineTo(trailEmergenceX, trailEmergenceY);
                    ctx.stroke();

                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.2;
                    ctx.globalAlpha = 0.95;
                    ctx.beginPath();
                    ctx.moveTo(apexX, apexY);
                    ctx.lineTo(trailEmergenceX, trailEmergenceY);
                    ctx.stroke();

                    // Radiant laser apex tip gleam
                    ctx.fillStyle = '#00ffff';
                    ctx.beginPath();
                    ctx.arc(apexX, apexY, 2.8, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(apexX, apexY, 1.4, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            // Agility Boost: Aerodynamic Shoulder Slipstreams / Wind Shears (Active when moving, smoothly fades in & out)
            if (this.agilityBoostEnabled && this.agilityFade > 0.001) {
                ctx.save();
                const fade = this.agilityFade;
                const speedScale = this.dashing ? 1.6 : (this.moveSpeed || 1.0);

                // Draw symmetrical aerodynamic slipstream ribbons on left & right shoulders
                for (const side of [-1, 1]) {
                    const shoulderRibbons = 3;
                    for (let r = 0; r < shoulderRibbons; r++) {
                        const ribOffset = (r / shoulderRibbons) * 0.35;
                        const startAngle = facing + side * (0.40 + ribOffset);
                        const ribbonRadius = drawR * (1.08 + r * 0.12);
                        
                        const flowPhase = (now * 0.007 * speedScale + r * 0.33) % 1;
                        const arcSpan = Math.PI * 0.36;
                        const arcStart = startAngle + side * (flowPhase * 0.22);
                        const arcEnd = arcStart + side * arcSpan;

                        ctx.beginPath();
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
                        ctx.lineWidth = Math.max(1, (1.8 - r * 0.4) * (drawR / 20));
                        ctx.globalAlpha = (0.45 - r * 0.12) * Math.sin(flowPhase * Math.PI) * fade;
                        if (side === 1) {
                            ctx.arc(drawX, drawY, ribbonRadius, arcStart, arcEnd);
                        } else {
                            ctx.arc(drawX, drawY, ribbonRadius, arcEnd, arcStart);
                        }
                        ctx.stroke();
                    }

                    // High-velocity wind shearing streaks rushing backward off the shoulders
                    const streakCount = 3;
                    for (let k = 0; k < streakCount; k++) {
                        const streakProg = (now * 0.012 * speedScale + k / streakCount + (side === 1 ? 0 : 0.5)) % 1;
                        const sAngle = facing + side * (0.45 + streakProg * 0.80);
                        const sRad = drawR * (1.10 + 0.16 * streakProg);
                        const sx = drawX + Math.cos(sAngle) * sRad;
                        const sy = drawY + Math.sin(sAngle) * sRad;

                        const streakLen = drawR * (0.28 + 0.18 * speedScale) * (1 - streakProg * 0.5);
                        const shearAngle = sAngle + side * (Math.PI * 0.55);
                        const ex = sx + Math.cos(shearAngle) * streakLen;
                        const ey = sy + Math.sin(shearAngle) * streakLen;

                        ctx.beginPath();
                        ctx.moveTo(sx, sy);
                        ctx.lineTo(ex, ey);
                        ctx.strokeStyle = 'rgba(200, 245, 255, 0.9)';
                        ctx.lineWidth = Math.max(1, 1.4 * (1 - streakProg * 0.6));
                        ctx.globalAlpha = Math.sin(streakProg * Math.PI) * 0.75 * fade;
                        ctx.stroke();

                        ctx.fillStyle = '#ffffff';
                        ctx.globalAlpha = fade;
                        ctx.beginPath();
                        ctx.arc(sx, sy, Math.max(0.8, 1.2 * (1 - streakProg)), 0, Math.PI * 2);
                        ctx.fill();
                    }
                }

                // Forward bow-shock compression sheen on the front leading curve
                ctx.beginPath();
                ctx.arc(drawX, drawY, drawR * 1.18, facing - 0.50, facing + 0.50);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.40)';
                ctx.lineWidth = 1.6;
                ctx.globalAlpha = (0.5 + 0.2 * Math.sin(now * 0.01)) * fade;
                ctx.stroke();

                ctx.restore();
            }

            // 6. Leading edge energy crest on the tip of the extended pseudopod
            if (pseudopod && pseudopod.reach > 2) {
                ctx.save();
                const tipX = drawX + Math.cos(pseudopod.angle) * pseudopod.currentReach;
                const tipY = drawY + Math.sin(pseudopod.angle) * pseudopod.currentReach;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2.0;
                ctx.globalAlpha = 0.9 * (1 - pseudopod.t * 0.5);
                ctx.beginPath();
                ctx.arc(tipX, tipY, 4.5, pseudopod.angle - Math.PI / 3, pseudopod.angle + Math.PI / 3);
                ctx.stroke();
                ctx.restore();
            }

            // 7. Luminous bio-focus gleam on the elongated tip of the sniper needle
            if (sniperDeform && sniperDeform.intensity > 0.20) {
                ctx.save();
                const tipDist = drawR * (1 + 3.0 * Math.max(0, sniperDeform.intensity));
                const tipX = drawX + Math.cos(sniperDeform.angle) * tipDist;
                const tipY = drawY + Math.sin(sniperDeform.angle) * tipDist;
                const sInt = Math.max(0, sniperDeform.intensity);
                
                // Fast dual-arc glow pass
                ctx.fillStyle = this.color || '#00ffff';
                ctx.globalAlpha = 0.35 * sInt;
                ctx.beginPath();
                ctx.arc(tipX, tipY, 7.5 * sInt, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 0.95 * sInt;
                ctx.beginPath();
                ctx.arc(tipX, tipY, 3.8 * sInt, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            // Specular gloss highlight (top-left) following fluid contour
            ctx.save();
            const glossX = drawX - drawR * 0.32 + Math.sin(now * 0.004) * 0.8;
            const glossY = drawY - drawR * 0.32 + Math.cos(now * 0.004) * 0.8;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.beginPath();
            ctx.ellipse(glossX, glossY, drawR * 0.28, drawR * 0.20, -Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Warlock darts blood-siphon beads orbiting close to the body
            if (this.projectileLifedrainEnabled) {
                ctx.save();
                const beadCount = 3;
                const orbitR = drawR + 5.5;
                const pulsing = now < this.lifestealPulseUntil;
                const pulseT = pulsing ? Math.max(0, 1 - (this.lifestealPulseUntil - now) / 220) : 0;
                for (let i = 0; i < beadCount; i++) {
                    const a = now * 0.0022 + (i / beadCount) * Math.PI * 2;
                    const bob = Math.sin(now * 0.003 + i * 1.9);
                    const bx = drawX + Math.cos(a) * (orbitR + bob * 0.4);
                    const by = drawY + Math.sin(a) * orbitR + bob * 0.7;
                    const br = 2.3 + (pulsing ? pulseT * 1.1 : 0);

                    // Fast translucent halo pass
                    ctx.fillStyle = pulsing ? 'rgba(255, 150, 205, 0.45)' : 'rgba(194, 37, 92, 0.35)';
                    ctx.beginPath();
                    ctx.arc(bx, by, br + (pulsing ? 3.2 : 2.0), 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = '#c2255c';
                    ctx.beginPath();
                    ctx.arc(bx, by, br, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = 'rgba(255, 150, 205, 0.9)';
                    ctx.beginPath();
                    ctx.arc(bx, by, br * 0.42, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.strokeStyle = `rgba(194, 37, 92, ${0.12 + (pulsing ? pulseT * 0.18 : 0)})`;
                    ctx.lineWidth = 0.9;
                    ctx.beginPath();
                    ctx.moveTo(bx, by);
                    ctx.lineTo(drawX + Math.cos(a) * drawR * 0.88, drawY + Math.sin(a) * drawR * 0.88);
                    ctx.stroke();

                    // Smokey wisp halo hugging the bead, like the Blast Mending ring fringe
                    ctx.strokeStyle = 'rgb(224, 74, 152)';
                    ctx.lineWidth = 1.0;
                    ctx.globalAlpha = 0.30;
                    ctx.beginPath();
                    const haloPts = 7;
                    for (let j = 0; j <= haloPts; j++) {
                        const ha = (j / haloPts) * Math.PI * 2;
                        const hnz = br * 0.6 * Math.sin(ha * 3 + now * 0.008 + i * 2.4) + br * 0.5 * Math.sin(ha * 5 + now * 0.006 + i * 1.3);
                        const hr = br * (1.7 + 0.8 * Math.sin(now * 0.007 + i * 2.1)) + hnz;
                        const hx = bx + Math.cos(ha) * hr;
                        const hy = by + Math.sin(ha) * hr;
                        if (j === 0) ctx.moveTo(hx, hy);
                        else ctx.lineTo(hx, hy);
                    }
                    ctx.closePath();
                    ctx.stroke();

                    // Smoke puff releasing off the back of the bead's orbit
                    ctx.fillStyle = 'rgb(224, 74, 152)';
                    ctx.globalAlpha = 0.16;
                    ctx.beginPath();
                    ctx.arc(bx + Math.sin(a) * br * 2.8, by - Math.cos(a) * br * 2.8, br * 0.9, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                }
                if (pulsing) {
                    ctx.globalAlpha = 0.13 * (1 - pulseT);
                    ctx.strokeStyle = '#c2255c';
                    ctx.lineWidth = 1.3;
                    ctx.beginPath();
                    ctx.arc(drawX, drawY, drawR + 11 - pulseT * 7, 0, Math.PI * 2);
                    ctx.stroke();
                }
                ctx.restore();
            }

            // Phase Dash rear charge fin
            if (this.dashEnabled) {
                const cooldownRemaining = this.dashCooldownUntil - now;
                const pct = Math.max(0, Math.min(1, cooldownRemaining / this.dashCooldown));
                const rear = facing + Math.PI;
                const ready = pct <= 0;
                const pulse = 0.5 + 0.5 * Math.sin(now * 0.012);
                const pulse2 = 0.5 + 0.5 * Math.sin(now * 0.024);
                const firePulse = 0.5 + 0.5 * Math.sin(now * 0.036 + 1.3);
                const deto = this.phaseDetonationEnabled;

                let alpha = ready ? (this.dashLvl2 ? (deto ? 0.4 + pulse2 * 0.62 : 0.5 + pulse2 * 0.46) : (0.5 + pulse * 0.4)) : (0.35 + (1 - pct) * 0.3);
                let retract = pct * 0.3;
                let tipMult = 1 + (ready ? (this.dashLvl2 ? pulse2 * (deto ? 0.44 : 0.26) : pulse * 0.18) : 0);
                if (this.dashing) {
                    alpha = 0.9;
                    retract = 0;
                    tipMult = 1.35;
                }
                const axis = rear;
                const tipDist = drawR * 0.55 * tipMult * (1 - retract);
                const hipX = drawX + Math.cos(rear) * drawR * 0.55;
                const hipY = drawY + Math.sin(rear) * drawR * 0.55;
                const ux = Math.cos(axis), uy = Math.sin(axis);
                const nx = -Math.sin(axis), ny = Math.cos(axis);
                const tipX = hipX + ux * tipDist;
                const tipY = hipY + uy * tipDist;
                const wBase = Math.max(2, drawR * 0.17);
                const c0x = hipX + nx * wBase, c0y = hipY + ny * wBase;
                const c1x = hipX - nx * wBase, c1y = hipY - ny * wBase;
                const qx = tipX + nx * (wBase * 0.5), qy = tipY + ny * (wBase * 0.5);
                const qx2 = tipX - nx * (wBase * 0.5), qy2 = tipY - ny * (wBase * 0.5);
                const finDark = shadeHex(this.color, 0.40);
                const finMid = shadeHex(this.color, 0.62);
                const finLight = shadeHex(this.color, 1.35);
                const finGlow = shadeHex(this.color, 0.55);

                ctx.save();
                if (ready) {
                    // Fast translucent glow outline
                    ctx.strokeStyle = finGlow;
                    ctx.lineWidth = 5.0;
                    ctx.globalAlpha = 0.35 * (this.dashLvl2 ? pulse2 : pulse);
                    ctx.beginPath();
                    ctx.moveTo(c0x, c0y);
                    ctx.quadraticCurveTo(qx, qy, tipX, tipY);
                    ctx.quadraticCurveTo(qx2, qy2, c1x, c1y);
                    ctx.stroke();
                }
                ctx.beginPath();
                ctx.moveTo(c0x, c0y);
                ctx.quadraticCurveTo(qx, qy, tipX, tipY);
                ctx.quadraticCurveTo(qx2, qy2, c1x, c1y);
                ctx.closePath();

                ctx.globalAlpha = alpha;
                ctx.fillStyle = this.color;
                ctx.fill();

                ctx.globalAlpha = 1;
                ctx.strokeStyle = finDark;
                ctx.lineWidth = 2.4;
                ctx.lineJoin = 'round';
                ctx.stroke();

                ctx.globalAlpha = 0.95;
                ctx.strokeStyle = finMid;
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(c0x, c0y);
                ctx.quadraticCurveTo(qx, qy, tipX, tipY);
                ctx.stroke();

                ctx.globalAlpha = 0.5;
                ctx.strokeStyle = finMid;
                ctx.lineWidth = 1.1;
                ctx.beginPath();
                ctx.moveTo(c1x, c1y);
                ctx.quadraticCurveTo(qx2, qy2, tipX, tipY);
                ctx.stroke();

                if (this.dashLvl2) {
                    const ext = ready ? (deto ? 1.3 : 0.95) : (deto ? 0.85 : 0.55);
                    const flk = firePulse;
                    const swy = Math.sin(now * 0.019);
                    const fLen = drawR * (deto ? (0.7 + flk * 0.45) : (0.42 + flk * 0.35)) * ext;
                    const fw = Math.max(1.5, wBase * (0.55 + flk * 0.4) * (deto ? 1.35 : 1));
                    const fTipX = tipX + ux * fLen;
                    const fTipY = tipY + uy * fLen;
                    const midX = tipX + ux * fLen * 0.4;
                    const midY = tipY + uy * fLen * 0.4;

                    ctx.save();
                    if (ready) {
                        // Fast flame glow pass
                        ctx.strokeStyle = '#ff7722';
                        ctx.lineWidth = 4.5;
                        ctx.globalAlpha = 0.35 * flk;
                        ctx.beginPath();
                        ctx.moveTo(tipX, tipY);
                        ctx.quadraticCurveTo(midX + nx * (fw + swy * 1.5), midY + ny * (fw + swy * 1.5), fTipX + nx * swy * 2, fTipY + ny * swy * 2);
                        ctx.quadraticCurveTo(midX - nx * (fw - swy * 1.5), midY - ny * (fw - swy * 1.5), tipX, tipY);
                        ctx.stroke();
                    }
                    ctx.globalAlpha = 0.85;
                    ctx.fillStyle = '#ff5722';
                    ctx.beginPath();
                    ctx.moveTo(tipX, tipY);
                    ctx.quadraticCurveTo(midX + nx * (fw + swy * 1.5), midY + ny * (fw + swy * 1.5), fTipX + nx * swy * 2, fTipY + ny * swy * 2);
                    ctx.quadraticCurveTo(midX - nx * (fw - swy * 1.5), midY - ny * (fw - swy * 1.5), tipX, tipY);
                    ctx.closePath();
                    ctx.fill();

                    const iLen = fLen * 0.6;
                    const iTipX = tipX + ux * iLen;
                    const iTipY = tipY + uy * iLen;
                    ctx.globalAlpha = 0.8;
                    ctx.fillStyle = '#ffaa33';
                    ctx.beginPath();
                    ctx.moveTo(tipX, tipY);
                    ctx.quadraticCurveTo(midX + nx * fw * 0.5, midY + ny * fw * 0.5, iTipX + nx * swy, iTipY + ny * swy);
                    ctx.quadraticCurveTo(midX - nx * fw * 0.5, midY - ny * fw * 0.5, tipX, tipY);
                    ctx.closePath();
                    ctx.fill();

                    ctx.globalAlpha = 0.7;
                    ctx.fillStyle = '#ffe0a0';
                    ctx.beginPath();
                    ctx.arc(tipX + ux * iLen * 0.5 + nx * swy * 0.6, tipY + uy * iLen * 0.5 + ny * swy * 0.6, Math.max(1, fw * 0.4), 0, Math.PI * 2);
                    ctx.fill();

                    if (deto) {
                        for (let si = 0; si < 3; si++) {
                            const sPh = 2.1 + si * 2.2;
                            const sLife = (now * 0.0009 + si / 3 + flk * 0.3) % 1;
                            const sDist = fLen * (0.9 + sLife * 1.25);
                            const sDrift = Math.sin(now * 0.006 + sPh) * drawR * 0.14 * sLife;
                            const sX = tipX + ux * sDist + nx * sDrift;
                            const sY = tipY + uy * sDist + ny * sDrift;
                            const sR = Math.max(1, drawR * 0.13 * (0.4 + sLife * 0.9));
                            const sA = 0.15 * (1 - sLife);
                            if (sA > 0.015) {
                                ctx.globalAlpha = sA;
                                ctx.fillStyle = '#c9d0e0';
                                ctx.beginPath();
                                ctx.arc(sX, sY, sR, 0, Math.PI * 2);
                                ctx.fill();
                            }
                        }
                    }
                    ctx.restore();
                }

                if (ready) {
                    const orbP = this.dashLvl2 ? pulse2 : pulse;
                    const orbR = 1.8 + orbP * (this.dashLvl2 ? (deto ? 2.6 : 1.7) : 1.2);
                    // Fast halo glow
                    ctx.fillStyle = finGlow;
                    ctx.globalAlpha = 0.38;
                    ctx.beginPath();
                    ctx.arc(hipX, hipY, orbR + 3.0, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.globalAlpha = 0.9;
                    ctx.fillStyle = finLight;
                    ctx.beginPath();
                    ctx.arc(hipX, hipY, orbR, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(hipX, hipY, 0.8, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            // Seeking Rocket pad: mini rocket resting on the fin flank, gripped by two phagocytosis flagellum
            if (this.rocketEnabled) {
                const pSide = (this.index % 2 === 0) ? -1 : 1;
                const pRear = facing + Math.PI;
                const pux = Math.cos(pRear), puy = Math.sin(pRear);
                const pnx = -Math.sin(pRear), pny = Math.cos(pRear);
                const fwdX = Math.cos(facing), fwdY = Math.sin(facing);
                const upX = -Math.sin(facing), upY = Math.cos(facing);
                const wBase = Math.max(2, drawR * 0.17);
                const rl = drawR * 0.52;
                const rw = drawR * 0.2;
                const mountT = drawR * 0.58;
                const lat = wBase + rw * 0.3;
                const bX = drawX + pux * mountT;
                const bY = drawY + puy * mountT;
                const padX0 = bX + pnx * lat * pSide;
                const padY0 = bY + pny * lat * pSide;

                let deploy = 1;
                let launchT = 0;
                const rAni = this.rocketAnimation;
                if (rAni) {
                    const rel = now - rAni.startTime;
                    if (rel >= 0 && rel < rAni.duration) {
                        launchT = rel / rAni.duration;
                        deploy = launchT >= 0.3 ? Math.min(1, (launchT - 0.3) / 0.7) : 0;
                    }
                }
                const popE = 1 - Math.pow(1 - deploy, 2);
                const overshoot = Math.sin(deploy * Math.PI) * 0.08 * (deploy > 0 && deploy < 1 ? 1 : 0);
                const bob = Math.sin(now * 0.01) * 0.9;
                const rockScale = (0.55 + 0.45 * popE) * (1 + overshoot);
                const rockVis = rockScale * 0.6;
                const gripR = Math.max(rw * 0.5, 6 * rockVis * 1.1);

                const rCX = drawX + (padX0 - drawX) * popE;
                const rCY = drawY + (padY0 - drawY) * popE;
                const rCXT = padX0 + fwdX * bob;
                const rCYT = padY0 + fwdY * bob;

                ctx.save();
                ctx.lineCap = 'round';
                const deployed = deploy >= 1;
                const activeX = deployed ? rCXT : rCX;
                const activeY = deployed ? rCYT : rCY;

                // two phagocytosis flagellum draped over the top of the rocket, wrapping it
                const flSpread = (1 - deploy) * drawR * 0.22;
                const tension = (deploy >= 1 ? Math.sin(now * 0.014) : 0) * drawR * 0.1;
                ctx.lineWidth = 1.8;
                const aAX = bX + pnx * pSide * (wBase * 0.4);
                const aAY = bY + pny * pSide * (wBase * 0.4);
                const lA = rl * 0.18;
                const gAX = activeX + upX * gripR + fwdX * (lA - tension);
                const gAY = activeY + upY * gripR + fwdY * (lA - tension);
                const cAX = (aAX + gAX) / 2 + upX * (gripR + drawR * 0.12 + flSpread) + fwdX * drawR * 0.06;
                const cAY = (aAY + gAY) / 2 + upY * (gripR + drawR * 0.12 + flSpread) + fwdY * drawR * 0.06;
                const aBX = drawX + fwdX * drawR * 0.4 + pnx * pSide * (drawR * 0.26 + flSpread);
                const aBY = drawY + fwdY * drawR * 0.4 + pny * pSide * (drawR * 0.26 + flSpread);
                const lB = -rl * 0.18;
                const gBX = activeX + upX * gripR + fwdX * (lB - tension);
                const gBY = activeY + upY * gripR + fwdY * (lB - tension);
                const cBX = (aBX + gBX) / 2 + upX * (gripR + drawR * 0.12 + flSpread) + fwdX * drawR * 0.02;
                const cBY = (aBY + gBY) / 2 + upY * (gripR + drawR * 0.12 + flSpread) + fwdY * drawR * 0.02;
                for (const fl of [{ aX: aAX, aY: aAY, cX: cAX, cY: cAY, gX: gAX, gY: gAY }, { aX: aBX, aY: aBY, cX: cBX, cY: cBY, gX: gBX, gY: gBY }]) {
                    ctx.globalAlpha = 0.5 + deploy * 0.4;
                    ctx.strokeStyle = shadeHex(this.color, 0.72);
                    ctx.beginPath();
                    ctx.moveTo(fl.aX, fl.aY);
                    ctx.quadraticCurveTo(fl.cX, fl.cY, fl.gX, fl.gY);
                    ctx.stroke();
                }

                // miniature replica of the actual RocketProjectile draw
                if (deploy > 0.01) {
                    ctx.globalAlpha = 0.6 + deploy * 0.35;
                    ctx.save();
                    ctx.translate(activeX, activeY);
                    ctx.rotate(Math.atan2(fwdY, fwdX));
                    ctx.scale(rockVis, rockVis);

                    ctx.fillStyle = '#cfd8dc';
                    ctx.strokeStyle = '#37474f';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.rect(-10, -3, 14, 6);
                    ctx.fill();
                    ctx.stroke();

                    ctx.fillStyle = this.color;
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
                ctx.restore();
            }

            // Draw invuln bubble shield (from dash level 2, revival/reconnect invulnerability, or dispensed aegis)
            const isDashInvuln = this.dashLvl2 && (this.dashCooldownUntil - now) > this.dashCooldown / 2;
            const isReviveInvuln = (this.invuln > 0) || (this.spawnInvuln > 0);
            const isAegisInvuln = (this.aegisUntil && now < this.aegisUntil);
            if (isDashInvuln || isReviveInvuln || isAegisInvuln) {
                ctx.save();
                // Fast dual-stroke glow
                ctx.strokeStyle = '#33ccff';
                ctx.lineWidth = 6.5;
                ctx.globalAlpha = 0.30;
                ctx.beginPath();
                ctx.arc(drawX, drawY, drawR + 6, 0, Math.PI * 2);
                ctx.stroke();
                
                ctx.lineWidth = 2.5;
                ctx.globalAlpha = 0.95;
                ctx.beginPath();
                ctx.arc(drawX, drawY, drawR + 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }

            ctx.restore();
            
            // Draw Concussive Shells slow indicator (blue pulsing ring)
            if (this.slowUntil && now < this.slowUntil) {
                ctx.save();
                const slowPulse = 0.45 + 0.35 * Math.abs(Math.sin(now / 140));
                ctx.globalAlpha = slowPulse;
                ctx.strokeStyle = '#42a5f5';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(drawX, drawY, drawR + 9, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = slowPulse * 0.4;
                ctx.fillStyle = '#1565c0';
                ctx.beginPath();
                ctx.arc(drawX, drawY, drawR + 9, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            this.drawHpBar(now, drawX, drawY, drawR);
        } else {
            this.drawDeadMarker(now);
        }
    }
    drawHpBar(now, px = this.x, py = this.y, pr = this.r) {
        let yOffset = py - pr - 9;

        // Life bar is only visible once the player is damaged
        if (this.hp < this.maxHp && this.hp > 0) {
            const bw = 30, bh = 4;
            const bx = px - bw / 2, by = yOffset;
            const hpFrac = Math.max(0, Math.min(1, this.hp / this.maxHp));

            // Dynamic color gradient: healthy vibrant green -> amber -> deep dark crimson red
            let r, g, b;
            if (hpFrac > 0.5) {
                const u = (hpFrac - 0.5) / 0.5;
                r = Math.round(235 * (1 - u) + 34 * u);
                g = Math.round(160 * (1 - u) + 215 * u);
                b = Math.round(20 * (1 - u) + 60 * u);
            } else {
                const u = hpFrac / 0.5;
                r = Math.round(150 * (1 - u) + 235 * u);
                g = Math.round(15 * (1 - u) + 160 * u);
                b = Math.round(15 * (1 - u) + 20 * u);
            }

            // Blink emergency alarm when HP is 5% or less
            const isCritical = hpFrac <= 0.05;
            const isBlinkOn = !isCritical || (Math.floor(now / 100) % 2 === 0);

            ctx.save();
            if (isCritical) {
                ctx.globalAlpha = isBlinkOn ? 1.0 : 0.20;
            }

            ctx.fillStyle = '#000';
            ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
            ctx.fillStyle = '#222';
            ctx.fillRect(bx, by, bw, bh);

            const fillColor = (isCritical && isBlinkOn) ? '#ff1122' : `rgb(${r}, ${g}, ${b})`;
            ctx.fillStyle = fillColor;
            ctx.fillRect(bx, by, Math.max(1, bw * hpFrac), bh);

            if (isCritical && isBlinkOn) {
                ctx.strokeStyle = '#ff1122';
                ctx.lineWidth = 1.0;
                ctx.strokeRect(bx - 1, by - 1, bw + 2, bh + 2);
            }

            ctx.restore();

            yOffset += bh + 3;
        }
        
        // Campervan duration indicator
        if (this.campervanUntil > now) {
            const timeRemaining = this.campervanUntil - now;
            const pct = Math.max(0, timeRemaining / 10000);
            const dbw = 30, dbh = 2.5;
            const dbx = this.x - dbw / 2, dby = yOffset;
            yOffset += dbh + 3;
            
            // Background
            ctx.fillStyle = '#000';
            ctx.fillRect(dbx - 1, dby - 1, dbw + 2, dbh + 2);
            ctx.fillStyle = '#222';
            ctx.fillRect(dbx, dby, dbw, dbh);
            
            // Bright Gold/Orange bar decaying to empty (flashes red when <3s remaining)
            ctx.fillStyle = timeRemaining < 3000 && Math.floor(now / 150) % 2 === 0 ? '#ff3300' : '#ffcc00';
            ctx.fillRect(dbx, dby, dbw * pct, dbh);
        }
    }
    drawDeadMarker(now) {
        let remaining = Math.max(0, Math.ceil(((REVIVE_MS * this.reviveTimeModifier) - (now - this.deadAt)) / 1000));
        if (GAME_STATE.activeBoss && this.deadAt >= GAME_STATE.activeBossStartTime) {
            const cfg = BOSS_CONFIGS[GAME_STATE.activeBoss];
            if (cfg) {
                const bossEnd = cfg.startMs + cfg.durationLimit;
                remaining = Math.max(1, Math.ceil((bossEnd - GAME_STATE.elapsed) / 1000));
            }
        }
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.stroke();
        // small X
        ctx.beginPath();
        ctx.moveTo(this.x - 6, this.y - 6); ctx.lineTo(this.x + 6, this.y + 6);
        ctx.moveTo(this.x + 6, this.y - 6); ctx.lineTo(this.x - 6, this.y + 6);
        ctx.stroke();
        ctx.restore();
        // revive countdown next to the dead player
        ctx.save();
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000000';
        ctx.fillText(remaining + 's', this.x + this.r + 5, this.y + 1);
        ctx.fillStyle = this.color;
        ctx.fillText(remaining + 's', this.x + this.r + 4, this.y);
        ctx.restore();
    }
}

window.Player = Player;