/**
 * BlobSurvival - Input & Control Management
 * 
 * Manages keyboard input mapping, multi-key state, double-tap dash initiation,
 * mobile virtual joystick mechanics, network client input serialization,
 * audio unlock gestures, and visibility change tab listeners.
 */

// ---------------- 1. Keyboard State & Listeners ----------------

const keys = {};

function anyKey(list) {
    if (!list) return false;
    for (const k of list) {
        if (keys[k]) return true;
    }
    return false;
}

// Double-tapping a movement key triggers a dash for the player that owns that key.
function handleDoubleTap(k) {
    if (typeof GAME_STATE === 'undefined' || GAME_STATE.current !== STATES.GAMEPLAY) return;
    const tnow = performance.now();
    const isOnline = (GAME_STATE.gameMode === 'online');
    const myLocalIndex = isOnline ? (typeof netManager !== 'undefined' && netManager ? netManager.localPlayerIndex : 0) : null;
    const doubleTapMs = (typeof DOUBLE_TAP_MS !== 'undefined') ? DOUBLE_TAP_MS : 250;

    if (GAME_STATE.players) {
        for (const p of GAME_STATE.players) {
            if (!p || !p.alive || !p.dashEnabled) continue;
            if (isOnline && p.index !== myLocalIndex) continue;
            let dir = null;
            if (p.keymap) {
                for (const d of ['up', 'down', 'left', 'right']) {
                    if (p.keymap[d] && p.keymap[d].includes(k)) { dir = d; break; }
                }
            }
            if (!dir) continue;
            if (p.lastTapDir === dir && (tnow - p.lastTapTime) < doubleTapMs) {
                p.lastTapDir = null; // consume so a third tap can't immediately re-fire
                tryStartDash(p);
            } else {
                p.lastTapDir = dir;
                p.lastTapTime = tnow;
            }
            return; // a key belongs to at most one player
        }
    }
}

function tryStartDash(p) {
    if (!p) return;
    const curTime = (typeof gameClock !== 'undefined' ? gameClock : performance.now());
    if (p.dashing || curTime < (p.dashCooldownUntil || 0)) return;
    let dx = 0, dy = 0;

    const localIndex = (typeof netManager !== 'undefined' && netManager && netManager.isClient) ? netManager.localPlayerIndex : 0;
    if (p.index === localIndex && typeof joystickInstance !== 'undefined' && joystickInstance && joystickInstance.vector && joystickInstance.vector.active) {
        dx = joystickInstance.vector.x;
        dy = joystickInstance.vector.y;
    } else if (p.keymap) {
        if (anyKey(p.keymap.up)) dy -= 1;
        if (anyKey(p.keymap.down)) dy += 1;
        if (anyKey(p.keymap.left)) dx -= 1;
        if (anyKey(p.keymap.right)) dx += 1;
    }
    const d = Math.hypot(dx, dy);
    if (d < 0.001) {
        dx = Math.cos(p.facingAngle || 0);
        dy = Math.sin(p.facingAngle || 0);
    }
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;

    const dashMs = (typeof PLAYER_DASH_MS !== 'undefined') ? PLAYER_DASH_MS : 300;
    const baseDashSpeed = (typeof PLAYER_DASH_SPEED !== 'undefined') ? PLAYER_DASH_SPEED : 7.0;

    p.dashing = true;
    p.dashBurstFired = false;
    p.dashUntil = curTime + dashMs;
    const dashSpeed = baseDashSpeed * (p.dashLvl2 ? 1.25 : 1.0);
    p.dashVx = (dx / len) * dashSpeed;
    p.dashVy = (dy / len) * dashSpeed;
    p.dashLaunchEffect = {
        startX: p.x,
        startY: p.y,
        angle: Math.atan2(dy, dx),
        startTime: curTime,
        duration: dashMs + 220,
        dashDuration: dashMs
    };
    if (typeof SoundEngine !== 'undefined' && SoundEngine.phaseDash) {
        SoundEngine.phaseDash();
    }
}

// ---------------- 2. Virtual Touch Joystick Controller ----------------

class JoystickController {
    constructor(zoneElement, thumbElement, maxRange = 45) {
        this.zone = zoneElement;
        this.thumb = thumbElement;
        this.maxRange = maxRange;
        this.active = false;
        this.pointerId = null;
        this.vector = { x: 0, y: 0, angle: 0, distance: 0, active: false };

        if (!this.zone || !this.thumb) return;

        this.zone.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        if (typeof window !== 'undefined') {
            window.addEventListener('pointermove', (e) => this.onPointerMove(e));
            window.addEventListener('pointerup', (e) => this.onPointerUp(e));
            window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
        }
    }

