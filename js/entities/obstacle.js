/**
 * BlobSurvival - Obstacle Entity Hierarchy & Collision Resolvers
 * 
 * Defines the base Obstacle entity class and concrete battlefield terrain
 * structures:
 * - Obstacle (Base Entity for physical/blocking barriers)
 * - ShieldObstacle / ShieldTerrain (Energy Arc Half-Circle Barriers)
 * - WallObstacle / WallDebrisObstacle (Basalt Rock Slabs & Crag Formations)
 * 
 * Also provides high-performance 2D arc and oriented-box collision resolvers.
 */

// ---------------- 1. Base Obstacle Entity ----------------

class Obstacle extends Entity {
    constructor(x, y, r = 20, obstacleType = 'generic') {
        super(x, y, r);
        this.obstacleType = obstacleType;
        this.isObstacle = true;
        this.solid = true;
    }

    isExpired(now) {
        return false;
    }

    isAlive(now) {
        return !this.isExpired(now);
    }

    resolveCollision(unit) {
        return false;
    }

    update(dt, dtFactor, now) {
        // Base obstacles are static by default
    }

    draw(now) {
        // Subclasses implement custom aesthetic renderers
    }
}

// ---------------- 2. Shield Obstacle (Energy Arc Barrier) ----------------

class ShieldObstacle extends Obstacle {
    constructor(x, y, radius = 100, facingAngle = 0, expiresAt = 0) {
        super(x, y, radius, 'shield');
        this.facingAngle = facingAngle;
        this.shieldHalfArc = Math.PI * 0.5; // exact half circle
        this.expiresAt = expiresAt;
    }

    isExpired(now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        return curTime >= this.expiresAt;
    }

    isAlive(now) {
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        return !this.isExpired(curTime);
    }

    resolveCollision(unit) {
        return resolvePlayerArcWallCollision(unit, this.x, this.y, this.r, this.facingAngle);
    }

    draw(now) {
        if (typeof ctx === 'undefined') return;
        const curTime = (typeof now === 'number' && !isNaN(now)) ? now : (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const remaining = Math.max(0, this.expiresAt - curTime);
        const fadeAlpha = remaining < 1000 ? remaining / 1000 : 1.0;
        ctx.save();
        ctx.globalAlpha = fadeAlpha * 0.95;

        const facing = this.facingAngle || 0;
        const sR = this.r;
        const sArc = this.shieldHalfArc;

        // 1. Half-Circle Frontal Energy Shield Field (dark translucent amber-bronze barrier)
        ctx.fillStyle = 'rgba(120, 53, 15, 0.045)';
        ctx.beginPath();
        ctx.arc(this.x, this.y, sR, facing - sArc, facing + sArc);
        ctx.lineTo(this.x, this.y);
        ctx.closePath();
        ctx.fill();

        // 2. Half-Circle Curved Shield Arc (dark matte burnt-amber barrier)
        ctx.strokeStyle = '#92400e';
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, sR, facing - sArc, facing + sArc);
        ctx.stroke();

        // Inner subtle bronze accent stripe
        ctx.globalAlpha = (remaining < 1000 ? remaining / 1000 : 1.0) * 0.5;
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, sR, facing - sArc * 0.96, facing + sArc * 0.96);
        ctx.stroke();
        ctx.globalAlpha = (remaining < 1000 ? remaining / 1000 : 1.0) * 0.95;

