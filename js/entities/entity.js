class Entity {
    constructor(x = 0, y = 0, r = 10) {
        this.x = x;
        this.y = y;
        this.r = r;
        this.alive = true;
    }

    isAlive() {
        return this.alive;
    }

    despawn() {
        this.alive = false;
    }

    distanceToSq(other) {
        if (!other) return Infinity;
        const dx = this.x - (other.x || 0);
        const dy = this.y - (other.y || 0);
        return dx * dx + dy * dy;
    }

    collidesWith(other, extraPadding = 0) {
        if (!other || !this.isAlive()) return false;
        const isOtherAlive = typeof other.isAlive === 'function' ? other.isAlive() : other.alive;
        if (!isOtherAlive) return false;
        const maxDist = this.r + (other.r || 0) + extraPadding;
        return this.distanceToSq(other) <= maxDist * maxDist;
    }

    angleTo(other) {
        if (!other) return 0;
        return Math.atan2((other.y || 0) - this.y, (other.x || 0) - this.x);
    }

    clampToArena(minX = 0, minY = 0, maxX = (typeof W !== 'undefined' ? W : 1512), maxY = (typeof H !== 'undefined' ? H : 900), margin = 0) {
        const rad = this.r + margin;
        this.x = Math.max(minX + rad, Math.min(maxX - rad, this.x));
        this.y = Math.max(minY + rad, Math.min(maxY - rad, this.y));
    }

    update(now, dt, dtFactor) {}
    draw(ctx, now) {}

    static findClosest(source, entities, maxRange = Infinity, filterFn = null) {
        if (!source || !entities || entities.length === 0) return null;
        let closest = null;
        let minD2 = maxRange * maxRange;
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i];
            if (!e) continue;
            const isAlive = typeof e.isAlive === 'function' ? e.isAlive() : e.alive;
            if (!isAlive) continue;
            if (filterFn && !filterFn(e)) continue;
            const d2 = source.distanceToSq(e);
            if (d2 < minD2) {
                minD2 = d2;
                closest = e;
            }
        }
        return closest;
    }
}

window.Entity = Entity;