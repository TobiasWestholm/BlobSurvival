// =========================================================================
// Centralized Game Configuration Constants (Single Source of Truth)
// Blob Survival Game Engine - js/config.js
// =========================================================================

// 0. MOBILE PLATFORM DETECTION
const isMobile = (typeof window !== 'undefined') && (
    ('ontouchstart' in window) ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '')
);

if (typeof window !== 'undefined') {
    window.isMobile = isMobile;
}

if (isMobile && typeof document !== 'undefined') {
    if (document.body) {
        document.body.classList.add('mobile-device');
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.body) document.body.classList.add('mobile-device');
        });
    }
}

// 1. GAME STATES
const STATES = {
    START_MENU: 0,
    WEAPON_SELECT: 1,
    GAMEPLAY: 2,
    LEVEL_UP: 3,
    PAUSED: 4,
    GAME_OVER: 5,
    VICTORY: 6
};

// 2. DIFFICULTY SETTINGS
const DIFFICULTIES = {
    easy:   { name: 'Easy',   dmgMult: 4.0, speedMult: 1.5,  accuracy: 0.25,    takenMult: 0.25,  difficultyMultiplier: 1.5 },
    normal: { name: 'Normal', dmgMult: 2.0, speedMult: 1.25, accuracy: 0.5,     takenMult: 0.50,  difficultyMultiplier: 1.25 },
    hard:   { name: 'Hard',   dmgMult: 1.0, speedMult: 1.0,  accuracy: 1.0,     takenMult: 1.0,   difficultyMultiplier: 1.0 }
};

// 3. MONSTER XP VALUES
const MONSTER_BASE_XP = {
    swarm: 1, brute: 2, mega_brute: 3, brute_lord: 4, speeder: 5,
    meteor: 6, dasher: 7, shooter: 8, spiky: 10, baneling: 50,
    marauder: 20, stalker: 30, zergling: 0, spine_crawler: 40, sentry: 40,
    medivac: 60, warp_anomaly: 70, hellion: 80, shield_bearer: 90, viper: 100,
    octopus: 500, felhound: 1000, behemoth: 0
};

// 4. PLAYER DEFINITIONS & DEFAULT CONTROLS
const PLAYER_DEFS = [
    { color: '#00ffcc', ring: '#003322', keys: { up: ['w'], left: ['a'], down: ['s'], right: ['d'] }, keysText: 'WASD' },
    { color: '#ff66cc', ring: '#33001f', keys: { up: ['arrowup'], left: ['arrowleft'], down: ['arrowdown'], right: ['arrowright'] }, keysText: '↑←↓→' },
    { color: '#ffcc00', ring: '#332900', keys: { up: ['g'], left: ['c'], down: ['v'], right: ['b'] }, keysText: 'GCVB' },
    { color: '#66aaff', ring: '#001a33', keys: { up: ['i'], left: ['j'], down: ['k'], right: ['l'] }, keysText: 'IJKL' }
];

// 5. TIMELINE PROGRESSION (MONSTER INTRODUCTIONS & BOSS EVENTS)
const PROGRESSION = {
    monsterIntroductions: [
        { type: 'brute', time: 40000 },
        { type: 'mega_brute', time: 120000 },
        { type: 'brute_lord', time: 180000 },
        { type: 'speeder', time: 240000 },
        { type: 'meteor', time: 300000 },
        { type: 'dasher', time: 360000 },
        { type: 'shooter', time: 420000 },
        { type: 'spiky', time: 600000 },
        { type: 'baneling', time: 720000 },      // Min 12 (12:00)
        { type: 'marauder', time: 780000 },      // Min 13 (13:00)
        { type: 'stalker', time: 840000 },       // Min 14 (14:00)
        { type: 'spine_crawler', time: 900000 }, // Min 15 (15:00)
        { type: 'sentry', time: 1080000 },       // Min 18 (18:00, after 2m Felhound Boss)
        { type: 'medivac', time: 1140000 },      // Min 19 (19:00)
        { type: 'hellion', time: 1200000 },      // Min 20 (20:00)
        { type: 'warp_anomaly', time: 1260000 }, // Min 21 (21:00, rare invisible warp anomaly)
        { type: 'shield_bearer', time: 1320000 },// Min 22 (22:00)
        { type: 'viper', time: 1380000 }         // Min 23 (23:00, rare flying abduct unit)
    ],
    bossEvents: [
        { type: 'octopus', start: 480000, durationLimit: 120000 }, // 8:00 (2 min limit)
        { type: 'horde', start: 660000, durationLimit: 57000 },    // 11:00 (57 sec limit)
        { type: 'felhound', start: 960000, durationLimit: 120000 },// 16:00 (2 min limit)
        { type: 'behemoth', start: 1440000, durationLimit: 180000 }// 24:00 (3 min limit)
    ]
};

