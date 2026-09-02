// Removes non-kept elements in place (no new array allocation), avoiding GC overhead
function compactAlive(arr, keepFn) {
    if (!arr) return;
    let write = 0;
    for (let read = 0; read < arr.length; read++) {
        if (keepFn(arr[read])) arr[write++] = arr[read];
    }
    arr.length = write;
}

// ---------------- State control ----------------
function startGame(playerCount, difficultyKey) {
    const n = Math.max(1, Math.min(4, playerCount));
    const diff = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
    GAME_STATE.difficulty = diff;
    GAME_STATE.siphonCellsOwner = null;
    GAME_STATE.victoryTriggered = false;

    // Reset host dimensions when starting non-client game
    if (typeof netManager === 'undefined' || !netManager.isClient) {
        GAME_STATE.hostW = null;
        GAME_STATE.hostH = null;
    }

    // Co-op base movement speed bonus: 1p = +0% (1.00), 2p = +10% (1.10), 3p = +15% (1.15), 4p = +20% (1.20), then difficulty.
    const coopSpeedBonus = n > 1 ? (1 + 0.05 * n) : 1.0;
    const speedFactor = coopSpeedBonus * diff.speedMult;
    GAME_STATE.players = [];
    for (let i = 0; i < n; i++) {
        const p = new Player(i, PLAYER_DEFS[i]);
        p.speed *= speedFactor;
        p.accuracyModifier = diff.accuracy; // Easy starts with tighter spread; Hard starts shakier
        GAME_STATE.players.push(p);
    }
    
    // Apply pre-selected upgrades in testing mode
    if (GAME_STATE.testingMode) {
        const p = GAME_STATE.players[0];
        for (const [id, count] of selectedTestUpgrades.entries()) {
            const upgrade = UPGRADE_POOL.find(u => u.id === id);
            if (upgrade) {
                for (let c = 0; c < count; c++) {
                    upgrade.effect(p);
                    if (upgrade.oneShot) {
                        p.takenOneShots.add(id);
                    }
                }
            }
        }
    }

    GAME_STATE.dmgFactor = (1.5 / (n + 0.5)) * diff.dmgMult; // co-op 1.5/(n+0.5) × difficulty damage
    GAME_STATE.enemies = [];
    GAME_STATE.activeSentries = [];
    GAME_STATE.shieldBearers = [];
    GAME_STATE.attractingVipers = [];
    GAME_STATE.projectiles = [];
    GAME_STATE.enemyProjectiles = [];
    GAME_STATE.hazards = [];
    GAME_STATE.iceTrails = [];
    GAME_STATE.terrains = [];
    GAME_STATE.turrets = [];
    GAME_STATE.gems = [];
    GAME_STATE.firstXpGem = null; // Track first gem for tutorial arrow
    GAME_STATE.xpArrowDone = false;
    GAME_STATE.particles = [];

    // Recalculate canvas and reset canvas rendering context
    if (typeof resizeCanvas === 'function') {
        resizeCanvas();
    }
    if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.init) {
        SPATIAL_GRID.init(W, H);
        SPATIAL_GRID.clear();
    }
    if (typeof ctx !== 'undefined' && ctx && typeof canvas !== 'undefined' && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (typeof SoundEngine !== 'undefined' && SoundEngine.setMuffled) {
        SoundEngine.setMuffled(false);
    }

    gameClock = GAME_STATE.testingMode ? (GAME_STATE.testStartMinute * 60000) : 0;
    GAME_STATE.elapsed = GAME_STATE.testingMode ? (GAME_STATE.testStartMinute * 60000) : 0;
    GAME_STATE.lastSpawn = gameClock;
    GAME_STATE.kills = 0;
    // Pre-resolve boss events based on start time so testing never triggers past bosses
    const testMin = GAME_STATE.testingMode ? GAME_STATE.testStartMinute : 0;
    const testMs  = testMin * 60000;

    GAME_STATE.activeBoss = null;
    GAME_STATE.activeBossStartTime = 0;
    GAME_STATE.completedBosses = new Set();
    GAME_STATE.bossWarningsFired = new Set();
    GAME_STATE.resumeNormalSpawnAt = 0;
    GAME_STATE.hordeRingSpawned = false;
    GAME_STATE.hordeLastWave = 0;
    GAME_STATE.hordeStartTime = 0;

    // In testing mode, pre-complete previous bosses and award boss completion bonuses
    if (GAME_STATE.testingMode) {
        const testMin = GAME_STATE.testStartMinute || 0;
        const testMs = testMin * 60000;
        if (testMin > 8 || (testMin >= 8 && testMin !== 7.9 && testMs > 480000)) {
            GAME_STATE.completedBosses.add('octopus');
            for (let i = 0; i < 4; i++) GAME_STATE.bossWarningsFired.add('octopus_warn_' + i);
        }
        if (testMin >= 12 || testMs >= 719000) {
            GAME_STATE.completedBosses.add('horde');
            for (let i = 0; i < 4; i++) GAME_STATE.bossWarningsFired.add('horde_warn_' + i);
            for (const p of GAME_STATE.players) {
                if (p) {
                    p.maxHp += 300;
                    p.hp = p.maxHp;
                }
            }
        }
        if (testMin > 16 || testMs > 960000) {
            GAME_STATE.completedBosses.add('felhound');
            for (let i = 0; i < 4; i++) GAME_STATE.bossWarningsFired.add('felhound_warn_' + i);
        }
        if (testMin > 24 || (testMin >= 24 && testMin !== 23.9 && testMs > 1440000)) {
            GAME_STATE.completedBosses.add('behemoth');
            for (let i = 0; i < 4; i++) GAME_STATE.bossWarningsFired.add('behemoth_warn_' + i);
        }
    }
    let startLevel = 1;
    let nextXp = LVL2_XP;
    if (GAME_STATE.testingMode && GAME_STATE.testStartMinute > 0) {
        startLevel = calculateExpectedPlayerLevel(GAME_STATE.testStartMinute);
        for (let lvl = 1; lvl < startLevel; lvl++) {
            nextXp = Math.floor(nextXp * XP_EXPONENTIAL) + XP_ADD_PER_LEVEL;
        }
    }
    GAME_STATE.level = startLevel;
    GAME_STATE.xp = 0;
    GAME_STATE.nextXp = nextXp;
    GAME_STATE.pendingLevels = 0;
    GAME_STATE.pendingPicks = 0;
    if (GAME_STATE.countdownTimer) { clearTimeout(GAME_STATE.countdownTimer); GAME_STATE.countdownTimer = null; }
    document.getElementById('testingBtn').style.display = 'none';
    document.getElementById('startMenu').classList.remove('show');
    document.getElementById('gameOverModal').classList.remove('show');
    document.getElementById('victoryModal').classList.remove('show');
    const pauseModal = document.getElementById('pauseModal');
    if (pauseModal) pauseModal.classList.remove('show');
    document.getElementById('levelUpLayer').classList.remove('show');
    document.getElementById('countdown').style.display = 'none';
    lastFrameTime = performance.now();
    
    if (GAME_STATE.testingMode) {
        startCountdown(true);
    } else {
        startWeaponSelectFlow();
    }
}

