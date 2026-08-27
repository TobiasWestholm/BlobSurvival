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
                    console.log('[Net] Client peer initialized:', myPeerId);
                    const conn = this.peer.connect(this.roomCode, {
                        reliable: true,
                        serialization: 'json'
                    });

                    let connectionTimeout = setTimeout(() => {
                        reject(new Error('Connection timed out. Check room code.'));
                    }, 10000);

                    conn.on('open', () => {
                        clearTimeout(connectionTimeout);
                        this.hostConnection = conn;
                        this.connections.set('host', conn);
                        console.log('[Net] Connected to Host:', this.roomCode);

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
            
            // Check if this peer is reconnecting to an existing slot
            let assignedSlot = this.peerPlayerMap.get(conn.peer);
            if (assignedSlot === undefined) {
                // Find first free slot between 1 and 3
                for (let i = 1; i <= 3; i++) {
                    if (!this.playerPeerMap.has(i)) {
                        assignedSlot = i;
                        break;
                    }
                }
            }

            if (assignedSlot === undefined) {
                // Room is full (max 4 players)
                conn.send({ type: 'ROOM_FULL' });
                setTimeout(() => conn.close(), 500);
                return;
            }

            this.connections.set(conn.peer, conn);
            this.playerPeerMap.set(assignedSlot, conn.peer);
            this.peerPlayerMap.set(conn.peer, assignedSlot);

            console.log(`[Net] Assigned player slot P${assignedSlot + 1} to peer:`, conn.peer);

            // Inform the client of their assigned slot
            conn.send({
                type: 'ASSIGN_SLOT',
                playerIndex: assignedSlot,
                difficulty: GAME_STATE.difficulty ? GAME_STATE.difficulty.name.toLowerCase() : 'normal',
                currentGameState: GAME_STATE.current,
                elapsed: GAME_STATE.elapsed
            });

            // Notify game engine that a player joined / reconnected
            if (typeof onOnlinePlayerJoined === 'function') {
                onOnlinePlayerJoined(assignedSlot, conn.peer);
            }

            // Listen for data from this client
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

        switch (data.type) {
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
                conn.send({ type: 'HEARTBEAT_ACK', time: Date.now() });
                break;
        }
    }

    handleClientReceivedData(data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'ASSIGN_SLOT':
                this.localPlayerIndex = data.playerIndex;
                console.log(`[Net] Successfully joined as Player ${this.localPlayerIndex + 1}`);
                if (typeof onAssignedSlot === 'function') {
                    onAssignedSlot(this.localPlayerIndex, data.difficulty, data.currentGameState);
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
                    onUpgradeChosenSync(data.playerIndex, data.upgradeName);
                }
                break;

            case 'PAUSE_SYNC':
                if (typeof onOnlinePauseSynced === 'function') {
                    onOnlinePauseSynced(data.paused);
                }
                break;

            case 'ROOM_FULL':
                alert('This room is already full (maximum 4 players).');
                showStartMenu();
                break;
        }
    }

    handlePeerDisconnected(playerIndex, peerId) {
        this.connections.delete(peerId);
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
