function aliveCentroid() {
    let sx = 0, sy = 0, n = 0;
    for (const p of GAME_STATE.players) {
        if (!p.alive) continue;
        sx += p.x; sy += p.y; n++;
    }
    if (n === 0) return { x: W / 2, y: H / 2 };
    return { x: sx / n, y: sy / n };
}

function spawnEnemy(now) {
    const c = aliveCentroid();
    // Independent rolls in escalating order; first match wins.
    let type = 'swarm';
    const e = GAME_STATE.elapsed;
    if (e >= 720000) {
        // Minute 12+: Starcraft 2 phase (no old monsters spawn, SC2 units introduced starting at Min 12)
        if (e >= 1380000) {
            // Minute 23+: Vipers join the mix (rare elite spellcaster, 0.7% chance)
            const r = Math.random();
            if (r < 0.007) type = 'viper';
            else if (r < 0.025) type = 'shield_bearer'; // 1.8%
            else if (r < 0.037) type = 'warp_anomaly'; // 1.2%
            else if (r < 0.14) type = 'hellion';
            else if (r < 0.17) type = 'medivac';
            else if (r < 0.177) type = 'sentry'; // rare support drone (0.7% chance)
            else if (r < 0.32) type = 'spine_crawler';
            else if (r < 0.50) type = 'stalker';
            else if (r < 0.72) type = 'marauder';
            else type = 'baneling';
        } else if (e >= 1320000) {
            // Minute 22–23: Shield Bearers join the mix (rare elite unit, 1.8% chance)
            const r = Math.random();
            if (r < 0.018) type = 'shield_bearer';
            else if (r < 0.030) type = 'warp_anomaly'; // very rare unit (1.2% chance)
            else if (r < 0.13) type = 'hellion';
            else if (r < 0.16) type = 'medivac';
            else if (r < 0.167) type = 'sentry'; // rare support drone (0.7% chance)
            else if (r < 0.32) type = 'spine_crawler';
            else if (r < 0.50) type = 'stalker';
            else if (r < 0.72) type = 'marauder';
            else type = 'baneling';
        } else if (e >= 1260000) {
            // Minute 21–22: Warp Anomaly enters as a rare unit (1.5% chance)
            const r = Math.random();
            if (r < 0.015) type = 'warp_anomaly';
            else if (r < 0.12) type = 'hellion';
            else if (r < 0.15) type = 'medivac';
            else if (r < 0.157) type = 'sentry'; // rare support drone (0.7% chance)
            else if (r < 0.30) type = 'spine_crawler';
            else if (r < 0.50) type = 'stalker';
            else if (r < 0.70) type = 'marauder';
            else type = 'baneling';
        } else if (e >= 1200000) {
            // Minute 20–21: Hellions join the mix
            const r = Math.random();
            if (r < 0.12) type = 'hellion';
            else if (r < 0.15) type = 'medivac';
            else if (r < 0.158) type = 'sentry'; // rare support drone (0.8% chance)
            else if (r < 0.30) type = 'spine_crawler';
            else if (r < 0.50) type = 'stalker';
            else if (r < 0.70) type = 'marauder';
            else type = 'baneling';
        } else if (e >= 1140000) {
            // Minute 19–20: Medivacs join the mix
            const r = Math.random();
            if (r < 0.03) type = 'medivac';
            else if (r < 0.038) type = 'sentry'; // rare support drone (0.8% chance)
            else if (r < 0.20) type = 'spine_crawler';
            else if (r < 0.44) type = 'stalker';
            else if (r < 0.68) type = 'marauder';
            else type = 'baneling';
        } else if (e >= 1080000) {
            // Minute 18–19: Sentries join the mix (rare support drone, 0.8% chance)
            const r = Math.random();
            if (r < 0.008) type = 'sentry';
            else if (r < 0.18) type = 'spine_crawler';
            else if (r < 0.42) type = 'stalker';
            else if (r < 0.68) type = 'marauder';
            else type = 'baneling';
        } else if (e >= 900000) {
            // Minute 15–18: Spine Crawlers join the mix (Felhound Boss runs Min 16-18)
            const r = Math.random();
            if (r < 0.15) type = 'spine_crawler';
            else if (r < 0.42) type = 'stalker';
            else if (r < 0.70) type = 'marauder';
            else type = 'baneling';
        } else if (e >= 840000) {
            // Minute 14–15: Stalkers join the mix
            const r = Math.random();
            if (r < 0.30) type = 'stalker';
            else if (r < 0.65) type = 'marauder';
            else type = 'baneling';
        } else if (e >= 780000) {
            // Minute 13–14: Marauders join the mix
            const r = Math.random();
            if (r < 0.45) type = 'marauder';
            else type = 'baneling';
        } else if (e >= 720000) {
            // Minute 12–13: Banelings ONLY
            type = 'baneling';
        }
    } else {
        if (e > 540000 && Math.random() < 0.08) type = 'spiky';         // 9 min
        else if (e > 360000 && Math.random() < 0.12) type = 'dasher';    // 6 min
        else if (e > 420000 && Math.random() < 0.12) type = 'shooter';   // 7 min
        else if (e > 300000 && Math.random() < 0.10) type = 'meteor';    // 5 min
        else if (e > 180000 && Math.random() < 0.05) type = 'brute_lord';
        else if (e > 240000 && Math.random() < 0.20) type = 'speeder';
        else if (e > 120000 && Math.random() < 0.10) type = 'mega_brute';
        else if (e > 40000 && Math.random() < 0.30) type = 'brute';
    }

    let x, y;
    if (type === 'meteor') {
        // land on-screen near the players so the blast is a real threat
        const ang = Math.random() * Math.PI * 2;
        const dist = 70 + Math.random() * 170;
        x = Math.max(50, Math.min(W - 50, c.x + Math.cos(ang) * dist));
        y = Math.max(50, Math.min(H - 50, c.y + Math.sin(ang) * dist));
    } else {
        const theta = Math.random() * Math.PI * 2;
        x = c.x + (W / 2 + 40) * Math.cos(theta);
        y = c.y + (H / 2 + 40) * Math.sin(theta);
    }
    GAME_STATE.enemies.push(new Enemy(x, y, type, now));
}

