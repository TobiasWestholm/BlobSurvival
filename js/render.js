/**
 * BlobSurvival - 2D Canvas Renderer & Viewport Manager
 */

let canvas =
    typeof document !== 'undefined'
        ? document.getElementById('gameCanvas')
        : null;
let ctx = canvas ? canvas.getContext('2d') : null;
/** Simulation / world arena size (laptop standard on mobile). */
let W = typeof window !== 'undefined' ? window.innerWidth : 1512;
let H = typeof window !== 'undefined' ? window.innerHeight : 900;

/** Normal laptop battlefield — used for mobile hosts and as the online sim size. */
const STANDARD_ARENA_W = 1512;
const STANDARD_ARENA_H = 900;
/**
 * Mobile zoom-in is keyed off blob on-screen size (CSS pixels), not arena size.
 * Player base radius is 15 world units — keep in sync with Player constructor.
 */
const MOBILE_BLOB_WORLD_R = 15;
/** Target blob radius in CSS pixels at maximum zoom-in (same on every phone). */
const MOBILE_ZOOM_IN_BLOB_RADIUS_PX = 15;
/** Soft follow: higher = snappier. Deadzone keeps the blob off strict center. */
const MOBILE_CAM_FOLLOW = 5.5;
const MOBILE_CAM_DEADZONE = 0.3; // fraction of view from each edge before camera moves
/** Assertive zoom step lerp (higher = snappier snap between discrete levels). */
const MOBILE_ZOOM_FOLLOW = 9;
/** Discrete zoom levels: 0 = max out (fit one arena dim), 1 = max in. */
const MOBILE_ZOOM_STEP_COUNT = 2;
/**
 * Hysteresis gates (total alive battlefield entities).
 * UP[i] = count needed to leave step i toward zoom-in (i → i+1).
 * DOWN[i] = count needed to leave step i+1 toward zoom-out (i+1 → i).
 * DOWN < UP so the zoom does not chatter at band edges.
 */
const MOBILE_ZOOM_STEP_UP = [70];
const MOBILE_ZOOM_STEP_DOWN = [40];
const MOBILE_ZOOM_STEP_COOLDOWN_MS = 550;

/** Canvas buffer size (phone pixels when mobile camera is on; else equals W/H). */
let viewW = W;
let viewH = H;
let mobileCameraActive = false;
let camX = 0;
let camY = 0;
let camZoom = 1;
/** Current discrete zoom step (0 = zoomed out … N-1 = zoomed in). */
let mobileZoomStep = MOBILE_ZOOM_STEP_COUNT - 1;
let mobileZoomTarget = 1;
let _camLastNow = 0;
let _zoomStepCooldownUntil = 0;

/** Extra padding so large sprites / trail ends near the edge aren't clipped early. */
const VIEW_CULL_MARGIN = 64;

function syncWindowArenaSize() {
    if (typeof window === 'undefined') return;
    window.W = W;
    window.H = H;
    window.viewW = viewW;
    window.viewH = viewH;
    window.mobileCameraActive = mobileCameraActive;
    window.camX = camX;
    window.camY = camY;
    window.camZoom = camZoom;
    window.mobileZoomStep = mobileZoomStep;
    window.mobileZoomTarget = mobileZoomTarget;
}

function shouldUseMobileCamera() {
    const mobile =
        typeof isMobile !== 'undefined'
            ? isMobile
            : typeof window !== 'undefined' && window.isMobile;
    if (!mobile) return false;
    // Shared-screen local co-op needs the full field on one device.
    // Singleplayer + online host/client all use the density zoom camera.
    if (
        typeof GAME_STATE !== 'undefined' &&
        GAME_STATE.gameMode === 'local'
    ) {
        return false;
    }
    return true;
}

function getCanvasBufW() {
    return mobileCameraActive ? viewW : W;
}

function getCanvasBufH() {
    return mobileCameraActive ? viewH : H;
}

function getViewWorldSize() {
    if (!mobileCameraActive || camZoom <= 0) {
        return { vw: W, vh: H };
    }
    return { vw: viewW / camZoom, vh: viewH / camZoom };
}

function getViewCullBounds() {
    if (!mobileCameraActive) {
        return { minX: 0, minY: 0, maxX: W, maxY: H };
    }
    const { vw, vh } = getViewWorldSize();
    return {
        minX: camX,
        minY: camY,
        maxX: camX + vw,
        maxY: camY + vh,
    };
}

/**
 * True if a point+radius overlaps the visible view (with margin).
 * Used to skip draw() for off-screen entities.
 */
function isInView(x, y, radius = 0) {
    const m = VIEW_CULL_MARGIN + (radius || 0);
    const b = getViewCullBounds();
    return (
        x >= b.minX - m &&
        x <= b.maxX + m &&
        y >= b.minY - m &&
        y <= b.maxY + m
    );
}

/**
 * True if an entity should be drawn this frame.
 * Prefers AABB (trails/hazards); otherwise uses center + visual radius.
 * Players are not culled by callers (few, flail/overlay).
 */
function isEntityInView(e) {
    if (!e) return false;
    const b = getViewCullBounds();
    if (
        e.minX !== undefined &&
        e.maxX !== undefined &&
        e.minY !== undefined &&
        e.maxY !== undefined
    ) {
        const m = VIEW_CULL_MARGIN;
        return (
            e.maxX >= b.minX - m &&
            e.minX <= b.maxX + m &&
            e.maxY >= b.minY - m &&
            e.minY <= b.maxY + m
        );
    }
    if (e.x1 !== undefined && e.y1 !== undefined && e.x2 !== undefined) {
        const m = VIEW_CULL_MARGIN + (e.r || 25);
        const minX = Math.min(e.x1, e.x2);
        const maxX = Math.max(e.x1, e.x2);
        const minY = Math.min(e.y1, e.y2);
        const maxY = Math.max(e.y1, e.y2);
        return (
            maxX >= b.minX - m &&
            minX <= b.maxX + m &&
            maxY >= b.minY - m &&
            minY <= b.maxY + m
        );
    }
    let r = e.r || 0;
    if (e.sr) r = Math.max(r, e.sr);
    // Long combat visuals (viper / behemoth tongue) that can reach into view
    if (e.tongueRange) r = Math.max(r, e.tongueRange);
    if (typeof e.isBoss === 'function' && e.isBoss()) r = Math.max(r, 200);
    return isInView(e.x, e.y, r);
}

function getCameraFollowPlayer() {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.players) return null;
    let idx = 0;
    if (
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager &&
        netManager.localPlayerIndex !== undefined
    ) {
        idx = netManager.localPlayerIndex;
    }
    const p = GAME_STATE.players[idx];
    if (p && !p.disconnected && !p.kicked) return p;
    for (let i = 0; i < GAME_STATE.players.length; i++) {
        const q = GAME_STATE.players[i];
        if (q && !q.disconnected && !q.kicked) return q;
    }
    return null;
}

function clampMobileCamera() {
    const { vw, vh } = getViewWorldSize();
    const maxX = Math.max(0, W - vw);
    const maxY = Math.max(0, H - vh);
    camX = Math.max(0, Math.min(maxX, camX));
    camY = Math.max(0, Math.min(maxY, camY));
}

/**
 * Max zoom-out: stop when the first arena edge is matched (cover).
 * Uses max(viewW/W, viewH/H) so one axis is filled and the camera can
 * still pan on the other — never a full-battlefield contain fit.
 */
function getMobileMaxZoomOut() {
    if (viewW <= 0 || viewH <= 0 || W <= 0 || H <= 0) return 1;
    return Math.max(viewW / W, viewH / H);
}

function getMobileMaxZoomIn() {
    const zBlob =
        MOBILE_ZOOM_IN_BLOB_RADIUS_PX / Math.max(1, MOBILE_BLOB_WORLD_R);
    const zOut = getMobileMaxZoomOut();
    // Former 3-step middle (halfway to the old blob/cover max-in) is now max-in.
    const oldMaxIn = Math.max(zBlob, zOut * 1.06);
    return zOut + (oldMaxIn - zOut) * 0.5;
}

