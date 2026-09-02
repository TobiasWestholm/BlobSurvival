/**
 * Blob Survival - P2P Multiplayer Network Manager (PeerJS)
 * Handles WebRTC peer connections, room code generation, 60fps input & state streaming,
 * reliable event messaging, and mid-game reconnection.
 */

class NetworkManager {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection (Reliable RPC channel)
        this.unreliableChannels = new Map(); // peerId -> RTCDataChannel (Unreliable snapshot channel on host)
        this.unreliableHostChannel = null; // RTCDataChannel (Unreliable snapshot channel on client)
        this.playerPeerMap = new Map(); // playerIndex (1..3) -> peerId
        this.peerPlayerMap = new Map(); // peerId -> playerIndex (1..3)
        this.sessionPlayerMap = new Map(); // sessionToken -> playerIndex (1..3)
        this.playerSessionMap = new Map(); // playerIndex (1..3) -> sessionToken
        this.peerLastSeenMap = new Map(); // peerId -> timestamp
        this.heartbeatInterval = null;
        this.healthCheckInterval = null;
        this.sessionToken = null;
        this.isHost = false;
        this.isClient = false;
        this.isOnline = false;
        this.localPlayerIndex = 0;
        this.roomCode = null;
        this.hostConnection = null;
        this.statusCallback = null;
        this.lastStateBroadcast = 0;
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
    }

    sendConn(target, payload) {
        if (!target) return;
        try {
            if (target.open) {
                target.send(payload);
            }
        } catch (e) {
            // Socket / connection closed
        }
    }

    reset() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        if (this.peer) {
            try { this.peer.destroy(); } catch (e) {}
            this.peer = null;
        }
        for (const chan of this.unreliableChannels.values()) {
            try { chan.close(); } catch (e) {}
        }
        this.unreliableChannels.clear();
        if (this.unreliableHostChannel) {
            try { this.unreliableHostChannel.close(); } catch (e) {}
            this.unreliableHostChannel = null;
        }
        for (const conn of this.connections.values()) {
            try { conn.close(); } catch (e) {}
        }
        this.connections.clear();
        this.playerPeerMap.clear();
        this.peerPlayerMap.clear();
        this.sessionPlayerMap.clear();
        this.playerSessionMap.clear();
        this.peerLastSeenMap.clear();
        this.isHost = false;
        this.isClient = false;
        this.isOnline = false;
        this.localPlayerIndex = 0;
        this.roomCode = null;
        this.hostConnection = null;
        this.isReconnecting = false;
        if (typeof clientEnemyCache !== 'undefined') clientEnemyCache.clear();
        if (typeof clientTurretCache !== 'undefined') clientTurretCache.clear();
        if (typeof clientHazardCache !== 'undefined') clientHazardCache.clear();
        if (typeof GAME_STATE !== 'undefined') {
            GAME_STATE.hostW = null;
            GAME_STATE.hostH = null;
            GAME_STATE.victoryTriggered = false;
        }
    }

    // Generate a clean 4-character room code (e.g. 4821 or 7K9X)
    static generateRoomCode() {
        const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    static getJoinUrl(roomCode) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', roomCode);
        return url.toString();
    }

    initHost(customCode = null) {
        return new Promise((resolve, reject) => {
            this.reset();
            this.isHost = true;
            this.isClient = false;
            this.isOnline = true;
            this.localPlayerIndex = 0;
            this.roomCode = customCode || NetworkManager.generateRoomCode();

            if (typeof Peer === 'undefined') {
                return reject(new Error('PeerJS library not loaded'));
            }

            try {
                this.peer = new Peer(this.roomCode, {
                    debug: 1,
                    config: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:global.stun.twilio.com:3478' }
                        ]
                    }
                });

                this.peer.on('open', (id) => {
                    this.roomCode = id;
                    console.log('[Net] Host registered room code:', id);

                    // Health check: check heartbeat of clients every 1s
                    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
                    this.healthCheckInterval = setInterval(() => {
                        if (!this.isHost) return;
                        const now = Date.now();
                        for (const [slot, peerId] of this.playerPeerMap.entries()) {
                            const lastSeen = this.peerLastSeenMap.get(peerId) || 0;
                            if (lastSeen > 0 && now - lastSeen > 3500) {
                                console.warn(`[Net] Peer ${peerId} (Player ${slot + 1}) timed out via heartbeat (${now - lastSeen}ms).`);
                                const conn = this.connections.get(peerId);
                                if (conn) {
                                    try { conn.close(); } catch (e) {}
                                }
                                this.handlePeerDisconnected(slot, peerId);
                            }
                        }
                    }, 1000);

                    resolve(id);
                });

                this.peer.on('connection', (conn) => {
                    this.handleIncomingConnection(conn);
                });

                this.peer.on('error', (err) => {
                    console.error('[Net] Host Peer error:', err);
                    if (err.type === 'unavailable-id') {
                        // If ID collision, try with new random code
                        const newCode = NetworkManager.generateRoomCode();
                        this.initHost(newCode).then(resolve).catch(reject);
                    } else {
                        reject(err);
                    }
                });

                this.peer.on('disconnected', () => {
                    console.warn('[Net] Host disconnected from signaling broker. Reconnecting...');
                    this.peer.reconnect();
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    initClient(roomCode) {
        return new Promise((resolve, reject) => {
            this.reset();
            this.isHost = false;
            this.isClient = true;
            this.isOnline = true;
            this.roomCode = roomCode.trim().toUpperCase();

            // Retrieve or generate persistent sessionToken for this room
            const sessionKey = `blob_session_${this.roomCode}`;
            let sessionToken = sessionStorage.getItem(sessionKey);
            if (!sessionToken) {
                sessionToken = 'tok_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
                sessionStorage.setItem(sessionKey, sessionToken);
            }
            this.sessionToken = sessionToken;

            if (typeof Peer === 'undefined') {
                return reject(new Error('PeerJS library not loaded'));
            }

            try {
                // Client gets a random peer ID
                this.peer = new Peer({
                    debug: 1,
                    config: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:global.stun.twilio.com:3478' }
                        ]
                    }
                });

                this.peer.on('open', (myPeerId) => {
                    console.log('[Net] Client peer initialized:', myPeerId, 'sessionToken:', this.sessionToken);
                    const conn = this.peer.connect(this.roomCode, {
                        reliable: true,
                        serialization: 'json',
                        metadata: { sessionToken: this.sessionToken }
                    });

                    let connectionTimeout = setTimeout(() => {
                        reject(new Error('Connection timed out. Check room code.'));
                    }, 10000);

                    conn.on('open', () => {
                        clearTimeout(connectionTimeout);
                        this.hostConnection = conn;
                        this.connections.set('host', conn);
                        console.log('[Net] Connected to Host:', this.roomCode);

                        // Start 1s active heartbeat ping
                        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
                        this.heartbeatInterval = setInterval(() => {
                            if (this.hostConnection && this.hostConnection.open) {
                                this.sendConn(this.hostConnection, { type: 'HEARTBEAT', time: Date.now() });
                            }
                        }, 1000);

                        // Also send explicit HANDSHAKE with sessionToken
                        this.sendConn(conn, { type: 'HANDSHAKE', sessionToken: this.sessionToken });

                        conn.on('data', (data) => {
                            this.handleClientReceivedData(data);
                        });

                        conn.on('close', () => {
                            console.warn('[Net] Connection to Host closed.');
                            this.handleHostDisconnected();
                        });

                        resolve(this.roomCode);
                    });

                    conn.on('error', (err) => {
                        clearTimeout(connectionTimeout);
                        reject(err);
                    });
                });

                this.peer.on('error', (err) => {
                    console.error('[Net] Client Peer error:', err);
                    reject(err);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    handleIncomingConnection(conn) {
        conn.on('open', () => {
            console.log('[Net] Peer connecting:', conn.peer);
            this.peerLastSeenMap.set(conn.peer, Date.now());
            let sessionToken = (conn.metadata && conn.metadata.sessionToken) ? conn.metadata.sessionToken : null;
            const isGameStarted = (typeof GAME_STATE !== 'undefined' && typeof STATES !== 'undefined' && GAME_STATE.current !== STATES.WEAPON_SELECT && GAME_STATE.current !== STATES.START_MENU);

            // 1. Check if this is an established player reconnecting with their sessionToken
            let assignedSlot = (sessionToken && this.sessionPlayerMap.has(sessionToken)) ? this.sessionPlayerMap.get(sessionToken) : undefined;

            if (assignedSlot !== undefined) {
                // Existing player RECONNECTING!
                console.log(`[Net] Recognized reconnecting player: P${assignedSlot + 1} (token: ${sessionToken})`);
                this.connections.set(conn.peer, conn);
                this.playerPeerMap.set(assignedSlot, conn.peer);
                this.peerPlayerMap.set(conn.peer, assignedSlot);
                this.sessionPlayerMap.set(sessionToken, assignedSlot);
                this.playerSessionMap.set(assignedSlot, sessionToken);
                this.peerLastSeenMap.set(conn.peer, Date.now());

                const connectedSlots = [0, ...this.playerPeerMap.keys()];
                let upgradesMap = null;
                let chosenUpgradesMap = null;
                if (typeof GAME_STATE !== 'undefined' && typeof STATES !== 'undefined' && GAME_STATE.current === STATES.LEVEL_UP && GAME_STATE.players) {
                    upgradesMap = {};
                    chosenUpgradesMap = {};
                    for (const p of GAME_STATE.players) {
                        if (!p) continue;
                        if (!p.currentUpgradeOptions && typeof pickThreeFor === 'function') {
                            p.currentUpgradeOptions = pickThreeFor(p);
                        }
                        if (p.currentUpgradeOptions) {
                            upgradesMap[p.index] = p.currentUpgradeOptions.map(u => u.id);
                        }
                        if (p.currentLevelUpgradeName) {
                            chosenUpgradesMap[p.index] = p.currentLevelUpgradeName;
                        }
                    }
                }

                this.sendConn(conn, {
                    type: 'ASSIGN_SLOT',
                    playerIndex: assignedSlot,
                    isReconnection: true,
                    difficulty: (typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty) ? GAME_STATE.difficulty.name.toLowerCase() : 'normal',
                    currentGameState: (typeof GAME_STATE !== 'undefined') ? GAME_STATE.current : 0,
                    elapsed: (typeof GAME_STATE !== 'undefined') ? GAME_STATE.elapsed : 0,
                    connectedSlots: connectedSlots,
                    hostW: typeof W !== 'undefined' ? W : 1512,
                    hostH: typeof H !== 'undefined' ? H : 945,
                    upgradesMap: upgradesMap,
                    chosenUpgradesMap: chosenUpgradesMap,
                    pendingLevels: (typeof GAME_STATE !== 'undefined') ? (GAME_STATE.pendingLevels || 1) : 1
                });

                if (typeof onOnlinePlayerJoined === 'function') {
                    onOnlinePlayerJoined(assignedSlot, conn.peer, true);
                }

                if (conn.peerConnection) {
                    this.setupUnreliableChannel(conn, assignedSlot);
                    conn.peerConnection.addEventListener('connectionstatechange', () => {
                        const st = conn.peerConnection.connectionState;
                        if (st === 'disconnected' || st === 'failed' || st === 'closed') {
                            console.warn(`[Net] Peer ${conn.peer} WebRTC state: ${st}`);
                            this.handlePeerDisconnected(assignedSlot, conn.peer);
                        }
                    });
                }

                conn.on('data', (data) => {
                    this.handleHostReceivedData(conn.peer, assignedSlot, data);
                });

                conn.on('close', () => {
                    console.warn(`[Net] Player P${assignedSlot + 1} (${conn.peer}) disconnected.`);
                    this.handlePeerDisconnected(assignedSlot, conn.peer);
                });
                return;
            }

            // 2. New player attempting to join:
            if (isGameStarted) {
                // Game has started past weapon selection -> DENY new connections
                console.warn(`[Net] Rejected new connection from ${conn.peer} - game already in progress.`);
                this.sendConn(conn, {
                    type: 'JOIN_DENIED',
                    reason: 'The game has already started. Only players who joined during weapon selection can reconnect.'
                });
                setTimeout(() => conn.close(), 500);
                return;
            }

            // 3. Still in starting weapon selection: allow up to 4 players (slots 1..3 for clients)
            for (let i = 1; i <= 3; i++) {
                if (!this.playerSessionMap.has(i) && !this.playerPeerMap.has(i)) {
                    assignedSlot = i;
                    break;
                }
            }

            if (assignedSlot === undefined) {
                // Room is full
                console.warn(`[Net] Rejected connection from ${conn.peer} - lobby is full.`);
                this.sendConn(conn, {
                    type: 'ROOM_FULL',
                    reason: 'The lobby is full (maximum 4 players).'
                });
                setTimeout(() => conn.close(), 500);
                return;
            }

            if (!sessionToken) {
                sessionToken = 'tok_' + conn.peer;
            }
            this.connections.set(conn.peer, conn);
            this.playerPeerMap.set(assignedSlot, conn.peer);
            this.peerPlayerMap.set(conn.peer, assignedSlot);
            this.sessionPlayerMap.set(sessionToken, assignedSlot);
            this.playerSessionMap.set(assignedSlot, sessionToken);
            this.peerLastSeenMap.set(conn.peer, Date.now());

            console.log(`[Net] Assigned new player slot P${assignedSlot + 1} to peer:`, conn.peer, 'sessionToken:', sessionToken);

            const connectedSlots = [0, ...this.playerPeerMap.keys()];
            this.sendConn(conn, {
                type: 'ASSIGN_SLOT',
                playerIndex: assignedSlot,
                isReconnection: false,
                difficulty: (typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty) ? GAME_STATE.difficulty.name.toLowerCase() : 'normal',
                currentGameState: (typeof GAME_STATE !== 'undefined') ? GAME_STATE.current : 0,
                elapsed: (typeof GAME_STATE !== 'undefined') ? GAME_STATE.elapsed : 0,
                connectedSlots: connectedSlots,
                hostW: typeof W !== 'undefined' ? W : 1512,
                hostH: typeof H !== 'undefined' ? H : 945
            });

            if (typeof onOnlinePlayerJoined === 'function') {
                onOnlinePlayerJoined(assignedSlot, conn.peer, false);
            }

            if (conn.peerConnection) {
                this.setupUnreliableChannel(conn, assignedSlot);
                conn.peerConnection.addEventListener('connectionstatechange', () => {
                    const st = conn.peerConnection.connectionState;
                    if (st === 'disconnected' || st === 'failed' || st === 'closed') {
                        console.warn(`[Net] Peer ${conn.peer} WebRTC state: ${st}`);
                        this.handlePeerDisconnected(assignedSlot, conn.peer);
                    }
                });
            }

            conn.on('data', (data) => {
                this.handleHostReceivedData(conn.peer, assignedSlot, data);
            });

            conn.on('close', () => {
                console.warn(`[Net] Player P${assignedSlot + 1} (${conn.peer}) disconnected.`);
                this.handlePeerDisconnected(assignedSlot, conn.peer);
            });
        });
    }

    setupUnreliableChannel(conn, assignedSlot) {
        if (!conn || !conn.peerConnection || this.unreliableChannels.has(conn.peer)) return;
        try {
            const chan = conn.peerConnection.createDataChannel('blob_snapshots', {
                ordered: false,
                maxRetransmits: 0
            });
            chan.binaryType = 'arraybuffer';
            chan.onopen = () => {
                console.log(`[Net] Unreliable snapshot channel open with ${conn.peer} (P${assignedSlot + 1})`);
                this.unreliableChannels.set(conn.peer, chan);
            };
            chan.onmessage = (e) => {
                this.handleHostReceivedData(conn.peer, assignedSlot, e.data);
            };
            chan.onclose = () => {
                this.unreliableChannels.delete(conn.peer);
            };
            chan.onerror = (err) => {
                console.warn(`[Net] Snapshot channel error with ${conn.peer}:`, err);
                this.unreliableChannels.delete(conn.peer);
            };
        } catch (e) {
            console.warn(`[Net] Could not create unreliable channel with ${conn.peer}:`, e);
        }
    }

    handleHostReceivedData(peerId, playerIndex, data) {
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { return; }
        }
        if (!data || !data.type) return;
        this.peerLastSeenMap.set(peerId, Date.now());

        switch (data.type) {
            case 'HANDSHAKE':
                if (data.sessionToken && !this.playerSessionMap.has(playerIndex)) {
                    this.sessionPlayerMap.set(data.sessionToken, playerIndex);
                    this.playerSessionMap.set(playerIndex, data.sessionToken);
                }
                break;

            case 'INPUT':
                // 60 FPS remote movement stream
                if (typeof onRemoteInputReceived === 'function') {
                    onRemoteInputReceived(playerIndex, data.moveX, data.moveY, data.angle, data.dashing);
                }
                break;

            case 'SELECT_WEAPON':
                // Starting weapon choice or change (regret choice)
                if (typeof onRemoteWeaponSelected === 'function') {
                    onRemoteWeaponSelected(playerIndex, data.weaponId);
                }
                break;

            case 'SELECT_UPGRADE':
                // Level-up upgrade pick
                if (typeof onRemoteUpgradeSelected === 'function') {
                    onRemoteUpgradeSelected(playerIndex, data.upgradeId);
                }
                break;

            case 'HEARTBEAT':
                const conn = this.connections.get(peerId);
                if (conn && conn.open) {
                    this.sendConn(conn, { type: 'HEARTBEAT_ACK', time: Date.now() });
                }
                break;
        }
    }

    handleClientReceivedData(data) {
        if (!data) return;

        // 1. Handle Blob in case browser WebRTC delivers frames as Blob
        if (typeof Blob !== 'undefined' && data instanceof Blob) {
            data.arrayBuffer().then(buf => {
                this.handleClientReceivedData(buf);
            }).catch(() => {});
            return;
        }

        // 2. Handle Binary ArrayBuffer / TypedArray
        if (data instanceof ArrayBuffer || (data && data.buffer instanceof ArrayBuffer && data.byteLength !== undefined)) {
            const buffer = (data instanceof ArrayBuffer) ? data : data.buffer;
            const snapshot = unpackWorldSnapshotBinary(buffer);
            if (snapshot && typeof onWorldSnapshotReceived === 'function') {
                onWorldSnapshotReceived(snapshot);
            }
            return;
        }

        // 3. Handle JSON string
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {
                return;
            }
        }

        if (!data || !data.type) return;

        switch (data.type) {
            case 'ASSIGN_SLOT':
                this.localPlayerIndex = data.playerIndex;
                console.log(`[Net] Successfully joined as Player ${this.localPlayerIndex + 1} (Reconnection: ${!!data.isReconnection})`);
                if (typeof onAssignedSlot === 'function') {
                    onAssignedSlot(this.localPlayerIndex, data.difficulty, data.currentGameState, data.connectedSlots, data.hostW, data.hostH, data.isReconnection, data.elapsed, data.upgradesMap, data.chosenUpgradesMap, data.pendingLevels);
                }
                break;

            case 'JOIN_DENIED':
                console.warn('[Net] Join denied:', data.reason);
                alert(data.reason || 'The game has already started. Late joins are not permitted.');
                if (typeof showStartMenu === 'function') {
                    showStartMenu();
                }
                break;

            case 'LOBBY_STATE':
                // Updates connected player list and weapon picks in the lobby
                if (typeof onLobbyStateUpdated === 'function') {
                    onLobbyStateUpdated(data.players, data.allReady);
                }
                break;

            case 'START_GAME_COUNTDOWN':
                // Host launched the game
                if (typeof onOnlineCountdownStarted === 'function') {
                    onOnlineCountdownStarted(data.isNewGame);
                }
                break;

            case 'WORLD_SNAPSHOT':
                // Authoritative game world state from host
                if (typeof onWorldSnapshotReceived === 'function') {
                    if (data.b) {
                        try {
                            const bytes = base64ToUint8(data.b);
                            const snapshot = unpackWorldSnapshotBinary(bytes);
                            if (snapshot) {
                                onWorldSnapshotReceived(snapshot);
                            }
                        } catch (e) {
                            console.warn('[Net] Failed to decode base64 snapshot:', e);
                        }
                    } else {
                        onWorldSnapshotReceived(data);
                    }
                }
                break;

            case 'LEVEL_UP_START':
                // Midgame level up triggered
                if (typeof onOnlineLevelUpStarted === 'function') {
                    onOnlineLevelUpStarted(data.pendingLevels, data.upgradesMap || data.playerUpgrades);
                }
                break;

            case 'UPGRADE_CHOSEN_SYNC':
                if (typeof onUpgradeChosenSync === 'function') {
                    onUpgradeChosenSync(data.playerIndex, data.upgradeId, data.upgradeName);
                }
                break;

            case 'PAUSE_SYNC':
                if (typeof onOnlinePauseSynced === 'function') {
                    onOnlinePauseSynced(data.paused);
                }
                break;

            case 'GAME_OVER':
                if (typeof onOnlineGameOver === 'function') {
                    onOnlineGameOver();
                }
                break;

            case 'GAME_VICTORY':
                if (typeof onOnlineVictory === 'function') {
                    onOnlineVictory();
                }
                break;

            case 'ROOM_FULL':
                alert('This room is already full (maximum 4 players).');
                showStartMenu();
                break;

            case 'KICKED':
                alert(data.reason || 'You have been permanently removed from the session by the host.');
                if (typeof showStartMenu === 'function') {
                    showStartMenu();
                }
                break;

            case 'PLAYER_KICKED':
                if (typeof onOnlinePlayerKicked === 'function') {
                    onOnlinePlayerKicked(data.playerIndex);
                }
                break;
        }
    }

    kickPlayer(playerIndex) {
        if (!this.isHost) return;
        const peerId = this.playerPeerMap.get(playerIndex);
        const sessionToken = this.playerSessionMap.get(playerIndex);

        if (peerId) {
            const conn = this.connections.get(peerId);
            if (conn) {
                try {
                    this.sendConn(conn, { type: 'KICKED', reason: 'You were permanently removed from the game session by the host.' });
                    setTimeout(() => conn.close(), 250);
                } catch (e) {}
                this.connections.delete(peerId);
            }
            this.peerPlayerMap.delete(peerId);
            this.playerPeerMap.delete(playerIndex);
        }

        if (sessionToken) {
            this.sessionPlayerMap.delete(sessionToken);
            this.playerSessionMap.delete(playerIndex);
        }

        this.broadcast({
            type: 'PLAYER_KICKED',
            playerIndex: playerIndex
        });
    }

    handlePeerDisconnected(playerIndex, peerId) {
        const unreli = this.unreliableChannels.get(peerId);
        if (unreli) {
            try { unreli.close(); } catch (e) {}
            this.unreliableChannels.delete(peerId);
        }
        this.connections.delete(peerId);
        this.peerPlayerMap.delete(peerId);
        this.playerPeerMap.delete(playerIndex);
        this.peerLastSeenMap.delete(peerId);
        if (typeof onOnlinePlayerDisconnected === 'function') {
            onOnlinePlayerDisconnected(playerIndex, peerId);
        }
    }

    handleHostDisconnected() {
        alert('Host disconnected from the game session.');
        showStartMenu();
    }

    // Host sends 20fps game world snapshot to all connected clients
    broadcastWorldSnapshot(snapshot) {
        if (!this.isHost || this.connections.size === 0) return;
        let payload;
        if (snapshot && typeof snapshot === 'object' && snapshot.type === 'WORLD_SNAPSHOT' && snapshot.b) {
            payload = snapshot;
        } else if (snapshot instanceof ArrayBuffer || (snapshot && snapshot.buffer instanceof ArrayBuffer)) {
            const u8 = new Uint8Array(snapshot.buffer || snapshot, snapshot.byteOffset || 0, snapshot.byteLength);
            payload = { type: 'WORLD_SNAPSHOT', b: uint8ToBase64(u8) };
        } else if (snapshot && snapshot.players) {
            payload = snapshot;
        } else {
            const buf = (typeof packWorldSnapshotBinary === 'function') ? packWorldSnapshotBinary() : null;
            if (buf) {
                payload = { type: 'WORLD_SNAPSHOT', b: uint8ToBase64(new Uint8Array(buf)) };
            } else {
                payload = { type: 'WORLD_SNAPSHOT', ...snapshot };
            }
        }

        for (const conn of this.connections.values()) {
            if (conn && conn.open) {
                this.sendConn(conn, payload);
            }
        }
    }

    // Host sends lobby status (who is connected and ready)
    broadcastLobbyState(playersState, allReady) {
        if (!this.isHost) return;
        const msg = {
            type: 'LOBBY_STATE',
            players: playersState,
            allReady: allReady
        };
        for (const conn of this.connections.values()) {
            if (conn && conn.open) {
                this.sendConn(conn, msg);
            }
        }
    }

    // Client sends input stream to host
    sendLocalInput(moveX, moveY, angle, dashing = false) {
        if (!this.isClient) return;
        const msg = {
            type: 'INPUT',
            playerIndex: this.localPlayerIndex,
            moveX: moveX,
            moveY: moveY,
            angle: angle,
            dashing: dashing
        };

        if (this.hostConnection && this.hostConnection.open) {
            this.sendConn(this.hostConnection, msg);
        }
    }

    // Client sends weapon choice to host
    sendWeaponSelection(weaponId) {
        if (this.isClient && this.hostConnection && this.hostConnection.open) {
            this.sendConn(this.hostConnection, {
                type: 'SELECT_WEAPON',
                playerIndex: this.localPlayerIndex,
                weaponId: weaponId
            });
        }
    }

    // Client sends upgrade pick to host
    sendUpgradeSelection(upgradeId) {
        if (this.isClient && this.hostConnection && this.hostConnection.open) {
            this.sendConn(this.hostConnection, {
                type: 'SELECT_UPGRADE',
                playerIndex: this.localPlayerIndex,
                upgradeId: upgradeId
            });
        }
    }

    broadcast(messageObj) {
        if (this.isHost) {
            for (const conn of this.connections.values()) {
                if (conn.open) this.sendConn(conn, messageObj);
            }
        } else if (this.isClient && this.hostConnection && this.hostConnection.open) {
            this.sendConn(this.hostConnection, messageObj);
        }
    }
}

// --- Mid-game Player Entity Despawn & Cleanup ---
function despawnPlayerEntities(playerIndex) {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.players) return;
    const player = GAME_STATE.players[playerIndex];
    if (!player) return;

    // 1. Mark player as disconnected and not alive/targetable
    player.disconnected = true;
    player.alive = false;

    // 2. Despawn all turrets owned by this player
    if (GAME_STATE.turrets) {
        for (let i = GAME_STATE.turrets.length - 1; i >= 0; i--) {
            const t = GAME_STATE.turrets[i];
            if (t.player === player || (t.player && t.player.index === playerIndex)) {
                t.alive = false;
                if (typeof t.cleanup === 'function') t.cleanup();
                GAME_STATE.turrets.splice(i, 1);
            }
        }
    }

    // 3. Despawn all player hazards / mines owned by this player
    if (GAME_STATE.hazards) {
        for (let i = GAME_STATE.hazards.length - 1; i >= 0; i--) {
            const h = GAME_STATE.hazards[i];
            if (h.player === player || (h.player && h.player.index === playerIndex) || h.owner === player) {
                h.alive = false;
                if (typeof h.despawn === 'function') h.despawn();
                GAME_STATE.hazards.splice(i, 1);
            }
        }
    }

    // 4. Remove magnetic mines tracking
    if (GAME_STATE.magneticMines) {
        GAME_STATE.magneticMines = GAME_STATE.magneticMines.filter(m => m.player !== player && (!m.player || m.player.index !== playerIndex));
    }

    // 5. Despawn projectiles fired by this player
    if (GAME_STATE.projectiles) {
        for (let i = GAME_STATE.projectiles.length - 1; i >= 0; i--) {
            const proj = GAME_STATE.projectiles[i];
            if (proj.player === player || (proj.player && proj.player.index === playerIndex) || proj.owner === player) {
                proj.alive = false;
                GAME_STATE.projectiles.splice(i, 1);
            }
        }
    }

    if (player && player.weapons) {
        for (const w of player.weapons) {
            if (w.id === 'fire_ring' || w.id === 'projectile_shield') {
                w.initialized = false;
                w.orbiters = [];
            }
        }
    }

    // 6. Reset any active enemy target referencing this player
    if (GAME_STATE.enemies) {
        for (const e of GAME_STATE.enemies) {
            if (e.targetPlayer === player || (e.targetPlayer && e.targetPlayer.index === playerIndex)) {
                e.targetPlayer = null;
            }
        }
    }
}

// --- Multiplayer Network Event Handlers ---
window.onOnlinePlayerJoined = function(assignedSlot, peerId, isReconnection) {
    console.log(`[Game] Online peer joined as Player ${assignedSlot + 1} (Reconnection: ${!!isReconnection})`);
    let p = GAME_STATE.players[assignedSlot];
    if (!p) {
        GAME_STATE.players[assignedSlot] = new Player(assignedSlot, PLAYER_DEFS[assignedSlot]);
        p = GAME_STATE.players[assignedSlot];
    } else {
        p.disconnected = false;
        p.alive = true;
        if (isReconnection) {
            // User requirement: Respawn in same place, invulnerable for 3 seconds to find safety
            p.invuln = 3000;
            p.spawnInvuln = 3000;
            p.clampToArena();
            if (p.weapons) {
                for (const w of p.weapons) {
                    if (w.id === 'fire_ring' || w.id === 'projectile_shield') {
                        w.initialized = false;
                        w.orbiters = [];
                    }
                }
            }
            if (p.selectedWeapon && (!p.weapons || p.weapons.length === 0)) {
                p.unlockWeapon(p.selectedWeapon);
            }
        }
    }
    recalculateDynamicDifficulty();

    if (GAME_STATE.current === STATES.WEAPON_SELECT) {
        renderLobbyWeaponPanels();
        netManager.broadcastLobbyState(
            GAME_STATE.players.filter(pl => pl && !pl.disconnected).map(p => ({ index: p.index, selectedWeapon: p.selectedWeapon, selectedWeaponLabel: p.selectedWeaponLabel })),
            GAME_STATE.players.filter(pl => pl && !pl.disconnected).every(p => p.selectedWeapon)
        );
    }
};

window.onOnlinePlayerDisconnected = function(playerIndex, peerId) {
    console.warn(`[Game] Online peer disconnected: Player ${playerIndex + 1}`);
    despawnPlayerEntities(playerIndex);
    recalculateDynamicDifficulty();

    if (GAME_STATE.current === STATES.WEAPON_SELECT) {
        renderLobbyWeaponPanels();
        netManager.broadcastLobbyState(
            GAME_STATE.players.filter(pl => pl && !pl.disconnected).map(p => ({ index: p.index, selectedWeapon: p.selectedWeapon, selectedWeaponLabel: p.selectedWeaponLabel })),
            GAME_STATE.players.filter(pl => pl && !pl.disconnected).every(p => p.selectedWeapon)
        );
    } else if (GAME_STATE.current === STATES.LEVEL_UP && netManager && netManager.isHost) {
        // Disconnected player in level up: immediately offer Kick button to host
        const panel = document.getElementById(`levelPanel_${playerIndex}`);
        if (panel && panel.dataset.pickDone !== 'true' && !panel.querySelector('.kick-player-btn')) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'kick-player-btn';
            kickBtn.innerHTML = `⚠️ Kick Player ${playerIndex + 1} (Disconnected)`;
            kickBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Permanently kick Player ${playerIndex + 1} from this game session?`)) {
                    kickPlayerByHost(playerIndex);
                }
            };
            panel.appendChild(kickBtn);
        }
    }
};

window.onAssignedSlot = function(assignedSlot, difficultyName, currentGameState, connectedSlots, hostW, hostH, isReconnection, elapsed, upgradesMap, chosenUpgradesMap, pendingLevels) {
    console.log(`[Game] Joined room! Assigned Player ${assignedSlot + 1} (Reconnection: ${!!isReconnection})`);
    GAME_STATE.gameMode = 'online';
    GAME_STATE.isOnline = true;
    GAME_STATE.isHost = false;
    GAME_STATE.isClient = true;
    GAME_STATE.difficulty = DIFFICULTIES[difficultyName] || DIFFICULTIES.normal;
    if (hostW) GAME_STATE.hostW = hostW;
    if (hostH) GAME_STATE.hostH = hostH;
    if (typeof resizeCanvas === 'function') resizeCanvas();
    if (elapsed !== undefined) {
        GAME_STATE.elapsed = elapsed;
        gameClock = elapsed;
    }

    // Initialize ONLY the actual connected player slots
    GAME_STATE.players = [];
    const slots = (Array.isArray(connectedSlots) && connectedSlots.length > 0)
        ? connectedSlots
        : [0, assignedSlot];
    for (const s of slots) {
        GAME_STATE.players[s] = new Player(s, PLAYER_DEFS[s]);
    }
    if (upgradesMap) {
        for (const idx in upgradesMap) {
            const p = GAME_STATE.players[idx];
            if (p) {
                p.currentUpgradeOptions = upgradesMap[idx].map(id => UPGRADE_POOL.find(u => u.id === id)).filter(Boolean);
            }
        }
    }
    if (chosenUpgradesMap) {
        for (const idx in chosenUpgradesMap) {
            const p = GAME_STATE.players[idx];
            if (p) {
                p.currentLevelUpgradeName = chosenUpgradesMap[idx];
            }
        }
    }
    if (isReconnection && GAME_STATE.players[assignedSlot]) {
        GAME_STATE.players[assignedSlot].invuln = 3000;
        GAME_STATE.players[assignedSlot].spawnInvuln = 3000;
    }
    recalculateDynamicDifficulty();

    const startMenu = document.getElementById('startMenu');
    if (startMenu) startMenu.classList.remove('show');
    const joinStep = document.getElementById('joinRoomStep');
    if (joinStep) joinStep.style.display = 'none';
    const tBtn = document.getElementById('testingBtn');
    if (tBtn) tBtn.style.display = 'none';

    if (currentGameState === STATES.WEAPON_SELECT || currentGameState === STATES.START_MENU || !isReconnection) {
        startWeaponSelectFlow();
    } else if (currentGameState === STATES.LEVEL_UP) {
        GAME_STATE.current = STATES.LEVEL_UP;
        GAME_STATE.pendingLevels = pendingLevels || 1;
        SoundEngine.setMuffled(true, 0.5);
        const zone = document.getElementById('joystickZone') || (typeof joystickZone !== 'undefined' ? joystickZone : (typeof window !== 'undefined' ? window.joystickZone : null));
        if (zone) zone.style.display = 'none';
        beginSelectionRound();
    } else {
        // Reconnecting to active game session
        GAME_STATE.current = currentGameState || STATES.GAMEPLAY;
        SoundEngine.stopMusic();
        SoundEngine.setMuffled(false);
        const tipEl = document.getElementById('tipText');
        if (tipEl) tipEl.style.display = 'none';
        if (typeof stopTipRotation === 'function') stopTipRotation();
        const inviteBanner = document.getElementById('inviteCodeBanner');
        if (inviteBanner) inviteBanner.style.display = 'none';
        const pauseBtn = document.getElementById('pauseMenuBtn');
        if (pauseBtn) pauseBtn.style.display = 'none';
    }
};

window.onRemoteInputReceived = function(playerIndex, moveX, moveY, angle, dashing) {
    const p = GAME_STATE.players[playerIndex];
    if (p) {
        p.remoteInput = { moveX, moveY, angle, dashing };
        p.facingAngle = angle || p.facingAngle;
        if (dashing && !p.dashing && p.dashEnabled && performance.now() >= p.dashCooldownUntil) {
            p.dashVx = (moveX || Math.cos(p.facingAngle)) * 14;
            p.dashVy = (moveY || Math.sin(p.facingAngle)) * 14;
            p.dashing = true;
            p.dashUntil = performance.now() + 180;
        }
    }
};

window.onRemoteWeaponSelected = function(playerIndex, weaponId) {
    const p = GAME_STATE.players[playerIndex];
    if (p) {
        p.selectedWeapon = weaponId;
        p.selectedWeaponLabel = WEAPON_LABELS[weaponId];
        p.weapons = [];
        p.unlockWeapon(weaponId);

        renderLobbyWeaponPanels();

        const allReady = GAME_STATE.players.length > 0 && GAME_STATE.players.filter(pl => pl && !pl.disconnected).every(pl => pl.selectedWeapon);
        const lobbyStartBtn = document.getElementById('lobbyStartBtn');
        if (lobbyStartBtn) lobbyStartBtn.disabled = !allReady;

        netManager.broadcastLobbyState(
            GAME_STATE.players.filter(pl => pl && !pl.disconnected).map(pl => ({ index: pl.index, selectedWeapon: pl.selectedWeapon, selectedWeaponLabel: pl.selectedWeaponLabel })),
            allReady
        );
    }
};

window.onRemoteUpgradeSelected = function(playerIndex, upgradeId) {
    const p = GAME_STATE.players[playerIndex];
    if (p) {
        const upgrade = UPGRADE_POOL.find(item => item.id === upgradeId);
        if (upgrade) {
            p.currentLevelUpgradeName = upgrade.name;
            upgrade.effect(p);
            if (upgrade.oneShot) p.takenOneShots.add(upgrade.id);
        }
        netManager.broadcast({
            type: 'UPGRADE_CHOSEN_SYNC',
            playerIndex: playerIndex,
            upgradeId: upgradeId,
            upgradeName: upgrade ? upgrade.name : 'Upgrade'
        });
        const panel = document.getElementById(`levelPanel_${playerIndex}`);
        if (panel) {
            onPlayerChose(panel, p);
        } else if (typeof onPlayerChoseVirtual === 'function') {
            onPlayerChoseVirtual(p);
        }
    }
};

window.onUpgradeChosenSync = function(playerIndex, upgradeId, upgradeName) {
    const p = GAME_STATE.players[playerIndex];
    if (p) {
        p.currentLevelUpgradeName = upgradeName;
        if (upgradeId) {
            const upgrade = UPGRADE_POOL.find(item => item.id === upgradeId);
            if (upgrade && (!netManager.isClient || playerIndex !== netManager.localPlayerIndex)) {
                upgrade.effect(p);
                if (upgrade.oneShot) p.takenOneShots.add(upgrade.id);
            }
        }
        const panel = document.getElementById(`levelPanel_${playerIndex}`);
        if (panel) onPlayerChose(panel, p);
    }
};

window.onLobbyStateUpdated = function(playersData, allReady) {
    if (!playersData) return;
    const activeIndices = new Set(playersData.map(pd => pd.index));
    // Clear slots that are no longer connected
    for (let i = 0; i < 4; i++) {
        if (!activeIndices.has(i) && (typeof netManager === 'undefined' || i !== netManager.localPlayerIndex)) {
            delete GAME_STATE.players[i];
        }
    }
    for (const pd of playersData) {
        if (!GAME_STATE.players[pd.index]) {
            GAME_STATE.players[pd.index] = new Player(pd.index, PLAYER_DEFS[pd.index]);
        }
        const p = GAME_STATE.players[pd.index];
        if (p.selectedWeapon !== pd.selectedWeapon) {
            p.selectedWeapon = pd.selectedWeapon;
            p.selectedWeaponLabel = pd.selectedWeaponLabel;
            p.weapons = [];
            if (pd.selectedWeapon) p.unlockWeapon(pd.selectedWeapon);
        }
    }
    renderLobbyWeaponPanels();
};

window.onOnlineCountdownStarted = function(isNewGame) {
    document.getElementById('levelUpLayer').classList.remove('show');
    const tipEl = document.getElementById('tipText');
    if (tipEl) tipEl.style.display = 'none';
    const inviteBanner = document.getElementById('inviteCodeBanner');
    if (inviteBanner) inviteBanner.style.display = 'none';
    if (isNewGame) {
        if (typeof GAME_STATE !== 'undefined') {
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
            GAME_STATE.victoryTriggered = false;
            GAME_STATE.kills = 0;
            GAME_STATE.activeBoss = null;
            GAME_STATE.activeBossStartTime = 0;
            GAME_STATE.hordeStartTime = 0;
        }
        if (typeof clientEnemyCache !== 'undefined') clientEnemyCache.clear();
        if (typeof clientTurretCache !== 'undefined') clientTurretCache.clear();
        if (typeof clientHazardCache !== 'undefined') clientHazardCache.clear();
        if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.clear) SPATIAL_GRID.clear();
        if (typeof resizeCanvas === 'function') resizeCanvas();
        if (typeof ctx !== 'undefined' && ctx && typeof canvas !== 'undefined' && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    startCountdown(isNewGame);
};

let netEntityCounter = 1;
let netGemSyncTick = 0;
const clientEnemyCache = new Map(); // id -> Enemy instance
const clientTurretCache = new Map(); // id -> TurretEntity instance
const clientHazardCache = new Map(); // id -> Hazard instance

// =========================================================================
// HIGH PERFORMANCE BINARY SNAPSHOT CODEC (ArrayBuffer / DataView)
// Zero-allocation serializer & deserializer for low-bandwidth 60fps streaming
// =========================================================================

const BINARY_MAGIC = 0xBF; // 'Blob Format' identifier
const BINARY_VERSION = 1;

let sharedBinaryBuffer = new ArrayBuffer(131072); // Pre-allocated 128 KB buffer
let sharedDataView = new DataView(sharedBinaryBuffer);
let sharedUint8 = new Uint8Array(sharedBinaryBuffer);

function ensureBinaryBufferSize(neededBytes) {
    if (sharedBinaryBuffer.byteLength < neededBytes) {
        let newSize = sharedBinaryBuffer.byteLength * 2;
        while (newSize < neededBytes) newSize *= 2;
        sharedBinaryBuffer = new ArrayBuffer(newSize);
        sharedDataView = new DataView(sharedBinaryBuffer);
        sharedUint8 = new Uint8Array(sharedBinaryBuffer);
    }
}

const ENEMY_TYPE_TO_ID = {
    'swarm': 1, 'brute': 2, 'mega_brute': 3, 'brute_lord': 4,
    'speeder': 5, 'meteor': 6, 'dasher': 7, 'shooter': 8,
    'spiky': 9, 'baneling': 10, 'marauder': 11, 'stalker': 12,
    'zergling': 13, 'spine_crawler': 14, 'sentry': 15, 'medivac': 16,
    'warp_anomaly': 17, 'hellion': 18, 'shield_bearer': 19, 'viper': 20,
    'octopus': 21, 'boss': 21, 'felhound': 22, 'behemoth': 23
};
const ID_TO_ENEMY_TYPE = [
    'swarm', 'swarm', 'brute', 'mega_brute', 'brute_lord',
    'speeder', 'meteor', 'dasher', 'shooter',
    'spiky', 'baneling', 'marauder', 'stalker',
    'zergling', 'spine_crawler', 'sentry', 'medivac',
    'warp_anomaly', 'hellion', 'shield_bearer', 'viper',
    'octopus', 'felhound', 'behemoth'
];

const PROJECTILE_TYPE_TO_ID = {
    'missile': 1, 'fire_ring': 2, 'deflector_shield': 3, 'laser': 4,
    'flail': 5, 'needle': 6, 'acid': 7, 'bullet': 8
};
const ID_TO_PROJECTILE_TYPE = [
    '', 'missile', 'fire_ring', 'deflector_shield', 'laser',
    'flail', 'needle', 'acid', 'bullet'
];

const HAZARD_TYPE_TO_ID = {
    'hazard': 1, 'mine': 2, 'mine_explosion': 3, 'nuke_explosion': 4,
    'freeze_explosion': 5, 'sledge_hit': 6, 'muzzle_flash': 7, 'hit_impact': 8,
    'burning_surface': 9, 'burning_trail': 10, 'laser_trail': 11, 'ice_trail': 12,
    'bile_mortar': 13, 'acid_pool': 14, 'white_hole': 15, 'black_hole': 16
};
const ID_TO_HAZARD_TYPE = [
    'hazard', 'hazard', 'mine', 'mine_explosion', 'nuke_explosion',
    'freeze_explosion', 'sledge_hit', 'muzzle_flash', 'hit_impact',
    'burning_surface', 'burning_trail', 'laser_trail', 'ice_trail',
    'bile_mortar', 'acid_pool', 'white_hole', 'black_hole'
];

const WEAPON_TYPE_TO_ID = {
    'magic_missile': 1, 'orbiting_flames': 2, 'deflector_shield': 3,
    'player_mine': 4, 'player_flail': 5, 'laser_beam': 6,
    'burning_trail': 7, 'ice_trail': 8, 'nuke_strike': 9,
    'turret': 10, 'freeze_blast': 11, 'sledgehammer': 12,
    'acid_flask': 13, 'black_hole': 14, 'white_hole': 15,
    'melee_sweep': 16
};
const ID_TO_WEAPON_TYPE = [
    '', 'magic_missile', 'orbiting_flames', 'deflector_shield',
    'player_mine', 'player_flail', 'laser_beam',
    'burning_trail', 'ice_trail', 'nuke_strike',
    'turret', 'freeze_blast', 'sledgehammer',
    'acid_flask', 'black_hole', 'white_hole',
    'melee_sweep'
];

const BOSS_ID_TO_BYTE = {
    'octopus': 1, 'horde': 2, 'felhound': 3, 'behemoth': 4
};
const BYTE_TO_BOSS_ID = ['', 'octopus', 'horde', 'felhound', 'behemoth'];

const STATE_TO_BYTE = {
    0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6,
    'START_MENU': 0, 'WEAPON_SELECT': 1, 'GAMEPLAY': 2,
    'LEVEL_UP': 3, 'PAUSED': 4, 'GAME_OVER': 5, 'COUNTDOWN': 6
};
const BYTE_TO_STATE = [
    'START_MENU', 'WEAPON_SELECT', 'GAMEPLAY',
    'LEVEL_UP', 'PAUSED', 'GAME_OVER', 'COUNTDOWN'
];

function angleToUint8(a) {
    if (!a) return 0;
    const norm = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round((norm / (Math.PI * 2)) * 255) & 0xFF;
}

function uint8ToAngle(u) {
    return (u / 255) * (Math.PI * 2);
}

function uint8ToBase64(bytes) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return (typeof btoa !== 'undefined') ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

function base64ToUint8(base64) {
    const binary = (typeof atob !== 'undefined') ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function packWorldSnapshotBinary() {
    ensureBinaryBufferSize(65536);
    const view = sharedDataView;
    let offset = 0;

    // Header (32 bytes)
    view.setUint8(offset, BINARY_MAGIC); offset += 1;
    view.setUint8(offset, BINARY_VERSION); offset += 1;

    netGemSyncTick = (netGemSyncTick + 1) % 6;
    const includeGems = (netGemSyncTick === 0 || GAME_STATE.activeBoss);
    let flags = 0;
    if (includeGems) flags |= 1;
    view.setUint8(offset, flags); offset += 1;

    const stateByte = (typeof GAME_STATE !== 'undefined' && STATE_TO_BYTE[GAME_STATE.current] !== undefined) ? STATE_TO_BYTE[GAME_STATE.current] : 2;
    view.setUint8(offset, stateByte); offset += 1;

    view.setUint32(offset, (typeof GAME_STATE !== 'undefined' ? (GAME_STATE.elapsed || 0) : 0), true); offset += 4;
    view.setUint16(offset, (typeof GAME_STATE !== 'undefined' ? (GAME_STATE.level || 1) : 1), true); offset += 2;
    view.setUint32(offset, (typeof GAME_STATE !== 'undefined' ? (GAME_STATE.xp || 0) : 0), true); offset += 4;
    view.setUint32(offset, (typeof GAME_STATE !== 'undefined' ? (GAME_STATE.nextXp || 100) : 100), true); offset += 4;
    view.setUint16(offset, (typeof GAME_STATE !== 'undefined' ? (GAME_STATE.kills || 0) : 0), true); offset += 2;
    view.setUint16(offset, (typeof W !== 'undefined' ? W : 1562), true); offset += 2;
    view.setUint16(offset, (typeof H !== 'undefined' ? H : 950), true); offset += 2;

    const bossByte = (typeof GAME_STATE !== 'undefined' && GAME_STATE.activeBoss) ? (BOSS_ID_TO_BYTE[GAME_STATE.activeBoss] || 0) : 0;
    view.setUint8(offset, bossByte); offset += 1;
    view.setUint32(offset, (typeof GAME_STATE !== 'undefined' ? (GAME_STATE.activeBossStartTime || 0) : 0), true); offset += 4;
    view.setUint32(offset, (typeof GAME_STATE !== 'undefined' ? (GAME_STATE.hordeStartTime || 0) : 0), true); offset += 4;

    // 1. Players
    const players = (typeof GAME_STATE !== 'undefined' && GAME_STATE.players) ? GAME_STATE.players : [];
    view.setUint8(offset, players.length); offset += 1;
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const flail = p.weapons ? p.weapons.find(w => w.id === 'player_flail') : null;
        const melee = p.weapons ? p.weapons.find(w => w.id === 'melee_sweep') : null;

        view.setUint8(offset, p.index !== undefined ? p.index : i); offset += 1;
        view.setInt16(offset, Math.round(p.x || 0), true); offset += 2;
        view.setInt16(offset, Math.round(p.y || 0), true); offset += 2;
        view.setUint16(offset, Math.min(65535, Math.round((p.hp || 0) * 10)), true); offset += 2;
        view.setUint16(offset, Math.min(65535, Math.round(p.maxHp || 100)), true); offset += 2;
        view.setUint8(offset, angleToUint8(p.facingAngle)); offset += 1;

        let pFlags = 0;
        if (p.alive) pFlags |= (1 << 0);
        if (p.isMoving) pFlags |= (1 << 1);
        if (p.martyrdomAuraEnabled) pFlags |= (1 << 2);
        if (p.martyrsPresenceEnabled) pFlags |= (1 << 3);
        if (p.disconnected || p.kicked) pFlags |= (1 << 4);
        if (flail) pFlags |= (1 << 5);
        if (p.sledgeHammerAnimation) pFlags |= (1 << 6);
        const upName = p.currentLevelUpgradeName || '';
        if (upName.length > 0) pFlags |= (1 << 7);
        view.setUint8(offset, pFlags); offset += 1;

        const weaponId = WEAPON_TYPE_TO_ID[p.selectedWeapon] || 0;
        view.setUint8(offset, weaponId); offset += 1;

        const curTime = (typeof gameClock !== 'undefined' ? gameClock : (typeof performance !== 'undefined' ? performance.now() : 0));
        const cv = (p.campervanUntil > curTime) ? Math.round(p.campervanUntil) : 0;
        view.setUint32(offset, cv, true); offset += 4;

        const iv = p.invuln > 0 ? Math.round(p.invuln) : (p.spawnInvuln > 0 ? Math.round(p.spawnInvuln) : 0);
        view.setUint16(offset, Math.min(65535, iv), true); offset += 2;

        const mf = (melee && melee.lastFire > 0) ? Math.round(melee.lastFire) : 0;
        view.setUint32(offset, mf, true); offset += 4;

        const mrm = Math.min(255, Math.round((p.meleeRangeModifier || 1.0) * 50));
        view.setUint8(offset, mrm); offset += 1;

        if (flail) {
            view.setInt16(offset, Math.round(flail.x || 0), true); offset += 2;
            view.setInt16(offset, Math.round(flail.y || 0), true); offset += 2;
        }
        if (p.sledgeHammerAnimation) {
            view.setUint32(offset, Math.round(p.sledgeHammerAnimation.startTime || 0), true); offset += 4;
            view.setUint16(offset, Math.min(65535, Math.round(p.sledgeHammerAnimation.duration || 0)), true); offset += 2;
            view.setUint8(offset, angleToUint8(p.sledgeHammerAnimation.angle)); offset += 1;
        }
        if (upName.length > 0) {
            const upLen = Math.min(64, upName.length);
            view.setUint8(offset, upLen); offset += 1;
            for (let j = 0; j < upLen; j++) {
                sharedUint8[offset++] = upName.charCodeAt(j) & 0xFF;
            }
        }
    }

    // 2. Enemies
    const aliveEnemies = (typeof GAME_STATE !== 'undefined' && GAME_STATE.enemies) ? GAME_STATE.enemies.filter(e => e.alive && e.hp > 0) : [];
    view.setUint16(offset, aliveEnemies.length, true); offset += 2;
    for (let i = 0; i < aliveEnemies.length; i++) {
        const e = aliveEnemies[i];
        if (!e._nid) e._nid = ++netEntityCounter;

        view.setUint16(offset, e._nid, true); offset += 2;
        const typeId = ENEMY_TYPE_TO_ID[e.type] || 1;
        view.setUint8(offset, typeId); offset += 1;
        view.setInt16(offset, Math.round(e.x || 0), true); offset += 2;
        view.setInt16(offset, Math.round(e.y || 0), true); offset += 2;
        view.setUint16(offset, Math.min(65535, Math.round(e.hp || 0)), true); offset += 2;
        view.setUint16(offset, Math.min(65535, Math.round(e.maxHp || 100)), true); offset += 2;
        view.setUint8(offset, angleToUint8(e.facingAngle)); offset += 1;

        let eFlags = 0;
        if (e.airborne) eFlags |= (1 << 0);
        if (e.r && e.r !== 15) eFlags |= (1 << 1);
        if (e.shieldRadius) eFlags |= (1 << 2);
        if (e.landY || e.landAt) eFlags |= (1 << 3);
        view.setUint8(offset, eFlags); offset += 1;

        if (eFlags & (1 << 1)) {
            view.setUint8(offset, Math.min(255, Math.round(e.r))); offset += 1;
        }
        if (eFlags & (1 << 2)) {
            view.setUint8(offset, Math.min(255, Math.round(e.shieldRadius))); offset += 1;
        }
        if (eFlags & (1 << 3)) {
            view.setInt16(offset, Math.round(e.landY || 0), true); offset += 2;
            view.setUint32(offset, Math.round(e.landAt || 0), true); offset += 4;
        }
    }

    // 3. Projectiles
    const projectiles = (typeof GAME_STATE !== 'undefined' && GAME_STATE.projectiles) ? GAME_STATE.projectiles : [];
    view.setUint16(offset, projectiles.length, true); offset += 2;
    for (let i = 0; i < projectiles.length; i++) {
        const p = projectiles[i];
        const t = (p instanceof OrbitProjectile) ? 'fire_ring' : (p instanceof DeflectorOrbiter ? 'deflector_shield' : (p.type || 'missile'));
        const typeId = PROJECTILE_TYPE_TO_ID[t] || 1;
        view.setUint8(offset, typeId); offset += 1;
        view.setInt16(offset, Math.round(p.x || 0), true); offset += 2;
        view.setInt16(offset, Math.round(p.y || 0), true); offset += 2;
        view.setUint8(offset, Math.min(255, Math.round(p.r || 3))); offset += 1;
        view.setUint8(offset, angleToUint8(p.angle)); offset += 1;

        let pFlags = 0;
        if (p instanceof OrbitProjectile && p.player && p.player.mineRingEnabled) pFlags |= (1 << 0);
        if (p.targetX !== undefined || p.targetY !== undefined) pFlags |= (1 << 1);
        if (p.startX !== undefined || p.startY !== undefined) pFlags |= (1 << 2);
        const pIndex = (p.player && p.player.index !== undefined) ? (p.player.index & 3) : 0;
        pFlags |= (pIndex << 3);
        view.setUint8(offset, pFlags); offset += 1;

        if (pFlags & (1 << 1)) {
            view.setInt16(offset, Math.round(p.targetX || 0), true); offset += 2;
            view.setInt16(offset, Math.round(p.targetY || 0), true); offset += 2;
        }
        if (pFlags & (1 << 2)) {
            view.setInt16(offset, Math.round(p.startX || 0), true); offset += 2;
            view.setInt16(offset, Math.round(p.startY || 0), true); offset += 2;
        }
    }

    // 4. Enemy Projectiles
    const enemyProjectiles = (typeof GAME_STATE !== 'undefined' && GAME_STATE.enemyProjectiles) ? GAME_STATE.enemyProjectiles : [];
    view.setUint16(offset, enemyProjectiles.length, true); offset += 2;
    for (let i = 0; i < enemyProjectiles.length; i++) {
        const ep = enemyProjectiles[i];
        view.setInt16(offset, Math.round(ep.x || 0), true); offset += 2;
        view.setInt16(offset, Math.round(ep.y || 0), true); offset += 2;
        view.setUint8(offset, Math.min(255, Math.round(ep.r || 4))); offset += 1;
    }

    // 5. Gems (if flag bit 0)
    if (includeGems) {
        const gems = (typeof GAME_STATE !== 'undefined' && GAME_STATE.gems) ? GAME_STATE.gems : [];
        view.setUint16(offset, gems.length, true); offset += 2;
        for (let i = 0; i < gems.length; i++) {
            const g = gems[i];
            view.setInt16(offset, Math.round(g.x || 0), true); offset += 2;
            view.setInt16(offset, Math.round(g.y || 0), true); offset += 2;
            view.setUint8(offset, Math.min(255, Math.round(g.value || 5))); offset += 1;

            let spType = 0;
            if (g instanceof HealthPack) spType = 1;
            else if (g instanceof SupplyDrop) spType = (g.type || 1) + 1;
            view.setUint8(offset, spType); offset += 1;
        }
    }

    // 6. Turrets
    const turrets = (typeof GAME_STATE !== 'undefined' && GAME_STATE.turrets) ? GAME_STATE.turrets : [];
    view.setUint8(offset, turrets.length); offset += 1;
    for (let i = 0; i < turrets.length; i++) {
        const t = turrets[i];
        if (!t._nid) t._nid = ++netEntityCounter;
        view.setUint16(offset, t._nid, true); offset += 2;
        view.setInt16(offset, Math.round(t.x || 0), true); offset += 2;
        view.setInt16(offset, Math.round(t.y || 0), true); offset += 2;
        view.setUint8(offset, angleToUint8(t.angle)); offset += 1;
        view.setUint8(offset, angleToUint8(t.flameAngle)); offset += 1;
        view.setUint16(offset, Math.min(65535, Math.round(t.hp || 0)), true); offset += 2;
        view.setUint16(offset, Math.min(65535, Math.round(t.maxHp || 100)), true); offset += 2;
        view.setUint8(offset, (t.player && t.player.index !== undefined) ? t.player.index : (t.playerIndex || 0)); offset += 1;
        view.setUint32(offset, Math.round(t.spawnTime || 0), true); offset += 4;

        let tFlags = 0;
        if (t.isFlamethrower) tFlags |= (1 << 0);
        if (t.flameActiveUntil) tFlags |= (1 << 1);
        view.setUint8(offset, tFlags); offset += 1;

        if (tFlags & (1 << 1)) {
            view.setUint32(offset, Math.round(t.flameActiveUntil || 0), true); offset += 4;
            view.setUint8(offset, angleToUint8(t.flameCenterAngle)); offset += 1;
        }
    }

    // 7. Hazards
    const hazards = (typeof GAME_STATE !== 'undefined' && GAME_STATE.hazards) ? GAME_STATE.hazards : [];
    view.setUint16(offset, hazards.length, true); offset += 2;
    for (let i = 0; i < hazards.length; i++) {
        const h = hazards[i];
        if (!h._nid) h._nid = ++netEntityCounter;

        let type = 'hazard';
        if (h instanceof PlayerMine) type = 'mine';
        else if (h instanceof MineExplosion) type = 'mine_explosion';
        else if (h instanceof NukeExplosion) type = 'nuke_explosion';
        else if (h instanceof FreezeBlastVisual) type = 'freeze_explosion';
        else if (h instanceof SledgeHitVisual) type = 'sledge_hit';
        else if (h instanceof InstantMuzzleFlash) type = 'muzzle_flash';
        else if (h instanceof InstantHitImpact) type = 'hit_impact';
        else if (h instanceof BurningSurface) type = 'burning_surface';
        else if (h instanceof BurningTrailSegment) type = 'burning_trail';
        else if (h instanceof LaserTrailSegment) type = 'laser_trail';
        else if (h instanceof IceTrailSegment) type = 'ice_trail';
        else if (h instanceof BileMortarPod) type = 'bile_mortar';
        else if (h instanceof AcidPoolHazard) type = 'acid_pool';
        else if (h instanceof WhiteHolePush) type = 'white_hole';
        else if (h instanceof BlackHolePull) type = 'black_hole';
        else if (h.type) type = h.type;

        view.setUint16(offset, h._nid, true); offset += 2;
        const typeId = HAZARD_TYPE_TO_ID[type] || 1;
        view.setUint8(offset, typeId); offset += 1;

        const hx = Math.round(h.x !== undefined ? h.x : (h.x1 || 0));
        const hy = Math.round(h.y !== undefined ? h.y : (h.y1 || 0));
        view.setInt16(offset, hx, true); offset += 2;
        view.setInt16(offset, hy, true); offset += 2;
        view.setUint8(offset, Math.min(255, Math.round(h.r || h.radius || 15))); offset += 1;
        view.setUint8(offset, angleToUint8(h.angle || h.facingAngle || 0)); offset += 1;
        view.setUint8(offset, (h.player && h.player.index !== undefined) ? h.player.index : 0); offset += 1;
        view.setUint32(offset, Math.round(h.spawnTime || 0), true); offset += 4;

        const hasX2Y2 = (h.x2 !== undefined || h.targetX !== undefined);
        let hFlags = 0;
        if (hasX2Y2) hFlags |= (1 << 0);
        if (h.coneAngle !== undefined) hFlags |= (1 << 1);
        if (h.duration !== undefined) hFlags |= (1 << 2);
        if (h.landTime !== undefined) hFlags |= (1 << 3);
        if (h.triggeredTime) hFlags |= (1 << 4);
        view.setUint8(offset, hFlags); offset += 1;

        if (hFlags & (1 << 0)) {
            const hx2 = Math.round(h.x2 !== undefined ? h.x2 : (h.targetX || 0));
            const hy2 = Math.round(h.y2 !== undefined ? h.y2 : (h.targetY || 0));
            view.setInt16(offset, hx2, true); offset += 2;
            view.setInt16(offset, hy2, true); offset += 2;
        }
        if (hFlags & (1 << 1)) {
            view.setUint8(offset, Math.min(255, Math.round((h.coneAngle || 0) * 50))); offset += 1;
        }
        if (hFlags & (1 << 2)) {
            view.setUint16(offset, Math.min(65535, Math.round(h.duration || 0)), true); offset += 2;
        }
        if (hFlags & (1 << 3)) {
            view.setUint32(offset, Math.round(h.landTime || 0), true); offset += 4;
        }
    }

    // 8. Terrains
    const terrains = (typeof GAME_STATE !== 'undefined' && GAME_STATE.terrains) ? GAME_STATE.terrains : [];
    view.setUint8(offset, terrains.length); offset += 1;
    for (let i = 0; i < terrains.length; i++) {
        const t = terrains[i];
        view.setInt16(offset, Math.round(t.x || 0), true); offset += 2;
        view.setInt16(offset, Math.round(t.y || 0), true); offset += 2;
        view.setUint8(offset, Math.min(255, Math.round(t.radius || t.r || 0))); offset += 1;
        view.setUint8(offset, angleToUint8(t.facingAngle)); offset += 1;
    }

    return sharedBinaryBuffer.slice(0, offset);
}

function unpackWorldSnapshotBinary(buffer) {
    if (!buffer) return null;
    try {
        const rawBuf = (buffer instanceof ArrayBuffer) ? buffer : (buffer.buffer || buffer);
        const byteOffset = (buffer.byteOffset !== undefined) ? buffer.byteOffset : 0;
        const byteLength = (buffer.byteLength !== undefined) ? buffer.byteLength : (rawBuf ? rawBuf.byteLength : 0);
        if (!rawBuf || byteLength < 33) return null;

        const view = new DataView(rawBuf, byteOffset, byteLength);
        const u8 = new Uint8Array(rawBuf, byteOffset, byteLength);
        let offset = 0;

        const magic = view.getUint8(offset); offset += 1;
        if (magic !== BINARY_MAGIC) return null;
        const version = view.getUint8(offset); offset += 1;
        const flags = view.getUint8(offset); offset += 1;
        const hasGems = (flags & 1) !== 0;

        const stateByte = view.getUint8(offset); offset += 1;
        const currentGameState = (typeof STATES !== 'undefined' && BYTE_TO_STATE[stateByte] && STATES[BYTE_TO_STATE[stateByte]] !== undefined)
            ? STATES[BYTE_TO_STATE[stateByte]]
            : (typeof STATES !== 'undefined' ? STATES.GAMEPLAY : 2);

        const elapsed = view.getUint32(offset, true); offset += 4;
        const level = view.getUint16(offset, true); offset += 2;
        const xp = view.getUint32(offset, true); offset += 4;
        const nextXp = view.getUint32(offset, true); offset += 4;
        const kills = view.getUint16(offset, true); offset += 2;
        const hostW = view.getUint16(offset, true); offset += 2;
        const hostH = view.getUint16(offset, true); offset += 2;

        const bossByte = view.getUint8(offset); offset += 1;
        const activeBoss = BYTE_TO_BOSS_ID[bossByte] || null;
        const activeBossStartTime = view.getUint32(offset, true); offset += 4;
        const hordeStartTime = view.getUint32(offset, true); offset += 4;

        // 1. Players
        const playerCount = view.getUint8(offset); offset += 1;
        const players = [];
        for (let i = 0; i < playerCount; i++) {
            const idx = view.getUint8(offset); offset += 1;
            const x = view.getInt16(offset, true); offset += 2;
            const y = view.getInt16(offset, true); offset += 2;
            const hp = view.getUint16(offset, true) / 10; offset += 2;
            const mhp = view.getUint16(offset, true); offset += 2;
            const fa = Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100; offset += 1;

            const pFlags = view.getUint8(offset); offset += 1;
            const al = (pFlags & (1 << 0)) ? 1 : 0;
            const mv = (pFlags & (1 << 1)) ? 1 : 0;
            const ma = (pFlags & (1 << 2)) ? 1 : 0;
            const mp = (pFlags & (1 << 3)) ? 1 : 0;
            const dc = (pFlags & (1 << 4)) ? 1 : 0;
            const hasFlail = (pFlags & (1 << 5)) !== 0;
            const hasSledge = (pFlags & (1 << 6)) !== 0;
            const hasUpName = (pFlags & (1 << 7)) !== 0;

            const weaponIdByte = view.getUint8(offset); offset += 1;
            const w = ID_TO_WEAPON_TYPE[weaponIdByte] || '';
            const wl = (typeof WEAPON_LABELS !== 'undefined' && WEAPON_LABELS[w]) ? WEAPON_LABELS[w] : '';

            const cv = view.getUint32(offset, true); offset += 4;
            const iv = view.getUint16(offset, true); offset += 2;
            const mf = view.getUint32(offset, true); offset += 4;
            const mrm = view.getUint8(offset) / 50; offset += 1;

            let fx = undefined, fy = undefined;
            if (hasFlail) {
                fx = view.getInt16(offset, true); offset += 2;
                fy = view.getInt16(offset, true); offset += 2;
            }
            let sh = undefined;
            if (hasSledge) {
                const st = view.getUint32(offset, true); offset += 4;
                const du = view.getUint16(offset, true); offset += 2;
                const a = Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100; offset += 1;
                sh = { st, du, a };
            }
            let up = '';
            if (hasUpName) {
                const upLen = view.getUint8(offset); offset += 1;
                for (let j = 0; j < upLen; j++) {
                    up += String.fromCharCode(u8[offset++]);
                }
            }

            players.push({
                i: idx, x, y, hp, mhp, al, fa, mv, w, wl, up, cv, iv, ma, mp, dc, fx, fy, mf, mrm, sh
            });
        }

        // 2. Enemies (compact flat tuples: [id, type, x, y, hp, mhp, fa, r, color, state, shieldRadius, airborne, landY, landAt])
        const enemyCount = view.getUint16(offset, true); offset += 2;
        const enemies = [];
        for (let i = 0; i < enemyCount; i++) {
            const id = view.getUint16(offset, true); offset += 2;
            const typeId = view.getUint8(offset); offset += 1;
            const type = ID_TO_ENEMY_TYPE[typeId] || 'swarm';
            const x = view.getInt16(offset, true); offset += 2;
            const y = view.getInt16(offset, true); offset += 2;
            const hp = view.getUint16(offset, true); offset += 2;
            const mhp = view.getUint16(offset, true); offset += 2;
            const fa = Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100; offset += 1;

            const eFlags = view.getUint8(offset); offset += 1;
            const ab = (eFlags & (1 << 0)) ? 1 : 0;
            let r = 0, sr = 0, ly = 0, la = 0;
            if (eFlags & (1 << 1)) {
                r = view.getUint8(offset); offset += 1;
            }
            if (eFlags & (1 << 2)) {
                sr = view.getUint8(offset); offset += 1;
            }
            if (eFlags & (1 << 3)) {
                ly = view.getInt16(offset, true); offset += 2;
                la = view.getUint32(offset, true); offset += 4;
            }

            enemies.push([id, type, x, y, hp, mhp, fa, r, '', '', sr, ab, ly, la]);
        }

        // 3. Projectiles (compact flat tuples)
        const projectileCount = view.getUint16(offset, true); offset += 2;
        const projectiles = [];
        for (let i = 0; i < projectileCount; i++) {
            const typeId = view.getUint8(offset); offset += 1;
            const t = ID_TO_PROJECTILE_TYPE[typeId] || 'missile';
            const x = view.getInt16(offset, true); offset += 2;
            const y = view.getInt16(offset, true); offset += 2;
            const r = view.getUint8(offset); offset += 1;
            const a = Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100; offset += 1;

            const pFlags = view.getUint8(offset); offset += 1;
            const mr = (pFlags & (1 << 0)) ? 1 : 0;
            const hasTarget = (pFlags & (1 << 1)) !== 0;
            const hasStart = (pFlags & (1 << 2)) !== 0;
            const pi = (pFlags >> 3) & 3;

            let tx = 0, ty = 0, sx = 0, sy = 0;
            if (hasTarget) {
                tx = view.getInt16(offset, true); offset += 2;
                ty = view.getInt16(offset, true); offset += 2;
            }
            if (hasStart) {
                sx = view.getInt16(offset, true); offset += 2;
                sy = view.getInt16(offset, true); offset += 2;
            }

            const c = (t === 'fire_ring') ? '#ff6600' : (t === 'deflector_shield' ? '#00e5ff' : '#00ffcc');
            projectiles.push([t, x, y, r, c, a, tx, ty, sx, sy, mr, pi]);
        }

        // 4. Enemy Projectiles
        const enemyProjectileCount = view.getUint16(offset, true); offset += 2;
        const enemyProjectiles = [];
        for (let i = 0; i < enemyProjectileCount; i++) {
            const x = view.getInt16(offset, true); offset += 2;
            const y = view.getInt16(offset, true); offset += 2;
            const r = view.getUint8(offset); offset += 1;
            enemyProjectiles.push([x, y, r, '#ff3344']);
        }

        // 5. Gems
        let gems = undefined;
        if (hasGems) {
            const gemCount = view.getUint16(offset, true); offset += 2;
            gems = [];
            for (let i = 0; i < gemCount; i++) {
                const x = view.getInt16(offset, true); offset += 2;
                const y = view.getInt16(offset, true); offset += 2;
                const v = view.getUint8(offset); offset += 1;
                const spType = view.getUint8(offset); offset += 1;

                const isHp = (spType === 1) ? 1 : 0;
                const isSd = (spType >= 2) ? (spType - 1) : 0;
                if (isHp || isSd) {
                    gems.push([x, y, v, isHp, isSd]);
                } else {
                    gems.push([x, y, v]);
                }
            }
        }

        // 6. Turrets
        const turretCount = view.getUint8(offset); offset += 1;
        const turrets = [];
        for (let i = 0; i < turretCount; i++) {
            const id = view.getUint16(offset, true); offset += 2;
            const x = view.getInt16(offset, true); offset += 2;
            const y = view.getInt16(offset, true); offset += 2;
            const a = Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100; offset += 1;
            const fa = Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100; offset += 1;
            const hp = view.getUint16(offset, true); offset += 2;
            const mhp = view.getUint16(offset, true); offset += 2;
            const pi = view.getUint8(offset); offset += 1;
            const st = view.getUint32(offset, true); offset += 4;

            const tFlags = view.getUint8(offset); offset += 1;
            const fl = (tFlags & (1 << 0)) ? 1 : 0;
            let faU = 0, fcA = 0;
            if (tFlags & (1 << 1)) {
                faU = view.getUint32(offset, true); offset += 4;
                fcA = Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100; offset += 1;
            }

            turrets.push({ id, x, y, a, fa, hp, mhp, pi, st, fl, faU, fcA });
        }

        // 7. Hazards
        const hazardCount = view.getUint16(offset, true); offset += 2;
        const hazards = [];
        for (let i = 0; i < hazardCount; i++) {
            const id = view.getUint16(offset, true); offset += 2;
            const typeId = view.getUint8(offset); offset += 1;
            const t = ID_TO_HAZARD_TYPE[typeId] || 'hazard';
            const x = view.getInt16(offset, true); offset += 2;
            const y = view.getInt16(offset, true); offset += 2;
            const r = view.getUint8(offset); offset += 1;
            const a = Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100; offset += 1;
            const pi = view.getUint8(offset); offset += 1;
            const st = view.getUint32(offset, true); offset += 4;

            const hFlags = view.getUint8(offset); offset += 1;
            let x2 = undefined, y2 = undefined, ca = undefined, dur = undefined, lt = undefined;
            if (hFlags & (1 << 0)) {
                x2 = view.getInt16(offset, true); offset += 2;
                y2 = view.getInt16(offset, true); offset += 2;
            }
            if (hFlags & (1 << 1)) {
                ca = view.getUint8(offset) / 50; offset += 1;
            }
            if (hFlags & (1 << 2)) {
                dur = view.getUint16(offset, true); offset += 2;
            }
            if (hFlags & (1 << 3)) {
                lt = view.getUint32(offset, true); offset += 4;
            }
            const tr = (hFlags & (1 << 4)) ? 1 : 0;

            hazards.push({ id, t, x, y, x2, y2, r, a, ca, st, dur, lt, tr, pi });
        }

        // 8. Terrains
        const terrainCount = view.getUint8(offset); offset += 1;
        const terrains = [];
        for (let i = 0; i < terrainCount; i++) {
            const x = view.getInt16(offset, true); offset += 2;
            const y = view.getInt16(offset, true); offset += 2;
            const r = view.getUint8(offset); offset += 1;
            const fa = Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100; offset += 1;
            terrains.push({ x, y, r, fa });
        }

        return {
            players,
            enemies,
            projectiles,
            enemyProjectiles,
            gems,
            turrets,
            hazards,
            terrains,
            elapsed,
            level,
            xp,
            nextXp,
            kills,
            activeBoss,
            activeBossStartTime,
            hordeStartTime,
            hostW,
            hostH,
            currentGameState
        };
    } catch (err) {
        console.warn('[Net] unpackWorldSnapshotBinary failed:', err);
        return null;
    }
}

function serializeWorldForNetwork() {
    return packWorldSnapshotBinary();
}

function serializeWorldForNetworkJSON() {
    // 1. Players
    const players = GAME_STATE.players.map(p => {
        const flail = p.weapons ? p.weapons.find(w => w.id === 'player_flail') : null;
        const melee = p.weapons ? p.weapons.find(w => w.id === 'melee_sweep') : null;
        return {
            i: p.index,
            x: Math.round(p.x),
            y: Math.round(p.y),
            hp: Math.round(p.hp * 10) / 10,
            mhp: p.maxHp,
            al: p.alive ? 1 : 0,
            fa: Math.round(p.facingAngle * 100) / 100,
            mv: p.isMoving ? 1 : 0,
            w: p.selectedWeapon || '',
            wl: p.selectedWeaponLabel || '',
            up: p.currentLevelUpgradeName || '',
            cv: (p.campervanUntil > (typeof gameClock !== 'undefined' ? gameClock : (typeof performance !== 'undefined' ? performance.now() : 0))) ? Math.round(p.campervanUntil) : 0,
            iv: p.invuln > 0 ? Math.round(p.invuln) : (p.spawnInvuln > 0 ? Math.round(p.spawnInvuln) : 0),
            ma: p.martyrdomAuraEnabled ? 1 : 0,
            mp: p.martyrsPresenceEnabled ? 1 : 0,
            dc: (p.disconnected || p.kicked) ? 1 : 0,
            fx: flail ? Math.round(flail.x) : undefined,
            fy: flail ? Math.round(flail.y) : undefined,
            mf: (melee && melee.lastFire > 0) ? Math.round(melee.lastFire) : 0,
            mrm: p.meleeRangeModifier || 1.0,
            sh: p.sledgeHammerAnimation ? {
                st: Math.round(p.sledgeHammerAnimation.startTime),
                du: Math.round(p.sledgeHammerAnimation.duration),
                a: Math.round(p.sledgeHammerAnimation.angle * 100) / 100
            } : undefined
        };
    });

    // 2. Enemies: compact flat tuples [id, type, x, y, hp, mhp, fa, r, color, state, shieldRadius, airborne, landY, landAt]
    const enemies = GAME_STATE.enemies.filter(e => e.alive && e.hp > 0).map(e => {
        if (!e._nid) e._nid = ++netEntityCounter;
        const fa = Math.round((e.facingAngle || 0) * 100) / 100;
        const r = e.r || 0;
        const c = e.color || '';
        const st = e.viperState || e.stalkerState || '';
        const sr = e.shieldRadius || 0;
        const ab = e.airborne ? 1 : 0;
        const ly = Math.round(e.landY || 0);
        const la = Math.round(e.landAt || 0);

        if (!r && !c && !st && !sr && !ab && !ly && !la) {
            return [e._nid, e.type, Math.round(e.x), Math.round(e.y), Math.round(e.hp), e.maxHp, fa];
        }
        return [e._nid, e.type, Math.round(e.x), Math.round(e.y), Math.round(e.hp), e.maxHp, fa, r, c, st, sr, ab, ly, la];
    });

    // 3. Projectiles: compact flat tuples [type, x, y, r, color, angle, tx, ty, sx, sy, mr, pi]
    const projectiles = GAME_STATE.projectiles.map(p => {
        const t = (p instanceof OrbitProjectile) ? 'fire_ring' : (p instanceof DeflectorOrbiter ? 'deflector_shield' : (p.type || ''));
        const c = (p instanceof OrbitProjectile) ? '#ff6600' : (p instanceof DeflectorOrbiter ? '#00e5ff' : (p.color || '#00ffcc'));
        const r = p.r || (p instanceof OrbitProjectile ? 10 : 3);
        const a = Math.round((p.angle || 0) * 100) / 100;
        const tx = p.targetX !== undefined ? Math.round(p.targetX) : 0;
        const ty = p.targetY !== undefined ? Math.round(p.targetY) : 0;
        const sx = p.startX !== undefined ? Math.round(p.startX) : 0;
        const sy = p.startY !== undefined ? Math.round(p.startY) : 0;
        const mr = (p instanceof OrbitProjectile && p.player && p.player.mineRingEnabled) ? 1 : 0;
        const pi = (p.player && p.player.index !== undefined) ? p.player.index : 0;

        if (!tx && !ty && !sx && !sy && !mr && !pi) {
            return [t, Math.round(p.x), Math.round(p.y), r, c, a];
        }
        return [t, Math.round(p.x), Math.round(p.y), r, c, a, tx, ty, sx, sy, mr, pi];
    });

    // 4. Enemy Projectiles: compact flat tuples [x, y, r, color]
    const enemyProjectiles = GAME_STATE.enemyProjectiles.map(ep => [
        Math.round(ep.x),
        Math.round(ep.y),
        ep.r || 4,
        ep.color || '#ff3344'
    ]);

    // 5. Gems, Health Packs & Supply Drops (sync every 6 network ticks to save 80%+ bandwidth on static gems)
    let gems = undefined;
    netGemSyncTick = (netGemSyncTick + 1) % 6;
    if (netGemSyncTick === 0 || GAME_STATE.activeBoss) {
        gems = GAME_STATE.gems.map(g => {
            const isHp = (g instanceof HealthPack) ? 1 : 0;
            const isSd = (g instanceof SupplyDrop) ? g.type : 0;
            if (isHp || isSd) {
                return [Math.round(g.x), Math.round(g.y), g.value || 5, isHp, isSd];
            }
            return [Math.round(g.x), Math.round(g.y), g.value || 5];
        });
    }

    // 6. Turrets
    const turrets = GAME_STATE.turrets.map(t => {
        if (!t._nid) t._nid = ++netEntityCounter;
        return {
            id: t._nid,
            x: Math.round(t.x),
            y: Math.round(t.y),
            a: Math.round((t.angle || 0) * 100) / 100,
            fa: Math.round((t.flameAngle || 0) * 100) / 100,
            hp: Math.round(t.hp),
            mhp: t.maxHp,
            pi: (t.player && t.player.index !== undefined) ? t.player.index : (t.playerIndex || 0),
            st: t.spawnTime || 0,
            fl: t.isFlamethrower ? 1 : 0,
            faU: t.flameActiveUntil ? Math.round(t.flameActiveUntil) : 0,
            fcA: t.flameCenterAngle ? Math.round(t.flameCenterAngle * 100) / 100 : 0
        };
    });

    // 7. Hazards, Mines & Visual Explosion FX
    const hazards = GAME_STATE.hazards.map(h => {
        if (!h._nid) h._nid = ++netEntityCounter;
        let type = 'hazard';
        if (h instanceof PlayerMine) type = 'mine';
        else if (h instanceof MineExplosion) type = 'mine_explosion';
        else if (h instanceof NukeExplosion) type = 'nuke_explosion';
        else if (h instanceof FreezeBlastVisual) type = 'freeze_explosion';
        else if (h instanceof SledgeHitVisual) type = 'sledge_hit';
        else if (h instanceof InstantMuzzleFlash) type = 'muzzle_flash';
        else if (h instanceof InstantHitImpact) type = 'hit_impact';
        else if (h instanceof BurningSurface) type = 'burning_surface';
        else if (h instanceof BurningTrailSegment) type = 'burning_trail';
        else if (h instanceof LaserTrailSegment) type = 'laser_trail';
        else if (h instanceof IceTrailSegment) type = 'ice_trail';
        else if (h instanceof BileMortarPod) type = 'bile_mortar';
        else if (h instanceof AcidPoolHazard) type = 'acid_pool';
        else if (h instanceof WhiteHolePush) type = 'white_hole';
        else if (h instanceof BlackHolePull) type = 'black_hole';
        else if (h.type) type = h.type;

        return {
            id: h._nid,
            t: type,
            x: Math.round(h.x !== undefined ? h.x : (h.x1 || 0)),
            y: Math.round(h.y !== undefined ? h.y : (h.y1 || 0)),
            x2: h.x2 !== undefined ? Math.round(h.x2) : (h.targetX !== undefined ? Math.round(h.targetX) : undefined),
            y2: h.y2 !== undefined ? Math.round(h.y2) : (h.targetY !== undefined ? Math.round(h.targetY) : undefined),
            r: Math.round(h.r || h.radius || 15),
            a: Math.round((h.angle || h.facingAngle || 0) * 100) / 100,
            ca: h.coneAngle !== undefined ? Math.round(h.coneAngle * 100) / 100 : undefined,
            c: h.color || undefined,
            st: h.spawnTime || 0,
            dur: h.duration || undefined,
            lt: h.landTime || undefined,
            tr: h.triggeredTime ? 1 : 0,
            pi: (h.player && h.player.index !== undefined) ? h.player.index : 0
        };
    });

    const terrains = (GAME_STATE.terrains || []).map(t => ({
        x: Math.round(t.x),
        y: Math.round(t.y),
        r: Math.round(t.radius || t.r || 0),
        fa: Math.round((t.facingAngle || 0) * 100) / 100
    }));

    return {
        players,
        enemies,
        projectiles,
        enemyProjectiles,
        gems,
        turrets,
        hazards,
        terrains,
        elapsed: GAME_STATE.elapsed,
        level: GAME_STATE.level,
        xp: GAME_STATE.xp,
        nextXp: GAME_STATE.nextXp,
        kills: GAME_STATE.kills,
        activeBoss: GAME_STATE.activeBoss,
        activeBossStartTime: GAME_STATE.activeBossStartTime,
        hordeStartTime: GAME_STATE.hordeStartTime,
        hostW: W,
        hostH: H,
        currentGameState: GAME_STATE.current
    };
}

const NetworkProjectileProto = {
    alive: true,
    draw(now) {
        if (!ctx) return;
        ctx.save();
        if (this.type === 'fire_ring') {
            const owner = GAME_STATE.players[this.playerIndex];
            if (this.mineRing && owner && typeof drawBioMineVesicle === 'function') {
                drawBioMineVesicle(ctx, this.x, this.y, this.r, now, owner, false, 0, false);
            } else {
                ctx.fillStyle = '#ff6600';
                ctx.shadowColor = owner ? owner.color : '#ff9900';
                ctx.shadowBlur = 15;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (this.type === 'deflector_shield') {
            ctx.fillStyle = '#00e5ff';
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
};

const NetworkEnemyProjectileProto = {
    alive: true,
    draw() {
        if (!ctx) return;
        ctx.save();
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
};

window.onWorldSnapshotReceived = function(snapshot) {
    if (!snapshot) return;
    const nowTime = (typeof gameClock !== 'undefined' ? gameClock : (snapshot.elapsed !== undefined ? snapshot.elapsed : (typeof performance !== 'undefined' ? performance.now() : Date.now())));

    if (snapshot.hostW !== undefined && (GAME_STATE.hostW !== snapshot.hostW || W !== snapshot.hostW)) {
        GAME_STATE.hostW = snapshot.hostW;
        if (typeof resizeCanvas === 'function') resizeCanvas();
    }
    if (snapshot.hostH !== undefined && (GAME_STATE.hostH !== snapshot.hostH || H !== snapshot.hostH)) {
        GAME_STATE.hostH = snapshot.hostH;
        if (typeof resizeCanvas === 'function') resizeCanvas();
    }

    // 1. Reconcile Players
    if (snapshot.players) {
        for (const sp of snapshot.players) {
            let p = GAME_STATE.players[sp.i];
            if (!p) {
                p = new Player(sp.i, PLAYER_DEFS[sp.i] || { keysText: 'WASD', color: '#00ffcc', ring: 'rgba(0,255,204,0.3)', keys: {} });
                GAME_STATE.players[sp.i] = p;
            }
            p.hp = sp.hp;
            p.maxHp = sp.mhp;
            p.alive = (sp.al === 1);
            if (p.selectedWeapon !== sp.w) {
                p.selectedWeapon = sp.w;
                p.selectedWeaponLabel = sp.wl;
                p.weapons = [];
                if (sp.w) p.unlockWeapon(sp.w);
            }
            if (sp.fx !== undefined && sp.fy !== undefined) {
                let flail = p.weapons ? p.weapons.find(w => w.id === 'player_flail') : null;
                if (!flail) {
                    p.unlockWeapon('player_flail');
                    flail = p.weapons ? p.weapons.find(w => w.id === 'player_flail') : null;
                }
                if (flail) {
                    flail.x = sp.fx;
                    flail.y = sp.fy;
                }
            } else if (p.weapons && p.index !== netManager.localPlayerIndex) {
                p.weapons = p.weapons.filter(w => w.id !== 'player_flail');
            }
            p.currentLevelUpgradeName = sp.up;
            p.campervanUntil = sp.cv || 0;
            p.invuln = sp.iv || 0;
            p.martyrdomAuraEnabled = (sp.ma === 1);
            p.martyrsPresenceEnabled = (sp.mp === 1);
            p.disconnected = (sp.dc === 1);

            if (sp.i === netManager.localPlayerIndex) {
                // Client's own player: reconcile position without hard rubberbanding
                const dist2 = (p.x - sp.x) ** 2 + (p.y - sp.y) ** 2;
                if (dist2 > 14400) {
                    // Hard snap only if desynced by > 120px
                    p.x = sp.x;
                    p.y = sp.y;
                } else if (dist2 > 900) {
                    // Smooth exponential decay towards authoritative position (no teleport)
                    p.x += (sp.x - p.x) * 0.15;
                    p.y += (sp.y - p.y) * 0.15;
                }
            } else {
                // Remote player: update target position and state for smooth 60fps interpolation
                p.targetX = sp.x;
                p.targetY = sp.y;
                if (p.x === undefined || (p.x - sp.x) ** 2 + (p.y - sp.y) ** 2 > 32400) {
                    p.x = sp.x;
                    p.y = sp.y;
                }
                if (sp.fa !== undefined) {
                    let angleDiff = sp.fa - p.facingAngle;
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                    p.facingAngle += angleDiff * 0.40;
                }
                p.isMoving = (sp.mv === 1);
            }

            // Sync Melee Sweep and Sledgehammer animations for ALL players (local & remote)
            if (sp.mf !== undefined && sp.mf > 0) {
                let melee = p.weapons ? p.weapons.find(w => w.id === 'melee_sweep') : null;
                if (!melee && (sp.w === 'melee_sweep' || p.selectedWeapon === 'melee_sweep')) {
                    p.unlockWeapon('melee_sweep');
                    melee = p.weapons ? p.weapons.find(w => w.id === 'melee_sweep') : null;
                }
                if (melee) {
                    melee.lastFire = sp.mf;
                }
            }
            if (sp.mrm !== undefined) p.meleeRangeModifier = sp.mrm;
            if (sp.sh) {
                p.sledgeHammerAnimation = {
                    startTime: sp.sh.st,
                    duration: sp.sh.du,
                    angle: sp.sh.a
                };
            }
        }
    }

    // 2. Reconcile Enemies (compact tuples + velocity extrapolation for smooth 60fps dead reckoning)
    if (snapshot.enemies) {
        const seenIds = new Set();
        const activeEnemies = [];
        for (const se of snapshot.enemies) {
            let id, type, x, y, hp, mhp, fa, r, c, st, sr, ab, ly, la;
            if (Array.isArray(se)) {
                id = se[0]; type = se[1]; x = se[2]; y = se[3]; hp = se[4]; mhp = se[5]; fa = se[6];
                r = se[7] || 0; c = se[8] || ''; st = se[9] || ''; sr = se[10] || 0; ab = (se[11] === 1); ly = se[12] || 0; la = se[13] || 0;
            } else {
                id = se.id; type = se.t; x = se.x; y = se.y; hp = se.hp; mhp = se.mhp; fa = se.fa;
                r = se.r || 0; c = se.c || ''; st = se.st || ''; sr = se.sr || 0; ab = (se.ab === 1); ly = se.ly || 0; la = se.la || 0;
            }
            if (hp <= 0) continue;
            seenIds.add(id);
            let e = clientEnemyCache.get(id);
            if (!e) {
                e = new Enemy(x, y, type, nowTime);
                e._nid = id;
                e.x = x;
                e.y = y;
                e.targetX = x;
                e.targetY = y;
                e.vx = 0;
                e.vy = 0;
                clientEnemyCache.set(id, e);
            } else {
                // Estimate velocity vector between authoritative 20Hz snapshots (3 frames per snapshot)
                const dx = x - (e.targetX !== undefined ? e.targetX : e.x);
                const dy = y - (e.targetY !== undefined ? e.targetY : e.y);
                e.vx = dx / 3.0;
                e.vy = dy / 3.0;
                e.targetX = x;
                e.targetY = y;
                const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
                if (d2 > 32400) {
                    e.x = x;
                    e.y = y;
                }
            }
            e.alive = true;
            e.hp = hp;
            e.maxHp = mhp;
            e.facingAngle = fa;
            if (r) e.r = r;
            if (c) e.color = c;
            if (st) {
                e.viperState = st;
                e.stalkerState = st;
            }
            if (sr) e.shieldRadius = sr;
            e.airborne = ab;
            if (ly) e.landY = ly;
            if (la) e.landAt = la;
            activeEnemies.push(e);
        }
        for (const [id] of clientEnemyCache.entries()) {
            if (!seenIds.has(id)) {
                clientEnemyCache.delete(id);
            }
        }
        GAME_STATE.enemies = activeEnemies;
    }

    // 3. Reconcile Projectiles & Enemy Projectiles (Zero-allocation object pooling & tuple support)
    if (snapshot.projectiles) {
        const count = snapshot.projectiles.length;
        if (GAME_STATE.projectiles.length > count) {
            GAME_STATE.projectiles.length = count;
        }
        for (let i = 0; i < count; i++) {
            const sp = snapshot.projectiles[i];
            let p = GAME_STATE.projectiles[i];
            if (!p) {
                p = Object.create(NetworkProjectileProto);
                GAME_STATE.projectiles[i] = p;
            }
            if (Array.isArray(sp)) {
                p.type = sp[0];
                p.x = sp[1];
                p.y = sp[2];
                p.r = sp[3] || 3;
                p.color = sp[4] || '#00ffcc';
                p.angle = sp[5] || 0;
                p.targetX = sp[6] || undefined;
                p.targetY = sp[7] || undefined;
                p.startX = sp[8] || undefined;
                p.startY = sp[9] || undefined;
                p.mineRing = (sp[10] === 1);
                p.playerIndex = sp[11] || 0;
            } else {
                p.type = sp.t;
                p.x = sp.x;
                p.y = sp.y;
                p.r = sp.r || 3;
                p.color = sp.c || '#00ffcc';
                p.angle = sp.a || 0;
                p.targetX = sp.tx;
                p.targetY = sp.ty;
                p.startX = sp.sx;
                p.startY = sp.sy;
                p.mineRing = (sp.mr === 1);
                p.playerIndex = sp.pi || 0;
            }
            p.alive = true;
        }
    }

    if (snapshot.enemyProjectiles) {
        const count = snapshot.enemyProjectiles.length;
        if (GAME_STATE.enemyProjectiles.length > count) {
            GAME_STATE.enemyProjectiles.length = count;
        }
        for (let i = 0; i < count; i++) {
            const sep = snapshot.enemyProjectiles[i];
            let ep = GAME_STATE.enemyProjectiles[i];
            if (!ep) {
                ep = Object.create(NetworkEnemyProjectileProto);
                GAME_STATE.enemyProjectiles[i] = ep;
            }
            if (Array.isArray(sep)) {
                ep.x = sep[0];
                ep.y = sep[1];
                ep.r = sep[2] || 4;
                ep.color = sep[3] || '#ff3344';
            } else {
                ep.x = sep.x;
                ep.y = sep.y;
                ep.r = sep.r || 4;
                ep.color = sep.c || '#ff3344';
            }
            ep.alive = true;
        }
    }

    // 4. Reconcile Gems, Health Packs & Supply Drops (In-place update with low-frequency payload check)
    if (snapshot.gems !== undefined) {
        const count = snapshot.gems.length;
        if (GAME_STATE.gems.length > count) {
            GAME_STATE.gems.length = count;
        }
        for (let i = 0; i < count; i++) {
            const sg = snapshot.gems[i];
            let g = GAME_STATE.gems[i];
            const gx = Array.isArray(sg) ? sg[0] : sg.x;
            const gy = Array.isArray(sg) ? sg[1] : sg.y;
            const gv = Array.isArray(sg) ? (sg[2] || 5) : (sg.v || 5);
            const ghp = Array.isArray(sg) ? (sg[3] || 0) : (sg.hp || 0);
            const gsd = Array.isArray(sg) ? (sg[4] || 0) : (sg.sd || 0);

            if (ghp) {
                if (!(g instanceof HealthPack)) {
                    g = new HealthPack(gx, gy, nowTime);
                    GAME_STATE.gems[i] = g;
                } else {
                    g.x = gx; g.y = gy; g.alive = true;
                }
            } else if (gsd) {
                if (!(g instanceof SupplyDrop) || g.type !== gsd) {
                    g = new SupplyDrop(gx, gy, gsd, nowTime);
                    GAME_STATE.gems[i] = g;
                } else {
                    g.x = gx; g.y = gy; g.alive = true;
                }
            } else {
                if (!g || (g instanceof HealthPack) || (g instanceof SupplyDrop)) {
                    g = new XPGem(gx, gy, gv);
                    GAME_STATE.gems[i] = g;
                } else {
                    g.x = gx; g.y = gy; g.value = gv; g.alive = true;
                }
            }
        }
    }

    // 5. Reconcile Turrets (with spawnTime and flame angles preserved)
    if (snapshot.turrets) {
        const seenTurretIds = new Set();
        const activeTurrets = [];
        for (const st of snapshot.turrets) {
            seenTurretIds.add(st.id);
            let turret = clientTurretCache.get(st.id);
            const owner = GAME_STATE.players[st.pi] || GAME_STATE.players[0];
            if (!turret) {
                turret = new TurretEntity(st.x, st.y, owner, st.st || nowTime);
                turret._nid = st.id;
                turret.spawnTime = st.st || nowTime;
                clientTurretCache.set(st.id, turret);
            }
            turret.x = st.x;
            turret.y = st.y;
            turret.angle = st.a || 0;
            turret.flameAngle = st.fa || 0;
            turret.hp = st.hp;
            turret.maxHp = st.mhp;
            turret.isFlamethrower = (st.fl === 1);
            turret.flameActiveUntil = st.faU || 0;
            turret.flameCenterAngle = st.fcA || 0;
            turret.player = owner;
            activeTurrets.push(turret);
        }
        for (const [id] of clientTurretCache.entries()) {
            if (!seenTurretIds.has(id)) {
                clientTurretCache.delete(id);
            }
        }
        GAME_STATE.turrets = activeTurrets;

        // Re-link laser/energy walls between turrets on client
        for (const t of GAME_STATE.turrets) {
            if (t.player && (t.player.laserWallsEnabled || t.player.slowWallsEnabled)) {
                t.connections = [];
                t.linkWalls();
            }
        }
    }

    // 6. Reconcile Hazards, Mines & Visual Explosions (preserving original animations)
    if (snapshot.hazards) {
        const seenHazardIds = new Set();
        const activeHazards = [];
        for (const sh of snapshot.hazards) {
            seenHazardIds.add(sh.id);
            let hazard = clientHazardCache.get(sh.id);
            const owner = GAME_STATE.players[sh.pi] || GAME_STATE.players[0];

            if (!hazard) {
                switch (sh.t) {
                    case 'mine':
                        hazard = new PlayerMine(sh.x, sh.y, sh.r || 8, 50, owner, sh.st || nowTime);
                        hazard.spawnTime = sh.st || nowTime;
                        if (sh.tr) hazard.triggeredTime = nowTime;
                        break;
                    case 'mine_explosion':
                        hazard = new MineExplosion(sh.x, sh.y, sh.r, sh.st || nowTime, owner);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'nuke_explosion':
                        hazard = new NukeExplosion(sh.x, sh.y, sh.r, sh.st || nowTime);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'freeze_explosion':
                        hazard = new FreezeBlastVisual(sh.x, sh.y, sh.r, sh.st || nowTime);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'sledge_hit':
                        hazard = new SledgeHitVisual(sh.x, sh.y, sh.r, sh.ca || 1.2, sh.a || 0, sh.st || nowTime, owner);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'muzzle_flash':
                        hazard = new InstantMuzzleFlash(sh.x, sh.y, sh.a || 0, sh.c || (owner ? owner.color : '#00ffcc'), sh.st || nowTime, owner, sh.r || 16);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'hit_impact':
                        hazard = new InstantHitImpact(sh.x, sh.y, sh.a || 0, sh.c || '#ffcc00', sh.st || nowTime, sh.r || 20);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'burning_surface':
                        hazard = new BurningSurface(sh.x, sh.y, sh.r, sh.st || nowTime);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'burning_trail':
                        hazard = new BurningTrailSegment(sh.x, sh.y, sh.x2 || sh.x, sh.y2 || sh.y, sh.st || nowTime, owner);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'laser_trail':
                        hazard = new LaserTrailSegment(sh.x, sh.y, sh.x2 || sh.x, sh.y2 || sh.y, sh.st || nowTime, owner);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'ice_trail':
                        hazard = new IceTrailSegment(sh.x, sh.y, sh.x2 || sh.x, sh.y2 || sh.y, sh.st || nowTime, owner);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'bile_mortar':
                        hazard = new BileMortarPod(sh.x, sh.y, sh.x2 || sh.x, sh.y2 || sh.y, sh.st || nowTime, sh.lt || (sh.st + 1500));
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'acid_pool':
                        hazard = new AcidPoolHazard(sh.x, sh.y, sh.r, sh.st || nowTime, sh.dur || 5000);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'white_hole':
                        hazard = new WhiteHolePush(sh.x, sh.y, sh.r, sh.st || nowTime);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'black_hole':
                        hazard = new BlackHolePull(sh.x, sh.y, sh.r, sh.st || nowTime);
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    default:
                        hazard = {
                            type: sh.t,
                            x: sh.x,
                            y: sh.y,
                            r: sh.r || 15,
                            angle: sh.a || 0,
                            alive: true,
                            draw: function(now) {
                                ctx.save();
                                ctx.fillStyle = 'rgba(255, 68, 68, 0.4)';
                                ctx.beginPath();
                                ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
                                ctx.fill();
                                ctx.restore();
                            }
                        };
                        break;
                }
                hazard._nid = sh.id;
                clientHazardCache.set(sh.id, hazard);
            } else {
                // Update position / state of ongoing hazard
                if (hazard.x !== undefined) hazard.x = sh.x;
                if (hazard.y !== undefined) hazard.y = sh.y;
                if (sh.tr && hazard.triggeredTime === 0) hazard.triggeredTime = nowTime;
            }
            activeHazards.push(hazard);
        }
        for (const [id] of clientHazardCache.entries()) {
            if (!seenHazardIds.has(id)) {
                clientHazardCache.delete(id);
            }
        }
        GAME_STATE.hazards = activeHazards;
    }

    if (snapshot.terrains) {
        GAME_STATE.terrains = snapshot.terrains.map(st => new ShieldTerrain(st.x, st.y, st.r, st.fa, nowTime + 10000));
    }

    // 7. World Stats & State Sync
    if (snapshot.currentGameState !== undefined && typeof STATES !== 'undefined') {
        if (snapshot.currentGameState === STATES.GAMEPLAY && (GAME_STATE.current === STATES.WEAPON_SELECT || GAME_STATE.current === STATES.COUNTDOWN)) {
            GAME_STATE.current = STATES.GAMEPLAY;
            const tipEl = document.getElementById('tipText');
            if (tipEl) tipEl.style.display = 'none';
            if (typeof stopTipRotation === 'function') stopTipRotation();
            const layer = document.getElementById('levelUpLayer');
            if (layer) layer.classList.remove('show');
            const countdownEl = document.getElementById('countdown');
            if (countdownEl) countdownEl.style.display = 'none';
            const startMenu = document.getElementById('startMenu');
            if (startMenu) startMenu.classList.remove('show');
            const inviteBanner = document.getElementById('inviteCodeBanner');
            if (inviteBanner) inviteBanner.style.display = 'none';
        }
    }
    if (snapshot.elapsed !== undefined) {
        GAME_STATE.elapsed = snapshot.elapsed;
        gameClock = snapshot.elapsed;
    }
    if (snapshot.level !== undefined) GAME_STATE.level = snapshot.level;
    if (snapshot.xp !== undefined) GAME_STATE.xp = snapshot.xp;
    if (snapshot.nextXp !== undefined) GAME_STATE.nextXp = snapshot.nextXp;
    if (snapshot.kills !== undefined) GAME_STATE.kills = snapshot.kills;
    if (snapshot.activeBoss !== undefined) GAME_STATE.activeBoss = snapshot.activeBoss;
    if (snapshot.activeBossStartTime !== undefined) GAME_STATE.activeBossStartTime = snapshot.activeBossStartTime;
    if (snapshot.hordeStartTime !== undefined) GAME_STATE.hordeStartTime = snapshot.hordeStartTime;
};

window.onOnlineLevelUpStarted = function(pendingLevels, upgradesMap) {
    GAME_STATE.pendingLevels = pendingLevels || 1;
    GAME_STATE.current = STATES.LEVEL_UP;
    SoundEngine.setMuffled(true, 0.5);
    const zone = document.getElementById('joystickZone') || (typeof joystickZone !== 'undefined' ? joystickZone : (typeof window !== 'undefined' ? window.joystickZone : null));
    if (zone) zone.style.display = 'none';
    const tipEl = document.getElementById('tipText');
    if (tipEl) tipEl.style.display = 'none';
    if (upgradesMap) {
        for (const idx in upgradesMap) {
            const p = GAME_STATE.players[idx];
            if (p) {
                p.currentUpgradeOptions = upgradesMap[idx].map(id => UPGRADE_POOL.find(u => u.id === id)).filter(Boolean);
            }
        }
    }
    beginSelectionRound();
};

window.onOnlineGameOver = function() {
    gameOver();
};

window.onOnlineVictory = function() {
    showVictory();
};

function recalculateDynamicDifficulty() {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.players) return;
    const activePlayers = GAME_STATE.players.filter(p => !p.disconnected).length || 1;
    const diff = GAME_STATE.difficulty || DIFFICULTIES.normal;
    GAME_STATE.dmgFactor = (1.5 / (activePlayers + 0.5)) * (diff.dmgMult || 1.0);
    const coopSpeedBonus = activePlayers > 1 ? (1 + 0.05 * activePlayers) : 1.0;
    const speedFactor = coopSpeedBonus * (diff.speedMult || 1.0);
    for (const p of GAME_STATE.players) {
        if (p) p.speed = 1.0 * speedFactor;
    }
}

if (typeof window !== 'undefined') {
    window.NetworkManager = NetworkManager;
    window.netManager = new NetworkManager();
    window.serializeWorldForNetwork = serializeWorldForNetwork;
    window.serializeWorldForNetworkJSON = serializeWorldForNetworkJSON;
    window.packWorldSnapshotBinary = packWorldSnapshotBinary;
    window.unpackWorldSnapshotBinary = unpackWorldSnapshotBinary;
    window.uint8ToBase64 = uint8ToBase64;
    window.base64ToUint8 = base64ToUint8;
    window.despawnPlayerEntities = despawnPlayerEntities;
    window.recalculateDynamicDifficulty = recalculateDynamicDifficulty;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        NetworkManager,
        netManager: (typeof window !== 'undefined' && window.netManager) ? window.netManager : new NetworkManager(),
        serializeWorldForNetwork,
        serializeWorldForNetworkJSON,
        packWorldSnapshotBinary,
        unpackWorldSnapshotBinary,
        despawnPlayerEntities,
        recalculateDynamicDifficulty
    };
}