// ---------------- Standardized Boss Waves ----------------

function spawnOctopus(now) {
    const boss = new Enemy(W / 2, H / 2, 'octopus', now);
    GAME_STATE.enemies.push(boss);
}

function spawnFelhound(now) {
    const c = aliveCentroid();
    const fh = new Enemy(c.x, -40, 'felhound', now);
    GAME_STATE.enemies.push(fh);
}

function spawnBehemoth(now) {
    const c = aliveCentroid();
    const targetX = Math.max(100, Math.min(W - 100, c.x));
    const targetY = Math.max(100, Math.min(H - 100, c.y));
    const b = new Enemy(targetX, targetY, 'behemoth', now);
    GAME_STATE.enemies.push(b);
}

function spawnHordeRing(now) {
    const c = aliveCentroid();
    const count = 40;
    const radius = 350;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const x = c.x + Math.cos(angle) * radius;
        const y = c.y + Math.sin(angle) * radius;
        const e = new Enemy(x, y, 'swarm', now);
        e.eventEnemy = true;
        GAME_STATE.enemies.push(e);
    }
}

function spawnHordeWave(now, elapsedEvent) {
    const waveIdx = Math.floor((elapsedEvent - 4000) / 2000);
    let waveTypes = [];
    if (waveIdx === 0) {
        waveTypes = Array(45).fill('swarm');
    } else if (waveIdx === 1) {
        waveTypes = Array(35).fill('brute');
    } else if (waveIdx === 2) {
        waveTypes = Array(25).fill('mega_brute');
    } else if (waveIdx === 3) {
        waveTypes = Array(15).fill('brute_lord');
    } else if (waveIdx === 4) {
        waveTypes = Array(30).fill('speeder');
    } else if (waveIdx === 5) {
        waveTypes = Array(20).fill('meteor');
    } else if (waveIdx === 6) {
        waveTypes = Array(18).fill('dasher');
    } else if (waveIdx === 7) {
        waveTypes = Array(18).fill('shooter');
    } else if (waveIdx === 8) {
        waveTypes = Array(15).fill('spiky');
    } else {
        const pool = ['brute', 'speeder', 'mega_brute', 'dasher', 'shooter', 'brute_lord', 'meteor', 'spiky'];
        const mixCount = 10 + Math.min(35, (waveIdx - 9) * 4);
        for (let i = 0; i < mixCount; i++) {
            waveTypes.push(pool[Math.floor(Math.random() * pool.length)]);
        }
    }
    for (const type of waveTypes) {
        spawnFromEdge(type, now);
    }
}