        // Heavy metallic emitter brackets at the shield tips
        ctx.fillStyle = '#1c1917';
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 1.5;
        for (const side of [-1, 1]) {
            const tipAngle = facing + side * sArc;
            const tx = this.x + Math.cos(tipAngle) * sR;
            const ty = this.y + Math.sin(tipAngle) * sR;
            ctx.beginPath();
            ctx.arc(tx, ty, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // Dropped center core mount
        ctx.fillStyle = '#212121';
        ctx.strokeStyle = '#ff8f00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }
}

// Alias for backwards compatibility
const ShieldTerrain = ShieldObstacle;

// ---------------- 3. Wall Obstacle (Sheared Basalt / Rock Slabs) ----------------

class WallObstacle extends Obstacle {
    constructor(x, y, halfW = 95, halfH = 22, angle = 0) {
        super(x, y, Math.hypot(halfW, halfH), 'wall');
        this.halfW = halfW;
        this.halfH = halfH;
        this.angle = angle;
        this.isWallObstacle = true;
    }

    isExpired(now) {
        return false; // Permanent battlefield obstacle
    }

    isAlive(now) {
        return true;
    }

    resolveCollision(unit) {
        return resolvePlayerOrientedBoxCollision(unit, this.x, this.y, this.halfW, this.halfH, this.angle);
    }

    draw(now) {
        if (typeof ctx === 'undefined') return;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        const hw = this.halfW;
        const hh = this.halfH;

        // 1. Deep shadow underneath the giant cliff rock slab
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.beginPath();
        ctx.ellipse(6, 10, hw * 1.12, hh * 1.45, 0, 0, Math.PI * 2);
        ctx.fill();

        // 2. Main Jagged Cliff Rock Formation (Heavy Basalt / Slate / Granite)
        ctx.fillStyle = '#292524';
        ctx.strokeStyle = '#1c1917';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        // Top jagged edge showing sheared rock fracture peaks
        ctx.moveTo(-hw * 1.05, -hh * 0.35);
        ctx.lineTo(-hw * 0.88, -hh * 1.2);
        ctx.lineTo(-hw * 0.68, -hh * 0.75);
        ctx.lineTo(-hw * 0.45, -hh * 1.35);
        ctx.lineTo(-hw * 0.22, -hh * 0.85);
        ctx.lineTo(0, -hh * 1.25);
        ctx.lineTo(hw * 0.25, -hh * 0.8);
        ctx.lineTo(hw * 0.52, -hh * 1.4);
        ctx.lineTo(hw * 0.78, -hh * 0.7);
        ctx.lineTo(hw * 1.06, -hh * 0.4);
        // Bottom fractured edge with fallen boulder crags
        ctx.lineTo(hw * 1.02, hh * 0.65);
        ctx.lineTo(hw * 0.82, hh * 1.3);
        ctx.lineTo(hw * 0.58, hh * 0.8);
        ctx.lineTo(hw * 0.32, hh * 1.35);
        ctx.lineTo(0, hh * 0.9);
        ctx.lineTo(-hw * 0.28, hh * 1.25);
        ctx.lineTo(-hw * 0.58, hh * 0.75);
        ctx.lineTo(-hw * 0.85, hh * 1.3);
        ctx.lineTo(-hw * 1.04, hh * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 3. Sedimentary Rock Strata Bands & Textured Chiseled Layers
        const strataColors = ['#44403c', '#57534e', '#78716c'];
        for (let s = 0; s < 3; s++) {
            ctx.fillStyle = strataColors[s];
            ctx.beginPath();
            const yOff = (s - 1) * (hh * 0.55);
            ctx.moveTo(-hw * 0.95, yOff - 4);
            ctx.lineTo(-hw * 0.6, yOff - 7);
            ctx.lineTo(-hw * 0.2, yOff - 3);
            ctx.lineTo(hw * 0.2, yOff - 6);
            ctx.lineTo(hw * 0.6, yOff - 2);
            ctx.lineTo(hw * 0.95, yOff - 5);
            ctx.lineTo(hw * 0.95, yOff + 5);
            ctx.lineTo(hw * 0.5, yOff + 7);
            ctx.lineTo(0, yOff + 4);
            ctx.lineTo(-hw * 0.45, yOff + 6);
            ctx.lineTo(-hw * 0.95, yOff + 4);
            ctx.closePath();
            ctx.fill();
        }

        // 4. Sharp Chiseled Rock Highlights (Top Facet Lighting)
        ctx.strokeStyle = '#a8a29e';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(-hw * 0.88, -hh * 1.2);
        ctx.lineTo(-hw * 0.68, -hh * 0.75);
        ctx.lineTo(-hw * 0.45, -hh * 1.35);
        ctx.moveTo(0, -hh * 1.25);
        ctx.lineTo(hw * 0.25, -hh * 0.8);
        ctx.lineTo(hw * 0.52, -hh * 1.4);
        ctx.stroke();

        // Deep shadowy rock crevices & fault fissures
        ctx.strokeStyle = '#0c0a09';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-hw * 0.45, -hh * 1.35);
        ctx.lineTo(-hw * 0.35, 0);
        ctx.lineTo(-hw * 0.28, hh * 1.25);
        ctx.moveTo(hw * 0.25, -hh * 0.8);
        ctx.lineTo(hw * 0.3, 0);
        ctx.lineTo(hw * 0.32, hh * 1.35);
        ctx.stroke();

        // 5. Glowing Subterranean Crystal Veins & Mountain Moss
        ctx.strokeStyle = '#76ff03';
        ctx.lineWidth = 4.0;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(-hw * 0.7, 0);
        ctx.lineTo(-hw * 0.4, 4);
        ctx.lineTo(-hw * 0.1, -3);
        ctx.lineTo(hw * 0.3, 3);
        ctx.lineTo(hw * 0.7, -2);
        ctx.stroke();

        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 1.8;
        ctx.globalAlpha = 1.0;
        ctx.stroke();

        // Glowing crystal clusters (subterranean emerald ore)
        for (const [cx, cy] of [[-hw * 0.5, -4], [0, 2], [hw * 0.45, -3], [-hw * 0.2, 5], [hw * 0.65, 4]]) {
            ctx.fillStyle = '#22c55e';
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.arc(cx, cy, 5.0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#4ade80';
            ctx.globalAlpha = 1.0;
            ctx.beginPath();
            ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // 6. Loose Broken Boulders / Rubble Clusters at the base
        const boulders = [
            [-hw * 1.02, hh * 0.2, 8],
            [-hw * 0.95, -hh * 0.1, 6],
            [-hw * 0.65, hh * 1.1, 7],
            [hw * 0.65, hh * 1.05, 8],
            [hw * 0.98, hh * 0.3, 7],
            [hw * 1.04, -hh * 0.2, 6]
        ];
        ctx.fillStyle = '#44403c';
        ctx.strokeStyle = '#1c1917';
        ctx.lineWidth = 1.5;
        for (const [bx, by, br] of boulders) {
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }
}

// Alias for backwards compatibility
const WallDebrisObstacle = WallObstacle;

// ---------------- 4. Collision Resolution Functions ----------------

function resolvePlayerOrientedBoxCollision(player, boxX, boxY, halfW, halfH, angle) {
    if (!player) return false;
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const dx = player.x - boxX, dy = player.y - boxY;
    const localX = cos * dx - sin * dy;
    const localY = sin * dx + cos * dy;

    const clampX = Math.max(-halfW, Math.min(halfW, localX));
    const clampY = Math.max(-halfH, Math.min(halfH, localY));

    const diffX = localX - clampX;
    const diffY = localY - clampY;
    const distSq = diffX * diffX + diffY * diffY;
    const pr = player.r || 12;

    if (distSq < pr * pr) {
        const dist = Math.sqrt(distSq);
        let overlap = pr - dist;
        let nx = 0, ny = 0;

        if (dist > 0.0001) {
            nx = diffX / dist;
            ny = diffY / dist;
        } else {
            const penX = halfW - Math.abs(localX);
            const penY = halfH - Math.abs(localY);
            if (penX < penY) {
                nx = localX >= 0 ? 1 : -1;
                overlap = penX + pr;
            } else {
                ny = localY >= 0 ? 1 : -1;
                overlap = penY + pr;
            }
        }

        const worldNx = cos * nx + sin * ny;
        const worldNy = -sin * nx + cos * ny;

        player.x += worldNx * overlap;
        player.y += worldNy * overlap;
        return true;
    }
    return false;
}

function resolvePlayerArcWallCollision(player, cx, cy, arcRadius, facingAngle) {
    if (!player) return false;
    const dx = player.x - cx, dy = player.y - cy;
    const dist = Math.hypot(dx, dy);
    const halfArc = Math.PI * 0.5;
    const pr = player.r || 12;
    const wallThick = 4;
    let collided = false;

    // 1. Tip endpoints collision
    for (const side of [-1, 1]) {
        const tipAngle = facingAngle + side * halfArc;
        const tx = cx + Math.cos(tipAngle) * arcRadius;
        const ty = cy + Math.sin(tipAngle) * arcRadius;
        const tdx = player.x - tx, tdy = player.y - ty;
        const tdist = Math.hypot(tdx, tdy);
        const minTipDist = pr + 7;
        if (tdist < minTipDist && tdist > 0.001) {
            const overlap = minTipDist - tdist;
            player.x += (tdx / tdist) * overlap;
            player.y += (tdy / tdist) * overlap;
            collided = true;
        }
    }

    // 2. Arc barrier wall collision
    if (dist > 0.001) {
        const angleToPlayer = Math.atan2(dy, dx);
        let angleDiff = Math.abs(angleToPlayer - facingAngle);
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        angleDiff = Math.abs(angleDiff);

        if (angleDiff <= halfArc) {
            if (dist < arcRadius) {
                if (dist > arcRadius - (pr + wallThick)) {
                    const overlap = dist - (arcRadius - (pr + wallThick));
                    player.x -= (dx / dist) * overlap;
                    player.y -= (dy / dist) * overlap;
                    collided = true;
                }
            } else {
                if (dist < arcRadius + (pr + wallThick)) {
                    const overlap = (arcRadius + (pr + wallThick)) - dist;
                    player.x += (dx / dist) * overlap;
                    player.y += (dy / dist) * overlap;
                    collided = true;
                }
            }
        }
    }
    return collided;
}

function resolvePlayerTerrainCollisions(player) {
    if (!player) return;
    // 1. Dropped shield terrains & Permanent Wall Debris Obstacles
    if (typeof GAME_STATE !== 'undefined' && GAME_STATE.terrains && GAME_STATE.terrains.length > 0) {
        for (const t of GAME_STATE.terrains) {
            if (t.resolveCollision) {
                t.resolveCollision(player);
            } else if (t.isWallObstacle) {
                resolvePlayerOrientedBoxCollision(player, t.x, t.y, t.halfW || 95, t.halfH || 22, t.angle || 0);
            } else {
                resolvePlayerArcWallCollision(player, t.x, t.y, t.r || 100, t.facingAngle || 0);
            }
        }
    }

    // 2. Gigantic shields CARRIED by alive Shield Bearers
    if (typeof GAME_STATE !== 'undefined' && GAME_STATE.shieldBearers && GAME_STATE.shieldBearers.length > 0) {
        for (let i = 0; i < GAME_STATE.shieldBearers.length; i++) {
            const e = GAME_STATE.shieldBearers[i];
            if (e.hp > 0) {
                resolvePlayerArcWallCollision(player, e.x, e.y, e.shieldRadius || 100, e.facingAngle || 0);

                const dx = player.x - e.x, dy = player.y - e.y;
                const dist = Math.hypot(dx, dy);
                const minBodyDist = (e.r || 20) + (player.r || 12);
                if (dist < minBodyDist && dist > 0.001) {
                    const overlap = minBodyDist - dist;
                    player.x += (dx / dist) * overlap;
                    player.y += (dy / dist) * overlap;
                }
            }
        }
    }
    if (player.clampToArena) player.clampToArena();
}

function resolveEnemyTerrainCollisionsAndPathing(enemy, dtFactor = 1.0) {
    // Monsters can move freely through shields (both carried and dropped)
    return;
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== 'undefined') {
    window.Obstacle = Obstacle;
    window.ShieldObstacle = ShieldObstacle;
    window.ShieldTerrain = ShieldTerrain;
    window.WallObstacle = WallObstacle;
    window.WallDebrisObstacle = WallDebrisObstacle;
    window.resolvePlayerOrientedBoxCollision = resolvePlayerOrientedBoxCollision;
    window.resolvePlayerArcWallCollision = resolvePlayerArcWallCollision;
    window.resolvePlayerTerrainCollisions = resolvePlayerTerrainCollisions;
    window.resolveEnemyTerrainCollisionsAndPathing = resolveEnemyTerrainCollisionsAndPathing;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Obstacle,
        ShieldObstacle,
        ShieldTerrain,
        WallObstacle,
        WallDebrisObstacle,
        resolvePlayerOrientedBoxCollision,
        resolvePlayerArcWallCollision,
        resolvePlayerTerrainCollisions,
        resolveEnemyTerrainCollisionsAndPathing
    };
}