    onPointerDown(e) {
        this.active = true;
        this.pointerId = e.pointerId;
        try { this.zone.setPointerCapture(e.pointerId); } catch (err) {}
        this.cachedRect = this.zone.getBoundingClientRect();
        this.updatePosition(e);
    }

    onPointerMove(e) {
        if (!this.active || e.pointerId !== this.pointerId) return;
        this.updatePosition(e);
    }

    onPointerUp(e) {
        if (!this.active) return;
        if (e && this.pointerId !== null && e.pointerId !== this.pointerId) return;
        this.active = false;
        this.pointerId = null;
        if (this.thumb && this.thumb.style) {
            this.thumb.style.transform = 'translate(0px, 0px)';
        }
        this.vector = { x: 0, y: 0, angle: 0, distance: 0, active: false };
    }

    updatePosition(e) {
        const rect = this.cachedRect || (this.zone ? this.zone.getBoundingClientRect() : { left: 0, top: 0, width: 100, height: 100 });
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);

        const maxR = (this.zone && this.zone.clientWidth) ? (this.zone.clientWidth * 0.32) : this.maxRange;
        const visualDist = Math.min(dist, maxR);
        const vx = Math.cos(angle) * visualDist;
        const vy = Math.sin(angle) * visualDist;
        if (this.thumb && this.thumb.style) {
            this.thumb.style.transform = `translate(${vx}px, ${vy}px)`;
        }

        // Constant max movement speed along angle when active
        if (dist > 6) {
            this.vector = {
                x: Math.cos(angle),
                y: Math.sin(angle),
                angle: angle,
                distance: 1.0,
                active: true
            };
        } else {
            this.vector = { x: 0, y: 0, angle: 0, distance: 0, active: false };
        }
    }
}

// ---------------- 3. Network Client Input Sender ----------------

function sendClientLocalInput() {
    if (typeof netManager === 'undefined' || !netManager || !netManager.isClient) return;
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.players) return;
    const myIndex = netManager.localPlayerIndex;
    const myPlayer = GAME_STATE.players[myIndex];
    if (!myPlayer) return;

    let moveX = 0, moveY = 0;
    let hasJoystick = false;
    if (typeof joystickInstance !== 'undefined' && joystickInstance && joystickInstance.vector && joystickInstance.vector.active) {
        moveX = joystickInstance.vector.x;
        moveY = joystickInstance.vector.y;
        myPlayer.facingAngle = joystickInstance.vector.angle;
        hasJoystick = true;
    }
    if (!hasJoystick) {
        let dx = 0, dy = 0;
        const upKeys = (myPlayer.keymap && myPlayer.keymap.up) ? myPlayer.keymap.up : ['w', 'arrowup'];
        const downKeys = (myPlayer.keymap && myPlayer.keymap.down) ? myPlayer.keymap.down : ['s', 'arrowdown'];
        const leftKeys = (myPlayer.keymap && myPlayer.keymap.left) ? myPlayer.keymap.left : ['a', 'arrowleft'];
        const rightKeys = (myPlayer.keymap && myPlayer.keymap.right) ? myPlayer.keymap.right : ['d', 'arrowright'];

        if (anyKey(upKeys)) dy -= 1;
        if (anyKey(downKeys)) dy += 1;
        if (anyKey(leftKeys)) dx -= 1;
        if (anyKey(rightKeys)) dx += 1;
        if (dx !== 0 || dy !== 0) {
            if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }
            moveX = dx; moveY = dy;
        }
    }
    netManager.sendLocalInput(moveX, moveY, myPlayer.facingAngle, myPlayer.dashing);
}

// ---------------- 4. Global Input Event Listeners Setup ----------------

let joystickZone = null;
let joystickThumb = null;
let joystickInstance = null;

