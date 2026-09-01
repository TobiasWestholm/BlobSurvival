// ---------------- Testing Lab State & Logic ----------------
const selectedTestUpgrades = new Map(); // upgradeId -> stackCount
let chosenTestMinute = 0;

// Organize upgrades into tree branches
const TREE_BRANCHES = [
    {
        title: "Ranged",
        nodes: [
            { id: "unlock_missile", name: "Magic Missile", desc: "Unlock magic missiles" },
            { id: "accuracy", name: "Accurate Shot", desc: "Reduce spread to zero and make projectiles travel 50% faster" },
            { id: "instant_missile_upgrade", name: "Instant Precision", desc: "Missiles, Lasers and Cluster Shots hit instantly (also Turrets)" },
            { id: "sniper_shot_upgrade", name: "Sniper Shot", desc: `Every ${GAME_CONFIG.UPGRADES.SNIPER_SHOT_INTERVAL === 3 ? '3rd' : GAME_CONFIG.UPGRADES.SNIPER_SHOT_INTERVAL + 'th'} volley fires a piercing beam at the strongest enemy` },
            { id: "laser_sniper_upgrade", name: "Laser Sniper", desc: `Sniper Shot deals ${GAME_CONFIG.UPGRADES.LASER_SNIPER_DAMAGE_MULT}x damage and leaves a laser trail` },
            { id: "multishot", name: "Multishot", desc: "+1 Magic Missile per volley" },
            { id: "buckshot_upgrade", name: "Buckshot Volley", desc: `Spawns ${GAME_CONFIG.UPGRADES.BUCKSHOT_SHRAPNEL_COUNT} forward shrapnel on hit dealing 1/${GAME_CONFIG.UPGRADES.BUCKSHOT_SHRAPNEL_COUNT} damage` },
            { id: "cluster_shot_upgrade", name: "Cluster Shot", desc: "Magic Missile and Buckshot shrapnel explode on hit" },
            { id: "projectile_lifedrain_upgrade", name: "Warlock darts", desc: `Gain ${GAME_CONFIG.UPGRADES.PROJECTILE_LIFEDRAIN_PCT}% of projectile damage` },
            { id: "rocket_upgrade", name: "Seeking Rocket", desc: `${GAME_CONFIG.UPGRADES.ROCKET_PLAYER_CHANCE_PCT}% chance to launch homing rocket` },
            { id: "dash", name: "Phase Dash", desc: "Double tap to dash & fire missiles" },
            { id: "dash_lvl2", name: "Phase Mastery", desc: `+${GAME_CONFIG.DASH.LVL2_RANGE_BOOST_PCT}% dash range, reduce CD & gain fire trail` },
            { id: "phase_detonation_upgrade", name: "Phase Detonation", desc: "Phase Dash landing explodes and releases explosive missiles" },
        ]
    },
    {
        title: "Explosives",
        nodes: [
            { id: "unlock_mine", name: "Proximity Mine", desc: "Unlock proximity mines" },
            { id: "mine_aoe_upgrade", name: "Volatile Powder", desc: `Increase mine radius (stacks, max ${GAME_CONFIG.UPGRADES.MINE_AOE_MAX_STACKS})` },
            { id: "mine_scatter_upgrade", name: "Scatter Charges", desc: `${GAME_CONFIG.UPGRADES.MINE_SCATTER_CHANCE_PCT}% chance to drop ${GAME_CONFIG.UPGRADES.MINE_SCATTER_MIN}-${GAME_CONFIG.UPGRADES.MINE_SCATTER_MAX} extra mines` },
            { id: "mine_launcher_upgrade", name: "Mine Launcher", desc: "Throw one mine forward in addition to the normal mine" },
            { id: "explosion_heal_upgrade", name: "Blast Mending", desc: `Explosions heal players in blast radius for ${GAME_CONFIG.UPGRADES.EXPLOSION_HEAL_PCT}% of damage dealt & unlocks Magnetic Core` },
            { id: "mine_attract_upgrade", name: "Magnetic Core", desc: `${GAME_CONFIG.UPGRADES.MINE_ATTRACT_CHANCE_PCT}% of mines attract enemies` },
            { id: "mine_ring", name: "Explosive Ring", desc: "Replace the fire ring with spinning explosive charges" },
            { id: "phase_detonation_upgrade", name: "Phase Detonation", desc: "Phase Dash landing explodes and releases explosive missiles" },
            { id: "cluster_shot_upgrade", name: "Cluster Shot", desc: "Magic Missile and Buckshot shrapnel explode on hit" },
            { id: "rocket_upgrade", name: "Seeking Rocket", desc: `${GAME_CONFIG.UPGRADES.ROCKET_PLAYER_CHANCE_PCT}% chance to launch homing rocket` },
            { id: "final_blast", name: "Martyrdom", desc: "Nuclear blast upon death" },
            { id: "martyrdom_aura_upgrade", name: "Martyr's Aura", desc: "Healing/damaging/slowing aura when dead" },
            { id: "martyrs_presence_upgrade", name: "Martyr's Presence", desc: "Larger aura, knockback explosion & provokes nearby enemies" },
            { id: "sacrificial_aegis_upgrade", name: "Sacrificial Aegis", desc: `Protect allies (-${GAME_CONFIG.UPGRADES.SACRIFICIAL_AEGIS_ALLY_REDUCTION_PCT}% dmg taken, you absorb it), reduce respawn time` },
            { id: "cryo_mine_upgrade", name: "Polar Blast", desc: "Double mine freeze duration" }
        ]
    },
    {
        title: "Melee",
        nodes: [
            { id: "unlock_melee", name: "Melee Sweep", desc: "Unlock close-range sweep" },
            { id: "melee_sledge_upgrade", name: "Sledge Hammer", desc: "Heavy hammer slam in movement direction" },
            { id: "melee_chain_upgrade", name: "Scourge Flail", desc: "Heavy spiked flail dragged behind you" },
            { id: "flail_laser_upgrade", name: "Laser Flail", desc: "Scourge Flail leaves a laser trail" },
            { id: "melee_shield_upgrade", name: "Iron Carapace", desc: `Reduce all incoming damage by ${GAME_CONFIG.UPGRADES.MELEE_SHIELD_DAMAGE_REDUCTION_PCT}%` },
            { id: "melee_reflect_upgrade", name: "Barbed Carapace", desc: `Reflect ${GAME_CONFIG.UPGRADES.REFLECT_DAMAGE_PLAYER_MAX_HP_PCT}% max HP damage when hit` },
            { id: "carapace_healer_upgrade", name: "Sympathetic Shell", desc: `Grow size ${GAME_CONFIG.UPGRADES.CARAPACE_HEALER_SIZE_BOOST_PCT}%, heal all ${GAME_CONFIG.UPGRADES.CARAPACE_HEALER_TEAM_HEAL_PCT}% when hit` },
            { id: "melee_range_upgrade", name: "Extended Joints", desc: `Increase melee attack range by ${GAME_CONFIG.UPGRADES.MELEE_RANGE_BOOST_PCT}%` }
        ]
    },
    {
        title: "Turrets",
        nodes: [
            { id: "unlock_turret", name: "Auto-Turret", desc: "Unlock deployable turrets" },
            { id: "laser_walls_upgrade", name: "Laser Fences", desc: `Turret laser fences deal ${GAME_CONFIG.TURRET.LASER_WALL_DPS} damage/sec to monsters passing through, while slowing them ${GAME_CONFIG.TURRET.SLOW_WALL_SLOW_PCT}%` },
            { id: "building_duration_upgrade", name: "Fortified Structures", desc: `Increases the duration of all turrets by ${GAME_CONFIG.TURRET.FORTIFIED_DURATION_BOOST_PCT}% (stacks)` },
            { id: "turret_cooldown_upgrade", name: "Rapid Deployment", desc: `Reduces turret placement, dispenser & expansion timers by ${GAME_CONFIG.TURRET.RAPID_DEPLOYMENT_REDUCTION_PCT}% (stacks)` },
            { id: "turret_dispenser_upgrade", name: "Supply Dispenser", desc: `Turrets have ${GAME_CONFIG.TURRET.DISPENSER_CHANCE_PCT}% chance every ${GAME_CONFIG.TURRET.DISPENSER_INTERVAL_SEC}s to dispense supplies with equal probability` },
            { id: "turret_flamethrower_upgrade", name: "Flamethrower Turret", desc: `Adds 2nd head firing a ${GAME_CONFIG.TURRET.FLAME_BASE_RANGE}px ${GAME_CONFIG.TURRET.FLAME_BASE_CONE_DEG}° ${GAME_CONFIG.TURRET.FLAME_DAMAGE_MULT}x damage flame cone every ${GAME_CONFIG.TURRET.FLAME_INTERVAL_ATTACKS === 4 ? '4th' : GAME_CONFIG.TURRET.FLAME_INTERVAL_ATTACKS + 'th'} attack` },
            { id: "turret_inferno_ring_upgrade", name: "Inferno Nova", desc: `Flamethrower Turret sweeps full 360° with ${GAME_CONFIG.TURRET.FLAME_SWEEP_RANGE}px radius` },
            { id: "turret_saw_upgrade", name: "Sawblade Turrets", desc: `Turrets gain rotating sawblades dealing continuous ${GAME_CONFIG.TURRET.SAW_DPS} dmg/s to monsters within ${GAME_CONFIG.TURRET.SAW_RADIUS}px (scales with Extended Joints)` },
            { id: "turret_network_upgrade", name: "Autonomous Network", desc: `Every ${GAME_CONFIG.TURRET.NETWORK_INTERVAL_SEC}s, turrets with free links spawn a connected turret (50-300px away)` }
        ]
    },
    {
        title: "Utility & Stats",
        nodes: [
            { id: "speed", name: "Agility Boost", desc: `Increase movement speed by ${GAME_CONFIG.UPGRADES.SPEED_BOOST_PCT}%` },
            { id: "speed_lvl2", name: "Temporal Drift", desc: "Leave damaging speed laser trail" },
            { id: "ice_trail_upgrade", name: "Glacial Slide", desc: `Ice trail slows enemies, +${GAME_CONFIG.UPGRADES.ICE_TRAIL_SPEED_BOOST_PCT}% speed, fire immunity on ice` },
            { id: "unlock_ring", name: "Fire Ring", desc: "Orbiting fireballs barrier" },
            { id: "projectile_shield", name: "Deflector Orbiters", desc: `Orbiting shields block projectiles (${GAME_CONFIG.UPGRADES.DEFLECTOR_ORBITERS_RESPAWN_SEC}s respawn, scales with Attack Speed)` },
            { id: "freeze_upgrade", name: "Cryo Freeze", desc: "Freeze enemies on hit" },
            { id: "damage", name: "Heavy Impact", desc: `Increase damage by ${GAME_CONFIG.UPGRADES.DAMAGE_WEAPONS_BOOST_PCT}% (mines ${GAME_CONFIG.UPGRADES.DAMAGE_MINES_BOOST_PCT}%) (stacks)` },
            { id: "cooldown", name: "Hyper-drive", desc: `Increase attack speed (stacks, max ${GAME_CONFIG.UPGRADES.ATTACK_SPEED_MAX_STACKS})` },
            { id: "heal", name: "Second Wind", desc: "Full heal and double max HP" },
            { id: "heal_pack_upgrade", name: "Siphon Cells", desc: "Slain enemies drop health pack" },
            { id: "campervan", name: "Campervan Rampage", desc: "Campervan form when <50% HP" }
        ]
    }
];

