// =========================================================================
// Particle Base Class & Particle Subclasses (Visual Effects Layer)
// Blob Survival Game Engine - js/vfx/particles.js
// =========================================================================

/**
 * Standalone base class for all visual particle effects in the game engine.
 * Decoupled from Entity (VFX layer: no gameplay collision or spatial partitioning).
 */
class Particle {
    /**
     * @param {number} x - Starting X coordinate
     * @param {number} y - Starting Y coordinate
     * @param {number} vx - Initial X velocity
     * @param {number} vy - Initial Y velocity
     * @param {string} color - CSS color string
     * @param {number} lifetime - Total lifetime in milliseconds
     * @param {number} r - Particle radius / bounding visual size
     */
    constructor(x, y, vx = 0, vy = 0, color = '#ffffff', lifetime = 250, r = 1) {
        this.x = x;
        this.y = y;
        this.r = r;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.lifetime = lifetime;
        this.maxLifetime = Math.max(1, lifetime);
        this.alive = true;
    }

    /**
     * Returns normalized remaining lifetime ratio [0.0 - 1.0].
     * @returns {number}
     */
    getLifetimePercent() {
        return Math.max(0, Math.min(1, this.lifetime / this.maxLifetime));
    }

    /**
     * Alias for getLifetimePercent for backward compatibility.
     * @returns {number}
     */
    getLifePercent() {
        return this.getLifetimePercent();
    }

    /**
     * Checks if particle is currently active and within its lifespan.
     * @returns {boolean}
     */
    isAlive() {
        return this.alive && this.lifetime > 0;
    }

    /**
     * Forces immediate despawn of the particle.
     */
    despawn() {
        this.alive = false;
        this.lifetime = 0;
    }

    /**
     * Update contract: advances position, applies friction damping, decrements lifetime,
     * and sets alive = false upon expiration.
     * @param {number} dt - Frame delta time in ms
     * @param {number} dtFactor - Time dilation multiplier
     */
    update(dt, dtFactor = 1.0) {
        this.x += this.vx * dtFactor;
        this.y += this.vy * dtFactor;
        const decay = Math.pow(0.92, dtFactor);
        this.vx *= decay;
        this.vy *= decay;
        this.lifetime -= dt;
        if (this.lifetime <= 0) {
            this.alive = false;
        }
    }

    /**
     * Draw contract: renders the particle with opacity proportional to remaining lifetime.
     * @param {CanvasRenderingContext2D} [targetContext] - Target canvas context (defaults to global ctx)
     */
    draw(targetContext) {
        const renderCtx = targetContext || (typeof ctx !== 'undefined' ? ctx : null);
        if (!renderCtx) return;

        renderCtx.save();
        renderCtx.globalAlpha = this.getLifetimePercent();
        renderCtx.fillStyle = this.color;
        renderCtx.fillRect(this.x - this.r, this.y - this.r, this.r * 2, this.r * 2);
        renderCtx.restore();
    }
}

/**
 * Homing bio-energy wisp that flies toward a designated player to restore HP.
 */
class LifestealWisp extends Particle {
    /**
     * @param {number} x - Starting X coordinate
     * @param {number} y - Starting Y coordinate
     * @param {Player} player - Target player entity to home toward
     * @param {number} boost - Visual boost multiplier
     * @param {number} speed - Homing movement factor
     */
    constructor(x, y, player, boost = 1, speed = 0.032) {
        const lifetime = 750 + Math.random() * 350;
        super(
            x + (Math.random() - 0.5) * 6,
            y + (Math.random() - 0.5) * 6,
            0,
            0,
            'rgba(224, 74, 152, 0.95)',
            lifetime,
            1
        );
        this.player = player;
        this.boost = boost;
        this.speed = speed;
        this.wobble = Math.random() * Math.PI * 2;
        this.maxR = 6 + Math.random() * 3;
        this.grad = null;
    }

    /**
     * Moves toward target player with sinusoidal lateral wobble.
     * @param {number} dt
     * @param {number} dtFactor
     */
    update(dt, dtFactor = 1.0) {
        const p = this.player;
        if (!p || !p.alive) {
            this.alive = false;
            return;
        }
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        const k = this.speed * dtFactor;
        this.x += dx * k;
        this.y += dy * k;
        this.wobble += 0.09 * dtFactor;
        this.x += Math.sin(this.wobble) * 0.5 * dtFactor;
        this.y += Math.cos(this.wobble * 1.3) * 0.5 * dtFactor;
        this.lifetime -= dt;
        if (this.lifetime <= 0) {
            this.alive = false;
        }
    }

    /**
     * Renders radial glowing bio-energy wisp.
     * @param {CanvasRenderingContext2D} [targetContext]
     */
    draw(targetContext) {
        const renderCtx = targetContext || (typeof ctx !== 'undefined' ? ctx : null);
        if (!renderCtx) return;

        const t = this.getLifetimePercent();
        const scale = Math.max(0.02, 0.45 + (1 - t) * 0.55) * this.boost;
        renderCtx.save();
        renderCtx.globalAlpha = Math.min(1, t * 0.5 * this.boost);
        renderCtx.translate(this.x, this.y);
        if (!this.grad) {
            this.grad = renderCtx.createRadialGradient(0, 0, 0, 0, 0, 1);
            this.grad.addColorStop(0, 'rgba(224, 74, 152, 0.95)');
            this.grad.addColorStop(0.5, 'rgba(160, 40, 122, 0.45)');
            this.grad.addColorStop(1, 'rgba(100, 20, 90, 0)');
        }
        renderCtx.scale(scale * this.maxR, scale * this.maxR);
        renderCtx.fillStyle = this.grad;
        renderCtx.beginPath();
        renderCtx.arc(0, 0, 1, 0, Math.PI * 2);
        renderCtx.fill();
        renderCtx.restore();
    }
}

