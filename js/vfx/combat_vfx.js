// =========================================================================
// Combat Visual Effects & Explosions (Visual Effects Layer)
// Blob Survival Game Engine - js/vfx/combat_vfx.js
// =========================================================================

/**
 * Base class for all transient combat visual effects, explosions, muzzle flashes, and impact marks.
 * Decoupled from Entity (VFX layer: purely visual rendering feedback).
 */
class CombatVFX {
    /**
     * @param {number} x - Origin X
     * @param {number} y - Origin Y
     * @param {number} [duration=200] - Duration in ms
     * @param {number} [now] - Spawn timestamp
     */
    constructor(x, y, duration = 200, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        this.x = x;
        this.y = y;
        this.duration = Math.max(1, duration);
        this.spawnTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        this.alive = true;
    }

    /**
     * Calculates normalized animation progress [0.0 - 1.0].
     * @param {number} [now]
     * @returns {number}
     */
    getProgress(now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        return Math.min(1, Math.max(0, (curTime - this.spawnTime) / this.duration));
    }

    /**
     * Calculates fading alpha multiplier [1.0 - 0.0].
     * @param {number} [now]
     * @returns {number}
     */
    getAlpha(now) {
        return 1 - this.getProgress(now);
    }

    /**
     * Updates lifetime and marks inactive on expiration.
     * @param {number} dt
     * @param {number} [now]
     */
    update(dt, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        if (curTime - this.spawnTime > this.duration) {
            this.alive = false;
        }
    }

    /**
     * Checks if effect is currently active.
     * @returns {boolean}
     */
    isAlive() {
        return this.alive;
    }

    /**
     * Forces immediate despawn.
     */
    despawn() {
        this.alive = false;
    }
}

// =========================================================================
// 1. Radial Blasts & Explosions
// =========================================================================

/**
 * Base class for expanding radial shockwaves and explosive blasts.
 */
class ExplosionVFX extends CombatVFX {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} r - Maximum explosion radius
     * @param {number} [duration=300]
     * @param {number} [now]
     */
    constructor(x, y, r, duration = 300, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        super(x, y, duration, now);
        this.r = Math.max(0, r || 0);
    }

    /**
     * Calculates current shockwave radius.
     * @param {number} [now]
     * @returns {number}
     */
    getCurrentRadius(now) {
        return Math.max(0, this.r * this.getProgress(now));
    }
}

/**
 * Standard Proximity Mine / Bio-Mine expanding shockwave visual.
 */
class MineExplosion extends ExplosionVFX {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} r
     * @param {number} [now]
     * @param {Player} [player]
     */
    constructor(x, y, r, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), player = null) {
        super(x, y, r, 300, now);
        this.player = player;
        if (typeof SoundEngine !== 'undefined' && SoundEngine && typeof SoundEngine.mineExplosion === 'function') {
            SoundEngine.mineExplosion(r / 60);
        }
    }

    /**
     * @param {number} [now]
     * @param {CanvasRenderingContext2D} [targetContext]
     */
    draw(now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), targetContext) {
        const renderCtx = targetContext || (typeof ctx !== 'undefined' ? ctx : null);
        if (!renderCtx) return;

        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const t = this.getProgress(curTime);
        const currentR = this.getCurrentRadius(curTime);

        renderCtx.save();
        
        // Inner shockwave fill with radial gradient transitioning from player color to original orange
        const defaultMineExplosionColor = '#55ff00';
        if (currentR > 0.01) {
            const grad = renderCtx.createRadialGradient(this.x, this.y, 0, this.x, this.y, currentR);
            const pColor = this.player ? this.player.color : defaultMineExplosionColor;
            grad.addColorStop(0, pColor);
            grad.addColorStop(0.8, pColor);
            grad.addColorStop(1.0, defaultMineExplosionColor);
            renderCtx.fillStyle = grad;
        } else {
            renderCtx.fillStyle = defaultMineExplosionColor;
        }
        
        renderCtx.globalAlpha = Math.max(0, Math.min(1, 0.20 * (1 - t)));
        renderCtx.beginPath();
        renderCtx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        renderCtx.fill();
        
        // Outer thick glowing border
        renderCtx.strokeStyle = '#ff3300';
        renderCtx.lineWidth = Math.max(0.1, 7 * (1 - t));
        renderCtx.globalAlpha = Math.max(0, Math.min(1, 0.9 * (1 - t)));
        renderCtx.beginPath();
        renderCtx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        renderCtx.stroke();
        
        // Inner sharp yellow/white border for extreme high-contrast outline
        renderCtx.strokeStyle = '#ffcc00';
        renderCtx.lineWidth = Math.max(0.1, 2.5 * (1 - t));
        renderCtx.globalAlpha = Math.max(0, Math.min(1, 0.95 * (1 - t)));
        renderCtx.beginPath();
        renderCtx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        renderCtx.stroke();
        
        renderCtx.restore();
    }
}