function selectDependenciesTest(id) {
    const deps = UPGRADE_DEPENDENCIES[id];
    if (deps) {
        for (const depId of deps) {
            if (!selectedTestUpgrades.get(depId)) {
                selectedTestUpgrades.set(depId, 1);
                selectDependenciesTest(depId);
            }
        }
    }
}

function deselectChildrenTest(id) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const [selId, count] of selectedTestUpgrades.entries()) {
            const deps = UPGRADE_DEPENDENCIES[selId];
            if (deps) {
                const depMissing = deps.some(depId => !selectedTestUpgrades.get(depId));
                if (depMissing) {
                    selectedTestUpgrades.delete(selId);
                    changed = true;
                }
            }
        }
    }
}

function playTestUpgradeSound(id) {
    if (!SoundEngine) return;
    
    // 1. Specific distinct sounds that override their branch defaults
    switch (id) {
        // Laser beams & sniper shots (distinct from Magic Missile)
        case 'sniper_shot_upgrade':
        case 'laser_sniper_upgrade':
            SoundEngine.laserSniper();
            return;
            
        // Seeking Rocket
        case 'rocket_upgrade':
            SoundEngine.rocketLaunch();
            return;

        // Scourge Flail (heavy spiked ball hit)
        case 'melee_chain_upgrade':
        case 'flail_laser_upgrade':
            SoundEngine.flailHit(3.0);
            return;

        // Heavy sledge hammer (heavy blunt slam)
        case 'melee_sledge_upgrade':
            SoundEngine.meleeSweep(true);
            return;

        // Autonomous Network construction
        case 'turret_network_upgrade':
            SoundEngine.autonomousNetwork();
            return;

        // Supply Dispenser
        case 'turret_dispenser_upgrade':
            SoundEngine.supplyDrop();
            return;

        // Fire Ring soft flame hit
        case 'unlock_ring':
            SoundEngine.fireRingHit();
            return;

        // Cryo Freeze & Polar blast frost snap
        case 'freeze_upgrade':
        case 'cryo_mine_upgrade':
            SoundEngine.enemyFreeze();
            return;

        // Silent upgrades in gameplay (Walls, Turret Passives, Move Speed, Damage, Attack Speed, Carapace & Joints)
        case 'laser_walls_upgrade':
        case 'building_duration_upgrade':
        case 'turret_cooldown_upgrade':
        case 'speed':
        case 'speed_lvl2':
        case 'ice_trail_upgrade':
        case 'damage':
        case 'cooldown':
        case 'melee_range_upgrade':
        case 'melee_shield_upgrade':
        case 'melee_reflect_upgrade':
        case 'carapace_healer_upgrade':
            return;
            
        // Standard melee sweep active attack
        case 'unlock_melee':
            SoundEngine.meleeSweep(false);
            return;

        // Turret Flamethrowers
        case 'turret_flamethrower_upgrade':
        case 'turret_inferno_ring_upgrade':
            SoundEngine.flamethrower();
            return;

        // Phase dash active ability
        case 'dash':
        case 'dash_lvl2':
        case 'phase_detonation_upgrade':
            SoundEngine.phaseDash();
            return;

        // Deflector shield block
        case 'projectile_shield':
            SoundEngine.shieldBlock();
            return;

        // Nuclear detonation / Martyrdom branch
        case 'final_blast':
        case 'martyrdom_aura_upgrade':
        case 'martyrs_presence_upgrade':
        case 'sacrificial_aegis_upgrade':
            SoundEngine.nukeExplosion();
            return;

        // Campervan horn
        case 'campervan':
            SoundEngine.campervan();
            return;

        // Healing / Second wind / Health pack
        case 'heal':
        case 'heal_pack_upgrade':
            SoundEngine.heal('medium');
            return;

        // Explosives branch
        case 'mine_aoe_upgrade':
            SoundEngine.mineExplosion(1.4);
            return;
        case 'unlock_mine':
        case 'mine_attract_upgrade':
        case 'mine_scatter_upgrade':
        case 'mine_launcher_upgrade':
        case 'explosion_heal_upgrade':
        case 'mine_ring':
            SoundEngine.mineExplosion(1.0);
            return;

        // Ranged / Missiles / Turrets default
        case 'unlock_missile':
        case 'accuracy':
        case 'instant_missile_upgrade':
        case 'multishot':
        case 'buckshot_upgrade':
        case 'cluster_shot_upgrade':
        case 'projectile_lifedrain_upgrade':
        case 'unlock_turret':
            SoundEngine.missileFire();
            return;

        default:
            return;
    }
}

