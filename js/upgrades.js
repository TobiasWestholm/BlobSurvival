const UPGRADE_POOL = [
    { id: 'speed', name: 'Agility Boost', desc: `Increase movement speed by ${GAME_CONFIG.UPGRADES.SPEED_BOOST_PCT}%.`, oneShot: true, effect: (p) => { p.speed *= (1 + GAME_CONFIG.UPGRADES.SPEED_BOOST_PCT / 100); p.agilityBoostEnabled = true; } },
    { id: 'speed_lvl2', name: 'Temporal Drift', desc: `Increase movement speed by another ${GAME_CONFIG.UPGRADES.SPEED_LVL2_BOOST_PCT}% and leave a damaging laser trail behind you.`, oneShot: true, effect: (p) => { p.speed *= (1 + GAME_CONFIG.UPGRADES.SPEED_LVL2_BOOST_PCT / 100); p.speedLvl2 = true; } },
    { id: 'damage', name: 'Heavy Impact', desc: `Increase all weapon damage by ${GAME_CONFIG.UPGRADES.DAMAGE_WEAPONS_BOOST_PCT}%, and proximity mines by ${GAME_CONFIG.UPGRADES.DAMAGE_MINES_BOOST_PCT}%.`, effect: (p) => { p.damageModifier *= (1 + GAME_CONFIG.UPGRADES.DAMAGE_WEAPONS_BOOST_PCT / 100); p.mineDamageModifier *= (1 + GAME_CONFIG.UPGRADES.DAMAGE_MINES_BOOST_PCT / 100); p.damageUpgradeCount = (p.damageUpgradeCount || 0) + 1; } },
    { id: 'cooldown', name: 'Hyper-drive', desc: `Increase attack speed by ${GAME_CONFIG.UPGRADES.ATTACK_SPEED_BOOST_PCT}%, and proximity mines by ${GAME_CONFIG.UPGRADES.MINE_COOLDOWN_BOOST_PCT}%.`, effect: (p) => { p.cooldownModifier /= (1 + GAME_CONFIG.UPGRADES.ATTACK_SPEED_BOOST_PCT / 100); p.mineCooldownModifier /= (1 + GAME_CONFIG.UPGRADES.MINE_COOLDOWN_BOOST_PCT / 100); p.attackSpeedCount = (p.attackSpeedCount || 0) + 1; } },
    { id: 'accuracy', name: 'Accurate Shot', desc: 'Reduce projectile spread to zero and increase projectile travel speed by 50%.', oneShot: true, effect: (p) => p.accuracyModifier = 0 },
    { id: 'instant_missile_upgrade', name: 'Instant Precision', desc: 'Magic Missile, Laser, and Cluster Shot travel with infinite velocity, hitting monsters instantly without a traveling projectile.', oneShot: true, effect: (p) => p.instantMissileEnabled = true },
    { id: 'sniper_shot_upgrade', name: 'Sniper Shot', desc: `Every ${GAME_CONFIG.UPGRADES.SNIPER_SHOT_INTERVAL === 3 ? '3rd' : GAME_CONFIG.UPGRADES.SNIPER_SHOT_INTERVAL + 'th'} Magic Missile volley fires a high-speed piercing sniper shot at the strongest enemy, dealing ${GAME_CONFIG.UPGRADES.SNIPER_SHOT_DAMAGE_MULT}x damage.`, oneShot: true, effect: (p) => p.sniperShotEnabled = true },
    { id: 'laser_sniper_upgrade', name: 'Laser Sniper', desc: `Increases Sniper Shot damage to ${GAME_CONFIG.UPGRADES.LASER_SNIPER_DAMAGE_MULT}x Magic Missile and leaves a decaying laser trail along its path.`, oneShot: true, effect: (p) => p.laserSniperEnabled = true },
    { id: 'multishot', name: 'Split Shot', desc: 'Magic Missile fires at one additional enemy.', effect: (p) => p.multiShot += 1 },
    { id: 'dash', name: 'Phase Dash', desc: 'Double-tap a move key to dash, then burst missiles around you.', oneShot: true, effect: (p) => p.dashEnabled = true },
    { id: 'dash_lvl2', name: 'Phase Mastery', desc: `Increases Phase Dash range by ${GAME_CONFIG.DASH.LVL2_RANGE_BOOST_PCT}%, recharge speed by ${((GAME_CONFIG.DASH.LVL2_COOLDOWN_DIVISOR - 1) * 100)}%, leaves a burning fire trail when dashing, and grants invulnerability and a shield during the first half of recharge.`, oneShot: true, effect: (p) => { p.dashLvl2 = true; p.dashCooldown = PLAYER_DASH_COOLDOWN / GAME_CONFIG.DASH.LVL2_COOLDOWN_DIVISOR; } },
    { id: 'phase_detonation_upgrade', name: 'Phase Detonation', desc: 'Phase Dash landing triggers a full mine explosion and releases explosive magic missiles.', oneShot: true, effect: (p) => p.phaseDetonationEnabled = true },
    { id: 'unlock_ring', name: 'Fire Ring', desc: 'Unlock orbiting fire balls around you.', oneShot: true, effect: (p) => p.unlockWeapon('fire_ring') },
    { id: 'unlock_missile', name: 'Magic Missile', desc: 'Unlock the auto-firing Magic Missile weapon.', oneShot: true, effect: (p) => p.unlockWeapon('magic_missile') },
    { id: 'unlock_melee', name: 'Melee Sweep', desc: 'Unlock the close-range melee sweeping attack.', oneShot: true, effect: (p) => p.unlockWeapon('melee_sweep') },
    { id: 'unlock_mine', name: 'Proximity Mine', desc: 'Unlock proximity mines that explode for AoE damage.', oneShot: true, effect: (p) => p.unlockWeapon('proximity_mine') },
    { id: 'unlock_turret', name: 'Auto-Turret', desc: `Unlock deployable turrets that drop every ${GAME_CONFIG.TURRET.PLACEMENT_INTERVAL_SEC}s and shoot high-speed missiles for ${GAME_CONFIG.TURRET.LIFETIME_SEC}s.`, oneShot: true, effect: (p) => p.unlockWeapon('turret') },
    { id: 'laser_walls_upgrade', name: 'Laser Fences', desc: `Turrets create high-energy laser barriers between them that deal ${GAME_CONFIG.TURRET.LASER_WALL_DPS} damage/sec to monsters passing through, while slowing them by ${GAME_CONFIG.TURRET.SLOW_WALL_SLOW_PCT}%.`, oneShot: true, effect: (p) => { p.laserWallsEnabled = true; p.slowWallsEnabled = true; for (const t of GAME_STATE.turrets) { if (t.alive && t.player === p) t.linkWalls(); } } },
    { id: 'building_duration_upgrade', name: 'Fortified Structures', desc: `Increases the duration of turrets by ${GAME_CONFIG.TURRET.FORTIFIED_DURATION_BOOST_PCT}% and turret HP by ${GAME_CONFIG.TURRET.FORTIFIED_HP_BOOST_PCT}%.`, effect: (p) => { p.buildingDurationModifier *= (1 + GAME_CONFIG.TURRET.FORTIFIED_DURATION_BOOST_PCT / 100); p.buildingHealthModifier *= (1 + GAME_CONFIG.TURRET.FORTIFIED_HP_BOOST_PCT / 100); p.buildingDurationCount = (p.buildingDurationCount || 0) + 1; } },
    { id: 'turret_cooldown_upgrade', name: 'Rapid Deployment', desc: `Reduces turret placement, dispenser, and Autonomous Network expansion timers by ${GAME_CONFIG.TURRET.RAPID_DEPLOYMENT_REDUCTION_PCT}%.`, effect: (p) => { p.buildingCooldownModifier = (p.buildingCooldownModifier || 1.0) * (1 - GAME_CONFIG.TURRET.RAPID_DEPLOYMENT_REDUCTION_PCT / 100); p.turretCooldownCount = (p.turretCooldownCount || 0) + 1; } },
    { id: 'turret_flamethrower_upgrade', name: 'Flamethrower Turret', desc: `Adds a 2nd firing head to turrets that unleashes a ${GAME_CONFIG.TURRET.FLAME_BASE_RANGE}px ${GAME_CONFIG.TURRET.FLAME_BASE_CONE_DEG}° flame cone every ${GAME_CONFIG.TURRET.FLAME_INTERVAL_ATTACKS === 4 ? '4th' : GAME_CONFIG.TURRET.FLAME_INTERVAL_ATTACKS + 'th'} attack for ${GAME_CONFIG.TURRET.FLAME_DAMAGE_MULT}x damage.`, oneShot: true, effect: (p) => p.turretFlamethrowerEnabled = true },
    { id: 'turret_inferno_ring_upgrade', name: 'Inferno Nova', desc: `Flamethrower Turret sweeps a full 360° rotation around the turret and extends attack radius to ${GAME_CONFIG.TURRET.FLAME_SWEEP_RANGE}px.`, oneShot: true, effect: (p) => p.turretFullSweepEnabled = true },
    { id: 'turret_network_upgrade', name: 'Autonomous Network', desc: `Every ${GAME_CONFIG.TURRET.NETWORK_INTERVAL_SEC}s, turrets with free links spawn a new connected turret pointing away from existing links.`, oneShot: true, effect: (p) => p.turretNetworkEnabled = true },
    { id: 'turret_saw_upgrade', name: 'Sawblade Turrets', desc: `Equips turrets with rotating sawblades dealing continuous ${GAME_CONFIG.TURRET.SAW_DPS} damage/sec to all nearby monsters within ${GAME_CONFIG.TURRET.SAW_RADIUS}px.`, oneShot: true, effect: (p) => p.turretSawEnabled = true },
    { id: 'turret_dispenser_upgrade', name: 'Supply Dispenser', desc: `Each active turret has a ${GAME_CONFIG.TURRET.DISPENSER_CHANCE_PCT}% chance every ${GAME_CONFIG.TURRET.DISPENSER_INTERVAL_SEC}s to dispense power-up items.`, oneShot: true, effect: (p) => p.turretDispenserEnabled = true },
    { id: 'mine_aoe_upgrade', name: 'Volatile Powder', desc: `Increase proximity mine explosion radius by ${GAME_CONFIG.UPGRADES.MINE_AOE_BOOST_PCT}% and Martyrdom blast radius by ${GAME_CONFIG.UPGRADES.MARTYRDOM_AOE_BOOST_PCT}%.`, effect: (p) => { p.mineAoeModifier *= (1 + GAME_CONFIG.UPGRADES.MINE_AOE_BOOST_PCT / 100); p.mineAoeCount = (p.mineAoeCount || 0) + 1; } },
    { id: 'mine_attract_upgrade', name: 'Magnetic Core', desc: `${GAME_CONFIG.UPGRADES.MINE_ATTRACT_CHANCE_PCT}% of proximity mines attract enemies for ${GAME_CONFIG.UPGRADES.MINE_ATTRACT_DURATION_SEC}s before exploding.`, oneShot: true, effect: (p) => p.mineAttractEnabled = true },
    { id: 'freeze_upgrade', name: 'Cryo Freeze', desc: `Magic Missiles and Scourge Flail freeze enemies for ${GAME_CONFIG.UPGRADES.FREEZE_PROJECTILE_DURATION_SEC}s, and mines freeze for ${GAME_CONFIG.UPGRADES.FREEZE_MINE_DURATION_SEC}s.`, oneShot: true, effect: (p) => p.freezeEnabled = true },
    { id: 'cryo_mine_upgrade', name: 'Polar Blast', desc: `Increase Proximity Mine and Scourge Flail freeze duration by ${GAME_CONFIG.UPGRADES.CRYO_MINE_BOOST_PCT}%.`, oneShot: true, effect: (p) => p.cryoMineBuffed = true },
    { id: 'mine_scatter_upgrade', name: 'Scatter Charges', desc: `${GAME_CONFIG.UPGRADES.MINE_SCATTER_CHANCE_PCT}% chance when dropping a mine to scatter ${GAME_CONFIG.UPGRADES.MINE_SCATTER_MIN}-${GAME_CONFIG.UPGRADES.MINE_SCATTER_MAX} extra mines in random directions around you.`, oneShot: true, effect: (p) => p.scatterMinesEnabled = true },
    { id: 'mine_launcher_upgrade', name: 'Mine Launcher', desc: 'Throw one mine forward in addition to the normal mine.', oneShot: true, effect: (p) => p.mineThrowEnabled = true },
    { id: 'explosion_heal_upgrade', name: 'Blast Mending', desc: `Explosions caused by you heal all players inside their blast radius equal to ${GAME_CONFIG.UPGRADES.EXPLOSION_HEAL_PCT}% of total damage dealt, and unlocks the Magnetic Core upgrade.`, oneShot: true, effect: (p) => p.explosionHealEnabled = true },
    { id: 'mine_ring', name: 'Explosive Ring', desc: 'Replace the fire ring with spinning explosive charges.', oneShot: true, effect: (p) => p.mineRingEnabled = true },
    { id: 'heal_pack_upgrade', name: 'Siphon Cells', desc: `Slaying monsters has a chance to drop a health pack that heals ${GAME_CONFIG.UPGRADES.SIPHON_CELLS_HEAL_HP} HP.`, oneShot: true, effect: (p) => { p.healPackEnabled = true; GAME_STATE.siphonCellsOwner = p; } },
    { id: 'melee_sledge_upgrade', name: 'Sledge Hammer', desc: `Melee attacks trigger a heavy forward cone slam in your movement direction, dealing ${GAME_CONFIG.UPGRADES.MELEE_SLEDGE_DAMAGE_PCT}% damage.`, oneShot: true, effect: (p) => p.sledgeEnabled = true },
    { id: 'melee_chain_upgrade', name: 'Scourge Flail', desc: 'Unlock a heavy melee spiked flail dragged behind you that swings with your movement.', oneShot: true, effect: (p) => p.unlockWeapon('player_flail') },
    { id: 'flail_laser_upgrade', name: 'Laser Flail', desc: 'The Scourge Flail leaves a thin damaging laser trail along its motion path.', oneShot: true, effect: (p) => p.flailLaserEnabled = true },
    { id: 'melee_shield_upgrade', name: 'Iron Carapace', desc: `Reduce all incoming damage to you and your turrets by ${GAME_CONFIG.UPGRADES.MELEE_SHIELD_DAMAGE_REDUCTION_PCT}%.`, oneShot: true, effect: (p) => p.damageReduction = (1 - GAME_CONFIG.UPGRADES.MELEE_SHIELD_DAMAGE_REDUCTION_PCT / 100) },
    { id: 'melee_reflect_upgrade', name: 'Barbed Carapace', desc: `Deals ${GAME_CONFIG.UPGRADES.REFLECT_DAMAGE_PLAYER_MAX_HP_PCT}% of your Max HP back as damage to any monster that damages you, and turrets reflect ${GAME_CONFIG.UPGRADES.REFLECT_DAMAGE_TURRET_MAX_HP_PCT}% max HP.`, oneShot: true, effect: (p) => p.reflectDamageEnabled = true },
    { id: 'melee_range_upgrade', name: 'Extended Joints', desc: `Increase the range of all melee attacks by ${GAME_CONFIG.UPGRADES.MELEE_RANGE_BOOST_PCT}%.`, oneShot: true, effect: (p) => p.meleeRangeModifier = (1 + GAME_CONFIG.UPGRADES.MELEE_RANGE_BOOST_PCT / 100) },
    { id: 'rocket_upgrade', name: 'Seeking Rocket', desc: `${GAME_CONFIG.UPGRADES.ROCKET_PLAYER_CHANCE_PCT}% chance when firing magic missiles to launch a homing rocket that deals AoE damage.`, oneShot: true, effect: (p) => p.rocketEnabled = true },
    { id: 'buckshot_upgrade', name: 'Buckshot Volley', desc: `Magic missiles spawn ${GAME_CONFIG.UPGRADES.BUCKSHOT_SHRAPNEL_COUNT} smaller forward-spreading shrapnel projectiles upon hit, dealing 1/${GAME_CONFIG.UPGRADES.BUCKSHOT_SHRAPNEL_COUNT} damage.`, oneShot: true, effect: (p) => p.buckshotEnabled = true },
    { id: 'cluster_shot_upgrade', name: 'Cluster Shot', desc: 'Magic Missile and Buckshot shrapnel are replaced by explosive projectiles scaling with mine damage and AoE.', oneShot: true, effect: (p) => p.clusterShotEnabled = true },
    { id: 'projectile_lifedrain_upgrade', name: 'Warlock darts', desc: `Gain health equal to ${GAME_CONFIG.UPGRADES.PROJECTILE_LIFEDRAIN_PCT}% of the damage you deal with projectiles fired by you.`, oneShot: true, effect: (p) => p.projectileLifedrainEnabled = true },
    { id: 'campervan', name: 'Campervan Rampage', desc: `Transform into an invulnerable campervan for ${GAME_CONFIG.UPGRADES.CAMPERVAN_DURATION_SEC} seconds that crushes everything in its path.`, oneShot: true, effect: (p) => { p.campervanUntil = gameClock + GAME_CONFIG.UPGRADES.CAMPERVAN_DURATION_SEC * 1000; if (GAME_STATE.current === STATES.GAMEPLAY) { SoundEngine.campervan(); } else { p.campervanSoundPending = true; } } },
    { id: 'final_blast', name: 'Martyrdom', desc: 'Explode in a nuclear blast upon death, and permanently halve your respawn time.', oneShot: true, effect: (p) => { p.finalBlastEnabled = true; p.reviveTimeModifier = 0.5; } },
    { id: 'projectile_shield', name: 'Deflector Orbiters', desc: `Unlock an orbiting barrier of ${GAME_CONFIG.UPGRADES.DEFLECTOR_ORBITERS_COUNT} shields that block enemy projectiles. Absorbing a projectile destroys the shield, respawning after ${GAME_CONFIG.UPGRADES.DEFLECTOR_ORBITERS_RESPAWN_SEC}s. Scales with Attack Speed.`, oneShot: true, effect: (p) => p.unlockWeapon('projectile_shield') },
    { id: 'heal', name: 'Second Wind', desc: 'Fully restore HP and double your Max HP.', effect: (p) => { p.secondWindCount = (p.secondWindCount || 0) + 1; p.maxHp = Math.round(p.maxHp * 2.0); p.hp = p.maxHp; if (typeof SoundEngine !== 'undefined' && SoundEngine.heal) SoundEngine.heal('medium'); } },
    { id: 'martyrdom_aura_upgrade', name: "Martyr's Aura", desc: 'Leaves a healing aura when you are dead, damaging and slowing enemies.', oneShot: true, effect: (p) => { p.martyrdomAuraEnabled = true; } },
    { id: 'martyrs_presence_upgrade', name: "Martyr's Presence", desc: `Enlarges Martyr's Aura by ${GAME_CONFIG.UPGRADES.MARTYRS_PRESENCE_RADIUS_BOOST_PCT}%, knocks back surviving enemies on nuclear death, and provokes nearby enemies.`, oneShot: true, effect: (p) => { p.martyrsPresenceEnabled = true; } },
    { id: 'sacrificial_aegis_upgrade', name: 'Sacrificial Aegis', desc: `Reduces damage taken by nearby allies by ${GAME_CONFIG.UPGRADES.SACRIFICIAL_AEGIS_ALLY_REDUCTION_PCT}% (you take the blocked damage instead), and further reduces respawn time by ${GAME_CONFIG.UPGRADES.SACRIFICIAL_AEGIS_REVIVE_REDUCTION_PCT}%.`, oneShot: true, effect: (p) => { p.sacrificialAegisEnabled = true; p.reviveTimeModifier *= (1 - GAME_CONFIG.UPGRADES.SACRIFICIAL_AEGIS_REVIVE_REDUCTION_PCT / 100); } },
    { id: 'carapace_healer_upgrade', name: 'Sympathetic Shell', desc: `Increases size by ${GAME_CONFIG.UPGRADES.CARAPACE_HEALER_SIZE_BOOST_PCT}%, and heals all players ${GAME_CONFIG.UPGRADES.CARAPACE_HEALER_TEAM_HEAL_PCT}% of your Max HP when taking damage.`, oneShot: true, effect: (p) => { p.carapaceHealerEnabled = true; p.r *= (1 + GAME_CONFIG.UPGRADES.CARAPACE_HEALER_SIZE_BOOST_PCT / 100); } },
    { id: 'ice_trail_upgrade', name: 'Glacial Slide', desc: `Increase movement speed by another ${GAME_CONFIG.UPGRADES.ICE_TRAIL_SPEED_BOOST_PCT}%, leave a slowing ice trail, and gain immunity to fire damage while on ice.`, oneShot: true, effect: (p) => { p.speed *= (1 + GAME_CONFIG.UPGRADES.ICE_TRAIL_SPEED_BOOST_PCT / 100); p.iceTrailEnabled = true; } }
];

