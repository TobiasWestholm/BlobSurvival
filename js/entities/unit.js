class Unit extends Entity {
    constructor(x = 0, y = 0, r = 15, hp = 100) {
        super(x, y, r);
        this.maxHp = hp;
        this.hp = hp;
        this.speed = 1.0;
        this.facingAngle = 0;
    }

    isAlive() {
        return this.alive && this.hp > 0;
    }

    isTargetable() {
        return this.isAlive();
    }

    isDamageable() {
        return this.isAlive();
    }

    getHpPercent() {
        return this.maxHp > 0 ? Math.max(0, Math.min(1, this.hp / this.maxHp)) : 0;
    }

    heal(amount) {
        if (!this.isAlive() || amount <= 0) return;
        this.hp = Math.min(this.maxHp, this.hp + amount);
    }

    takeDamage(amount, now, source) {
        if (!this.isAlive() || amount <= 0) return false;
        this.hp = Math.max(0, this.hp - amount);
        this.onTakeDamage(amount, now, source);
        if (this.hp <= 0) {
            this.hp = 0;
            this.despawn(now, source);
        }
        return true;
    }

    despawn(now, source) {
        if (!this.alive) return;
        this.alive = false;
        this.onDeath(now, source);
    }

    onTakeDamage(amount, now, source) {}
    onDeath(now, source) {}

    // Static Query Helpers
    static findClosest(source, candidates = (typeof GAME_STATE !== 'undefined' ? GAME_STATE.enemies : []), maxRange = Infinity, filterFn = null) {
        if (!source || !candidates) return null;
        let closest = null;
        let minD2 = maxRange === Infinity ? Infinity : maxRange * maxRange;
        const count = candidates.length;
        for (let i = 0; i < count; i++) {
            const u = candidates[i];
            if (!u || !u.isTargetable()) continue;
            if (filterFn && !filterFn(u)) continue;
            const dx = u.x - source.x;
            const dy = u.y - source.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < minD2) {
                minD2 = d2;
                closest = u;
            }
        }
        return closest;
    }

    static findStrongestClosest(px, py, candidates = (typeof GAME_STATE !== 'undefined' ? GAME_STATE.enemies : [])) {
        if (!candidates) return null;
        let strongest = null;
        let highestMaxHp = -Infinity;
        let minD2 = Infinity;
        const count = candidates.length;
        for (let i = 0; i < count; i++) {
            const e = candidates[i];
            if (!e || !e.isTargetable()) continue;
            const dx = e.x - px;
            const dy = e.y - py;
            const d2 = dx * dx + dy * dy;
            const enemyMaxHp = e.maxHp || e.hp;
            if (enemyMaxHp > highestMaxHp) {
                highestMaxHp = enemyMaxHp;
                minD2 = d2;
                strongest = e;
            } else if (enemyMaxHp === highestMaxHp && d2 < minD2) {
                minD2 = d2;
                strongest = e;
            }
        }
        return strongest;
    }
}

// Global utility predicates and targeting aliases for backwards compatibility
function isTargetable(unit) {
    if (!unit) return false;
    if (typeof unit.isTargetable === 'function') return unit.isTargetable();
    return Boolean(unit.alive);
}

function isDamageable(unit) {
    if (!unit) return false;
    if (typeof unit.isDamageable === 'function') return unit.isDamageable();
    return Boolean(unit.alive);
}

function getStrongestClosestEnemy(px, py) {
    return Unit.findStrongestClosest(px, py);
}

if (typeof window !== 'undefined') {
    window.Unit = Unit;
    window.isTargetable = isTargetable;
    window.isDamageable = isDamageable;
    window.getStrongestClosestEnemy = getStrongestClosestEnemy;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Unit,
        isTargetable,
        isDamageable,
        getStrongestClosestEnemy
    };
}