function getMobileZoomForStep(step) {
    const maxStep = MOBILE_ZOOM_STEP_COUNT - 1;
    const s = Math.max(0, Math.min(maxStep, step));
    const zoomOut = getMobileMaxZoomOut();
    const zoomIn = getMobileMaxZoomIn();
    if (maxStep <= 0) return zoomIn;
    const t = s / maxStep; // 0 = out, 1 = in
    return zoomOut + (zoomIn - zoomOut) * t;
}

function countAliveEntitiesIn(arr) {
    if (!arr?.length) return 0;
    let n = 0;
    for (let i = 0; i < arr.length; i++) {
        const o = arr[i];
        if (!o) continue;
        if (o.alive === false) continue;
        if (typeof o.hp === 'number' && o.hp <= 0) continue;
        n++;
    }
    return n;
}

/** Total live battlefield entities — stabler density signal than enemies alone. */
function countBattlefieldEntitiesForZoom() {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE) return 0;
    return (
        countAliveEntitiesIn(GAME_STATE.enemies) +
        countAliveEntitiesIn(GAME_STATE.projectiles) +
        countAliveEntitiesIn(GAME_STATE.enemyProjectiles) +
        countAliveEntitiesIn(GAME_STATE.turrets) +
        countAliveEntitiesIn(GAME_STATE.hazards) +
        countAliveEntitiesIn(GAME_STATE.gems) +
        countAliveEntitiesIn(GAME_STATE.particles) +
        countAliveEntitiesIn(GAME_STATE.magneticMines) +
        countAliveEntitiesIn(GAME_STATE.terrains)
    );
}

/** Initial step from density (no hysteresis) — used on camera snap / resize. */
function pickMobileZoomStepFromCount(count) {
    const maxStep = MOBILE_ZOOM_STEP_COUNT - 1;
    for (let s = maxStep - 1; s >= 0; s--) {
        if (count >= MOBILE_ZOOM_STEP_UP[s]) return s + 1;
    }
    return 0;
}

/**
 * Pick discrete zoom step from total entity density with hysteresis + cooldown
 * so zoom snaps assertively and does not flicker between levels.
 * Same path for singleplayer and online on phone.
 */
function updateMobileZoomStep(nowMs) {
    const count = countBattlefieldEntitiesForZoom();
    const maxStep = MOBILE_ZOOM_STEP_COUNT - 1;
    if (mobileZoomStep > maxStep) mobileZoomStep = maxStep;
    if (nowMs < _zoomStepCooldownUntil) {
        mobileZoomTarget = getMobileZoomForStep(mobileZoomStep);
        return;
    }

    let next = mobileZoomStep;
    // Prefer zoom-in when crowded (one step at a time)
    if (
        next < maxStep &&
        count >=
            MOBILE_ZOOM_STEP_UP[
                Math.min(next, MOBILE_ZOOM_STEP_UP.length - 1)
            ]
    ) {
        next += 1;
    } else if (next > 0 && count <= MOBILE_ZOOM_STEP_DOWN[next - 1]) {
        next -= 1;
    }

    if (next !== mobileZoomStep) {
        mobileZoomStep = next;
        _zoomStepCooldownUntil = nowMs + MOBILE_ZOOM_STEP_COOLDOWN_MS;
    }
    mobileZoomTarget = getMobileZoomForStep(mobileZoomStep);
}

function applyMobileZoomToward(targetZoom, dt, focusX, focusY) {
    const oldZ = camZoom;
    if (!(oldZ > 0) || !(targetZoom > 0)) return;
    const k = 1 - Math.exp(-MOBILE_ZOOM_FOLLOW * dt);
    let next = oldZ + (targetZoom - oldZ) * k;
    // Hard-snap when nearly there so we never hover mid-step
    if (Math.abs(targetZoom - next) < 0.004 * Math.max(targetZoom, oldZ)) {
        next = targetZoom;
    }
    if (focusX != null && focusY != null) {
        const sx = (focusX - camX) * oldZ;
        const sy = (focusY - camY) * oldZ;
        camZoom = next;
        camX = focusX - sx / camZoom;
        camY = focusY - sy / camZoom;
    } else {
        camZoom = next;
    }
}

function snapMobileCameraToFollow() {
    if (!mobileCameraActive) return;
    // Place at the density-appropriate step immediately (solo early game = zoomed out)
    mobileZoomStep = pickMobileZoomStepFromCount(
        countBattlefieldEntitiesForZoom(),
    );
    mobileZoomTarget = getMobileZoomForStep(mobileZoomStep);
    camZoom = mobileZoomTarget;
    _zoomStepCooldownUntil = 0;
    const { vw, vh } = getViewWorldSize();
    const p = getCameraFollowPlayer();
    if (p) {
        camX = p.x - vw * 0.5;
        camY = p.y - vh * 0.5;
    } else {
        camX = W * 0.5 - vw * 0.5;
        camY = H * 0.5 - vh * 0.5;
    }
    clampMobileCamera();
    _camLastNow = 0;
}

/**
 * Smooth deadzone follow — camera only moves when the blob leaves the
 * central band, then eases toward that edge (not hard-locked to center).
 * Zoom steps assertively with enemy-count hysteresis.
 */
function updateMobileCamera(now) {
    if (!mobileCameraActive) return;
    const t =
        typeof now === 'number' && !Number.isNaN(now)
            ? now
            : typeof performance !== 'undefined'
              ? performance.now()
              : 0;
    let dt = _camLastNow > 0 ? (t - _camLastNow) / 1000 : 1 / 60;
    _camLastNow = t;
    if (dt < 0) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;

    const p = getCameraFollowPlayer();
    updateMobileZoomStep(t);
    applyMobileZoomToward(
        mobileZoomTarget,
        dt,
        p ? p.x : null,
        p ? p.y : null,
    );

    if (!p) {
        clampMobileCamera();
        return;
    }

    const { vw, vh } = getViewWorldSize();
    const dz = MOBILE_CAM_DEADZONE;
    const deadL = vw * dz;
    const deadR = vw * (1 - dz);
    const deadT = vh * dz;
    const deadB = vh * (1 - dz);

    let targetX = camX;
    let targetY = camY;
    const relX = p.x - camX;
    const relY = p.y - camY;
    if (relX < deadL) targetX = p.x - deadL;
    else if (relX > deadR) targetX = p.x - deadR;
    if (relY < deadT) targetY = p.y - deadT;
    else if (relY > deadB) targetY = p.y - deadB;

    const k = 1 - Math.exp(-MOBILE_CAM_FOLLOW * dt);
    camX += (targetX - camX) * k;
    camY += (targetY - camY) * k;
    clampMobileCamera();
}

function applyCameraTransform() {
    if (!ctx || !mobileCameraActive) return;
    ctx.setTransform(
        camZoom,
        0,
        0,
        camZoom,
        -camX * camZoom,
        -camY * camZoom,
    );
}

