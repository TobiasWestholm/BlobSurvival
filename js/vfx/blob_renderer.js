// =========================================================================
// Procedural Organic Blob Membrane Renderer (Visual Effects Layer)
// Blob Survival Game Engine - js/vfx/blob_renderer.js
// =========================================================================

/**
 * Cache for calculated organic blob contour points to eliminate redundant computation per frame.
 */
let _blobPathCache = {
    key: '',
    points: []
};

/**
 * Generates and draws a procedural, organic, sinusoidal liquid membrane contour for a blob unit.
 * Simulates breathing waves, movement squash-and-stretch, budding daughter drops, pseudopods,
 * flagella sockets, deflector roots, and violent weapon recoil deformations.
 *
 * @param {CanvasRenderingContext2D} ctx - Target canvas rendering context
 * @param {number} centerX - Blob center X coordinate
 * @param {number} centerY - Blob center Y coordinate
 * @param {number} radius - Base resting radius of the blob
 * @param {number} now - Game clock timestamp
 * @param {number} [facingAngle=0] - Direction the blob is facing / moving (radians)
 * @param {number} [moveSpeed=0] - Current velocity magnitude (pixels/sec or relative)
 * @param {Array} [buds=[]] - Array of active budding protrusion descriptors
 * @param {Object} [pseudopod=null] - Active pseudopod reaching extension descriptor
 * @param {Object} [flagellum=null] - Active whipping flagellum root descriptor
 * @param {Array} [deflectorRoots=[]] - Array of deflector shield muscle root descriptors
 * @param {Object} [sniperDeform=null] - Violent sniper recoil elongation descriptor
 * @param {Object} [hatchDeform=null] - Turret hatching birth pouch descriptor
 * @param {Object} [sledgeDeform=null] - Sledgehammer impact compression descriptor
 * @param {Object} [mineLaunchDeform=null] - Proximity mine launch bulb descriptor
 * @param {Object} [rocketDeform=null] - Rocket launch muscular recoil descriptor
 * @param {Object} [dashLaunchDeform=null] - Phase dash warp elongation descriptor
 * @param {Object} [laserSnailDeform=null] - Laser snail teardrop tail descriptor
 * @returns {Array<{x: number, y: number}>} Calculated perimeter boundary points
 */