function upgradeWeight(u, player) {
    if (u.id === 'heal') {
        const hpPct = player ? (player.hp / player.maxHp) * 100 : 50;
        const missingPctBelow100 = Math.max(0, 100 - hpPct);
        const takenCount = player ? (player.secondWindCount || 0) : 0;
        return Math.max(0, 0.40 - 0.08 * takenCount + missingPctBelow100 * 0.01); // 0: at most 1.39; 5: at most 0.99; 10; at most 0.59
    }
    return 1;
}
function weightedPickIndex(pool, player) {
    let total = 0;
    for (const u of pool) total += upgradeWeight(u, player);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
        r -= upgradeWeight(pool[i], player);
        if (r < 0) return i;
    }
    return pool.length - 1;
}

function pickThreeFor(player) {
    if (player && player.currentUpgradeOptions && player.currentUpgradeOptions.length === 3) {
        return player.currentUpgradeOptions;
    }
    const taken = player.takenOneShots;
    const hasMissile = player.weapons.some(w => w.id === 'magic_missile');
    const hasMine = player.weapons.some(w => w.id === 'proximity_mine');
    const hasFlail = player.weapons.some(w => w.id === 'player_flail');
    const hasTurret = player.weapons.some(w => w.id === 'turret');
    const hasRing = player.weapons.some(w => w.id === 'fire_ring');
    const pool = UPGRADE_POOL.filter(u => {
        if (isMobile && (u.id === 'dash' || u.id === 'dash_lvl2' || u.id === 'phase_detonation_upgrade')) return false;
        if (u.id === 'unlock_ring' && player.weapons.some(w => w.id === 'fire_ring')) return false;
        if (u.id === 'unlock_missile' && hasMissile) return false;
        if (u.id === 'unlock_melee' && player.weapons.some(w => w.id === 'melee_sweep')) return false;
        if (u.id === 'unlock_mine' && hasMine) return false;
        if (u.id === 'unlock_turret' && hasTurret) return false;
        if (u.id === 'laser_walls_upgrade' && !hasTurret) return false;
        if (u.id === 'building_duration_upgrade' && (!hasTurret || player.buildingDurationCount >= 4)) return false;
        if (u.id === 'turret_cooldown_upgrade' && (!hasTurret || player.turretCooldownCount >= 4)) return false;
        if (u.id === 'turret_flamethrower_upgrade' && !hasTurret) return false;
        if (u.id === 'turret_inferno_ring_upgrade' && (!taken.has('turret_flamethrower_upgrade') || !hasRing)) return false;
        if (u.id === 'turret_dispenser_upgrade' && !taken.has('building_duration_upgrade')) return false;
        if (u.id === 'turret_network_upgrade' && (!taken.has('laser_walls_upgrade') || !taken.has('building_duration_upgrade'))) return false;
        if (u.id === 'turret_saw_upgrade' && (!player.weapons.some(w => w.id === 'melee_sweep') || !hasTurret)) return false;
        if ((u.id === 'accuracy' || u.id === 'multishot') && !hasMissile) return false;
        if (u.id === 'instant_missile_upgrade' && (!taken.has('accuracy') || !hasMissile)) return false;
        if (u.id === 'sniper_shot_upgrade' && !taken.has('accuracy')) return false;
        if (u.id === 'laser_sniper_upgrade' && (!taken.has('sniper_shot_upgrade') || !taken.has('speed_lvl2'))) return false;
        if (u.id === 'freeze_upgrade' && !hasMissile && !hasMine && !hasFlail && !hasTurret) return false;
        if (u.id === 'cryo_mine_upgrade' && (!player.freezeEnabled || player.mineAoeCount < 1)) return false;
        if (u.id === 'mine_aoe_upgrade' && (!hasMine || player.mineAoeCount >= 3)) return false;
        if (u.id === 'mine_attract_upgrade' && !taken.has('explosion_heal_upgrade')) return false;
        if (u.id === 'mine_scatter_upgrade' && !hasMine) return false;
        if (u.id === 'mine_launcher_upgrade' && !taken.has('mine_scatter_upgrade')) return false;
        if (u.id === 'explosion_heal_upgrade' && (!taken.has('mine_aoe_upgrade') || !taken.has('mine_scatter_upgrade'))) return false;
        if (u.id === 'mine_ring' && (!hasRing || !hasMine || !taken.has('mine_launcher_upgrade'))) return false;
        if (u.id === 'melee_sledge_upgrade' && !player.weapons.some(w => w.id === 'melee_sweep')) return false;
        if (u.id === 'melee_chain_upgrade' && (!player.weapons.some(w => w.id === 'melee_sweep') || !taken.has('melee_sledge_upgrade'))) return false;
        if (u.id === 'flail_laser_upgrade' && (!hasFlail || !taken.has('speed_lvl2'))) return false;
        if (u.id === 'melee_shield_upgrade' && !player.weapons.some(w => w.id === 'melee_sweep')) return false;
        if (u.id === 'melee_reflect_upgrade' && !taken.has('melee_shield_upgrade')) return false;
        if (u.id === 'melee_range_upgrade' && !player.weapons.some(w => w.id === 'melee_sweep')) return false;
        if (u.id === 'rocket_upgrade' && (!hasMissile || !hasMine)) return false;
        if (u.id === 'speed_lvl2' && !taken.has('speed')) return false;
        if (u.id === 'dash_lvl2' && !taken.has('dash')) return false;
        if (u.id === 'phase_detonation_upgrade' && (!taken.has('dash_lvl2') || !hasMine)) return false;
        if (u.id === 'buckshot_upgrade' && (!hasMissile || player.multiShot === 0)) return false;
        if (u.id === 'cluster_shot_upgrade' && (!taken.has('buckshot_upgrade') || !taken.has('mine_launcher_upgrade'))) return false;
        if (u.id === 'projectile_lifedrain_upgrade' && (!taken.has('buckshot_upgrade') || !taken.has('accuracy'))) return false;
        if (u.id === 'heal_pack_upgrade' && (GAME_STATE.elapsed < 180000 || GAME_STATE.players.some(p => p.healPackEnabled) || (GAME_STATE.siphonCellsOwner !== null && GAME_STATE.siphonCellsOwner !== player))) return false;
        if (u.id === 'martyrdom_aura_upgrade' && !taken.has('final_blast')) return false;
        if (u.id === 'martyrs_presence_upgrade' && !taken.has('martyrdom_aura_upgrade')) return false;
        if (u.id === 'sacrificial_aegis_upgrade' && !taken.has('martyrs_presence_upgrade')) return false;
        if (u.id === 'carapace_healer_upgrade' && !taken.has('melee_reflect_upgrade')) return false;
        if (u.id === 'ice_trail_upgrade' && (!taken.has('speed_lvl2') || !taken.has('freeze_upgrade'))) return false;
        if (u.id === 'cooldown' && player.attackSpeedCount >= 7) return false;
        if (u.id === 'campervan' && (player.hp > player.maxHp * 0.5 || GAME_STATE.enemies.length < 200)) return false;
        if (u.id === 'final_blast' && (!hasMine || GAME_STATE.players.length < 2 || player.mineAoeCount < 1)) return false;
        if (u.id === 'projectile_shield' && GAME_STATE.elapsed < 420000) return false;
        if (u.oneShot && taken.has(u.id)) return false;
        if (u.id === 'heal' && player.hp >= player.maxHp * 0.5) return false;
        return true;
    });
    const out = [];
    while (out.length < 3 && pool.length > 0) {
        const i = weightedPickIndex(pool, player);
        const item = pool.splice(i, 1)[0];
        out.push(item);
    }
    // If pool exhausted, allow duplicates for repeatable stat upgrades
    while (out.length < 3) {
        const base = UPGRADE_POOL.filter(u => {
            if (isMobile && (u.id === 'dash' || u.id === 'dash_lvl2' || u.id === 'phase_detonation_upgrade')) return false;
            if (u.oneShot || u.id === 'unlock_ring') return false;
            if (u.id === 'multishot' && !hasMissile) return false;
            if (u.id === 'mine_aoe_upgrade' && (!hasMine || player.mineAoeCount >= 3)) return false;
            if (u.id === 'cooldown' && player.attackSpeedCount >= 7) return false;
            return true;
        });
        out.push(base[Math.floor(Math.random() * base.length)]);
    }
    if (player) player.currentUpgradeOptions = out;
    return out;
}

