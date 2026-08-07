# Blob Survival 🎮

A fast-paced, high-density 2D arcade survival auto-battler built from the ground up in zero-dependency Vanilla JavaScript and HTML5 Canvas. Survive escalating hordes of unique monsters, unlock powerful weapon synergies, and defeat multi-phase bosses in single-player or 4-player local co-op.

---

## 🌟 Key Features

* **Local Co-Op (1–4 Players):** Simultaneous local multiplayer with per-player key bindings, independent level-up panels, and dynamic difficulty scaling based on active player count.
* **Synergistic Arsenal & Talent Trees:** Auto-firing weapons and passive upgrades featuring Magic Missiles, Orbiting Fire Rings, Proximity Mines, Cryo Freeze, Siphon Cells, Martyrdom Auras, Deployable Turrets, and Laser Sniper trails.
* **RTS-Inspired Tactical Monster AI:** Escalating monster waves introducing unique behavioral archetypes:
  * **Baneling:** Proximity AOE detonation upon contact or death.
  * **Marauder:** Aiming windups and concussive slowing projectiles.
  * **Spine Crawler:** High-HP tank unit that bursts into rapid Zerglings upon death.
  * **Blink Stalker:** Teleports past orbital defenses directly to combat range.
  * **Felhound (Boss Wave):** Momentum physics driving an unstable inward-spiraling orbit.
  * **Sentry:** Projects a Guardian Shield aura reducing incoming damage to allies by 75%.
  * **Medivac:** Dedicated dropship AI executing dual-target healing beams and unit formation following.
  * **Hellion:** Fast skirmisher using 0.4-second telegraph line-of-fire flame stream attacks.
* **Developer & Testing Suite:** Built-in testing mode modal with minute-based time jumps and difficulty toggles (Easy, Normal, Hard).

---

## 🛠️ Technicalities & Engineering Highlights

> **For Recruiters (AI / ML & Systems Engineering):** This project demonstrates low-level software design, autonomous agent behavior modeling, mathematical physics, and real-time game state management in a pure, zero-dependency environment.

### 🧠 Autonomous Agent AI & Decision Systems
* **Finite State Machine (FSM) Architectures:** Entities manage distinct operational states (burrow, flee, windup, attack, orbit, formation follow) with clear transition criteria.
* **Dynamic Steering & Vector Physics:** Implements custom steering forces (acceleration, drag, radial collapse, momentum persistence) to produce organic motion—such as the Felhound's unstable orbital drift where speed scales spiral collapse rate ($F_{collapse} \propto v \cdot \text{waveFrac}$).
* **Targeting & Heuristic Selection:** Multi-attribute decision-making for support units (e.g., Medivac priority-sorting wounded allies by health deficit and distance, falling back to formation following when idle).

### 📐 Computational Geometry & Spatial Math
* **Line-Segment & Collision Algorithms:** Custom point-to-segment distance calculations for directional beam attacks (Hellion flame stream, Laser trails) and circle-to-circle bounding volume intersection without external engines.
* **Distance-Squared Optimization:** High-frequency spatial queries utilize Euclidean distance-squared comparisons to eliminate expensive square-root operations during multi-entity scans.

### ⚡ Systems Architecture & Game Loop Determinism
* **High-Density Entity Simulation:** Maintains 60 FPS performance handling up to 500 simultaneous active entities (monsters, projectiles, particles, loot gems) using localized array mutation and state recycling.
* **Deterministic Delta-Time Scaling:** Time-step normalization (`dtFactor`) decouples frame rendering rates from physics and clock intervals, ensuring consistent behavior across variable monitor refresh rates (60Hz–240Hz).
* **Game Balancing Models:** Dynamic mathematical formulas scale enemy health, spawn density, and weapon damage parameters non-linearly based on elapsed time and active player count.

---

## 🚀 How to Run

1. Clone or download the repository.
2. Open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge).
3. Select player count and difficulty, or click **Testing Suite** to jump to specific minute benchmarks.