function selectUpgradeTest(id, event) {
    if (event && event.target.classList.contains('upgrade-node-btn')) return;
    
    const upgradeDef = UPGRADE_POOL.find(u => u.id === id);
    const isOneShot = upgradeDef ? !!upgradeDef.oneShot : (id !== 'unlock_ring' && id !== 'multishot' && id !== 'damage' && id !== 'cooldown');
    
    if (isOneShot) {
        if (selectedTestUpgrades.get(id) === 1) {
            selectedTestUpgrades.delete(id);
            deselectChildrenTest(id);
        } else {
            selectedTestUpgrades.set(id, 1);
            selectDependenciesTest(id);
            playTestUpgradeSound(id);
        }
    } else {
        const current = selectedTestUpgrades.get(id) || 0;
        if (current === 0) {
            selectedTestUpgrades.set(id, 1);
            selectDependenciesTest(id);
            playTestUpgradeSound(id);
        } else {
            selectedTestUpgrades.delete(id);
            deselectChildrenTest(id);
        }
    }
    renderUpgradeTree();
}

function adjustStackCount(id, delta, event) {
    if (event) event.stopPropagation();
    
    const upgradeDef = UPGRADE_POOL.find(u => u.id === id);
    const isOneShot = upgradeDef ? !!upgradeDef.oneShot : (id !== 'unlock_ring' && id !== 'multishot' && id !== 'damage' && id !== 'cooldown');
    if (isOneShot) return;
    
    let current = selectedTestUpgrades.get(id) || 0;
    let next = current + delta;
    
    if (next < 0) next = 0;
    if (id === 'cooldown' && next > 6) next = 6;
    if (id === 'mine_aoe_upgrade' && next > 3) next = 3;
    
    if (next === 0) {
        selectedTestUpgrades.delete(id);
        deselectChildrenTest(id);
    } else {
        selectedTestUpgrades.set(id, next);
        selectDependenciesTest(id);
        if (delta > 0) {
            playTestUpgradeSound(id);
        }
    }
    renderUpgradeTree();
}