// ---------------- Upgrade Dependency Graph ----------------
const UPGRADE_DEPENDENCIES = {
    'speed_lvl2': ['speed'],
    'dash_lvl2': ['dash'],
    'phase_detonation_upgrade': ['dash_lvl2', 'unlock_mine'],
    'mine_attract_upgrade': ['explosion_heal_upgrade'],
    'mine_scatter_upgrade': ['unlock_mine'],
    'mine_launcher_upgrade': ['mine_scatter_upgrade'],
    'explosion_heal_upgrade': ['mine_aoe_upgrade', 'mine_scatter_upgrade'],
    'mine_aoe_upgrade': ['unlock_mine'],
    'mine_ring': ['mine_launcher_upgrade', 'unlock_ring'],
    'cryo_mine_upgrade': ['mine_aoe_upgrade', 'freeze_upgrade'],
    'freeze_upgrade': ['unlock_missile'],
    'melee_sledge_upgrade': ['unlock_melee'],
    'melee_chain_upgrade': ['melee_sledge_upgrade'],
    'flail_laser_upgrade': ['melee_chain_upgrade', 'speed_lvl2'],
    'melee_shield_upgrade': ['unlock_melee'],
    'melee_reflect_upgrade': ['melee_shield_upgrade'],
    'melee_range_upgrade': ['unlock_melee'],
    'accuracy': ['unlock_missile'],
    'instant_missile_upgrade': ['accuracy'],
    'sniper_shot_upgrade': ['accuracy'],
    'laser_sniper_upgrade': ['sniper_shot_upgrade', 'speed_lvl2'],
    'multishot': ['unlock_missile'],
    'buckshot_upgrade': ['multishot'],
    'cluster_shot_upgrade': ['buckshot_upgrade', 'mine_launcher_upgrade'],
    'projectile_lifedrain_upgrade': ['buckshot_upgrade', 'accuracy'],
    'rocket_upgrade': ['unlock_missile', 'unlock_mine'],
    'final_blast': ['unlock_mine'],
    'martyrdom_aura_upgrade': ['final_blast'],
    'martyrs_presence_upgrade': ['martyrdom_aura_upgrade', 'final_blast'],
    'sacrificial_aegis_upgrade': ['martyrs_presence_upgrade', 'martyrdom_aura_upgrade', 'final_blast'],
    'carapace_healer_upgrade': ['melee_reflect_upgrade'],
    'ice_trail_upgrade': ['speed_lvl2', 'freeze_upgrade'],
    'unlock_turret': [],
    'laser_walls_upgrade': ['unlock_turret'],
    'building_duration_upgrade': ['unlock_turret'],
    'turret_cooldown_upgrade': ['unlock_turret'],
    'turret_dispenser_upgrade': ['building_duration_upgrade'],
    'turret_flamethrower_upgrade': ['unlock_turret'],
    'turret_inferno_ring_upgrade': ['turret_flamethrower_upgrade', 'unlock_ring'],
    'turret_network_upgrade': ['laser_walls_upgrade', 'building_duration_upgrade'],
    'turret_saw_upgrade': ['unlock_melee', 'unlock_turret'],
};