function spawnFromEdge(type, now) {
    let x, y;
    if (Math.random() < 0.5) {
        x = Math.random() < 0.5 ? -30 : W + 30;
        y = Math.random() * H;
    } else {
        x = Math.random() * W;
        y = Math.random() < 0.5 ? -30 : H + 30;
    }
    const e = new Enemy(x, y, type, now);
    e.eventEnemy = true;
    GAME_STATE.enemies.push(e);
}

// ---------------- Standardized Boss Wave Configs ----------------

const BOSS_CONFIGS = {
    octopus: {
        id: 'octopus',
        name: 'The Octopus',
        startMs: 480000,    // 8:00
        durationLimit: 120000, // 10:00 force-resume
        spawn(now) {
            spawnOctopus(now);
        },
        isCleared() {
            return !GAME_STATE.enemies.some(e => e.type === 'octopus');
        },
        onDefeat(now, enemy) {
            let dropX = W / 2, dropY = H / 2;
            if (enemy) {
                dropX = enemy.x; dropY = enemy.y;
            } else {
                const bossUnit = GAME_STATE.enemies.find(e => e.type === 'octopus');
                if (bossUnit) { dropX = bossUnit.x; dropY = bossUnit.y; }
                else if (GAME_STATE.players[0]) { dropX = GAME_STATE.players[0].x; dropY = GAME_STATE.players[0].y; }
            }
            dropBossHealthPacks(dropX, dropY);
        }
    },
    horde: {
        id: 'horde',
        name: 'The Horde',
        startMs: 660000,   // 11:00
        durationLimit: 57000, // 57 seconds duration limit
        spawn(now) {
            GAME_STATE.hordeStartTime = now;
            GAME_STATE.hordeRingSpawned = true;
            GAME_STATE.hordeLastWave = now;
            spawnHordeRing(now);
        },
        update(now) {
            const elapsed = now - GAME_STATE.hordeStartTime;
            if (elapsed < 52000 && now - GAME_STATE.hordeLastWave >= 2000) {
                GAME_STATE.hordeLastWave = now;
                spawnHordeWave(now, elapsed);
            }
        },
        isCleared(now) {
            return (now - GAME_STATE.hordeStartTime) >= 57000;
        },
        onDefeat(now) {
            // Full screen mine explosion animation + wipe board of all enemies at 57 seconds
            if (typeof triggerFullBoardMineExplosion === 'function') {
                triggerFullBoardMineExplosion(now);
            }
            GAME_STATE.enemies = [];
            GAME_STATE.activeSentries = [];
            GAME_STATE.shieldBearers = [];
            GAME_STATE.attractingVipers = [];
        }
    },
    felhound: {
        id: 'felhound',
        name: 'The Felhound',
        startMs: 960000,   // 16:00
        durationLimit: 120000, // 18:00 force-resume
        spawn(now) {
            spawnFelhound(now);
        },
        isCleared() {
            return !GAME_STATE.enemies.some(e => e.type === 'felhound');
        },
        onDefeat(now, enemy) {
            let dropX = W / 2, dropY = H / 2;
            if (enemy) {
                dropX = enemy.x; dropY = enemy.y;
            } else {
                const bossUnit = GAME_STATE.enemies.find(e => e.type === 'felhound');
                if (bossUnit) { dropX = bossUnit.x; dropY = bossUnit.y; }
                else if (GAME_STATE.players[0]) { dropX = GAME_STATE.players[0].x; dropY = GAME_STATE.players[0].y; }
            }
            dropBossHealthPacks(dropX, dropY);
        }
    },
    behemoth: {
        id: 'behemoth',
        name: 'The Behemoth',
        startMs: 1440000,  // 24:00
        durationLimit: 180000, // 27:00 force-resume / final limit
        spawn(now) {
            spawnBehemoth(now);
        },
        isCleared() {
            return !GAME_STATE.enemies.some(e => e.type === 'behemoth');
        },
        onDefeat(now, enemy) {
            let dropX = W / 2, dropY = H / 2;
            if (enemy) {
                dropX = enemy.x; dropY = enemy.y;
            } else {
                const bossUnit = GAME_STATE.enemies.find(e => e.type === 'behemoth');
                if (bossUnit) { dropX = bossUnit.x; dropY = bossUnit.y; }
                else if (GAME_STATE.players[0]) { dropX = GAME_STATE.players[0].x; dropY = GAME_STATE.players[0].y; }
            }
            dropBossHealthPacks(dropX, dropY);
            if (typeof triggerFullBoardMineExplosion === 'function') {
                triggerFullBoardMineExplosion(now);
            }
            GAME_STATE.enemies = [];
            GAME_STATE.activeSentries = [];
            GAME_STATE.shieldBearers = [];
            GAME_STATE.attractingVipers = [];
            setTimeout(() => {
                if (typeof showVictory === 'function') showVictory();
            }, 1400);
        }
    }
};