/**
 * Upward-streaming golden light pillar for player revive and milestone ceremonies.
 */
class GoldenPillarParticle extends Particle {
    /**
     * @param {number} x - Starting X coordinate
     * @param {number} y - Starting Y coordinate
     * @param {number} delay - Pre-spawn delay in ms
     */
    constructor(x, y, delay = 0) {
        const lifetime = 900 + Math.random() * 300;
        super(x, y, (Math.random() - 0.5) * 0.4, -(2.2 + Math.random() * 2.0), '#ffd700', lifetime, 2);
        this.delay = delay;
        this.startY = y;
        this.w = 3 + Math.random() * 4;
        this.h = 18 + Math.random() * 22;
        this.elapsed = 0;
        this.grad = null;
    }

    /**
     * Waits for delay period then drifts upwards.
     * @param {number} dt
     * @param {number} dtFactor
     */
    update(dt, dtFactor = 1.0) {
        this.elapsed += dt;
        if (this.elapsed < this.delay) return;
        this.x += this.vx * dtFactor;
        this.y += this.vy * dtFactor;
        this.lifetime -= dt;
        if (this.lifetime <= 0) {
            this.alive = false;
        }
    }

    /**
     * Renders tapered golden beacon pillar with fade-in and sustain.
     * @param {CanvasRenderingContext2D} [targetContext]
     */
    draw(targetContext) {
        if (this.elapsed < this.delay) return;
        const renderCtx = targetContext || (typeof ctx !== 'undefined' ? ctx : null);
        if (!renderCtx) return;

        const t = this.getLifetimePercent();
        const fadeIn = Math.min(1, (1 - t) / 0.15);
        const alpha = Math.min(fadeIn, t) * 0.85;

        if (!this.grad) {
            this.grad = renderCtx.createLinearGradient(0, 0, 0, this.h);
            this.grad.addColorStop(0, '#ffffff');
            this.grad.addColorStop(0.3, '#ffd700');
            this.grad.addColorStop(1, 'rgba(255,160,0,0)');
        }

        renderCtx.save();
        renderCtx.globalAlpha = alpha;
        renderCtx.translate(this.x, this.y);
        renderCtx.fillStyle = this.grad;
        renderCtx.beginPath();
        const halfW = this.w / 2;
        renderCtx.moveTo(-halfW * 0.3, 0);
        renderCtx.lineTo(halfW * 0.3, 0);
        renderCtx.lineTo(halfW, this.h);
        renderCtx.lineTo(-halfW, this.h);
        renderCtx.closePath();
        renderCtx.fill();
        renderCtx.restore();
    }
}

// ---------------- Helper Spawn Functions ----------------

/**
 * Spawns burst hit particles at target coordinates.
 * @param {number} x
 * @param {number} y
 * @param {string} color
 * @param {number} [count=2]
 */
function spawnHitParticles(x, y, color, count = 2) {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.particles) return;
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 1 + Math.random() * 1.5;
        GAME_STATE.particles.push(new Particle(x, y, Math.cos(a) * s, Math.sin(a) * s, color, 250));
    }
}

/**
 * Triggers dual-ring golden pillar ascension ceremony upon player resurrection.
 * @param {Player} player
 * @param {number} [now]
 */
function triggerReviveAnimation(player, now) {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.particles || !player) return;
    const cx = player.x;
    const cy = player.y;
    const pillars = 12;
    const radius = player.r + 20;

    // Outer ring
    for (let i = 0; i < pillars; i++) {
        const angle = (i / pillars) * Math.PI * 2;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        const delay = i * 40;
        GAME_STATE.particles.push(new GoldenPillarParticle(px, py, delay));
    }

    // Inner ring
    const innerPillars = 8;
    const innerRadius = player.r + 5;
    for (let i = 0; i < innerPillars; i++) {
        const angle = (i / innerPillars) * Math.PI * 2 + (Math.PI / innerPillars);
        const px = cx + Math.cos(angle) * innerRadius;
        const py = cy + Math.sin(angle) * innerRadius;
        const delay = i * 50 + 80;
        const p = new GoldenPillarParticle(px, py, delay);
        p.vy *= 0.7;
        p.h *= 0.7;
        GAME_STATE.particles.push(p);
    }
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== 'undefined') {
    window.Particle = Particle;
    window.LifestealWisp = LifestealWisp;
    window.GoldenPillarParticle = GoldenPillarParticle;
    window.spawnHitParticles = spawnHitParticles;
    window.triggerReviveAnimation = triggerReviveAnimation;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Particle,
        LifestealWisp,
        GoldenPillarParticle,
        spawnHitParticles,
        triggerReviveAnimation
    };
}