// ---------------- Upgrade Details & Synergies ----------------
const UPGRADE_DETAILS = {
    'speed': {
        stacking: `You can only pick this upgrade once during a run. Its +${GAME_CONFIG.UPGRADES.SPEED_BOOST_PCT}% movement speed bonus remains active permanently.`,
        how: `Multiplies your base movement speed by ${(1 + GAME_CONFIG.UPGRADES.SPEED_BOOST_PCT / 100).toFixed(2)}x. Significantly improves your ability to evade swarms, kite elites, and dodge incoming enemy projectiles.`,
        caveats: 'Stacks multiplicatively with difficulty modifiers and player count speed scaling.'
    },
    'speed_lvl2': {
        stacking: 'One-shot permanent unlock.',
        how: `Increases movement speed by another +${GAME_CONFIG.UPGRADES.SPEED_LVL2_BOOST_PCT}% (for ~${((1 + GAME_CONFIG.UPGRADES.SPEED_BOOST_PCT / 100) * (1 + GAME_CONFIG.UPGRADES.SPEED_LVL2_BOOST_PCT / 100)).toFixed(2)}x baseline speed) and leaves a persistent glowing laser trail in your motion path. Enemies crossing the trail take continuous damage.`,
        caveats: 'Laser trail damage density increases when moving fast and circling enemies.'
    },
    'damage': {
        stacking: `This upgrade can be selected multiple times without limit. Each selection adds another +${GAME_CONFIG.UPGRADES.DAMAGE_WEAPONS_BOOST_PCT}% weapon damage (+${GAME_CONFIG.UPGRADES.DAMAGE_MINES_BOOST_PCT}% for mines).`,
        how: `Increases the base damage multiplier of all active weapons (Magic Missiles, Melee Sweeps, Turrets, Flails, Orbiters) by +${GAME_CONFIG.UPGRADES.DAMAGE_WEAPONS_BOOST_PCT}% and proximity mines by +${GAME_CONFIG.UPGRADES.DAMAGE_MINES_BOOST_PCT}% per stack.`,
        caveats: 'Damage increases multiply with difficulty damage multipliers.'
    },
    'cooldown': {
        stacking: `Can be selected up to ${GAME_CONFIG.UPGRADES.ATTACK_SPEED_MAX_STACKS} times. Attack interval divisor increases by ${(1 + GAME_CONFIG.UPGRADES.ATTACK_SPEED_BOOST_PCT / 100).toFixed(2)}x per stack (mines by ${(1 + GAME_CONFIG.UPGRADES.MINE_COOLDOWN_BOOST_PCT / 100).toFixed(2)}x).`,
        how: `Reduces the delay between weapon attacks, allowing Magic Missiles, Melee Sweeps, and Turrets to fire ${GAME_CONFIG.UPGRADES.ATTACK_SPEED_BOOST_PCT}% faster with each stack.`,
        caveats: `Has a maximum cap of ${GAME_CONFIG.UPGRADES.ATTACK_SPEED_MAX_STACKS} stacks.`
    },
    'accuracy': {
        stacking: 'One-shot permanent unlock.',
        how: 'Reduces random weapon angular spread to zero and increases projectile flight speed by 50%. Magic Missiles and Turret shots travel in pinpoint straight lines directly toward targets 50% faster, morphing into concentrated cyan laser bolts.',
        caveats: 'Transforms missile flight trajectory from curved spread arcs into straight beams.'
    },
    'instant_missile_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: 'Magic Missiles, Lasers, and Cluster Shots travel with infinite velocity, hitting target monsters instantaneously upon firing with no projectile transit delay. Turrets also gain this instant hit mechanic.',
        caveats: 'Shield Bearer energy barriers can still block line-of-fire between the shooter and the monster.'
    },
    'sniper_shot_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Every ${GAME_CONFIG.UPGRADES.SNIPER_SHOT_INTERVAL === 3 ? '3rd' : GAME_CONFIG.UPGRADES.SNIPER_SHOT_INTERVAL + 'th'} Magic Missile volley fires a high-velocity piercing beam at the monster with the highest maximum HP within range, dealing ${GAME_CONFIG.UPGRADES.SNIPER_SHOT_DAMAGE_MULT}x damage to everything in its path.`,
        caveats: 'Prioritizes the highest-HP target rather than the closest target.'
    },
    'laser_sniper_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Amplifies Sniper Shot damage from ${GAME_CONFIG.UPGRADES.SNIPER_SHOT_DAMAGE_MULT}x to ${GAME_CONFIG.UPGRADES.LASER_SNIPER_DAMAGE_MULT}x Magic Missile damage and leaves an intense laser beam trail along its path that continues to damage enemies for ${GAME_CONFIG.UPGRADES.LASER_SNIPER_TRAIL_DURATION_MS}ms.`,
        caveats: 'The laser trail is stationary along the beam trajectory.'
    },
    'multishot': {
        stacking: 'Can be selected multiple times without limit. Each selection adds +1 targeted missile per volley.',
        how: 'Each stack allows Magic Missiles to target +1 additional distinct enemy (targeting the next closest enemies in range).',
        caveats: 'If fewer enemies are present than total missile count, extra missiles fire at the same primary target.'
    },
    'dash': {
        stacking: 'One-shot permanent unlock.',
        how: 'Enables double-tapping any directional movement key to perform a swift Phase Dash, bursting missiles in a circle around you upon execution.',
        caveats: `Has a ${(GAME_CONFIG.DASH.COOLDOWN_MS / 1000).toFixed(1)}-second base recharge cooldown.`
    },
    'dash_lvl2': {
        stacking: 'One-shot permanent unlock.',
        how: `Increases Phase Dash distance by +${GAME_CONFIG.DASH.LVL2_RANGE_BOOST_PCT}%, cuts Phase Dash cooldown in half (from ${(GAME_CONFIG.DASH.COOLDOWN_MS / 1000).toFixed(1)}s to ${(GAME_CONFIG.DASH.COOLDOWN_MS / GAME_CONFIG.DASH.LVL2_COOLDOWN_DIVISOR / 1000).toFixed(2)}s), leaves a trail of scorching fire behind your dash path, and grants complete invulnerability and an impenetrable shield for the first half of the recharge duration.`,
        caveats: `Invulnerability shield lasts for ${(GAME_CONFIG.DASH.COOLDOWN_MS / GAME_CONFIG.DASH.LVL2_COOLDOWN_DIVISOR / 2000).toFixed(2)}s after dashing.`
    },
    'phase_detonation_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: 'Phase Dash landing impact detonates in a full proximity mine explosion and scatters explosive magic missiles in all directions, scaling with mine damage and AoE modifiers.',
        caveats: 'Explosion AoE and damage scale with your Volatile Powder and mine damage modifiers.'
    },
    'unlock_ring': {
        stacking: 'One-shot permanent unlock.',
        how: 'Spawns an orbiting ring of 3 fiery spheres revolving clockwise around you, dealing contact damage to any enemies that touch them.',
        caveats: 'Orbs rotate at a fixed orbital radius around your position.'
    },
    'unlock_missile': {
        stacking: 'One-shot permanent unlock.',
        how: 'Unlocks the automated Magic Missile weapon that continuously fires homing energy darts at nearby monsters.',
        caveats: 'Fires automatically without manual aim required.'
    },
    'unlock_melee': {
        stacking: 'One-shot permanent unlock.',
        how: 'Unlocks the close-range Melee Sweep attack that hits all enemies in a broad arc in front of the player.',
        caveats: 'Requires being in close proximity to monsters.'
    },
    'unlock_mine': {
        stacking: 'One-shot permanent unlock.',
        how: 'Unlocks deployable proximity mines dropped periodically behind you that arm and explode when monsters step on them.',
        caveats: 'Mines have a 500ms arming delay before they become triggerable.'
    },
    'unlock_turret': {
        stacking: 'One-shot permanent unlock.',
        how: `Unlocks deployable automated defense turrets dropped every ${GAME_CONFIG.TURRET.PLACEMENT_INTERVAL_SEC} seconds. Each turret lasts ${GAME_CONFIG.TURRET.LIFETIME_SEC} seconds and shoots high-speed missiles at nearby monsters.`,
        caveats: 'Turrets have their own HP and can be damaged or destroyed by enemy attacks.'
    },
    'laser_walls_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Turrets establish high-energy laser barriers between each other dealing ${GAME_CONFIG.TURRET.LASER_WALL_DPS} damage per second to monsters passing through, while slowing them by ${GAME_CONFIG.TURRET.SLOW_WALL_SLOW_PCT}%.`,
        caveats: 'Requires at least 2 active turrets within link range.'
    },
    'building_duration_upgrade': {
        stacking: `Can be selected multiple times. Each selection adds +${GAME_CONFIG.TURRET.FORTIFIED_DURATION_BOOST_PCT}% turret duration and +${GAME_CONFIG.TURRET.FORTIFIED_HP_BOOST_PCT}% turret HP.`,
        how: 'Extends how long turrets stay alive before expiring and increases their maximum health to survive heavy monster swarms.',
        caveats: 'Applies to all currently placed and future turrets.'
    },
    'turret_cooldown_upgrade': {
        stacking: `Can be selected multiple times. Reduces cooldowns by ${GAME_CONFIG.TURRET.RAPID_DEPLOYMENT_REDUCTION_PCT}% per stack.`,
        how: `Reduces the placement cooldown between dropping turrets, dispenser drop timers, and Autonomous Network expansion intervals by ${GAME_CONFIG.TURRET.RAPID_DEPLOYMENT_REDUCTION_PCT}% per stack.`,
        caveats: 'Multiplies cooldown modifiers down exponentially.'
    },
    'turret_flamethrower_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Adds a secondary flamethrower head to turrets that unleashes a ${GAME_CONFIG.TURRET.FLAME_BASE_CONE_DEG}° flame cone (${GAME_CONFIG.TURRET.FLAME_BASE_RANGE}px reach) dealing ${GAME_CONFIG.TURRET.FLAME_DAMAGE_MULT}x damage on every ${GAME_CONFIG.TURRET.FLAME_INTERVAL_ATTACKS === 4 ? '4th' : GAME_CONFIG.TURRET.FLAME_INTERVAL_ATTACKS + 'th'} attack, while main missile heads continue firing.`,
        caveats: 'The flamethrower cone fires independently of missile tracking.'
    },
    'turret_inferno_ring_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Flamethrower turrets perform a full 360° sweeping rotation around the turret and extend their attack radius to ${GAME_CONFIG.TURRET.FLAME_SWEEP_RANGE}px.`,
        caveats: 'Requires Fire Ring and Flamethrower Turret.'
    },
    'turret_network_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Every ${GAME_CONFIG.TURRET.NETWORK_INTERVAL_SEC} seconds (scaled by Rapid Deployment), active turrets with free links automatically construct a new connected turret (50-300px away) pointing outwards.`,
        caveats: 'Turrets cap at a maximum connection limit.'
    },
    'turret_saw_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Equips all turrets with spinning circular sawblades dealing ${GAME_CONFIG.TURRET.SAW_DPS} damage/sec to all nearby monsters within ${GAME_CONFIG.TURRET.SAW_RADIUS}px (reach scales with Extended Joints).`,
        caveats: 'Deals continuous damage to any monster entering close range.'
    },
    'turret_dispenser_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Each active turret has a ${GAME_CONFIG.TURRET.DISPENSER_CHANCE_PCT}% chance every ${GAME_CONFIG.TURRET.DISPENSER_INTERVAL_SEC} seconds (scaled by Rapid Deployment) to dispense one of 8 distinct supply drops with equal probability:<br><br>` +
             `• <b>Health Pack</b> (➕): Restores ${GAME_CONFIG.SUPPLIES.HEALTH_PACK_HP} HP immediately.<br>` +
             `• <b>XP Cluster</b> (💎): Spawns a cluster of gems worth ${GAME_CONFIG.SUPPLIES.XP_CLUSTER_XP} XP.<br>` +
             `• <b>Aegis</b> (🛡️): Grants ${GAME_CONFIG.SUPPLIES.AEGIS_DURATION_SEC} seconds of invulnerability.<br>` +
             `• <b>Nitro</b> (⚡): +${GAME_CONFIG.SUPPLIES.NITRO_SPEED_BOOST_PCT}% movement speed for ${GAME_CONFIG.SUPPLIES.NITRO_DURATION_SEC} seconds.<br>` +
             `• <b>Magnet</b> (🧲): Vacuums all XP gems within a ${GAME_CONFIG.SUPPLIES.MAGNET_RADIUS}px radius.<br>` +
             `• <b>Nuke</b> (💣): Detonates a ${GAME_CONFIG.SUPPLIES.NUKE_RADIUS}px blast dealing ${GAME_CONFIG.SUPPLIES.NUKE_DAMAGE} damage with knockback.<br>` +
             `• <b>Freeze</b> (❄️): Freezes all non-boss monsters in a ${GAME_CONFIG.SUPPLIES.FREEZE_RADIUS}px radius for ${GAME_CONFIG.SUPPLIES.FREEZE_DURATION_SEC} seconds.<br>` +
             `• <b>Overclock</b> (⚙️): Doubles the attack speed of all active turrets for ${GAME_CONFIG.SUPPLIES.OVERCLOCK_DURATION_SEC} seconds.`,
        caveats: 'More active turrets on the field provide more dispensing opportunities.'
    },
    'mine_aoe_upgrade': {
        stacking: `Can be selected up to ${GAME_CONFIG.UPGRADES.MINE_AOE_MAX_STACKS} times (+${GAME_CONFIG.UPGRADES.MINE_AOE_BOOST_PCT}% mine blast radius and +${GAME_CONFIG.UPGRADES.MARTYRDOM_AOE_BOOST_PCT}% Martyrdom radius per stack).`,
        how: `Expands proximity mine explosion blast radius by +${GAME_CONFIG.UPGRADES.MINE_AOE_BOOST_PCT}% per stack, allowing single mines to wipe out massive clusters of enemies.`,
        caveats: `Capped at a maximum of ${GAME_CONFIG.UPGRADES.MINE_AOE_MAX_STACKS} stacks.`
    },
    'mine_attract_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `${GAME_CONFIG.UPGRADES.MINE_ATTRACT_CHANCE_PCT}% of dropped proximity mines become magnetic singularities, pulling nearby enemies inward for ${GAME_CONFIG.UPGRADES.MINE_ATTRACT_DURATION_SEC} seconds before exploding.`,
        caveats: 'Requires Blast Mending. Attracted enemies are pulled towards the center of the mine.'
    },
    'freeze_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Infuses Magic Missiles and Scourge Flail with cryo energy, freezing hit enemies for ${GAME_CONFIG.UPGRADES.FREEZE_PROJECTILE_DURATION_SEC} seconds (mines freeze for ${GAME_CONFIG.UPGRADES.FREEZE_MINE_DURATION_SEC.toFixed(1)} second). Frozen enemies cannot move or attack.`,
        caveats: 'Bosses are immune to freeze, but all standard and elite enemies are affected.'
    },
    'cryo_mine_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Doubles (+${GAME_CONFIG.UPGRADES.CRYO_MINE_BOOST_PCT}%) the freeze duration of Proximity Mines and Scourge Flail attacks.`,
        caveats: `Mines freeze enemies for ${(GAME_CONFIG.UPGRADES.FREEZE_MINE_DURATION_SEC * (1 + GAME_CONFIG.UPGRADES.CRYO_MINE_BOOST_PCT / 100)).toFixed(1)}s; Flail freezes enemies for ${(GAME_CONFIG.UPGRADES.FREEZE_PROJECTILE_DURATION_SEC * (1 + GAME_CONFIG.UPGRADES.CRYO_MINE_BOOST_PCT / 100)).toFixed(1)}s.`
    },
    'mine_scatter_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `${GAME_CONFIG.UPGRADES.MINE_SCATTER_CHANCE_PCT}% chance when dropping a mine to scatter ${GAME_CONFIG.UPGRADES.MINE_SCATTER_MIN} to ${GAME_CONFIG.UPGRADES.MINE_SCATTER_MAX} additional bonus mines in random directions around you.`,
        caveats: 'Scattered mines arm and detonate with identical stats to normal mines.'
    },
    'mine_launcher_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: 'Whenever dropping a mine, automatically launches an additional mine forward in your movement direction.',
        caveats: 'Allows deploying mines ahead into approaching enemy waves.'
    },
    'explosion_heal_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Calculates the total damage dealt by every player explosion (mines, cluster shots, seeking rockets, explosive rings, phase detonations). All players within the explosion blast radius heal for ${GAME_CONFIG.UPGRADES.EXPLOSION_HEAL_PCT}% of that total damage. Unlocks the Magnetic Core upgrade.`,
        caveats: 'Only heals players who are physically inside the explosion radius when it detonates.'
    },
    'mine_ring': {
        stacking: 'One-shot permanent unlock.',
        how: 'Replaces orbiting Fire Ring spheres with explosive mine charges that detonate on contact with enemies and regenerate over time.',
        caveats: 'Each charge enters an individual regeneration cooldown after exploding.'
    },
    'heal_pack_upgrade': {
        stacking: 'One-shot permanent unlock (one player per match).',
        how: `Enemies slain by any player have a chance to drop pickup health packs (drop chance scales higher on beefier monsters). Collecting a pack restores ${GAME_CONFIG.UPGRADES.SIPHON_CELLS_HEAL_HP} HP.`,
        caveats: 'Available starting at Minute 3; only one player in a co-op match can take this upgrade.'
    },
    'melee_sledge_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Melee attacks trigger a heavy forward cone slam in your movement direction, dealing ${GAME_CONFIG.UPGRADES.MELEE_SLEDGE_DAMAGE_PCT}% damage and knocking enemies back.`,
        caveats: 'Slam direction aligns with your active movement vector.'
    },
    'melee_chain_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: 'Attaches a heavy spiked flail that drags behind you. It swings dynamically based on turn angle and player velocity, dealing speed-scaled momentum damage.',
        caveats: 'Circling enemies at high speed increases flail rotational velocity and damage.'
    },
    'flail_laser_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: 'The spiked head of the Scourge Flail leaves a thin damaging laser trail along its path of motion.',
        caveats: 'Laser trail lasts briefly as the flail swings.'
    },
    'melee_shield_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Grants ${GAME_CONFIG.UPGRADES.MELEE_SHIELD_DAMAGE_REDUCTION_PCT}% damage reduction against all incoming damage to you and your deployable turrets (damage taken multiplier set to ${(1 - GAME_CONFIG.UPGRADES.MELEE_SHIELD_DAMAGE_REDUCTION_PCT / 100).toFixed(2)}x).`,
        caveats: 'Multiplies with other defensive modifiers.'
    },
    'melee_reflect_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Whenever an enemy damages you, immediately reflects ${GAME_CONFIG.UPGRADES.REFLECT_DAMAGE_PLAYER_MAX_HP_PCT}% of your Max HP back to the attacker as unavoidable damage (turrets reflect ${GAME_CONFIG.UPGRADES.REFLECT_DAMAGE_TURRET_MAX_HP_PCT}% max HP).`,
        caveats: 'Scales with your Maximum HP (synergizes with Second Wind).'
    },
    'melee_range_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Increases the reach and hitbox radius of all melee attacks and turret sawblades by +${GAME_CONFIG.UPGRADES.MELEE_RANGE_BOOST_PCT}%.`,
        caveats: 'Affects Melee Sweep, Sledge Hammer, Scourge Flail, and Sawblade Turrets.'
    },
    'rocket_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Magic Missile volleys have a ${GAME_CONFIG.UPGRADES.ROCKET_PLAYER_CHANCE_PCT}% chance to launch a homing explosive rocket that tracks enemies and detonates in an AoE blast (turrets also gain a ${GAME_CONFIG.UPGRADES.ROCKET_TURRET_CHANCE_PCT}% rocket chance).`,
        caveats: 'Rocket explosion radius scales with Volatile Powder.'
    },
    'buckshot_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `When Magic Missiles hit an enemy, they burst into ${GAME_CONFIG.UPGRADES.BUCKSHOT_SHRAPNEL_COUNT} forward-spreading shrapnel projectiles that pierce through nearby enemies for 1/${GAME_CONFIG.UPGRADES.BUCKSHOT_SHRAPNEL_COUNT} damage.`,
        caveats: 'Shrapnel spreads in a forward cone from the impact point.'
    },
    'cluster_shot_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: 'Transforms all Magic Missiles and Buckshot shrapnel into explosive cluster munitions that detonate on contact, scaling with proximity mine damage and AoE.',
        caveats: 'Cluster munitions explode on impact and are blocked by Shield Bearer arcs.'
    },
    'projectile_lifedrain_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Direct projectile hits and explosions fired by you restore health equal to ${GAME_CONFIG.UPGRADES.PROJECTILE_LIFEDRAIN_PCT}% of damage dealt.`,
        caveats: 'Only applies to projectile damage originating from the player.'
    },
    'campervan': {
        stacking: 'One-shot emergency power-up.',
        how: `Transforms you into an invincible campervan for ${GAME_CONFIG.UPGRADES.CAMPERVAN_DURATION_SEC} seconds, crushing through all enemies and bosses on contact.`,
        caveats: 'Only offered in critical situations when HP is below 50% and 200+ enemies are on screen.'
    },
    'final_blast': {
        stacking: 'One-shot permanent unlock.',
        how: 'Upon dying, detonate in a massive nuclear explosion that obliterates nearby monsters, and permanently halves your respawn time.',
        caveats: 'Only available in co-op games (2+ players).'
    },
    'projectile_shield': {
        stacking: 'One-shot permanent unlock.',
        how: `Spawns ${GAME_CONFIG.UPGRADES.DEFLECTOR_ORBITERS_COUNT} orbiting deflector shields around you that rotate counter-clockwise and destroy incoming enemy projectiles (Shooter bolts, Spikes, and Marauder missiles) on contact. When a shield blocks a projectile, that shield is destroyed and respawns after ${GAME_CONFIG.UPGRADES.DEFLECTOR_ORBITERS_RESPAWN_SEC} seconds. Rotation speed scales directly with your Attack Speed.`,
        caveats: `Each individual shield has a ${GAME_CONFIG.UPGRADES.DEFLECTOR_ORBITERS_RESPAWN_SEC}-second respawn cooldown after blocking a projectile.`
    },
    'heal': {
        stacking: 'This upgrade can be selected multiple times without limit.',
        how: 'Instantly restores you to full HP and permanently doubles your Maximum HP.',
        caveats: 'Doubling Max HP increases Barbed Carapace reflect damage and Sympathetic Shell healing.'
    },
    'martyrdom_aura_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: 'While waiting to respawn, leaves a persistent aura on the battlefield that heals living allies while damaging and slowing enemies.',
        caveats: 'Active only while the player is down.'
    },
    'martyrs_presence_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Enlarges Martyr's Aura radius by +${GAME_CONFIG.UPGRADES.MARTYRS_PRESENCE_RADIUS_BOOST_PCT}%, adds a knockback blast upon death, and constantly provokes monsters within proximity mine radius to target you.`,
        caveats: 'Provokes monsters away from allies towards you.'
    },
    'sacrificial_aegis_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Reduces damage taken by nearby allies by ${GAME_CONFIG.UPGRADES.SACRIFICIAL_AEGIS_ALLY_REDUCTION_PCT}% by absorbing the blocked damage yourself. Further cuts respawn time by ${GAME_CONFIG.UPGRADES.SACRIFICIAL_AEGIS_REVIVE_REDUCTION_PCT}%.`,
        caveats: `You absorb the ${GAME_CONFIG.UPGRADES.SACRIFICIAL_AEGIS_ALLY_REDUCTION_PCT}% damage mitigated from nearby protected allies.`
    },
    'carapace_healer_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Increases player size by +${GAME_CONFIG.UPGRADES.CARAPACE_HEALER_SIZE_BOOST_PCT}%, and whenever taking damage, instantly heals all players for ${GAME_CONFIG.UPGRADES.CARAPACE_HEALER_TEAM_HEAL_PCT}% of your Max HP.`,
        caveats: 'Larger hitbox makes dodging harder, but triggers frequent team healing upon taking damage.'
    },
    'ice_trail_upgrade': {
        stacking: 'One-shot permanent unlock.',
        how: `Increases movement speed by another +${GAME_CONFIG.UPGRADES.ICE_TRAIL_SPEED_BOOST_PCT}%, leaves a persistent ice trail that slows enemy movement by ${GAME_CONFIG.UPGRADES.ICE_TRAIL_SLOW_PCT}%, boosts Laser Trail damage, and grants complete immunity to fire damage while walking on ice.`,
        caveats: 'Ice trail persists for several seconds behind your movement path.'
    }
};

