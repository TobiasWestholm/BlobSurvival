# Blob Survival 🎮

A fast-paced, high-density 2D arcade survival auto-battler built from the ground up in zero-dependency Vanilla JavaScript and HTML5 Canvas. Survive escalating hordes of unique monsters, unlock powerful weapon synergies, and defeat multi-phase bosses in single-player or up to 4-player local co-op.

## **[🎮 PLAY GAME 🎮](https://tobiaswestholm.github.io/BlobSurvival/)**

---

## 🌟 Key Features

* **Local Co-Op (1–4 Players):** Simultaneous local multiplayer with shared XP and individual upgrades, and dynamic difficulty scaling based on active player count.
* **Three different difficulty settings:** Choose Easy, Medium or Hard.
* **Synergistic Talent Trees:** Auto-firing weapons and passive upgrades, starting out with ranged, melee, explosives, or turrets.

[![Teaser](https://raw.githubusercontent.com/TobiasWestholm/BlobSurvival/refs/heads/main/thumbnail.jpg)](https://raw.githubusercontent.com/TobiasWestholm/BlobSurvival/refs/heads/main/video.mp4)

---

## 🛠️ Technicalities & Engineering details

> This project demonstrates low-level software design, autonomous agent behavior modeling, mathematical physics, and real-time game state management in a pure, zero-dependency environment.

### 🧠 Autonomous Agent AI & Decision Systems
* **Finite State Machine (FSM) Architectures:** Entities manage distinct operational states (burrow, flee, windup, attack, orbit, formation follow) with clear transition criteria.
* **Dynamic Steering & Vector Physics:** Implements custom steering forces (acceleration, drag, radial collapse, momentum persistence) to produce organic motion.
* **Targeting & Heuristic Selection:** Multi-attribute decision-making for support units.

### 📐 Computational Geometry & Spatial Math
* **Line-Segment & Collision Algorithms:** Custom point-to-segment distance calculations for directional beam attacks (Hellion flame stream, Laser trails) and circle-to-circle bounding volume intersection without external engines.
* **Distance-Squared Optimization:** High-frequency spatial queries utilize Euclidean distance-squared comparisons to eliminate expensive square-root operations during multi-entity scans.

### ⚡ Systems Architecture & Game Loop Determinism
* **High-Density Entity Simulation:** Maintains 60 FPS performance handling up to 500 simultaneous active entities (monsters, projectiles, particles, loot gems) using localized array mutation and state recycling.
* **Deterministic Delta-Time Scaling:** Time-step normalization (`dtFactor`) decouples frame rendering rates from physics and clock intervals, ensuring consistent behavior across variable monitor refresh rates (60Hz–240Hz).
* **Game Balancing Models:** Dynamic mathematical formulas scale enemy health, spawn density, and weapon damage parameters non-linearly based on elapsed time and active player count.

---

## 🚀 How to Run
Open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge).