function resetScreenTransform() {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function initCanvasElements() {
    if (typeof document !== 'undefined') {
        if (!canvas) canvas = document.getElementById('gameCanvas');
        if (canvas && !ctx) ctx = canvas.getContext('2d');
        // Safari can start element/text selection on double-tap without these.
        if (canvas && !canvas._selectionGuardsBound) {
            canvas._selectionGuardsBound = true;
            const block = (e) => {
                try {
                    e.preventDefault();
                } catch {}
            };
            canvas.addEventListener('selectstart', block);
            canvas.addEventListener('gesturestart', block);
            canvas.addEventListener('contextmenu', block);
        }
    }
    if (!ctx) {
        if (typeof window !== 'undefined' && window.ctx) ctx = window.ctx;
    }
}

function dismissRotateHint() {
    if (typeof window !== 'undefined') window._rotateHintDismissed = true;
    const hint =
        typeof document !== 'undefined'
            ? document.getElementById('rotateHint')
            : null;
    if (hint) hint.style.display = 'none';
}

function updateRotateHint() {
    const hint =
        typeof document !== 'undefined'
            ? document.getElementById('rotateHint')
            : null;
    if (!hint) return;
    const isMobileDevice =
        typeof isMobile !== 'undefined'
            ? isMobile
            : (typeof window !== 'undefined' && window.isMobile) || false;
    const isOnlineClient =
        typeof GAME_STATE !== 'undefined' &&
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager?.isClient;
    const isPortrait =
        typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
    const hostIsWidescreen =
        typeof GAME_STATE !== 'undefined' &&
        (GAME_STATE.hostW || 1512) > (GAME_STATE.hostH || 900);

    // Zoomed mobile camera works in portrait — only nudge rotate when
    // a desktop client is letterboxing a widescreen host without camera.
    if (
        isMobileDevice &&
        isOnlineClient &&
        !shouldUseMobileCamera() &&
        hostIsWidescreen &&
        isPortrait &&
        !(typeof window !== 'undefined' && window._rotateHintDismissed)
    ) {
        hint.style.display = 'flex';
    } else {
        hint.style.display = 'none';
    }
}

function resizeCanvas() {
    initCanvasElements();
    if (!canvas) return;

    const rawW =
        typeof window !== 'undefined'
            ? window.innerWidth || document.documentElement.clientWidth || 1512
            : 1512;
    const rawH =
        typeof window !== 'undefined'
            ? window.innerHeight || document.documentElement.clientHeight || 900
            : 900;
    const isOnlineClient =
        typeof GAME_STATE !== 'undefined' &&
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager?.isClient;
    const isOnlineHost =
        typeof GAME_STATE !== 'undefined' &&
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager?.isHost;

    // --- Mobile zoomed camera (solo + online host/client; not local co-op) ---
    if (shouldUseMobileCamera()) {
        if (isOnlineClient && GAME_STATE.hostW && GAME_STATE.hostH) {
            W = GAME_STATE.hostW;
            H = GAME_STATE.hostH;
        } else {
            // Phone host / solo: fixed laptop-sized battlefield
            W = STANDARD_ARENA_W;
            H = STANDARD_ARENA_H;
            if (typeof GAME_STATE !== 'undefined') {
                GAME_STATE.hostW = W;
                GAME_STATE.hostH = H;
            }
        }

        viewW = Math.max(1, Math.round(rawW));
        viewH = Math.max(1, Math.round(rawH));
        canvas.width = viewW;
        canvas.height = viewH;
        canvas.style.width = `${rawW}px`;
        canvas.style.height = `${rawH}px`;
        canvas.style.position = 'fixed';
        canvas.style.top = '50%';
        canvas.style.left = '50%';
        canvas.style.transform = 'translate(-50%, -50%)';

        mobileCameraActive = true;
        // Density step + framing for this buffer/arena (single + online phone)
        snapMobileCameraToFollow();

        if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.init) {
            SPATIAL_GRID.init(W, H);
        }
        syncWindowArenaSize();
        updateRotateHint();

        // Phone host: push arena size to clients
        if (
            isOnlineHost &&
            netManager.connections &&
            netManager.connections.size > 0 &&
            typeof serializeWorldForNetwork === 'function'
        ) {
            netManager.broadcastWorldSnapshot(serializeWorldForNetwork());
        }
        return;
    }

    mobileCameraActive = false;
    camZoom = 1;
    camX = 0;
    camY = 0;

    if (isOnlineClient && GAME_STATE.hostW && GAME_STATE.hostH) {
        // Desktop client: full arena buffer, CSS-fit to window (letterbox)
        W = GAME_STATE.hostW;
        H = GAME_STATE.hostH;
        viewW = W;
        viewH = H;
        canvas.width = W;
        canvas.height = H;

        const ratioW = W / rawW;
        const ratioH = H / rawH;

        let displayW, displayH;
        if (ratioW > ratioH) {
            displayW = rawW;
            displayH = Math.round(rawW * (H / W));
        } else {
            displayH = rawH;
            displayW = Math.round(rawH * (W / H));
        }

        canvas.style.width = `${displayW}px`;
        canvas.style.height = `${displayH}px`;
        canvas.style.position = 'fixed';
        canvas.style.top = '50%';
        canvas.style.left = '50%';
        canvas.style.transform = 'translate(-50%, -50%)';

        if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.init) {
            SPATIAL_GRID.init(W, H);
        }
        syncWindowArenaSize();
        updateRotateHint();
        return;
    }

    // Desktop / local: arena scales from window (laptop-width baseline)
    const targetArenaWidth = 1512;
    const scale = targetArenaWidth / rawW;
    W = Math.round(rawW * scale);
    H = Math.round(rawH * scale);
    viewW = W;
    viewH = H;
    canvas.width = W;
    canvas.height = H;

    canvas.style.width = `${rawW}px`;
    canvas.style.height = `${rawH}px`;
    canvas.style.position = 'fixed';
    canvas.style.top = '50%';
    canvas.style.left = '50%';
    canvas.style.transform = 'translate(-50%, -50%)';

    if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.init) {
        SPATIAL_GRID.init(W, H);
    }
    syncWindowArenaSize();

    // Push / clamp all active entities within new boundaries if resized mid-game
    if (typeof GAME_STATE !== 'undefined') {
        if (GAME_STATE.players) {
            for (const p of GAME_STATE.players) {
                if (p && typeof p.clampToArena === 'function') p.clampToArena();
            }
        }
        if (GAME_STATE.turrets) {
            for (const t of GAME_STATE.turrets) {
                t.x = Math.max(15, Math.min(W - 15, t.x));
                t.y = Math.max(15, Math.min(H - 15, t.y));
            }
        }
        if (GAME_STATE.hazards) {
            for (const h of GAME_STATE.hazards) {
                if (h.x !== undefined)
                    h.x = Math.max(15, Math.min(W - 15, h.x));
                if (h.y !== undefined)
                    h.y = Math.max(15, Math.min(H - 15, h.y));
                if (h.x1 !== undefined)
                    h.x1 = Math.max(15, Math.min(W - 15, h.x1));
                if (h.y1 !== undefined)
                    h.y1 = Math.max(15, Math.min(H - 15, h.y1));
                if (h.x2 !== undefined)
                    h.x2 = Math.max(15, Math.min(W - 15, h.x2));
                if (h.y2 !== undefined)
                    h.y2 = Math.max(15, Math.min(H - 15, h.y2));
            }
        }
        if (GAME_STATE.magneticMines) {
            for (const m of GAME_STATE.magneticMines) {
                m.x = Math.max(15, Math.min(W - 15, m.x));
                m.y = Math.max(15, Math.min(H - 15, m.y));
            }
        }
        if (GAME_STATE.gems) {
            for (const g of GAME_STATE.gems) {
                g.x = Math.max(15, Math.min(W - 15, g.x));
                g.y = Math.max(15, Math.min(H - 15, g.y));
            }
        }
    }

    updateRotateHint();

    // If hosting in multiplayer, broadcast updated dimensions to clients immediately
    if (
        typeof netManager !== 'undefined' &&
        netManager &&
        netManager.isHost &&
        netManager.connections &&
        netManager.connections.size > 0 &&
        typeof serializeWorldForNetwork === 'function'
    ) {
        netManager.broadcastWorldSnapshot(serializeWorldForNetwork());
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => {
        setTimeout(resizeCanvas, 120);
    });
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', resizeCanvas);
    } else {
        resizeCanvas();
    }
}

// ---------------- Color Shaders & Math ----------------
const _shadeHexCache = new Map();
function shadeHex(hex, factor) {
    const key = hex + '_' + factor;
    const cached = _shadeHexCache.get(key);
    if (cached !== undefined) return cached;

    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!m) {
        _shadeHexCache.set(key, hex);
        return hex;
    }
    let h = m[1];
    if (h.length === 3)
        h = h
            .split('')
            .map((c) => c + c)
            .join('');
    const num = parseInt(h, 16);
    const comps = [(num >> 16) & 255, (num >> 8) & 255, num & 255].map((v) =>
        Math.max(0, Math.min(255, Math.round(v * factor))),
    );
    const res =
        '#' + comps.map((v) => v.toString(16).padStart(2, '0')).join('');
    _shadeHexCache.set(key, res);
    return res;
}