function drawOrganicBlobPath(
    ctx,
    centerX,
    centerY,
    radius,
    now,
    facingAngle = 0,
    moveSpeed = 0,
    buds = [],
    pseudopod = null,
    flagellum = null,
    deflectorRoots = [],
    sniperDeform = null,
    hatchDeform = null,
    sledgeDeform = null,
    mineLaunchDeform = null,
    rocketDeform = null,
    dashLaunchDeform = null,
    laserSnailDeform = null
) {
    const segments = 32;
    const cacheKey = `${centerX.toFixed(1)}_${centerY.toFixed(1)}_${radius.toFixed(1)}_${now.toFixed(1)}_${facingAngle.toFixed(2)}_${moveSpeed.toFixed(2)}`;
    let points;

    if (_blobPathCache.key === cacheKey) {
        points = _blobPathCache.points;
    } else {
        points = [];
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            
            // 1. Viscous liquid breathing ripples
            const wave1 = Math.sin(now * 0.0035 + angle * 2) * (radius * 0.05);
            const wave2 = Math.cos(now * 0.0055 - angle * 3) * (radius * 0.035);
            
            // 2. Velocity elongation / compression (squash & stretch in movement direction)
            let stretch = 0;
            if (moveSpeed > 0) {
                const angleDiff = angle - facingAngle;
                // Stretch along facingAngle, compress perpendicular
                stretch = Math.cos(angleDiff * 2) * Math.min(0.22, moveSpeed * 0.04) * radius;
            }

            // 3. Budding protrusions (lava lamp surface pulling towards separating daughter drops)
            let budOffset = 0;
            if (buds && buds.length > 0) {
                for (const bud of buds) {
                    let diff = angle - bud.angle;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    const distAngle = Math.abs(diff);
                    if (distAngle < Math.PI * 0.45) {
                        const factor = Math.cos(distAngle * (Math.PI / (Math.PI * 0.45)));
                        const elapsed = now - bud.time;
                        if (elapsed < bud.duration) {
                            const progress = elapsed / bud.duration;
                            const pulse = Math.sin(progress * Math.PI);
                            budOffset += factor * pulse * (radius * 0.45);
                        }
                    }
                }
            }

            // 4. Direct Pseudopod Extension & Reactive Body Deformation
            let pseudopodOffset = 0;
            if (pseudopod && pseudopod.reach > 0) {
                let diff = angle - pseudopod.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const distAngle = Math.abs(diff);
                const hw = pseudopod.halfWidth || 0.40;
                if (distAngle < hw) {
                    // Main protruding pseudopod arm (tighter, leaner profile)
                    const tNorm = distAngle / hw; // 0 at center, 1 at base
                    const factor = Math.cos(tNorm * Math.PI * 0.5);
                    pseudopodOffset = pseudopod.reach * Math.pow(factor, 2.2);
                } else {
                    // Reactive body volume distortion:
                    // Flanks pull forward towards the extension, rear squashes / indents inward
                    const cosDiff = Math.cos(distAngle);
                    if (cosDiff > 0) {
                        // Flank pull
                        pseudopodOffset = (pseudopod.reach * 0.12) * Math.sin(distAngle * 2);
                    } else {
                        // Rear suction / indentation (volume conservation)
                        pseudopodOffset = -(pseudopod.reach * 0.22) * Math.pow(-cosDiff, 1.5);
                    }
                }
            }

            // 5. Flagellum Tail Root Deformation (muscular socket pulled by whip tension)
            let flagellumOffset = 0;
            if (flagellum && flagellum.active && flagellum.tension > 0) {
                let diff = angle - flagellum.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const distAngle = Math.abs(diff);
                const hw = 0.32;
                if (distAngle < hw) {
                    const tNorm = distAngle / hw;
                    const factor = Math.cos(tNorm * Math.PI * 0.5);
                    flagellumOffset = flagellum.tension * (radius * 0.22) * Math.pow(factor, 2.0);
                }
            }

            // 6. Deflector Shield Arm Root Deformations (muscular nodes on the main blob)
            let deflectorOffset = 0;
            if (deflectorRoots && deflectorRoots.length > 0) {
                for (const root of deflectorRoots) {
                    if (!root.growth || root.growth <= 0.01) continue;
                    let diff = angle - root.angle;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    const distAngle = Math.abs(diff);
                    const hw = 0.28;
                    if (distAngle < hw) {
                        const tNorm = distAngle / hw;
                        const factor = Math.cos(tNorm * Math.PI * 0.5);
                        deflectorOffset += root.growth * (radius * 0.14) * Math.pow(factor, 2.0);
                    }
                }
            }

            // 7. Violent Sniper Shot Body Elongation & Needle Dart Deformation
            let sniperOffset = 0;
            if (sniperDeform && Math.abs(sniperDeform.intensity) > 0) {
                let diff = angle - sniperDeform.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const distAngle = Math.abs(diff);
                
                // Along the shot direction: violent long snout elongation (up to 3.2x radius extension)
                const hw = 0.44;
                if (distAngle < hw) {
                    const tNorm = distAngle / hw;
                    const factor = Math.cos(tNorm * Math.PI * 0.5);
                    sniperOffset += sniperDeform.intensity * (radius * 3.2) * Math.pow(factor, 2.4);
                } else {
                    // Violent lateral constriction (flanks pull in tight) and rear volume suction
                    const cosDiff = Math.cos(distAngle);
                    if (cosDiff > 0) {
                        // Flank suction / pinch
                        sniperOffset -= sniperDeform.intensity * (radius * 0.48) * Math.sin(distAngle * 2);
                    } else {
                        // Rear collapse / indentation
                        sniperOffset -= sniperDeform.intensity * (radius * 0.35) * Math.pow(-cosDiff, 1.8);
                    }
                }
            }

            // 8. Turret Hatching Birth Protrusion & Reactive Perimeter Indentation
            let hatchOffset = 0;
            if (hatchDeform && Math.abs(hatchDeform.intensity) > 0) {
                let diff = angle - hatchDeform.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const distAngle = Math.abs(diff);

                // Bulbous maternal pouch budding outwards towards the turret birth site
                const hw = 0.55;
                if (distAngle < hw) {
                    const tNorm = distAngle / hw;
                    const factor = Math.cos(tNorm * Math.PI * 0.5);
                    hatchOffset += hatchDeform.intensity * (radius * 0.85) * Math.pow(factor, 1.6);
                } else {
                    // Reactive body constriction
                    const cosDiff = Math.cos(distAngle);
                    if (cosDiff > 0) {
                        hatchOffset -= hatchDeform.intensity * (radius * 0.25) * Math.sin(distAngle * 2);
                    }
                }
            }

            // 9. Sledgehammer Shockwave Body Compression
            let sledgeOffset = 0;
            if (sledgeDeform && Math.abs(sledgeDeform.intensity) > 0) {
                let diff = angle - sledgeDeform.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const distAngle = Math.abs(diff);

                // Frontal compression flattening + violent lateral outward expulsion
                const cosDiff = Math.cos(distAngle);
                if (cosDiff > 0) {
                    sledgeOffset -= sledgeDeform.intensity * (radius * 0.40) * Math.pow(cosDiff, 2.0);
                } else {
                    sledgeOffset += sledgeDeform.intensity * (radius * 0.30) * Math.sin(distAngle * 2);
                }
            }

            // 10. Proximity Mine Launch Bulbous Protrusion
            let mineLaunchOffset = 0;
            if (mineLaunchDeform && Math.abs(mineLaunchDeform.intensity) > 0) {
                let diff = angle - mineLaunchDeform.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const distAngle = Math.abs(diff);

                const hw = 0.50;
                if (distAngle < hw) {
                    const tNorm = distAngle / hw;
                    const factor = Math.cos(tNorm * Math.PI * 0.5);
                    mineLaunchOffset += mineLaunchDeform.intensity * (radius * 0.70) * Math.pow(factor, 1.8);
                }
            }

            // 11. Rocket Launch Sudden Muscular Recoil Bulb
            let rocketOffset = 0;
            if (rocketDeform && Math.abs(rocketDeform.intensity) > 0) {
                let diff = angle - rocketDeform.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const distAngle = Math.abs(diff);

                const hw = 0.46;
                if (distAngle < hw) {
                    const tNorm = distAngle / hw;
                    const factor = Math.cos(tNorm * Math.PI * 0.5);
                    rocketOffset += rocketDeform.intensity * (radius * 0.60) * Math.pow(factor, 1.8);
                }
            }

            // 12. Phase Dash Muscular Warp Elongation & Rear Drag Dimple
            let dashLaunchOffset = 0;
            if (dashLaunchDeform && Math.abs(dashLaunchDeform.intensity) > 0) {
                let diff = angle - dashLaunchDeform.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const distAngle = Math.abs(diff);

                // Forward aerodynamic elongation in dash direction
                const hwFwd = 0.52;
                if (distAngle < hwFwd) {
                    const tNorm = distAngle / hwFwd;
                    const factor = Math.cos(tNorm * Math.PI * 0.5);
                    dashLaunchOffset += dashLaunchDeform.intensity * (radius * 0.65) * Math.pow(factor, 1.8);
                }

                // Rear muscular socket elongation towards start location
                const rearDiff = Math.abs(Math.PI - distAngle);
                const hwRear = 0.50;
                if (rearDiff < hwRear) {
                    const tNorm = rearDiff / hwRear;
                    const factor = Math.cos(tNorm * Math.PI * 0.5);
                    dashLaunchOffset += dashLaunchDeform.intensity * (radius * 0.55) * Math.pow(factor, 1.8);
                }
            }

            // 13. Dynamic Teardrop / Raindrop Taper Deformation (Laser Trail Tail / Dual Tails)
            let laserSnailOffset = 0;
            if (laserSnailDeform && laserSnailDeform.intensity > 0) {
                const rearAngle = laserSnailDeform.facingAngle + Math.PI;

                if (laserSnailDeform.dualTails) {
                    // Dual splitting arms reaching directly to the ±22px laser spawn points
                    const rearReach = radius * 0.55;
                    const targetDist = Math.hypot(rearReach, 22);
                    const tailAngleOffset = Math.atan2(22, rearReach);
                    const tailExtension = Math.max(radius * 0.55, targetDist - radius + 4);

                    // 1. Left and right lateral tail peaks
                    for (const side of [-1, 1]) {
                        const tailTarget = rearAngle + side * tailAngleOffset;
                        let diffSide = angle - tailTarget;
                        while (diffSide > Math.PI) diffSide -= Math.PI * 2;
                        while (diffSide < -Math.PI) diffSide += Math.PI * 2;
                        const distSide = Math.abs(diffSide);

                        const hwTail = Math.PI * 0.22;
                        if (distSide < hwTail) {
                            const tNorm = distSide / hwTail;
                            const tipFactor = Math.pow(Math.cos(tNorm * Math.PI * 0.5), 2.8);
                            laserSnailOffset += laserSnailDeform.intensity * tailExtension * tipFactor;
                        }
                    }

                    // 2. Central rear notch / valley between the two splitting tails
                    let diffCenter = angle - rearAngle;
                    while (diffCenter > Math.PI) diffCenter -= Math.PI * 2;
                    while (diffCenter < -Math.PI) diffCenter += Math.PI * 2;
                    const distCenter = Math.abs(diffCenter);
                    const hwCenter = Math.PI * 0.16;
                    if (distCenter < hwCenter) {
                        const tNorm = distCenter / hwCenter;
                        const notchDepth = Math.cos(tNorm * Math.PI * 0.5);
                        laserSnailOffset -= laserSnailDeform.intensity * (radius * 0.16) * notchDepth;
                    }

                    // 3. Smooth rounded forward dome bulb (distAngle > 0.65*PI)
                    let diffFwd = angle - laserSnailDeform.facingAngle;
                    while (diffFwd > Math.PI) diffFwd -= Math.PI * 2;
                    while (diffFwd < -Math.PI) diffFwd += Math.PI * 2;
                    const distFwd = Math.abs(diffFwd);
                    if (distFwd < Math.PI * 0.35) {
                        const domeT = distFwd / (Math.PI * 0.35);
                        const domeBulb = Math.cos(domeT * Math.PI * 0.5);
                        laserSnailOffset += laserSnailDeform.intensity * (radius * 0.05) * domeBulb;
                    }
                } else {
                    // Single central teardrop tail
                    let diff = angle - rearAngle;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    const distAngle = Math.abs(diff);

                    // 1. Sharp, very thin teardrop pointed tail apex at the rear (tight angular profile)
                    const hwTail = Math.PI * 0.20;
                    if (distAngle < hwTail) {
                        const tNorm = distAngle / hwTail;
                        const tipFactor = Math.pow(Math.cos(tNorm * Math.PI * 0.5), 3.8);
                        laserSnailOffset += laserSnailDeform.intensity * (radius * 0.48) * tipFactor;
                    }

                    // 2. Concave inward slope on shoulders/waist (distAngle between 0.12*PI and 0.55*PI)
                    const minWaist = Math.PI * 0.12;
                    const maxWaist = Math.PI * 0.55;
                    if (distAngle >= minWaist && distAngle <= maxWaist) {
                        const waistT = (distAngle - minWaist) / (maxWaist - minWaist);
                        const waistPinch = Math.sin(waistT * Math.PI);
                        laserSnailOffset -= laserSnailDeform.intensity * (radius * 0.10) * waistPinch;
                    }

                    // 3. Smooth rounded forward dome bulb (distAngle > 0.65*PI)
                    if (distAngle > Math.PI * 0.65) {
                        const domeT = (distAngle - Math.PI * 0.65) / (Math.PI * 0.35);
                        const domeBulb = Math.sin(domeT * Math.PI);
                        laserSnailOffset += laserSnailDeform.intensity * (radius * 0.05) * domeBulb;
                    }
                }
            }
            
            const r = Math.max(2, radius + wave1 + wave2 + stretch + budOffset + pseudopodOffset + flagellumOffset + deflectorOffset + sniperOffset + hatchOffset + sledgeOffset + mineLaunchOffset + rocketOffset + dashLaunchOffset + laserSnailOffset);
            points.push({
                x: centerX + Math.cos(angle) * r,
                y: centerY + Math.sin(angle) * r
            });
        }
        _blobPathCache.key = cacheKey;
        _blobPathCache.points = points;
    }

    // Draw smooth closed spline through points using midpoints
    ctx.beginPath();
    const firstMid = {
        x: (points[0].x + points[segments - 1].x) / 2,
        y: (points[0].y + points[segments - 1].y) / 2
    };
    ctx.moveTo(firstMid.x, firstMid.y);
    for (let i = 0; i < segments; i++) {
        const next = points[(i + 1) % segments];
        const mid = {
            x: (points[i].x + next.x) / 2,
            y: (points[i].y + next.y) / 2
        };
        ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
    }
    ctx.closePath();
    return points;
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== 'undefined') {
    window.drawOrganicBlobPath = drawOrganicBlobPath;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        drawOrganicBlobPath
    };
}
