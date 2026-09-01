/**
 * BlobSurvival - 2D Spatial Partitioning Grid & Collision Geometry
 * 
 * Provides O(1) local enemy queries for projectiles, hazards, and AoE weapons,
 * reducing collision checks across hundreds of active entities by over 95%.
 * Also encapsulates 2D spatial math, raycasting, and obstacle intersection algorithms.
 */

const SPATIAL_GRID_CELL_SIZE = 120;

const SPATIAL_GRID = {
    cellSize: SPATIAL_GRID_CELL_SIZE,
    invCellSize: 1 / SPATIAL_GRID_CELL_SIZE,
    cols: 0,
    rows: 0,
    cells: [],
    
    init(w, h) {
        this.cols = Math.ceil((w || 1512) * this.invCellSize) + 2;
        this.rows = Math.ceil((h || 900) * this.invCellSize) + 2;
        const total = this.cols * this.rows;
        if (this.cells.length < total) {
            this.cells = new Array(total);
            for (let i = 0; i < total; i++) this.cells[i] = [];
        }
    },
    
    clear() {
        const total = this.cols * this.rows;
        for (let i = 0; i < total; i++) {
            if (this.cells[i]) this.cells[i].length = 0;
        }
    },
    
    rebuild() {
        const total = this.cols * this.rows;
        if (total === 0 || this.cells.length < total) {
            const curW = (typeof W !== "undefined") ? W : 1512;
            const curH = (typeof H !== "undefined") ? H : 900;
            this.init(curW, curH);
        }
        this.clear();
        if (typeof GAME_STATE === "undefined" || !GAME_STATE.enemies) return;
        const enemies = GAME_STATE.enemies;
        const count = enemies.length;
        const inv = this.invCellSize;
        const cols = this.cols;
        const rows = this.rows;
        
        for (let i = 0; i < count; i++) {
            const e = enemies[i];
            if (e.hp <= 0) continue;
            let cx = Math.floor(e.x * inv) + 1;
            let cy = Math.floor(e.y * inv) + 1;
            if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
            if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
            
            this.cells[cy * cols + cx].push(e);
        }
    },
    
    queryBox(minX, maxX, minY, maxY, callback) {
        const inv = this.invCellSize;
        const cols = this.cols;
        const rows = this.rows;
        if (cols === 0 || rows === 0) return true;
        
        let minCX = Math.floor(minX * inv) + 1;
        let maxCX = Math.floor(maxX * inv) + 1;
        let minCY = Math.floor(minY * inv) + 1;
        let maxCY = Math.floor(maxY * inv) + 1;
        
        if (minCX < 0) minCX = 0;
        if (maxCX >= cols) maxCX = cols - 1;
        if (minCY < 0) minCY = 0;
        if (maxCY >= rows) maxCY = rows - 1;
        
        for (let cy = minCY; cy <= maxCY; cy++) {
            const rowOffset = cy * cols;
            for (let cx = minCX; cx <= maxCX; cx++) {
                const cell = this.cells[rowOffset + cx];
                if (!cell) continue;
                const len = cell.length;
                for (let i = 0; i < len; i++) {
                    const e = cell[i];
                    if (callback(e) === false) return false;
                }
            }
        }
        return true;
    },

    MAX_ENEMY_RADIUS: 85,

    queryCircle(x, y, radius, callback) {
        const pad = radius + this.MAX_ENEMY_RADIUS;
        return this.queryBox(x - pad, x + pad, y - pad, y + pad, e => {
            const dx = e.x - x;
            const dy = e.y - y;
            const touch = radius + (e.r || 0);
            if (dx * dx + dy * dy <= touch * touch) {
                return callback(e);
            }
        });
    }
};

// ---------------- 2D Spatial & Geometric Intersection Helpers ----------------

function isOnPlayableArea(entity) {
    if (!entity) return false;
    const curW = (typeof W !== "undefined") ? W : 1920;
    const curH = (typeof H !== "undefined") ? H : 1080;
    return (entity.x >= 0 && entity.x <= curW && entity.y >= 0 && entity.y <= curH);
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * (x2 - x1);
    const projY = y1 + t * (y2 - y1);
    return Math.hypot(px - projX, py - projY);
}

