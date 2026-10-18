/**
 * BlobSurvival - User Interface, Modals & Screen Navigation
 *
 * Manages HUD layout updates, starting weapon selection lobby, level-up upgrade
 * panels, animated match countdowns, tips rotation, pause/victory/gameover dialogs,
 * and LocalStorage score persistence.
 */

// ---------------- 1. Weapon Labels & Starting Weapon Selection ----------------

const WEAPON_LABELS = {
    magic_missile: 'Ranged',
    melee_sweep: 'Melee',
    proximity_mine: 'Explosives',
    turret: 'Structures',
};

function startWeaponSelectFlow() {
    if (typeof GAME_STATE === 'undefined') return;
    GAME_STATE.current = STATES.WEAPON_SELECT;
    const tBtn = document.getElementById('testingBtn');
    if (tBtn) tBtn.style.display = 'none';
    const isMobileDevice =
        typeof isMobile !== 'undefined'
            ? isMobile
            : (typeof window !== 'undefined' && window.isMobile) || false;
    const zone =
        document.getElementById('joystickZone') ||
        (typeof joystickZone !== 'undefined'
            ? joystickZone
            : typeof window !== 'undefined'
              ? window.joystickZone
              : null);
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

function captureOpenLobbyNameEdits() {
    /** @type {Map<number, {value: string, selectionStart: number|null, selectionEnd: number|null}>} */
    const edits = new Map();
    document.querySelectorAll('.player-name-input').forEach((el) => {
        const input = /** @type {HTMLInputElement} */ (el);
        const m = /^playerNameInput_(\d+)$/.exec(input.id || '');
        if (!m) return;
        edits.set(Number(m[1]), {
            value: input.value,
            selectionStart: input.selectionStart,
            selectionEnd: input.selectionEnd,
        });
    });
    return edits;
}

function updateLobbyPlayerNameDisplay(playerIndex, name) {
    const panel = document.getElementById(`playerPanel_${playerIndex}`);
    if (!panel) return false;
    // Don't clobber an in-progress edit on this panel
    if (panel.querySelector('.player-name-input')) return true;
    const nameSpan = panel.querySelector('.player-name-text');
    if (nameSpan) {
        nameSpan.textContent = name;
        return true;
    }
    return false;
}

function beginLobbyNameEdit(panel, player, title, n, restoreState = null) {
    if (!panel || !player || !title) return;
    if (panel.querySelector('.player-name-input')) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'player-name-input';
    input.name = `player_name_${player.index}`;
    input.id = `playerNameInput_${player.index}`;
    input.autocomplete = 'off';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'words');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('data-form-type', 'other');
    input.setAttribute('data-lpignore', 'true');
    input.setAttribute('data-1p-ignore', 'true');
    input.setAttribute('aria-label', `Player ${n} Name`);
    input.value =
        restoreState?.value != null
            ? restoreState.value
            : player.name || `Player ${n}`;
    input.maxLength = 20;
    input.style.color = player.color;
    input.style.borderColor = player.color;
    input.style.boxShadow = `0 0 10px ${player.color}`;

    title.style.display = 'none';
    panel.insertBefore(input, title);
    input.focus();
    if (
        restoreState &&
        typeof restoreState.selectionStart === 'number' &&
        typeof restoreState.selectionEnd === 'number'
    ) {
        try {
            input.setSelectionRange(
                restoreState.selectionStart,
                restoreState.selectionEnd,
            );
        } catch {
            input.select();
        }
    } else {
        input.select();
    }

    let editFinished = false;
    const finishEdit = (commit) => {
        // Enter/blur can fire together; lobby re-renders may already detach the input
        if (editFinished) return;
        editFinished = true;
        // Lobby DOM rebuild abandons the old input; value is restored afterward
        if (input.dataset.lobbyAbandon === '1') return;
        if (commit) {
            const cleaned = input.value
                .normalize('NFC')
                .replace(/[^\p{Script=Latin}0-9 ]/gu, '')
                .slice(0, 20)
                .trim();
            player.name = cleaned || `Player ${n}`;
            if (
                GAME_STATE.gameMode === 'online' &&
                typeof netManager !== 'undefined' &&
                netManager
            ) {
                // Event-only: send once when the edit is committed
                netManager.sendPlayerName(player.name);
            }
        }
        if (input.parentNode) input.remove();
        if (title.isConnected) {
            title.style.display = '';
            const nameSpan = title.querySelector('.player-name-text');
            if (nameSpan) {
                nameSpan.textContent = player.name || `Player ${n}`;
            } else {
                // title content may need rebuild if structure changed
                title.dispatchEvent(new CustomEvent('lobby-name-refresh'));
            }
        }
    };

    input.addEventListener('input', () => {
        input.value = input.value
            .normalize('NFC')
            .replace(/[^\p{Script=Latin}0-9 ]/gu, '')
            .slice(0, 20);
    });

    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            finishEdit(true);
        } else if (e.key === 'Escape') {
            finishEdit(false);
        }
    });

    input.addEventListener('blur', () => {
        finishEdit(true);
    });
}

function restoreOpenLobbyNameEdits(edits) {
    if (!edits || edits.size === 0) return;
    for (const [index, state] of edits) {
        const panel = document.getElementById(`playerPanel_${index}`);
        const player = GAME_STATE.players?.[index];
        if (!panel || !player) continue;
        const title = panel.querySelector('.panel-title.editable-name');
        if (!title) continue;
        beginLobbyNameEdit(panel, player, title, index + 1, state);
    }
}

function renderLobbyWeaponPanels() {
    const layer = document.getElementById('levelUpLayer');
    if (!layer) return;
    const openNameEdits = captureOpenLobbyNameEdits();
    // Mark open inputs so their blur handlers do not commit while we rebuild
    document.querySelectorAll('.player-name-input').forEach((el) => {
        el.dataset.lobbyAbandon = '1';
    });
    layer.innerHTML = '';
    const isSingle = GAME_STATE.gameMode === 'single';
    const isLocal = GAME_STATE.gameMode === 'local';
    const isOnlineHost =
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager?.isHost;
    const isOnlineClient =
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager?.isClient;

    const lobbyStartBtn = document.getElementById('lobbyStartBtn');
    const inviteBanner = document.getElementById('inviteCodeBanner');
    const howToPlayBanner = document.getElementById('howToPlayBanner');
    const fullscreenLobbyBtn = document.getElementById('fullscreenLobbyBtn');
    const lobbyActionStack = document.getElementById('lobbyActionStack');
    const tipEl = document.getElementById('tipText');

    if (isSingle) {
        if (lobbyStartBtn) lobbyStartBtn.style.display = 'none';
        if (inviteBanner) inviteBanner.style.display = 'none';
        if (howToPlayBanner) howToPlayBanner.style.display = 'none';
        if (fullscreenLobbyBtn) fullscreenLobbyBtn.classList.remove('is-visible');
        if (lobbyActionStack) lobbyActionStack.classList.remove('is-visible');
        const player = GAME_STATE.players?.[0] ? GAME_STATE.players[0] : null;
        if (player)
            layer.appendChild(buildStartingWeaponPanel(player, 1, true));
    } else if (isLocal) {
        if (lobbyStartBtn) {
            lobbyStartBtn.style.display = 'block';
            lobbyStartBtn.disabled = !GAME_STATE.players.every(
                (p) => p?.selectedWeapon,
            );
            lobbyStartBtn.onclick = () => {
                lobbyStartBtn.style.display = 'none';
                if (howToPlayBanner) howToPlayBanner.style.display = 'none';
                if (fullscreenLobbyBtn)
                    fullscreenLobbyBtn.classList.remove('is-visible');
                if (lobbyActionStack)
                    lobbyActionStack.classList.remove('is-visible');
                layer.classList.remove('show');
                if (tipEl) tipEl.style.display = 'none';
                startCountdown(true);
            };
        }
        if (inviteBanner) inviteBanner.style.display = 'none';
        if (howToPlayBanner) howToPlayBanner.style.display = 'block';
        if (fullscreenLobbyBtn) fullscreenLobbyBtn.classList.add('is-visible');
        if (lobbyActionStack) lobbyActionStack.classList.add('is-visible');
        const count = GAME_STATE.players.length;
        for (const player of GAME_STATE.players) {
            if (player)
                layer.appendChild(
                    buildStartingWeaponPanel(player, count, true),
                );
        }
    } else if (isOnlineHost) {
        if (inviteBanner) {
            inviteBanner.style.display = 'block';
            const codeEl = document.getElementById('inviteCodeText');
            if (codeEl)
                codeEl.textContent = netManager?.roomCode
                    ? netManager.roomCode
                    : 'XXXX';
        }
        if (howToPlayBanner) howToPlayBanner.style.display = 'block';
        if (fullscreenLobbyBtn) fullscreenLobbyBtn.classList.add('is-visible');
        if (lobbyActionStack) lobbyActionStack.classList.add('is-visible');
        if (lobbyStartBtn) {
            lobbyStartBtn.style.display = 'block';
            const activePlayers = (GAME_STATE.players || []).filter(
                (p) => p && !p.disconnected,
            );
            const allReady =
                activePlayers.length > 0 &&
                activePlayers.every((p) => p?.selectedWeapon);
            lobbyStartBtn.disabled = !allReady;
            lobbyStartBtn.onclick = () => {
                lobbyStartBtn.style.display = 'none';
                if (inviteBanner) inviteBanner.style.display = 'none';
                if (howToPlayBanner) howToPlayBanner.style.display = 'none';
                if (fullscreenLobbyBtn)
                    fullscreenLobbyBtn.classList.remove('is-visible');
                if (lobbyActionStack)
                    lobbyActionStack.classList.remove('is-visible');
                layer.classList.remove('show');
                if (tipEl) tipEl.style.display = 'none';
                if (typeof netManager !== 'undefined' && netManager) {
                    netManager.broadcast({
                        type: 'START_GAME_COUNTDOWN',
                        isNewGame: true,
                    });
                }
                startCountdown(true);
            };
        }
        if (typeof isMobile !== 'undefined' && isMobile) {
            const player = GAME_STATE.players[0];
            if (player)
                layer.appendChild(buildStartingWeaponPanel(player, 1, true));
        } else {
            const maxOnline =
                typeof MAX_ONLINE_PLAYERS === 'number' ? MAX_ONLINE_PLAYERS : 12;
            const connected = [];
            const empty = [];
            for (let i = 0; i < maxOnline; i++) {
                const player = GAME_STATE.players[i];
                if (player && !player.disconnected) connected.push(i);
                else empty.push(i);
            }
            // Classic 4-corner lobby while under 4 players; at 4+ show all
            // connected seats plus one open seat so more joins stay obvious.
            const connectedCount = connected.length;
            const panelCount =
                connectedCount < 4
                    ? Math.min(4, maxOnline)
                    : Math.min(
                          maxOnline,
                          connectedCount + (empty.length > 0 ? 1 : 0),
                      );
            const others = connected.filter((i) => i !== 0);
            const displaySlots = others.slice();
            for (const i of empty) {
                if (displaySlots.length + 1 >= panelCount) break;
                displaySlots.push(i);
            }
            if (connected.includes(0)) displaySlots.push(0);
            while (displaySlots.length < panelCount) {
                const nextEmpty = empty.find((i) => !displaySlots.includes(i));
                if (nextEmpty === undefined) break;
                displaySlots.splice(displaySlots.length - 1, 0, nextEmpty);
            }
            for (let s = 0; s < displaySlots.length; s++) {
                const i = displaySlots[s];
                const player = GAME_STATE.players[i];
                if (player && !player.disconnected) {
                    layer.appendChild(
                        buildStartingWeaponPanel(player, panelCount, i === 0, s),
                    );
                } else {
                    layer.appendChild(buildPlaceholderPanel(i, panelCount, s));
                }
            }
        }
    } else if (isOnlineClient) {
        if (lobbyStartBtn) lobbyStartBtn.style.display = 'none';
        if (inviteBanner) inviteBanner.style.display = 'none';
        if (howToPlayBanner) howToPlayBanner.style.display = 'block';
        if (fullscreenLobbyBtn) fullscreenLobbyBtn.classList.add('is-visible');
        if (lobbyActionStack) lobbyActionStack.classList.add('is-visible');
        const myIndex = netManager ? netManager.localPlayerIndex : 0;
        if (typeof isMobile !== 'undefined' && isMobile) {
            const def =
                typeof getPlayerDef === 'function'
                    ? getPlayerDef(myIndex)
                    : PLAYER_DEFS[myIndex];
            const player =
                GAME_STATE.players?.[myIndex] || new Player(myIndex, def);
            layer.appendChild(buildStartingWeaponPanel(player, 1, true));
        } else {
            const connected = (GAME_STATE.players || [])
                .filter((p) => p && !p.disconnected)
                .map((p) => p.index)
                .sort((a, b) => a - b);
            if (!connected.includes(myIndex)) connected.push(myIndex);
            const orderedSlots = connected
                .filter((i) => i !== myIndex)
                .concat([myIndex]);
            const panelCount = Math.max(orderedSlots.length, 1);
            for (let s = 0; s < orderedSlots.length; s++) {
                const i = orderedSlots[s];
                const player = GAME_STATE.players[i];
                if (player && !player.disconnected) {
                    layer.appendChild(
                        buildStartingWeaponPanel(
                            player,
                            panelCount,
                            i === myIndex,
                            s,
                        ),
                    );
                } else {
                    layer.appendChild(buildPlaceholderPanel(i, panelCount, s));
                }
            }
        }
    }
    layer.classList.add('show');
    adjustTipTextLayout();
    updateFullscreenButtons();
    if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => adjustTipTextLayout());
    }
    // Keep concurrent name edits alive across lobby re-renders (weapon picks, etc.)
    restoreOpenLobbyNameEdits(openNameEdits);
}