function initInputSystem() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    joystickZone = document.getElementById('joystickZone');
    joystickThumb = document.getElementById('joystickThumb');
    if (joystickZone && joystickThumb) {
        joystickInstance = new JoystickController(joystickZone, joystickThumb, 45);
        if (typeof window !== 'undefined') {
            window.joystickZone = joystickZone;
            window.joystickThumb = joystickThumb;
            window.joystickInstance = joystickInstance;
        }
    }

    // Audio gesture unlocks on first user gesture
    ['pointerdown', 'keydown', 'click'].forEach(evt => {
        window.addEventListener(evt, () => {
            if (typeof SoundEngine !== 'undefined' && SoundEngine.init) {
                SoundEngine.init();
                if (typeof GAME_STATE !== 'undefined' && (GAME_STATE.current === STATES.START_MENU || GAME_STATE.current === STATES.WEAPON_SELECT) && (!SoundEngine.isMusicPlaying || SoundEngine.musicMode !== 'menu') && !SoundEngine.isMusicMuted) {
                    SoundEngine.startMenuMusic();
                }
            }
        }, { once: false, passive: true });
    });

    // Auto-suspend audio on tab blur/hide
    document.addEventListener('visibilitychange', () => {
        if (typeof SoundEngine !== 'undefined' && SoundEngine.ctx) {
            if (document.hidden) {
                SoundEngine.ctx.suspend().catch(() => {});
            } else {
                SoundEngine.ctx.resume().catch(() => {});
            }
        }
    });

    // Hotkeys & keyup / keydown handlers
    window.addEventListener('keydown', (e) => {
        if (e.key && !e.repeat) {
            const k = e.key.toLowerCase();
            // Feature flag: toggle testing lab with section sign '§' or '`' / '~' (on start menu)
            if ((k === '§' || k === '`' || k === '~') && typeof GAME_STATE !== 'undefined' && GAME_STATE.current === STATES.START_MENU) {
                ENABLE_TESTING_LAB = !Boolean(window.ENABLE_TESTING_LAB);
                if (typeof window !== 'undefined') window.ENABLE_TESTING_LAB = ENABLE_TESTING_LAB;
                const tBtn = document.getElementById('testingBtn');
                if (tBtn) tBtn.style.display = ENABLE_TESTING_LAB ? 'block' : 'none';
            }
            // Audio toggle hotkeys
            if (k === 'm' && typeof SoundEngine !== 'undefined') {
                SoundEngine.init();
                SoundEngine.toggleMute();
            } else if (k === 'n' && typeof SoundEngine !== 'undefined') {
                SoundEngine.init();
                SoundEngine.toggleMusicMute();
            }
        }

        // Escape handling
        if (e.key === 'Escape' || e.key === 'Esc') {
            if (typeof GAME_STATE !== 'undefined' && (GAME_STATE.current === STATES.GAMEPLAY || GAME_STATE.current === STATES.PAUSED)) {
                if (typeof togglePause === 'function') {
                    togglePause();
                    return;
                }
            } else {
                const expModal = document.getElementById('expectedLevelsModal');
                const fxModal = document.getElementById('fxSoundsModal');
                const cfgModal = document.getElementById('testingConfigModal');
                const testModal = document.getElementById('testingModal');
                if (expModal && expModal.classList.contains('show')) {
                    expModal.classList.remove('show');
                    return;
                } else if (fxModal && fxModal.classList.contains('show')) {
                    fxModal.classList.remove('show');
                    return;
                } else if (cfgModal && cfgModal.classList.contains('show')) {
                    cfgModal.classList.remove('show');
                    if (testModal) testModal.classList.add('show');
                    return;
                } else if (testModal && testModal.classList.contains('show')) {
                    testModal.classList.remove('show');
                    if (typeof showStartMenu === 'function') {
                        showStartMenu();
                    } else {
                        const tBtn = document.getElementById('testingBtn');
                        if (tBtn && typeof ENABLE_TESTING_LAB !== 'undefined') tBtn.style.display = ENABLE_TESTING_LAB ? 'block' : 'none';
                        const sMenu = document.getElementById('startMenu');
                        if (sMenu) sMenu.classList.add('show');
                    }
                    return;
                } else if (document.getElementById('startMenu') && document.getElementById('startMenu').classList.contains('show')) {
                    const diffStep = document.getElementById('difficultyStep');
                    if (diffStep && diffStep.style.display !== 'none' && (typeof isMobile === 'undefined' || !isMobile) && typeof showStartStep === 'function') {
                        showStartStep('players');
                        return;
                    }
                }
            }
        }

        const k = e.key.toLowerCase();
        const fresh = !keys[k];
        keys[k] = true;
        if (fresh) handleDoubleTap(k);
    });

    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });

    // Sound toggle buttons
    const soundBtn = document.getElementById('soundToggleBtn');
    if (soundBtn) {
        soundBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof SoundEngine !== 'undefined') {
                SoundEngine.init();
                SoundEngine.toggleMute();
            }
        };
    }

    const musicBtn = document.getElementById('musicToggleBtn');
    if (musicBtn) {
        musicBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof SoundEngine !== 'undefined') {
                SoundEngine.init();
                SoundEngine.toggleMusicMute();
            }
        };
    }
}

// Auto-initialize if DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initInputSystem);
    } else {
        initInputSystem();
    }
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== 'undefined') {
    window.keys = keys;
    window.anyKey = anyKey;
    window.handleDoubleTap = handleDoubleTap;
    window.tryStartDash = tryStartDash;
    window.JoystickController = JoystickController;
    window.sendClientLocalInput = sendClientLocalInput;
    window.initInputSystem = initInputSystem;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        keys,
        anyKey,
        handleDoubleTap,
        tryStartDash,
        JoystickController,
        sendClientLocalInput,
        initInputSystem
    };
}