function renderUpgradeTree() {
    const grid = document.getElementById('testingTreeGrid');
    grid.innerHTML = '';
    
    for (const branch of TREE_BRANCHES) {
        const branchCol = document.createElement('div');
        branchCol.className = 'tree-branch';
        
        const title = document.createElement('div');
        title.className = 'tree-branch-title';
        title.textContent = branch.title;
        branchCol.appendChild(title);
        
        for (const node of branch.nodes) {
            const upgradeDef = UPGRADE_POOL.find(u => u.id === node.id);
            const isOneShot = upgradeDef ? !!upgradeDef.oneShot : (node.id !== 'unlock_ring' && node.id !== 'multishot' && node.id !== 'damage' && node.id !== 'cooldown');
            const count = selectedTestUpgrades.get(node.id) || 0;
            
            const card = document.createElement('div');
            card.className = `upgrade-node ${count > 0 ? 'active' : ''}`;
            card.onclick = (e) => selectUpgradeTest(node.id, e);
            
            const nTitle = document.createElement('div');
            nTitle.className = 'upgrade-node-title';
            nTitle.textContent = node.name + (isOneShot && count > 0 ? ' ✓' : '');
            card.appendChild(nTitle);
            
            const nDesc = document.createElement('div');
            nDesc.className = 'upgrade-node-desc';
            nDesc.textContent = node.desc;
            card.appendChild(nDesc);
            
            if (!isOneShot) {
                const controls = document.createElement('div');
                controls.className = 'upgrade-node-controls';
                
                const countBadge = document.createElement('span');
                countBadge.className = 'upgrade-node-count';
                countBadge.textContent = count > 0 ? `Stacks: x${count}` : 'Not selected';
                controls.appendChild(countBadge);
                
                const btnGroup = document.createElement('div');
                btnGroup.style.display = 'flex';
                btnGroup.style.gap = '4px';
                
                const btnMinus = document.createElement('button');
                btnMinus.className = 'upgrade-node-btn';
                btnMinus.textContent = '-';
                btnMinus.onclick = (e) => adjustStackCount(node.id, -1, e);
                btnGroup.appendChild(btnMinus);
                
                const btnPlus = document.createElement('button');
                btnPlus.className = 'upgrade-node-btn';
                btnPlus.textContent = '+';
                btnPlus.onclick = (e) => adjustStackCount(node.id, 1, e);
                btnGroup.appendChild(btnPlus);
                
                controls.appendChild(btnGroup);
                card.appendChild(controls);
            }
            
            branchCol.appendChild(card);
        }
        grid.appendChild(branchCol);
    }
    
    let totalSelected = 0;
    for (const count of selectedTestUpgrades.values()) {
        totalSelected += count;
    }
    const selCountEl = document.getElementById('selectedUpgradesCount');
    if (selCountEl) selCountEl.textContent = totalSelected;
    if (typeof updateTestingLabRecommendation === 'function') {
        updateTestingLabRecommendation();
    }
}

// ---------------- Expected Level Calculation ----------------
function calculateMeanXPGemYield(xpValue) {
    if (!xpValue || xpValue <= 0) return 0;
    // Empirically sample XPGem.createXPGems directly to ensure full automatic reactivity if XPGem logic changes
    const oldGems = GAME_STATE.gems;
    let total = 0;
    const trials = 300;
    for (let t = 0; t < trials; t++) {
        const testGems = [];
        GAME_STATE.gems = testGems;
        XPGem.createXPGems(0, 0, xpValue);
        for (let i = 0; i < testGems.length; i++) total += (testGems[i].value || 0);
    }
    GAME_STATE.gems = oldGems;
    return total / trials;
}

function getSpawnProbabilitiesAtTime(e) {
    const probs = {};
    if (e >= 720000) {
        if (e >= 1380000) {
            probs.viper = 0.007; probs.shield_bearer = 0.018; probs.warp_anomaly = 0.012;
            probs.hellion = 0.111; probs.medivac = 0.03; probs.sentry = 0.007;
            probs.spine_crawler = 0.135; probs.stalker = 0.18; probs.marauder = 0.22; probs.baneling = 0.28;
        } else if (e >= 1320000) {
            probs.shield_bearer = 0.018; probs.warp_anomaly = 0.012; probs.hellion = 0.108;
            probs.medivac = 0.03; probs.sentry = 0.007; probs.spine_crawler = 0.145;
            probs.stalker = 0.18; probs.marauder = 0.22; probs.baneling = 0.28;
        } else if (e >= 1260000) {
            probs.warp_anomaly = 0.015; probs.hellion = 0.113; probs.medivac = 0.03;
            probs.sentry = 0.007; probs.spine_crawler = 0.135; probs.stalker = 0.20;
            probs.marauder = 0.20; probs.baneling = 0.30;
        } else if (e >= 1200000) {
            probs.hellion = 0.13; probs.medivac = 0.03; probs.sentry = 0.008;
            probs.spine_crawler = 0.132; probs.stalker = 0.20; probs.marauder = 0.20; probs.baneling = 0.30;
        } else if (e >= 1140000) {
            probs.medivac = 0.03; probs.sentry = 0.008; probs.spine_crawler = 0.15;
            probs.stalker = 0.252; probs.marauder = 0.24; probs.baneling = 0.32;
        } else if (e >= 1080000) {
            probs.sentry = 0.008; probs.spine_crawler = 0.16; probs.stalker = 0.252;
            probs.marauder = 0.26; probs.baneling = 0.32;
        } else if (e >= 900000) {
            probs.spine_crawler = 0.15; probs.stalker = 0.27; probs.marauder = 0.28; probs.baneling = 0.30;
        } else if (e >= 840000) {
            probs.stalker = 0.30; probs.marauder = 0.35; probs.baneling = 0.35;
        } else if (e >= 780000) {
            probs.marauder = 0.45; probs.baneling = 0.55;
        } else {
            probs.baneling = 1.0;
        }
    } else {
        let rem = 1.0;
        if (e > 540000) { probs.spiky = 0.08; rem *= (1 - 0.08); }
        if (e > 360000) { probs.dasher = rem * 0.12; rem *= (1 - 0.12); }
        if (e > 420000) { probs.shooter = rem * 0.12; rem *= (1 - 0.12); }
        if (e > 300000) { probs.meteor = rem * 0.10; rem *= (1 - 0.10); }
        if (e > 180000) { probs.brute_lord = rem * 0.05; rem *= (1 - 0.05); }
        if (e > 240000) { probs.speeder = rem * 0.20; rem *= (1 - 0.20); }
        if (e > 120000) { probs.mega_brute = rem * 0.10; rem *= (1 - 0.10); }
        if (e > 40000) { probs.brute = rem * 0.30; rem *= (1 - 0.30); }
        probs.swarm = rem;
    }
    return probs;
}

