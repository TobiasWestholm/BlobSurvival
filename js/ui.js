/**
 * BlobSurvival - User Interface, Modals & Screen Navigation
 * 
 * Manages HUD layout updates, starting weapon selection lobby, level-up upgrade
 * panels, animated match countdowns, tips rotation, pause/victory/gameover dialogs,
 * and LocalStorage score persistence.
 */

// ---------------- 1. Weapon Labels & Starting Weapon Selection ----------------

const WEAPON_LABELS = {
    'magic_missile': 'Ranged',
    'melee_sweep': 'Melee',
    'proximity_mine': 'Explosives',
    'turret': 'Structures'
};

function startWeaponSelectFlow() {
    if (typeof GAME_STATE === 'undefined') return;
    GAME_STATE.current = STATES.WEAPON_SELECT;
    const tBtn = document.getElementById('testingBtn');
    if (tBtn) tBtn.style.display = 'none';
    const isMobileDevice = (typeof isMobile !== 'undefined') ? isMobile : ((typeof window !== 'undefined' && window.isMobile) || false);
    const zone = document.getElementById('joystickZone') || (typeof joystickZone !== 'undefined' ? joystickZone : (typeof window !== 'undefined' ? window.joystickZone : null));
    if (isMobileDevice && zone) {
        zone.style.display = 'block';
    }
    const uiLayer = document.querySelector('.ui-layer');
    if (uiLayer) uiLayer.style.display = 'none';
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.style.display = 'none';
    
    startTipRotation();

    renderLobbyWeaponPanels();
}

function renderLobbyWeaponPanels() {
    const layer = document.getElementById('levelUpLayer');
    if (!layer) return;
    layer.innerHTML = '';
    const isSingle = (GAME_STATE.gameMode === 'single');
    const isLocal = (GAME_STATE.gameMode === 'local');
    const isOnlineHost = (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager && netManager.isHost);
    const isOnlineClient = (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager && netManager.isClient);

    const lobbyStartBtn = document.getElementById('lobbyStartBtn');
    const inviteBanner = document.getElementById('inviteCodeBanner');
    const tipEl = document.getElementById('tipText') || (typeof tip !== 'undefined' ? tip : null);

    if (isSingle) {
        if (lobbyStartBtn) lobbyStartBtn.style.display = 'none';
        if (inviteBanner) inviteBanner.style.display = 'none';
        const player = (GAME_STATE.players && GAME_STATE.players[0]) ? GAME_STATE.players[0] : null;
        if (player) layer.appendChild(buildStartingWeaponPanel(player, 1, true));
    } else if (isLocal) {
        if (lobbyStartBtn) {
            lobbyStartBtn.style.display = 'block';
            lobbyStartBtn.disabled = !GAME_STATE.players.every(p => p && p.selectedWeapon);
            lobbyStartBtn.onclick = () => {
                lobbyStartBtn.style.display = 'none';
                layer.classList.remove('show');
                if (tipEl) tipEl.style.display = 'none';
                startCountdown(true);
            };
        }
        if (inviteBanner) inviteBanner.style.display = 'none';
        const count = GAME_STATE.players.length;
        for (const player of GAME_STATE.players) {
            if (player) layer.appendChild(buildStartingWeaponPanel(player, count, true));
        }
    } else if (isOnlineHost) {
        if (inviteBanner) {
            inviteBanner.style.display = 'block';
            const codeEl = document.getElementById('inviteCodeText');
            if (codeEl) codeEl.textContent = (netManager && netManager.roomCode) ? netManager.roomCode : 'XXXX';
        }
        if (lobbyStartBtn) {
            lobbyStartBtn.style.display = 'block';
            const allReady = GAME_STATE.players.length > 0 && GAME_STATE.players.filter(p => p && !p.disconnected).every(p => p && p.selectedWeapon);
            lobbyStartBtn.disabled = !allReady;
            lobbyStartBtn.onclick = () => {
                lobbyStartBtn.style.display = 'none';
                if (inviteBanner) inviteBanner.style.display = 'none';
                layer.classList.remove('show');
                if (tipEl) tipEl.style.display = 'none';
                if (typeof netManager !== 'undefined' && netManager) {
                    netManager.broadcast({ type: 'START_GAME_COUNTDOWN', isNewGame: true });
                }
                startCountdown(true);
            };
        }
        if (typeof isMobile !== 'undefined' && isMobile) {
            const player = GAME_STATE.players[0];
            if (player) layer.appendChild(buildStartingWeaponPanel(player, 1, true));
        } else {
            for (let i = 0; i < 4; i++) {
                const player = GAME_STATE.players[i];
                if (player && !player.disconnected) {
                    layer.appendChild(buildStartingWeaponPanel(player, 4, i === 0));
                } else {
                    layer.appendChild(buildPlaceholderPanel(i, 4));
                }
            }
        }
    } else if (isOnlineClient) {
        if (lobbyStartBtn) lobbyStartBtn.style.display = 'none';
        if (inviteBanner) inviteBanner.style.display = 'none';
        const myIndex = netManager ? netManager.localPlayerIndex : 0;
        if (typeof isMobile !== 'undefined' && isMobile) {
            const player = (GAME_STATE.players && GAME_STATE.players[myIndex]) || new Player(myIndex, PLAYER_DEFS[myIndex]);
            layer.appendChild(buildStartingWeaponPanel(player, 1, true));
        } else {
            for (let i = 0; i < 4; i++) {
                const player = GAME_STATE.players[i];
                if (player && !player.disconnected) {
                    layer.appendChild(buildStartingWeaponPanel(player, 4, i === myIndex));
                } else {
                    layer.appendChild(buildPlaceholderPanel(i, 4));
                }
            }
        }
    }
    layer.classList.add('show');
    adjustTipTextLayout();
    if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => adjustTipTextLayout());
    }
}

function buildPlaceholderPanel(index, count) {
    const panel = document.createElement('div');
    panel.className = 'player-panel placeholder-panel chosen';
    panel.style.cssText = getPanelPosition(index, count);
    panel.style.borderColor = '#444';

    const title = document.createElement('h3');
    title.className = 'panel-title';
    title.textContent = `Player ${index + 1}`;
    title.style.color = '#777';
    panel.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'panel-sub';
    sub.textContent = 'Waiting for player to join...';
    panel.appendChild(sub);

    const spinner = document.createElement('div');
    spinner.className = 'waiting-spinner';
    panel.appendChild(spinner);

    return panel;
}

