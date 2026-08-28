/**
 * Blob Survival - P2P Multiplayer Network Manager (PeerJS)
 * Handles WebRTC peer connections, room code generation, 60fps input & state streaming,
 * reliable event messaging, and mid-game reconnection.
 */

class NetworkManager {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection
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
    }

    // Generate a clean 6-character room code (e.g. BLOB-4821)
    static generateRoomCode() {
        const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return 'BLOB-' + code;
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
                                this.hostConnection.send({ type: 'HEARTBEAT', time: Date.now() });
                            }
                        }, 1000);

                        // Also send explicit HANDSHAKE with sessionToken
                        conn.send({ type: 'HANDSHAKE', sessionToken: this.sessionToken });

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
                conn.send({
                    type: 'ASSIGN_SLOT',
                    playerIndex: assignedSlot,
                    isReconnection: true,
                    difficulty: (typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty) ? GAME_STATE.difficulty.name.toLowerCase() : 'normal',
                    currentGameState: (typeof GAME_STATE !== 'undefined') ? GAME_STATE.current : 0,
                    elapsed: (typeof GAME_STATE !== 'undefined') ? GAME_STATE.elapsed : 0,
                    connectedSlots: connectedSlots,
                    hostW: typeof W !== 'undefined' ? W : 1512,
                    hostH: typeof H !== 'undefined' ? H : 945
                });

                if (typeof onOnlinePlayerJoined === 'function') {
                    onOnlinePlayerJoined(assignedSlot, conn.peer, true);
                }

                if (conn.peerConnection) {
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
                conn.send({
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
                conn.send({
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
            conn.send({
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

    handleHostReceivedData(peerId, playerIndex, data) {
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
                    conn.send({ type: 'HEARTBEAT_ACK', time: Date.now() });
                }
                break;
        }
    }

    handleClientReceivedData(data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'ASSIGN_SLOT':
                this.localPlayerIndex = data.playerIndex;
                console.log(`[Net] Successfully joined as Player ${this.localPlayerIndex + 1} (Reconnection: ${!!data.isReconnection})`);
                if (typeof onAssignedSlot === 'function') {
                    onAssignedSlot(this.localPlayerIndex, data.difficulty, data.currentGameState, data.connectedSlots, data.hostW, data.hostH, data.isReconnection, data.elapsed);
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
                // 60 FPS authoritative game world state from host
                if (typeof onWorldSnapshotReceived === 'function') {
                    onWorldSnapshotReceived(data);
                }
                break;

            case 'LEVEL_UP_START':
                // Midgame level up triggered
                if (typeof onOnlineLevelUpStarted === 'function') {
                    onOnlineLevelUpStarted(data.pendingLevels, data.playerUpgrades);
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
                    conn.send({ type: 'KICKED', reason: 'You were permanently removed from the game session by the host.' });
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

    // Host sends 60fps game world snapshot to all connected clients
    broadcastWorldSnapshot(snapshot) {
        if (!this.isHost || this.connections.size === 0) return;
        const msg = {
            type: 'WORLD_SNAPSHOT',
            ...snapshot
        };
        for (const conn of this.connections.values()) {
            if (conn.open) {
                conn.send(msg);
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
            if (conn.open) {
                conn.send(msg);
            }
        }
    }

    // Client sends input to host
    sendLocalInput(moveX, moveY, angle, dashing = false) {
        if (!this.isClient || !this.hostConnection || !this.hostConnection.open) return;
        this.hostConnection.send({
            type: 'INPUT',
            playerIndex: this.localPlayerIndex,
            moveX: moveX,
            moveY: moveY,
            angle: angle,
            dashing: dashing
        });
    }

    // Client sends weapon choice to host
    sendWeaponSelection(weaponId) {
        if (this.isClient && this.hostConnection && this.hostConnection.open) {
            this.hostConnection.send({
                type: 'SELECT_WEAPON',
                playerIndex: this.localPlayerIndex,
                weaponId: weaponId
            });
        }
    }

    // Client sends upgrade pick to host
    sendUpgradeSelection(upgradeId) {
        if (this.isClient && this.hostConnection && this.hostConnection.open) {
            this.hostConnection.send({
                type: 'SELECT_UPGRADE',
                playerIndex: this.localPlayerIndex,
                upgradeId: upgradeId
            });
        }
    }

    broadcast(messageObj) {
        if (this.isHost) {
            for (const conn of this.connections.values()) {
                if (conn.open) conn.send(messageObj);
            }
        } else if (this.isClient && this.hostConnection && this.hostConnection.open) {
            this.hostConnection.send(messageObj);
        }
    }

    reset() {
        if (this.peer) {
            try {
                this.peer.destroy();
            } catch (e) {}
            this.peer = null;
        }
        this.connections.clear();
        this.playerPeerMap.clear();
        this.peerPlayerMap.clear();
        this.hostConnection = null;
        this.isHost = false;
        this.isClient = false;
        this.isOnline = false;
        this.localPlayerIndex = 0;
        this.roomCode = null;
    }
}

window.NetworkManager = NetworkManager;
window.netManager = new NetworkManager();