function calculateExpectedPlayerLevel(targetMinutes) {
    const targetMs = targetMinutes * 60000;
    let totalExpectedXp = 0;
    const SC2_START = 720000;
    
    // Cache mean gem yield for each unique xpValue
    const meanYieldCache = {};
    for (const key of Object.keys(MONSTER_BASE_XP)) {
        const val = MONSTER_BASE_XP[key];
        if (meanYieldCache[val] === undefined) {
            meanYieldCache[val] = calculateMeanXPGemYield(val);
        }
    }
    
    // Step through spawning schedule
    const spawnInterval = 2000;
    for (let t = spawnInterval; t <= targetMs; t += spawnInterval) {
        if (t >= 480000 && t < 540000) {
            if (t === 510000) totalExpectedXp += (meanYieldCache[MONSTER_BASE_XP.octopus] || 0);
            continue;
        }
        if (t >= 660000 && t < 717000) {
            if (t === 660000) totalExpectedXp += 40 * (meanYieldCache[MONSTER_BASE_XP.swarm] || 0);
            const elapsedEvent = t - 660000;
            const waveIdx = Math.floor((elapsedEvent - 4000) / 2000);
            if (waveIdx === 0) totalExpectedXp += 45 * (meanYieldCache[2] || 0);
            else if (waveIdx === 1) totalExpectedXp += 35 * (meanYieldCache[4] || 0);
            else if (waveIdx === 2) totalExpectedXp += 25 * (meanYieldCache[6] || 0);
            else if (waveIdx === 3) totalExpectedXp += 15 * (meanYieldCache[8] || 0);
            else if (waveIdx === 4) totalExpectedXp += 30 * (meanYieldCache[8] || 0);
            else if (waveIdx === 5) totalExpectedXp += 20 * (meanYieldCache[10] || 0);
            else if (waveIdx === 6) totalExpectedXp += 18 * (meanYieldCache[12] || 0);
            else if (waveIdx === 7) totalExpectedXp += 18 * (meanYieldCache[10] || 0);
            else if (waveIdx === 8) totalExpectedXp += 15 * (meanYieldCache[14] || 0);
            else if (waveIdx > 8) totalExpectedXp += 30 * (meanYieldCache[8] || 0);
            continue;
        }
        
        const rampElapsed = t >= SC2_START ? t - SC2_START : t;
        const count = 1 + Math.floor(rampElapsed / 30000);
        const probs = getSpawnProbabilitiesAtTime(t);
        for (const type of Object.keys(probs)) {
            const prob = probs[type];
            const xpVal = MONSTER_BASE_XP[type] || 2;
            const meanYield = meanYieldCache[xpVal] || 0;
            totalExpectedXp += count * prob * meanYield;
        }
    }
    
    let level = 1;
    let xp = totalExpectedXp;
    let nextXp = LVL2_XP;
    while (xp >= nextXp) {
        xp -= nextXp;
        level++;
        nextXp = Math.floor(nextXp * XP_EXPONENTIAL) + XP_ADD_PER_LEVEL;
    }
    return level;
}

const MINUTE_EVENT_HIGHLIGHTS = {
    0: "Game Starts (Base Swarm)",
    1: "Swarm & Brutes",
    2: "Mega Brutes Spawn",
    3: "Brute Lords Spawn",
    4: "Speeders Spawn",
    5: "Meteorites",
    6: "Dashers",
    7: "Shooters",
    8: "🐙 Boss: Octopus",
    9: "Boss or Spiky if cleared",
    10: "Spiky",
    11: "⚔️ Boss: Horde",
    12: "Banelings",
    13: "Marauders",
    14: "Stalkers",
    15: "Spine Crawlers",
    16: "Boss: Felhound",
    17: "Boss: Felhound or cleared",
    18: "Sentries",
    19: "Medivacs",
    20: "Hellions",
    21: "Warp Anomalies",
    22: "Shield Bearers",
    23: "Vipers",
    24: "🏆 Boss: Behemoth",
    25: "🏆 Boss killed"
};

let cachedExpectedLevelsTable = null;

function getExpectedLevelMinuteTable() {
    if (cachedExpectedLevelsTable) return cachedExpectedLevelsTable;
    const table = [];
    for (let m = 0; m <= 30; m += 0.1) {
        const roundedM = Math.round(m * 10) / 10;
        table.push({ m: roundedM, lvl: calculateExpectedPlayerLevel(roundedM) });
    }
    cachedExpectedLevelsTable = table;
    return table;
}

function estimateMinuteForPlayerLevel(targetLevel) {
    if (targetLevel <= 1) return 0;
    const table = getExpectedLevelMinuteTable();
    for (let i = 0; i < table.length; i++) {
        if (table[i].lvl >= targetLevel) {
            return table[i].m;
        }
    }
    return 30;
}

function updateTestingLabRecommendation() {
    let totalSelected = 0;
    for (const count of selectedTestUpgrades.values()) {
        totalSelected += count;
    }
    const selCountEl = document.getElementById('selectedUpgradesCount');
    if (selCountEl) selCountEl.textContent = totalSelected;

    const targetLevel = Math.max(1, totalSelected);
    const estMin = estimateMinuteForPlayerLevel(targetLevel);
    const estMinEl = document.getElementById('recEstMinuteValue');
    if (estMinEl) estMinEl.textContent = estMin.toFixed(1) + 'm';
}

function renderExpectedLevelsModal() {
    const summaryEl = document.getElementById('expectedLevelsSelectionSummary');
    const tbody = document.getElementById('expectedLevelsTableBody');
    if (!tbody) return;

    let totalSelected = 0;
    for (const count of selectedTestUpgrades.values()) totalSelected += count;
    const targetLevel = Math.max(1, totalSelected);
    const estMin = estimateMinuteForPlayerLevel(targetLevel);

    if (summaryEl) {
        summaryEl.innerHTML = `
            <div>
                <span style="color: #888;">Selected Upgrades:</span> <strong style="color: #00ffcc;">${totalSelected}</strong>
                <span style="color: #666; font-size: 12px; margin-left: 6px;">(incl. starting weapon)</span>
            </div>
            <div>
                <span style="color: #888;">Estimated Game Minute:</span> <strong style="color: #ffcc00; font-size: 15px;">~${estMin.toFixed(1)}m</strong>
            </div>
        `;
    }

    tbody.innerHTML = '';
    for (let m = 1; m <= 25; m++) {
        const lvl = calculateExpectedPlayerLevel(m);
        const totalUpgrades = lvl; // +1 upgrade because starting weapon is selected at Lv 1
        const highlight = MINUTE_EVENT_HIGHLIGHTS[m] || "Endless Wave Progression";
        const isCurrentMatch = (Math.abs(estMin - m) < 0.55);

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #222';
        tr.style.background = isCurrentMatch ? 'rgba(0, 255, 204, 0.12)' : (m % 2 === 0 ? '#191919' : '#141414');
        if (isCurrentMatch) {
            tr.style.borderLeft = '3px solid #00ffcc';
        }

        tr.innerHTML = `
            <td style="padding: 9px 14px; font-weight: bold; color: ${isCurrentMatch ? '#00ffcc' : '#fff'};">Min ${m}</td>
            <td style="padding: 9px 14px; color: #00ffcc; font-weight: bold;">Lv ${lvl}</td>
            <td style="padding: 9px 14px; color: #aaa;">${totalUpgrades} upgrades</td>
            <td style="padding: 9px 14px; color: ${m === 8 || m === 11 || m === 12 ? '#ffcc00' : '#888'};">${highlight}</td>
        `;
        tbody.appendChild(tr);
    }
}