function buildStartingWeaponPanel(player, count, isInteractive) {
    const panel = document.createElement('div');
    panel.className = 'player-panel weapon-select-grid';
    panel.id = `playerPanel_${player.index}`;
    panel.style.cssText = getPanelPosition(player.index, count);
    panel.style.borderColor = player.color;
    const n = player.index + 1;

    if (player.selectedWeapon || (GAME_STATE.gameMode === 'online' && !isInteractive)) {
        panel.classList.add('chosen');
    }

    const title = document.createElement('h3');
    title.className = 'panel-title';
    title.textContent = (count > 1 && (typeof isMobile === 'undefined' || !isMobile)) ? `Player ${n} (${player.keysText})` : `Player ${n} Starting Weapon`;
    title.style.color = player.color;
    panel.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'panel-sub';
    sub.textContent = isInteractive ? 'Select your starting weapon of choice:' : 'Choosing weapon...';
    panel.appendChild(sub);

    const addHelpAndTag = (btn, upgradeId, isOneShot) => {
        if (typeof UPGRADE_POOL === 'undefined') return;
        const u = UPGRADE_POOL.find(item => item.id === upgradeId);
        if (!u) return;
        const topControls = document.createElement('div');
        topControls.className = 'upgrade-btn-top-right';

        const tag = document.createElement('span');
        tag.className = `upgrade-tag ${isOneShot ? 'tag-oneshot' : 'tag-stacks'}`;
        tag.textContent = isOneShot ? 'One-Shot' : 'Stacks';
        topControls.appendChild(tag);

        const helpBtn = document.createElement('span');
        helpBtn.className = 'upgrade-help-btn';
        helpBtn.innerHTML = '?';
        helpBtn.title = 'View details and synergies';
        helpBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (typeof showUpgradeDetailModal === 'function') {
                showUpgradeDetailModal(u);
            }
        };
        topControls.appendChild(helpBtn);
        btn.appendChild(topControls);
    };

    const weaponsList = [
        { id: 'magic_missile', upgradeId: 'unlock_missile', name: 'Ranged', desc: 'Magic Missile — Homing projectile. Fires at closest enemy.' },
        { id: 'melee_sweep', upgradeId: 'unlock_melee', name: 'Melee', desc: 'Melee Sweep — Quick sweep. Hits all enemies in close range.' },
        { id: 'proximity_mine', upgradeId: 'unlock_mine', name: 'Explosives', desc: 'Proximity Mine — Drops mines that explode for AoE damage.' },
        { id: 'turret', upgradeId: 'unlock_turret', name: 'Structures', desc: 'Auto-Turret — Drops stationary turrets that fire missiles.' }
    ];

    for (const w of weaponsList) {
        const btn = document.createElement('button');
        btn.className = 'upgrade-btn';
        btn.dataset.weaponId = w.id;
        if (player.selectedWeapon === w.id) {
            btn.classList.add('selected-weapon');
        }
        btn.innerHTML = `<span class="name">${w.name}</span>${w.desc}`;
        
        if (isInteractive) {
            btn.onclick = () => {
                selectStartingWeapon(player, w.id, w.name, panel);
            };
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.65';
        }
        
        addHelpAndTag(btn, w.upgradeId, true);
        panel.appendChild(btn);
    }

    const statusDiv = document.createElement('div');
    statusDiv.className = 'panel-status';
    statusDiv.id = `panelStatus_${player.index}`;
    statusDiv.style.cssText = `margin-top: 8px; font-weight: bold; color: ${player.color}; font-size: 14px; text-align: center;`;
    if (player.selectedWeapon) {
        statusDiv.textContent = `✓ Ready: ${player.selectedWeaponLabel}`;
    }
    panel.appendChild(statusDiv);

    return panel;
}

function selectStartingWeapon(player, weaponId, weaponLabel, panel) {
    if (!player) return;
    player.selectedWeapon = weaponId;
    player.selectedWeaponLabel = weaponLabel;
    player.weapons = [];
    if (player.unlockWeapon) player.unlockWeapon(weaponId);

    if (panel) panel.classList.add('chosen');

    if (panel) {
        panel.querySelectorAll('.upgrade-btn').forEach(b => {
            b.classList.remove('selected-weapon');
            if (b.dataset.weaponId === weaponId) b.classList.add('selected-weapon');
        });
    }
    const statusDiv = document.getElementById(`panelStatus_${player.index}`);
    if (statusDiv) statusDiv.textContent = `✓ Ready: ${weaponLabel}`;

    const tipEl = document.getElementById('tipText') || (typeof tip !== 'undefined' ? tip : null);

    if (GAME_STATE.gameMode === 'single') {
        const layer = document.getElementById('levelUpLayer');
        if (layer) layer.classList.remove('show');
        if (tipEl) tipEl.style.display = 'none';
        startCountdown(true);
        return;
    }

    if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager) {
        if (netManager.isClient) {
            netManager.sendWeaponSelection(weaponId);
        } else if (netManager.isHost) {
            netManager.broadcastLobbyState(
                GAME_STATE.players.map(p => ({ index: p.index, selectedWeapon: p.selectedWeapon, selectedWeaponLabel: p.selectedWeaponLabel })),
                GAME_STATE.players.every(p => p && p.selectedWeapon)
            );
        }
    }

    const lobbyStartBtn = document.getElementById('lobbyStartBtn');
    if (lobbyStartBtn) {
        lobbyStartBtn.disabled = !GAME_STATE.players.every(p => p && p.selectedWeapon);
    }
}

// ---------------- 2. Level Up Flow & Selection Round ----------------

let kickTimeoutId = null;

function startLevelUpFlow() {
    if (typeof GAME_STATE === 'undefined') return;
    if (GAME_STATE.current === STATES.LEVEL_UP || GAME_STATE.current === STATES.COUNTDOWN) return;
    GAME_STATE.current = STATES.LEVEL_UP;
    if (typeof SoundEngine !== 'undefined' && SoundEngine.setMuffled) {
        SoundEngine.setMuffled(true, 0.5);
    }
    const zone = document.getElementById('joystickZone') || (typeof joystickZone !== 'undefined' ? joystickZone : (typeof window !== 'undefined' ? window.joystickZone : null));
    if (zone) zone.style.display = 'none';
    const tipEl = document.getElementById('tipText');
    if (tipEl) tipEl.style.display = 'none';

    for (const p of GAME_STATE.players) {
        if (p && !p.disconnected && !p.kicked) {
            if (!p.currentUpgradeOptions && typeof pickThreeFor === 'function') {
                p.currentUpgradeOptions = pickThreeFor(p);
            }
        }
    }

    if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager && netManager.isHost) {
        const upgradesMap = {};
        for (const p of GAME_STATE.players) {
            if (p && p.currentUpgradeOptions) {
                upgradesMap[p.index] = p.currentUpgradeOptions.map(u => u.id);
            }
        }
        netManager.broadcast({
            type: 'LEVEL_UP_START',
            pendingLevels: GAME_STATE.pendingLevels,
            upgradesMap: upgradesMap
        });
    }

    beginSelectionRound();
}

function beginSelectionRound() {
    if (kickTimeoutId) {
        clearTimeout(kickTimeoutId);
        kickTimeoutId = null;
    }

    const layer = document.getElementById('levelUpLayer');
    if (!layer) return;
    layer.innerHTML = '';
    const isOnline = (GAME_STATE.gameMode === 'online');
    const myIndex = isOnline ? (typeof netManager !== 'undefined' && netManager ? netManager.localPlayerIndex : 0) : 0;
    const isHost = isOnline && typeof netManager !== 'undefined' && netManager && netManager.isHost;

    const activePlayers = (GAME_STATE.players || []).filter(p => p && !p.disconnected && !p.kicked);
    for (const p of activePlayers) {
        p._virtualPickDone = false;
    }
    GAME_STATE.pendingPicks = activePlayers.length;

    if (isOnline && typeof isMobile !== 'undefined' && isMobile) {
        const player = (GAME_STATE.players && GAME_STATE.players[myIndex]) || (GAME_STATE.players && GAME_STATE.players[0]);
        if (player) layer.appendChild(buildPlayerPanel(player, 1, true));
    } else {
        const count = Math.max(activePlayers.length, 1);
        for (const player of (GAME_STATE.players || [])) {
            if (!player || player.disconnected || player.kicked) continue;
            const isInteractive = !isOnline || (player.index === myIndex);
            layer.appendChild(buildPlayerPanel(player, count, isInteractive));
        }
    }
    layer.classList.add('show');
    adjustTipTextLayout();
    if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => adjustTipTextLayout());
    }
    if (typeof updateUI === 'function') updateUI();

    if (isHost) {
        kickTimeoutId = setTimeout(() => {
            showKickButtonsForUnpickedPlayers();
        }, 60000);
    }
}