function brightenColor(hex, factor = 1.8) {
    if (hex?.[0] !== '#' || hex.length !== 7) return '#dd88ff';
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.min(255, Math.round(r * factor + 50));
    g = Math.min(255, Math.round(g * factor + 50));
    b = Math.min(255, Math.round(b * factor + 50));
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function drawBattlefieldBorder(now) {
    const isOnlineClient =
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager?.isClient;
    const hostW = GAME_STATE.hostW || W;
    const hostH = GAME_STATE.hostH || H;

    // Online clients + letterboxed hosts need the host bounds mark.
    // Mobile camera (solo included) pans/zooms a window onto the arena — always show edges.
    if (
        !mobileCameraActive &&
        !isOnlineClient &&
        hostW === W &&
        hostH === H
    ) {
        return;
    }

    ctx.save();

    // 1. Darken out-of-bounds area outside the host battlefield
    ctx.fillStyle = 'rgba(8, 10, 14, 0.65)';
    if (W > hostW) {
        ctx.fillRect(hostW, 0, W - hostW, H);
    }
    if (H > hostH) {
        ctx.fillRect(0, hostH, Math.min(W, hostW), H - hostH);
    }

    // Subtle decorative diagonal hatch lines in off-limits area
    if (W > hostW || H > hostH) {
        ctx.save();
        ctx.beginPath();
        if (W > hostW) ctx.rect(hostW, 0, W - hostW, H);
        if (H > hostH) ctx.rect(0, hostH, Math.min(W, hostW), H - hostH);
        ctx.clip();

        ctx.strokeStyle = 'rgba(0, 255, 204, 0.05)';
        ctx.lineWidth = 1.5;
        const step = 32;
        ctx.beginPath();
        for (let x = -H; x < W + H; x += step) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x + H, H);
        }
        ctx.stroke();
        ctx.restore();
    }

    // 2. Smokey teal glowing border line around [0, 0, hostW, hostH]
    const pulse = 0.7 + 0.3 * Math.sin(now * 0.004);

    // Outer diffuse smoke glow
    ctx.save();
    ctx.strokeStyle = `rgba(0, 230, 200, ${(0.35 * pulse).toFixed(2)})`;
    ctx.lineWidth = 6;
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 14 + 6 * pulse;
    ctx.strokeRect(0, 0, hostW, hostH);
    ctx.restore();

    // Middle smokey teal line
    ctx.save();
    ctx.strokeStyle = `rgba(0, 245, 215, ${(0.75 + 0.25 * pulse).toFixed(2)})`;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(0, 0, hostW, hostH);
    ctx.restore();

    // Futuristic corner brackets at all 4 battlefield corners
    const cSize = Math.min(28, Math.min(hostW, hostH) * 0.1);
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'square';
    // Top-Left
    ctx.beginPath();
    ctx.moveTo(0, cSize);
    ctx.lineTo(0, 0);
    ctx.lineTo(cSize, 0);
    ctx.stroke();
    // Top-Right
    ctx.beginPath();
    ctx.moveTo(hostW - cSize, 0);
    ctx.lineTo(hostW, 0);
    ctx.lineTo(hostW, cSize);
    ctx.stroke();
    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(0, hostH - cSize);
    ctx.lineTo(0, hostH);
    ctx.lineTo(cSize, hostH);
    ctx.stroke();
    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(hostW - cSize, hostH);
    ctx.lineTo(hostW, hostH);
    ctx.lineTo(hostW, hostH - cSize);
    ctx.stroke();

    ctx.restore();
}

function drawGems(
    now = typeof gameClock !== 'undefined' ? gameClock : performance.now(),
) {
    if (!ctx) initCanvasElements();
    if (!ctx) return;
    const gems = GAME_STATE.gems;
    const len = gems.length;
    if (len === 0) return;

    // Pass 1: Outer diamond body for all standard XP gems (batched into 1 draw call)
    ctx.fillStyle = '#a3a380';
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
        const g = gems[i];
        if (g instanceof XPGem && isEntityInView(g)) {
            const gx = g.x,
                gy = g.y,
                gr = g.r;
            ctx.moveTo(gx, gy - gr);
            ctx.lineTo(gx + gr, gy);
            ctx.lineTo(gx, gy + gr);
            ctx.lineTo(gx - gr, gy);
            ctx.closePath();
        }
    }
    ctx.fill();

    // Pass 2: Inner shiny core diamond for all standard XP gems (batched into 1 draw call)
    ctx.fillStyle = '#999960';
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
        const g = gems[i];
        if (g instanceof XPGem && isEntityInView(g)) {
            const gx = g.x,
                gy = g.y,
                cr = g.r * 0.4;
            ctx.moveTo(gx, gy - cr);
            ctx.lineTo(gx + cr, gy);
            ctx.lineTo(gx, gy + cr);
            ctx.lineTo(gx - cr, gy);
            ctx.closePath();
        }
    }
    ctx.fill();

    // Pass 3: Dedicated rendering pass for custom non-XPGem items (HealthPack, SupplyDrop)
    for (let i = 0; i < len; i++) {
        const g = gems[i];
        if (
            !(g instanceof XPGem) &&
            typeof g.draw === 'function' &&
            isEntityInView(g)
        ) {
            g.draw(now);
        }
    }
}

function drawParticles(now) {
    const particles = GAME_STATE.particles;
    const len = particles.length;
    if (len === 0) return;
    const curNow =
        typeof now === 'number'
            ? now
            : typeof gameClock !== 'undefined'
              ? gameClock
              : performance.now();
    for (let i = 0; i < len; i++) {
        const p = particles[i];
        if (!p || p.alive === false) continue;
        if (!isInView(p.x, p.y, p.r || 8)) continue;
        if (typeof p.draw === 'function' && p.constructor !== Particle) {
            p.draw(curNow, ctx); // Custom complex particles (e.g. GoldenPillarParticle, LifestealWisp, CombatVFX)
        } else {
            ctx.globalAlpha =
                typeof p.getLifetimePercent === 'function'
                    ? p.getLifetimePercent()
                    : Math.max(
                          0,
                          (p.lifetime !== undefined ? p.lifetime : p.life) /
                              (p.maxLifetime || p.maxLife || 1),
                      );
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
        }
    }
    ctx.globalAlpha = 1.0;
}