function buildPlaceholderPanel(index, count, layoutIndex = null) {
    const panel = document.createElement('div');
    panel.className = 'player-panel placeholder-panel chosen';
    const posIndex = layoutIndex !== null ? layoutIndex : index;
    panel.style.cssText = getPanelPosition(posIndex, count);
    panel.style.borderColor = '#444';
    panel.style.zIndex = '140';

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

function createKeyClusterDOM(playerIndex, color) {
    const keys =
        typeof getPlayerKeyLabels === 'function'
            ? getPlayerKeyLabels(playerIndex)
            : { up: 'W', left: 'A', down: 'S', right: 'D' };
    const container = document.createElement('div');
    container.className = 'player-dialog-key-cluster';
    container.style.setProperty('--p-color', color);

    const topRow = document.createElement('div');
    topRow.className = 'key-cluster-row';
    const upKey = document.createElement('div');
    upKey.className = 'key-cap';
    upKey.textContent = keys.up;
    topRow.appendChild(upKey);

    const bottomRow = document.createElement('div');
    bottomRow.className = 'key-cluster-row';
    const leftKey = document.createElement('div');
    leftKey.className = 'key-cap';
    leftKey.textContent = keys.left;
    const downKey = document.createElement('div');
    downKey.className = 'key-cap';
    downKey.textContent = keys.down;
    const rightKey = document.createElement('div');
    rightKey.className = 'key-cap';
    rightKey.textContent = keys.right;

    bottomRow.appendChild(leftKey);
    bottomRow.appendChild(downKey);
    bottomRow.appendChild(rightKey);

    container.appendChild(topRow);
    container.appendChild(bottomRow);

    return container;
}

function buildStartingWeaponPanel(
    player,
    count,
    isInteractive,
    layoutIndex = null,
) {
    const panel = document.createElement('div');
    panel.className = 'player-panel weapon-select-grid';
    panel.id = `playerPanel_${player.index}`;
    const posIndex = layoutIndex !== null ? layoutIndex : player.index;
    panel.style.cssText = getPanelPosition(posIndex, count);
    panel.style.borderColor = player.color;
    const n = player.index + 1;

    const isOnline = GAME_STATE.gameMode === 'online';
    const myIndex = isOnline
        ? typeof netManager !== 'undefined' && netManager
            ? netManager.localPlayerIndex
            : 0
        : 0;
    const isLocalPlayer = isOnline && player.index === myIndex;

    if (isLocalPlayer) {
        panel.classList.add('local-player-panel');
        panel.style.zIndex = '200';
    } else if (isOnline) {
        panel.style.zIndex = '142';
    }

    if (
        player.selectedWeapon ||
        (GAME_STATE.gameMode === 'online' && !isInteractive)
    ) {
        panel.classList.add('chosen');
    }

    const isMobileDevice =
        typeof isMobile !== 'undefined'
            ? isMobile
            : (typeof window !== 'undefined' && window.isMobile) || false;
    const showDialogKeys =
        !isMobileDevice &&
        (GAME_STATE.gameMode === 'single' ||
            GAME_STATE.gameMode === 'local' ||
            (GAME_STATE.gameMode === 'online' && isInteractive));
    if (showDialogKeys) {
        const keyCluster = createKeyClusterDOM(player.index, player.color);
        panel.appendChild(keyCluster);
    }

    const title = document.createElement('h3');
    title.className = 'panel-title';
    title.style.color = player.color;

    const isMultiplayer =
        GAME_STATE.gameMode === 'local' ||
        GAME_STATE.gameMode === 'online' ||
        (GAME_STATE.players && GAME_STATE.players.length > 1);
    const isEditable =
        isMultiplayer &&
        (GAME_STATE.gameMode === 'local' ||
            (GAME_STATE.gameMode === 'online' && isInteractive));

    const renderTitleContent = () => {
        title.innerHTML = '';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name-text';
        nameSpan.textContent = player.name || `Player ${n}`;
        title.appendChild(nameSpan);

        if (isEditable) {
            title.classList.add('editable-name');
            title.title = 'Click to change name';
            const editIcon = document.createElement('span');
            editIcon.className = 'player-name-edit-icon';
            editIcon.innerHTML = '&#9998;';
            editIcon.title = 'Click to change name';
            title.appendChild(editIcon);
        } else {
            title.classList.remove('editable-name');
            title.removeAttribute('title');
        }
    };

    renderTitleContent();
    title.addEventListener('lobby-name-refresh', renderTitleContent);

    if (isEditable) {
        title.addEventListener('click', () => {
            beginLobbyNameEdit(panel, player, title, n);
        });
    }

    panel.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'panel-sub';
    sub.textContent = isInteractive
        ? 'Select your starting weapon of choice:'
        : 'Choosing weapon...';
    panel.appendChild(sub);

    const addHelpAndTag = (btn, upgradeId, isOneShot) => {
        if (typeof UPGRADE_POOL === 'undefined') return;
        const u = UPGRADE_POOL.find((item) => item.id === upgradeId);
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
        {
            id: 'magic_missile',
            upgradeId: 'unlock_missile',
            name: 'Ranged',
            desc: 'Magic Missile — Homing projectile. Fires at closest enemy.',
        },
        {
            id: 'melee_sweep',
            upgradeId: 'unlock_melee',
            name: 'Melee',
            desc: 'Melee Sweep — Quick sweep. Hits all enemies in close range.',
        },
        {
            id: 'proximity_mine',
            upgradeId: 'unlock_mine',
            name: 'Explosives',
            desc: 'Proximity Mine — Drops mines that explode for AoE damage.',
        },
        {
            id: 'turret',
            upgradeId: 'unlock_turret',
            name: 'Structures',
            desc: 'Auto-Turret — Drops stationary turrets that fire missiles.',
        },
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
        panel.querySelectorAll('.upgrade-btn').forEach((b) => {
            b.classList.remove('selected-weapon');
            if (b.dataset.weaponId === weaponId)
                b.classList.add('selected-weapon');
        });
    }
    const statusDiv = document.getElementById(`panelStatus_${player.index}`);
    if (statusDiv) statusDiv.textContent = `✓ Ready: ${weaponLabel}`;

    const tipEl = document.getElementById('tipText');

    if (GAME_STATE.gameMode === 'single') {
        const layer = document.getElementById('levelUpLayer');
        if (layer) layer.classList.remove('show');
        if (tipEl) tipEl.style.display = 'none';
        startCountdown(true);
        return;
    }

    if (
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager
    ) {
        if (netManager.isClient) {
            netManager.sendWeaponSelection(weaponId);
        } else if (netManager.isHost) {
            const activePlayers = GAME_STATE.players.filter(
                (p) => p && !p.disconnected,
            );
            const allReady =
                activePlayers.length > 0 &&
                activePlayers.every((p) => p.selectedWeapon);
            netManager.broadcastLobbyState(
                activePlayers.map((p) => ({
                    index: p.index,
                    name: p.name || `Player ${p.index + 1}`,
                    selectedWeapon: p.selectedWeapon,
                    selectedWeaponLabel: p.selectedWeaponLabel,
                })),
                allReady,
            );
        }
    }

    const lobbyStartBtn = document.getElementById('lobbyStartBtn');
    if (lobbyStartBtn) {
        const activePlayers = (GAME_STATE.players || []).filter(
            (p) => p && !p.disconnected,
        );
        lobbyStartBtn.disabled =
            activePlayers.length === 0 ||
            !activePlayers.every((p) => p.selectedWeapon);
    }
}

// ---------------- 2. Level Up Flow & Selection Round ----------------

let kickTimeoutId = null;

function startLevelUpFlow() {
    if (typeof GAME_STATE === 'undefined') return;
    if (
        GAME_STATE.current === STATES.LEVEL_UP ||
        GAME_STATE.current === STATES.COUNTDOWN
    )
        return;
    GAME_STATE.current = STATES.LEVEL_UP;
    if (typeof netSoundEvents !== 'undefined') {
        netSoundEvents.length = 0;
    }
    if (typeof SoundEngine !== 'undefined' && SoundEngine.setMuffled) {
        SoundEngine.setMuffled(true, 0.5);
    }
    const zone =
        document.getElementById('joystickZone') ||
        (typeof joystickZone !== 'undefined'
            ? joystickZone
            : typeof window !== 'undefined'
              ? window.joystickZone
              : null);
    if (zone) zone.style.display = 'none';
    const tipEl = document.getElementById('tipText');
    if (tipEl) tipEl.style.display = 'none';

    for (const p of GAME_STATE.players) {
        if (p && !p.disconnected && !p.kicked) {
            if (
                !p.currentUpgradeOptions &&
                typeof pickThreeFor === 'function'
            ) {
                p.currentUpgradeOptions = pickThreeFor(p);
            }
        }
    }

    if (
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager?.isHost
    ) {
        const upgradesMap = {};
        for (const p of GAME_STATE.players) {
            if (p?.currentUpgradeOptions) {
                upgradesMap[p.index] = p.currentUpgradeOptions.map((u) => u.id);
            }
        }
        netManager.broadcast({
            type: 'LEVEL_UP_START',
            pendingLevels: GAME_STATE.pendingLevels,
            upgradesMap: upgradesMap,
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
    const isOnline = GAME_STATE.gameMode === 'online';
    const myIndex = isOnline
        ? typeof netManager !== 'undefined' && netManager
            ? netManager.localPlayerIndex
            : 0
        : 0;
    const isHost =
        isOnline && typeof netManager !== 'undefined' && netManager?.isHost;

    const activePlayers = (GAME_STATE.players || []).filter(
        (p) => p && !p.disconnected && !p.kicked,
    );
    for (const p of activePlayers) {
        p._virtualPickDone = false;
    }
    GAME_STATE.pendingPicks = activePlayers.length;

    if (isOnline && typeof isMobile !== 'undefined' && isMobile) {
        const player = GAME_STATE.players?.[myIndex] || GAME_STATE.players?.[0];
        if (player) layer.appendChild(buildPlayerPanel(player, 1, true));
    } else {
        const count = Math.max(activePlayers.length, 1);
        const allActive = (GAME_STATE.players || []).filter(
            (p) => p && !p.disconnected && !p.kicked,
        );
        const otherPlayers = isOnline
            ? allActive.filter((p) => p.index !== myIndex)
            : allActive;
        const myPlayer = isOnline
            ? allActive.find((p) => p.index === myIndex)
            : null;

        let layoutIdx = 0;
        for (const player of otherPlayers) {
            const isInteractive = !isOnline || player.index === myIndex;
            layer.appendChild(
                buildPlayerPanel(player, count, isInteractive, layoutIdx++),
            );
        }
        if (myPlayer) {
            layer.appendChild(buildPlayerPanel(myPlayer, count, true, layoutIdx));
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
    if (
        typeof GAME_STATE === 'undefined' ||
        GAME_STATE.current !== STATES.LEVEL_UP
    )
        return;
    for (const player of GAME_STATE.players || []) {
        if (
            !player ||
            player.index === 0 ||
            player.disconnected ||
            player.kicked
        )
            continue;
        const panel = document.getElementById(`levelPanel_${player.index}`);
        if (
            !panel ||
            panel.dataset.pickDone === 'true' ||
            player.currentLevelUpgradeName
        )
            continue;
        if (panel.querySelector('.kick-player-btn')) continue;

        const kickBtn = document.createElement('button');
        kickBtn.className = 'kick-player-btn';
        kickBtn.innerHTML = `⚠️ Kick Player ${player.index + 1} (AFK / Disconnected)`;
        kickBtn.onclick = (e) => {
            e.stopPropagation();
            if (
                confirm(
                    `Permanently kick Player ${player.index + 1} from this game session?`,
                )
            ) {
                kickPlayerByHost(player.index);
            }
        };
        panel.appendChild(kickBtn);
    }
}

/**
 * Drop a player's pending level-up pick so the round never stalls on them.
 * Host advances pendingPicks / finishSelectionRound; clients only update UI.
 */
function releaseDisconnectedPlayerPick(
    playerIndex,
    statusText = 'Disconnected — skipped',
) {
    if (typeof GAME_STATE === 'undefined') return false;
    if (GAME_STATE.current !== STATES.LEVEL_UP) return false;

    const p = GAME_STATE.players?.[playerIndex];
    const panel = document.getElementById(`levelPanel_${playerIndex}`);
    const isHost =
        !(
            GAME_STATE.gameMode === 'online' &&
            typeof netManager !== 'undefined' &&
            netManager?.isClient
        );

    let pickWasPending = false;
    if (panel) {
        if (panel.dataset.pickDone !== 'true') {
            panel.dataset.pickDone = 'true';
            pickWasPending = true;
        }
        panel.classList.add('chosen');
        panel.innerHTML = `<h3 class="panel-title" style="color: #ff4444;">Player ${playerIndex + 1}</h3><div style="color: #ff6666; font-size: 13px; margin-top: 10px; font-weight: bold;">✕ ${statusText}</div>`;
    } else if (p && !p._virtualPickDone && !p.currentLevelUpgradeName) {
        pickWasPending = true;
    }

    if (p) p._virtualPickDone = true;

    if (!pickWasPending) return false;

    if (isHost) {
        GAME_STATE.pendingPicks--;
        if (GAME_STATE.pendingPicks <= 0) {
            finishSelectionRound();
        }
    } else {
        GAME_STATE.pendingPicks--;
        if (GAME_STATE.pendingPicks <= 0) {
            const layer = document.getElementById('levelUpLayer');
            if (layer) layer.classList.remove('show');
        }
    }
    return true;
}

function kickPlayerByHost(playerIndex) {
    if (typeof GAME_STATE === 'undefined') return;
    const p = GAME_STATE.players[playerIndex];

    if (typeof netManager !== 'undefined' && netManager && netManager.isHost) {
        netManager.kickPlayer(playerIndex);
    }

    if (p) {
        p.disconnected = true;
        p.alive = false;
        p.kicked = true;
    }
    if (typeof recalculateDynamicDifficulty === 'function')
        recalculateDynamicDifficulty();

    releaseDisconnectedPlayerPick(playerIndex, 'Kicked by Host');
}

function onOnlinePlayerKicked(playerIndex) {
    if (typeof GAME_STATE === 'undefined') return;
    const p = GAME_STATE.players[playerIndex];
    if (p) {
        p.disconnected = true;
        p.alive = false;
        p.kicked = true;
    }
    if (typeof recalculateDynamicDifficulty === 'function')
        recalculateDynamicDifficulty();

    releaseDisconnectedPlayerPick(playerIndex, 'Removed by Host');
}

function getPanelPosition(index, count) {
    if (typeof isMobile !== 'undefined' && isMobile) {
        return 'top:50%; left:50%; transform:translate(-50%,-50%);';
    }
    const M = 24,
        TOP = 24,
        BOTTOM = 24;
    if (count === 1)
        return 'top:50%; left:50%; transform:translate(-50%,-50%);';
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
    // Classic 4-corner layout (unchanged for local / small online lobbies)
    if (count <= 4) {
        return (
            [
                `top:${TOP}px; left:${M}px;`,
                `top:${TOP}px; right:${M}px;`,
                `bottom:${BOTTOM}px; left:${M}px;`,
                `bottom:${BOTTOM}px; right:${M}px;`,
            ][index] || `top:${TOP}px; left:${M}px;`
        );
    }
    // 5–12 players: compact grid so every panel fits without overlapping
    const cols = count <= 6 ? 3 : 4;
    const rows = Math.ceil(count / cols);
    const col = index % cols;
    const row = Math.floor(index / cols);
    const widthPct = 100 / cols;
    const heightPct = 100 / rows;
    const leftPct = col * widthPct + widthPct / 2;
    const topPct = row * heightPct + heightPct / 2;
    const panelW =
        count <= 6
            ? 'clamp(200px, 28vw, 360px)'
            : 'clamp(160px, 22vw, 280px)';
    return `top:${topPct}%; left:${leftPct}%; transform:translate(-50%,-50%); width:${panelW}; max-height:calc(${heightPct}vh - 16px);`;
}

function buildPlayerPanel(
    player,
    count,
    isInteractive = true,
    layoutIndex = null,
) {
    const panel = document.createElement('div');
    panel.className = 'player-panel';
    panel.id = `levelPanel_${player.index}`;
    const posIndex = layoutIndex !== null ? layoutIndex : player.index;
    panel.style.cssText = getPanelPosition(posIndex, count);
    panel.style.borderColor = player.color;
    const n = player.index + 1;

    const isOnline = GAME_STATE.gameMode === 'online';
    const myIndex = isOnline
        ? typeof netManager !== 'undefined' && netManager
            ? netManager.localPlayerIndex
            : 0
        : 0;
    const isLocalPlayer = isOnline && player.index === myIndex;

    if (isLocalPlayer) {
        panel.classList.add('local-player-panel');
        panel.style.zIndex = '200';
    } else if (isOnline) {
        panel.style.zIndex = '142';
    }

    if (
        player.currentLevelUpgradeName ||
        (GAME_STATE.gameMode === 'online' && !isInteractive)
    ) {
        panel.classList.add('chosen');
    }

    const title = document.createElement('h3');
    title.className = 'panel-title';
    title.textContent = player.name || `Player ${n}`;
    title.style.color = player.color;
    panel.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'panel-sub';
    sub.textContent = player.alive
        ? isInteractive
            ? 'Choose an upgrade:'
            : 'Choosing upgrade...'
        : 'Down — applies on revive';
    panel.appendChild(sub);

    const options =
        typeof pickThreeFor === 'function' ? pickThreeFor(player) : [];
    for (const u of options) {
        const btn = document.createElement('button');
        btn.className = 'upgrade-btn';
        btn.dataset.upgradeId = u.id;
        btn.dataset.upgradeName = u.name;
        if (
            player.currentLevelUpgradeName === u.name ||
            player.currentLevelUpgradeName === u.id
        ) {
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
                if (u.oneShot && player.takenOneShots)
                    player.takenOneShots.add(u.id);
                player.currentLevelUpgradeName = u.name;

                panel.querySelectorAll('.upgrade-btn').forEach((b) => {
                    b.classList.remove('selected-upgrade');
                });
                btn.classList.add('selected-upgrade');

                if (
                    GAME_STATE.gameMode === 'online' &&
                    typeof netManager !== 'undefined' &&
                    netManager.isClient
                ) {
                    netManager.sendUpgradeSelection(u.id);
                } else if (
                    GAME_STATE.gameMode === 'online' &&
                    typeof netManager !== 'undefined' &&
                    netManager.isHost
                ) {
                    netManager.broadcast({
                        type: 'UPGRADE_CHOSEN_SYNC',
                        playerIndex: player.index,
                        upgradeId: u.id,
                        upgradeName: u.name,
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
    if (
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager?.isClient
    ) {
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
    panel.querySelectorAll('.upgrade-btn').forEach((b) => {
        b.disabled = true;
        if (
            player.currentLevelUpgradeName &&
            (b.dataset.upgradeName === player.currentLevelUpgradeName ||
                b.dataset.upgradeId === player.currentLevelUpgradeName)
        ) {
            b.classList.add('selected-upgrade');
        }
    });
    const tag = document.createElement('div');
    tag.className = 'panel-done';
    tag.textContent = '✓ Ready — Waiting for other players...';
    tag.style.color = player.color;
    panel.appendChild(tag);

    // In online multiplayer, Host is the authoritative coordinator for level-up completion and countdowns
    if (
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager?.isClient
    ) {
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

    for (const pl of GAME_STATE.players || []) {
        if (pl) {
            pl.currentUpgradeOptions = null;
            pl._virtualPickDone = false;
        }
    }
    const layer = document.getElementById('levelUpLayer');
    if (layer) layer.classList.remove('show');
    GAME_STATE.pendingLevels--;
    if (GAME_STATE.pendingLevels > 0) {
        for (const pl of GAME_STATE.players || []) {
            if (pl) pl.currentLevelUpgradeName = null;
        }
        if (typeof SoundEngine !== 'undefined' && SoundEngine.levelUp) {
            SoundEngine.levelUp();
        }
        if (
            GAME_STATE.gameMode === 'online' &&
            typeof netManager !== 'undefined' &&
            netManager.isHost
        ) {
            for (const pl of GAME_STATE.players) {
                if (
                    pl &&
                    !pl.disconnected &&
                    !pl.kicked &&
                    typeof pickThreeFor === 'function'
                ) {
                    pl.currentUpgradeOptions = pickThreeFor(pl);
                }
            }
            const upgradesMap = {};
            for (const pl of GAME_STATE.players) {
                if (pl?.currentUpgradeOptions) {
                    upgradesMap[pl.index] = pl.currentUpgradeOptions.map(
                        (u) => u.id,
                    );
                }
            }
            netManager.broadcast({
                type: 'LEVEL_UP_START',
                pendingLevels: GAME_STATE.pendingLevels,
                upgradesMap: upgradesMap,
            });
        }
        beginSelectionRound();
    } else {
        if (
            GAME_STATE.gameMode === 'online' &&
            typeof netManager !== 'undefined' &&
            netManager.isHost
        ) {
            netManager.broadcast({
                type: 'START_GAME_COUNTDOWN',
                isNewGame: false,
            });
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
    const hostOverlay = document.getElementById('hostPauseOverlay');
    if (hostOverlay) hostOverlay.style.display = 'none';
    const howToPlayBanner = document.getElementById('howToPlayBanner');
    if (howToPlayBanner) howToPlayBanner.style.display = 'none';
    const fullscreenLobbyBtn = document.getElementById('fullscreenLobbyBtn');
    if (fullscreenLobbyBtn) fullscreenLobbyBtn.classList.remove('is-visible');
    const lobbyActionStack = document.getElementById('lobbyActionStack');
    if (lobbyActionStack) lobbyActionStack.classList.remove('is-visible');
    closeHowToPlayModal();
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
        el.textContent = String(n);
        el.style.display = 'block';
    }

    const pauseBtn = document.getElementById('pauseMenuBtn');
    if (pauseBtn) pauseBtn.style.display = 'flex';
    updatePauseMenuButtonIcon(false);

    const isMobileDevice =
        typeof isMobile !== 'undefined'
            ? isMobile
            : (typeof window !== 'undefined' && window.isMobile) || false;
    const zone =
        document.getElementById('joystickZone') ||
        (typeof joystickZone !== 'undefined'
            ? joystickZone
            : typeof window !== 'undefined'
              ? window.joystickZone
              : null);
    if (isMobileDevice && zone) {
        zone.style.display = 'block';
    }

    const TICK_MS = 600;
    const tick = () => {
        n--;
        if (n >= 1) {
            if (el) el.textContent = String(n);
            if (typeof GAME_STATE !== 'undefined') {
                GAME_STATE.countdownTimer = setTimeout(tick, TICK_MS);
            }
        } else {
            if (el) el.style.display = 'none';
            if (typeof GAME_STATE !== 'undefined') {
                GAME_STATE.countdownTimer = null;
                GAME_STATE.current = STATES.GAMEPLAY;
                for (const pl of GAME_STATE.players || []) {
                    if (pl) pl.currentLevelUpgradeName = null;
                }
                if (typeof SoundEngine !== 'undefined') {
                    if (
                        isNewGame ||
                        SoundEngine.musicMode !== 'gameplay' ||
                        !SoundEngine.isMusicPlaying
                    ) {
                        const startElapsed =
                            GAME_STATE.testingMode && GAME_STATE.elapsed
                                ? GAME_STATE.elapsed
                                : 0;
                        SoundEngine.startMusic(true, startElapsed);
                    }
                    SoundEngine.setMuffled(false, 0.1);
                }
                if (typeof lastFrameTime !== 'undefined') {
                    lastFrameTime = performance.now();
                }
                if (GAME_STATE.players?.some((p) => p?.campervanSoundPending)) {
                    const isOnlineClient =
                        GAME_STATE.gameMode === 'online' &&
                        typeof netManager !== 'undefined' &&
                        netManager?.isClient;
                    // Host plays (and broadcasts); clients hear via netSoundEvents
                    if (
                        !isOnlineClient &&
                        typeof SoundEngine !== 'undefined' &&
                        SoundEngine.campervan
                    ) {
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
    'First time playing? Choosing Magic Missile as starting weapon is a good way to keep it simple.',
    "It's usually a good idea to stick to one weapon type early in the game. Transition to multiple weapons later to unlock more powerful upgrades.",
    'All turret upgrades are better the more turrets you can manage to have.',
    'You will eventually need defensive upgrades. Select them while the number of enemies is manageable.',
    'Melee Sweep requires a good amount of control to maneuver well, but allows you to become very tanky early on.',
    'Want something different? Choose Melee Sweep and try maximizing the damage you take early on, and take the Second Wind upgrade as often as you can.',
    'Want something different? Choose Proximity Mine and pick the Volatile Powder upgrade early to unlock Martyrdom, then wipe the board by dying all the time. Only works in multiplayer.',
    'The Fire Ring upgrade is a solid upgrade that can get you back into the game in rough times.',
    "Players can't damage each other, and enemies won't damage each other either.",
    'The quickest way to die is to run into the horde of enemies behind you.',
    'Cryo Freeze will save your ass from enemies that are faster than you.',
    'Enemies always pursue the closest player unless something else says otherwise.',
    'Getting some AoE damage will keep you in the game when the masses of enemies become too large to kill one by one.',
    'Upgrades are chosen at random from all upgrades available to you. Unlocking more upgrades decreases your chances of getting that one specific upgrade you want.',
    'The Scourge Flail is the only weapon-like upgrade that is not affected by the Hyper-drive attack speed increase.',
    'Surviving the Horde Boss wave fully restores your HP and permanently increases your maximum HP.',
    'Life regeneration is scarce. All weapons have a late stage upgrade unlocking life regen.',
    'Hit the question mark beside an upgrade to see how it works and what it unlocks. Some upgrades have caveats that are important to know.',
    'All weapons are fired automatically on an even interval, and all upgrades are applied automatically.',
    'Phase dash is the only upgrade that requires a key press to activate.',
    'When a player dies in multiplayer, they respawn after 20 seconds unless all players die during those 20 seconds - then the game is over.',
    'Cryo Freeze will freeze enemies in place early on, but later on it will only slow them down.',
    'All players level up together in multiplayer, but select upgrades individually.',
    'XP needs to be collected from the ground after killing blobs in order to level up.',
    'The game progression is based on time, not player level.',
    'Explosives and the melee Sledge Hammer and Flail can destroy burrowed enemies.',
    'Harder difficulties also give you less time to dodge enemy projectiles, dashes, and other hazards.',
    "Invisible enemies can still be damaged, but your weapons won't shoot at them.",
    'Normal projectiles cannot shoot through walls or shields. The the seeking rocket is an exception to this, as well as any large enough explosions.',
    'Want something different? Try maxing sticking to movement speed upgrades and phase dash upgrades only.',
    'Becoming overwhelmed by enemies when using Magic Missile or Turrets? AOE damage is the only way to catch up. Try Buckshot volley or hybrid upgrades from the Melee or Explosives weapons.',
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
    const isMobileDevice =
        typeof isMobile !== 'undefined'
            ? isMobile
            : (typeof window !== 'undefined' && window.isMobile) || false;
    if (isMobileDevice) return;

    const layer = document.getElementById('levelUpLayer');
    if (!layer) return;

    const panels = Array.from(layer.querySelectorAll('.player-panel')).filter(
        (p) => p.offsetParent !== null,
    );
    if (panels.length === 0) {
        tipEl.style.maxWidth = 'min(44vw, 480px)';
        return;
    }

    if (panels.length === 1) {
        tipEl.style.maxWidth = 'min(44vw, 480px)';
        const panelRect = panels[0].getBoundingClientRect();
        const tipRect = tipEl.getBoundingClientRect();
        if (panelRect.top < tipRect.bottom + 10) {
            tipEl.style.top =
                Math.max(8, panelRect.top - tipRect.height - 10) + 'px';
        } else {
            tipEl.style.top =
                'calc(max(16px, env(safe-area-inset-top, 16px)) + 52px)';
        }
        return;
    }

    // Multi-panel layout (2+ players on PC)
    const midX = window.innerWidth / 2;
    const leftPanels = panels.filter((p) => {
        const r = p.getBoundingClientRect();
        return r.left + r.width / 2 < midX;
    });
    const rightPanels = panels.filter((p) => {
        const r = p.getBoundingClientRect();
        return r.left + r.width / 2 >= midX;
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
    const tipEl = document.getElementById('tipText');
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
    const zone =
        document.getElementById('joystickZone') ||
        (typeof joystickZone !== 'undefined'
            ? joystickZone
            : typeof window !== 'undefined'
              ? window.joystickZone
              : null);
    if (zone) zone.style.display = 'none';
    const pauseBtn0 = document.getElementById('pauseMenuBtn');
    if (pauseBtn0) pauseBtn0.style.display = 'none';

    if (
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager.isHost
    ) {
        netManager.broadcast({ type: 'GAME_OVER' });
    }

    if (!GAME_STATE.testingMode) {
        saveGameScore();
    }

    const m = document.getElementById('gameOverModal');
    const s = document.getElementById('gameOverStats');
    const playerCount =
        (GAME_STATE.players || []).filter((p) => p && !p.disconnected).length ||
        1;
    const bestScore = getBestScore(
        playerCount,
        GAME_STATE.difficulty ? GAME_STATE.difficulty.name : 'normal',
    );

    if (s) s.innerHTML = buildStatsHTML('Survived', GAME_STATE, bestScore);
    if (m) m.classList.add('show');
    // GAME_OVER loop skips updateUI; refresh HUD so last deaths aren't stuck mid-HP
    if (typeof updateUI === 'function') updateUI();
}

function showVictory() {
    if (typeof GAME_STATE === 'undefined') return;
    GAME_STATE.current = STATES.GAME_OVER;
    if (typeof SoundEngine !== 'undefined' && SoundEngine.triggerVictoryRamp) {
        SoundEngine.triggerVictoryRamp(3.0);
    }
    const zone =
        document.getElementById('joystickZone') ||
        (typeof joystickZone !== 'undefined'
            ? joystickZone
            : typeof window !== 'undefined'
              ? window.joystickZone
              : null);
    if (zone) zone.style.display = 'none';
    const pauseBtn1 = document.getElementById('pauseMenuBtn');
    if (pauseBtn1) pauseBtn1.style.display = 'none';

    if (
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager.isHost
    ) {
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
    const playerCount =
        (GAME_STATE.players || []).filter((p) => p && !p.disconnected).length ||
        1;
    const bestScore = getBestScore(
        playerCount,
        GAME_STATE.difficulty ? GAME_STATE.difficulty.name : 'normal',
    );

    if (s) s.innerHTML = buildStatsHTML('Completed', GAME_STATE, bestScore);
    if (m) m.classList.add('show');
    if (typeof updateUI === 'function') updateUI();
}

function formatTime(ms) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function buildStatsHTML(timeLabel, state, bestScore) {
    const playerCount = state.players?.filter
        ? state.players.filter((p) => p && !p.disconnected).length
        : state.players?.length || 1;
    let html =
        `${timeLabel}: ${formatTime(state.elapsed)}<br>` +
        `Level: ${state.level}<br>` +
        `Kills: ${state.kills}<br>` +
        `Players: ${playerCount}<br>` +
        `Difficulty: ${state.difficulty ? state.difficulty.name : 'Normal'}`;

    if (bestScore) {
        html +=
            `<br><br><b>Personal Best:</b><br>` +
            `Best Time: ${formatTime(bestScore.time)}<br>` +
            `Best Level: ${bestScore.level}<br>` +
            `Best Kills: ${bestScore.kills}`;
    }
    return html;
}

function saveGameScore() {
    if (typeof GAME_STATE === 'undefined') return;
    const playerCount =
        (GAME_STATE.players || []).filter((p) => p && !p.disconnected).length ||
        1;
    const score = {
        time: GAME_STATE.elapsed,
        level: GAME_STATE.level,
        kills: GAME_STATE.kills,
        players: playerCount,
        difficulty: GAME_STATE.difficulty
            ? GAME_STATE.difficulty.name
            : 'Normal',
        date: Date.now(),
    };

    try {
        if (typeof localStorage !== 'undefined') {
            const existingScores =
                JSON.parse(localStorage.getItem('game_scores')) || [];
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

        const matchingScores = scores.filter((current) => {
            if (numberOfPlayers !== null && current.players !== numberOfPlayers)
                return false;
            if (difficulty !== null && current.difficulty !== difficulty)
                return false;
            return true;
        });

        if (matchingScores.length === 0) return null;

        return matchingScores.reduce((best, current) => {
            return current.kills > best.kills ? current : best;
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
    const cleanCode = NetworkManager.normalizeRoomCode(code);
    if (!cleanCode) {
        if (statusEl)
            statusEl.textContent =
                'Please enter a valid 4-character room code (e.g. 4821)';
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
        const errMsg =
            err && err.type === 'peer-unavailable'
                ? 'Room not found. Make sure the Host is in the lobby.'
                : err.message || 'Room not found';
        if (statusEl) statusEl.textContent = `Could not connect: ${errMsg}`;
    }
}

function showStartStep(step) {
    const setDisplay = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.style.display = val;
    };
    setDisplay('modeStep', step === 'mode' ? 'block' : 'none');
    setDisplay('onlineChoiceStep', step === 'onlineChoice' ? 'block' : 'none');
    setDisplay('joinRoomStep', step === 'joinRoom' ? 'block' : 'none');
    setDisplay('playerStep', step === 'players' ? 'block' : 'none');
    setDisplay('difficultyStep', step === 'difficulty' ? 'block' : 'none');

    const tBtn = document.getElementById('testingBtn');
    if (tBtn) {
        tBtn.style.display =
            typeof window !== 'undefined' &&
            window.ENABLE_TESTING_LAB &&
            step === 'mode'
                ? 'block'
                : 'none';
    }
    const rBtn = document.getElementById('relayToggleBtn');
    if (rBtn) {
        rBtn.style.display =
            typeof window !== 'undefined' &&
            window.ENABLE_TESTING_LAB &&
            step === 'mode'
                ? 'block'
                : 'none';
    }

    const btnLocal = document.getElementById('btnModeLocal');
    if (btnLocal)
        btnLocal.style.display =
            typeof isMobile !== 'undefined' && isMobile ? 'none' : 'block';
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
    if (
        typeof ctx !== 'undefined' &&
        ctx &&
        typeof canvas !== 'undefined' &&
        canvas
    ) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (
        typeof draw === 'function' &&
        typeof W !== 'undefined' &&
        typeof H !== 'undefined'
    ) {
        draw(0);
    }

    if (typeof SoundEngine !== 'undefined') {
        if (SoundEngine.setMuffled) SoundEngine.setMuffled(false);
        if (SoundEngine.startMenuMusic) SoundEngine.startMenuMusic();
    }
    const tBtn = document.getElementById('testingBtn');
    if (tBtn)
        tBtn.style.display =
            typeof window !== 'undefined' && window.ENABLE_TESTING_LAB
                ? 'block'
                : 'none';
    const rBtn = document.getElementById('relayToggleBtn');
    if (rBtn)
        rBtn.style.display =
            typeof window !== 'undefined' && window.ENABLE_TESTING_LAB
                ? 'block'
                : 'none';

    const pauseBtn2 = document.getElementById('pauseMenuBtn');
    if (pauseBtn2) pauseBtn2.style.display = 'none';
    updatePauseMenuButtonIcon(false);

    const hideModal = (id) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('show');
    };
    hideModal('gameOverModal');
    hideModal('victoryModal');
    hideModal('pauseModal');

    const hostOverlay = document.getElementById('hostPauseOverlay');
    if (hostOverlay) hostOverlay.style.display = 'none';

    const resumeBtn = document.getElementById('resumeBtn');
    if (resumeBtn) resumeBtn.style.display = 'block';
    const pauseQuitBtn = document.getElementById('pauseQuitBtn');
    if (pauseQuitBtn) {
        const nameSpan = pauseQuitBtn.querySelector('.name');
        if (nameSpan) nameSpan.textContent = 'MAIN MENU';
    }

    const zone =
        document.getElementById('joystickZone') ||
        (typeof joystickZone !== 'undefined'
            ? joystickZone
            : typeof window !== 'undefined'
              ? window.joystickZone
              : null);
    if (zone) zone.style.display = 'none';
    const tipEl = document.getElementById('tipText');
    if (tipEl) tipEl.style.display = 'none';
    stopTipRotation();
    const uiLayer = document.querySelector('.ui-layer');
    if (uiLayer) uiLayer.style.display = 'none';
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.style.display = 'none';

    const inviteBanner = document.getElementById('inviteCodeBanner');
    if (inviteBanner) inviteBanner.style.display = 'none';
    const howToPlayBanner = document.getElementById('howToPlayBanner');
    if (howToPlayBanner) howToPlayBanner.style.display = 'none';
    const fullscreenLobbyBtn = document.getElementById('fullscreenLobbyBtn');
    if (fullscreenLobbyBtn) fullscreenLobbyBtn.classList.remove('is-visible');
    const lobbyActionStack = document.getElementById('lobbyActionStack');
    if (lobbyActionStack) lobbyActionStack.classList.remove('is-visible');
    closeHowToPlayModal();
    const rotateHint = document.getElementById('rotateHint');
    if (rotateHint) rotateHint.style.display = 'none';
    if (typeof window !== 'undefined') window._rotateHintDismissed = false;
    const lobbyStartBtn = document.getElementById('lobbyStartBtn');
    if (lobbyStartBtn) lobbyStartBtn.style.display = 'none';

    showStartStep('mode');
    const startMenu = document.getElementById('startMenu');
    if (startMenu) startMenu.classList.add('show');
    updateFullscreenButtons();
}

function updateFpsToggleBtn() {
    const btn = document.getElementById('fpsToggleBtn');
    const label = document.getElementById('fpsToggleBtnLabel');
    if (!btn || typeof GAME_STATE === 'undefined') return;
    const isVisible = Boolean(GAME_STATE.showFps);
    if (label) {
        label.textContent = `FPS & Stats: ${isVisible ? 'ON' : 'OFF'}`;
    }
    if (isVisible) {
        btn.classList.remove('disabled-state');
    } else {
        btn.classList.add('disabled-state');
    }
}

// ---------------- Full screen (native API + iOS video fullscreen) ----------------
// Desktop/Android: Element.requestFullscreen().
// iPhone: WebKit blocks element fullscreen. YouTube-style FS uses
// HTMLVideoElement.webkitEnterFullscreen() with a canvas.captureStream() feed.
// Immersive scroll is only a last-resort fallback if video FS is unavailable.

/** @type {boolean} */
let immersiveFullscreenActive = false;
/** @type {ReturnType<typeof setTimeout>|null} */
let immersiveFsLockTimer = null;
/** @type {boolean} */
let immersiveFsListenersBound = false;
/** @type {HTMLVideoElement|null} */
let iosFsVideo = null;
/** @type {MediaStream|null} */
let iosFsStream = null;
/** @type {boolean} */
let iosVideoFsActive = false;

function getFullscreenElement() {
    if (typeof document === 'undefined') return null;
    return (
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement ||
        null
    );
}

function isNativeFullscreenActive() {
    if (typeof document === 'undefined') return false;
    return Boolean(getFullscreenElement() || document.webkitIsFullScreen);
}

/** Installed home-screen / PWA only — NOT browser fullscreen display-mode. */
function isStandaloneDisplayMode() {
    try {
        const nav = /** @type {Navigator & { standalone?: boolean }} */ (
            typeof window !== 'undefined' ? window.navigator : null
        );
        if (nav?.standalone) return true;
        if (
            typeof window !== 'undefined' &&
            window.matchMedia &&
            window.matchMedia('(display-mode: standalone)').matches
        ) {
            return true;
        }
    } catch {
        // ignore
    }
    return false;
}

/** iPhone/iPod (and iPad pretending to be Mac). Native FS is unusable here. */
function isIosLikeBrowser() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPhone|iPod/i.test(ua)) return true;
    // iPadOS 13+ desktop UA
    if (
        navigator.platform === 'MacIntel' &&
        typeof navigator.maxTouchPoints === 'number' &&
        navigator.maxTouchPoints > 1
    ) {
        return true;
    }
    return /iPad/i.test(ua);
}

function isIosVideoFullscreenActive() {
    if (iosVideoFsActive) return true;
    const v = iosFsVideo;
    if (v && /** @type {any} */ (v).webkitDisplayingFullscreen) return true;
    return false;
}

function isFullscreenActive() {
    if (typeof document === 'undefined') return false;
    if (isNativeFullscreenActive()) return true;
    if (isIosVideoFullscreenActive()) return true;
    if (immersiveFullscreenActive) return true;
    return isStandaloneDisplayMode();
}

function canUseIosVideoFullscreen() {
    if (!isIosLikeBrowser() || typeof document === 'undefined') return false;
    const canvas = /** @type {HTMLCanvasElement|null} */ (
        document.getElementById('gameCanvas')
    );
    if (!canvas || typeof canvas.captureStream !== 'function') return false;
    const probe = document.createElement('video');
    const anyProbe = /** @type {any} */ (probe);
    return (
        typeof anyProbe.webkitEnterFullscreen === 'function' ||
        typeof anyProbe.webkitEnterFullScreen === 'function' ||
        typeof probe.requestFullscreen === 'function'
    );
}

function teardownIosFsStream() {
    if (iosFsStream) {
        for (const track of iosFsStream.getTracks()) {
            try {
                track.stop();
            } catch {
                // ignore
            }
        }
        iosFsStream = null;
    }
    if (iosFsVideo) {
        try {
            iosFsVideo.pause();
        } catch {
            // ignore
        }
        iosFsVideo.removeAttribute('src');
        iosFsVideo.srcObject = null;
        try {
            iosFsVideo.load();
        } catch {
            // ignore
        }
    }
}

function ensureIosFsVideo() {
    if (typeof document === 'undefined') return null;
    if (iosFsVideo) return iosFsVideo;
    const video = document.createElement('video');
    video.id = 'iosFsVideo';
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    // Keep in DOM but invisible until native video fullscreen takes over.
    video.style.cssText =
        'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
    document.body.appendChild(video);

    const onBegin = () => {
        iosVideoFsActive = true;
        updateFullscreenButtons();
        if (typeof resizeCanvas === 'function') resizeCanvas();
    };
    const onEnd = () => {
        iosVideoFsActive = false;
        teardownIosFsStream();
        updateFullscreenButtons();
        if (typeof resizeCanvas === 'function') {
            setTimeout(() => resizeCanvas(), 80);
        }
    };
    video.addEventListener('webkitbeginfullscreen', onBegin);
    video.addEventListener('webkitendfullscreen', onEnd);
    video.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement === video) onBegin();
        else if (iosVideoFsActive) onEnd();
    });

    iosFsVideo = video;
    return video;
}

/**
 * YouTube-style iOS fullscreen: stream the game canvas into a <video> and call
 * webkitEnterFullscreen(). Must run directly from a user gesture (no awaits before).
 */
function enterIosVideoFullscreen() {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return false;
    }
    const canvas = /** @type {HTMLCanvasElement|null} */ (
        document.getElementById('gameCanvas')
    );
    if (!canvas || typeof canvas.captureStream !== 'function') return false;

    const video = ensureIosFsVideo();
    if (!video) return false;
    const anyVideo = /** @type {any} */ (video);

    teardownIosFsStream();
    try {
        iosFsStream = canvas.captureStream(60);
    } catch {
        try {
            iosFsStream = canvas.captureStream();
        } catch {
            return false;
        }
    }
    video.srcObject = iosFsStream;

    // Start playback; do not await — awaiting can drop the iOS user-gesture token
    // required by webkitEnterFullscreen.
    try {
        const playResult = video.play();
        if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(() => {});
        }
    } catch {
        // continue — some WebKit builds still allow enterFullscreen
    }

    try {
        if (typeof anyVideo.webkitEnterFullscreen === 'function') {
            anyVideo.webkitEnterFullscreen();
        } else if (typeof anyVideo.webkitEnterFullScreen === 'function') {
            anyVideo.webkitEnterFullScreen();
        } else if (typeof video.requestFullscreen === 'function') {
            video.requestFullscreen();
        } else {
            teardownIosFsStream();
            return false;
        }
    } catch {
        teardownIosFsStream();
        return false;
    }

    iosVideoFsActive = true;
    updateFullscreenButtons();
    return true;
}

function exitIosVideoFullscreen() {
    const video = iosFsVideo;
    if (!video) {
        iosVideoFsActive = false;
        return false;
    }
    const anyVideo = /** @type {any} */ (video);
    try {
        if (typeof anyVideo.webkitExitFullscreen === 'function') {
            anyVideo.webkitExitFullscreen();
        } else if (typeof anyVideo.webkitExitFullScreen === 'function') {
            anyVideo.webkitExitFullScreen();
        } else if (
            document.fullscreenElement === video &&
            document.exitFullscreen
        ) {
            document.exitFullscreen();
        }
    } catch {
        // ignore
    }
    iosVideoFsActive = false;
    teardownIosFsStream();
    updateFullscreenButtons();
    return true;
}

function getFullscreenCandidates() {
    /** @type {Element[]} */
    const list = [];
    if (typeof document === 'undefined') return list;
    // Prefer the document element — canvas FS can leave UI controls unreachable.
    if (document.documentElement) list.push(document.documentElement);
    if (document.body) list.push(document.body);
    return list;
}

function elementSupportsFullscreenRequest(el) {
    if (!el) return false;
    return Boolean(
        el.requestFullscreen ||
            el.webkitRequestFullscreen ||
            el.webkitRequestFullScreen ||
            el.mozRequestFullScreen ||
            el.msRequestFullscreen,
    );
}

function canRequestNativeFullscreen() {
    if (isIosLikeBrowser()) return false;
    return getFullscreenCandidates().some(elementSupportsFullscreenRequest);
}

function updateFullscreenButtons() {
    if (typeof document === 'undefined') return;
    const active = isFullscreenActive();
    const label = active ? 'Exit Full screen' : 'Enter Full screen';

    for (const id of [
        'btnFullscreenMenu',
        'fullscreenLobbyBtn',
        'fullscreenPauseBtn',
    ]) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        const labelEl = btn.querySelector('.fullscreen-label');
        if (labelEl) labelEl.textContent = label;
        btn.classList.toggle('active-fullscreen', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.title = label;
        btn.setAttribute('aria-label', label);
    }
}

/**
 * @param {Element} el
 * @param {boolean} withNavHide
 */
async function requestFullscreenOnElement(el, withNavHide) {
    if (!el) return false;
    if (el.requestFullscreen) {
        if (withNavHide) {
            try {
                await el.requestFullscreen({ navigationUI: 'hide' });
                return true;
            } catch {
                await el.requestFullscreen();
                return true;
            }
        }
        await el.requestFullscreen();
        return true;
    }
    if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
        return true;
    }
    if (el.webkitRequestFullScreen) {
        el.webkitRequestFullScreen();
        return true;
    }
    if (el.mozRequestFullScreen) {
        el.mozRequestFullScreen();
        return true;
    }
    if (el.msRequestFullscreen) {
        el.msRequestFullscreen();
        return true;
    }
    return false;
}

async function tryNativeFullscreen() {
    const candidates = getFullscreenCandidates().filter(
        elementSupportsFullscreenRequest,
    );
    for (const el of candidates) {
        try {
            const ok = await requestFullscreenOnElement(el, true);
            if (ok) return true;
        } catch {
            try {
                const ok = await requestFullscreenOnElement(el, false);
                if (ok) return true;
            } catch {
                // try next candidate
            }
        }
    }
    return false;
}

async function exitNativeFullscreen() {
    if (typeof document === 'undefined') return false;
    if (!isNativeFullscreenActive()) return false;
    try {
        if (document.exitFullscreen) {
            await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.webkitCancelFullScreen) {
            document.webkitCancelFullScreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
        return true;
    } catch {
        return false;
    }
}

function ensureImmersiveSpacer() {
    if (typeof document === 'undefined') return null;
    let spacer = document.getElementById('immersiveFsSpacer');
    if (!spacer) {
        spacer = document.createElement('div');
        spacer.id = 'immersiveFsSpacer';
        spacer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(spacer);
    }
    return spacer;
}

function syncImmersiveViewportCss() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const vv = window.visualViewport;
    // Prefer the largest useful height so the canvas fills chrome-collapsed space.
    const layoutH =
        window.innerHeight || document.documentElement.clientHeight || 0;
    const vvH = vv ? vv.height : 0;
    const vvW = vv ? vv.width : 0;
    const w = Math.max(
        1,
        Math.round(vvW || window.innerWidth || document.documentElement.clientWidth || 1),
    );
    const h = Math.max(1, Math.round(Math.max(layoutH, vvH) || 1));
    const root = document.documentElement;
    root.style.setProperty('--app-width', `${w}px`);
    root.style.setProperty('--app-height', `${h}px`);
    root.style.setProperty('--app-vh', `${h * 0.01}px`);
    window._immersiveFullscreenActive = immersiveFullscreenActive;
}

function onImmersiveViewportChange() {
    if (!immersiveFullscreenActive) return;
    syncImmersiveViewportCss();
    if (typeof resizeCanvas === 'function') resizeCanvas();
    updateFullscreenButtons();
}

function bindImmersiveViewportListeners() {
    if (immersiveFsListenersBound || typeof window === 'undefined') return;
    immersiveFsListenersBound = true;
    const opts = { passive: true };
    window.addEventListener('resize', onImmersiveViewportChange, opts);
    window.addEventListener('orientationchange', onImmersiveViewportChange, opts);
    if (window.visualViewport) {
        window.visualViewport.addEventListener(
            'resize',
            onImmersiveViewportChange,
            opts,
        );
        window.visualViewport.addEventListener(
            'scroll',
            onImmersiveViewportChange,
            opts,
        );
    }
}

function collapseMobileBrowserChrome() {
    if (typeof window === 'undefined') return;
    try {
        // Non-zero scroll is what triggers iOS/Chrome URL-bar collapse.
        const vv = window.visualViewport;
        const delta = Math.max(
            24,
            Math.round(
                (window.innerHeight || 0) - (vv?.height || window.innerHeight || 0) + 24,
            ),
        );
        window.scrollTo(0, 0);
        window.scrollTo(0, delta);
        document.documentElement.scrollTop = delta;
        document.body.scrollTop = delta;
    } catch {
        // ignore
    }
}

function enterImmersiveFullscreen() {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return false;
    }
    if (isStandaloneDisplayMode()) {
        immersiveFullscreenActive = true;
        window._immersiveFullscreenActive = true;
        syncImmersiveViewportCss();
        updateFullscreenButtons();
        if (typeof resizeCanvas === 'function') resizeCanvas();
        return true;
    }

    immersiveFullscreenActive = true;
    window._immersiveFullscreenActive = true;
    bindImmersiveViewportListeners();
    ensureImmersiveSpacer();

    const root = document.documentElement;
    root.classList.remove('immersive-fs');
    root.classList.add('immersive-fs-prep');

    // Collapse chrome while the document is still scrollable. Do NOT scroll back
    // to 0 afterward — that restores the iOS address bar.
    collapseMobileBrowserChrome();
    requestAnimationFrame(() => {
        collapseMobileBrowserChrome();
        syncImmersiveViewportCss();
        if (typeof resizeCanvas === 'function') resizeCanvas();
    });

    if (immersiveFsLockTimer) clearTimeout(immersiveFsLockTimer);
    let passes = 0;
    const finishLock = () => {
        if (!immersiveFullscreenActive) return;
        passes += 1;
        collapseMobileBrowserChrome();
        syncImmersiveViewportCss();
        if (typeof resizeCanvas === 'function') resizeCanvas();
        updateFullscreenButtons();

        if (passes < 4) {
            immersiveFsLockTimer = window.setTimeout(finishLock, 100);
            return;
        }
        immersiveFsLockTimer = null;
        // Keep a tiny scroll offset while locking overflow so chrome stays down.
        root.classList.remove('immersive-fs-prep');
        root.classList.add('immersive-fs');
        syncImmersiveViewportCss();
        if (typeof resizeCanvas === 'function') resizeCanvas();
        updateFullscreenButtons();
    };
    immersiveFsLockTimer = window.setTimeout(finishLock, 50);

    syncImmersiveViewportCss();
    updateFullscreenButtons();
    if (typeof resizeCanvas === 'function') resizeCanvas();
    return true;
}

function exitImmersiveFullscreen() {
    if (typeof document === 'undefined') return false;
    immersiveFullscreenActive = false;
    if (typeof window !== 'undefined') {
        window._immersiveFullscreenActive = false;
    }
    if (immersiveFsLockTimer) {
        clearTimeout(immersiveFsLockTimer);
        immersiveFsLockTimer = null;
    }
    const root = document.documentElement;
    root.classList.remove('immersive-fs-prep', 'immersive-fs');
    root.style.removeProperty('--app-width');
    root.style.removeProperty('--app-height');
    root.style.removeProperty('--app-vh');
    const spacer = document.getElementById('immersiveFsSpacer');
    if (spacer) spacer.remove();
    try {
        window.scrollTo(0, 0);
    } catch {
        // ignore
    }
    updateFullscreenButtons();
    if (typeof resizeCanvas === 'function') {
        setTimeout(() => resizeCanvas(), 80);
    }
    return true;
}

async function enterFullscreen() {
    if (typeof document === 'undefined') return false;
    if (isStandaloneDisplayMode()) {
        immersiveFullscreenActive = true;
        if (typeof window !== 'undefined') {
            window._immersiveFullscreenActive = true;
        }
        updateFullscreenButtons();
        return true;
    }
    // iPhone: YouTube-style video fullscreen (only real system FS on iOS).
    // Must stay synchronous with the tap — handled in toggleFullscreen.
    if (isIosLikeBrowser()) {
        if (canUseIosVideoFullscreen() && enterIosVideoFullscreen()) {
            return true;
        }
        return enterImmersiveFullscreen();
    }
    if (canRequestNativeFullscreen()) {
        const ok = await tryNativeFullscreen();
        if (ok) {
            await new Promise((r) => setTimeout(r, 50));
            if (isNativeFullscreenActive()) {
                updateFullscreenButtons();
                return true;
            }
        }
    }
    return enterImmersiveFullscreen();
}

async function exitFullscreen() {
    if (typeof document === 'undefined') return false;
    if (isIosVideoFullscreenActive()) {
        exitIosVideoFullscreen();
    }
    if (isNativeFullscreenActive()) {
        await exitNativeFullscreen();
    }
    if (immersiveFullscreenActive) {
        exitImmersiveFullscreen();
    }
    updateFullscreenButtons();
    return true;
}

async function toggleFullscreen() {
    if (
        isNativeFullscreenActive() ||
        isIosVideoFullscreenActive() ||
        immersiveFullscreenActive
    ) {
        await exitFullscreen();
        updateFullscreenButtons();
        if (typeof resizeCanvas === 'function') {
            setTimeout(() => resizeCanvas(), 80);
        }
        return;
    }
    if (isStandaloneDisplayMode()) {
        updateFullscreenButtons();
        return;
    }

    // iOS: call video.webkitEnterFullscreen in this same turn as the tap.
    // Any await before it drops the user-gesture and FS silently fails.
    if (isIosLikeBrowser()) {
        if (canUseIosVideoFullscreen() && enterIosVideoFullscreen()) {
            updateFullscreenButtons();
            return;
        }
        enterImmersiveFullscreen();
        updateFullscreenButtons();
        if (typeof resizeCanvas === 'function') {
            setTimeout(() => resizeCanvas(), 80);
        }
        return;
    }

    await enterFullscreen();
    updateFullscreenButtons();
    if (typeof resizeCanvas === 'function') {
        setTimeout(() => resizeCanvas(), 80);
    }
}

function initFullscreenControls() {
    if (typeof document === 'undefined') return;

    if (typeof window !== 'undefined') {
        window._immersiveFullscreenActive = false;
    }

    const onFsChange = () => {
        updateFullscreenButtons();
        if (typeof resizeCanvas === 'function') {
            setTimeout(() => resizeCanvas(), 80);
        }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('mozfullscreenchange', onFsChange);
    document.addEventListener('MSFullscreenChange', onFsChange);

    /** @type {number} */
    let lastFsToggleAt = 0;
    const bindToggle = (id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const handler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Debounce: iOS can synthesize click after touchend.
            const now = Date.now();
            if (now - lastFsToggleAt < 350) return;
            lastFsToggleAt = now;
            toggleFullscreen();
        };
        btn.addEventListener('click', handler);
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    };
    bindToggle('btnFullscreenMenu');
    bindToggle('fullscreenLobbyBtn');
    bindToggle('fullscreenPauseBtn');

    updateFullscreenButtons();
}

const PAUSE_MENU_ICON_PAUSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>';
const PAUSE_MENU_ICON_PLAY =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>';

function updatePauseMenuButtonIcon(forcePlay = null) {
    const btn = document.getElementById('pauseMenuBtn');
    if (!btn) return;
    let showPlay = forcePlay;
    if (showPlay === null) {
        const modal = document.getElementById('pauseModal');
        const menuOpen = Boolean(modal?.classList.contains('show'));
        const paused =
            typeof GAME_STATE !== 'undefined' &&
            GAME_STATE.current === STATES.PAUSED;
        showPlay = menuOpen || paused;
    }
    btn.innerHTML = showPlay ? PAUSE_MENU_ICON_PLAY : PAUSE_MENU_ICON_PAUSE;
    btn.title = showPlay ? 'Resume (Esc)' : 'Pause (Esc)';
    btn.setAttribute('aria-label', showPlay ? 'Resume' : 'Pause');
}

function togglePause() {
    if (typeof GAME_STATE === 'undefined') return;

    const isOnlineClient =
        GAME_STATE.gameMode === 'online' &&
        typeof netManager !== 'undefined' &&
        netManager?.isClient;

    if (isOnlineClient) {
        // Clients cannot pause the game simulation.
        // Instead, the Esc menu toggles without modifying GAME_STATE.current,
        // letting gameplay continue in real-time.
        const modal = document.getElementById('pauseModal');
        if (!modal) return;
        if (modal.classList.contains('show')) {
            modal.classList.remove('show');
            const isMobileDevice =
                typeof isMobile !== 'undefined'
                    ? isMobile
                    : (typeof window !== 'undefined' && window.isMobile) || false;
            const zone =
                document.getElementById('joystickZone') ||
                (typeof joystickZone !== 'undefined'
                    ? joystickZone
                    : typeof window !== 'undefined'
                      ? window.joystickZone
                      : null);
            if (isMobileDevice && zone) zone.style.display = 'block';
            updatePauseMenuButtonIcon(false);
        } else {
            // Configure Esc menu for client:
            // 1. Resume button should not exist
            const resumeBtn = document.getElementById('resumeBtn');
            if (resumeBtn) resumeBtn.style.display = 'none';

            // 2. Main Menu replaced with Leave Game
            const pauseQuitBtn = document.getElementById('pauseQuitBtn');
            if (pauseQuitBtn) {
                const nameSpan = pauseQuitBtn.querySelector('.name');
                if (nameSpan) nameSpan.textContent = 'LEAVE GAME';
            }

            // 3. Update title/subtext
            const title = modal.querySelector('h2');
            if (title) title.textContent = 'GAME MENU';
            const sub = modal.querySelector('p');
            if (sub) {
                sub.innerHTML =
                    'Game is running in real-time.<br>Press <b style="color: #fff;">Escape</b> to close';
            }

            updateFpsToggleBtn();
            const zone =
                document.getElementById('joystickZone') ||
                (typeof joystickZone !== 'undefined'
                    ? joystickZone
                    : typeof window !== 'undefined'
                      ? window.joystickZone
                      : null);
            if (zone) zone.style.display = 'none';

            modal.classList.add('show');
            updatePauseMenuButtonIcon(true);
        }
        return;
    }

    // Host or Local/Single-player:
    if (GAME_STATE.current === STATES.GAMEPLAY) {
        GAME_STATE.current = STATES.PAUSED;
        if (typeof SoundEngine !== 'undefined' && SoundEngine.setMuffled) {
            SoundEngine.setMuffled(true, 0.5);
        }
        const zone =
            document.getElementById('joystickZone') ||
            (typeof joystickZone !== 'undefined'
                ? joystickZone
                : typeof window !== 'undefined'
                  ? window.joystickZone
                  : null);
        if (zone) zone.style.display = 'none';
        updateFpsToggleBtn();

        const modal = document.getElementById('pauseModal');
        if (modal) {
            const resumeBtn = document.getElementById('resumeBtn');
            if (resumeBtn) resumeBtn.style.display = 'block';

            const pauseQuitBtn = document.getElementById('pauseQuitBtn');
            if (pauseQuitBtn) {
                const nameSpan = pauseQuitBtn.querySelector('.name');
                if (nameSpan) nameSpan.textContent = 'MAIN MENU';
            }

            const title = modal.querySelector('h2');
            if (title) title.textContent = 'GAME PAUSED';
            const sub = modal.querySelector('p');
            if (sub) {
                sub.innerHTML =
                    'Press <b style="color: #fff;">Escape</b> or click below to resume';
            }

            modal.classList.add('show');
        }
        updatePauseMenuButtonIcon(true);

        // Host broadcasts pause event to clients
        if (
            GAME_STATE.gameMode === 'online' &&
            typeof netManager !== 'undefined' &&
            netManager?.isHost
        ) {
            netManager.broadcast({
                type: 'PAUSE_SYNC',
                paused: true,
            });
        }
    } else if (GAME_STATE.current === STATES.PAUSED) {
        const modal = document.getElementById('pauseModal');
        if (modal) modal.classList.remove('show');
        updatePauseMenuButtonIcon(false);

        // Host broadcasts countdown to clients so all resume simultaneously
        if (
            GAME_STATE.gameMode === 'online' &&
            typeof netManager !== 'undefined' &&
            netManager?.isHost
        ) {
            netManager.broadcast({
                type: 'PAUSE_SYNC',
                paused: false,
            });
            netManager.broadcast({
                type: 'START_GAME_COUNTDOWN',
                isNewGame: false,
            });
        }
        startCountdown(false);
    }
}

// ---------------- 6. HUD UI Update Loop ----------------

function updateUI() {
    if (typeof GAME_STATE === 'undefined') return;
    const xpBarEl = document.getElementById('xpBar');
    const xpLevelLabelEl = document.getElementById('xpLevelLabel');
    const statsEl = document.getElementById('stats');
    const timerEl = document.getElementById('timer');
    const fpsCounterEl = document.getElementById('fpsCounter');

    if (xpBarEl && GAME_STATE.nextXp) {
        xpBarEl.style.width = (GAME_STATE.xp / GAME_STATE.nextXp) * 100 + '%';
    }
    if (xpLevelLabelEl) {
        xpLevelLabelEl.textContent = `Level ${GAME_STATE.level || 1}`;
    }

    if (statsEl && GAME_STATE.players) {
        const playerRows = GAME_STATE.players
            .map((p, i) => {
                if (!p) return '';
                const pName = p.name || `P${i + 1}`;
                if (p.disconnected || p.kicked) {
                    return `<div style="margin-top:2px;"><span style="color:${p.color};opacity:0.65">${pName} (Disconnected)</span></div>`;
                }
                if (typeof p.isAlive === 'function' ? p.isAlive() : p.alive) {
                    const aliveName =
                        pName.length > 12 ? `${pName.slice(0, 10)}..` : pName;
                    return `<div style="margin-top:2px;"><span style="color:${p.color}">${aliveName} HP: ${Math.ceil(p.hp)}</span></div>`;
                }
                const reviveClock =
                    typeof GAME_STATE.elapsed === 'number'
                        ? GAME_STATE.elapsed
                        : typeof gameClock !== 'undefined'
                          ? gameClock
                          : performance.now();
                let rem = Math.max(
                    0,
                    Math.ceil(
                        ((typeof REVIVE_MS !== 'undefined'
                            ? REVIVE_MS
                            : 20000) *
                            (p.reviveTimeModifier || 1.0) -
                            (reviveClock - (p.deadAt || 0))) /
                            1000,
                    ),
                );
                if (
                    GAME_STATE.activeBoss &&
                    p.deadAt >= GAME_STATE.activeBossStartTime &&
                    typeof BOSS_CONFIGS !== 'undefined'
                ) {
                    const cfg = BOSS_CONFIGS[GAME_STATE.activeBoss];
                    if (cfg) {
                        const bossEnd = cfg.startMs + cfg.durationLimit;
                        rem = Math.max(
                            1,
                            Math.ceil((bossEnd - GAME_STATE.elapsed) / 1000),
                        );
                    }
                }
                const deadName =
                    pName.length > 12 ? `${pName.slice(0, 10)}..` : pName;
                return `<div style="margin-top:2px;"><span style="color:${p.color};opacity:0.55">${deadName} &#9760;${rem}s</span></div>`;
            })
            .join('');
        statsEl.innerHTML = playerRows;

        const curClock =
            typeof gameClock !== 'undefined' ? gameClock : performance.now();
        const anyPulsing = GAME_STATE.players.some(
            (p) => p?.hpPulseUntil && curClock < p.hpPulseUntil,
        );
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
        const isFpsVisible =
            GAME_STATE.showFps !== undefined
                ? GAME_STATE.showFps
                : Boolean(GAME_STATE.testingMode);
        if (
            isFpsVisible &&
            (GAME_STATE.current === STATES.GAMEPLAY ||
                GAME_STATE.current === STATES.PAUSED)
        ) {
            fpsCounterEl.style.display = 'block';
            const enemyCount = GAME_STATE.enemies
                ? GAME_STATE.enemies.length
                : 0;
            let text = `${GAME_STATE.currentFps || 60} FPS<br>Kills: ${GAME_STATE.kills || 0}<br>Enemies: ${enemyCount}`;

            if (
                typeof netManager !== 'undefined' &&
                netManager &&
                netManager.isOnline
            ) {
                if (netManager.isHost) {
                    const pings = [];
                    const maxOnline =
                        typeof MAX_ONLINE_PLAYERS === 'number'
                            ? MAX_ONLINE_PLAYERS
                            : 12;
                    for (let i = 1; i < maxOnline; i++) {
                        const peerId = netManager.playerPeerMap?.get(i);
                        if (peerId) {
                            const ping = netManager.playerPingMap?.get(i);
                            const pingStr =
                                ping !== undefined ? `${ping}ms` : '...';
                            const p = GAME_STATE.players?.[i];
                            const pName = p?.name
                                ? p.name.slice(0, 10)
                                : `P${i + 1}`;
                            pings.push(`${pName}: ${pingStr}`);
                        }
                    }
                    if (pings.length > 0) {
                        text += `<br>Ping: ${pings.join(' | ')}`;
                    } else {
                        text += '<br>Ping: Host (Solo)';
                    }
                } else if (netManager.isClient) {
                    const ping = netManager.currentPing;
                    const pingStr = ping !== null ? `${ping}ms` : '...';
                    text += `<br>Ping: ${pingStr}`;
                }
            }

            fpsCounterEl.innerHTML = text;
        } else {
            fpsCounterEl.style.display = 'none';
        }
    }
}

function getApproximateRunMinutes() {
    let lastBossStart = 0;
    if (typeof PROGRESSION !== 'undefined' && PROGRESSION?.bossEvents) {
        for (const b of PROGRESSION.bossEvents) {
            if (b?.start > lastBossStart) lastBossStart = b.start;
        }
    }
    if (lastBossStart <= 0) return 25;
    return Math.max(1, Math.round((lastBossStart + 60000) / 60000));
}

function openHowToPlayModal() {
    const winItem = document.getElementById('howToPlayWinItem');
    if (winItem) {
        const minutes = getApproximateRunMinutes();
        winItem.innerHTML = `<b style="color: #fff;">Win</b> — defeat the final boss. A full run is around ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
    const pauseItem = document.getElementById('howToPlayPauseItem');
    if (pauseItem) {
        const isOnlineClient =
            typeof GAME_STATE !== 'undefined' &&
            GAME_STATE.gameMode === 'online' &&
            typeof netManager !== 'undefined' &&
            netManager?.isClient;
        const hostOnly = isOnlineClient
            ? ' <span style="color: #aaa;">(host only)</span>'
            : '';
        pauseItem.innerHTML = `<b style="color: #fff;">Pause</b> — press <b style="color: #fff;">Esc</b> or the <span class="how-to-play-pause-btn" aria-hidden="true">${PAUSE_MENU_ICON_PAUSE}</span> button in the top right corner${hostOnly}.`;
    }
    const modal = document.getElementById('howToPlayModal');
    if (modal) modal.classList.add('show');
}

function closeHowToPlayModal() {
    const modal = document.getElementById('howToPlayModal');
    if (modal) modal.classList.remove('show');
}

// ---------------- 7. DOM Event Listeners & Buttons Initialization ----------------

function initUISystem() {
    if (typeof document === 'undefined') return;

    initFullscreenControls();

    // Dynamically adjust tip text width whenever window is resized
    window.addEventListener('resize', adjustTipTextLayout);

    // UI Click sound hook for all interactive buttons and upgrade options
    document.addEventListener('click', (e) => {
        if (
            e.target?.closest(
                'button, .upgrade-btn, .upgrade-node, .upgrade-node-btn, .upgrade-help-btn, .time-preset-btn, .difficulty-card',
            )
        ) {
            if (typeof SoundEngine !== 'undefined' && SoundEngine.uiClick) {
                SoundEngine.uiClick();
            }
        }
    });

    const bindHowToPlayOpen = (id) => {
        const btn = document.getElementById(id);
        if (btn) btn.onclick = () => openHowToPlayModal();
    };
    bindHowToPlayOpen('btnHowToPlayMenu');
    bindHowToPlayOpen('howToPlayBanner');
    const closeHowToPlayBtn = document.getElementById('closeHowToPlayBtn');
    if (closeHowToPlayBtn) closeHowToPlayBtn.onclick = () => closeHowToPlayModal();
    const closeHowToPlayBtnBottom = document.getElementById(
        'closeHowToPlayBtnBottom',
    );
    if (closeHowToPlayBtnBottom)
        closeHowToPlayBtnBottom.onclick = () => closeHowToPlayModal();

    // Start Menu Step Mode Buttons
    const btnSingle = document.getElementById('btnModeSingle');
    if (btnSingle) {
        btnSingle.onclick = () => {
            selectedGameMode = 'single';
            pendingPlayerCount = 1;
            if (typeof GAME_STATE !== 'undefined')
                GAME_STATE.gameMode = 'single';
            if (typeof resizeCanvas === 'function') resizeCanvas();
            const promptEl = document.getElementById('difficultyPrompt');
            if (promptEl)
                promptEl.textContent = 'Singleplayer — Select Difficulty';
            showStartStep('difficulty');
        };
    }

    const btnLocal = document.getElementById('btnModeLocal');
    if (btnLocal) {
        btnLocal.onclick = () => {
            selectedGameMode = 'local';
            if (typeof GAME_STATE !== 'undefined')
                GAME_STATE.gameMode = 'local';
            if (typeof resizeCanvas === 'function') resizeCanvas();
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
            // Lock phone hosts to the standard laptop arena before lobby/clients join
            if (typeof resizeCanvas === 'function') resizeCanvas();
            pendingPlayerCount = 1;
            const promptEl = document.getElementById('difficultyPrompt');
            if (promptEl)
                promptEl.textContent = 'Online Co-Op — Select Difficulty';
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
    const backFromOnlineChoice = document.getElementById(
        'backFromOnlineChoice',
    );
    if (backFromOnlineChoice)
        backFromOnlineChoice.onclick = () => showStartStep('mode');

    const backFromJoin = document.getElementById('backFromJoin');
    if (backFromJoin)
        backFromJoin.onclick = () => showStartStep('onlineChoice');

    const backToModesFromPlayers = document.getElementById(
        'backToModesFromPlayers',
    );
    if (backToModesFromPlayers)
        backToModesFromPlayers.onclick = () => showStartStep('mode');

    const backToPreviousFromDiff = document.getElementById(
        'backToPreviousFromDiff',
    );
    if (backToPreviousFromDiff) {
        backToPreviousFromDiff.onclick = () => {
            if (selectedGameMode === 'single') showStartStep('mode');
            else if (selectedGameMode === 'local') showStartStep('players');
            else if (selectedGameMode === 'online_host')
                showStartStep('onlineChoice');
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
    for (const btn of document.querySelectorAll(
        '#startMenu [data-difficulty]',
    )) {
        btn.onclick = async () => {
            const diffKey = btn.dataset.difficulty;
            if (selectedGameMode === 'online_host') {
                try {
                    if (typeof netManager !== 'undefined' && netManager) {
                        await netManager.initHost();
                    }
                    if (typeof startGame === 'function') startGame(1, diffKey);
                } catch (err) {
                    showToast('Could not initialize P2P host: ' + err.message, 5000, true);
                }
            } else {
                if (typeof startGame === 'function')
                    startGame(pendingPlayerCount, diffKey);
            }
        };
    }

    // Auto-check URL query parameter on page load (e.g. ?room=BLOB-4821)
    if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        const roomParam = urlParams.get('room');
        if (roomParam) {
            console.log(
                '[Multiplayer] Auto-joining room from URL parameter:',
                roomParam,
            );
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
            if (
                typeof netManager === 'undefined' ||
                !netManager ||
                !netManager.roomCode
            )
                return;
            const joinUrl =
                typeof NetworkManager !== 'undefined' &&
                NetworkManager.getJoinUrl
                    ? NetworkManager.getJoinUrl(netManager.roomCode)
                    : window.location.origin +
                      window.location.pathname +
                      '?room=' +
                      netManager.roomCode;
            if (navigator.clipboard?.writeText) {
                navigator.clipboard
                    .writeText(joinUrl)
                    .then(() => {
                        inviteBanner.classList.add('copied');
                        const hintEl =
                            document.getElementById('inviteCopyHint');
                        if (hintEl) hintEl.textContent = '✓ Link Copied!';
                        setTimeout(() => {
                            inviteBanner.classList.remove('copied');
                            if (hintEl)
                                hintEl.textContent = 'Click to copy link';
                        }, 2200);
                    })
                    .catch(() => {
                        prompt(
                            'Share this invite link with friends to play together:',
                            joinUrl,
                        );
                    });
            } else {
                prompt(
                    'Share this invite link with friends to play together:',
                    joinUrl,
                );
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

    const fpsToggleBtn = document.getElementById('fpsToggleBtn');
    if (fpsToggleBtn) {
        fpsToggleBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof GAME_STATE !== 'undefined') {
                const isFpsVisible =
                    GAME_STATE.showFps !== undefined
                        ? GAME_STATE.showFps
                        : Boolean(GAME_STATE.testingMode);
                GAME_STATE.showFps = !isFpsVisible;
                updateFpsToggleBtn();
                if (typeof updateUI === 'function') updateUI();
            }
        };
    }

    const pauseMenuBtn = document.getElementById('pauseMenuBtn');
    if (pauseMenuBtn) {
        pauseMenuBtn.onclick = togglePause;
        pauseMenuBtn.addEventListener('pointerdown', (e) =>
            e.stopPropagation(),
        );
    }

    const relayToggleBtn = document.getElementById('relayToggleBtn');
    if (relayToggleBtn) {
        const updateRelayBtn = () => {
            const on = Boolean(
                typeof window !== 'undefined' && window.FORCE_RELAY,
            );
            relayToggleBtn.textContent = on ? 'RELAY: ON' : 'RELAY: OFF';
            relayToggleBtn.style.color = on ? '#00ffcc' : '#888';
            relayToggleBtn.style.borderColor = on ? '#00ffcc' : '#555';
        };
        relayToggleBtn.onclick = () => {
            if (typeof window !== 'undefined') {
                window.FORCE_RELAY = !window.FORCE_RELAY;
            }
            updateRelayBtn();
        };
        updateRelayBtn();
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

function showToast(message, duration = 3500, isError = false) {
    if (typeof document === 'undefined') return;
    let toast = document.getElementById('netToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'netToast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = isError ? 'show error' : 'show';
    const anyToast = /** @type {any} */ (toast);
    if (anyToast._timer) clearTimeout(anyToast._timer);
    anyToast._timer = setTimeout(() => {
        toast.className = '';
    }, duration);
}

// ---------------- Global Window / Module Exports ----------------
if (typeof window !== 'undefined') {
    window.showToast = showToast;
    window.WEAPON_LABELS = WEAPON_LABELS;
    window.startWeaponSelectFlow = startWeaponSelectFlow;
    window.renderLobbyWeaponPanels = renderLobbyWeaponPanels;
    window.updateLobbyPlayerNameDisplay = updateLobbyPlayerNameDisplay;
    window.buildPlaceholderPanel = buildPlaceholderPanel;
    window.buildStartingWeaponPanel = buildStartingWeaponPanel;
    window.selectStartingWeapon = selectStartingWeapon;
    window.startLevelUpFlow = startLevelUpFlow;
    window.beginSelectionRound = beginSelectionRound;
    window.showKickButtonsForUnpickedPlayers =
        showKickButtonsForUnpickedPlayers;
    window.releaseDisconnectedPlayerPick = releaseDisconnectedPlayerPick;
    window.kickPlayerByHost = kickPlayerByHost;
    window.onOnlinePlayerKicked = onOnlinePlayerKicked;
    window.getPanelPosition = getPanelPosition;
    window.buildPlayerPanel = buildPlayerPanel;
    window.onPlayerChose = onPlayerChose;
    window.onPlayerChoseVirtual = onPlayerChoseVirtual;
    window.finishSelectionRound = finishSelectionRound;
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
    window.updateFpsToggleBtn = updateFpsToggleBtn;
    window.togglePause = togglePause;
    window.updatePauseMenuButtonIcon = updatePauseMenuButtonIcon;
    window.isFullscreenActive = isFullscreenActive;
    window.toggleFullscreen = toggleFullscreen;
    window.updateFullscreenButtons = updateFullscreenButtons;
    window.updateUI = updateUI;
    window.initUISystem = initUISystem;
    window.createKeyClusterDOM = createKeyClusterDOM;
    window.openHowToPlayModal = openHowToPlayModal;
    window.closeHowToPlayModal = closeHowToPlayModal;
}