function showKickButtonsForUnpickedPlayers() {
    if (typeof GAME_STATE === 'undefined' || GAME_STATE.current !== STATES.LEVEL_UP) return;
    for (const player of (GAME_STATE.players || [])) {
        if (!player || player.index === 0 || player.disconnected || player.kicked) continue;
        const panel = document.getElementById(`levelPanel_${player.index}`);
        if (!panel || panel.dataset.pickDone === 'true' || player.currentLevelUpgradeName) continue;
        if (panel.querySelector('.kick-player-btn')) continue;

        const kickBtn = document.createElement('button');
        kickBtn.className = 'kick-player-btn';
        kickBtn.innerHTML = `⚠️ Kick Player ${player.index + 1} (AFK / Disconnected)`;
        kickBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Permanently kick Player ${player.index + 1} from this game session?`)) {
                kickPlayerByHost(player.index);
            }
        };
        panel.appendChild(kickBtn);
    }
}

function kickPlayerByHost(playerIndex) {
    if (typeof GAME_STATE === 'undefined') return;
    const p = GAME_STATE.players[playerIndex];
    const panel = document.getElementById(`levelPanel_${playerIndex}`);

    if (typeof netManager !== 'undefined' && netManager && netManager.isHost) {
        netManager.kickPlayer(playerIndex);
    }

    if (p) {
        p.disconnected = true;
        p.alive = false;
        p.kicked = true;
    }
    if (typeof recalculateDynamicDifficulty === 'function') recalculateDynamicDifficulty();

    if (panel) {
        panel.innerHTML = `<h3 class="panel-title" style="color: #ff4444;">Player ${playerIndex + 1}</h3><div style="color: #ff6666; font-size: 13px; margin-top: 10px; font-weight: bold;">✕ Kicked by Host</div>`;
        panel.classList.add('chosen');
        if (panel.dataset.pickDone !== 'true') {
            panel.dataset.pickDone = 'true';
            GAME_STATE.pendingPicks--;
        }
    }

    if (GAME_STATE.pendingPicks <= 0) {
        if (kickTimeoutId) {
            clearTimeout(kickTimeoutId);
            kickTimeoutId = null;
        }
        for (const pl of GAME_STATE.players) {
            if (pl) {
                pl.currentUpgradeOptions = null;
                pl.currentLevelUpgradeName = null;
            }
        }
        const layer = document.getElementById('levelUpLayer');
        if (layer) layer.classList.remove('show');
        GAME_STATE.pendingLevels--;
        if (GAME_STATE.pendingLevels > 0) {
            if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager.isHost) {
                for (const pl of GAME_STATE.players) {
                    if (pl && !pl.disconnected && !pl.kicked && typeof pickThreeFor === 'function') {
                        pl.currentUpgradeOptions = pickThreeFor(pl);
                    }
                }
                const upgradesMap = {};
                for (const pl of GAME_STATE.players) {
                    if (pl && pl.currentUpgradeOptions) {
                        upgradesMap[pl.index] = pl.currentUpgradeOptions.map(u => u.id);
                    }
                }
                netManager.broadcast({
                    type: 'LEVEL_UP_START',
                    pendingLevels: GAME_STATE.pendingLevels,
                    upgradesMap: upgradesMap
                });
            }
            beginSelectionRound();
        } else {
            if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager.isHost) {
                netManager.broadcast({ type: 'START_GAME_COUNTDOWN', isNewGame: false });
            }
            startCountdown(false);
        }
    }
}

function onOnlinePlayerKicked(playerIndex) {
    if (typeof GAME_STATE === 'undefined') return;
    const p = GAME_STATE.players[playerIndex];
    if (p) {
        p.disconnected = true;
        p.alive = false;
        p.kicked = true;
    }
    if (typeof recalculateDynamicDifficulty === 'function') recalculateDynamicDifficulty();

    const panel = document.getElementById(`levelPanel_${playerIndex}`);
    if (panel) {
        panel.innerHTML = `<h3 class="panel-title" style="color: #ff4444;">Player ${playerIndex + 1}</h3><div style="color: #ff6666; font-size: 13px; margin-top: 10px; font-weight: bold;">✕ Removed by Host</div>`;
        panel.classList.add('chosen');
        if (panel.dataset.pickDone !== 'true') {
            panel.dataset.pickDone = 'true';
            GAME_STATE.pendingPicks--;
        }
    }

    if (GAME_STATE.pendingPicks <= 0 && GAME_STATE.current === STATES.LEVEL_UP) {
        const layer = document.getElementById('levelUpLayer');
        if (layer) layer.classList.remove('show');
    }
}

function getPanelPosition(index, count) {
    if (typeof isMobile !== 'undefined' && isMobile) {
        return 'top:50%; left:50%; transform:translate(-50%,-50%);';
    }
    const M = 24, TOP = 24, BOTTOM = 24;
    if (count === 1) return 'top:50%; left:50%; transform:translate(-50%,-50%);';
    if (count === 2) {
        return index === 0
            ? `top:50%; left:${M}px; transform:translateY(-50%);`
            : `top:50%; right:${M}px; transform:translateY(-50%);`;
    }
    if (count === 3) {
        if (index === 0) return `top:${TOP}px; left:${M}px;`;
        if (index === 1) return `top:${TOP}px; right:${M}px;`;
        return `bottom:${BOTTOM}px; left:${M}px;`;
    }
    return [
        `top:${TOP}px; left:${M}px;`,
        `top:${TOP}px; right:${M}px;`,
        `bottom:${BOTTOM}px; left:${M}px;`,
        `bottom:${BOTTOM}px; right:${M}px;`
    ][index] || `top:${TOP}px; left:${M}px;`;
}

function buildPlayerPanel(player, count, isInteractive = true) {
    const panel = document.createElement('div');
    panel.className = 'player-panel';
    panel.id = `levelPanel_${player.index}`;
    panel.style.cssText = getPanelPosition(player.index, count);
    panel.style.borderColor = player.color;
    const n = player.index + 1;

    if (player.currentLevelUpgradeName || (GAME_STATE.gameMode === 'online' && !isInteractive)) {
        panel.classList.add('chosen');
    }

    const title = document.createElement('h3');
    title.className = 'panel-title';
    title.textContent = `Player ${n}`;
    title.style.color = player.color;
    panel.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'panel-sub';
    sub.textContent = player.alive ? (isInteractive ? 'Choose an upgrade:' : 'Choosing upgrade...') : 'Down — applies on revive';
    panel.appendChild(sub);

    const options = (typeof pickThreeFor === 'function') ? pickThreeFor(player) : [];
    for (const u of options) {
        const btn = document.createElement('button');
        btn.className = 'upgrade-btn';
        btn.dataset.upgradeId = u.id;
        btn.dataset.upgradeName = u.name;
        if (player.currentLevelUpgradeName === u.name || player.currentLevelUpgradeName === u.id) {
            btn.classList.add('selected-upgrade');
        }
        btn.innerHTML = `<span class="name">${u.name}</span>${u.desc}`;

        const topControls = document.createElement('div');
        topControls.className = 'upgrade-btn-top-right';

        const tag = document.createElement('span');
        tag.className = `upgrade-tag ${u.oneShot ? 'tag-oneshot' : 'tag-stacks'}`;
        tag.textContent = u.oneShot ? 'One-Shot' : 'Stacks';
        topControls.appendChild(tag);

        const helpBtn = document.createElement('span');
        helpBtn.className = 'upgrade-help-btn';
        helpBtn.innerHTML = '?';
        helpBtn.title = 'View details and synergies';
        helpBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (typeof showUpgradeDetailModal === 'function') {
                showUpgradeDetailModal(u);
            }
        };
        topControls.appendChild(helpBtn);
        btn.appendChild(topControls);

        if (isInteractive) {
            btn.onclick = () => {
                u.effect(player);
                if (u.oneShot && player.takenOneShots) player.takenOneShots.add(u.id);
                player.currentLevelUpgradeName = u.name;
                
                panel.querySelectorAll('.upgrade-btn').forEach(b => b.classList.remove('selected-upgrade'));
                btn.classList.add('selected-upgrade');

                if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager.isClient) {
                    netManager.sendUpgradeSelection(u.id);
                } else if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager.isHost) {
                    netManager.broadcast({
                        type: 'UPGRADE_CHOSEN_SYNC',
                        playerIndex: player.index,
                        upgradeId: u.id,
                        upgradeName: u.name
                    });
                }
                onPlayerChose(panel, player);
            };
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.65';
        }
        panel.appendChild(btn);
    }

    if (player.currentLevelUpgradeName) {
        onPlayerChose(panel, player);
    }

    return panel;
}

function onPlayerChoseVirtual(player) {
    if (!player || player._virtualPickDone) return;
    player._virtualPickDone = true;

    // In online multiplayer, Host is the authoritative coordinator for level-up completion and countdowns
    if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager && netManager.isClient) {
        return;
    }

    GAME_STATE.pendingPicks--;
    if (GAME_STATE.pendingPicks > 0) return;
    finishSelectionRound();
}

function onPlayerChose(panel, player) {
    if (panel.dataset.pickDone === 'true') return;
    panel.dataset.pickDone = 'true';
    panel.classList.add('chosen');
    panel.querySelectorAll('.upgrade-btn').forEach(b => {
        b.disabled = true;
        if (player.currentLevelUpgradeName && (b.dataset.upgradeName === player.currentLevelUpgradeName || b.dataset.upgradeId === player.currentLevelUpgradeName)) {
            b.classList.add('selected-upgrade');
        }
    });
    const tag = document.createElement('div');
    tag.className = 'panel-done';
    tag.textContent = '✓ Ready — Waiting for other players...';
    tag.style.color = player.color;
    panel.appendChild(tag);

    // In online multiplayer, Host is the authoritative coordinator for level-up completion and countdowns
    if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager && netManager.isClient) {
        return;
    }

    GAME_STATE.pendingPicks--;
    if (GAME_STATE.pendingPicks > 0) return;
    finishSelectionRound();
}

function finishSelectionRound() {
    if (kickTimeoutId) {
        clearTimeout(kickTimeoutId);
        kickTimeoutId = null;
    }
    
    for (const pl of (GAME_STATE.players || [])) {
        if (pl) {
            pl.currentUpgradeOptions = null;
            pl.currentLevelUpgradeName = null;
            pl._virtualPickDone = false;
        }
    }
    const layer = document.getElementById('levelUpLayer');
    if (layer) layer.classList.remove('show');
    GAME_STATE.pendingLevels--;
    if (GAME_STATE.pendingLevels > 0) {
        if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager.isHost) {
            for (const pl of GAME_STATE.players) {
                if (pl && !pl.disconnected && !pl.kicked && typeof pickThreeFor === 'function') {
                    pl.currentUpgradeOptions = pickThreeFor(pl);
                }
            }
            const upgradesMap = {};
            for (const pl of GAME_STATE.players) {
                if (pl && pl.currentUpgradeOptions) {
                    upgradesMap[pl.index] = pl.currentUpgradeOptions.map(u => u.id);
                }
            }
            netManager.broadcast({
                type: 'LEVEL_UP_START',
                pendingLevels: GAME_STATE.pendingLevels,
                upgradesMap: upgradesMap
            });
        }
        beginSelectionRound();
    } else {
        if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager.isHost) {
            netManager.broadcast({ type: 'START_GAME_COUNTDOWN', isNewGame: false });
        }
        startCountdown(false);
    }
}

// ---------------- 3. Countdown & Tips ----------------

function startCountdown(isNewGame = false) {
    if (typeof SoundEngine !== 'undefined') {
        if (isNewGame || SoundEngine.musicMode === 'menu') {
            SoundEngine.stopMusic();
        } else {
            SoundEngine.setMuffled(false, 1.8);
        }
    }
    const tBtn = document.getElementById('testingBtn');
    if (tBtn) tBtn.style.display = 'none';
    const layer = document.getElementById('levelUpLayer');
    if (layer) layer.classList.remove('show');
    const tipEl = document.getElementById('tipText');
    if (tipEl) tipEl.style.display = 'none';
    stopTipRotation();
    const uiLayer = document.querySelector('.ui-layer');
    if (uiLayer) uiLayer.style.display = 'block';
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.style.display = 'block';
    
    if (typeof GAME_STATE !== 'undefined') {
        GAME_STATE.current = STATES.COUNTDOWN;
    }
    const el = document.getElementById('countdown');
    let n = 3;
    if (el) {
        el.textContent = n;
        el.style.display = 'block';
    }

    const pauseBtn = document.getElementById('pauseMenuBtn');
    if (pauseBtn) pauseBtn.style.display = 'flex';

    const isMobileDevice = (typeof isMobile !== 'undefined') ? isMobile : ((typeof window !== 'undefined' && window.isMobile) || false);
    const zone = document.getElementById('joystickZone') || (typeof joystickZone !== 'undefined' ? joystickZone : (typeof window !== 'undefined' ? window.joystickZone : null));
    if (isMobileDevice && zone) {
        zone.style.display = 'block';
    }

    const TICK_MS = 600;
    const tick = () => {
        n--;
        if (n >= 1) {
            if (el) el.textContent = n;
            if (typeof GAME_STATE !== 'undefined') {
                GAME_STATE.countdownTimer = setTimeout(tick, TICK_MS);
            }
        } else {
            if (el) el.style.display = 'none';
            if (typeof GAME_STATE !== 'undefined') {
                GAME_STATE.countdownTimer = null;
                GAME_STATE.current = STATES.GAMEPLAY;
                if (typeof SoundEngine !== 'undefined') {
                    if (isNewGame || SoundEngine.musicMode !== 'gameplay' || !SoundEngine.isMusicPlaying) {
                        const startElapsed = (GAME_STATE.testingMode && GAME_STATE.elapsed) ? GAME_STATE.elapsed : 0;
                        SoundEngine.startMusic(true, startElapsed);
                    }
                    SoundEngine.setMuffled(false, 0.1);
                }
                if (typeof lastFrameTime !== 'undefined') {
                    lastFrameTime = performance.now();
                }
                if (GAME_STATE.players && GAME_STATE.players.some(p => p && p.campervanSoundPending)) {
                    if (typeof SoundEngine !== 'undefined' && SoundEngine.campervan) {
                        SoundEngine.campervan();
                    }
                    for (const p of GAME_STATE.players) {
                        if (p) p.campervanSoundPending = false;
                    }
                }
            }
        }
    };
    if (typeof GAME_STATE !== 'undefined') {
        GAME_STATE.countdownTimer = setTimeout(tick, TICK_MS);
    }
}

const tips = [
    "First time playing? Choosing Magic Missile as starting weapon is a good way to keep it simple.",
    "It's usually a good idea to stick to one weapon type early in the game. Transition to multiple weapons later to unlock more powerful upgrades.",
    "All turret upgrades are better the more turrets you can manage to have.",
    "You will eventually need defensive upgrades. Select them while the number of enemies is manageable.",
    "Melee Sweep requires a good amount of control to maneuver well, but allows you to become very tanky early on.",
    "Want something different? Choose Melee Sweep and try maximizing the damage you take early on, and take the Second Wind upgrade as often as you can.",
    "Want something different? Choose Proximity Mine and pick the Volatile Powder upgrade early to unlock Martyrdom, then wipe the board by dying all the time. Only works in multiplayer.",
    "The Fire Ring upgrade is a solid upgrade that can get you back into the game in rough times.",
    "Players can't damage each other, and enemies won't damage each other either.",
    "The quickest way to die is to run into the horde of enemies behind you.",
    "Cryo Freeze will save your ass from enemies that are faster than you.",
    "Enemies always pursue the closest player unless something else says otherwise.",
    "Getting some AoE damage will keep you in the game when the masses of enemies become too large to kill one by one.",
    "Upgrades are chosen at random from all upgrades available to you. Unlocking more upgrades decreases your chances of getting that one specific upgrade you want.",
    "The Scourge Flail is the only weapon-like upgrade that is not affected by the Hyper-drive attack speed increase.",
    "Surviving the Horde Boss wave fully restores your HP and permanently increases your maximum HP.",
    "Life regeneration is scarce. All weapons have a late stage upgrade unlocking life regen.",
    "Hit the question mark beside an upgrade to see how it works and what it unlocks. Some upgrades have caveats that are important to know.",
    "All weapons are fired automatically on an even interval, and all upgrades are applied automatically.",
    "Phase dash is the only upgrade that requires a key press to activate.",
    "When a player dies in multiplayer, they respawn after 20 seconds unless all players die during those 20 seconds - then the game is over.",
    "Cryo Freeze will freeze enemies in place early on, but later on it will only slow them down.",
    "All players level up together in multiplayer, but select upgrades individually.",
    "XP needs to be collected from the ground after killing monsters in order to level up.",
    "The game progression is based on time, not player level.",
    "Explosives and the melee Sledge Hammer and Flail can destroy burrowed enemies.",
    "Harder difficulties also give you less time to dodge enemy projectiles, dashes, and other hazards.",
    "Invisible enemies can still be damaged, but your weapons won't shoot at them.",
    "Normal projectiles cannot shoot through walls or shields. The the seeking rocket is an exception to this, as well as any large enough explosions.",
    "Want something different? Try maxing sticking to movement speed upgrades and phase dash upgrades only.",
    "Becoming overwhelmed by enemies when using Magic Missile or Turrets? AOE damage is the only way to catch up. Try Buckshot volley or hybrid upgrades from the Melee or Explosives weapons."
];

let tipRotationTimer = null;
let tipFadeTimer = null;
let lastTipIndex = -1;

function fetchTip() {
    if (!tips || tips.length === 0) return '';
    if (tips.length === 1) return tips[0];
    let newIndex;
    do {
        newIndex = Math.floor(Math.random() * tips.length);
    } while (newIndex === lastTipIndex);
    lastTipIndex = newIndex;
    return tips[newIndex];
}

function adjustTipTextLayout() {
    const tipEl = document.getElementById('tipText');
    if (!tipEl || tipEl.style.display === 'none') return;
    const isMobileDevice = (typeof isMobile !== 'undefined') ? isMobile : ((typeof window !== 'undefined' && window.isMobile) || false);
    if (isMobileDevice) return;

    const layer = document.getElementById('levelUpLayer');
    if (!layer) return;

    const panels = Array.from(layer.querySelectorAll('.player-panel')).filter(p => p.offsetParent !== null);
    if (panels.length === 0) {
        tipEl.style.maxWidth = 'min(44vw, 480px)';
        return;
    }

    if (panels.length === 1) {
        tipEl.style.maxWidth = 'min(44vw, 480px)';
        const panelRect = panels[0].getBoundingClientRect();
        const tipRect = tipEl.getBoundingClientRect();
        if (panelRect.top < tipRect.bottom + 10) {
            tipEl.style.top = Math.max(8, panelRect.top - tipRect.height - 10) + 'px';
        } else {
            tipEl.style.top = 'calc(max(16px, env(safe-area-inset-top, 16px)) + 52px)';
        }
        return;
    }

    // Multi-panel layout (2, 3, or 4 players on PC)
    const midX = window.innerWidth / 2;
    const leftPanels = panels.filter(p => {
        const r = p.getBoundingClientRect();
        return (r.left + r.width / 2) < midX;
    });
    const rightPanels = panels.filter(p => {
        const r = p.getBoundingClientRect();
        return (r.left + r.width / 2) >= midX;
    });

    let maxLeftEdge = 0;
    for (const p of leftPanels) {
        const r = p.getBoundingClientRect();
        if (r.right > maxLeftEdge) maxLeftEdge = r.right;
    }

    let minRightEdge = window.innerWidth;
    for (const p of rightPanels) {
        const r = p.getBoundingClientRect();
        if (r.left < minRightEdge) minRightEdge = r.left;
    }

    const corridorWidth = minRightEdge - maxLeftEdge;
    const safeWidth = Math.max(140, Math.floor(corridorWidth - 28));
    tipEl.style.maxWidth = `${safeWidth}px`;
    tipEl.style.boxSizing = 'border-box';
}

function startTipRotation() {
    stopTipRotation();
    const tipEl = document.getElementById('tipText') || (typeof tip !== 'undefined' ? tip : null);
    if (!tipEl) return;

    tipEl.textContent = 'Tip: ' + fetchTip();
    tipEl.classList.remove('fade-out');
    tipEl.style.display = 'block';
    adjustTipTextLayout();
    if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => adjustTipTextLayout());
    }

    function scheduleNextTip() {
        tipRotationTimer = setTimeout(() => {
            const el = document.getElementById('tipText');
            if (!el || el.style.display === 'none') return;
            el.classList.add('fade-out');
            tipFadeTimer = setTimeout(() => {
                const el2 = document.getElementById('tipText');
                if (!el2 || el2.style.display === 'none') return;
                el2.textContent = 'Tip: ' + fetchTip();
                el2.classList.remove('fade-out');
                adjustTipTextLayout();
                scheduleNextTip();
            }, 600); // 600ms fade transition
        }, 20000); // 20 seconds visible
    }

    scheduleNextTip();
}

function stopTipRotation() {
    if (tipRotationTimer) {
        clearTimeout(tipRotationTimer);
        tipRotationTimer = null;
    }
    if (tipFadeTimer) {
        clearTimeout(tipFadeTimer);
        tipFadeTimer = null;
    }
    const tipEl = document.getElementById('tipText');
    if (tipEl) {
        tipEl.classList.remove('fade-out');
    }
}

// ---------------- 4. Game Over, Victory & Scores ----------------

function gameOver() {
    if (typeof GAME_STATE === 'undefined') return;
    GAME_STATE.current = STATES.GAME_OVER;
    if (typeof SoundEngine !== 'undefined' && SoundEngine.triggerVictoryRamp) {
        SoundEngine.triggerVictoryRamp(3.0);
    }
    const zone = document.getElementById('joystickZone') || (typeof joystickZone !== 'undefined' ? joystickZone : (typeof window !== 'undefined' ? window.joystickZone : null));
    if (zone) zone.style.display = 'none';
    const pauseBtn0 = document.getElementById('pauseMenuBtn');
    if (pauseBtn0) pauseBtn0.style.display = 'none';

    if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager.isHost) {
        netManager.broadcast({ type: 'GAME_OVER' });
    }
    
    if (!GAME_STATE.testingMode) {
        saveGameScore();
    }
    
    const m = document.getElementById('gameOverModal');
    const s = document.getElementById('gameOverStats');
    const bestScore = getBestScore(GAME_STATE.players.length, GAME_STATE.difficulty ? GAME_STATE.difficulty.name : 'normal');
    
    if (s) s.innerHTML = buildStatsHTML("Survived", GAME_STATE, bestScore);
    if (m) m.classList.add('show');
}

function showVictory() {
    if (typeof GAME_STATE === 'undefined') return;
    GAME_STATE.current = STATES.GAME_OVER;
    if (typeof SoundEngine !== 'undefined' && SoundEngine.triggerVictoryRamp) {
        SoundEngine.triggerVictoryRamp(3.0);
    }
    const zone = document.getElementById('joystickZone') || (typeof joystickZone !== 'undefined' ? joystickZone : (typeof window !== 'undefined' ? window.joystickZone : null));
    if (zone) zone.style.display = 'none';
    const pauseBtn1 = document.getElementById('pauseMenuBtn');
    if (pauseBtn1) pauseBtn1.style.display = 'none';

    if (GAME_STATE.gameMode === 'online' && typeof netManager !== 'undefined' && netManager.isHost) {
        netManager.broadcast({ type: 'GAME_VICTORY' });
    }
    
    if (GAME_STATE.countdownTimer) { 
        clearTimeout(GAME_STATE.countdownTimer); 
        GAME_STATE.countdownTimer = null; 
    }
    
    if (!GAME_STATE.testingMode) {
        saveGameScore();
    }
    
    const m = document.getElementById('victoryModal');
    const s = document.getElementById('victoryStats');
    const bestScore = getBestScore(GAME_STATE.players.length, GAME_STATE.difficulty ? GAME_STATE.difficulty.name : 'normal');
    
    if (s) s.innerHTML = buildStatsHTML("Completed", GAME_STATE, bestScore);
    if (m) m.classList.add('show');
}

function formatTime(ms) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function buildStatsHTML(timeLabel, state, bestScore) {
    let html = `${timeLabel}: ${formatTime(state.elapsed)}<br>` +
               `Level: ${state.level}<br>` +
               `Kills: ${state.kills}<br>` +
               `Players: ${state.players.length}<br>` +
               `Difficulty: ${state.difficulty ? state.difficulty.name : 'Normal'}`;

    if (bestScore) {
        html += `<br><br><b>Personal Best:</b><br>` +
                `Best Time: ${formatTime(bestScore.time)}<br>` +
                `Best Level: ${bestScore.level}<br>` +
                `Best Kills: ${bestScore.kills}`;
    }
    return html;
}

function saveGameScore() {
    if (typeof GAME_STATE === 'undefined') return;
    const score = {
        time: GAME_STATE.elapsed,
        level: GAME_STATE.level,
        kills: GAME_STATE.kills,
        players: GAME_STATE.players.length,
        difficulty: GAME_STATE.difficulty ? GAME_STATE.difficulty.name : 'Normal',
        date: Date.now()
    };

    try {
        if (typeof localStorage !== 'undefined') {
            const existingScores = JSON.parse(localStorage.getItem('game_scores')) || [];
            existingScores.push(score);
            localStorage.setItem('game_scores', JSON.stringify(existingScores));
        }
    } catch (err) {
        console.error('Failed to save score to local storage:', err);
    }
}

function getBestScore(numberOfPlayers = null, difficulty = null) {
    try {
        if (typeof localStorage === 'undefined') return null;
        const scores = JSON.parse(localStorage.getItem('game_scores')) || [];

        const matchingScores = scores.filter(current => {
            if (numberOfPlayers !== null && current.players !== numberOfPlayers) return false;
            if (difficulty !== null && current.difficulty !== difficulty) return false;
            return true;
        });

        if (matchingScores.length === 0) return null;

        return matchingScores.reduce((best, current) => {
            return (current.kills > best.kills) ? current : best;
        });
    } catch (err) {
        console.error('Error reading best scores:', err);
        return null;
    }
}

// ---------------- 5. Navigation & Menus ----------------

let selectedGameMode = 'single';
let pendingPlayerCount = 1;

async function joinOnlineRoom(code) {
    const statusEl = document.getElementById('joinStatus');
    const cleanCode = (code || '').trim().toUpperCase().replace(/^BLOB[-_\s]*/i, '').replace(/[^A-Z0-9]/g, '');
    if (!cleanCode) {
        if (statusEl) statusEl.textContent = 'Please enter a valid 4-character room code (e.g. 4821)';
        return;
    }
    selectedGameMode = 'online_join';
    if (typeof GAME_STATE !== 'undefined') {
        GAME_STATE.gameMode = 'online';
        GAME_STATE.isOnline = true;
        GAME_STATE.isHost = false;
        GAME_STATE.isClient = true;
    }
    if (statusEl) statusEl.textContent = `Connecting to room ${cleanCode}...`;
    try {
        if (typeof netManager !== 'undefined' && netManager) {
            await netManager.initClient(cleanCode);
        }
        if (statusEl) statusEl.textContent = 'Connected! Entering room...';
    } catch (err) {
        console.error('[Multiplayer] Join failed:', err);
        const errMsg = err && err.type === 'peer-unavailable'
            ? 'Room not found. Make sure the Host is in the lobby.'
            : (err.message || 'Room not found');
        if (statusEl) statusEl.textContent = `Could not connect: ${errMsg}`;
    }
}

function showStartStep(step) {
    const setDisplay = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.style.display = val;
    };
    setDisplay('modeStep', (step === 'mode') ? 'block' : 'none');
    setDisplay('onlineChoiceStep', (step === 'onlineChoice') ? 'block' : 'none');
    setDisplay('joinRoomStep', (step === 'joinRoom') ? 'block' : 'none');
    setDisplay('playerStep', (step === 'players') ? 'block' : 'none');
    setDisplay('difficultyStep', (step === 'difficulty') ? 'block' : 'none');

    const tBtn = document.getElementById('testingBtn');
    if (tBtn) {
        tBtn.style.display = (typeof ENABLE_TESTING_LAB !== 'undefined' && ENABLE_TESTING_LAB && step === 'mode') ? 'block' : 'none';
    }

    const btnLocal = document.getElementById('btnModeLocal');
    if (btnLocal) btnLocal.style.display = (typeof isMobile !== 'undefined' && isMobile) ? 'none' : 'block';
}

function showStartMenu() {
    if (kickTimeoutId) {
        clearTimeout(kickTimeoutId);
        kickTimeoutId = null;
    }
    if (typeof GAME_STATE !== 'undefined') {
        GAME_STATE.current = STATES.START_MENU;
        GAME_STATE.testingMode = false;
        GAME_STATE.isOnline = false;
        GAME_STATE.isHost = false;
        GAME_STATE.isClient = false;
        GAME_STATE.victoryTriggered = false;
        GAME_STATE.enemies = [];
        GAME_STATE.activeSentries = [];
        GAME_STATE.shieldBearers = [];
        GAME_STATE.attractingVipers = [];
        GAME_STATE.projectiles = [];
        GAME_STATE.enemyProjectiles = [];
        GAME_STATE.hazards = [];
        GAME_STATE.iceTrails = [];
        GAME_STATE.terrains = [];
        GAME_STATE.turrets = [];
        GAME_STATE.gems = [];
        GAME_STATE.particles = [];
        GAME_STATE.firstXpGem = null;
        GAME_STATE.xpArrowDone = false;
        GAME_STATE.hostW = null;
        GAME_STATE.hostH = null;
    }
    if (typeof netManager !== 'undefined' && netManager) netManager.reset();

    if (typeof resizeCanvas === 'function') resizeCanvas();
    if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.init) {
        SPATIAL_GRID.init(W, H);
        SPATIAL_GRID.clear();
    }
    if (typeof ctx !== 'undefined' && ctx && typeof canvas !== 'undefined' && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (typeof draw === 'function' && typeof W !== 'undefined' && typeof H !== 'undefined') {
        draw(0);
    }

    if (typeof SoundEngine !== 'undefined') {
        if (SoundEngine.setMuffled) SoundEngine.setMuffled(false);
        if (SoundEngine.startMenuMusic) SoundEngine.startMenuMusic();
    }
    const tBtn = document.getElementById('testingBtn');
    if (tBtn) tBtn.style.display = (typeof ENABLE_TESTING_LAB !== 'undefined' && ENABLE_TESTING_LAB) ? 'block' : 'none';
    
    const pauseBtn2 = document.getElementById('pauseMenuBtn');
    if (pauseBtn2) pauseBtn2.style.display = 'none';

    const hideModal = (id) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('show');
    };
    hideModal('gameOverModal');
    hideModal('victoryModal');
    hideModal('pauseModal');

    const zone = document.getElementById('joystickZone') || (typeof joystickZone !== 'undefined' ? joystickZone : (typeof window !== 'undefined' ? window.joystickZone : null));
    if (zone) zone.style.display = 'none';
    const tipEl = document.getElementById('tipText') || (typeof tip !== 'undefined' ? tip : null);
    if (tipEl) tipEl.style.display = 'none';
    stopTipRotation();
    const uiLayer = document.querySelector('.ui-layer');
    if (uiLayer) uiLayer.style.display = 'none';
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.style.display = 'none';

    const inviteBanner = document.getElementById('inviteCodeBanner');
    if (inviteBanner) inviteBanner.style.display = 'none';
    const rotateHint = document.getElementById('rotateHint');
    if (rotateHint) rotateHint.style.display = 'none';
    if (typeof window !== 'undefined') window._rotateHintDismissed = false;
    const lobbyStartBtn = document.getElementById('lobbyStartBtn');
    if (lobbyStartBtn) lobbyStartBtn.style.display = 'none';

    showStartStep('mode');
    const startMenu = document.getElementById('startMenu');
    if (startMenu) startMenu.classList.add('show');
}

function togglePause() {
    if (typeof GAME_STATE === 'undefined') return;
    if (GAME_STATE.current === STATES.GAMEPLAY) {
        GAME_STATE.current = STATES.PAUSED;
        if (typeof SoundEngine !== 'undefined' && SoundEngine.setMuffled) {
            SoundEngine.setMuffled(true, 0.5);
        }
        const zone = document.getElementById('joystickZone') || (typeof joystickZone !== 'undefined' ? joystickZone : (typeof window !== 'undefined' ? window.joystickZone : null));
        if (zone) zone.style.display = 'none';
        const modal = document.getElementById('pauseModal');
        if (modal) modal.classList.add('show');
    } else if (GAME_STATE.current === STATES.PAUSED) {
        const modal = document.getElementById('pauseModal');
        if (modal) modal.classList.remove('show');
        startCountdown(false);
    }
}

// ---------------- 6. HUD UI Update Loop ----------------

function updateUI() {
    if (typeof GAME_STATE === 'undefined') return;
    const xpBarEl = document.getElementById('xpBar');
    const statsEl = document.getElementById('stats');
    const timerEl = document.getElementById('timer');
    const fpsCounterEl = document.getElementById('fpsCounter');

    if (xpBarEl && GAME_STATE.nextXp) {
        xpBarEl.style.width = ((GAME_STATE.xp / GAME_STATE.nextXp) * 100) + '%';
    }

    if (statsEl && GAME_STATE.players) {
        const playerRows = GAME_STATE.players.map((p, i) => {
            if (!p) return '';
            if (p.disconnected || p.kicked) {
                return `<div style="margin-top:2px;"><span style="color:${p.color};opacity:0.65">P${i + 1} (Disconnected)</span></div>`;
            }
            if (p.alive) {
                return `<div style="margin-top:2px;"><span style="color:${p.color}">P${i + 1} ${Math.ceil(p.hp)}/${p.maxHp}</span></div>`;
            }
            let rem = Math.max(0, Math.ceil((((typeof REVIVE_MS !== 'undefined' ? REVIVE_MS : 10000) * (p.reviveTimeModifier || 1.0)) - ((typeof gameClock !== 'undefined' ? gameClock : performance.now()) - p.deadAt)) / 1000));
            if (GAME_STATE.activeBoss && p.deadAt >= GAME_STATE.activeBossStartTime && typeof BOSS_CONFIGS !== 'undefined') {
                const cfg = BOSS_CONFIGS[GAME_STATE.activeBoss];
                if (cfg) {
                    const bossEnd = cfg.startMs + cfg.durationLimit;
                    rem = Math.max(1, Math.ceil((bossEnd - GAME_STATE.elapsed) / 1000));
                }
            }
            return `<div style="margin-top:2px;"><span style="color:${p.color};opacity:0.55">P${i + 1} &#9760;${rem}s</span></div>`;
        }).join('');
        statsEl.innerHTML = `Level: ${GAME_STATE.level} | Kills: ${GAME_STATE.kills}${playerRows}`;

        const curClock = (typeof gameClock !== 'undefined' ? gameClock : performance.now());
        const anyPulsing = GAME_STATE.players.some(p => p && p.hpPulseUntil && curClock < p.hpPulseUntil);
        if (anyPulsing && !statsEl._hpPulseActive) {
            statsEl._hpPulseActive = true;
            statsEl.classList.remove('hp-pulse');
            void statsEl.offsetWidth;
            statsEl.classList.add('hp-pulse');
        } else if (!anyPulsing && statsEl._hpPulseActive) {
            statsEl._hpPulseActive = false;
            statsEl.classList.remove('hp-pulse');
        }
    }

    if (timerEl && typeof GAME_STATE.elapsed === 'number') {
        const mins = Math.floor(GAME_STATE.elapsed / 60000);
        const secs = Math.floor((GAME_STATE.elapsed % 60000) / 1000);
        timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    if (fpsCounterEl) {
        if (GAME_STATE.testingMode && GAME_STATE.current === STATES.GAMEPLAY) {
            fpsCounterEl.style.display = 'block';
            const enemyCount = GAME_STATE.enemies ? GAME_STATE.enemies.length : 0;
            fpsCounterEl.innerHTML = `${GAME_STATE.currentFps || 60} FPS<br>Enemies: ${enemyCount}`;
        } else {
            fpsCounterEl.style.display = 'none';
        }
    }
}