// 6. DETAILED NUMERICAL GAME CONFIGURATION
const GAME_CONFIG = {
    PLAYER: {
        BASE_SPEED: 1.0,
        BASE_HP: 100,
        RADIUS: 15,
        REVIVE_MS: 20000,
        REVIVE_INVULN_MS: 3000,
    },
    XP: {
        EXPONENTIAL_GROWTH: 1.2,
        ADD_PER_LEVEL: 18,
        BASE_LEVEL_XP: 15
    },
    DASH: {
        DOUBLE_TAP_WINDOW_MS: 200,
        SPEED: 14,
        DURATION_MS: 90,
        COOLDOWN_MS: 2500, // 2.5s base cooldown
        BURST_MISSILES: 24,
        LVL2_RANGE_BOOST_PCT: 25,
        LVL2_COOLDOWN_DIVISOR: 2 // halves cooldown (100% recharge speed boost)
    },
    TURRET: {
        PLACEMENT_INTERVAL_SEC: 10,
        LIFETIME_SEC: 25, // 25s base lifetime
        BASE_HP: 800,
        BASE_DAMAGE: 4,
        ATTACK_COOLDOWN_MS: 1170,
        PROJECTILE_SPEED: 11.0,
        SLOW_WALL_SLOW_PCT: 40,
        LASER_WALL_DPS: 50,
        FORTIFIED_DURATION_BOOST_PCT: 50,
        FORTIFIED_HP_BOOST_PCT: 50,
        RAPID_DEPLOYMENT_REDUCTION_PCT: 30,
        FLAME_INTERVAL_ATTACKS: 4,
        FLAME_DAMAGE_MULT: 4, // 4x base damage = 16
        FLAME_BASE_RANGE: 130,
        FLAME_SWEEP_RANGE: 170,
        FLAME_BASE_CONE_DEG: 135,
        NETWORK_INTERVAL_SEC: 60,
        SAW_DPS: 15,
        SAW_RADIUS: 50,
        DISPENSER_CHANCE_PCT: 2,
        DISPENSER_INTERVAL_SEC: 10
    },
    SUPPLIES: {
        HEALTH_PACK_HP: 30,
        XP_CLUSTER_XP: 80,
        AEGIS_DURATION_SEC: 4,
        NITRO_SPEED_BOOST_PCT: 50,
        NITRO_DURATION_SEC: 6,
        MAGNET_RADIUS: 450,
        NUKE_RADIUS: 350,
        NUKE_DAMAGE: 120,
        FREEZE_RADIUS: 350,
        FREEZE_DURATION_SEC: 3,
        OVERCLOCK_TURRET_SPEED_MULT: 2,
        OVERCLOCK_DURATION_SEC: 5
    },
    UPGRADES: {
        SPEED_BOOST_PCT: 30,
        SPEED_LVL2_BOOST_PCT: 30,
        DAMAGE_WEAPONS_BOOST_PCT: 50,
        DAMAGE_MINES_BOOST_PCT: 75,
        ATTACK_SPEED_BOOST_PCT: 40,
        MINE_COOLDOWN_BOOST_PCT: 25,
        ATTACK_SPEED_MAX_STACKS: 7,
        SNIPER_SHOT_INTERVAL: 3,
        SNIPER_SHOT_DAMAGE_MULT: 3,
        LASER_SNIPER_DAMAGE_MULT: 5,
        LASER_SNIPER_TRAIL_DURATION_MS: 600,
        MINE_AOE_BOOST_PCT: 60,
        MINE_AOE_MAX_STACKS: 3,
        MARTYRDOM_AOE_BOOST_PCT: 10,
        MINE_ATTRACT_CHANCE_PCT: 10,
        MINE_ATTRACT_DURATION_SEC: 2.5,
        MAX_ACTIVE_MINES: 300,
        FREEZE_PROJECTILE_DURATION_SEC: 0.25,
        FREEZE_MINE_DURATION_SEC: 1.0,
        CRYO_MINE_BOOST_PCT: 100,
        MINE_SCATTER_CHANCE_PCT: 10,
        MINE_SCATTER_MIN: 6,
        MINE_SCATTER_MAX: 7,
        EXPLOSION_HEAL_PCT: 0.5,
        SIPHON_CELLS_HEAL_HP: 30,
        MELEE_SLEDGE_DAMAGE_PCT: 400,
        MELEE_SHIELD_DAMAGE_REDUCTION_PCT: 40, // 40% damage reduction (0.60x taken)
        REFLECT_DAMAGE_PLAYER_MAX_HP_PCT: 25,
        REFLECT_DAMAGE_TURRET_MAX_HP_PCT: 2.5,
        MELEE_RANGE_BOOST_PCT: 40,
        ROCKET_PLAYER_CHANCE_PCT: 10,
        ROCKET_TURRET_CHANCE_PCT: 5,
        BUCKSHOT_SHRAPNEL_COUNT: 3,
        PROJECTILE_LIFEDRAIN_PCT: 0.2,
        CAMPERVAN_DURATION_SEC: 20,
        DEFLECTOR_ORBITERS_COUNT: 3,
        DEFLECTOR_ORBITERS_RESPAWN_SEC: 3,
        MARTYRS_PRESENCE_RADIUS_BOOST_PCT: 50,
        SACRIFICIAL_AEGIS_ALLY_REDUCTION_PCT: 25,
        SACRIFICIAL_AEGIS_REVIVE_REDUCTION_PCT: 25,
        CARAPACE_HEALER_SIZE_BOOST_PCT: 50,
        CARAPACE_HEALER_TEAM_HEAL_PCT: 0.25,
        ICE_TRAIL_SPEED_BOOST_PCT: 30,
        ICE_TRAIL_SLOW_PCT: 50
    },
    HAZARDS: {
        METEOR_FALL_MS: 1200,
        BURN_MS: 3000,
        BURN_TICK_DMG: 12,
        PROJECTILE_HEAL: 0.002
    },
    ENEMIES: {
        DASHER: {
            LUNGE_RANGE: 210,
            LUNGE_MINDIST: 100,
            LUNGE_SPEED: 5.0,
            LUNGE_MS: 380,
            LUNGE_COOLDOWN: 1500,
            SIDE_SPEED: 3.8,
            SIDE_MS: 240,
            SIDE_GAP: 200
        }
    }
};