/**
 * Massive Nuclear Blast shockwave visual with deep crimson glow.
 */
class NukeExplosion extends ExplosionVFX {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} r
     * @param {number} [now]
     */
    constructor(x, y, r, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        super(x, y, r, 320, now);
        if (typeof SoundEngine !== 'undefined' && SoundEngine && typeof SoundEngine.nukeExplosion === 'function') {
            SoundEngine.nukeExplosion();
        }
    }

    /**
     * @param {number} [now]
     * @param {CanvasRenderingContext2D} [targetContext]
     */
    draw(now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), targetContext) {
        const renderCtx = targetContext || (typeof ctx !== 'undefined' ? ctx : null);
        if (!renderCtx) return;

        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const t = this.getProgress(curTime);
        const currentR = this.getCurrentRadius(curTime);

        renderCtx.save();

        if (currentR > 0.01) {
            const grad = renderCtx.createRadialGradient(this.x, this.y, 0, this.x, this.y, currentR);
            grad.addColorStop(0, '#ff4422');
            grad.addColorStop(0.8, '#ff2200');
            grad.addColorStop(1.0, '#aa0000');
            renderCtx.fillStyle = grad;
        } else {
            renderCtx.fillStyle = '#ff2200';
        }

        renderCtx.globalAlpha = Math.max(0, Math.min(1, 0.25 * (1 - t)));
        renderCtx.beginPath();
        renderCtx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        renderCtx.fill();

        // Outer thick glowing red border
        renderCtx.strokeStyle = '#ff1100';
        renderCtx.lineWidth = Math.max(0.1, 10 * (1 - t));
        renderCtx.globalAlpha = Math.max(0, Math.min(1, 0.90 * (1 - t)));
        renderCtx.beginPath();
        renderCtx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        renderCtx.stroke();

        // Inner sharp yellow-white contrast border
        renderCtx.strokeStyle = '#ffcc00';
        renderCtx.lineWidth = Math.max(0.1, 3.5 * (1 - t));
        renderCtx.globalAlpha = Math.max(0, Math.min(1, 0.95 * (1 - t)));
        renderCtx.beginPath();
        renderCtx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        renderCtx.stroke();

        renderCtx.restore();
    }
}

/**
 * Cryo Freeze Blast shockwave visual with icy-blue crystalline glow.
 */
class FreezeBlastVisual extends ExplosionVFX {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} r
     * @param {number} [now]
     */
    constructor(x, y, r, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now())) {
        super(x, y, r, 320, now);
    }

    /**
     * @param {number} [now]
     * @param {CanvasRenderingContext2D} [targetContext]
     */
    draw(now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), targetContext) {
        const renderCtx = targetContext || (typeof ctx !== 'undefined' ? ctx : null);
        if (!renderCtx) return;

        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const t = this.getProgress(curTime);
        const currentR = this.getCurrentRadius(curTime);

        renderCtx.save();

        if (currentR > 0.01) {
            const grad = renderCtx.createRadialGradient(this.x, this.y, 0, this.x, this.y, currentR);
            grad.addColorStop(0, '#00ffff');
            grad.addColorStop(0.8, '#0088ff');
            grad.addColorStop(1.0, '#0033cc');
            renderCtx.fillStyle = grad;
        } else {
            renderCtx.fillStyle = '#00aaff';
        }

        renderCtx.globalAlpha = Math.max(0, Math.min(1, 0.25 * (1 - t)));
        renderCtx.beginPath();
        renderCtx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        renderCtx.fill();

        // Outer thick glowing blue border
        renderCtx.strokeStyle = '#0066ff';
        renderCtx.lineWidth = Math.max(0.1, 10 * (1 - t));
        renderCtx.globalAlpha = Math.max(0, Math.min(1, 0.90 * (1 - t)));
        renderCtx.beginPath();
        renderCtx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        renderCtx.stroke();

        // Inner sharp icy-white contrast border
        renderCtx.strokeStyle = '#ccffff';
        renderCtx.lineWidth = Math.max(0.1, 3.5 * (1 - t));
        renderCtx.globalAlpha = Math.max(0, Math.min(1, 0.95 * (1 - t)));
        renderCtx.beginPath();
        renderCtx.arc(this.x, this.y, currentR, 0, Math.PI * 2);
        renderCtx.stroke();

        renderCtx.restore();
    }
}