function dropBossHealthPacks(x, y) {
    const totalPacks = 3 * (GAME_STATE.players ? GAME_STATE.players.length : 1);
    for (let j = 0; j < totalPacks; j++) {
        const angle = (j / totalPacks) * Math.PI * 2 + Math.random() * 0.2;
        const dist = 15 + Math.random() * 25;
        const hx = Math.max(20, Math.min(W - 20, x + Math.cos(angle) * dist));
        const hy = Math.max(20, Math.min(H - 20, y + Math.sin(angle) * dist));
        GAME_STATE.gems.push(new HealthPack(hx, hy, (typeof gameClock !== 'undefined' ? gameClock : performance.now())));
    }
}

function startBossWave(bossId, now) {
    const cfg = BOSS_CONFIGS[bossId];
    if (!cfg) return;
    GAME_STATE.activeBoss = bossId;
    GAME_STATE.activeBossStartTime = now;
    cfg.spawn(now);
}

function endBossWave(bossId, now, isCleared, enemy = null) {
    const cfg = BOSS_CONFIGS[bossId];
    if (!cfg) return;
    if (cfg.onDefeat) cfg.onDefeat(now, enemy);
    GAME_STATE.activeBoss = null;
    GAME_STATE.completedBosses.add(bossId);

    // Play supply drop sound when a boss monster is killed and when the horde wave is survived
    if (typeof SoundEngine !== 'undefined' && SoundEngine && SoundEngine.supplyDrop) {
        SoundEngine.supplyDrop();
    }

    // Automatically revive all downed players at the end of the boss wave
    for (const p of GAME_STATE.players) {
        if (!p.alive) {
            p.revive();
        }
    }

    if (bossId === 'horde') {
        // Ensure no more monsters spawn for the rest of Minute 11 (until Minute 12:00 = 720000ms)
        GAME_STATE.resumeNormalSpawnAt = 720000;
        for (const p of GAME_STATE.players) {
            p.maxHp += 300;
            p.hp = p.maxHp;
            if (typeof SoundEngine !== 'undefined' && SoundEngine && SoundEngine.heal) {
                SoundEngine.heal('medium');
            }
            // Golden pillar animation + HP pulse in HUD for each player
            if (typeof triggerReviveAnimation === 'function') {
                triggerReviveAnimation(p, now);
            }
            p.hpPulseUntil = now + 3000;
        }
    } else if (bossId === 'behemoth') {
        // Final boss wave: no monsters spawn ever after this one
        GAME_STATE.resumeNormalSpawnAt = Infinity;
    } else {
        GAME_STATE.resumeNormalSpawnAt = now + (isCleared ? 4000 : 0);
    }
}