// ---------------- Main loop ----------------
let lastFrameTime = performance.now();
// Gameplay clock: only advances during GAMEPLAY, so meteor falls, shooter cooldowns,
// revive timers, weapon/projectile/hazard timing all freeze on the upgrade/countdown screens.
let gameClock = 0;

function update(dt, dtFactor, now) {
    const winCond = getGameWinCondition();
    if (winCond.type === 'boss' && isLastBossCleared(winCond)) {
        if (!GAME_STATE.victoryTriggered && GAME_STATE.current !== STATES.GAME_OVER) {
            GAME_STATE.victoryTriggered = true;
            setTimeout(() => {
                showVictory();
            }, 1400);
        }
    }

    GAME_STATE.elapsed = now;

    // Filter expired terrains
    if (GAME_STATE.terrains) {
        GAME_STATE.terrains = GAME_STATE.terrains.filter(t => !t.isExpired(now));
    }

    for (const p of GAME_STATE.players) {
        if (!p || p.disconnected || p.kicked) continue;
        if (p.alive) {
            p.update(dt, dtFactor, now);
            resolvePlayerTerrainCollisions(p);
        } else {
            const diedBeforeBoss = !GAME_STATE.activeBoss || (p.deadAt < GAME_STATE.activeBossStartTime);
            if (diedBeforeBoss && (now - p.deadAt >= REVIVE_MS * p.reviveTimeModifier)) {
                p.revive();
            }
        }
    }

    // Process Martyrdom Auras (healing and damage)
    for (const p of GAME_STATE.players) {
        if (!p || p.disconnected || p.kicked) continue;
        if (!p.alive && p.martyrdomAuraEnabled) {
            const auraRadius = 110 * (p.martyrsPresenceEnabled ? (1 + GAME_CONFIG.UPGRADES.MARTYRS_PRESENCE_RADIUS_BOOST_PCT / 100) : 1.0) * ((GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0) / 2 + 0.5);
            // 1. Heal other alive players standing in it (10% max HP per second)
            for (const op of GAME_STATE.players) {
                if (op.alive && op !== p) {
                    const dx = op.x - p.x;
                    const dy = op.y - p.y;
                    if (dx * dx + dy * dy < auraRadius * auraRadius) {
                        op.heal(p.maxHp * 0.10 * (dt / 1000));
                    }
                }
            }
            // 2. Damage enemies standing in it (10% of player max HP per second)
            const dmg = p.maxHp * 0.10 * (dt / 1000);
            for (const e of GAME_STATE.enemies) {
                if (e.hp > 0 && !e.airborne && e.x >= 0 && e.x <= W && e.y >= 0 && e.y <= H) {
                    const dx = e.x - p.x;
                    const dy = e.y - p.y;
                    if (dx * dx + dy * dy < auraRadius * auraRadius) {
                        e.hp -= dmg;
                    }
                }
            }
        }
    }

    // Standardized boss wave processing
    updateBossState(now);

    // Normal monster spawning (runs only when no boss is active, breather has passed, and not during/after the final boss)
    const isBehemothPhase = GAME_STATE.elapsed >= 1440000 || GAME_STATE.activeBoss === 'behemoth' || GAME_STATE.completedBosses.has('behemoth');
    const canSpawnNormally = !GAME_STATE.activeBoss && !isBehemothPhase && (now >= GAME_STATE.resumeNormalSpawnAt);

    if (now - GAME_STATE.lastSpawn > 2000 || GAME_STATE.enemies.length === 0) {
        if (canSpawnNormally) {
            GAME_STATE.lastSpawn = now;
            const SC2_START = 720000; // minute 12 (720,000ms) - SC2 units start
            const rampElapsed = GAME_STATE.elapsed >= SC2_START
                ? GAME_STATE.elapsed - SC2_START   // restart ramp from minute 12
                : GAME_STATE.elapsed;
            const count = 1 + Math.floor(rampElapsed / 30000); // starts at 1 (both Pre-SC2 and SC2 phase)
            for (let i = 0; i < count && GAME_STATE.enemies.length < 500; i++) spawnEnemy(now);
        }
    }

    // Snapshot enemy HP before updates (only needed when Sentries are active on map)
    if (GAME_STATE.activeSentries.length > 0) {
        for (let i = 0; i < GAME_STATE.enemies.length; i++) {
            GAME_STATE.enemies[i]._hpSnap = GAME_STATE.enemies[i].hp;
        }
    }

    // Update and resolve all active Laser Fences once per frame (O(1) enemy tag + bounding box test)
    updateLaserFences(dt, now);

    for (const e of GAME_STATE.enemies) {
        e.update(dtFactor, now);
    }
    SPATIAL_GRID.rebuild();
    for (const t of GAME_STATE.turrets) t.update(dt, dtFactor, now);
    for (const p of GAME_STATE.projectiles) p.update(dt, dtFactor, now);
    for (const ep of GAME_STATE.enemyProjectiles) ep.update(dt, dtFactor, now);
    for (const hz of GAME_STATE.hazards) hz.update(dt, now);
    for (const g of GAME_STATE.gems) g.update(dtFactor, now);
    for (const pa of GAME_STATE.particles) pa.update(dt, dtFactor);

    // Sentry shield restore: after ALL damage is applied, restore 75% of damage
    // taken by any enemy inside an alive sentry's guardian shield aura.
    if (GAME_STATE.activeSentries.length > 0) {
        for (let i = 0; i < GAME_STATE.enemies.length; i++) {
            const e = GAME_STATE.enemies[i];
            if (e.type === 'sentry') continue; // sentries don't shield each other
            const dmgTaken = (e._hpSnap || e.hp) - e.hp;
            if (dmgTaken <= 0) continue;
            const shielded = GAME_STATE.activeSentries.some(s => {
                if (s.hp <= 0) return false;
                const sdx = s.x - e.x, sdy = s.y - e.y;
                return sdx * sdx + sdy * sdy <= s.shieldRadius * s.shieldRadius;
            });
            if (shielded) {
                const scaleMult = 1 / (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0);
                e.hp += dmgTaken * (0.75 * scaleMult);
            }
        }
    }

    // Process dead enemies -> drop gems & trigger death abilities
    const hasHealPackUpgrade = GAME_STATE.players.some(p => p.alive && p.healPackEnabled);
    const healPackChance = 0.005 + 0.005 * GAME_STATE.players.length;
    let anyEnemyDied = false;

    for (let i = 0; i < GAME_STATE.enemies.length; i++) {
        const e = GAME_STATE.enemies[i];
        if (e.hp <= 0) {
            anyEnemyDied = true;
            XPGem.createXPGems(e.x, e.y, e.xpValue);
            if (hasHealPackUpgrade && Math.random() < healPackChance) {
                GAME_STATE.gems.push(new HealthPack(e.x, e.y, gameClock));
            }
            if (e.type === 'spiky') {
                e.triggerSpikeExplosion(now);
            }
            if (e.type === 'baneling') {
                e.detonateBaneling(now); // explode on death from weapon damage
            }
            if (e.type === 'warp_anomaly') {
                triggerWarpAnomalyDeathEffect(e.x, e.y, 320, now);
            }
            if (e.type === 'viper') {
                if (e.heldPlayer) {
                    if (e.heldPlayer.viperGrabber === e) {
                        e.heldPlayer.viperGrabber = null;
                    }
                    e.heldPlayer = null;
                }
            }
            if (e.type === 'spine_crawler' && !e.spawnedZerglings) {
                e.spawnedZerglings = true;
                // Burst open: release zerglings in a tight scatter scaled by difficulty
                const scaleMult = 1 / (GAME_STATE.difficulty ? (GAME_STATE.difficulty.difficultyMultiplier || 1.0) : 1.0);
                const zergCount = Math.round(7 * scaleMult);
                for (let j = 0; j < zergCount; j++) {
                    const angle = (j / zergCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
                    const dist = 25 + Math.random() * 25;
                    GAME_STATE.enemies.push(new Enemy(
                        e.x + Math.cos(angle) * dist,
                        e.y + Math.sin(angle) * dist,
                        'zergling', now
                    ));
                }
            }
            if (e.type === 'octopus' || e.type === 'boss') {
                endBossWave('octopus', now, true, e);
            } else if (e.type === 'felhound') {
                endBossWave('felhound', now, true, e);
            } else if (e.type === 'behemoth') {
                endBossWave('behemoth', now, true, e);
            }
            spawnHitParticles(e.x, e.y, e.color);
            GAME_STATE.kills++;
        }
    }
    if (anyEnemyDied) {
        GAME_STATE.enemies = GAME_STATE.enemies.filter(e => e.hp > 0 && e.alive);
        if (GAME_STATE.activeSentries.length > 0) {
            GAME_STATE.activeSentries = GAME_STATE.activeSentries.filter(e => e.hp > 0 && e.alive);
        }
        if (GAME_STATE.shieldBearers.length > 0) {
            GAME_STATE.shieldBearers = GAME_STATE.shieldBearers.filter(e => e.hp > 0 && e.alive);
        }
        if (GAME_STATE.attractingVipers.length > 0) {
            GAME_STATE.attractingVipers = GAME_STATE.attractingVipers.filter(e => e.hp > 0 && e.alive && e.viperState === 'stopped_attracting');
        }
    }
    compactAlive(GAME_STATE.projectiles, p => p.alive);
    compactAlive(GAME_STATE.enemyProjectiles, p => p.alive);
    compactAlive(GAME_STATE.hazards, h => h.alive);
    compactAlive(GAME_STATE.iceTrails, h => h.alive);
    compactAlive(GAME_STATE.magneticMines, m => m.alive);
    compactAlive(GAME_STATE.turrets, t => t.alive);
    compactAlive(GAME_STATE.gems, g => g.alive);

    compactAlive(GAME_STATE.particles, p => p.alive);
    // Cap particles to avoid drawing overhead (450 leaves room for golden pillar revive rings)
    if (GAME_STATE.particles.length > 450) {
        GAME_STATE.particles = GAME_STATE.particles.slice(-450);
    }
}

function addXp(amount) {
    GAME_STATE.xp += amount;
    let gained = 0;
    while (GAME_STATE.xp >= GAME_STATE.nextXp) {
        GAME_STATE.xp -= GAME_STATE.nextXp;
        GAME_STATE.level++;
        GAME_STATE.nextXp = Math.floor(GAME_STATE.nextXp * XP_EXPONENTIAL) + XP_ADD_PER_LEVEL;
        gained++;
    }
    if (gained > 0) {
        SoundEngine.levelUp();
        GAME_STATE.pendingLevels += gained;
        startLevelUpFlow();
    }
}

function getGameWinCondition() {
    let lastMonsterTime = 0;
    for (const m of PROGRESSION.monsterIntroductions) {
        if (m.time > lastMonsterTime) lastMonsterTime = m.time;
    }
    const monsterEndTime = lastMonsterTime + 120000; // 2 minutes after introduction

    let lastBossEvent = null;
    for (const b of PROGRESSION.bossEvents) {
        if (!lastBossEvent || b.start > lastBossEvent.start) {
            lastBossEvent = b;
        }
    }

    if (lastBossEvent && lastBossEvent.start >= lastMonsterTime) {
        return {
            type: 'boss',
            event: lastBossEvent,
            timeLimit: lastBossEvent.start + lastBossEvent.durationLimit
        };
    } else {
        return {
            type: 'time',
            timeLimit: monsterEndTime
        };
    }
}

function isLastBossCleared(winCond) {
    if (!winCond || winCond.type !== 'boss') return false;
    return GAME_STATE.completedBosses.has(winCond.event.type);
}

function loop(now) {
    const dt = Math.min(50, now - lastFrameTime);
    lastFrameTime = now;
    const dtFactor = dt / (1000 / 120); // 1.0 at 120 Hz (8.333ms per frame)

    // Track frame rate (FPS)
    if (!GAME_STATE.fpsLastUpdate) {
        GAME_STATE.fpsLastUpdate = now;
        GAME_STATE.fpsFrameCount = 0;
        GAME_STATE.currentFps = 60;
    }
    GAME_STATE.fpsFrameCount++;
    if (now - GAME_STATE.fpsLastUpdate >= 250) {
        GAME_STATE.currentFps = Math.round((GAME_STATE.fpsFrameCount * 1000) / (now - GAME_STATE.fpsLastUpdate));
        GAME_STATE.fpsFrameCount = 0;
        GAME_STATE.fpsLastUpdate = now;
    }

    if (GAME_STATE.current === STATES.GAMEPLAY) {
        gameClock += dt; // only the gameplay clock advances; frozen while paused
        SoundEngine.updateMusic(now);

        if (netManager.isClient) {
            // CLIENT-SIDE:
            // 1. Send local inputs to host at 60 FPS
            sendClientLocalInput();
            
            // 2. Predictively update client's own player movement for 0-latency feel
            const myPlayer = GAME_STATE.players[netManager.localPlayerIndex];
            if (myPlayer && myPlayer.alive) {
                myPlayer.update(dt, dtFactor, gameClock);
                resolvePlayerTerrainCollisions(myPlayer);
            }

            // Smoothly extrapolate & interpolate remote entities towards latest snapshot target positions (smooth 60fps)
            const lerpRate = Math.min(1.0, 0.35 * dtFactor);
            for (let i = 0; i < GAME_STATE.players.length; i++) {
                if (i !== netManager.localPlayerIndex) {
                    const rp = GAME_STATE.players[i];
                    if (rp && rp.targetX !== undefined) {
                        rp.x += (rp.targetX - rp.x) * lerpRate;
                        rp.y += (rp.targetY - rp.y) * lerpRate;
                    }
                }
            }
            for (const e of GAME_STATE.enemies) {
                if (e && e.targetX !== undefined) {
                    e.x += (e.targetX - e.x) * lerpRate;
                    e.y += (e.targetY - e.y) * lerpRate;
                }
            }

            // 3. Smoothly advance projectiles & enemy projectiles at 60 FPS between snapshots
            for (const p of GAME_STATE.projectiles) {
                if (!p || !p.alive) continue;
                if (p.type === 'fire_ring' || p.type === 'deflector_shield') {
                    p.angle = (p.angle || 0) + 0.06 * dtFactor;
                } else if (p.vx !== undefined && p.vy !== undefined) {
                    p.x += p.vx * dtFactor;
                    p.y += p.vy * dtFactor;
                }
            }
            for (const ep of GAME_STATE.enemyProjectiles) {
                if (ep && ep.alive && ep.vx !== undefined && ep.vy !== undefined) {
                    ep.x += ep.vx * dtFactor;
                    ep.y += ep.vy * dtFactor;
                }
            }
            
            // 4. Update local client particles
            for (const pa of GAME_STATE.particles) pa.update(dt, dtFactor);
            
            // 5. Render authoritative world snapshot from host
            draw(gameClock);

            // Throttle UI DOM updates to 10Hz (every 6 frames) to prevent layout thrashing
            GAME_STATE.uiTick = (GAME_STATE.uiTick || 0) + 1;
            if (GAME_STATE.uiTick % 6 === 0) {
                updateUI();
            }
        } else {
            // HOST / SINGLEPLAYER / LOCAL: Authoritative simulation
            update(dt, dtFactor, gameClock);
            draw(gameClock);
            
            // 30 Hz authoritative sync broadcast to clients (every 2nd frame at 60fps = 33ms) for ultra-smooth 60fps client display
            GAME_STATE.netTick = (GAME_STATE.netTick || 0) + 1;
            if (netManager.isHost && netManager.connections.size > 0 && GAME_STATE.netTick % 2 === 0) {
                netManager.broadcastWorldSnapshot(serializeWorldForNetwork());
            }

            // Throttle UI DOM layout reflow updates to 10Hz (every 6 frames)
            GAME_STATE.uiTick = (GAME_STATE.uiTick || 0) + 1;
            if (GAME_STATE.uiTick % 6 === 0) {
                updateUI();
            }
        }
    } else if (GAME_STATE.current === STATES.WEAPON_SELECT) {
        // Pre-game Starting Weapon selection lobby: update blobs so players can freely move around!
        updateLobbyPlayers(dt, dtFactor, now);
        SoundEngine.updateMusic(now);
        draw(gameClock);
        updateUI();
    } else if (GAME_STATE.current === STATES.LEVEL_UP || GAME_STATE.current === STATES.COUNTDOWN || GAME_STATE.current === STATES.PAUSED) {
        SoundEngine.updateMusic(now);
        draw(gameClock);
        updateUI();
    } else if (GAME_STATE.current === STATES.START_MENU) {
        SoundEngine.updateMusic(now);
    } else if (GAME_STATE.current === STATES.GAME_OVER) {
        SoundEngine.updateMusic(now);
        draw(gameClock);
    }
    requestAnimationFrame(loop);
}

function updateLobbyPlayers(dt, dtFactor, now) {
    if (netManager.isClient) {
        sendClientLocalInput();
        const myIndex = netManager.localPlayerIndex;
        const myPlayer = GAME_STATE.players[myIndex];
        if (myPlayer) {
            myPlayer.update(dt, dtFactor, now);
        }
    } else {
        // Host & Local players
        for (const p of GAME_STATE.players) {
            p.update(dt, dtFactor, now);
        }
        if (netManager.isHost && netManager.connections.size > 0 && typeof serializeWorldForNetwork === 'function') {
            netManager.broadcastWorldSnapshot(serializeWorldForNetwork());
        }
    }
}

if (typeof window !== 'undefined') {
    window.startGame = startGame;
    window.update = update;
    window.loop = loop;
    window.updateLobbyPlayers = updateLobbyPlayers;
    window.getGameWinCondition = getGameWinCondition;
    window.isLastBossCleared = isLastBossCleared;
    window.compactAlive = compactAlive;

    // Start main game loop on document load
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => {
            requestAnimationFrame(loop);
        });
    } else {
        requestAnimationFrame(loop);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        startGame,
        update,
        loop,
        updateLobbyPlayers,
        getGameWinCondition,
        isLastBossCleared,
        compactAlive
    };
}