// ---------------- 7. DOM Event Listeners & Buttons Initialization ----------------

function initUISystem() {
    if (typeof document === 'undefined') return;

    // Dynamically adjust tip text width whenever window is resized
    window.addEventListener('resize', adjustTipTextLayout);

    // UI Click sound hook for all interactive buttons and upgrade options
    document.addEventListener('click', (e) => {
        if (e.target && e.target.closest('button, .upgrade-btn, .upgrade-node, .upgrade-node-btn, .upgrade-help-btn, .time-preset-btn, .difficulty-card')) {
            if (typeof SoundEngine !== 'undefined' && SoundEngine.uiClick) {
                SoundEngine.uiClick();
            }
        }
    });

    // Start Menu Step Mode Buttons
    const btnSingle = document.getElementById('btnModeSingle');
    if (btnSingle) {
        btnSingle.onclick = () => {
            selectedGameMode = 'single';
            pendingPlayerCount = 1;
            if (typeof GAME_STATE !== 'undefined') GAME_STATE.gameMode = 'single';
            const promptEl = document.getElementById('difficultyPrompt');
            if (promptEl) promptEl.textContent = 'Singleplayer — Select Difficulty';
            showStartStep('difficulty');
        };
    }

    const btnLocal = document.getElementById('btnModeLocal');
    if (btnLocal) {
        btnLocal.onclick = () => {
            selectedGameMode = 'local';
            if (typeof GAME_STATE !== 'undefined') GAME_STATE.gameMode = 'local';
            showStartStep('players');
        };
    }

    const btnOnline = document.getElementById('btnModeOnline');
    if (btnOnline) {
        btnOnline.onclick = () => {
            showStartStep('onlineChoice');
        };
    }

    const btnOnlineHost = document.getElementById('btnOnlineHost');
    if (btnOnlineHost) {
        btnOnlineHost.onclick = () => {
            selectedGameMode = 'online_host';
            if (typeof GAME_STATE !== 'undefined') {
                GAME_STATE.gameMode = 'online';
                GAME_STATE.isOnline = true;
                GAME_STATE.isHost = true;
                GAME_STATE.isClient = false;
            }
            pendingPlayerCount = 1;
            const promptEl = document.getElementById('difficultyPrompt');
            if (promptEl) promptEl.textContent = 'Online Co-Op — Select Difficulty';
            showStartStep('difficulty');
        };
    }

    const btnOnlineJoin = document.getElementById('btnOnlineJoin');
    if (btnOnlineJoin) {
        btnOnlineJoin.onclick = () => {
            selectedGameMode = 'online_join';
            if (typeof GAME_STATE !== 'undefined') {
                GAME_STATE.gameMode = 'online';
                GAME_STATE.isOnline = true;
                GAME_STATE.isHost = false;
                GAME_STATE.isClient = true;
            }
            const statusEl = document.getElementById('joinStatus');
            if (statusEl) statusEl.textContent = '';
            showStartStep('joinRoom');
        };
    }

    // Join Room Submit Handler
    const btnSubmitJoin = document.getElementById('btnSubmitJoin');
    const joinInput = document.getElementById('joinCodeInput');
    if (btnSubmitJoin) {
        btnSubmitJoin.onclick = () => {
            const code = joinInput ? joinInput.value : '';
            joinOnlineRoom(code);
        };
    }
    if (joinInput) {
        joinInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                joinOnlineRoom(joinInput.value);
            }
        });
    }

    // Back Navigation Handlers
    const backFromOnlineChoice = document.getElementById('backFromOnlineChoice');
    if (backFromOnlineChoice) backFromOnlineChoice.onclick = () => showStartStep('mode');

    const backFromJoin = document.getElementById('backFromJoin');
    if (backFromJoin) backFromJoin.onclick = () => showStartStep('onlineChoice');

    const backToModesFromPlayers = document.getElementById('backToModesFromPlayers');
    if (backToModesFromPlayers) backToModesFromPlayers.onclick = () => showStartStep('mode');

    const backToPreviousFromDiff = document.getElementById('backToPreviousFromDiff');
    if (backToPreviousFromDiff) {
        backToPreviousFromDiff.onclick = () => {
            if (selectedGameMode === 'single') showStartStep('mode');
            else if (selectedGameMode === 'local') showStartStep('players');
            else if (selectedGameMode === 'online_host') showStartStep('onlineChoice');
            else showStartStep('mode');
        };
    }

    // Player count for Local Multiplayer
    for (const btn of document.querySelectorAll('#startMenu [data-players]')) {
        btn.onclick = () => {
            pendingPlayerCount = parseInt(btn.dataset.players, 10);
            const promptEl = document.getElementById('difficultyPrompt');
            if (promptEl) {
                promptEl.textContent = `${pendingPlayerCount} Players (Local) — Select Difficulty`;
            }
            showStartStep('difficulty');
        };
    }

    // Difficulty buttons click
    for (const btn of document.querySelectorAll('#startMenu [data-difficulty]')) {
        btn.onclick = async () => {
            const diffKey = btn.dataset.difficulty;
            if (selectedGameMode === 'online_host') {
                try {
                    if (typeof netManager !== 'undefined' && netManager) {
                        await netManager.initHost();
                    }
                    if (typeof startGame === 'function') startGame(1, diffKey);
                } catch (err) {
                    alert('Could not initialize P2P host: ' + err.message);
                }
            } else {
                if (typeof startGame === 'function') startGame(pendingPlayerCount, diffKey);
            }
        };
    }

    // Auto-check URL query parameter on page load (e.g. ?room=BLOB-4821)
    if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        const roomParam = urlParams.get('room');
        if (roomParam) {
            console.log('[Multiplayer] Auto-joining room from URL parameter:', roomParam);
            setTimeout(() => {
                const joinInput = document.getElementById('joinCodeInput');
                if (joinInput) joinInput.value = roomParam;
                showStartStep('joinRoom');
                joinOnlineRoom(roomParam);
            }, 300);
        }
    }

    // Invite Code Banner Click -> Copy URL & Code to clipboard
    const inviteBanner = document.getElementById('inviteCodeBanner');
    if (inviteBanner) {
        inviteBanner.onclick = () => {
            if (typeof netManager === 'undefined' || !netManager || !netManager.roomCode) return;
            const joinUrl = (typeof NetworkManager !== 'undefined' && NetworkManager.getJoinUrl)
                ? NetworkManager.getJoinUrl(netManager.roomCode)
                : (window.location.origin + window.location.pathname + '?room=' + netManager.roomCode);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(joinUrl).then(() => {
                    inviteBanner.classList.add('copied');
                    const hintEl = document.getElementById('inviteCopyHint');
                    if (hintEl) hintEl.textContent = '✓ Link Copied!';
                    setTimeout(() => {
                        inviteBanner.classList.remove('copied');
                        if (hintEl) hintEl.textContent = 'Click to copy link';
                    }, 2200);
                }).catch(() => {
                    prompt('Share this invite link with friends to play together:', joinUrl);
                });
            } else {
                prompt('Share this invite link with friends to play together:', joinUrl);
            }
        };
    }

    // Modal Control Buttons
    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) restartBtn.onclick = showStartMenu;

    const victoryRestartBtn = document.getElementById('victoryRestartBtn');
    if (victoryRestartBtn) victoryRestartBtn.onclick = showStartMenu;

    const resumeBtn = document.getElementById('resumeBtn');
    if (resumeBtn) resumeBtn.onclick = togglePause;

    const pauseQuitBtn = document.getElementById('pauseQuitBtn');
    if (pauseQuitBtn) pauseQuitBtn.onclick = showStartMenu;

    const pauseMenuBtn = document.getElementById('pauseMenuBtn');
    if (pauseMenuBtn) {
        pauseMenuBtn.onclick = togglePause;
        pauseMenuBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    // Auto-run start menu on load
    showStartMenu();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUISystem);
    } else {
        initUISystem();
    }
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== 'undefined') {
    window.WEAPON_LABELS = WEAPON_LABELS;
    window.startWeaponSelectFlow = startWeaponSelectFlow;
    window.renderLobbyWeaponPanels = renderLobbyWeaponPanels;
    window.buildPlaceholderPanel = buildPlaceholderPanel;
    window.buildStartingWeaponPanel = buildStartingWeaponPanel;
    window.selectStartingWeapon = selectStartingWeapon;
    window.startLevelUpFlow = startLevelUpFlow;
    window.beginSelectionRound = beginSelectionRound;
    window.showKickButtonsForUnpickedPlayers = showKickButtonsForUnpickedPlayers;
    window.kickPlayerByHost = kickPlayerByHost;
    window.onOnlinePlayerKicked = onOnlinePlayerKicked;
    window.getPanelPosition = getPanelPosition;
    window.buildPlayerPanel = buildPlayerPanel;
    window.onPlayerChose = onPlayerChose;
    window.startCountdown = startCountdown;
    window.tips = tips;
    window.fetchTip = fetchTip;
    window.adjustTipTextLayout = adjustTipTextLayout;
    window.startTipRotation = startTipRotation;
    window.stopTipRotation = stopTipRotation;
    window.gameOver = gameOver;
    window.showVictory = showVictory;
    window.formatTime = formatTime;
    window.buildStatsHTML = buildStatsHTML;
    window.saveGameScore = saveGameScore;
    window.getBestScore = getBestScore;
    window.showStartStep = showStartStep;
    window.showStartMenu = showStartMenu;
    window.joinOnlineRoom = joinOnlineRoom;
    window.togglePause = togglePause;
    window.updateUI = updateUI;
    window.initUISystem = initUISystem;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        WEAPON_LABELS,
        startWeaponSelectFlow,
        renderLobbyWeaponPanels,
        buildPlaceholderPanel,
        buildStartingWeaponPanel,
        selectStartingWeapon,
        startLevelUpFlow,
        beginSelectionRound,
        showKickButtonsForUnpickedPlayers,
        kickPlayerByHost,
        onOnlinePlayerKicked,
        getPanelPosition,
        buildPlayerPanel,
        onPlayerChose,
        startCountdown,
        tips,
        fetchTip,
        adjustTipTextLayout,
        startTipRotation,
        stopTipRotation,
        gameOver,
        showVictory,
        formatTime,
        buildStatsHTML,
        saveGameScore,
        getBestScore,
        showStartStep,
        showStartMenu,
        joinOnlineRoom,
        togglePause,
        updateUI,
        initUISystem
    };
}