function draw(now) {
    const bufW = getCanvasBufW();
    const bufH = getCanvasBufH();

    resetScreenTransform();
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, bufW, bufH);

    if (mobileCameraActive) {
        updateMobileCamera(now);
        applyCameraTransform();
    }

    // subtle grid (single path / single stroke) — only cells overlapping the view
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    const grid = 80;
    const vb = getViewCullBounds();
    const gridMinX = Math.floor((vb.minX - grid) / grid) * grid;
    const gridMaxX = Math.ceil((vb.maxX + grid) / grid) * grid;
    const gridMinY = Math.floor((vb.minY - grid) / grid) * grid;
    const gridMaxY = Math.ceil((vb.maxY + grid) / grid) * grid;
    ctx.beginPath();
    for (let x = gridMinX; x <= gridMaxX; x += grid) {
        ctx.moveTo(x, gridMinY);
        ctx.lineTo(x, gridMaxY);
    }
    for (let y = gridMinY; y <= gridMaxY; y += grid) {
        ctx.moveTo(gridMinX, y);
        ctx.lineTo(gridMaxX, y);
    }
    ctx.stroke();

    // Draw Smokey Teal Host Battlefield Border
    drawBattlefieldBorder(now);

    // Draw Martyrdom Auras
    for (const p of GAME_STATE.players) {
        if (!p || p.disconnected || p.kicked) continue;
        if (!p.alive && p.martyrdomAuraEnabled) {
            ctx.save();
            const baseRadius =
                110 *
                (p.martyrsPresenceEnabled
                    ? 1 +
                      GAME_CONFIG.UPGRADES.MARTYRS_PRESENCE_RADIUS_BOOST_PCT /
                          100
                    : 1.0) *
                ((GAME_STATE.difficulty
                    ? GAME_STATE.difficulty.difficultyMultiplier || 1.0
                    : 1.0) /
                    2 +
                    0.5);
            const pulse = 1 + Math.sin(now * 0.005) * 0.06;
            const radius = baseRadius * pulse;
            const grad = ctx.createRadialGradient(
                p.x,
                p.y,
                5,
                p.x,
                p.y,
                radius,
            );
            grad.addColorStop(0, 'rgba(255, 215, 0, 0.25)'); // Golden center
            grad.addColorStop(0.7, 'rgba(255, 223, 0, 0.1)'); // Soft fade
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Fully transparent edge
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    if (GAME_STATE.terrains) {
        for (const t of GAME_STATE.terrains) {
            if (isEntityInView(t)) t.draw(now);
        }
    }
    for (const t of GAME_STATE.turrets) {
        if (isEntityInView(t)) t.draw(now);
    }
    for (const hz of GAME_STATE.hazards) {
        if (hz && hz.alive !== false && isEntityInView(hz)) hz.draw(now);
    }
    drawGems(now);

    // XP Tutorial arrow: point at the very first gem until it is picked up
    if (GAME_STATE.firstXpGem?.alive) {
        const gem = GAME_STATE.firstXpGem;
        // Base arrow origin on local player (or closest living player if local is dead)
        let playerX = W / 2,
            playerY = H / 2;
        const localIdx =
            typeof netManager !== 'undefined' &&
            netManager &&
            netManager.localPlayerIndex !== undefined
                ? netManager.localPlayerIndex
                : 0;
        const localPlayer = GAME_STATE.players[localIdx];
        if (localPlayer?.alive && !localPlayer.disconnected) {
            playerX = localPlayer.x;
            playerY = localPlayer.y;
        } else {
            for (const p of GAME_STATE.players) {
                if (p?.alive && !p.disconnected) {
                    playerX = p.x;
                    playerY = p.y;
                    break;
                }
            }
        }
        const adx = gem.x - playerX;
        const ady = gem.y - playerY;
        const aDist = Math.sqrt(adx * adx + ady * ady);
        // Only show arrow when gem is more than 40px away (not already overlapping)
        if (aDist > 40) {
            const ax = Math.cos(Math.atan2(ady, adx));
            const ay = Math.sin(Math.atan2(ady, adx));
            // Place the arrowhead offset just beyond the gem's edge
            const arrowTipX = gem.x + ax * (gem.r + 16);
            const arrowTipY = gem.y + ay * (gem.r + 16);
            const arrowLen = 26;
            const arrowSpread = 0.46; // ~26 deg half-angle
            const tailX = arrowTipX + ax * arrowLen;
            const tailY = arrowTipY + ay * arrowLen;

            ctx.save();
            ctx.globalAlpha = 0.82 + 0.18 * Math.sin(now / 280);
            ctx.strokeStyle = '#e2e060';
            ctx.fillStyle = '#e2e060';
            ctx.lineWidth = 2;

            // Arrow triangle head
            ctx.beginPath();
            ctx.moveTo(arrowTipX, arrowTipY);
            ctx.lineTo(
                tailX +
                    Math.cos(Math.atan2(ady, adx) + Math.PI - arrowSpread) * 16,
                tailY +
                    Math.sin(Math.atan2(ady, adx) + Math.PI - arrowSpread) * 16,
            );
            ctx.lineTo(
                tailX +
                    Math.cos(Math.atan2(ady, adx) + Math.PI + arrowSpread) * 16,
                tailY +
                    Math.sin(Math.atan2(ady, adx) + Math.PI + arrowSpread) * 16,
            );
            ctx.closePath();
            ctx.fill();

            // "XP" label just behind the tail
            const labelX = tailX + ax * 18;
            const labelY = tailY + ay * 18;
            ctx.font = 'bold 14px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#e2e060';
            ctx.fillText('XP', labelX, labelY);
            ctx.restore();
        }
    } else if (GAME_STATE.firstXpGem && !GAME_STATE.firstXpGem.alive) {
        GAME_STATE.firstXpGem = null;
        GAME_STATE.xpArrowDone = true; // Never show the arrow again this game
    }
    drawParticles(now);
    for (const e of GAME_STATE.enemies) {
        if (e?.alive && e.hp > 0 && isEntityInView(e)) e.draw(now);
    }
    for (const p of GAME_STATE.projectiles) {
        if (isEntityInView(p)) p.draw(now);
    }
    for (const ep of GAME_STATE.enemyProjectiles) {
        if (isEntityInView(ep)) ep.draw();
    }
    // Players: never cull (few; flail / focus overlays / names)
    for (const p of GAME_STATE.players) {
        if (p && !p.disconnected && !p.kicked) p.draw(now);
    }

    // Screen-space HUD (banners stay readable under mobile camera zoom)
    if (mobileCameraActive) resetScreenTransform();
    const hudCX = bufW / 2;
    const hudCY = bufH / 2;

    // 1. Boss pre-warning banners (5 seconds BEFORE boss minute starts)
    for (const key of Object.keys(BOSS_CONFIGS)) {
        const cfg = BOSS_CONFIGS[key];
        const preWarningStart = cfg.startMs - 5000;
        if (
            GAME_STATE.elapsed >= preWarningStart &&
            GAME_STATE.elapsed < cfg.startMs &&
            !GAME_STATE.completedBosses.has(cfg.id)
        ) {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff1100';
            ctx.font = 'bold 36px sans-serif';
            if (cfg.id === 'octopus') {
                ctx.fillText('WARNING: IMMINENT THREAT...', hudCX, hudCY - 20);
                ctx.font = '20px sans-serif';
                ctx.fillStyle = '#ffaa00';
                ctx.fillText('PREPARE FOR BOSS BATTLE', hudCX, hudCY + 20);
            } else if (cfg.id === 'horde') {
                ctx.fillText(
                    'WARNING: HORDE APPROACHING...',
                    hudCX,
                    hudCY - 20,
                );
                ctx.font = '20px sans-serif';
                ctx.fillStyle = '#ffaa00';
                ctx.fillText('PREPARE YOUR DEFENSES', hudCX, hudCY + 20);
            } else if (cfg.id === 'felhound') {
                ctx.fillText(
                    'WARNING: HUNGRY FELHOUND APPROACHING...',
                    hudCX,
                    hudCY - 20,
                );
                ctx.font = '20px sans-serif';
                ctx.fillStyle = '#ffaa00';
                ctx.fillText('PREPARE FOR BOSS BATTLE', hudCX, hudCY + 20);
            } else if (cfg.id === 'behemoth') {
                ctx.fillText(
                    'WARNING: IMMINENT DEATH APPROACHING...',
                    hudCX,
                    hudCY - 20,
                );
                ctx.font = '20px sans-serif';
                ctx.fillStyle = '#76ff03';
                ctx.fillText('PREPARE FOR BOSS BATTLE', hudCX, hudCY + 20);
            }
            ctx.restore();
            break;
        }
    }

    // 2. Active boss banners & countdowns
    if (GAME_STATE.activeBoss) {
        ctx.save();
        ctx.textAlign = 'center';
        const bossId = GAME_STATE.activeBoss;

        if (bossId === 'horde') {
            const hordeElapsed = now - GAME_STATE.hordeStartTime;
            if (hordeElapsed >= 52000 && hordeElapsed < 57000) {
                const secsLeft = Math.max(
                    1,
                    Math.ceil((57000 - hordeElapsed) / 1000),
                );
                ctx.font = 'bold 32px sans-serif';
                ctx.fillStyle = '#ffaa00';
                ctx.fillText(`HORDE ENDS IN ${secsLeft}...`, hudCX, 45);
            } else {
                ctx.fillStyle = '#ff1100';
                ctx.font = 'bold 24px sans-serif';
                ctx.fillText('SURVIVE THE HORDE EVENT!', hudCX, 45);
            }
        }
        ctx.restore();
    }

    if (mobileCameraActive) applyCameraTransform();

    // 3. Menu / death focus: darken canvas and highlight the relevant player(s)
    const showMenuFocusOverlay =
        GAME_STATE.current === STATES.LEVEL_UP ||
        GAME_STATE.current === STATES.WEAPON_SELECT ||
        GAME_STATE.current === STATES.COUNTDOWN ||
        GAME_STATE.current === STATES.PAUSED;
    // Online/single: while waiting to revive, fade the world and mark your corpse
    const showDeathFocusOverlay =
        GAME_STATE.current === STATES.GAMEPLAY &&
        GAME_STATE.gameMode !== 'local' &&
        isLocalPlayerDead();
    // Local co-op: arrows on corpses only (shared screen — do not fade living teammates)
    const showLocalDeadArrows =
        GAME_STATE.current === STATES.GAMEPLAY &&
        GAME_STATE.gameMode === 'local' &&
        GAME_STATE.players.some(
            (pl) => pl && !pl.disconnected && !pl.kicked && !isPlayerAlive(pl),
        );
    // Singleplayer: keep controls/arrow/name into gameplay until first move + 2s (no dark overlay)
    const showGameplayMovementHints =
        GAME_STATE.current === STATES.GAMEPLAY &&
        GAME_STATE.gameMode === 'single' &&
        getMovementHintAlpha() > 0 &&
        !showDeathFocusOverlay;

    if (
        showMenuFocusOverlay ||
        showDeathFocusOverlay ||
        showLocalDeadArrows ||
        showGameplayMovementHints
    ) {
        if (showMenuFocusOverlay || showDeathFocusOverlay) {
            // Darken in screen space so the full phone view fades, not only arena coords
            if (mobileCameraActive) resetScreenTransform();
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fillRect(0, 0, bufW, bufH);
            ctx.restore();
            if (mobileCameraActive) applyCameraTransform();
        }

        for (const p of GAME_STATE.players) {
            if (!p || p.disconnected || p.kicked) continue;

            // Full spotlight + redraw only for the focused local blob
            if (shouldFocusOverlayPlayer(p, showDeathFocusOverlay)) {
                if (showMenuFocusOverlay || showDeathFocusOverlay) {
                    ctx.save();
                    const glowR = Math.max(40, p.r * 3.0);
                    const grad = ctx.createRadialGradient(
                        p.x,
                        p.y,
                        0,
                        p.x,
                        p.y,
                        glowR,
                    );
                    grad.addColorStop(0, p.color + '55');
                    grad.addColorStop(0.45, p.color + '22');
                    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();

                    // Redraw player (or dead marker) above the dark overlay
                    p.draw(now);
                }
            }

            // Names/arrows: local full brightness; other online peers stay visible but faded
            if (shouldDrawPlayerFocusArrow(p)) {
                drawPlayerFocusArrow(p, now);
            }
        }
    }

    // Offline teammates: edge arrows on the phone bezel (online + mobile camera only)
    drawOffscreenPlayerEdgeIndicators(now);
}

/**
 * Project a world point onto the exact phone screen edge (pad = 0).
 * Returns null if the point is already on-screen.
 */
function worldToScreenEdge(worldX, worldY, pad = 0) {
    if (!mobileCameraActive || camZoom <= 0) return null;
    const sx = (worldX - camX) * camZoom;
    const sy = (worldY - camY) * camZoom;
    const left = pad;
    const right = viewW - 1 - pad;
    const top = pad;
    const bottom = viewH - 1 - pad;
    if (sx >= left && sx <= right && sy >= top && sy <= bottom) return null;

    const cx = viewW * 0.5;
    const cy = viewH * 0.5;
    let dx = sx - cx;
    const dy = sy - cy;
    if (dx === 0 && dy === 0) {
        dx = 1;
    }
    const scaleX =
        dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
    const scaleY =
        dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
    const scale = Math.min(scaleX, scaleY);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    return {
        x: cx + dx * scale,
        y: cy + dy * scale,
        angle: Math.atan2(dy, dx),
    };
}

function drawOffscreenPlayerEdgeIndicators(now) {
    if (!mobileCameraActive || !ctx) return;
    if (!isOnlineMultiplayer()) return;
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.players) return;
    const state = GAME_STATE.current;
    if (
        state !== STATES.GAMEPLAY &&
        state !== STATES.COUNTDOWN &&
        state !== STATES.LEVEL_UP &&
        state !== STATES.WEAPON_SELECT
    ) {
        return;
    }

    resetScreenTransform();
    const localIdx = getLocalPlayerIndex();
    const arrowLen = 6;
    const br = 4; // tiny edge blob

    for (let i = 0; i < GAME_STATE.players.length; i++) {
        const p = GAME_STATE.players[i];
        if (!p || p.disconnected || p.kicked) continue;
        if (Number(p.index) === localIdx) continue;

        const edge = worldToScreenEdge(p.x, p.y, 0);
        if (!edge) continue;

        const alive = isPlayerAlive(p);
        const color = p.color || '#00ffcc';
        const ring = p.ring || '#111111';
        const ang = edge.angle;
        const peerFade =
            isOnlineSoloFocusState() && !isLocalFocusPlayer(p)
                ? ONLINE_SOLO_PEER_ARROW_ALPHA
                : 1;

        ctx.save();
        // Tip of the arrow sits exactly on the screen edge (+X = outward)
        ctx.translate(edge.x, edge.y);
        ctx.rotate(ang);

        // Arrow flush with the bezel
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowLen, -4.5);
        ctx.lineTo(-arrowLen, 4.5);
        ctx.closePath();
        ctx.globalAlpha = (alive ? 0.95 : 0.55) * peerFade;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#0a0a0f';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Tiny blob just inside the arrow (real organic membrane when alive)
        const blobX = -(arrowLen + br + 0.5);
        if (alive && typeof drawOrganicBlobPath === 'function') {
            ctx.globalAlpha = peerFade;
            drawOrganicBlobPath(
                ctx,
                blobX,
                0,
                br,
                now,
                ang,
                0.35,
            );
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = ring;
            ctx.lineWidth = 1;
            ctx.stroke();
        } else if (alive) {
            ctx.globalAlpha = peerFade;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(blobX, 0, br, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = ring;
            ctx.lineWidth = 1;
            ctx.stroke();
        } else {
            ctx.globalAlpha = 0.75 * peerFade;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(blobX, 0, br, 0, Math.PI * 2);
            ctx.stroke();
            const xArm = br * 0.55;
            ctx.beginPath();
            ctx.moveTo(blobX - xArm, -xArm);
            ctx.lineTo(blobX + xArm, xArm);
            ctx.moveTo(blobX + xArm, -xArm);
            ctx.lineTo(blobX - xArm, xArm);
            ctx.stroke();
        }
        ctx.restore();
    }
}