// 7. SHORTCUT ACCESS CONSTANTS (FOR BACKWARD COMPATIBILITY)
const REVIVE_MS = GAME_CONFIG.PLAYER.REVIVE_MS;
const REVIVE_INVULN = GAME_CONFIG.PLAYER.REVIVE_INVULN_MS;
const METEOR_FALL_MS = GAME_CONFIG.HAZARDS.METEOR_FALL_MS;
const BURN_MS = GAME_CONFIG.HAZARDS.BURN_MS;
const BURN_TICK = GAME_CONFIG.HAZARDS.BURN_TICK_DMG;
const PROJECTILE_HEAL = GAME_CONFIG.HAZARDS.PROJECTILE_HEAL;

const XP_EXPONENTIAL = GAME_CONFIG.XP.EXPONENTIAL_GROWTH;
const XP_ADD_PER_LEVEL = GAME_CONFIG.XP.ADD_PER_LEVEL;
const LVL2_XP = GAME_CONFIG.XP.BASE_LEVEL_XP;

const DOUBLE_TAP_MS = GAME_CONFIG.DASH.DOUBLE_TAP_WINDOW_MS;
const PLAYER_DASH_SPEED = GAME_CONFIG.DASH.SPEED;
const PLAYER_DASH_MS = GAME_CONFIG.DASH.DURATION_MS;
const PLAYER_DASH_COOLDOWN = GAME_CONFIG.DASH.COOLDOWN_MS;
const PLAYER_DASH_BURST = GAME_CONFIG.DASH.BURST_MISSILES;

const DASHER_LUNGE_RANGE = GAME_CONFIG.ENEMIES.DASHER.LUNGE_RANGE;
const DASHER_LUNGE_MINDIST = GAME_CONFIG.ENEMIES.DASHER.LUNGE_MINDIST;
const DASHER_LUNGE_SPEED = GAME_CONFIG.ENEMIES.DASHER.LUNGE_SPEED;
const DASHER_LUNGE_MS = GAME_CONFIG.ENEMIES.DASHER.LUNGE_MS;
const DASHER_LUNGE_COOLDOWN = GAME_CONFIG.ENEMIES.DASHER.LUNGE_COOLDOWN;
const DASHER_SIDE_SPEED = GAME_CONFIG.ENEMIES.DASHER.SIDE_SPEED;
const DASHER_SIDE_MS = GAME_CONFIG.ENEMIES.DASHER.SIDE_MS;
const DASHER_SIDE_GAP = GAME_CONFIG.ENEMIES.DASHER.SIDE_GAP;