// =========================================================================
// 2. Directional Strikes & Weapon Flares
// =========================================================================

/**
 * Directional piercing strike puncture & entry wound flash.
 */
class InstantHitImpact extends CombatVFX {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} hitAngle - Impact angle pointing inward to target
     * @param {string} color - Laser / strike color
     * @param {number} [now]
     * @param {number} [monsterR=14] - Target radius
     */
    constructor(x, y, hitAngle, color, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), monsterR = 14) {
        super(x, y, 95, now);
        this.hitAngle = hitAngle;
        this.color = color || '#00ffff';
        this.monsterR = monsterR;
    }

    /**
     * @param {number} [now]
     * @param {CanvasRenderingContext2D} [targetContext]
     */
    draw(now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), targetContext) {
        const renderCtx = targetContext || (typeof ctx !== 'undefined' ? ctx : null);
        if (!renderCtx) return;

        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const t = this.getProgress(curTime);
        const alpha = 1 - t;

        renderCtx.save();
        renderCtx.translate(this.x, this.y);
        // Rotate so +x points straight inward into the monster body
        renderCtx.rotate(this.hitAngle + Math.PI);

        // 1. Narrow piercing spike / lance penetrating into the monster
        const pierceLen = (14 + Math.min(20, this.monsterR * 0.7)) * (0.85 + t * 0.25);
        renderCtx.lineCap = 'round';
        renderCtx.strokeStyle = this.color;
        renderCtx.globalAlpha = 0.35 * alpha;
        renderCtx.lineWidth = 6 * alpha;
        renderCtx.beginPath();
        renderCtx.moveTo(-3, 0);
        renderCtx.lineTo(pierceLen, 0);
        renderCtx.stroke();
        renderCtx.globalAlpha = 1;
        renderCtx.lineWidth = 2.5 * alpha;
        renderCtx.beginPath();
        renderCtx.moveTo(-3, 0);
        renderCtx.lineTo(pierceLen, 0);
        renderCtx.stroke();

        // 2. High-intensity white needle core
        renderCtx.strokeStyle = '#ffffff';
        renderCtx.lineWidth = 1.1 * alpha;
        renderCtx.beginPath();
        renderCtx.moveTo(-1, 0);
        renderCtx.lineTo(pierceLen * 0.88, 0);
        renderCtx.stroke();

        // 3. Narrow piercing barb tip
        renderCtx.fillStyle = this.color;
        renderCtx.beginPath();
        renderCtx.moveTo(pierceLen, 0);
        renderCtx.lineTo(pierceLen - 5, -2);
        renderCtx.lineTo(pierceLen - 3, 0);
        renderCtx.lineTo(pierceLen - 5, 2);
        renderCtx.closePath();
        renderCtx.fill();

        // 4. Entry wound flash and narrow puncture spark streaks
        renderCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        renderCtx.beginPath();
        renderCtx.arc(0, 0, (2.5 + t) * alpha, 0, Math.PI * 2);
        renderCtx.fill();

        renderCtx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
        renderCtx.lineWidth = 1;
        renderCtx.beginPath();
        renderCtx.moveTo(0, 0);
        renderCtx.lineTo(-5 * alpha, -2.5);
        renderCtx.moveTo(0, 0);
        renderCtx.lineTo(-5 * alpha, 2.5);
        renderCtx.stroke();

        renderCtx.restore();
    }
}

/**
 * Directional weapon discharge / muzzle flare anchored to the shooter.
 */