const MOVEMENT_HINT_HOLD_MS = 2000;
const MOVEMENT_HINT_FADE_MS = 400;

function noteMovementHintFirstMove(player) {
    if (!player || typeof GAME_STATE === 'undefined') return;
    if (GAME_STATE.gameMode !== 'single') return;
    if (GAME_STATE.movementHintsDone) return;
    if (GAME_STATE.movementHintFirstMoveAt != null) return;
    const state = GAME_STATE.current;
    if (
        state !== STATES.WEAPON_SELECT &&
        state !== STATES.COUNTDOWN &&
        state !== STATES.GAMEPLAY
    ) {
        return;
    }
    GAME_STATE.movementHintFirstMoveAt = performance.now();
}

function getMovementHintAlpha() {
    if (typeof GAME_STATE === 'undefined') return 0;
    if (GAME_STATE.gameMode !== 'single') return 1;
    if (GAME_STATE.movementHintsDone) return 0;
    const firstMoveAt = GAME_STATE.movementHintFirstMoveAt;
    if (firstMoveAt == null) return 1;
    // Wall-clock timing — draw() passes gameClock, which must not be used here
    const elapsed = performance.now() - firstMoveAt;
    if (elapsed < MOVEMENT_HINT_HOLD_MS) return 1;
    const fadeT = (elapsed - MOVEMENT_HINT_HOLD_MS) / MOVEMENT_HINT_FADE_MS;
    if (fadeT >= 1) {
        GAME_STATE.movementHintsDone = true;
        return 0;
    }
    return 1 - fadeT;
}