// 8. CENTRAL GAME ENGINE STATE
const GAME_STATE = {
    current: STATES.START_MENU,
    testingMode: false,
    testStartMinute: 0,
    players: [],
    enemies: [],
    projectiles: [],
    enemyProjectiles: [],
    hazards: [],
    iceTrails: [],
    terrains: [],
    magneticMines: [],
    turrets: [],
    gems: [],
    particles: [],
    activeSentries: [],
    shieldBearers: [],
    attractingVipers: [],
    startTime: 0,
    elapsed: 0,
    lastSpawn: 0,
    kills: 0,
    activeBoss: null,
    activeBossStartTime: 0,
    completedBosses: new Set(),
    bossWarningsFired: new Set(),
    resumeNormalSpawnAt: 0,
    hordeRingSpawned: false,
    hordeLastWave: 0,
    hordeStartTime: 0,
    level: 1,
    xp: 0,
    nextXp: LVL2_XP,
    difficulty: DIFFICULTIES.normal,
    dmgFactor: 1.0,
    pendingLevels: 0,
    pendingPicks: 0,
    countdownTimer: null,
    siphonCellsOwner: null
};

// Feature flag: set to true locally to expose the Upgrade Testing Lab button.
let ENABLE_TESTING_LAB = false;

// 9. GLOBAL WINDOW EXPORTS
if (typeof window !== 'undefined') {
    window.ENABLE_TESTING_LAB = ENABLE_TESTING_LAB;
    window.STATES = STATES;
    window.DIFFICULTIES = DIFFICULTIES;
    window.MONSTER_BASE_XP = MONSTER_BASE_XP;
    window.PLAYER_DEFS = PLAYER_DEFS;
    window.PROGRESSION = PROGRESSION;
    window.GAME_CONFIG = GAME_CONFIG;
    window.GAME_STATE = GAME_STATE;
    window.REVIVE_MS = REVIVE_MS;
    window.REVIVE_INVULN = REVIVE_INVULN;
    window.METEOR_FALL_MS = METEOR_FALL_MS;
    window.BURN_MS = BURN_MS;
    window.BURN_TICK = BURN_TICK;
    window.PROJECTILE_HEAL = PROJECTILE_HEAL;
    window.XP_EXPONENTIAL = XP_EXPONENTIAL;
    window.XP_ADD_PER_LEVEL = XP_ADD_PER_LEVEL;
    window.LVL2_XP = LVL2_XP;
    window.DOUBLE_TAP_MS = DOUBLE_TAP_MS;
    window.PLAYER_DASH_SPEED = PLAYER_DASH_SPEED;
    window.PLAYER_DASH_MS = PLAYER_DASH_MS;
    window.PLAYER_DASH_COOLDOWN = PLAYER_DASH_COOLDOWN;
    window.PLAYER_DASH_BURST = PLAYER_DASH_BURST;
    window.DASHER_LUNGE_RANGE = DASHER_LUNGE_RANGE;
    window.DASHER_LUNGE_MINDIST = DASHER_LUNGE_MINDIST;
    window.DASHER_LUNGE_SPEED = DASHER_LUNGE_SPEED;
    window.DASHER_LUNGE_MS = DASHER_LUNGE_MS;
    window.DASHER_LUNGE_COOLDOWN = DASHER_LUNGE_COOLDOWN;
    window.DASHER_SIDE_SPEED = DASHER_SIDE_SPEED;
    window.DASHER_SIDE_MS = DASHER_SIDE_MS;
    window.DASHER_SIDE_GAP = DASHER_SIDE_GAP;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isMobile,
        STATES,
        DIFFICULTIES,
        MONSTER_BASE_XP,
        PLAYER_DEFS,
        PROGRESSION,
        GAME_CONFIG,
        GAME_STATE,
        REVIVE_MS,
        REVIVE_INVULN,
        METEOR_FALL_MS,
        BURN_MS,
        BURN_TICK,
        PROJECTILE_HEAL,
        XP_EXPONENTIAL,
        XP_ADD_PER_LEVEL,
        LVL2_XP,
        DOUBLE_TAP_MS,
        PLAYER_DASH_SPEED,
        PLAYER_DASH_MS,
        PLAYER_DASH_COOLDOWN,
        PLAYER_DASH_BURST,
        DASHER_LUNGE_RANGE,
        DASHER_LUNGE_MINDIST,
        DASHER_LUNGE_SPEED,
        DASHER_LUNGE_MS,
        DASHER_LUNGE_COOLDOWN,
        DASHER_SIDE_SPEED,
        DASHER_SIDE_MS,
        DASHER_SIDE_GAP
    };
}