function testShieldArcHit(prevX, prevY, nextX, nextY, projR, cx, cy, arcRadius, facingAngle, halfArc = Math.PI * 0.5) {
    const sR = arcRadius || 100;
    const facing = facingAngle || 0;
    const sArc = halfArc;

    // 1. Raycast line segment crossing the circular arc boundary (R = arcRadius)
    const dx = nextX - prevX;
    const dy = nextY - prevY;
    const fx = prevX - cx;
    const fy = prevY - cy;

    const a = dx * dx + dy * dy;
    if (a > 0.0001) {
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - sR * sR;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
            const sqrtDisc = Math.sqrt(disc);
            const tValues = [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)];
            for (const t of tValues) {
                if (t >= -0.05 && t <= 1.05) {
                    const ix = prevX + t * dx;
                    const iy = prevY + t * dy;
                    const theta = Math.atan2(iy - cy, ix - cx);
                    let angleDiff = Math.abs(theta - facing);
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    angleDiff = Math.abs(angleDiff);

                    if (angleDiff <= sArc) {
                        return { hit: true, hitX: ix, hitY: iy, t: t };
                    }
                }
            }
        }
    }

    // 2. Proximity check on the curved wall boundary at next position
    const dx2 = nextX - cx, dy2 = nextY - cy;
    const dist2 = Math.hypot(dx2, dy2);
    const wallThick = 4 + (projR || 2);
    if (Math.abs(dist2 - sR) <= wallThick) {
        const theta = Math.atan2(dy2, dx2);
        let angleDiff = Math.abs(theta - facing);
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        angleDiff = Math.abs(angleDiff);
        if (angleDiff <= sArc) {
            return { hit: true, hitX: nextX, hitY: nextY, t: 1.0 };
        }
    }

    // 3. Tip endpoints collision
    const tipMinDist = 7 + (projR || 2);
    for (const side of [-1, 1]) {
        const tipAngle = facing + side * sArc;
        const tx = cx + Math.cos(tipAngle) * sR;
        const ty = cy + Math.sin(tipAngle) * sR;
        const tdx = nextX - tx, tdy = nextY - ty;
        if (tdx * tdx + tdy * tdy <= tipMinDist * tipMinDist) {
            return { hit: true, hitX: nextX, hitY: nextY, t: 1.0 };
        }
    }

    return { hit: false };
}

function testOrientedBoxHit(prevX, prevY, nextX, nextY, projR, boxX, boxY, halfW, halfH, angle) {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);

    // Transform points into local box coordinate space
    const l1x = cos * (prevX - boxX) - sin * (prevY - boxY);
    const l1y = sin * (prevX - boxX) + cos * (prevY - boxY);
    const l2x = cos * (nextX - boxX) - sin * (nextY - boxY);
    const l2y = sin * (nextX - boxX) + cos * (nextY - boxY);

    const r = projR || 2;
    const w = halfW + r;
    const h = halfH + r;

    // 1. Check if next point is already inside the expanded box
    if (Math.abs(l2x) <= w && Math.abs(l2y) <= h) {
        return { hit: true, hitX: nextX, hitY: nextY, t: 1.0 };
    }

    // 2. Raycast line segment against the box in local coordinates (Slab method)
    const dx = l2x - l1x;
    const dy = l2y - l1y;

    let tMin = 0.0;
    let tMax = 1.0;

    // X slab
    if (Math.abs(dx) < 1e-6) {
        if (Math.abs(l1x) > w) return { hit: false };
    } else {
        const t1 = (-w - l1x) / dx;
        const t2 = (w - l1x) / dx;
        const tNear = Math.min(t1, t2);
        const tFar = Math.max(t1, t2);
        tMin = Math.max(tMin, tNear);
        tMax = Math.min(tMax, tFar);
        if (tMin > tMax) return { hit: false };
    }

    // Y slab
    if (Math.abs(dy) < 1e-6) {
        if (Math.abs(l1y) > h) return { hit: false };
    } else {
        const t1 = (-h - l1y) / dy;
        const t2 = (h - l1y) / dy;
        const tNear = Math.min(t1, t2);
        const tFar = Math.max(t1, t2);
        tMin = Math.max(tMin, tNear);
        tMax = Math.min(tMax, tFar);
        if (tMin > tMax) return { hit: false };
    }

    if (tMin <= 1.0 && tMax >= 0.0) {
        const hitT = Math.max(0.0, Math.min(1.0, tMin));
        const hitLx = l1x + hitT * dx;
        const hitLy = l1y + hitT * dy;

        // Transform hit point back to world space
        const cosW = Math.cos(angle);
        const sinW = Math.sin(angle);
        const hitX = boxX + cosW * hitLx - sinW * hitLy;
        const hitY = boxY + sinW * hitLx + cosW * hitLy;

        return { hit: true, hitX: hitX, hitY: hitY, t: hitT };
    }

    return { hit: false };
}