class InstantMuzzleFlash extends CombatVFX {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} shootAngle
     * @param {string} color
     * @param {number} [now]
     * @param {Unit} [source=null]
     * @param {number} [shooterRadius=14]
     */
    constructor(x, y, shootAngle, color, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), source = null, shooterRadius = 14) {
        super(x, y, 80, now);
        this.shootAngle = shootAngle;
        this.color = color || '#00ffff';
        this.source = source;
        this.shooterRadius = shooterRadius;
    }

    /**
     * @param {number} [now]
     * @param {CanvasRenderingContext2D} [targetContext]
     */
    draw(now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), targetContext) {
        const renderCtx = targetContext || (typeof ctx !== 'undefined' ? ctx : null);
        if (!renderCtx) return;

        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const t = this.getProgress(curTime);
        const alpha = 1 - t;

        // Anchor dynamically to the moving player / shooter
        let drawX = this.x;
        let drawY = this.y;
        if (this.source && (this.source.hp > 0 || this.source.alive)) {
            drawX = this.source.x + Math.cos(this.shootAngle) * this.shooterRadius;
            drawY = this.source.y + Math.sin(this.shootAngle) * this.shooterRadius;
        }

        renderCtx.save();
        renderCtx.translate(drawX, drawY);
        renderCtx.rotate(this.shootAngle);

        // 1. Forward directional muzzle needle spike
        const beamLen = (15 + t * 6) * alpha;
        renderCtx.lineCap = 'round';
        renderCtx.strokeStyle = this.color;
        renderCtx.globalAlpha = 0.35 * alpha;
        renderCtx.lineWidth = 6 * alpha;
        renderCtx.beginPath();
        renderCtx.moveTo(0, 0);
        renderCtx.lineTo(beamLen, 0);
        renderCtx.stroke();
        renderCtx.globalAlpha = 1;
        renderCtx.lineWidth = 2.5 * alpha;
        renderCtx.beginPath();
        renderCtx.moveTo(0, 0);
        renderCtx.lineTo(beamLen, 0);
        renderCtx.stroke();

        // 2. White inner core
        renderCtx.strokeStyle = '#ffffff';
        renderCtx.lineWidth = 1.2 * alpha;
        renderCtx.beginPath();
        renderCtx.moveTo(0, 0);
        renderCtx.lineTo(beamLen * 0.8, 0);
        renderCtx.stroke();

        // 3. Flanking muzzle flash flares
        const flareSpread = 0.42; // ~24 degrees
        const flareLen = (8 + t * 4) * alpha;
        renderCtx.strokeStyle = this.color;
        renderCtx.lineWidth = 1.6 * alpha;
        renderCtx.globalAlpha = 0.75 * alpha;
        renderCtx.beginPath();
        renderCtx.moveTo(0, 0);
        renderCtx.lineTo(Math.cos(flareSpread) * flareLen, Math.sin(flareSpread) * flareLen);
        renderCtx.moveTo(0, 0);
        renderCtx.lineTo(Math.cos(-flareSpread) * flareLen, Math.sin(-flareSpread) * flareLen);
        renderCtx.stroke();

        // 4. Muzzle orifice flash dot
        renderCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        renderCtx.beginPath();
        renderCtx.arc(0, 0, (2.5 + t * 1.5) * alpha, 0, Math.PI * 2);
        renderCtx.fill();

        renderCtx.restore();
    }
}

/**
 * Directional sledgehammer bio-slam, ground rupture fissures & crushing hammer arm visual.
 */