// ---------------- FX Soundboard ----------------
const FX_SOUND_CATALOG = [
    { id: 'playerDeath', name: 'Player Death', category: 'CRITICAL', icon: '💀', desc: 'Sub-bass descending thud & flatline tone', fn: () => SoundEngine.playerDeath() },
    { id: 'playerRevived', name: 'Player Revived', category: 'CRITICAL', icon: '✨', desc: '4-note uplifting major chord chime', fn: () => SoundEngine.playerRevived() },
    { id: 'levelUp', name: 'Level Up', category: 'CRITICAL', icon: '⭐', desc: 'Sparkling ascending major arpeggio', fn: () => SoundEngine.levelUp() },
    { id: 'nukeExplosion', name: 'Nuclear Blast', category: 'CRITICAL', icon: '☢️', desc: 'Deep sub-bass shockwave rumble', fn: () => SoundEngine.nukeExplosion() },
    { id: 'bossWarning', name: 'Boss Pre-Wave Alarm', category: 'CRITICAL', icon: '🚨', desc: '4-pulse countdown alarm 5s before boss', fn: () => SoundEngine.bossWarning() },
    { id: 'campervan', name: 'Campervan Rampage', category: 'CRITICAL', icon: '🚐', desc: 'Retro dual-tone vehicle horn', fn: () => SoundEngine.campervan() },
    { id: 'playerDamaged', name: 'Player Damaged', category: 'HIGH', icon: '🩸', desc: 'Visceral impact thud', fn: () => SoundEngine.playerDamaged() },
    { id: 'phaseDash', name: 'Phase Dash', category: 'HIGH', icon: '💨', desc: 'ZzFX warp displacement whoosh', fn: () => SoundEngine.phaseDash() },
    { id: 'shieldBlock', name: 'Deflector Shield', category: 'HIGH', icon: '🛡️', desc: 'Resonant metallic laser block ring', fn: () => SoundEngine.shieldBlock() },
    { id: 'supplyDrop', name: 'Supply Drop', category: 'HIGH', icon: '📦', desc: 'Crisp high double-ping landing & dispenser chime', fn: () => SoundEngine.supplyDrop() },
    { id: 'medivacHeal', name: 'Medivac Heal Beam', category: 'HIGH', icon: '💉', desc: 'ZzFX soothing bio-energy restorative beam pulse', fn: () => SoundEngine.medivacHeal() },
    { id: 'behemothCleave', name: 'Titan Kaiser Cleave / Cone', category: 'HIGH', icon: '🪓', desc: 'ZzFX heavy frontal cone impact strike', fn: () => SoundEngine.behemothCleave() },
    { id: 'behemothBurrow', name: 'Behemoth Burrow', category: 'HIGH', icon: '🕳️', desc: 'Subterranean rumble dive into earth', fn: () => SoundEngine.behemothBurrow() },
    { id: 'titanSprint', name: 'Titan Sprint Launch', category: 'HIGH', icon: '🦏', desc: 'ZzFX heavy thundering trample charge launch', fn: () => SoundEngine.titanSprint() },
    { id: 'titanUnderground', name: 'Titan Subterranean Rumble', category: 'HIGH', icon: '⛏️', desc: 'ZzFX continuous subterranean seismic grinding pulse', fn: () => SoundEngine.titanUnderground() },
    { id: 'meteorFall', name: 'Meteorite Entry', category: 'HIGH', icon: '☄️', desc: 'ZzFX atmospheric reentry rush scaled to fall duration', fn: () => SoundEngine.meteorFall() },
    { id: 'dasherJump', name: 'Dasher / Jumper Leap', category: 'HIGH', icon: '🐾', desc: 'ZzFX aggressive attack jump screech & pounce', fn: () => SoundEngine.dasherJump() },
    { id: 'shooterFire', name: 'Shooter Dark Missile', category: 'HIGH', icon: '🟣', desc: 'Darker, slower resonant SFXR enemy projectile', fn: () => SoundEngine.shooterFire() },
    { id: 'tentacleLash', name: 'Octopus Tentacle Lash', category: 'HIGH', icon: '🐙', desc: 'Visceral whipping tentacle strike', fn: () => SoundEngine.tentacleLash() },
    { id: 'stalkerBlink', name: 'Stalker Blink', category: 'HIGH', icon: '⚡', desc: 'ZzFX warp teleport phase displacement', fn: () => SoundEngine.stalkerBlink() },
    { id: 'warpAnomaly', name: 'Warp Anomaly Detonation', category: 'HIGH', icon: '🌀', desc: 'ZzFX cosmic gravitational singularity pulse', fn: () => SoundEngine.warpAnomaly() },
    { id: 'viperTongue', name: 'Viper / Titan Tongue', category: 'HIGH', icon: '👅', desc: 'ZzFX fleshy abduct tongue whip launch', fn: () => SoundEngine.viperTongue() },
    { id: 'felhoundGallop', name: 'Felhound Gallop', category: 'HIGH', icon: '🐕', desc: 'ZzFX aggressive bounding beast footstep gallop', fn: () => SoundEngine.felhoundGallop() },
    { id: 'mineExplosion', name: 'Mine Explosion', category: 'MEDIUM', icon: '💣', desc: 'Low-pass shockwave noise blast', fn: () => SoundEngine.mineExplosion() },
    { id: 'meleeSweep', name: 'Melee Sweep (Blade)', category: 'MEDIUM', icon: '⚔️', desc: 'ZzFX high-speed blade whoosh', fn: () => SoundEngine.meleeSweep(false) },
    { id: 'sledgeHammer', name: 'Sledge Hammer', category: 'MEDIUM', icon: '🔨', desc: 'Lowpass resonant blunt cone slam', fn: () => SoundEngine.meleeSweep(true) },
    { id: 'flamethrower', name: 'Flamethrower', category: 'MEDIUM', icon: '🔥', desc: 'ZzFX roaring continuous flame stream', fn: () => SoundEngine.flamethrower() },
    { id: 'hellionFlame', name: 'Hellion Flame Jet', category: 'MEDIUM', icon: '🏎️', desc: 'ZzFX burst flame jet roar (adapted flamethrower)', fn: () => SoundEngine.hellionFlame() },
    { id: 'rocketLaunch', name: 'Seeking Rocket', category: 'MEDIUM', icon: '🚀', desc: 'Thruster ignition punch & exhaust sweep', fn: () => SoundEngine.rocketLaunch() },
    { id: 'flailHit', name: 'Scourge Flail Hit', category: 'MEDIUM', icon: '⛓️', desc: 'Deep visceral flesh impact & squelch', fn: () => SoundEngine.flailHit() },
    { id: 'autonomousNetwork', name: 'Autonomous Network', category: 'MEDIUM', icon: '🏗️', desc: 'Mechanical ratchet clicks & pneumatic weld tone', fn: () => SoundEngine.autonomousNetwork() },
    { id: 'missileFire', name: 'Magic Missile', category: 'MEDIUM', icon: '✨', desc: 'SFXR rapid missile launch chirp', fn: () => SoundEngine.missileFire() },
    { id: 'laserSniper', name: 'Sniper Shot', category: 'MEDIUM', icon: '🎯', desc: 'SFXR high-pitched laser chirp with long release', fn: () => SoundEngine.laserSniper() },
    { id: 'behemothMortar', name: 'Behemoth Mortar', category: 'MEDIUM', icon: '☄️', desc: 'Arcing bio-artillery mortar launch', fn: () => SoundEngine.behemothMortar() },
    { id: 'enemyFreeze', name: 'Enemy Freeze', category: 'LOW', icon: '❄️', desc: 'Crisp crystalline frost snap & shimmer', fn: () => SoundEngine.enemyFreeze() },
    { id: 'fireRingHit', name: 'Fire Ring Hit', category: 'LOW', icon: '🔥', desc: 'Soft and short flame puff on impact', fn: () => SoundEngine.fireRingHit() },
    { id: 'playerHeal', name: 'Heal / Health Pack', category: 'LOW', icon: '❤️', desc: 'Restorative bio-energy chime (low on pack, medium on Second Wind)', fn: () => SoundEngine.heal('medium') },
    { id: 'gemPickup', name: 'XP Gem Pickup', category: 'LOW', icon: '💎', desc: 'Pentatonic crystal sine bell combo', fn: () => SoundEngine.gemPickup() },
    { id: 'uiClick', name: 'UI Button Click', category: 'LOW', icon: '🖱️', desc: 'Crisp highpass mechanical click', fn: () => SoundEngine.uiClick() }
];