function getUpgradeUnlockInfo(upgradeId) {
    const unlocks = [];
    if (typeof UPGRADE_DEPENDENCIES !== 'undefined') {
        for (const [childId, parents] of Object.entries(UPGRADE_DEPENDENCIES)) {
            if (parents && parents.includes(upgradeId)) {
                const childObj = UPGRADE_POOL.find(u => u.id === childId);
                const childName = childObj ? childObj.name : childId;
                const childDesc = childObj ? childObj.desc : '';
                
                // Collect and deduplicate other required parents
                const otherParents = parents
                    .filter(p => p !== upgradeId)
                    .map(p => {
                        const po = UPGRADE_POOL.find(u => u.id === p);
                        return po ? po.name : p;
                    });
                const uniqueOtherParents = Array.from(new Set(otherParents));
                
                unlocks.push({ id: childId, name: childName, desc: childDesc, otherParents: uniqueOtherParents });
            }
        }
    }
    return unlocks;
}

function showUpgradeDetailModal(u) {
    if (!u) return;
    const modal = document.getElementById('upgradeDetailModal');
    if (!modal) return;

    document.getElementById('upgradeDetailTitle').textContent = u.name;
    
    // 1. Stacking / One-Shot token & description
    const badge = document.getElementById('upgradeDetailBadge');
    const tokenDesc = document.getElementById('upgradeDetailTokenDesc');
    const details = UPGRADE_DETAILS[u.id] || {};
    
    const isOneShot = !!u.oneShot;
    const tokenText = isOneShot ? 'One-Shot' : 'Stacks';
    const tokenDescText = isOneShot 
        ? 'Permanently unlocks a new capability' 
        : 'Selectable several times, exponential effect';

    badge.textContent = tokenText;
    if (tokenDesc) tokenDesc.textContent = tokenDescText;

    // 2. How it works
    const howText = document.getElementById('upgradeDetailHowText');
    howText.innerHTML = details.how || u.desc;

    // 3. Caveats
    const caveatsSection = document.getElementById('upgradeDetailCaveatsSection');
    const caveatsText = document.getElementById('upgradeDetailCaveatsText');
    if (details.caveats) {
        caveatsSection.style.display = 'block';
        caveatsText.innerHTML = details.caveats;
    } else {
        caveatsSection.style.display = 'none';
    }

    // 4. Continuation Upgrades List (built dynamically from UPGRADE_DEPENDENCIES with short descriptions)
    const unlocksList = document.getElementById('upgradeDetailUnlocksList');
    const unlocks = getUpgradeUnlockInfo(u.id);
    if (!unlocks || unlocks.length === 0) {
        unlocksList.innerHTML = '<span style="color:#888;">No further downstream upgrades depend on this upgrade.</span>';
    } else {
        unlocksList.innerHTML = '<ul style="margin: 4px 0 0 16px; padding: 0;">' + 
            unlocks.map(item => {
                const reqStr = (item.otherParents && item.otherParents.length > 0)
                    ? ` <span style="color:#aaa; font-size:12px;">(also requires: <i>${item.otherParents.join(', ')}</i>)</span>`
                    : '';
                const descStr = item.desc ? `<div style="font-size: 12px; color: #bbb; margin-top: 2px; margin-bottom: 6px; line-height: 1.35;">${item.desc}</div>` : '';
                return `<li style="margin-bottom: 6px;"><b style="color:#00ffcc;">${item.name}</b>${reqStr}${descStr}</li>`;
            }).join('') + 
        '</ul>';
    }

    modal.classList.add('show');
}