class SledgeHitVisual extends CombatVFX {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} r - Slam cone radius
     * @param {number} coneAngle
     * @param {number} angle - Facing swing angle
     * @param {number} [now]
     * @param {Player} [player]
     */
    constructor(x, y, r, coneAngle, angle, now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), player = null) {
        super(x, y, 240, now);
        this.r = r;
        this.coneAngle = coneAngle;
        this.angle = angle;
        this.player = player;
    }

    /**
     * @param {number} [now]
     * @param {CanvasRenderingContext2D} [targetContext]
     */
    draw(now = (typeof gameClock !== 'undefined' ? gameClock : performance.now()), targetContext) {
        const renderCtx = targetContext || (typeof ctx !== 'undefined' ? ctx : null);
        if (!renderCtx) return;

        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const t = this.getProgress(curTime);
        const pColor = this.player ? this.player.color : '#00ffff';
        const ringColor = this.player ? this.player.ring : '#112222';
        const modifier = this.player ? this.player.meleeRangeModifier : 1.0;

        // Dynamically anchor to the moving player
        const posX = (this.player && this.player.alive) ? this.player.x : this.x;
        const posY = (this.player && this.player.alive) ? this.player.y : this.y;

        const handleW = 18 * modifier;
        const headLength = this.r * 0.48;
        const handleLength = this.r * 0.52;
        const headWidth = this.r * 0.95;

        // 1. Organic Footprint / Impact Zone (subtle biological indicator)
        renderCtx.save();
        renderCtx.translate(posX, posY);
        renderCtx.rotate(this.angle);

        renderCtx.beginPath();
        renderCtx.moveTo(0, -handleW * 0.5);
        renderCtx.quadraticCurveTo(handleLength * 0.5, -handleW * 0.7, handleLength, -headWidth * 0.45);
        renderCtx.quadraticCurveTo(this.r * 0.85, -headWidth * 0.52, this.r, 0);
        renderCtx.quadraticCurveTo(this.r * 0.85, headWidth * 0.52, handleLength, headWidth * 0.45);
        renderCtx.quadraticCurveTo(handleLength * 0.5, handleW * 0.7, 0, handleW * 0.5);
        renderCtx.closePath();

        renderCtx.fillStyle = pColor;
        renderCtx.globalAlpha = 0.08 * (1 - t);
        renderCtx.fill();

        renderCtx.strokeStyle = pColor;
        renderCtx.lineWidth = 1.6;
        renderCtx.setLineDash([5, 4]);
        renderCtx.globalAlpha = 0.35 * (1 - t);
        renderCtx.stroke();
        renderCtx.restore();

        // 2. Viscous Ground Rupture Fissures (branching biological shock cracks)
        renderCtx.save();
        renderCtx.translate(posX, posY);
        renderCtx.rotate(this.angle);

        renderCtx.strokeStyle = pColor;
        renderCtx.lineWidth = 1.6 * (1 - t);
        renderCtx.globalAlpha = 0.75 * (1 - t);
        renderCtx.lineCap = 'round';

        // Central hydraulic fissure
        const crackProgress = Math.min(1, t * 1.6);
        renderCtx.beginPath();
        renderCtx.moveTo(10, 0);
        renderCtx.lineTo(this.r * (0.3 + 0.7 * crackProgress), 0);
        renderCtx.stroke();

        // Lateral branching ruptures at impact apex
        if (t > 0.15) {
            const branchT = Math.min(1, (t - 0.15) / 0.85);
            renderCtx.beginPath();
            // Left branch
            renderCtx.moveTo(this.r * 0.75, 0);
            renderCtx.quadraticCurveTo(this.r * 0.88, -headWidth * 0.28 * branchT, this.r * 0.95, -headWidth * 0.42 * branchT);
            // Right branch
            renderCtx.moveTo(this.r * 0.75, 0);
            renderCtx.quadraticCurveTo(this.r * 0.88, headWidth * 0.28 * branchT, this.r * 0.95, headWidth * 0.42 * branchT);
            renderCtx.stroke();
        }
        renderCtx.restore();

        // 3. Expanding Gelatinous Shockwave Front
        renderCtx.save();
        renderCtx.translate(posX, posY);
        renderCtx.rotate(this.angle);

        const shockR = this.r * (0.35 + 0.65 * t);
        renderCtx.strokeStyle = '#ffffff';
        renderCtx.lineWidth = 3.5 * (1 - t);
        renderCtx.globalAlpha = 0.80 * (1 - t);
        renderCtx.beginPath();
        renderCtx.arc(this.r * 0.65, 0, shockR * 0.45, -Math.PI * 0.45, Math.PI * 0.45);
        renderCtx.stroke();
        renderCtx.restore();

        // 4. Massive Muscular Cytoplasmic Hammer Limb (Crushing Bio-Slam)
        const slamT = Math.min(1, t / 0.38);
        const swingEase = Math.sin(slamT * Math.PI * 0.5);
        const currentSwingAngle = this.angle - (1 - swingEase) * (Math.PI * 0.35);

        const armReach = (this.r * 0.82) * (0.55 + 0.45 * swingEase);
        const hx = posX + Math.cos(currentSwingAngle) * armReach;
        const hy = posY + Math.sin(currentSwingAngle) * armReach;

        // Draw the muscular hydrostatic arm stalk
        renderCtx.save();
        const armNormX = -Math.sin(currentSwingAngle);
        const armNormY = Math.cos(currentSwingAngle);
        const baseW = 20 * modifier * (1 - t * 0.35);
        const midW = 15 * modifier * (1 - t * 0.35);

        renderCtx.beginPath();
        renderCtx.moveTo(posX + armNormX * (baseW * 0.5), posY + armNormY * (baseW * 0.5));
        renderCtx.quadraticCurveTo(
            posX + Math.cos(currentSwingAngle) * (armReach * 0.5) + armNormX * (midW * 0.5),
            posY + Math.sin(currentSwingAngle) * (armReach * 0.5) + armNormY * (midW * 0.5),
            hx + armNormX * 10, hy + armNormY * 10
        );
        renderCtx.lineTo(hx - armNormX * 10, hy - armNormY * 10);
        renderCtx.quadraticCurveTo(
            posX + Math.cos(currentSwingAngle) * (armReach * 0.5) - armNormX * (midW * 0.5),
            posY + Math.sin(currentSwingAngle) * (armReach * 0.5) - armNormY * (midW * 0.5),
            posX - armNormX * (baseW * 0.5), posY - armNormY * (baseW * 0.5)
        );
        renderCtx.closePath();

        renderCtx.fillStyle = pColor;
        renderCtx.globalAlpha = 0.85 * (1 - t * 0.4);
        renderCtx.fill();
        renderCtx.strokeStyle = ringColor;
        renderCtx.lineWidth = 2.0;
        renderCtx.stroke();

        // 5. Heavy Bulbous Bio-Hammer Head
        renderCtx.translate(hx, hy);
        renderCtx.rotate(currentSwingAngle);

        const headR = (25 * modifier) * (1 - t * 0.25);
        renderCtx.beginPath();
        renderCtx.arc(0, 0, headR, -Math.PI * 0.5, Math.PI * 0.5);
        renderCtx.quadraticCurveTo(headR * 0.4, headR * 0.7, -headR * 0.6, headR * 0.4);
        renderCtx.lineTo(-headR * 0.6, -headR * 0.4);
        renderCtx.quadraticCurveTo(headR * 0.4, -headR * 0.7, 0, -headR * 0.5);
        renderCtx.closePath();

        renderCtx.fillStyle = pColor;
        renderCtx.globalAlpha = 0.95 * (1 - t * 0.35);
        renderCtx.fill();
        renderCtx.strokeStyle = ringColor;
        renderCtx.lineWidth = 2.4;
        renderCtx.stroke();

        // Hardened chitinous impact crests on the forward striking face
        renderCtx.strokeStyle = '#ffffff';
        renderCtx.lineWidth = 2.0;
        renderCtx.globalAlpha = 0.80 * (1 - t * 0.5);
        renderCtx.beginPath();
        renderCtx.arc(0, 0, headR * 0.92, -Math.PI * 0.35, Math.PI * 0.35);
        renderCtx.stroke();

        // Glowing internal organelle core (flashes bright on impact)
        const coreFlash = (t >= 0.25 && t <= 0.65) ? (1 - Math.abs(t - 0.45) / 0.20) : 0;
        renderCtx.fillStyle = '#ffffff';
        renderCtx.globalAlpha = 0.70 + 0.30 * coreFlash;
        renderCtx.beginPath();
        renderCtx.arc(0, 0, 5.5 + 4.0 * coreFlash, 0, Math.PI * 2);
        renderCtx.fill();

        renderCtx.restore();
    }
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== 'undefined') {
    window.CombatVFX = CombatVFX;
    window.ExplosionVFX = ExplosionVFX;
    window.MineExplosion = MineExplosion;
    window.NukeExplosion = NukeExplosion;
    window.FreezeBlastVisual = FreezeBlastVisual;
    window.InstantHitImpact = InstantHitImpact;
    window.InstantMuzzleFlash = InstantMuzzleFlash;
    window.SledgeHitVisual = SledgeHitVisual;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CombatVFX,
        ExplosionVFX,
        MineExplosion,
        NukeExplosion,
        FreezeBlastVisual,
        InstantHitImpact,
        InstantMuzzleFlash,
        SledgeHitVisual
    };
}