function renderFxSoundboard() {
    const grid = document.getElementById('fxSoundsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    FX_SOUND_CATALOG.forEach(sound => {
        const card = document.createElement('div');
        card.style.background = '#1a1a1a';
        card.style.border = '1px solid #333';
        card.style.borderRadius = '6px';
        card.style.padding = '12px';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.justifyContent = 'space-between';
        card.style.gap = '8px';
        card.style.transition = 'all 0.15s ease';
        card.style.cursor = 'pointer';

        let badgeColor = '#00ffcc';
        if (sound.category === 'CRITICAL') badgeColor = '#ff4444';
        else if (sound.category === 'HIGH') badgeColor = '#ffaa00';
        else if (sound.category === 'MEDIUM') badgeColor = '#00ffcc';
        else if (sound.category === 'LOW') badgeColor = '#888888';

        card.innerHTML = `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
                    <strong style="color: #fff; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                        <span>${sound.icon}</span> ${sound.name}
                    </strong>
                    <span style="font-size: 10px; font-weight: bold; color: ${badgeColor}; border: 1px solid ${badgeColor}; padding: 2px 6px; border-radius: 3px; font-family: monospace;">${sound.category}</span>
                </div>
                <div style="font-size: 11px; color: #888; margin-top: 6px; line-height: 1.3;">${sound.desc}</div>
            </div>
            <button class="upgrade-btn" style="margin: 0; width: 100%; background: #222; color: #ffcc00; border-color: #555; padding: 6px 10px; font-size: 12px; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <span>▶</span> Play Sound
            </button>
        `;

        const playFn = () => {
            SoundEngine.init();
            sound.fn();
            card.style.borderColor = '#ffcc00';
            card.style.boxShadow = '0 0 12px rgba(255,204,0,0.3)';
            setTimeout(() => {
                card.style.borderColor = '#333';
                card.style.boxShadow = 'none';
            }, 250);
        };

        card.onclick = (e) => {
            playFn();
        };

        grid.appendChild(card);
    });
}

function playAllFxSounds() {
    SoundEngine.init();
    FX_SOUND_CATALOG.forEach((sound, idx) => {
        setTimeout(() => {
            sound.fn();
        }, idx * 450);
    });
}