function closeUpgradeDetailModal() {
    const modal = document.getElementById('upgradeDetailModal');
    if (modal) modal.classList.remove('show');
}

function initUpgradeDetailModalBindings() {
    const closeUpgradeDetailBtn = document.getElementById('closeUpgradeDetailBtn');
    if (closeUpgradeDetailBtn) closeUpgradeDetailBtn.onclick = closeUpgradeDetailModal;

    const closeUpgradeDetailBtnBottom = document.getElementById('closeUpgradeDetailBtnBottom');
    if (closeUpgradeDetailBtnBottom) closeUpgradeDetailBtnBottom.onclick = closeUpgradeDetailModal;

    const upgradeDetailModal = document.getElementById('upgradeDetailModal');
    if (upgradeDetailModal) {
        upgradeDetailModal.onclick = (e) => {
            if (e.target === upgradeDetailModal) closeUpgradeDetailModal();
        };
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUpgradeDetailModalBindings);
    } else {
        initUpgradeDetailModalBindings();
    }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeUpgradeDetailModal();
        }
    });
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== 'undefined') {
    window.UPGRADE_POOL = UPGRADE_POOL;
    window.UPGRADE_DEPENDENCIES = UPGRADE_DEPENDENCIES;
    window.UPGRADE_DETAILS = UPGRADE_DETAILS;
    window.upgradeWeight = upgradeWeight;
    window.weightedPickIndex = weightedPickIndex;
    window.pickThreeFor = pickThreeFor;
    window.getUpgradeUnlockInfo = getUpgradeUnlockInfo;
    window.showUpgradeDetailModal = showUpgradeDetailModal;
    window.closeUpgradeDetailModal = closeUpgradeDetailModal;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        UPGRADE_POOL,
        UPGRADE_DEPENDENCIES,
        UPGRADE_DETAILS,
        upgradeWeight,
        weightedPickIndex,
        pickThreeFor,
        getUpgradeUnlockInfo,
        showUpgradeDetailModal,
        closeUpgradeDetailModal
    };
}