function updateBossState(now) {
    // 1. Check if an upcoming boss should trigger 5s countdown warning pulses (4 times at 1.25s intervals)
    if (!GAME_STATE.activeBoss) {
        if (!GAME_STATE.bossWarningsFired) GAME_STATE.bossWarningsFired = new Set();
        for (const key of Object.keys(BOSS_CONFIGS)) {
            const cfg = BOSS_CONFIGS[key];
            if (!GAME_STATE.completedBosses.has(cfg.id)) {
                // 4 warning pulses: 5.00s, 3.75s, 2.50s, 1.25s before startMs
                for (let i = 0; i < 4; i++) {
                    const triggerMs = cfg.startMs - (5000 - i * 1250);
                    const warnKey = cfg.id + '_warn_' + i;
                    if (GAME_STATE.elapsed >= triggerMs && GAME_STATE.elapsed < cfg.startMs && !GAME_STATE.bossWarningsFired.has(warnKey)) {
                        GAME_STATE.bossWarningsFired.add(warnKey);
                        if (typeof SoundEngine !== 'undefined' && SoundEngine && SoundEngine.bossWarning) {
                            SoundEngine.bossWarning();
                        }
                    }
                }

                if (GAME_STATE.elapsed >= cfg.startMs) {
                    startBossWave(cfg.id, now);
                    break;
                }
            }
        }
    }

    // 2. If a boss is currently active, process updates and clear/timeout conditions
    if (GAME_STATE.activeBoss) {
        const cfg = BOSS_CONFIGS[GAME_STATE.activeBoss];
        if (cfg.update) cfg.update(now);

        const elapsedInBoss = GAME_STATE.elapsed - cfg.startMs;
        const isCleared = cfg.isCleared(now);
        const isTimedOut = elapsedInBoss >= cfg.durationLimit;

        if (isCleared || isTimedOut) {
            endBossWave(cfg.id, now, isCleared);
        }
    }
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== 'undefined') {
    window.aliveCentroid = aliveCentroid;
    window.spawnEnemy = spawnEnemy;
    window.spawnOctopus = spawnOctopus;
    window.spawnFelhound = spawnFelhound;
    window.spawnBehemoth = spawnBehemoth;
    window.spawnHordeRing = spawnHordeRing;
    window.spawnHordeWave = spawnHordeWave;
    window.spawnFromEdge = spawnFromEdge;
    window.BOSS_CONFIGS = BOSS_CONFIGS;
    window.dropBossHealthPacks = dropBossHealthPacks;
    window.startBossWave = startBossWave;
    window.endBossWave = endBossWave;
    window.updateBossState = updateBossState;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        aliveCentroid,
        spawnEnemy,
        spawnOctopus,
        spawnFelhound,
        spawnBehemoth,
        spawnHordeRing,
        spawnHordeWave,
        spawnFromEdge,
        BOSS_CONFIGS,
        dropBossHealthPacks,
        startBossWave,
        endBossWave,
        updateBossState
    };
}