// Bind UI actions
function initTestingLabBindings() {
    const expLevelsBtn = document.getElementById('expectedLevelsBtn');
    if (expLevelsBtn) {
        expLevelsBtn.onclick = () => {
            renderExpectedLevelsModal();
            const modal = document.getElementById('expectedLevelsModal');
            if (modal) modal.classList.add('show');
        };
    }

    const closeExpLevelsBtn = document.getElementById('closeExpectedLevelsBtn');
    if (closeExpLevelsBtn) {
        closeExpLevelsBtn.onclick = () => {
            const modal = document.getElementById('expectedLevelsModal');
            if (modal) modal.classList.remove('show');
        };
    }

    const testingBtn = document.getElementById('testingBtn');
    if (testingBtn) {
        testingBtn.onclick = () => {
            if (typeof ENABLE_TESTING_LAB !== 'undefined' && !ENABLE_TESTING_LAB) return;
            testingBtn.style.display = 'none';
            const sMenu = document.getElementById('startMenu');
            if (sMenu) sMenu.classList.remove('show');
            const tModal = document.getElementById('testingModal');
            if (tModal) tModal.classList.add('show');
            renderUpgradeTree();
            updateTestingLabRecommendation();
        };
    }

    const closeTestingBtn = document.getElementById('closeTestingBtn');
    if (closeTestingBtn) {
        closeTestingBtn.onclick = () => {
            const tModal = document.getElementById('testingModal');
            if (tModal) tModal.classList.remove('show');
            if (typeof showStartMenu === 'function') showStartMenu();
        };
    }

    const resetTestingBtn = document.getElementById('resetTestingBtn');
    if (resetTestingBtn) {
        resetTestingBtn.onclick = () => {
            selectedTestUpgrades.clear();
            renderUpgradeTree();
            updateTestingLabRecommendation();
        };
    }

    const fxSoundsBtn = document.getElementById('fxSoundsBtn');
    if (fxSoundsBtn) {
        fxSoundsBtn.onclick = () => {
            renderFxSoundboard();
            const fxModal = document.getElementById('fxSoundsModal');
            if (fxModal) fxModal.classList.add('show');
        };
    }

    const closeFxSoundsBtn = document.getElementById('closeFxSoundsBtn');
    if (closeFxSoundsBtn) {
        closeFxSoundsBtn.onclick = () => {
            const fxModal = document.getElementById('fxSoundsModal');
            if (fxModal) fxModal.classList.remove('show');
        };
    }

    const playAllFxBtn = document.getElementById('playAllFxBtn');
    if (playAllFxBtn) {
        playAllFxBtn.onclick = () => {
            playAllFxSounds();
        };
    }

    const presetTestingBtn = document.getElementById('presetTestingBtn');
    if (presetTestingBtn) {
        presetTestingBtn.onclick = () => {
            selectedTestUpgrades.clear();
            selectedTestUpgrades.set('heal', 10);
            selectedTestUpgrades.set('cooldown', 6);
            selectedTestUpgrades.set('damage', 10);
            selectedTestUpgrades.set('unlock_missile', 1);
            selectedTestUpgrades.set('multishot', 2);
            selectedTestUpgrades.set('speed', 1);
            selectedTestUpgrades.set('buckshot_upgrade', 1);
            renderUpgradeTree();
            const tModal = document.getElementById('testingModal');
            if (tModal) tModal.classList.remove('show');
            const cfgModal = document.getElementById('testingConfigModal');
            if (cfgModal) cfgModal.classList.add('show');
        };
    }

    const tryUpgradesBtn = document.getElementById('tryUpgradesBtn');
    if (tryUpgradesBtn) {
        tryUpgradesBtn.onclick = () => {
            const tModal = document.getElementById('testingModal');
            if (tModal) tModal.classList.remove('show');
            const cfgModal = document.getElementById('testingConfigModal');
            if (cfgModal) cfgModal.classList.add('show');
        };
    }

    const backToTreeBtn = document.getElementById('backToTreeBtn');
    if (backToTreeBtn) {
        backToTreeBtn.onclick = () => {
            const cfgModal = document.getElementById('testingConfigModal');
            if (cfgModal) cfgModal.classList.remove('show');
            const tModal = document.getElementById('testingModal');
            if (tModal) tModal.classList.add('show');
        };
    }

    // Preset minute click handlers
    for (const btn of document.querySelectorAll('#testingConfigModal .time-preset-btn')) {
        btn.onclick = () => {
            document.querySelectorAll('#testingConfigModal .time-preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const customMin = document.getElementById('testingCustomMinute');
            if (customMin) customMin.value = btn.dataset.min;
            chosenTestMinute = parseFloat(btn.dataset.min) || 0;
        };
    }

    const customMinInput = document.getElementById('testingCustomMinute');
    if (customMinInput) {
        customMinInput.oninput = (e) => {
            document.querySelectorAll('#testingConfigModal .time-preset-btn').forEach(b => b.classList.remove('active'));
            chosenTestMinute = parseFloat(e.target.value) || 0;
        };
    }

    // Start tests when clicking difficulty
    for (const btn of document.querySelectorAll('#testingConfigModal .test-diff-btn')) {
        btn.onclick = () => {
            const cfgModal = document.getElementById('testingConfigModal');
            if (cfgModal) cfgModal.classList.remove('show');
            GAME_STATE.testingMode = true;
            GAME_STATE.testStartMinute = chosenTestMinute;
            if (typeof startGame === 'function') {
                startGame(1, btn.dataset.diff);
            }
        };
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTestingLabBindings);
    } else {
        initTestingLabBindings();
    }
}

// Global Window Exports
if (typeof window !== 'undefined') {
    window.selectedTestUpgrades = selectedTestUpgrades;
    window.TREE_BRANCHES = TREE_BRANCHES;
    window.selectDependenciesTest = selectDependenciesTest;
    window.deselectChildrenTest = deselectChildrenTest;
    window.playTestUpgradeSound = playTestUpgradeSound;
    window.selectUpgradeTest = selectUpgradeTest;
    window.adjustStackCount = adjustStackCount;
    window.renderUpgradeTree = renderUpgradeTree;
    window.calculateMeanXPGemYield = calculateMeanXPGemYield;
    window.getSpawnProbabilitiesAtTime = getSpawnProbabilitiesAtTime;
    window.calculateExpectedPlayerLevel = calculateExpectedPlayerLevel;
    window.MINUTE_EVENT_HIGHLIGHTS = MINUTE_EVENT_HIGHLIGHTS;
    window.getExpectedLevelMinuteTable = getExpectedLevelMinuteTable;
    window.estimateMinuteForPlayerLevel = estimateMinuteForPlayerLevel;
    window.updateTestingLabRecommendation = updateTestingLabRecommendation;
    window.renderExpectedLevelsModal = renderExpectedLevelsModal;
    window.FX_SOUND_CATALOG = FX_SOUND_CATALOG;
    window.renderFxSoundboard = renderFxSoundboard;
    window.playAllFxSounds = playAllFxSounds;
    window.initTestingLabBindings = initTestingLabBindings;
}