function getNetManager() {
    if (typeof netManager !== 'undefined' && netManager) return netManager;
    if (typeof window !== 'undefined' && window.netManager) {
        return window.netManager;
    }
    return null;
}

function isOnlineMultiplayer() {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE) return false;
    if (GAME_STATE.gameMode === 'online' || GAME_STATE.isOnline) return true;
    const nm = getNetManager();
    return !!(nm && (nm.isHost || nm.isClient));
}

function getLocalPlayerIndex() {
    const nm = getNetManager();
    if (isOnlineMultiplayer() && nm && nm.localPlayerIndex != null) {
        return Number(nm.localPlayerIndex);
    }
    return 0;
}

function isLocalFocusPlayer(p) {
    if (!p) return false;
    return Number(p.index) === getLocalPlayerIndex();
}

function isPlayerAlive(p) {
    if (!p) return false;
    return typeof p.isAlive === 'function' ? p.isAlive() : !!p.alive;
}

function isLocalPlayerDead() {
    const p = GAME_STATE.players?.[getLocalPlayerIndex()];
    if (!p || p.disconnected || p.kicked) return false;
    return !isPlayerAlive(p);
}

/**
 * Online menus where the world is dimmed and only the local blob stays bright:
 * weapon select, upgrades, resume countdown, and pause.
 */
function isOnlineSoloFocusState(state = GAME_STATE.current) {
    return (
        isOnlineMultiplayer() &&
        (state === STATES.LEVEL_UP ||
            state === STATES.WEAPON_SELECT ||
            state === STATES.COUNTDOWN ||
            state === STATES.PAUSED)
    );
}

function shouldFocusOverlayPlayer(p, showDeathFocusOverlay) {
    if (!p || p.disconnected || p.kicked) return false;

    if (showDeathFocusOverlay) {
        return isLocalFocusPlayer(p);
    }
    if (isOnlineSoloFocusState()) {
        return isLocalFocusPlayer(p);
    }
    if (
        GAME_STATE.current === STATES.GAMEPLAY &&
        GAME_STATE.gameMode === 'local'
    ) {
        return !isPlayerAlive(p);
    }
    return isPlayerAlive(p);
}

function shouldDrawPlayerFocusArrow(p) {
    if (!p || p.disconnected || p.kicked) return false;
    const state = GAME_STATE.current;
    const alive = isPlayerAlive(p);

    // Dead players: arrow on corpse while waiting to revive
    if (!alive) {
        if (
            state !== STATES.GAMEPLAY &&
            state !== STATES.LEVEL_UP &&
            state !== STATES.WEAPON_SELECT &&
            state !== STATES.PAUSED &&
            state !== STATES.COUNTDOWN
        ) {
            return false;
        }
        if (GAME_STATE.gameMode === 'local') return true;
        // Online weapon/upgrade: show everyone’s corpse marker (faded if not local)
        if (isOnlineSoloFocusState(state)) return true;
        return isLocalFocusPlayer(p);
    }

    // Online weapon/upgrade: arrows + names for all peers (non-local drawn faded)
    if (isOnlineSoloFocusState(state)) {
        return true;
    }

    if (state === STATES.LEVEL_UP || state === STATES.PAUSED) return true;
    if (state === STATES.WEAPON_SELECT || state === STATES.COUNTDOWN) {
        if (GAME_STATE.gameMode === 'single') {
            return getMovementHintAlpha() > 0;
        }
        return true;
    }
    if (state === STATES.GAMEPLAY && GAME_STATE.gameMode === 'single') {
        return getMovementHintAlpha() > 0;
    }
    return false;
}

/** Matches the world dim under the menu overlay (~0.35 black veil). */
const ONLINE_SOLO_PEER_ARROW_ALPHA = 0.55;

function getPlayerFocusArrowAlpha(p) {
    if (isOnlineSoloFocusState() && !isLocalFocusPlayer(p)) {
        return ONLINE_SOLO_PEER_ARROW_ALPHA;
    }
    const hintAlpha = getMovementHintAlpha();
    // Level-up / pause / death marker always full opacity; SP tutorial uses hint alpha
    if (
        !isPlayerAlive(p) ||
        GAME_STATE.current === STATES.LEVEL_UP ||
        GAME_STATE.current === STATES.PAUSED ||
        GAME_STATE.gameMode !== 'single'
    ) {
        return 1;
    }
    return hintAlpha;
}

function shouldShowSteerKeyCluster(p) {
    if (!p) return false;
    const isMobileDevice =
        typeof isMobile !== 'undefined'
            ? isMobile
            : (typeof window !== 'undefined' && window.isMobile) || false;
    if (isMobileDevice) return false;
    const isLocalControllingPlayer =
        GAME_STATE.gameMode === 'online' &&
        (typeof netManager !== 'undefined' &&
        netManager &&
        netManager.localPlayerIndex !== undefined
            ? p.index === netManager.localPlayerIndex
            : p.index === 0);
    const showForPlayer =
        GAME_STATE.gameMode === 'single' ||
        GAME_STATE.gameMode === 'local' ||
        isLocalControllingPlayer;
    if (!showForPlayer) return false;

    const state = GAME_STATE.current;
    if (state === STATES.WEAPON_SELECT) {
        return GAME_STATE.gameMode !== 'single' || getMovementHintAlpha() > 0;
    }
    // Singleplayer: keep steer keys visible with the focus arrow until first-move fade completes
    if (
        GAME_STATE.gameMode === 'single' &&
        (state === STATES.COUNTDOWN || state === STATES.GAMEPLAY)
    ) {
        return getMovementHintAlpha() > 0;
    }
    return false;
}