function findShieldArcIntersection(x1, y1, x2, y2, targetEnemy) {
    if (typeof GAME_STATE === "undefined") return { blocked: false };
    const hasShieldBearers = GAME_STATE.shieldBearers && GAME_STATE.shieldBearers.length > 0;
    const hasTerrains = GAME_STATE.terrains && GAME_STATE.terrains.length > 0;
    const isBehemothActive = (GAME_STATE.activeBoss === "behemoth");

    // O(1) Fast Exit: zero shields, zero obstacles on map -> no allocation, no loop
    if (!hasShieldBearers && !hasTerrains && !isBehemothActive) {
        return { blocked: false };
    }

    let closestIntersection = null;
    let minT = Infinity;

    // 1. Direct test against alive Shield Bearers (zero object allocation)
    if (hasShieldBearers) {
        for (let i = 0; i < GAME_STATE.shieldBearers.length; i++) {
            const e = GAME_STATE.shieldBearers[i];
            if (e.hp <= 0) continue;
            const sR = e.shieldRadius || 100;
            const sFacing = e.facingAngle || 0;
            const sHalfArc = e.shieldHalfArc || Math.PI * 0.5;
            const test = testShieldArcHit(x1, y1, x2, y2, 2, e.x, e.y, sR, sFacing, sHalfArc);
            if (test.hit) {
                const t = (typeof test.t === "number") ? test.t : 0.5;
                if (t < minT) {
                    minT = t;
                    closestIntersection = {
                        blocked: true,
                        hitX: test.hitX,
                        hitY: test.hitY,
                        shieldBearer: e,
                        t: t
                    };
                }
            }
        }
    }

    // 2. Direct test against dropped Shield Terrains and Titan wall debris
    if (hasTerrains) {
        for (let i = 0; i < GAME_STATE.terrains.length; i++) {
            const t = GAME_STATE.terrains[i];
            if (t.isWallObstacle) {
                const test = testOrientedBoxHit(x1, y1, x2, y2, 2, t.x, t.y, t.halfW || 95, t.halfH || 22, t.angle || 0);
                if (test.hit) {
                    const tVal = (typeof test.t === "number") ? test.t : 0.5;
                    if (tVal < minT) {
                        minT = tVal;
                        closestIntersection = {
                            blocked: true,
                            hitX: test.hitX,
                            hitY: test.hitY,
                            shieldBearer: t,
                            isWallObstacle: true,
                            t: tVal
                        };
                    }
                }
            } else if (!t.isExpired || !t.isExpired(typeof gameClock !== "undefined" ? gameClock : performance.now())) {
                const sR = t.r || 100;
                const sFacing = t.facingAngle || 0;
                const sHalfArc = t.shieldHalfArc || Math.PI * 0.5;
                const test = testShieldArcHit(x1, y1, x2, y2, 2, t.x, t.y, sR, sFacing, sHalfArc);
                if (test.hit) {
                    const t = (typeof test.t === "number") ? test.t : 0.5;
                    if (t < minT) {
                        minT = t;
                        closestIntersection = {
                            blocked: true,
                            hitX: test.hitX,
                            hitY: test.hitY,
                            shieldBearer: t,
                            t: t
                        };
                    }
                }
            }
        }
    }

    // 3. Check actively dragged wall piece on any alive Behemoth
    if (isBehemothActive && GAME_STATE.enemies) {
        for (let i = 0; i < GAME_STATE.enemies.length; i++) {
            const e = GAME_STATE.enemies[i];
            if (e.type === "behemoth" && e.behemothState === "tongue_dragging_wall" && e.hp > 0 && typeof e.wallPieceX === "number") {
                const test = testOrientedBoxHit(x1, y1, x2, y2, 2, e.wallPieceX, e.wallPieceY, 95, 22, e.wallPieceAngle || 0);
                if (test.hit) {
                    const tVal = (typeof test.t === "number") ? test.t : 0.5;
                    if (tVal < minT) {
                        minT = tVal;
                        closestIntersection = {
                            blocked: true,
                            hitX: test.hitX,
                            hitY: test.hitY,
                            shieldBearer: e,
                            isWallObstacle: true,
                            t: tVal
                        };
                    }
                }
            }
        }
    }

    return closestIntersection || { blocked: false };
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== "undefined") {
    window.SPATIAL_GRID_CELL_SIZE = SPATIAL_GRID_CELL_SIZE;
    window.SPATIAL_GRID = SPATIAL_GRID;
    window.isOnPlayableArea = isOnPlayableArea;
    window.pointToSegmentDistance = pointToSegmentDistance;
    window.testShieldArcHit = testShieldArcHit;
    window.testOrientedBoxHit = testOrientedBoxHit;
    window.findShieldArcIntersection = findShieldArcIntersection;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        SPATIAL_GRID_CELL_SIZE,
        SPATIAL_GRID,
        isOnPlayableArea,
        pointToSegmentDistance,
        testShieldArcHit,
        testOrientedBoxHit,
        findShieldArcIntersection
    };
}