function drawPlayerFocusArrow(p, now) {
    if (!shouldDrawPlayerFocusArrow(p)) return;
    const alpha = getPlayerFocusArrowAlpha(p);
    if (alpha <= 0) return;

    const bob = Math.sin(performance.now() * 0.008) * 6;
    const pointDown = p.y >= 85;
    const headWidth = 32;
    const headHeight = 17;
    const shaftWidth = 16;
    const shaftHeight = 17;
    const totalHeight = headHeight + shaftHeight;

    ctx.save();
    ctx.globalAlpha = alpha;

    const drawPill = (pillX, pillY, pillW, pillH, r) => {
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(pillX, pillY, pillW, pillH, r);
        } else {
            ctx.rect(pillX, pillY, pillW, pillH);
        }
        ctx.fill();
        ctx.stroke();
    };

    // 1. Singleplayer: never display any weapon/upgrade badge over player.
    // 2. Multiplayer: display starting weapon once picked in lobby, then display chosen upgrade during level up.
    const isMultiplayer =
        GAME_STATE.gameMode === 'local' ||
        GAME_STATE.gameMode === 'online' ||
        (GAME_STATE.players &&
            GAME_STATE.players.filter((pl) => pl && !pl.disconnected).length >
                1);
    let badgeText = null;
    if (isMultiplayer) {
        if (
            GAME_STATE.current === STATES.WEAPON_SELECT &&
            p.selectedWeaponLabel
        ) {
            badgeText = p.selectedWeaponLabel;
        } else if (
            (GAME_STATE.current === STATES.LEVEL_UP ||
                GAME_STATE.current === STATES.COUNTDOWN) &&
            p.currentLevelUpgradeName
        ) {
            badgeText = p.currentLevelUpgradeName;
        }
    }

    const showKeyCluster = shouldShowSteerKeyCluster(p);

    if (pointDown) {
        const tipX = p.x;
        const tipY = p.y - p.r - 12 + bob;
        const topY = tipY - totalHeight;

        // Draw fat downward-pointing arrow
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - headWidth / 2, tipY - headHeight);
        ctx.lineTo(tipX - shaftWidth / 2, tipY - headHeight);
        ctx.lineTo(tipX - shaftWidth / 2, topY);
        ctx.lineTo(tipX + shaftWidth / 2, topY);
        ctx.lineTo(tipX + shaftWidth / 2, tipY - headHeight);
        ctx.lineTo(tipX + headWidth / 2, tipY - headHeight);
        ctx.closePath();

        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = p.color;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.3;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Player Label Pill above arrow
        const labelText = p.name || `P${p.index + 1}`;
        ctx.font = 'bold 13px sans-serif';
        const textW = ctx.measureText(labelText).width;
        const pillW = textW + 14;
        const pillH = 18;
        const pillX = tipX - pillW / 2;
        const pillY = topY - pillH - 4;

        ctx.fillStyle = 'rgba(10, 10, 15, 0.92)';
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        drawPill(pillX, pillY, pillW, pillH, 5);

        ctx.fillStyle = p.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, tipX, pillY + pillH / 2);

        let highestY = pillY;

        // Weapon/Upgrade label badge above the player pill
        if (badgeText) {
            ctx.font = 'bold 12px sans-serif';
            const wTextW = ctx.measureText(badgeText).width;
            const wPillW = wTextW + 16;
            const wPillH = 20;
            const wPillX = tipX - wPillW / 2;
            const wPillY = pillY - wPillH - 4;

            ctx.fillStyle = 'rgba(12, 12, 18, 0.95)';
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            drawPill(wPillX, wPillY, wPillW, wPillH, 6);

            ctx.fillStyle = '#ffffff';
            ctx.fillText(badgeText, tipX, wPillY + wPillH / 2);
            highestY = wPillY;
        }

        if (showKeyCluster) {
            const keySize = 16;
            const gap = 3;
            const clusterH = keySize * 2 + gap;
            const clusterTopY = highestY - clusterH - 6;
            drawKeyboardKeyCluster(
                ctx,
                tipX,
                clusterTopY,
                p.index,
                p.color,
                keySize,
                gap,
            );
        }
    } else {
        // Point UP from below player when player is near the top edge
        const tipX = p.x;
        const tipY = p.y + p.r + 12 - bob;
        const bottomY = tipY + totalHeight;

        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - headWidth / 2, tipY + headHeight);
        ctx.lineTo(tipX - shaftWidth / 2, tipY + headHeight);
        ctx.lineTo(tipX - shaftWidth / 2, bottomY);
        ctx.lineTo(tipX + shaftWidth / 2, bottomY);
        ctx.lineTo(tipX + shaftWidth / 2, tipY + headHeight);
        ctx.lineTo(tipX + headWidth / 2, tipY + headHeight);
        ctx.closePath();

        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = p.color;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.3;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Player Label Pill below arrow
        const labelText = p.name || `P${p.index + 1}`;
        ctx.font = 'bold 13px sans-serif';
        const textW = ctx.measureText(labelText).width;
        const pillW = textW + 14;
        const pillH = 18;
        const pillX = tipX - pillW / 2;
        const pillY = bottomY + 4;

        ctx.fillStyle = 'rgba(10, 10, 15, 0.92)';
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        drawPill(pillX, pillY, pillW, pillH, 5);

        ctx.fillStyle = p.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, tipX, pillY + pillH / 2);

        let lowestY = pillY + pillH;

        // Weapon/Upgrade label badge below the player pill
        if (badgeText) {
            ctx.font = 'bold 12px sans-serif';
            const wTextW = ctx.measureText(badgeText).width;
            const wPillW = wTextW + 16;
            const wPillH = 20;
            const wPillX = tipX - wPillW / 2;
            const wPillY = pillY + pillH + 4;

            ctx.fillStyle = 'rgba(12, 12, 18, 0.95)';
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            drawPill(wPillX, wPillY, wPillW, wPillH, 6);

            ctx.fillStyle = '#ffffff';
            ctx.fillText(badgeText, tipX, wPillY + wPillH / 2);
            lowestY = wPillY + wPillH;
        }

        if (showKeyCluster) {
            const keySize = 16;
            const gap = 3;
            const clusterTopY = lowestY + 6;
            drawKeyboardKeyCluster(
                ctx,
                tipX,
                clusterTopY,
                p.index,
                p.color,
                keySize,
                gap,
            );
        }
    }
    ctx.restore();
}

function drawKeyboardKeyCluster(
    ctx,
    centerX,
    topY,
    playerIndex,
    color,
    keySize = 16,
    gap = 3,
) {
    const keys =
        typeof getPlayerKeyLabels === 'function'
            ? getPlayerKeyLabels(playerIndex)
            : { up: 'W', left: 'A', down: 'S', right: 'D' };

    // Dynamic feedback if key is currently held down
    const activeKeys =
        typeof window !== 'undefined' && window.keys ? window.keys : null;
    const isPressed = (rawKey) =>
        Boolean(activeKeys && rawKey && activeKeys[rawKey]);

    ctx.save();
    ctx.font = `bold ${Math.round(keySize * 0.58)}px monospace, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Row 1: Up key (centered)
    const upX = centerX - keySize / 2;
    const upY = topY;
    drawKeyCapCanvas(
        ctx,
        upX,
        upY,
        keySize,
        keys.up,
        color,
        isPressed(keys.rawUp),
    );

    // Row 2: Left, Down, Right keys
    const row2Y = topY + keySize + gap;
    const downX = centerX - keySize / 2;
    const leftX = downX - keySize - gap;
    const rightX = downX + keySize + gap;

    drawKeyCapCanvas(
        ctx,
        leftX,
        row2Y,
        keySize,
        keys.left,
        color,
        isPressed(keys.rawLeft),
    );
    drawKeyCapCanvas(
        ctx,
        downX,
        row2Y,
        keySize,
        keys.down,
        color,
        isPressed(keys.rawDown),
    );
    drawKeyCapCanvas(
        ctx,
        rightX,
        row2Y,
        keySize,
        keys.right,
        color,
        isPressed(keys.rawRight),
    );

    ctx.restore();
}

function drawKeyCapCanvas(ctx, x, y, size, label, color, isPressed = false) {
    if (isPressed) {
        ctx.fillStyle = color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
    } else {
        ctx.fillStyle = 'rgba(14, 16, 24, 0.95)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
    }

    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, size, size, 3);
    } else {
        ctx.rect(x, y, size, size);
    }
    ctx.fill();
    ctx.stroke();

    // Top highlight bevel if not pressed
    if (!isPressed) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(x + 2, y + 2, size - 4, 1.5);
    }

    // Key label text
    ctx.fillStyle = isPressed ? '#0c0e14' : color;
    ctx.fillText(label, x + size / 2, y + size / 2 + 0.5);
}

if (typeof window !== 'undefined') {
    window.canvas = canvas;
    window.ctx = ctx;
    window.STANDARD_ARENA_W = STANDARD_ARENA_W;
    window.STANDARD_ARENA_H = STANDARD_ARENA_H;
    window.resizeCanvas = resizeCanvas;
    window.dismissRotateHint = dismissRotateHint;
    window.updateRotateHint = updateRotateHint;
    window.shadeHex = shadeHex;
    window.brightenColor = brightenColor;
    window.isInView = isInView;
    window.isEntityInView = isEntityInView;
    window.shouldUseMobileCamera = shouldUseMobileCamera;
    window.snapMobileCameraToFollow = snapMobileCameraToFollow;
    window.updateMobileCamera = updateMobileCamera;
    window.drawBattlefieldBorder = drawBattlefieldBorder;
    window.drawGems = drawGems;
    window.drawParticles = drawParticles;
    syncWindowArenaSize();
    window.drawPlayerFocusArrow = drawPlayerFocusArrow;
    window.drawOffscreenPlayerEdgeIndicators =
        drawOffscreenPlayerEdgeIndicators;
    window.drawKeyboardKeyCluster = drawKeyboardKeyCluster;
    window.drawKeyCapCanvas = drawKeyCapCanvas;
    window.noteMovementHintFirstMove = noteMovementHintFirstMove;
    window.getMovementHintAlpha = getMovementHintAlpha;
    window.draw = draw;
}
