/**
 * Blob Survival - P2P Multiplayer Network Manager (PeerJS)
 * Handles WebRTC peer connections, room code generation, 60fps input & state streaming,
 * reliable event messaging, and mid-game reconnection.
 */

// Browsers slow down ICE gathering with more than ~4 servers, so keep STUN minimal.
const STUN_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
];

// Namespaces our room codes on the shared public PeerJS broker.
const PEER_ID_PREFIX = 'blobsurvival-';

// Must stay below the minimum remaining lifetime of Worker-served credentials (4h).
const TURN_CACHE_MS = 60 * 60 * 1000;
let cachedTurnServers = null;
let cachedTurnServersAt = 0;
let lastTurnError = null;

async function resolveTurnServers() {
    if (cachedTurnServers && Date.now() - cachedTurnServersAt < TURN_CACHE_MS) {
        return cachedTurnServers;
    }
    lastTurnError = null;
    const cfg = (typeof window !== 'undefined' && window.TURN_CONFIG) || {};
    let servers = Array.isArray(cfg.servers) ? cfg.servers.slice() : [];
    if (cfg.credentialsUrl) {
        try {
            const res = await fetch(cfg.credentialsUrl);
            if (res.status === 503) {
                lastTurnError =
                    'TURN relay is activating. Try again in about 2 minutes.';
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const fetched = await res.json();
            if (Array.isArray(fetched)) servers = servers.concat(fetched);
        } catch (e) {
            console.warn('[Net] Could not fetch TURN credentials:', e);
        }
    }
    if (servers.length) {
        cachedTurnServers = servers;
        cachedTurnServersAt = Date.now();
    }
    return servers;
}

// Gathers candidates with relay-only policy to verify TURN actually allocates.
function probeRelayCandidates(iceServers, timeoutMs = 6000) {
    return new Promise((resolve) => {
        const errors = [];
        let pc;
        try {
            pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
        } catch (e) {
            return resolve({ ok: false, errors: [String(e)] });
        }
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
                pc.close();
            } catch {}
            resolve({ ok, errors });
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        pc.onicecandidate = (e) => {
            if (!e.candidate) return finish(false);
            if (/ typ relay /.test(e.candidate.candidate)) finish(true);
        };
        pc.onicecandidateerror = (e) => {
            errors.push(`${e.url} ${e.errorCode} ${e.errorText}`);
        };
        pc.createDataChannel('probe');
        pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .catch(() => finish(false));
    });
}

/** @returns {Promise<RTCConfiguration>} */
async function buildIceConfig(isRelay) {
    const turnServers = await resolveTurnServers();
    if (isRelay) {
        if (!turnServers.length) {
            throw new Error(
                lastTurnError ||
                    'Relay mode needs a TURN server. Set TURN_CONFIG in js/config.js.',
            );
        }
        const probe = await probeRelayCandidates(turnServers);
        if (!probe.ok) {
            cachedTurnServers = null;
            console.error('[Net] TURN relay probe failed:', probe.errors);
            // 701 host-lookup errors are routine (e.g. no IPv6 route) and never the real cause.
            const cause =
                probe.errors.find((e) => !/ 701 /.test(e)) || probe.errors[0];
            throw new Error(
                'TURN relay unreachable or credentials rejected' +
                    (cause ? ` (${cause})` : '.'),
            );
        }
        return { iceServers: turnServers, iceTransportPolicy: 'relay' };
    }
    if (!turnServers.length) {
        console.warn(
            '[Net] No TURN server configured; players behind strict NAT may fail to connect.',
        );
    }
    return {
        iceServers: STUN_SERVERS.concat(turnServers),
        iceTransportPolicy: 'all',
    };
}

class NetworkManager {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection (Reliable RPC channel)
        this.streamConnections = new Map(); // peerId -> DataConnection (Unreliable Stream channel)
        this.playerPeerMap = new Map(); // playerIndex (1..3) -> peerId
        this.peerPlayerMap = new Map(); // peerId -> playerIndex (1..3)
        this.sessionPlayerMap = new Map(); // sessionToken -> playerIndex (1..3)
        this.playerSessionMap = new Map(); // playerIndex (1..3) -> sessionToken
        this.peerLastSeenMap = new Map(); // peerId -> timestamp
        this.playerPingMap = new Map(); // playerIndex (1..3) -> ping in ms
        this.currentPing = null; // Client's smoothed ping in ms
        this.heartbeatInterval = null;
        this.healthCheckInterval = null;
        this.sessionToken = null;
        this.isHost = false;
        this.isClient = false;
        this.isOnline = false;
        this.localPlayerIndex = 0;
        this.roomCode = null;
        this.hostConnection = null; // Reliable RPC channel to host
        this.streamConnection = null; // Unreliable Stream channel to host
        this.statusCallback = null;
        this.lastStateBroadcast = 0;
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.reconnectTimeout = null;
        this.clientInputSeq = 0;
    }

    getAdaptiveInterpolationDelay() {
        const ping = this.currentPing !== null ? this.currentPing : 33;
        // D = clamp(50ms, 220ms, ping * 1.2 + 33ms)
        return Math.max(50, Math.min(220, Math.round(ping * 1.2 + 33)));
    }

    sendConn(target, payload, maxBufferedAmount = null) {
        if (!target) return;
        try {
            if (
                maxBufferedAmount !== null &&
                target.dataChannel &&
                typeof target.dataChannel.bufferedAmount === 'number' &&
                target.dataChannel.bufferedAmount > maxBufferedAmount
            ) {
                return;
            }
            if (target.open) {
                target.send(payload);
            }
        } catch {
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
            try {
                this.peer.destroy();
            } catch {}
            this.peer = null;
        }
        for (const conn of this.streamConnections.values()) {
            try {
                conn.close();
            } catch {}
        }
        this.streamConnections.clear();
        if (this.streamConnection) {
            try {
                this.streamConnection.close();
            } catch {}
            this.streamConnection = null;
        }
        for (const conn of this.connections.values()) {
            try {
                conn.close();
            } catch {}
        }
        this.connections.clear();
        this.playerPeerMap.clear();
        this.peerPlayerMap.clear();
        this.sessionPlayerMap.clear();
        this.playerSessionMap.clear();
        this.peerLastSeenMap.clear();
        this.playerPingMap.clear();
        this.currentPing = null;
        this.isHost = false;
        this.isClient = false;
        this.isOnline = false;
        this.localPlayerIndex = 0;
        this.roomCode = null;
        this.hostConnection = null;
        this.streamConnection = null;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.clientInputSeq = 0;
        lastReceivedSnapshotSeq = 0;
        if (typeof clientEnemyCache !== 'undefined') clientEnemyCache.clear();
        if (typeof clientDeadEnemyIds !== 'undefined') clientDeadEnemyIds.clear();
        if (typeof netDeadEnemyMap !== 'undefined') netDeadEnemyMap.clear();
        if (typeof clientTurretCache !== 'undefined') clientTurretCache.clear();
        if (typeof clientHazardCache !== 'undefined') clientHazardCache.clear();
        if (typeof clientProjectileCache !== 'undefined')
            clientProjectileCache.clear();
        if (typeof clientEnemyProjectileCache !== 'undefined')
            clientEnemyProjectileCache.clear();
        if (typeof clientGemCache !== 'undefined') clientGemCache.clear();
        if (typeof clientCollectedGems !== 'undefined')
            clientCollectedGems.clear();
        if (typeof netHitEvents !== 'undefined') netHitEvents.length = 0;
        if (typeof netSoundEvents !== 'undefined') netSoundEvents.length = 0;
        if (typeof netVfxEvents !== 'undefined') netVfxEvents.length = 0;
        if (typeof netBlobDeforms !== 'undefined') netBlobDeforms.length = 0;
        if (typeof clientSnapshotBuffer !== 'undefined')
            clientSnapshotBuffer.length = 0;
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

    // Canonical form shared by host and client: "4821", "RELAY-4821".
    static normalizeRoomCode(code) {
        const clean = String(code || '')
            .trim()
            .toUpperCase()
            .replace(/^BLOB[-_\s]*/i, '')
            .replace(/[^A-Z0-9]/g, '');
        if (clean.startsWith('RELAY') && clean.length > 5) {
            return 'RELAY-' + clean.slice(5);
        }
        return clean;
    }

    static getJoinUrl(roomCode) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', roomCode);
        return url.toString();
    }

    async initHost(customCode = null) {
        this.reset();
        this.isHost = true;
        this.isClient = false;
        this.isOnline = true;
        this.localPlayerIndex = 0;
        const isRelay = Boolean(
            (typeof window !== 'undefined' && window.FORCE_RELAY) ||
                customCode?.toUpperCase().includes('RELAY'),
        );
        const baseCode = customCode
            ? NetworkManager.normalizeRoomCode(customCode).replace(/^RELAY-/, '')
            : NetworkManager.generateRoomCode();
        this.roomCode = (isRelay ? 'RELAY-' : '') + baseCode;
        if (typeof setupHostSoundBroadcasting === 'function') {
            setupHostSoundBroadcasting();
        }

        if (typeof Peer === 'undefined') {
            throw new Error('PeerJS library not loaded');
        }

        const iceConfig = await buildIceConfig(isRelay);

        return new Promise((resolve, reject) => {
            try {
                this.peer = new Peer(PEER_ID_PREFIX + this.roomCode, {
                    debug: 1,
                    config: iceConfig,
                });

                this.peer.on('open', () => {
                    const id = this.roomCode;
                    console.log('[Net] Host registered room code:', id);

                    // Health check: check heartbeat of clients every 1s & measure peer RTT
                    if (this.healthCheckInterval)
                        clearInterval(this.healthCheckInterval);
                    this.healthCheckInterval = setInterval(() => {
                        if (!this.isHost) return;
                        const now = Date.now();
                        const pNow = performance.now();
                        for (const [
                            slot,
                            peerId,
                        ] of this.playerPeerMap.entries()) {
                            const lastSeen =
                                this.peerLastSeenMap.get(peerId) || 0;
                            if (lastSeen > 0 && now - lastSeen > 8000) {
                                console.warn(
                                    `[Net] Peer ${peerId} (Player ${slot + 1}) timed out via heartbeat (${now - lastSeen}ms).`,
                                );
                                const conn = this.connections.get(peerId);
                                if (conn) {
                                    try {
                                        conn.close();
                                    } catch {}
                                }
                                this.handlePeerDisconnected(slot, peerId);
                            } else {
                                const conn = this.connections.get(peerId);
                                if (conn?.open) {
                                    this.sendConn(conn, {
                                        type: 'HOST_PING',
                                        time: pNow,
                                    });
                                }
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
                        const newCode =
                            (isRelay ? 'RELAY-' : '') +
                            NetworkManager.generateRoomCode();
                        this.initHost(newCode).then(resolve).catch(reject);
                    } else {
                        reject(err);
                    }
                });

                this.peer.on('disconnected', () => {
                    console.warn(
                        '[Net] Host disconnected from signaling broker. Reconnecting...',
                    );
                    this.peer.reconnect();
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    async initClient(roomCode) {
        this.reset();
        this.isHost = false;
        this.isClient = true;
        this.isOnline = true;
        this.roomCode = NetworkManager.normalizeRoomCode(roomCode);
        const isRelay = Boolean(
            (typeof window !== 'undefined' && window.FORCE_RELAY) ||
                this.roomCode.startsWith('RELAY-'),
        );
        const iceConfig = await buildIceConfig(isRelay);

        return new Promise((resolve, reject) => {
            // Retrieve or generate persistent sessionToken for this room (safe on mobile Safari Private Browsing)
            let sessionToken = null;
            try {
                const sessionKey = `blob_session_${this.roomCode}`;
                sessionToken = sessionStorage.getItem(sessionKey);
                if (!sessionToken) {
                    sessionToken =
                        'tok_' +
                        Math.random().toString(36).substring(2, 11) +
                        '_' +
                        Date.now().toString(36);
                    sessionStorage.setItem(sessionKey, sessionToken);
                }
            } catch {
                sessionToken =
                    'tok_' +
                    Math.random().toString(36).substring(2, 11) +
                    '_' +
                    Date.now().toString(36);
            }
            this.sessionToken = sessionToken;

            if (typeof Peer === 'undefined') {
                return reject(new Error('PeerJS library not loaded'));
            }

            try {
                // Client gets a random peer ID
                this.peer = new Peer({
                    debug: 1,
                    config: iceConfig,
                });

                this.peer.on('open', (myPeerId) => {
                    console.log(
                        '[Net] Client peer initialized:',
                        myPeerId,
                        'sessionToken:',
                        this.sessionToken,
                    );
                    const conn = this.peer.connect(
                        PEER_ID_PREFIX + this.roomCode,
                        {
                            reliable: true,
                            serialization: 'json',
                            label: 'rpc',
                            metadata: {
                                sessionToken: this.sessionToken,
                                channelType: 'rpc',
                            },
                        },
                    );

                    const connectionTimeout = setTimeout(() => {
                        try {
                            conn.close();
                        } catch {}
                        reject(
                            new Error('Connection timed out. Check room code.'),
                        );
                    }, 15000);

                    conn.on('open', () => {
                        clearTimeout(connectionTimeout);
                        this.hostConnection = conn;
                        this.connections.set('host', conn);
                        console.log(
                            '[Net] Reliable RPC channel connected to Host:',
                            this.roomCode,
                        );

                        // Start 1s active heartbeat ping over reliable channel
                        if (this.heartbeatInterval)
                            clearInterval(this.heartbeatInterval);
                        this.heartbeatInterval = setInterval(() => {
                            if (this.hostConnection?.open) {
                                this.sendConn(this.hostConnection, {
                                    type: 'HEARTBEAT',
                                    time: performance.now(),
                                });
                            }
                        }, 1000);

                        // Send explicit HANDSHAKE with sessionToken
                        this.sendConn(conn, {
                            type: 'HANDSHAKE',
                            sessionToken: this.sessionToken,
                        });

                        // Secondary: Establish unreliable streaming channel for 20Hz snapshots & 60Hz inputs
                        try {
                            const streamConn = this.peer.connect(
                                PEER_ID_PREFIX + this.roomCode,
                                {
                                    reliable: false,
                                    serialization: 'binary',
                                    label: 'stream',
                                    metadata: {
                                        sessionToken: this.sessionToken,
                                        channelType: 'stream',
                                    },
                                },
                            );
                            streamConn.on('open', () => {
                                if (streamConn.dataChannel) {
                                    streamConn.dataChannel.binaryType =
                                        'arraybuffer';
                                }
                                console.log(
                                    '[Net] Unreliable snapshot/input stream channel open with Host.',
                                );
                                this.streamConnection = streamConn;
                            });
                            streamConn.on('data', (data) => {
                                this.handleClientReceivedData(data);
                            });
                            streamConn.on('close', () => {
                                console.log(
                                    '[Net] Unreliable stream channel closed.',
                                );
                                if (this.streamConnection === streamConn) {
                                    this.streamConnection = null;
                                }
                            });
                            streamConn.on('error', (err) => {
                                console.warn(
                                    '[Net] Stream channel warning:',
                                    err,
                                );
                            });
                        } catch (e) {
                            console.warn(
                                '[Net] Could not create secondary stream channel:',
                                e,
                            );
                        }

                        conn.on('data', (data) => {
                            this.handleClientReceivedData(data);
                        });

                        conn.on('close', () => {
                            console.warn('[Net] Connection to Host closed.');
                            this.attemptReconnect();
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
            let sessionToken = conn.metadata?.sessionToken
                ? conn.metadata.sessionToken
                : null;
            const channelType = conn.metadata?.channelType
                ? conn.metadata.channelType
                : conn.label === 'stream'
                  ? 'stream'
                  : 'rpc';

            // 0. Handle secondary unreliable streaming channel
            if (channelType === 'stream') {
                if (conn.dataChannel) {
                    conn.dataChannel.binaryType = 'arraybuffer';
                }
                console.log(
                    `[Net] Unreliable stream channel connected from peer: ${conn.peer} (token: ${sessionToken})`,
                );
                this.streamConnections.set(conn.peer, conn);
                this.peerLastSeenMap.set(conn.peer, Date.now());

                conn.on('data', (data) => {
                    this.peerLastSeenMap.set(conn.peer, Date.now());
                    const assignedSlot =
                        sessionToken && this.sessionPlayerMap.has(sessionToken)
                            ? this.sessionPlayerMap.get(sessionToken)
                            : this.peerPlayerMap.get(conn.peer);
                    if (assignedSlot !== undefined) {
                        this.handleHostReceivedData(
                            conn.peer,
                            assignedSlot,
                            data,
                        );
                    }
                });

                conn.on('close', () => {
                    console.log(
                        `[Net] Stream channel closed for peer: ${conn.peer}`,
                    );
                    if (this.streamConnections.get(conn.peer) === conn) {
                        this.streamConnections.delete(conn.peer);
                    }
                });
                return;
            }

            console.log('[Net] Peer connecting (reliable RPC):', conn.peer);
            this.peerLastSeenMap.set(conn.peer, Date.now());
            const isGameStarted =
                typeof GAME_STATE !== 'undefined' &&
                typeof STATES !== 'undefined' &&
                GAME_STATE.current !== STATES.WEAPON_SELECT &&
                GAME_STATE.current !== STATES.START_MENU;

            // 1. Check if this is an established player reconnecting with their sessionToken
            let assignedSlot =
                sessionToken && this.sessionPlayerMap.has(sessionToken)
                    ? this.sessionPlayerMap.get(sessionToken)
                    : undefined;

            if (assignedSlot !== undefined) {
                // Existing player RECONNECTING!
                console.log(
                    `[Net] Recognized reconnecting player: P${assignedSlot + 1} (token: ${sessionToken})`,
                );
                this.connections.set(conn.peer, conn);
                this.playerPeerMap.set(assignedSlot, conn.peer);
                this.peerPlayerMap.set(conn.peer, assignedSlot);
                this.sessionPlayerMap.set(sessionToken, assignedSlot);
                this.playerSessionMap.set(assignedSlot, sessionToken);
                this.peerLastSeenMap.set(conn.peer, Date.now());

                const connectedSlots = [0, ...this.playerPeerMap.keys()];
                let upgradesMap = null;
                let chosenUpgradesMap = null;
                if (
                    typeof GAME_STATE !== 'undefined' &&
                    typeof STATES !== 'undefined' &&
                    GAME_STATE.current === STATES.LEVEL_UP &&
                    GAME_STATE.players
                ) {
                    upgradesMap = {};
                    chosenUpgradesMap = {};
                    for (const p of GAME_STATE.players) {
                        if (!p) continue;
                        if (
                            !p.currentUpgradeOptions &&
                            typeof pickThreeFor === 'function'
                        ) {
                            p.currentUpgradeOptions = pickThreeFor(p);
                        }
                        if (p.currentUpgradeOptions) {
                            upgradesMap[p.index] = p.currentUpgradeOptions.map(
                                (u) => u.id,
                            );
                        }
                        if (p.currentLevelUpgradeName) {
                            chosenUpgradesMap[p.index] =
                                p.currentLevelUpgradeName;
                        }
                    }
                }

                if (typeof window.onOnlinePlayerJoined === 'function') {
                    window.onOnlinePlayerJoined(assignedSlot, conn.peer, true);
                }

                const recPlayer =
                    typeof GAME_STATE !== 'undefined' && GAME_STATE.players
                        ? GAME_STATE.players[assignedSlot]
                        : null;

                this.sendConn(conn, {
                    type: 'ASSIGN_SLOT',
                    playerIndex: assignedSlot,
                    isReconnection: true,
                    isAlive: recPlayer ? recPlayer.alive : true,
                    deadAt: recPlayer ? recPlayer.deadAt || 0 : 0,
                    difficulty:
                        typeof GAME_STATE !== 'undefined' &&
                        GAME_STATE.difficulty
                            ? GAME_STATE.difficulty.name.toLowerCase()
                            : 'normal',
                    currentGameState:
                        typeof GAME_STATE !== 'undefined'
                            ? GAME_STATE.current
                            : 0,
                    elapsed:
                        typeof GAME_STATE !== 'undefined'
                            ? GAME_STATE.elapsed
                            : 0,
                    connectedSlots: connectedSlots,
                    hostW: typeof W !== 'undefined' ? W : 1512,
                    hostH: typeof H !== 'undefined' ? H : 945,
                    upgradesMap: upgradesMap,
                    chosenUpgradesMap: chosenUpgradesMap,
                    pendingLevels:
                        typeof GAME_STATE !== 'undefined'
                            ? GAME_STATE.pendingLevels || 1
                            : 1,
                });

                conn.on('data', (data) => {
                    this.handleHostReceivedData(conn.peer, assignedSlot, data);
                });

                conn.on('close', () => {
                    console.warn(
                        `[Net] Player P${assignedSlot + 1} (${conn.peer}) disconnected.`,
                    );
                    this.handlePeerDisconnected(assignedSlot, conn.peer);
                });
                return;
            }

            // 2. New player attempting to join:
            if (isGameStarted) {
                // Game has started past weapon selection -> DENY new connections
                console.warn(
                    `[Net] Rejected new connection from ${conn.peer} - game already in progress.`,
                );
                this.sendConn(conn, {
                    type: 'JOIN_DENIED',
                    reason: 'The game has already started. Only players who joined during weapon selection can reconnect.',
                });
                setTimeout(() => conn.close(), 500);
                return;
            }

            // 3. Still in starting weapon selection: allow up to 4 players (slots 1..3 for clients)
            for (let i = 1; i <= 3; i++) {
                if (
                    !this.playerSessionMap.has(i) &&
                    !this.playerPeerMap.has(i)
                ) {
                    assignedSlot = i;
                    break;
                }
            }

            if (assignedSlot === undefined) {
                // Room is full
                console.warn(
                    `[Net] Rejected connection from ${conn.peer} - lobby is full.`,
                );
                this.sendConn(conn, {
                    type: 'ROOM_FULL',
                    reason: 'The lobby is full (maximum 4 players).',
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

            console.log(
                `[Net] Assigned new player slot P${assignedSlot + 1} to peer:`,
                conn.peer,
                'sessionToken:',
                sessionToken,
            );

            const connectedSlots = [0, ...this.playerPeerMap.keys()];
            this.sendConn(conn, {
                type: 'ASSIGN_SLOT',
                playerIndex: assignedSlot,
                isReconnection: false,
                difficulty:
                    typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty
                        ? GAME_STATE.difficulty.name.toLowerCase()
                        : 'normal',
                currentGameState:
                    typeof GAME_STATE !== 'undefined' ? GAME_STATE.current : 0,
                elapsed:
                    typeof GAME_STATE !== 'undefined' ? GAME_STATE.elapsed : 0,
                connectedSlots: connectedSlots,
                hostW: typeof W !== 'undefined' ? W : 1512,
                hostH: typeof H !== 'undefined' ? H : 945,
            });

            if (typeof window.onOnlinePlayerJoined === 'function') {
                window.onOnlinePlayerJoined(assignedSlot, conn.peer, false);
            }

            conn.on('data', (data) => {
                this.handleHostReceivedData(conn.peer, assignedSlot, data);
            });

            conn.on('close', () => {
                console.warn(
                    `[Net] Player P${assignedSlot + 1} (${conn.peer}) disconnected.`,
                );
                this.handlePeerDisconnected(assignedSlot, conn.peer);
            });
        });
    }

    handleHostReceivedData(peerId, playerIndex, data) {
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch {
                return;
            }
        }
        if (!data?.type) return;
        this.peerLastSeenMap.set(peerId, Date.now());

        switch (data.type) {
            case 'HANDSHAKE':
                if (
                    data.sessionToken &&
                    !this.playerSessionMap.has(playerIndex)
                ) {
                    this.sessionPlayerMap.set(data.sessionToken, playerIndex);
                    this.playerSessionMap.set(playerIndex, data.sessionToken);
                }
                break;

            case 'INPUT':
                // 60 FPS remote movement stream
                if (typeof window.onRemoteInputReceived === 'function') {
                    window.onRemoteInputReceived(
                        playerIndex,
                        data.moveX,
                        data.moveY,
                        data.angle,
                        data.dashing,
                        data.seq,
                    );
                }
                break;

            case 'SELECT_WEAPON':
                // Starting weapon choice or change (regret choice)
                if (typeof window.onRemoteWeaponSelected === 'function') {
                    window.onRemoteWeaponSelected(playerIndex, data.weaponId);
                }
                break;

            case 'SELECT_UPGRADE':
                // Level-up upgrade pick
                if (typeof window.onRemoteUpgradeSelected === 'function') {
                    window.onRemoteUpgradeSelected(playerIndex, data.upgradeId);
                }
                break;

            case 'SET_PLAYER_NAME':
                // Custom player name change
                if (typeof window.onRemotePlayerNameChanged === 'function') {
                    window.onRemotePlayerNameChanged(playerIndex, data.name);
                }
                break;

            case 'HEARTBEAT': {
                const conn = this.connections.get(peerId);
                if (conn?.open) {
                    this.sendConn(conn, {
                        type: 'HEARTBEAT_ACK',
                        time: data.time,
                    });
                }
                break;
            }

            case 'HOST_PING_ACK': {
                if (typeof data.time === 'number') {
                    const rtt = Math.max(0, performance.now() - data.time);
                    const samplePing = Math.round(rtt / 2);
                    const prev = this.playerPingMap.get(playerIndex);
                    const smoothPing =
                        prev !== undefined
                            ? Math.round(prev * 0.7 + samplePing * 0.3)
                            : samplePing;
                    this.playerPingMap.set(playerIndex, smoothPing);
                }
                break;
            }

            case 'CLIENT_PING_REPORT': {
                if (
                    typeof data.ping === 'number' &&
                    Number.isFinite(data.ping)
                ) {
                    this.playerPingMap.set(playerIndex, Math.round(data.ping));
                }
                break;
            }
        }
    }

    handleClientReceivedData(data) {
        if (!data) return;

        // 1. Handle Blob in case browser WebRTC delivers frames as Blob
        if (typeof Blob !== 'undefined' && data instanceof Blob) {
            data.arrayBuffer()
                .then((buf) => {
                    this.handleClientReceivedData(buf);
                })
                .catch(() => {});
            return;
        }

        // 2. Handle Binary ArrayBuffer / TypedArray
        if (
            data instanceof ArrayBuffer ||
            (data &&
                data.buffer instanceof ArrayBuffer &&
                data.byteLength !== undefined)
        ) {
            const buffer = data instanceof ArrayBuffer ? data : data.buffer;
            const snapshot = unpackWorldSnapshotBinary(buffer);
            if (snapshot && typeof window.onWorldSnapshotReceived === 'function') {
                window.onWorldSnapshotReceived(snapshot);
            }
            return;
        }

        // 3. Handle JSON string
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch {
                return;
            }
        }

        if (!data?.type) return;

        switch (data.type) {
            case 'ASSIGN_SLOT':
                this.localPlayerIndex = data.playerIndex;
                console.log(
                    `[Net] Successfully joined as Player ${this.localPlayerIndex + 1} (Reconnection: ${!!data.isReconnection})`,
                );
                if (typeof window.onAssignedSlot === 'function') {
                    window.onAssignedSlot(
                        this.localPlayerIndex,
                        data.difficulty,
                        data.currentGameState,
                        data.connectedSlots,
                        data.hostW,
                        data.hostH,
                        data.isReconnection,
                        data.elapsed,
                        data.upgradesMap,
                        data.chosenUpgradesMap,
                        data.pendingLevels,
                        data.isAlive,
                        data.deadAt,
                    );
                }
                break;

            case 'JOIN_DENIED':
                console.warn('[Net] Join denied:', data.reason);
                if (typeof showToast === 'function') {
                    showToast(
                        data.reason ||
                            'The game has already started. Late joins are not permitted.',
                        5000,
                        true,
                    );
                }
                if (typeof showStartMenu === 'function') {
                    showStartMenu();
                }
                break;

            case 'LOBBY_STATE':
                // Updates connected player list and weapon picks in the lobby
                if (typeof window.onLobbyStateUpdated === 'function') {
                    window.onLobbyStateUpdated(data.players, data.allReady);
                }
                break;

            case 'START_GAME_COUNTDOWN':
                // Host launched the game
                if (typeof window.onOnlineCountdownStarted === 'function') {
                    window.onOnlineCountdownStarted(data.isNewGame);
                }
                break;

            case 'WORLD_SNAPSHOT':
                // Authoritative game world state from host
                if (typeof window.onWorldSnapshotReceived === 'function') {
                    if (data.b) {
                        try {
                            const bytes = base64ToUint8(data.b);
                            const snapshot = unpackWorldSnapshotBinary(bytes);
                            if (snapshot) {
                                window.onWorldSnapshotReceived(snapshot);
                            }
                        } catch (e) {
                            console.warn(
                                '[Net] Failed to decode base64 snapshot:',
                                e,
                            );
                        }
                    } else {
                        window.onWorldSnapshotReceived(data);
                    }
                }
                break;

            case 'LEVEL_UP_START':
                // Midgame level up triggered
                if (typeof window.onOnlineLevelUpStarted === 'function') {
                    window.onOnlineLevelUpStarted(
                        data.pendingLevels,
                        data.upgradesMap || data.playerUpgrades,
                    );
                }
                break;

            case 'UPGRADE_CHOSEN_SYNC':
                if (typeof window.onUpgradeChosenSync === 'function') {
                    window.onUpgradeChosenSync(
                        data.playerIndex,
                        data.upgradeId,
                        data.upgradeName,
                    );
                }
                break;

            case 'PAUSE_SYNC':
                if (typeof window.onOnlinePauseSynced === 'function') {
                    window.onOnlinePauseSynced(data.paused);
                }
                break;

            case 'GAME_OVER':
                if (typeof window.onOnlineGameOver === 'function') {
                    window.onOnlineGameOver();
                }
                break;

            case 'GAME_VICTORY':
                if (typeof window.onOnlineVictory === 'function') {
                    window.onOnlineVictory();
                }
                break;

            case 'ROOM_FULL':
                if (typeof showToast === 'function') {
                    showToast(
                        'This room is already full (maximum 4 players).',
                        5000,
                        true,
                    );
                }
                showStartMenu();
                break;

            case 'KICKED':
                if (typeof showToast === 'function') {
                    showToast(
                        data.reason ||
                            'You have been permanently removed from the session by the host.',
                        5000,
                        true,
                    );
                }
                if (typeof showStartMenu === 'function') {
                    showStartMenu();
                }
                break;

            case 'PLAYER_KICKED':
                if (typeof onOnlinePlayerKicked === 'function') {
                    onOnlinePlayerKicked(data.playerIndex);
                }
                break;

            case 'PLAYER_DISCONNECTED':
                if (typeof window.onOnlinePlayerDisconnected === 'function') {
                    window.onOnlinePlayerDisconnected(data.playerIndex, null);
                }
                break;

            case 'HEARTBEAT_ACK': {
                if (typeof data.time === 'number') {
                    const rtt = Math.max(0, performance.now() - data.time);
                    const samplePing = Math.round(rtt / 2);
                    this.currentPing =
                        this.currentPing !== null
                            ? Math.round(
                                  this.currentPing * 0.7 + samplePing * 0.3,
                              )
                            : samplePing;
                    if (this.hostConnection?.open) {
                        this.sendConn(this.hostConnection, {
                            type: 'CLIENT_PING_REPORT',
                            ping: this.currentPing,
                        });
                    }
                }
                break;
            }

            case 'HOST_PING': {
                if (this.hostConnection?.open) {
                    this.sendConn(this.hostConnection, {
                        type: 'HOST_PING_ACK',
                        time: data.time,
                    });
                }
                break;
            }
        }
    }

    kickPlayer(playerIndex) {
        if (!this.isHost) return;
        const peerId = this.playerPeerMap.get(playerIndex);
        const sessionToken = this.playerSessionMap.get(playerIndex);

        if (peerId) {
            const streamConn = this.streamConnections.get(peerId);
            if (streamConn) {
                try {
                    streamConn.close();
                } catch {}
                this.streamConnections.delete(peerId);
            }
            const conn = this.connections.get(peerId);
            if (conn) {
                try {
                    this.sendConn(conn, {
                        type: 'KICKED',
                        reason: 'You were permanently removed from the game session by the host.',
                    });
                    setTimeout(() => conn.close(), 250);
                } catch {}
                this.connections.delete(peerId);
            }
            this.peerPlayerMap.delete(peerId);
            this.playerPeerMap.delete(playerIndex);
        }

        if (sessionToken) {
            this.sessionPlayerMap.delete(sessionToken);
            this.playerSessionMap.delete(playerIndex);
        }
        this.playerPingMap.delete(playerIndex);

        this.broadcast({
            type: 'PLAYER_KICKED',
            playerIndex: playerIndex,
        });
    }

    handlePeerDisconnected(playerIndex, peerId) {
        const streamConn = this.streamConnections.get(peerId);
        if (streamConn) {
            try {
                streamConn.close();
            } catch {}
            this.streamConnections.delete(peerId);
        }
        this.connections.delete(peerId);
        this.peerPlayerMap.delete(peerId);
        this.playerPeerMap.delete(playerIndex);
        this.peerLastSeenMap.delete(peerId);
        this.playerPingMap.delete(playerIndex);

        const isLobby =
            typeof GAME_STATE === 'undefined' ||
            typeof STATES === 'undefined' ||
            GAME_STATE.current === STATES.WEAPON_SELECT ||
            GAME_STATE.current === STATES.START_MENU;
        if (isLobby) {
            const sessionToken = this.playerSessionMap.get(playerIndex);
            if (sessionToken) {
                this.sessionPlayerMap.delete(sessionToken);
            }
            this.playerSessionMap.delete(playerIndex);
        }

        this.broadcast({
            type: 'PLAYER_DISCONNECTED',
            playerIndex: playerIndex,
        });

        if (typeof window.onOnlinePlayerDisconnected === 'function') {
            window.onOnlinePlayerDisconnected(playerIndex, peerId);
        }
    }

    handleHostDisconnected(reason = null) {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        const msg = reason || 'Host disconnected from the game session.';
        if (typeof showToast === 'function') {
            showToast(msg, 5000, true);
        }
        if (typeof showStartMenu === 'function') {
            showStartMenu();
        }
    }

    attemptReconnect() {
        if (!this.isClient || !this.isOnline || !this.roomCode) return;
        if (this.isReconnecting) return;

        if (
            typeof GAME_STATE !== 'undefined' &&
            typeof STATES !== 'undefined' &&
            (GAME_STATE.current === STATES.START_MENU ||
                GAME_STATE.current === STATES.GAME_OVER)
        ) {
            this.handleHostDisconnected('Game ended.');
            return;
        }

        const maxAttempts = 5;
        this.reconnectAttempts++;

        if (this.reconnectAttempts > maxAttempts) {
            console.warn('[Net] Max reconnect attempts reached.');
            this.isReconnecting = false;
            this.handleHostDisconnected(
                'Connection lost after multiple retry attempts.',
            );
            return;
        }

        this.isReconnecting = true;
        const delay = Math.min(
            6000,
            1000 * Math.pow(1.5, this.reconnectAttempts - 1),
        );
        const attemptMsg = `Connection to Host lost. Reconnecting... (Attempt ${this.reconnectAttempts}/${maxAttempts})`;
        console.warn(`[Net] ${attemptMsg} in ${Math.round(delay)}ms`);
        if (typeof showToast === 'function') {
            showToast(attemptMsg, Math.max(2500, delay), true);
        }

        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
            if (!this.isClient || !this.isOnline) return;

            if (this.peer && (this.peer.disconnected || this.peer.destroyed)) {
                try {
                    this.peer.reconnect();
                } catch {}
            }

            const conn = this.peer.connect(PEER_ID_PREFIX + this.roomCode, {
                reliable: true,
                serialization: 'json',
                label: 'rpc',
                metadata: {
                    sessionToken: this.sessionToken,
                    channelType: 'rpc',
                },
            });

            const timeoutId = setTimeout(() => {
                try {
                    conn.close();
                } catch {}
                this.isReconnecting = false;
                this.attemptReconnect();
            }, 6000);

            conn.on('open', () => {
                clearTimeout(timeoutId);
                this.reconnectAttempts = 0;
                this.isReconnecting = false;
                this.hostConnection = conn;
                this.connections.set('host', conn);
                if (typeof showToast === 'function') {
                    showToast('✓ Reconnected to game session!', 3000, false);
                }

                if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = setInterval(() => {
                    if (this.hostConnection?.open) {
                        this.sendConn(this.hostConnection, {
                            type: 'HEARTBEAT',
                            time: performance.now(),
                        });
                    }
                }, 1000);

                this.sendConn(conn, {
                    type: 'HANDSHAKE',
                    sessionToken: this.sessionToken,
                });

                try {
                    const streamConn = this.peer.connect(
                        PEER_ID_PREFIX + this.roomCode,
                        {
                            reliable: false,
                            serialization: 'binary',
                            label: 'stream',
                            metadata: {
                                sessionToken: this.sessionToken,
                                channelType: 'stream',
                            },
                        },
                    );
                    streamConn.on('open', () => {
                        if (streamConn.dataChannel) {
                            streamConn.dataChannel.binaryType = 'arraybuffer';
                        }
                        this.streamConnection = streamConn;
                    });
                    streamConn.on('data', (data) => {
                        this.handleClientReceivedData(data);
                    });
                    streamConn.on('close', () => {
                        if (this.streamConnection === streamConn) {
                            this.streamConnection = null;
                        }
                    });
                } catch (e) {
                    console.warn(
                        '[Net] Could not recreate stream channel on reconnect:',
                        e,
                    );
                }

                conn.on('data', (data) => {
                    this.handleClientReceivedData(data);
                });

                conn.on('close', () => {
                    this.attemptReconnect();
                });
            });

            conn.on('error', (err) => {
                clearTimeout(timeoutId);
                try {
                    conn.close();
                } catch {}
                this.isReconnecting = false;
                this.attemptReconnect();
            });
        }, delay);
    }

    // Host sends authoritative game world snapshot to all connected clients (prioritizing binary stream channel)
    broadcastWorldSnapshot(snapshot = null) {
        if (!this.isHost || this.connections.size === 0) return;

        let binBuffer = null;
        if (
            snapshot instanceof ArrayBuffer ||
            (snapshot && snapshot.buffer instanceof ArrayBuffer)
        ) {
            binBuffer =
                snapshot instanceof ArrayBuffer ? snapshot : snapshot.buffer;
        } else if (typeof packWorldSnapshotBinary === 'function') {
            binBuffer = packWorldSnapshotBinary();
        }

        let jsonPayload = null;
        let base64Payload = null;

        for (const [peerId, conn] of this.connections.entries()) {
            const streamConn = this.streamConnections.get(peerId);
            if (streamConn?.open && binBuffer) {
                // Primary: stream raw binary ArrayBuffer over unreliable stream channel
                this.sendConn(streamConn, binBuffer, 65536);
            } else if (conn?.open) {
                // Fallback: send base64-packed snapshot over reliable RPC channel if binary available
                if (binBuffer && typeof uint8ToBase64 === 'function') {
                    if (!base64Payload) {
                        base64Payload = {
                            type: 'WORLD_SNAPSHOT',
                            b: uint8ToBase64(new Uint8Array(binBuffer)),
                        };
                    }
                    this.sendConn(conn, base64Payload, 65536);
                } else {
                    if (!jsonPayload) {
                        jsonPayload = snapshot?.players
                            ? { type: 'WORLD_SNAPSHOT', ...snapshot }
                            : typeof serializeWorldForNetworkJSON === 'function'
                              ? {
                                    type: 'WORLD_SNAPSHOT',
                                    ...serializeWorldForNetworkJSON(),
                                }
                              : { type: 'WORLD_SNAPSHOT', ...snapshot };
                    }
                    this.sendConn(conn, jsonPayload, 65536);
                }
            }
        }
    }

    // Host sends lobby status (who is connected and ready)
    broadcastLobbyState(playersState, allReady) {
        if (!this.isHost) return;
        const msg = {
            type: 'LOBBY_STATE',
            players: playersState,
            allReady: allReady,
        };
        for (const conn of this.connections.values()) {
            if (conn?.open) {
                this.sendConn(conn, msg);
            }
        }
    }

    // Client sends input stream to host (prioritizing unreliable stream channel)
    sendLocalInput(moveX, moveY, angle, dashing = false) {
        if (!this.isClient) return;
        this.clientInputSeq = (this.clientInputSeq || 0) + 1;
        const msg = {
            type: 'INPUT',
            seq: this.clientInputSeq,
            playerIndex: this.localPlayerIndex,
            moveX: moveX,
            moveY: moveY,
            angle: angle,
            dashing: dashing,
        };

        if (this.streamConnection?.open) {
            this.sendConn(this.streamConnection, msg, 32768);
        } else if (this.hostConnection?.open) {
            this.sendConn(this.hostConnection, msg, 32768);
        }
    }

    // Client sends weapon choice to host
    sendWeaponSelection(weaponId) {
        if (this.isClient && this.hostConnection?.open) {
            this.sendConn(this.hostConnection, {
                type: 'SELECT_WEAPON',
                playerIndex: this.localPlayerIndex,
                weaponId: weaponId,
            });
        }
    }

    // Client sends upgrade pick to host
    sendUpgradeSelection(upgradeId) {
        if (this.isClient && this.hostConnection?.open) {
            this.sendConn(this.hostConnection, {
                type: 'SELECT_UPGRADE',
                playerIndex: this.localPlayerIndex,
                upgradeId: upgradeId,
            });
        }
    }

    // Client sends updated custom player name to host
    sendPlayerName(name) {
        if (!name) return;
        const cleaned = String(name)
            .normalize('NFC')
            .replace(/[^\p{Script=Latin}0-9 ]/gu, '')
            .slice(0, 20)
            .trim();
        if (this.isClient && this.hostConnection?.open) {
            this.sendConn(this.hostConnection, {
                type: 'SET_PLAYER_NAME',
                playerIndex: this.localPlayerIndex,
                name: cleaned,
            });
        } else if (this.isHost) {
            const hostPlayer = GAME_STATE.players?.[0];
            if (hostPlayer) hostPlayer.name = cleaned || 'Player 1';
            const activePlayers = (GAME_STATE.players || []).filter(
                (pl) => pl && !pl.disconnected,
            );
            const allReady =
                activePlayers.length > 0 &&
                activePlayers.every((pl) => pl.selectedWeapon);
            this.broadcastLobbyState(
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

    broadcast(messageObj) {
        if (this.isHost) {
            for (const conn of this.connections.values()) {
                if (conn.open) this.sendConn(conn, messageObj);
            }
        } else if (this.isClient && this.hostConnection?.open) {
            this.sendConn(this.hostConnection, messageObj);
        }
    }
}

// --- Mid-game Player Entity Despawn & Cleanup ---
function despawnPlayerEntities(playerIndex) {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.players) return;
    const player = GAME_STATE.players[playerIndex];
    if (!player) return;

    // 1. Mark player as disconnected while preserving alive/dead status
    player.disconnected = true;
    player.wasAliveOnDisconnect = player.alive;
    player.lastInputSeq = 0;

    // 2. Despawn all turrets owned by this player
    if (GAME_STATE.turrets) {
        for (let i = GAME_STATE.turrets.length - 1; i >= 0; i--) {
            const t = GAME_STATE.turrets[i];
            if (
                t.player === player ||
                (t.player && t.player.index === playerIndex)
            ) {
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
            if (
                h.player === player ||
                (h.player && h.player.index === playerIndex) ||
                h.owner === player
            ) {
                h.alive = false;
                if (typeof h.despawn === 'function') h.despawn();
                GAME_STATE.hazards.splice(i, 1);
            }
        }
    }

    // 4. Remove magnetic mines tracking
    if (GAME_STATE.magneticMines) {
        GAME_STATE.magneticMines = GAME_STATE.magneticMines.filter(
            (m) =>
                m.player !== player &&
                (!m.player || m.player.index !== playerIndex),
        );
    }

    // 5. Despawn projectiles fired by this player
    if (GAME_STATE.projectiles) {
        for (let i = GAME_STATE.projectiles.length - 1; i >= 0; i--) {
            const proj = GAME_STATE.projectiles[i];
            if (
                proj.player === player ||
                (proj.player && proj.player.index === playerIndex) ||
                proj.owner === player
            ) {
                proj.alive = false;
                GAME_STATE.projectiles.splice(i, 1);
            }
        }
    }

    if (player?.weapons) {
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
            if (
                e.targetPlayer === player ||
                (e.targetPlayer && e.targetPlayer.index === playerIndex)
            ) {
                e.targetPlayer = null;
            }
            if (
                e.target === player ||
                (e.target && e.target.index === playerIndex)
            ) {
                e.target = null;
            }
            if (
                e.turretTarget === player ||
                (e.turretTarget && e.turretTarget.index === playerIndex)
            ) {
                e.turretTarget = null;
            }
        }
    }
}

// --- Multiplayer Network Event Handlers ---
window.onOnlinePlayerJoined = (assignedSlot, peerId, isReconnection) => {
    console.log(
        `[Game] Online peer joined as Player ${assignedSlot + 1} (Reconnection: ${!!isReconnection})`,
    );
    let p = GAME_STATE.players[assignedSlot];
    if (!p) {
        GAME_STATE.players[assignedSlot] = new Player(
            assignedSlot,
            PLAYER_DEFS[assignedSlot],
        );
        p = GAME_STATE.players[assignedSlot];
    } else {
        p.disconnected = false;
        p.lastInputSeq = 0;
        if (isReconnection) {
            const now =
                typeof gameClock !== 'undefined'
                    ? gameClock
                    : performance.now();
            const reviveDuration =
                (typeof REVIVE_MS !== 'undefined' ? REVIVE_MS : 20000) *
                (p.reviveTimeModifier || 1.0);
            const diedBeforeBoss =
                !GAME_STATE.activeBoss ||
                p.deadAt < GAME_STATE.activeBossStartTime;
            const isActuallyAlive =
                (typeof p.isAlive === 'function' ? p.isAlive() : p.alive) &&
                p.hp > 0;
            const deathTimerExpired =
                !isActuallyAlive &&
                p.deadAt &&
                diedBeforeBoss &&
                now - p.deadAt >= reviveDuration;

            if (isActuallyAlive) {
                // User requirement: 1 second invulnerability only if alive when disconnecting
                p.invuln = 1000;
                p.spawnInvuln = 1000;
                p.clampToArena();
                if (p.weapons) {
                    for (const w of p.weapons) {
                        if (
                            w.id === 'fire_ring' ||
                            w.id === 'projectile_shield'
                        ) {
                            w.initialized = false;
                            w.orbiters = [];
                        }
                    }
                }
                if (
                    p.selectedWeapon &&
                    (!p.weapons || p.weapons.length === 0)
                ) {
                    p.unlockWeapon(p.selectedWeapon);
                }
            } else if (deathTimerExpired) {
                // Death timer ran out right when reconnecting: Revive with 1s invulnerability
                p.revive();
                p.invuln = 1000;
                p.spawnInvuln = 1000;
                p.clampToArena();
                if (p.weapons) {
                    for (const w of p.weapons) {
                        if (
                            w.id === 'fire_ring' ||
                            w.id === 'projectile_shield'
                        ) {
                            w.initialized = false;
                            w.orbiters = [];
                        }
                    }
                }
                if (
                    p.selectedWeapon &&
                    (!p.weapons || p.weapons.length === 0)
                ) {
                    p.unlockWeapon(p.selectedWeapon);
                }
            } else {
                // Reconnected while death counter has still not counted down fully: Stay dead!
                p.alive = false;
                p.hp = 0;
                p.invuln = 0;
                p.spawnInvuln = 0;
            }
        } else {
            p.alive = true;
        }
    }
    recalculateDynamicDifficulty();

    if (GAME_STATE.current === STATES.WEAPON_SELECT) {
        renderLobbyWeaponPanels();
        const activePlayers = (GAME_STATE.players || []).filter(
            (pl) => pl && !pl.disconnected,
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
};

window.onOnlinePlayerDisconnected = (playerIndex, peerId) => {
    console.warn(`[Game] Online peer disconnected: Player ${playerIndex + 1}`);
    const p = GAME_STATE.players?.[playerIndex];
    const pName = p?.name || `Player ${playerIndex + 1}`;
    if (typeof showToast === 'function') {
        showToast(`${pName} disconnected from the match.`, 4000, true);
    }
    despawnPlayerEntities(playerIndex);
    recalculateDynamicDifficulty();

    if (GAME_STATE.current === STATES.WEAPON_SELECT) {
        if (GAME_STATE.players?.[playerIndex]) {
            delete GAME_STATE.players[playerIndex];
            while (
                GAME_STATE.players.length > 1 &&
                !GAME_STATE.players[GAME_STATE.players.length - 1]
            ) {
                GAME_STATE.players.pop();
            }
        }
        renderLobbyWeaponPanels();
        const activePlayers = (GAME_STATE.players || []).filter(
            (pl) => pl && !pl.disconnected,
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
    } else if (
        GAME_STATE.current === STATES.LEVEL_UP &&
        netManager &&
        netManager.isHost
    ) {
        // Disconnected player in level up: immediately offer Kick button to host
        const panel = document.getElementById(`levelPanel_${playerIndex}`);
        if (
            panel &&
            panel.dataset.pickDone !== 'true' &&
            !panel.querySelector('.kick-player-btn')
        ) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'kick-player-btn';
            kickBtn.innerHTML = `⚠️ Kick Player ${playerIndex + 1} (Disconnected)`;
            kickBtn.onclick = (e) => {
                e.stopPropagation();
                if (
                    confirm(
                        `Permanently kick Player ${playerIndex + 1} from this game session?`,
                    )
                ) {
                    kickPlayerByHost(playerIndex);
                }
            };
            panel.appendChild(kickBtn);
        }
    }
};

window.onAssignedSlot = (
    assignedSlot,
    difficultyName,
    currentGameState,
    connectedSlots,
    hostW,
    hostH,
    isReconnection,
    elapsed,
    upgradesMap,
    chosenUpgradesMap,
    pendingLevels,
    isAlive,
    deadAt,
) => {
    console.log(
        `[Game] Joined room! Assigned Player ${assignedSlot + 1} (Reconnection: ${!!isReconnection})`,
    );
    GAME_STATE.gameMode = 'online';
    GAME_STATE.isOnline = true;
    GAME_STATE.isHost = false;
    GAME_STATE.isClient = true;
    lastReceivedSnapshotSeq = 0;
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
    const slots =
        Array.isArray(connectedSlots) && connectedSlots.length > 0
            ? connectedSlots
            : [0, assignedSlot];
    for (const s of slots) {
        GAME_STATE.players[s] = new Player(s, PLAYER_DEFS[s]);
    }
    if (upgradesMap) {
        for (const idx in upgradesMap) {
            const p = GAME_STATE.players[idx];
            if (p) {
                p.currentUpgradeOptions = upgradesMap[idx]
                    .map((id) => UPGRADE_POOL.find((u) => u.id === id))
                    .filter(Boolean);
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
        const myP = GAME_STATE.players[assignedSlot];
        if (isAlive !== undefined) {
            myP.alive = Boolean(isAlive);
        }
        if (deadAt !== undefined) {
            myP.deadAt = deadAt;
        }
        if (myP.alive && myP.hp > 0) {
            myP.invuln = 1000;
            myP.spawnInvuln = 1000;
        } else {
            myP.alive = false;
            myP.hp = 0;
            myP.invuln = 0;
            myP.spawnInvuln = 0;
        }
    }
    recalculateDynamicDifficulty();

    const startMenu = document.getElementById('startMenu');
    if (startMenu) startMenu.classList.remove('show');
    const joinStep = document.getElementById('joinRoomStep');
    if (joinStep) joinStep.style.display = 'none';
    const tBtn = document.getElementById('testingBtn');
    if (tBtn) tBtn.style.display = 'none';
    const rBtn = document.getElementById('relayToggleBtn');
    if (rBtn) rBtn.style.display = 'none';

    if (
        currentGameState === STATES.WEAPON_SELECT ||
        currentGameState === STATES.START_MENU ||
        !isReconnection
    ) {
        startWeaponSelectFlow();
    } else if (currentGameState === STATES.LEVEL_UP) {
        GAME_STATE.current = STATES.LEVEL_UP;
        GAME_STATE.pendingLevels = pendingLevels || 1;
        SoundEngine.setMuffled(true, 0.5);
        const zone =
            document.getElementById('joystickZone') ||
            (typeof joystickZone !== 'undefined'
                ? joystickZone
                : typeof window !== 'undefined'
                  ? window.joystickZone
                  : null);
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

window.onRemoteInputReceived = (
    playerIndex,
    moveX,
    moveY,
    angle,
    dashing,
    seq = null,
) => {
    if (typeof playerIndex !== 'number' || playerIndex < 1 || playerIndex > 3) {
        return;
    }
    const p = GAME_STATE.players?.[playerIndex];
    if (p && !p.disconnected && !p.kicked) {
        // Discard out-of-order stale inputs received over unreliable channel
        if (
            typeof seq === 'number' &&
            typeof p.lastInputSeq === 'number' &&
            p.lastInputSeq > 0
        ) {
            const diff = (seq - p.lastInputSeq) | 0;
            if (diff <= 0 && diff > -1000000) {
                return; // Stale input arrived late -> discard
            }
        }
        if (typeof seq === 'number') {
            p.lastInputSeq = seq;
        }

        let mx = Number.isFinite(moveX) ? moveX : 0;
        let my = Number.isFinite(moveY) ? moveY : 0;
        const mag = Math.hypot(mx, my);
        if (mag > 1.0) {
            mx /= mag;
            my /= mag;
        }
        const safeAngle = Number.isFinite(angle) ? angle : p.facingAngle;
        const safeDashing = Boolean(dashing);

        p.remoteInput = {
            moveX: mx,
            moveY: my,
            angle: safeAngle,
            dashing: safeDashing,
        };
        const hostClock =
            typeof gameClock !== 'undefined' && gameClock > 0
                ? gameClock
                : typeof GAME_STATE !== 'undefined' &&
                    GAME_STATE.elapsed !== undefined
                  ? GAME_STATE.elapsed
                  : performance.now();
        if (
            safeDashing &&
            !p.dashing &&
            p.dashEnabled &&
            hostClock >= (p.dashCooldownUntil || 0)
        ) {
            p.dashVx = (mx || Math.cos(p.facingAngle)) * 14;
            p.dashVy = (my || Math.sin(p.facingAngle)) * 14;
            p.dashing = true;
            p.dashBurstFired = false;
            p.dashUntil =
                hostClock +
                (typeof PLAYER_DASH_MS !== 'undefined' ? PLAYER_DASH_MS : 300);
            const dAngle = Math.atan2(p.dashVy, p.dashVx);
            p.dashLaunchEffect = {
                startX: p.x,
                startY: p.y,
                angle: dAngle,
                startTime: hostClock,
                duration: 600,
                dashDuration: 200,
            };
            if (typeof SoundEngine !== 'undefined' && SoundEngine.phaseDash) {
                SoundEngine.phaseDash();
            }
            if (typeof queueNetworkBlobDeform === 'function') {
                queueNetworkBlobDeform(p.index, 5, dAngle);
            }
        }
    }
};

window.onRemoteWeaponSelected = (playerIndex, weaponId) => {
    if (
        typeof GAME_STATE === 'undefined' ||
        typeof STATES === 'undefined' ||
        GAME_STATE.current !== STATES.WEAPON_SELECT
    ) {
        console.warn(
            `[Net] Rejected weapon select from P${playerIndex + 1} - game already started.`,
        );
        return;
    }
    if (
        typeof WEAPON_LABELS === 'undefined' ||
        !WEAPON_LABELS[weaponId]
    ) {
        console.warn(
            `[Net] Rejected invalid weaponId "${weaponId}" from P${playerIndex + 1}.`,
        );
        return;
    }
    const p = GAME_STATE.players?.[playerIndex];
    if (p && !p.disconnected && !p.kicked) {
        p.selectedWeapon = weaponId;
        p.selectedWeaponLabel = WEAPON_LABELS[weaponId];
        p.weapons = [];
        p.unlockWeapon(weaponId);

        if (typeof renderLobbyWeaponPanels === 'function') {
            renderLobbyWeaponPanels();
        }

        const activePlayers = (GAME_STATE.players || []).filter(
            (pl) => pl && !pl.disconnected,
        );
        const allReady =
            activePlayers.length > 0 &&
            activePlayers.every((pl) => pl.selectedWeapon);
        const lobbyStartBtn = document.getElementById('lobbyStartBtn');
        if (lobbyStartBtn) lobbyStartBtn.disabled = !allReady;

        netManager.broadcastLobbyState(
            activePlayers.map((pl) => ({
                index: pl.index,
                name: pl.name || `Player ${pl.index + 1}`,
                selectedWeapon: pl.selectedWeapon,
                selectedWeaponLabel: pl.selectedWeaponLabel,
            })),
            allReady,
        );
    }
};

window.onRemotePlayerNameChanged = (playerIndex, newName) => {
    const p = GAME_STATE.players?.[playerIndex];
    if (p && newName) {
        const cleaned = String(newName)
            .normalize('NFC')
            .replace(/[^\p{Script=Latin}0-9 ]/gu, '')
            .slice(0, 20)
            .trim();
        if (cleaned) {
            p.name = cleaned;
            if (typeof renderLobbyWeaponPanels === 'function') {
                renderLobbyWeaponPanels();
            }
            if (netManager?.isHost) {
                const activePlayers = (GAME_STATE.players || []).filter(
                    (pl) => pl && !pl.disconnected,
                );
                const allReady =
                    activePlayers.length > 0 &&
                    activePlayers.every((pl) => pl.selectedWeapon);
                netManager.broadcastLobbyState(
                    activePlayers.map((pl) => ({
                        index: pl.index,
                        name: pl.name || `Player ${pl.index + 1}`,
                        selectedWeapon: pl.selectedWeapon,
                        selectedWeaponLabel: pl.selectedWeaponLabel,
                    })),
                    allReady,
                );
            }
        }
    }
};

window.onRemoteUpgradeSelected = (playerIndex, upgradeId) => {
    if (
        typeof GAME_STATE === 'undefined' ||
        typeof STATES === 'undefined' ||
        GAME_STATE.current !== STATES.LEVEL_UP
    ) {
        console.warn(
            `[Net] Rejected upgrade select from P${playerIndex + 1} - not in LEVEL_UP state.`,
        );
        return;
    }
    const p = GAME_STATE.players?.[playerIndex];
    if (!p || p.disconnected || p.kicked) return;

    const panel = document.getElementById(`levelPanel_${playerIndex}`);
    if (
        p._virtualPickDone ||
        (panel && panel.dataset.pickDone === 'true') ||
        p.currentLevelUpgradeName
    ) {
        console.warn(
            `[Net] Rejected duplicate upgrade pick from P${playerIndex + 1}.`,
        );
        return;
    }

    if (!p.currentUpgradeOptions || !Array.isArray(p.currentUpgradeOptions)) {
        console.warn(
            `[Net] Rejected upgrade pick from P${playerIndex + 1} - no options offered.`,
        );
        return;
    }

    const upgrade = p.currentUpgradeOptions.find(
        (item) => item && item.id === upgradeId,
    );
    if (!upgrade) {
        console.warn(
            `[Net] Rejected upgrade "${upgradeId}" from P${playerIndex + 1} - not among rolled choices.`,
        );
        return;
    }

    p.currentLevelUpgradeName = upgrade.name;
    upgrade.effect(p);
    if (upgrade.oneShot) p.takenOneShots.add(upgrade.id);

    netManager.broadcast({
        type: 'UPGRADE_CHOSEN_SYNC',
        playerIndex: playerIndex,
        upgradeId: upgradeId,
        upgradeName: upgrade.name,
    });
    if (panel) {
        onPlayerChose(panel, p);
    } else if (typeof onPlayerChoseVirtual === 'function') {
        onPlayerChoseVirtual(p);
    }
};

window.onUpgradeChosenSync = (playerIndex, upgradeId, upgradeName) => {
    const p = GAME_STATE.players[playerIndex];
    if (p) {
        p.currentLevelUpgradeName = upgradeName;
        if (upgradeId) {
            const upgrade = UPGRADE_POOL.find((item) => item.id === upgradeId);
            if (
                upgrade &&
                (!netManager.isClient ||
                    playerIndex !== netManager.localPlayerIndex)
            ) {
                upgrade.effect(p);
                if (upgrade.oneShot) p.takenOneShots.add(upgrade.id);
            }
        }
        const panel = document.getElementById(`levelPanel_${playerIndex}`);
        if (panel) onPlayerChose(panel, p);
    }
};

window.onLobbyStateUpdated = (playersData, allReady) => {
    if (!playersData) return;
    const activeIndices = new Set(playersData.map((pd) => pd.index));
    // Clear slots that are no longer connected
    for (let i = 0; i < 4; i++) {
        if (
            !activeIndices.has(i) &&
            (typeof netManager === 'undefined' ||
                i !== netManager.localPlayerIndex)
        ) {
            delete GAME_STATE.players[i];
        }
    }
    for (const pd of playersData) {
        if (!GAME_STATE.players[pd.index]) {
            GAME_STATE.players[pd.index] = new Player(
                pd.index,
                PLAYER_DEFS[pd.index],
            );
        }
        const p = GAME_STATE.players[pd.index];
        if (pd.name && pd.name !== p.name) {
            p.name = pd.name;
        }
        if (p.selectedWeapon !== pd.selectedWeapon) {
            p.selectedWeapon = pd.selectedWeapon;
            p.selectedWeaponLabel = pd.selectedWeaponLabel;
            p.weapons = [];
            if (pd.selectedWeapon) p.unlockWeapon(pd.selectedWeapon);
        }
    }
    renderLobbyWeaponPanels();
};

window.onOnlineCountdownStarted = (isNewGame) => {
    document.getElementById('levelUpLayer').classList.remove('show');
    const tipEl = document.getElementById('tipText');
    if (tipEl) tipEl.style.display = 'none';
    const inviteBanner = document.getElementById('inviteCodeBanner');
    if (inviteBanner) inviteBanner.style.display = 'none';
    const hostOverlay = document.getElementById('hostPauseOverlay');
    if (hostOverlay) hostOverlay.style.display = 'none';
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
        if (typeof clientDeadEnemyIds !== 'undefined') clientDeadEnemyIds.clear();
        if (typeof netDeadEnemyMap !== 'undefined') netDeadEnemyMap.clear();
        if (typeof clientTurretCache !== 'undefined') clientTurretCache.clear();
        if (typeof clientHazardCache !== 'undefined') clientHazardCache.clear();
        if (typeof clientProjectileCache !== 'undefined')
            clientProjectileCache.clear();
        if (typeof clientEnemyProjectileCache !== 'undefined')
            clientEnemyProjectileCache.clear();
        if (typeof clientGemCache !== 'undefined') clientGemCache.clear();
        if (typeof clientCollectedGems !== 'undefined')
            clientCollectedGems.clear();
        if (typeof netHitEvents !== 'undefined') netHitEvents.length = 0;
        if (typeof netSoundEvents !== 'undefined') netSoundEvents.length = 0;
        if (typeof netVfxEvents !== 'undefined') netVfxEvents.length = 0;
        if (typeof netBlobDeforms !== 'undefined') netBlobDeforms.length = 0;
        if (typeof clientSnapshotBuffer !== 'undefined')
            clientSnapshotBuffer.length = 0;
        lastReceivedSnapshotSeq = 0;
        snapshotSeq = 0;
        if (typeof SPATIAL_GRID !== 'undefined' && SPATIAL_GRID.clear)
            SPATIAL_GRID.clear();
        if (typeof resizeCanvas === 'function') resizeCanvas();
        if (
            typeof ctx !== 'undefined' &&
            ctx &&
            typeof canvas !== 'undefined' &&
            canvas
        ) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    startCountdown(isNewGame);
};

let netEntityCounter = 1;
let netGemSyncTick = 0;
let snapshotSeq = 0;
let lastReceivedSnapshotSeq = 0;
const clientEnemyCache = new Map(); // id -> Enemy instance
const clientTurretCache = new Map(); // id -> TurretEntity instance
const clientHazardCache = new Map(); // id -> Hazard instance
const clientProjectileCache = new Map(); // id -> NetworkProjectileProto instance
const clientEnemyProjectileCache = new Map(); // id -> NetworkEnemyProjectileProto instance
const clientGemCache = new Map(); // id -> Collectible instance
const clientCollectedGems = new Set(); // Set of _nid collected locally on client
window.clientCollectedGems = clientCollectedGems;
const netHitEvents = []; // [ [x, y, colorByte], ... ] queued on host
const netSoundEvents = []; // [ soundId, ... ] queued on host
const netVfxEvents = []; // [ [type, x, y, param], ... ] queued on host
const netBlobDeforms = []; // [ [playerIndex, deformType, angleByte], ... ] queued on host
const clientSnapshotBuffer = []; // [ { clientTime, serverTime, snapshot } ]
const clientDeadEnemyIds = new Set(); // Set of enemy _nid authoritatively dead
window.clientDeadEnemyIds = clientDeadEnemyIds;
const netDeadEnemyMap = new Map(); // nid -> expiry timestamp (now + 700ms) on host
window.netDeadEnemyMap = netDeadEnemyMap;

function queueNetworkEnemyDeath(nid) {
    if (!nid) return;
    const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
    netDeadEnemyMap.set(nid, now + 700);
}
window.queueNetworkEnemyDeath = queueNetworkEnemyDeath;

const NET_HIT_COLORS = [
    '#ffff66', // 0: Magic missile yellow
    '#33ccff', // 1: Laser cyan
    '#ffaa00', // 2: Rocket orange
    '#ff8f00', // 3: Pierce spark
    '#a8a29e', // 4: Obstacle stone gray
    '#00ffcc', // 5: Cyan/Player 0
    '#ff3366', // 6: Pink/Player 1
    '#aa00ff', // 7: Purple/Player 2
    '#ffffff', // 8: White hit
    '#ff4444', // 9: Red hit
    '#ffcc00', // 10: Golden hit
    '#cccccc', // 11: Light gray
    '#76ff03', // 12: Lime
    '#ff3300', // 13: Bright red
    '#00ffff', // 14: Teal
    '#ff5500', // 15: Deep orange
];

function colorToByte(c) {
    if (!c) return 8;
    const idx = NET_HIT_COLORS.indexOf(c);
    return idx >= 0 ? idx : 8;
}

function byteToColor(b) {
    return NET_HIT_COLORS[b] || '#ffffff';
}

function queueNetworkHitEvent(x, y, color) {
    if (netHitEvents.length >= 24) return;
    netHitEvents.push([
        Math.round(x || 0),
        Math.round(y || 0),
        colorToByte(color),
    ]);
}
window.queueNetworkHitEvent = queueNetworkHitEvent;

const NET_SOUND_NAMES = [
    null, // 0: reserved
    null, // 1: reserved (levelUp synchronized directly via LEVEL_UP_START event)
    'bossWarning', // 2
    'nukeExplosion', // 3
    'campervan', // 4
    'supplyDrop', // 5
    'shieldBlock', // 6
    'mineExplosion', // 7
    'meleeSweep', // 8
    'flamethrower', // 9
    'fireRingHit', // 10
    'missileFire', // 11
    'laserSniper', // 12
    'rocketLaunch', // 13
    'flailHit', // 14
    'autonomousNetwork', // 15
    'meteorFall', // 16
    'dasherJump', // 17
    'shooterFire', // 18
    'tentacleLash', // 19
    'stalkerBlink', // 20
    'felhoundGallop', // 21
    'hellionFlame', // 22
    'warpAnomaly', // 23
    'viperTongue', // 24
    'titanSprint', // 25
    'titanUnderground', // 26
    'behemothCleave', // 27
    'behemothMortar', // 28
    'behemothBurrow', // 29
    'medivacHeal', // 30
    'heal', // 31
    'playerDamaged', // 32
    'sledgeSweep', // 33
    'healMajor', // 34
    'turretMissileFire', // 35
    'enemyFreeze', // 36
];
window.NET_SOUND_NAMES = NET_SOUND_NAMES;

function queueNetworkSoundEvent(soundId) {
    if (!soundId || netSoundEvents.length >= 16) return;
    if (netSoundEvents.indexOf(soundId) !== -1) return;
    netSoundEvents.push(soundId);
}
window.queueNetworkSoundEvent = queueNetworkSoundEvent;

function playNetworkSound(soundId) {
    if (typeof SoundEngine === 'undefined') return;
    if (soundId === 33) {
        if (typeof SoundEngine.meleeSweep === 'function') {
            SoundEngine.meleeSweep(true);
        }
        return;
    }
    if (soundId === 34) {
        if (typeof SoundEngine.heal === 'function') {
            SoundEngine.heal('medium');
        }
        return;
    }
    if (soundId === 35) {
        if (typeof SoundEngine.missileFire === 'function') {
            SoundEngine.missileFire(0.2, true);
        }
        return;
    }
    const name = NET_SOUND_NAMES[soundId];
    if (name && typeof SoundEngine[name] === 'function') {
        SoundEngine[name]();
    }
}
window.playNetworkSound = playNetworkSound;

let hostSoundBroadcastingInitialized = false;
function setupHostSoundBroadcasting() {
    if (hostSoundBroadcastingInitialized || typeof SoundEngine === 'undefined') return;
    hostSoundBroadcastingInitialized = true;

    for (let id = 1; id < NET_SOUND_NAMES.length; id++) {
        const soundName = NET_SOUND_NAMES[id];
        if (!soundName) continue;
        const origFn = SoundEngine[soundName];
        if (typeof origFn !== 'function') continue;

        if (soundName === 'meleeSweep') {
            SoundEngine.meleeSweep = function(isSledge = false, ...args) {
                const res = origFn.call(this, isSledge, ...args);
                if (netManager?.isHost && netManager?.connections?.size > 0) {
                    queueNetworkSoundEvent(isSledge ? 33 : 8);
                }
                return res;
            };
        } else if (soundName === 'heal') {
            SoundEngine.heal = function(volumeMode = 'low', ...args) {
                const res = origFn.call(this, volumeMode, ...args);
                if (netManager?.isHost && netManager?.connections?.size > 0) {
                    queueNetworkSoundEvent(
                        volumeMode === 'medium' || volumeMode === 'high' ? 34 : 31,
                    );
                }
                return res;
            };
        } else if (soundName === 'missileFire') {
            SoundEngine.missileFire = function(
                soundVolumeFactor = 1.0,
                isTurret = false,
                ...args
            ) {
                const res = origFn.call(this, soundVolumeFactor, isTurret, ...args);
                if (netManager?.isHost && netManager?.connections?.size > 0) {
                    queueNetworkSoundEvent(isTurret ? 35 : 11);
                }
                return res;
            };
        } else {
            const capturedId = id;
            SoundEngine[soundName] = function(...args) {
                const res = origFn.apply(this, args);
                if (netManager?.isHost && netManager?.connections?.size > 0) {
                    queueNetworkSoundEvent(capturedId);
                }
                return res;
            };
        }
    }
}
window.setupHostSoundBroadcasting = setupHostSoundBroadcasting;

function queueNetworkBlobDeform(playerIndex, deformType, angle = 0) {
    if (netBlobDeforms.length >= 16) return;
    if (!netManager?.isHost || !netManager?.connections?.size) return;
    netBlobDeforms.push([
        (playerIndex || 0) & 0x0f,
        deformType & 0x0f,
        angleToUint8(angle),
    ]);
}
window.queueNetworkBlobDeform = queueNetworkBlobDeform;

function applyNetworkBlobDeform(playerIndex, deformType, angleRad) {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.players) return;
    const isRemote =
        typeof netManager !== 'undefined' &&
        netManager &&
        playerIndex !== netManager.localPlayerIndex;

    if (deformType === 5 && isRemote) {
        if (typeof SoundEngine !== 'undefined' && SoundEngine.phaseDash) {
            SoundEngine.phaseDash();
        }
    }

    const p = GAME_STATE.players[playerIndex];
    if (!p) return;

    const nowTime =
        typeof gameClock !== 'undefined'
            ? gameClock
            : typeof performance !== 'undefined'
              ? performance.now()
              : Date.now();

    switch (deformType) {
        case 1: // ROCKET_LAUNCH
            p.rocketAnimation = {
                startTime: nowTime,
                duration: 400,
                angle: angleRad,
            };
            break;
        case 2: // MINE_LAUNCH
            p.mineLaunchAnimation = {
                startTime: nowTime,
                duration: 400,
                angle: angleRad,
                stacks: 0,
            };
            break;
        case 3: // TURRET_HATCH
            p.hatchAnimation = {
                startTime: nowTime,
                duration: 500,
                angle: angleRad,
            };
            break;
        case 4: // SNIPER_CHARGE
            p.sniperCharge = {
                startTime: nowTime,
                preFireDuration: 200,
                totalDuration: 300,
                angle: angleRad,
                fired: false,
            };
            break;
        case 5: // DASH_LAUNCH
            if (isRemote || !p.dashLaunchEffect) {
                p.dashLaunchEffect = {
                    startTime: nowTime,
                    duration: 600,
                    dashDuration: 200,
                    angle: angleRad,
                    startX: p.x,
                    startY: p.y,
                };
            }
            if (isRemote) {
                p.dashing = true;
                p.dashUntil = nowTime + 200;
            }
            break;
        case 6: // MITOSIS_BUD
            p.mitosisBuds = p.mitosisBuds || [];
            p.mitosisBuds.push({
                angle: angleRad,
                time: nowTime,
                duration: 150,
            });
            break;
    }
}
window.applyNetworkBlobDeform = applyNetworkBlobDeform;

function queueNetworkCombatVfx(type, x, y, param = 0, playerIndex = 0) {
    if (netVfxEvents.length >= 32) return;
    if (!netManager?.isHost || !netManager?.connections?.size) return;
    const header = ((playerIndex & 0x03) << 4) | (type & 0x0f);
    netVfxEvents.push([
        header & 0xff,
        Math.round(x || 0),
        Math.round(y || 0),
        Math.min(255, Math.max(0, Math.round(param || 0))),
    ]);
}
window.queueNetworkCombatVfx = queueNetworkCombatVfx;

function isMultiplayerClient() {
    return Boolean(
        typeof netManager !== 'undefined' &&
        netManager &&
        !netManager.isHost &&
        (netManager.connections?.size > 0 || netManager.peer)
    );
}
window.isMultiplayerClient = isMultiplayerClient;

function getEnemyVisualState(e, hostClock) {
    if (!e) return { vState: 0, vParam: 0 };
    if (e.type === 'baneling') {
        if (e.burrowed) return { vState: 1, vParam: 0 };
    } else if (e.type === 'hellion') {
        if (e.aiming) {
            return { vState: 2, vParam: angleToUint8(e.aimAngle) };
        }
        if (e.flameBeamUntil && e.flameBeamUntil > hostClock) {
            const rem = Math.min(
                255,
                Math.max(0, Math.round(e.flameBeamUntil - hostClock)),
            );
            return { vState: 3, vParam: rem };
        }
    } else if (e.type === 'viper') {
        if (e.heldPlayer?.alive && e.heldPlayer.viperGrabber === e) {
            const pIdx =
                e.heldPlayer.index !== undefined ? e.heldPlayer.index : 0;
            return { vState: 6, vParam: pIdx & 3 };
        }
        if (e.viperState === 'tongue_firing' || e.tongueActive) {
            const a =
                e.tongueAimAngle !== undefined
                    ? e.tongueAimAngle
                    : e.tongueAngle !== undefined
                      ? e.tongueAngle
                      : e.facingAngle;
            return { vState: 5, vParam: angleToUint8(a) };
        }
        if (e.viperState === 'stopped_attracting') {
            const a =
                e.tongueAimAngle !== undefined
                    ? e.tongueAimAngle
                    : e.aimAngle !== undefined
                      ? e.aimAngle
                      : e.facingAngle;
            return { vState: 4, vParam: angleToUint8(a) };
        }
    } else if (e.type === 'behemoth') {
        if (e.nydusEmerging) {
            const el = hostClock - (e.nydusStartTime || hostClock);
            const p = Math.max(
                0,
                Math.min(
                    255,
                    Math.round((el / (e.nydusDuration || 2200)) * 255),
                ),
            );
            return { vState: 7, vParam: p };
        }
        if (e.behemothState === 'erupting') {
            const el = hostClock - (e.eruptStartTime || hostClock);
            const p = Math.max(
                0,
                Math.min(
                    255,
                    Math.round((el / (e.eruptDuration || 2200)) * 255),
                ),
            );
            return { vState: 8, vParam: p };
        }
        if (e.behemothState === 'burrowing') {
            const rem = Math.max(
                0,
                Math.min(255, Math.round((e.stateTimer || hostClock) - hostClock)),
            );
            return { vState: 9, vParam: rem };
        }
        if (e.behemothState === 'cleave_windup') {
            return {
                vState: 10,
                vParam: angleToUint8(e.cleaveAngle || e.facingAngle),
            };
        }
        if (e.behemothState === 'charge_windup') {
            return {
                vState: 15,
                vParam: angleToUint8(e.chargeAngle || e.facingAngle),
            };
        }
        if (e.behemothState === 'tongue_windup') {
            return {
                vState: 16,
                vParam: angleToUint8(e.tongueAimAngle || e.facingAngle),
            };
        }
        if (e.behemothState === 'subterranean_travel') {
            return { vState: 13, vParam: 0 };
        }
    } else if (e.type === 'marauder') {
        if (e.aiming) {
            return { vState: 14, vParam: angleToUint8(e.aimAngle) };
        }
    } else if (e.type === 'medivac') {
        if (e.healTargets && e.healTargets.length > 0) {
            const ht = e.healTargets[0];
            if (ht?.alive && ht._nid) {
                return { vState: 11, vParam: ht._nid };
            }
        }
    } else if (e.type === 'stalker') {
        if (e.blinkFlashUntil && e.blinkFlashUntil > hostClock) {
            const rem = Math.min(
                65535,
                Math.max(0, Math.round(e.blinkFlashUntil - hostClock)),
            );
            return { vState: 12, vParam: rem };
        }
    }
    return { vState: 0, vParam: 0 };
}
window.getEnemyVisualState = getEnemyVisualState;

function applyEnemyVisualState(e, vs, vp, nowTime) {
    if (!e) return;
    if (vs === 0) {
        if (e.type === 'baneling') {
            e.burrowed = false;
        } else if (e.type === 'hellion') {
            e.aiming = false;
            e.flameBeamUntil = 0;
            e.flameLine = null;
        } else if (e.type === 'viper') {
            if (e.heldPlayer && e.heldPlayer.viperGrabber === e) {
                e.heldPlayer.viperGrabber = null;
            }
            e.heldPlayer = null;
            e.viperState = 'following';
            e.tongueActive = false;
        } else if (e.type === 'behemoth') {
            e.nydusEmerging = false;
            if (
                e.behemothState === 'erupting' ||
                e.behemothState === 'burrowing' ||
                e.behemothState === 'cleave_windup' ||
                e.behemothState === 'charge_windup' ||
                e.behemothState === 'tongue_windup' ||
                e.behemothState === 'subterranean_travel'
            ) {
                e.behemothState = 'normal';
                e.burrowed = false;
            }
        } else if (e.type === 'marauder') {
            e.aiming = false;
        } else if (e.type === 'medivac') {
            e.healTargets = [];
        } else if (e.type === 'stalker') {
            e.blinkFlashUntil = 0;
        }
        return;
    }

    if (e.type === 'baneling') {
        e.burrowed = vs === 1;
    } else if (e.type === 'hellion') {
        if (vs === 2) {
            e.aiming = true;
            e.aimAngle = uint8ToAngle(vp);
            e.flameBeamUntil = 0;
        } else if (vs === 3) {
            e.aiming = false;
            e.flameBeamUntil = nowTime + vp;
            const reach = 180;
            e.flameLine = {
                x1: e.x,
                y1: e.y,
                x2: e.x + Math.cos(e.facingAngle) * reach,
                y2: e.y + Math.sin(e.facingAngle) * reach,
            };
        }
    } else if (e.type === 'viper') {
        if (vs === 4) {
            e.viperState = 'stopped_attracting';
            e.tongueAimAngle = uint8ToAngle(vp);
            e.aimAngle = e.tongueAimAngle;
            const warnMult =
                typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty
                    ? GAME_STATE.difficulty.difficultyMultiplier || 1.0
                    : 1.0;
            const dur = Math.round(600 * warnMult);
            e.warnDuration = dur;
            e.shootTongueAt = nowTime + dur;
            if (e.heldPlayer && e.heldPlayer.viperGrabber === e) {
                e.heldPlayer.viperGrabber = null;
            }
            e.heldPlayer = null;
            e.tongueActive = false;
        } else if (vs === 5) {
            e.viperState = 'tongue_firing';
            e.tongueActive = true;
            const a = uint8ToAngle(vp);
            e.tongueTipX = e.x + Math.cos(a) * 120;
            e.tongueTipY = e.y + Math.sin(a) * 120;
            e.tongueHeadX = e.tongueTipX;
            e.tongueHeadY = e.tongueTipY;
        } else if (vs === 6) {
            e.viperState = 'holding';
            const p =
                typeof GAME_STATE !== 'undefined' && GAME_STATE.players
                    ? GAME_STATE.players[vp & 3]
                    : null;
            if (p) {
                e.heldPlayer = p;
                p.viperGrabber = e;
            }
        }
    } else if (e.type === 'behemoth') {
        if (vs === 7) {
            e.nydusEmerging = true;
            e.nydusDuration = 2200;
            e.nydusStartTime = nowTime - (vp / 255) * 2200;
            e.behemothState = 'nydusEmerging';
        } else if (vs === 8) {
            e.nydusEmerging = false;
            e.behemothState = 'erupting';
            e.eruptDuration = 2200;
            e.eruptStartTime = nowTime - (vp / 255) * 2200;
        } else if (vs === 9) {
            e.nydusEmerging = false;
            e.behemothState = 'burrowing';
            e.stateTimer = nowTime + vp;
        } else if (vs === 10) {
            e.nydusEmerging = false;
            e.behemothState = 'cleave_windup';
            e.cleaveAngle = uint8ToAngle(vp);
            const warnMult =
                typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty
                    ? GAME_STATE.difficulty.difficultyMultiplier || 1.0
                    : 1.0;
            const dur = Math.round(650 * warnMult);
            e.cleaveWindupDuration = dur;
            e.stateTimer = nowTime + dur;
        } else if (vs === 15) {
            e.nydusEmerging = false;
            e.behemothState = 'charge_windup';
            e.chargeAngle = uint8ToAngle(vp);
            const warnMult =
                typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty
                    ? GAME_STATE.difficulty.difficultyMultiplier || 1.0
                    : 1.0;
            const dur = Math.round(300 * Math.pow(warnMult, 2));
            e.chargeWindupDuration = dur;
            e.stateTimer = nowTime + dur;
        } else if (vs === 16) {
            e.nydusEmerging = false;
            e.behemothState = 'tongue_windup';
            e.facingAngle = uint8ToAngle(vp);
            const warnMult =
                typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty
                    ? GAME_STATE.difficulty.difficultyMultiplier || 1.0
                    : 1.0;
            const dur = Math.round(500 * warnMult);
            e.tongueWindupDuration = dur;
            e.stateTimer = nowTime + dur;
        } else if (vs === 13) {
            e.nydusEmerging = false;
            e.burrowed = true;
            e.behemothState = 'subterranean_travel';
            if (!e.burrowTrail) {
                e.burrowTrail = [{ x: e.x, y: e.y }];
            } else {
                const last = e.burrowTrail[e.burrowTrail.length - 1];
                if (!last || Math.hypot(e.x - last.x, e.y - last.y) > 20) {
                    e.burrowTrail.push({ x: e.x, y: e.y });
                    if (e.burrowTrail.length > 25) e.burrowTrail.shift();
                }
            }
        }
    } else if (e.type === 'marauder') {
        if (vs === 14) {
            e.aiming = true;
            e.aimAngle = uint8ToAngle(vp);
            const warnMult =
                typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty
                    ? GAME_STATE.difficulty.difficultyMultiplier || 1.0
                    : 1.0;
            const dur = Math.round(650 * warnMult);
            e.aimDuration = dur;
            e.aimUntil = nowTime + dur;
        }
    } else if (e.type === 'medivac') {
        if (vs === 11) {
            const target = clientEnemyCache.get(vp);
            if (target) {
                if (target.hp >= target.maxHp) {
                    target.hp = Math.max(1, target.maxHp - 1);
                }
                e.healTargets = [target];
            } else {
                e.healTargets = [];
            }
        }
    } else if (e.type === 'stalker') {
        if (vs === 12) {
            e.blinkFlashUntil = nowTime + (vp || 350);
        }
    }
}
window.applyEnemyVisualState = applyEnemyVisualState;

function spawnNetworkCombatVfx(type, x, y, param, playerIndex = 0) {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.particles) return;
    const nowTime =
        typeof gameClock !== 'undefined'
            ? gameClock
            : typeof performance !== 'undefined'
              ? performance.now()
              : Date.now();
    const owner =
        typeof GAME_STATE !== 'undefined' && GAME_STATE.players
            ? GAME_STATE.players[playerIndex] || GAME_STATE.players[0]
            : null;

    switch (type) {
        case 1: // MineExplosion
            if (typeof MineExplosion !== 'undefined') {
                const r = (param || 20) * 4;
                GAME_STATE.particles.push(
                    new MineExplosion(x, y, r, nowTime, owner, true),
                );
            }
            break;
        case 2: // NukeExplosion
            if (typeof NukeExplosion !== 'undefined') {
                const r = (param || 100) * 4;
                GAME_STATE.particles.push(
                    new NukeExplosion(x, y, r, nowTime, true),
                );
            }
            break;
        case 3: // FreezeBlastVisual
            if (typeof FreezeBlastVisual !== 'undefined') {
                const r = (param || 50) * 4;
                GAME_STATE.particles.push(
                    new FreezeBlastVisual(x, y, r, nowTime, true),
                );
            }
            break;
        case 4: // SledgeHitVisual
            if (typeof SledgeHitVisual !== 'undefined') {
                const ang = uint8ToAngle(param);
                const mod = owner ? owner.meleeRangeModifier || 1.0 : 1.0;
                const diffMult =
                    typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty
                        ? GAME_STATE.difficulty.difficultyMultiplier || 1.0
                        : 1.0;
                const radius = 100 * mod * (diffMult / 2 + 0.5);
                GAME_STATE.particles.push(
                    new SledgeHitVisual(
                        x,
                        y,
                        radius,
                        Math.PI / 2,
                        ang,
                        nowTime,
                        owner,
                        true,
                    ),
                );
            }
            break;
        case 5: { // InstantMuzzleFlash
            if (typeof InstantMuzzleFlash !== 'undefined') {
                const ang = uint8ToAngle(param);
                const shotColor = owner ? owner.color : '#00ffff';
                GAME_STATE.particles.push(
                    new InstantMuzzleFlash(
                        x,
                        y,
                        ang,
                        shotColor,
                        nowTime,
                        owner,
                        14,
                        true,
                    ),
                );
            }
            break;
        }
        case 6: { // InstantHitImpact
            if (typeof InstantHitImpact !== 'undefined') {
                const ang = uint8ToAngle(param);
                const impactColor = owner ? owner.color : '#00ffff';
                GAME_STATE.particles.push(
                    new InstantHitImpact(
                        x,
                        y,
                        ang,
                        impactColor,
                        nowTime,
                        owner,
                        14,
                        true,
                    ),
                );
            }
            break;
        }
        case 10: { // OctopusTentacle
            if (typeof GAME_STATE !== 'undefined' && GAME_STATE.enemies) {
                const oct = GAME_STATE.enemies.find(
                    (e) => e && (e.type === 'octopus' || e.type === 'boss'),
                );
                if (oct) {
                    if (!oct.tentacles) oct.tentacles = [];
                    const ang = uint8ToAngle(param);
                    const len = 450;
                    const warnMult =
                        typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty
                            ? GAME_STATE.difficulty.difficultyMultiplier || 1.0
                            : 1.0;
                    const warnDuration = Math.round(500 * warnMult);
                    oct.tentacles.push({
                        state: 'telegraph',
                        dunkSoundPlayed: false,
                        timer: nowTime + warnDuration,
                        warnDuration: warnDuration,
                        angle: ang,
                        length: len,
                        startX: oct.x,
                        startY: oct.y,
                        endX: oct.x + Math.cos(ang) * len,
                        endY: oct.y + Math.sin(ang) * len,
                        dmgApplied: true,
                        lashStartTime: 0,
                    });
                }
            }
            break;
        }
        case 7: { // WarlockDartsLifesteal
            if (owner) {
                if (!owner.projectileLifedrainEnabled) {
                    owner.projectileLifedrainEnabled = true;
                }
                if (typeof owner.triggerLifestealVisual === 'function') {
                    owner.triggerLifestealVisual(x, y, true, param);
                }
            }
            break;
        }
    }
}
window.spawnNetworkCombatVfx = spawnNetworkCombatVfx;

// =========================================================================
// HIGH PERFORMANCE BINARY SNAPSHOT CODEC (ArrayBuffer / DataView)
// Zero-allocation serializer & deserializer for low-bandwidth 60fps streaming
// =========================================================================

const BINARY_MAGIC = 0xbf; // 'Blob Format' identifier
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
    swarm: 1,
    brute: 2,
    mega_brute: 3,
    brute_lord: 4,
    speeder: 5,
    meteor: 6,
    dasher: 7,
    shooter: 8,
    spiky: 9,
    baneling: 10,
    marauder: 11,
    stalker: 12,
    zergling: 13,
    spine_crawler: 14,
    sentry: 15,
    medivac: 16,
    warp_anomaly: 17,
    hellion: 18,
    shield_bearer: 19,
    viper: 20,
    octopus: 21,
    boss: 21,
    felhound: 22,
    behemoth: 23,
};
const ID_TO_ENEMY_TYPE = [
    'swarm',
    'swarm',
    'brute',
    'mega_brute',
    'brute_lord',
    'speeder',
    'meteor',
    'dasher',
    'shooter',
    'spiky',
    'baneling',
    'marauder',
    'stalker',
    'zergling',
    'spine_crawler',
    'sentry',
    'medivac',
    'warp_anomaly',
    'hellion',
    'shield_bearer',
    'viper',
    'octopus',
    'felhound',
    'behemoth',
];

const PROJECTILE_TYPE_TO_ID = {
    missile: 1,
    fire_ring: 2,
    deflector_shield: 3,
    laser: 4,
    flail: 5,
    needle: 6,
    acid: 7,
    bullet: 8,
    rocket: 9,
    sniper: 10,
    magic_missile: 11,
};
const ID_TO_PROJECTILE_TYPE = [
    '',
    'missile',
    'fire_ring',
    'deflector_shield',
    'laser',
    'flail',
    'needle',
    'acid',
    'bullet',
    'rocket',
    'sniper',
    'magic_missile',
];

const HAZARD_TYPE_TO_ID = {
    hazard: 1,
    mine: 2,
    mine_explosion: 3,
    nuke_explosion: 4,
    freeze_explosion: 5,
    sledge_hit: 6,
    muzzle_flash: 7,
    hit_impact: 8,
    burning_surface: 9,
    burning_trail: 10,
    laser_trail: 11,
    ice_trail: 12,
    bile_mortar: 13,
    acid_pool: 14,
    white_hole: 15,
    black_hole: 16,
};
const ID_TO_HAZARD_TYPE = [
    'hazard',
    'hazard',
    'mine',
    'mine_explosion',
    'nuke_explosion',
    'freeze_explosion',
    'sledge_hit',
    'muzzle_flash',
    'hit_impact',
    'burning_surface',
    'burning_trail',
    'laser_trail',
    'ice_trail',
    'bile_mortar',
    'acid_pool',
    'white_hole',
    'black_hole',
];

const WEAPON_TYPE_TO_ID = {
    magic_missile: 1,
    orbiting_flames: 2,
    deflector_shield: 3,
    player_mine: 4,
    player_flail: 5,
    laser_beam: 6,
    burning_trail: 7,
    ice_trail: 8,
    nuke_strike: 9,
    turret: 10,
    freeze_blast: 11,
    sledgehammer: 12,
    acid_flask: 13,
    black_hole: 14,
    white_hole: 15,
    melee_sweep: 16,
};
const ID_TO_WEAPON_TYPE = [
    '',
    'magic_missile',
    'orbiting_flames',
    'deflector_shield',
    'player_mine',
    'player_flail',
    'laser_beam',
    'burning_trail',
    'ice_trail',
    'nuke_strike',
    'turret',
    'freeze_blast',
    'sledgehammer',
    'acid_flask',
    'black_hole',
    'white_hole',
    'melee_sweep',
];

const BOSS_ID_TO_BYTE = {
    octopus: 1,
    horde: 2,
    felhound: 3,
    behemoth: 4,
};
const BYTE_TO_BOSS_ID = ['', 'octopus', 'horde', 'felhound', 'behemoth'];

const STATE_TO_BYTE = {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    START_MENU: 0,
    WEAPON_SELECT: 1,
    GAMEPLAY: 2,
    LEVEL_UP: 3,
    PAUSED: 4,
    GAME_OVER: 5,
    COUNTDOWN: 6,
};
const BYTE_TO_STATE = [
    'START_MENU',
    'WEAPON_SELECT',
    'GAMEPLAY',
    'LEVEL_UP',
    'PAUSED',
    'GAME_OVER',
    'COUNTDOWN',
];

function angleToUint8(a) {
    if (!a) return 0;
    const norm = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round((norm / (Math.PI * 2)) * 255) & 0xff;
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
    return btoa(binary);
}

function base64ToUint8(base64) {
    const binary = atob(base64);
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

    // Header (40 bytes)
    view.setUint8(offset, BINARY_MAGIC);
    offset += 1;
    view.setUint8(offset, BINARY_VERSION);
    offset += 1;

    // Monotonic sequence number & host timestamp for unordered packet filtering
    view.setUint32(offset, ++snapshotSeq, true);
    offset += 4;
    view.setUint32(
        offset,
        Math.round(
            typeof performance !== 'undefined'
                ? performance.now()
                : Date.now(),
        ),
        true,
    );
    offset += 4;

    netGemSyncTick = (netGemSyncTick + 1) % 6;
    const includeGems = netGemSyncTick === 0 || GAME_STATE.activeBoss;

    const curTimeForDead =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const [nid, expiry] of netDeadEnemyMap.entries()) {
        if (curTimeForDead >= expiry) netDeadEnemyMap.delete(nid);
    }
    const deadEnemyIds = Array.from(netDeadEnemyMap.keys()).slice(0, 32);

    let flags = 0;
    if (includeGems) flags |= 1 << 0;
    if (netHitEvents.length > 0) flags |= 1 << 1;
    if (netSoundEvents.length > 0) flags |= 1 << 2;
    if (netVfxEvents.length > 0) flags |= 1 << 3;
    if (netBlobDeforms.length > 0) flags |= 1 << 4;
    if (deadEnemyIds.length > 0) flags |= 1 << 5;
    view.setUint8(offset, flags);
    offset += 1;

    const stateByte =
        typeof GAME_STATE !== 'undefined' &&
        STATE_TO_BYTE[GAME_STATE.current] !== undefined
            ? STATE_TO_BYTE[GAME_STATE.current]
            : 2;
    const diffId =
        typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty
            ? GAME_STATE.difficulty.name === 'Easy'
                ? 1
                : GAME_STATE.difficulty.name === 'Hard'
                  ? 3
                  : 2
            : 2;
    view.setUint8(offset, (stateByte & 0x0f) | ((diffId & 0x0f) << 4));
    offset += 1;

    view.setUint32(
        offset,
        typeof GAME_STATE !== 'undefined' ? GAME_STATE.elapsed || 0 : 0,
        true,
    );
    offset += 4;
    view.setUint16(
        offset,
        typeof GAME_STATE !== 'undefined' ? GAME_STATE.level || 1 : 1,
        true,
    );
    offset += 2;
    view.setUint32(
        offset,
        typeof GAME_STATE !== 'undefined' ? GAME_STATE.xp || 0 : 0,
        true,
    );
    offset += 4;
    view.setUint32(
        offset,
        typeof GAME_STATE !== 'undefined' ? GAME_STATE.nextXp || 100 : 100,
        true,
    );
    offset += 4;
    view.setUint16(
        offset,
        typeof GAME_STATE !== 'undefined' ? GAME_STATE.kills || 0 : 0,
        true,
    );
    offset += 2;
    view.setUint16(offset, typeof W !== 'undefined' ? W : 1562, true);
    offset += 2;
    view.setUint16(offset, typeof H !== 'undefined' ? H : 950, true);
    offset += 2;

    const bossByte =
        typeof GAME_STATE !== 'undefined' && GAME_STATE.activeBoss
            ? BOSS_ID_TO_BYTE[GAME_STATE.activeBoss] || 0
            : 0;
    view.setUint8(offset, bossByte);
    offset += 1;
    view.setUint32(
        offset,
        typeof GAME_STATE !== 'undefined'
            ? GAME_STATE.activeBossStartTime || 0
            : 0,
        true,
    );
    offset += 4;
    view.setUint32(
        offset,
        typeof GAME_STATE !== 'undefined' ? GAME_STATE.hordeStartTime || 0 : 0,
        true,
    );
    offset += 4;

    // 1. Players
    const players =
        typeof GAME_STATE !== 'undefined' && GAME_STATE.players
            ? GAME_STATE.players.filter(Boolean)
            : [];
    view.setUint8(offset, players.length);
    offset += 1;
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const flail = p.weapons
            ? p.weapons.find((w) => w.id === 'player_flail')
            : null;
        const melee = p.weapons
            ? p.weapons.find((w) => w.id === 'melee_sweep')
            : null;

        view.setUint8(offset, p.index !== undefined ? p.index : i);
        offset += 1;
        view.setInt16(offset, Math.round(p.x || 0), true);
        offset += 2;
        view.setInt16(offset, Math.round(p.y || 0), true);
        offset += 2;
        view.setUint16(
            offset,
            Math.min(65535, Math.round((p.hp || 0) * 10)),
            true,
        );
        offset += 2;
        view.setUint16(
            offset,
            Math.min(65535, Math.round(p.maxHp || 100)),
            true,
        );
        offset += 2;
        view.setUint8(offset, angleToUint8(p.facingAngle));
        offset += 1;

        let pFlags = 0;
        if (typeof p.isAlive === 'function' ? p.isAlive() : p.alive) {
            pFlags |= 1 << 0;
        }
        if (p.isMoving) pFlags |= 1 << 1;
        if (p.martyrdomAuraEnabled) pFlags |= 1 << 2;
        if (p.martyrsPresenceEnabled) pFlags |= 1 << 3;
        if (p.disconnected || p.kicked) pFlags |= 1 << 4;
        if (flail) pFlags |= 1 << 5;
        if (p.sledgeHammerAnimation) pFlags |= 1 << 6;
        const upName = p.currentLevelUpgradeName || '';
        if (upName.length > 0) pFlags |= 1 << 7;
        view.setUint8(offset, pFlags);
        offset += 1;

        const weaponId = WEAPON_TYPE_TO_ID[p.selectedWeapon] || 0;
        view.setUint8(offset, weaponId);
        offset += 1;

        const curTime =
            typeof gameClock !== 'undefined'
                ? gameClock
                : typeof performance !== 'undefined'
                  ? performance.now()
                  : 0;
        const cv =
            p.campervanUntil > curTime ? Math.round(p.campervanUntil) : 0;
        view.setUint32(offset, cv, true);
        offset += 4;

        const iv =
            p.invuln > 0
                ? Math.round(p.invuln)
                : p.spawnInvuln > 0
                  ? Math.round(p.spawnInvuln)
                  : 0;
        view.setUint16(offset, Math.min(65535, iv), true);
        offset += 2;

        const mf = melee && melee.lastFire > 0 ? Math.round(melee.lastFire) : 0;
        view.setUint32(offset, mf, true);
        offset += 4;

        const mrm = Math.min(
            255,
            Math.round((p.meleeRangeModifier || 1.0) * 50),
        );
        view.setUint8(offset, mrm);
        offset += 1;

        if (flail) {
            view.setInt16(offset, Math.round(flail.x || 0), true);
            offset += 2;
            view.setInt16(offset, Math.round(flail.y || 0), true);
            offset += 2;
        }
        if (p.sledgeHammerAnimation) {
            view.setUint32(
                offset,
                Math.round(p.sledgeHammerAnimation.startTime || 0),
                true,
            );
            offset += 4;
            view.setUint16(
                offset,
                Math.min(
                    65535,
                    Math.round(p.sledgeHammerAnimation.duration || 0),
                ),
                true,
            );
            offset += 2;
            view.setUint8(offset, angleToUint8(p.sledgeHammerAnimation.angle));
            offset += 1;
        }
        if (upName.length > 0) {
            const upLen = Math.min(64, upName.length);
            view.setUint8(offset, upLen);
            offset += 1;
            for (let j = 0; j < upLen; j++) {
                sharedUint8[offset++] = upName.charCodeAt(j) & 0xff;
            }
        }
    }

    // 2. Enemies
    const aliveEnemies =
        typeof GAME_STATE !== 'undefined' && GAME_STATE.enemies
            ? GAME_STATE.enemies.filter((e) => e.alive && e.hp > 0)
            : [];
    view.setUint16(offset, aliveEnemies.length, true);
    offset += 2;
    const hostClock =
        typeof gameClock !== 'undefined' && gameClock > 0
            ? gameClock
            : typeof GAME_STATE !== 'undefined' &&
                GAME_STATE.elapsed !== undefined
              ? GAME_STATE.elapsed
              : 0;
    for (let i = 0; i < aliveEnemies.length; i++) {
        const e = aliveEnemies[i];
        if (!e._nid) e._nid = ++netEntityCounter;

        view.setUint16(offset, e._nid, true);
        offset += 2;
        const typeId = ENEMY_TYPE_TO_ID[e.type] || 1;
        view.setUint8(offset, typeId);
        offset += 1;
        view.setInt16(offset, Math.round(e.x || 0), true);
        offset += 2;
        view.setInt16(offset, Math.round(e.y || 0), true);
        offset += 2;
        view.setUint16(
            offset,
            Math.min(65535, Math.max(1, Math.round(e.hp || 0))),
            true,
        );
        offset += 2;
        view.setUint16(
            offset,
            Math.min(65535, Math.round(e.maxHp || 100)),
            true,
        );
        offset += 2;
        view.setUint8(offset, angleToUint8(e.facingAngle));
        offset += 1;

        let eFlags = 0;
        if (e.airborne) eFlags |= 1 << 0;
        if (e.r && e.r !== 15) eFlags |= 1 << 1;
        if (e.shieldRadius) eFlags |= 1 << 2;
        if (e.landY || e.landAt) eFlags |= 1 << 3;
        const isFrozen = Boolean(e.frozenUntil && e.frozenUntil > hostClock);
        if (isFrozen) eFlags |= 1 << 4;
        const { vState, vParam } = getEnemyVisualState(e, hostClock);
        if (vState !== 0) eFlags |= 1 << 5;
        view.setUint8(offset, eFlags);
        offset += 1;

        if (eFlags & (1 << 1)) {
            view.setUint8(offset, Math.min(255, Math.round(e.r)));
            offset += 1;
        }
        if (eFlags & (1 << 2)) {
            view.setUint8(offset, Math.min(255, Math.round(e.shieldRadius)));
            offset += 1;
        }
        if (eFlags & (1 << 3)) {
            view.setInt16(offset, Math.round(e.landY || 0), true);
            offset += 2;
            view.setUint32(offset, Math.round(e.landAt || 0), true);
            offset += 4;
        }
        if (eFlags & (1 << 4)) {
            const fz = Math.max(
                0,
                Math.min(65535, Math.round((e.frozenUntil || 0) - hostClock)),
            );
            view.setUint16(offset, fz, true);
            offset += 2;
        }
        if (eFlags & (1 << 5)) {
            view.setUint8(offset, vState);
            offset += 1;
            view.setUint16(offset, vParam, true);
            offset += 2;
        }
    }

    // 3. Projectiles
    const projectiles =
        typeof GAME_STATE !== 'undefined' && GAME_STATE.projectiles
            ? GAME_STATE.projectiles
            : [];
    view.setUint16(offset, projectiles.length, true);
    offset += 2;
    for (let i = 0; i < projectiles.length; i++) {
        const p = projectiles[i];
        const t =
            p instanceof OrbitProjectile
                ? 'fire_ring'
                : p instanceof DeflectorOrbiter
                  ? 'deflector_shield'
                  : p instanceof RocketProjectile || p.isRocket
                    ? 'rocket'
                    : p instanceof SniperProjectile
                      ? 'sniper'
                      : p instanceof MagicMissileProjectile
                        ? p.kind === 'laser'
                            ? 'laser'
                            : 'magic_missile'
                        : p.type || 'missile';
        const typeId = PROJECTILE_TYPE_TO_ID[t] || 1;
        view.setUint8(offset, typeId);
        offset += 1;
        view.setInt16(offset, Math.round(p.x || 0), true);
        offset += 2;
        view.setInt16(offset, Math.round(p.y || 0), true);
        offset += 2;
        view.setUint8(offset, Math.min(255, Math.round(p.r || 3)));
        offset += 1;
        view.setUint8(offset, angleToUint8(p.angle));
        offset += 1;

        let pFlags = 0;
        if (
            p instanceof OrbitProjectile &&
            p.player &&
            p.player.mineRingEnabled
        )
            pFlags |= 1 << 0;
        if (
            p instanceof DeflectorOrbiter &&
            (p.growth === undefined || p.growth > 0.05)
        )
            pFlags |= 1 << 0;
        if (p.targetX !== undefined || p.targetY !== undefined)
            pFlags |= 1 << 1;
        if (p.startX !== undefined || p.startY !== undefined) pFlags |= 1 << 2;
        const pIndex =
            p.player && p.player.index !== undefined ? p.player.index & 3 : 0;
        pFlags |= pIndex << 3;
        view.setUint8(offset, pFlags);
        offset += 1;

        if (pFlags & (1 << 1)) {
            view.setInt16(offset, Math.round(p.targetX || 0), true);
            offset += 2;
            view.setInt16(offset, Math.round(p.targetY || 0), true);
            offset += 2;
        }
        if (pFlags & (1 << 2)) {
            view.setInt16(offset, Math.round(p.startX || 0), true);
            offset += 2;
            view.setInt16(offset, Math.round(p.startY || 0), true);
            offset += 2;
        }
    }

    // 4. Enemy Projectiles
    const enemyProjectiles =
        typeof GAME_STATE !== 'undefined' && GAME_STATE.enemyProjectiles
            ? GAME_STATE.enemyProjectiles
            : [];
    view.setUint16(offset, enemyProjectiles.length, true);
    offset += 2;
    for (let i = 0; i < enemyProjectiles.length; i++) {
        const ep = enemyProjectiles[i];
        if (!ep._nid) ep._nid = ++netEntityCounter;
        view.setUint16(offset, ep._nid, true);
        offset += 2;
        view.setInt16(offset, Math.round(ep.x || 0), true);
        offset += 2;
        view.setInt16(offset, Math.round(ep.y || 0), true);
        offset += 2;
        view.setUint8(offset, Math.min(255, Math.round(ep.r || 4)));
        offset += 1;
        view.setUint8(offset, angleToUint8(ep.angle));
        offset += 1;
    }

    // 5. Gems (if flag bit 0)
    if (includeGems) {
        const gems =
            typeof GAME_STATE !== 'undefined' && GAME_STATE.gems
                ? GAME_STATE.gems
                : [];
        view.setUint16(offset, gems.length, true);
        offset += 2;
        for (let i = 0; i < gems.length; i++) {
            const g = gems[i];
            if (!g._nid) g._nid = ++netEntityCounter;
            view.setUint16(offset, g._nid, true);
            offset += 2;
            view.setInt16(offset, Math.round(g.x || 0), true);
            offset += 2;
            view.setInt16(offset, Math.round(g.y || 0), true);
            offset += 2;
            view.setUint8(offset, Math.min(255, Math.round(g.value || 5)));
            offset += 1;

            let spType = 0;
            if (g instanceof HealthPack) spType = 1;
            else if (g instanceof SupplyDrop) spType = (g.type || 1) + 1;
            if (g.attracted) spType |= 1 << 7;
            view.setUint8(offset, spType);
            offset += 1;
        }
    }

    // 6. Turrets
    const turrets =
        typeof GAME_STATE !== 'undefined' && GAME_STATE.turrets
            ? GAME_STATE.turrets
            : [];
    for (let i = 0; i < turrets.length; i++) {
        if (!turrets[i]._nid) turrets[i]._nid = ++netEntityCounter;
    }
    view.setUint8(offset, turrets.length);
    offset += 1;
    for (let i = 0; i < turrets.length; i++) {
        const t = turrets[i];
        view.setUint16(offset, t._nid, true);
        offset += 2;
        view.setInt16(offset, Math.round(t.x || 0), true);
        offset += 2;
        view.setInt16(offset, Math.round(t.y || 0), true);
        offset += 2;
        view.setUint8(offset, angleToUint8(t.angle));
        offset += 1;
        view.setUint8(offset, angleToUint8(t.flameAngle));
        offset += 1;
        view.setUint16(offset, Math.min(65535, Math.round(t.hp || 0)), true);
        offset += 2;
        view.setUint16(
            offset,
            Math.min(65535, Math.round(t.maxHp || 100)),
            true,
        );
        offset += 2;
        view.setUint8(
            offset,
            t.player && t.player.index !== undefined
                ? t.player.index
                : t.playerIndex || 0,
        );
        offset += 1;
        view.setUint32(offset, Math.round(t.spawnTime || 0), true);
        offset += 4;

        let tFlags = 0;
        if (t.isFlamethrower) tFlags |= 1 << 0;
        if (t.flameActiveUntil) tFlags |= 1 << 1;
        if (t.laserWallsEnabled || t.player?.laserWallsEnabled)
            tFlags |= 1 << 2;
        if (t.slowWallsEnabled || t.player?.slowWallsEnabled)
            tFlags |= 1 << 3;
        if (t.turretSawEnabled || t.player?.turretSawEnabled)
            tFlags |= 1 << 6;

        const validConns = (t.connections || []).filter(
            (c) => c?.alive && c._nid,
        );
        const connCount = Math.min(2, validConns.length);
        tFlags |= (connCount & 3) << 4;

        view.setUint8(offset, tFlags);
        offset += 1;

        if (tFlags & (1 << 1)) {
            view.setUint32(offset, Math.round(t.flameActiveUntil || 0), true);
            offset += 4;
            view.setUint8(offset, angleToUint8(t.flameCenterAngle));
            offset += 1;
        }

        for (let cIdx = 0; cIdx < connCount; cIdx++) {
            view.setUint16(offset, validConns[cIdx]._nid, true);
            offset += 2;
        }
    }

    // 7. Hazards (excluding transient CombatVFX which stream via 1-shot netVfxEvents)
    const allHazards =
        typeof GAME_STATE !== 'undefined' && GAME_STATE.hazards
            ? GAME_STATE.hazards
            : [];
    const hazards = allHazards.filter(
        (h) => !(typeof CombatVFX !== 'undefined' && h instanceof CombatVFX),
    );
    view.setUint16(offset, hazards.length, true);
    offset += 2;
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

        view.setUint16(offset, h._nid, true);
        offset += 2;
        const typeId = HAZARD_TYPE_TO_ID[type] || 1;
        view.setUint8(offset, typeId);
        offset += 1;

        const hx = Math.round(h.x !== undefined ? h.x : h.x1 || 0);
        const hy = Math.round(h.y !== undefined ? h.y : h.y1 || 0);
        view.setInt16(offset, hx, true);
        offset += 2;
        view.setInt16(offset, hy, true);
        offset += 2;
        view.setUint8(offset, Math.min(255, Math.round(h.r || h.radius || 15)));
        offset += 1;
        view.setUint8(offset, angleToUint8(h.angle || h.facingAngle || 0));
        offset += 1;
        view.setUint8(
            offset,
            h.player && h.player.index !== undefined ? h.player.index : 0,
        );
        offset += 1;
        view.setUint32(offset, Math.round(h.spawnTime || 0), true);
        offset += 4;

        const hasX2Y2 = h.x2 !== undefined || h.targetX !== undefined;
        let hFlags = 0;
        if (hasX2Y2) hFlags |= 1 << 0;
        if (h.coneAngle !== undefined) hFlags |= 1 << 1;
        if (h.duration !== undefined) hFlags |= 1 << 2;
        if (h.landTime !== undefined) hFlags |= 1 << 3;
        if (h.triggeredTime) hFlags |= 1 << 4;
        view.setUint8(offset, hFlags);
        offset += 1;

        if (hFlags & (1 << 0)) {
            const hx2 = Math.round(h.x2 !== undefined ? h.x2 : h.targetX || 0);
            const hy2 = Math.round(h.y2 !== undefined ? h.y2 : h.targetY || 0);
            view.setInt16(offset, hx2, true);
            offset += 2;
            view.setInt16(offset, hy2, true);
            offset += 2;
        }
        if (hFlags & (1 << 1)) {
            view.setUint8(
                offset,
                Math.min(255, Math.round((h.coneAngle || 0) * 50)),
            );
            offset += 1;
        }
        if (hFlags & (1 << 2)) {
            view.setUint16(
                offset,
                Math.min(65535, Math.round(h.duration || 0)),
                true,
            );
            offset += 2;
        }
        if (hFlags & (1 << 3)) {
            view.setUint32(offset, Math.round(h.landTime || 0), true);
            offset += 4;
        }
    }

    // 8. Terrains
    const terrains =
        typeof GAME_STATE !== 'undefined' && GAME_STATE.terrains
            ? GAME_STATE.terrains
            : [];
    view.setUint8(offset, terrains.length);
    offset += 1;
    for (let i = 0; i < terrains.length; i++) {
        const t = terrains[i];
        const isWall = !!(t.isWallObstacle || t.obstacleType === 'wall');
        view.setUint8(offset, isWall ? 1 : 0);
        offset += 1;
        view.setInt16(offset, Math.round(t.x || 0), true);
        offset += 2;
        view.setInt16(offset, Math.round(t.y || 0), true);
        offset += 2;
        if (isWall) {
            view.setUint8(offset, Math.min(255, Math.round(t.halfW || 95)));
            offset += 1;
            view.setUint8(offset, Math.min(255, Math.round(t.halfH || 22)));
            offset += 1;
            view.setUint8(offset, angleToUint8(t.angle || 0));
            offset += 1;
        } else {
            view.setUint8(
                offset,
                Math.min(255, Math.round(t.radius || t.r || 0)),
            );
            offset += 1;
            view.setUint8(offset, angleToUint8(t.facingAngle || 0));
            offset += 1;
        }
    }

    // 9. Hit Events (if flag bit 1)
    if (flags & (1 << 1)) {
        const hitCount = Math.min(netHitEvents.length, 24);
        view.setUint8(offset, hitCount);
        offset += 1;
        for (let i = 0; i < hitCount; i++) {
            const h = netHitEvents[i];
            view.setInt16(offset, h[0], true);
            offset += 2;
            view.setInt16(offset, h[1], true);
            offset += 2;
            view.setUint8(offset, h[2]);
            offset += 1;
        }
        netHitEvents.length = 0;
    }

    // 10. Sound Events (if flag bit 2)
    if (flags & (1 << 2)) {
        const soundCount = Math.min(netSoundEvents.length, 16);
        view.setUint8(offset, soundCount);
        offset += 1;
        for (let i = 0; i < soundCount; i++) {
            view.setUint8(offset, netSoundEvents[i]);
            offset += 1;
        }
        netSoundEvents.length = 0;
    }

    // 11. VFX Events (if flag bit 3)
    if (flags & (1 << 3)) {
        const vfxCount = Math.min(netVfxEvents.length, 32);
        view.setUint8(offset, vfxCount);
        offset += 1;
        for (let i = 0; i < vfxCount; i++) {
            const v = netVfxEvents[i];
            view.setUint8(offset, v[0]);
            offset += 1;
            view.setInt16(offset, v[1], true);
            offset += 2;
            view.setInt16(offset, v[2], true);
            offset += 2;
            view.setUint8(offset, v[3]);
            offset += 1;
        }
        netVfxEvents.length = 0;
    }

    // 12. Blob Deforms (if flag bit 4)
    if (flags & (1 << 4)) {
        const deformCount = Math.min(netBlobDeforms.length, 16);
        view.setUint8(offset, deformCount);
        offset += 1;
        for (let i = 0; i < deformCount; i++) {
            const d = netBlobDeforms[i];
            const header = ((d[0] & 0x0f) << 4) | (d[1] & 0x0f);
            view.setUint8(offset, header);
            offset += 1;
            view.setUint8(offset, d[2]);
            offset += 1;
        }
        netBlobDeforms.length = 0;
    }

    // 13. Dead Enemies (if flag bit 5)
    if (flags & (1 << 5)) {
        const deadCount = Math.min(deadEnemyIds.length, 32);
        view.setUint8(offset, deadCount);
        offset += 1;
        for (let i = 0; i < deadCount; i++) {
            view.setUint16(offset, deadEnemyIds[i], true);
            offset += 2;
        }
    }

    return sharedBinaryBuffer.slice(0, offset);
}

function unpackWorldSnapshotBinary(buffer) {
    if (!buffer) return null;
    try {
        const rawBuf =
            buffer instanceof ArrayBuffer ? buffer : buffer.buffer || buffer;
        const byteOffset =
            buffer.byteOffset !== undefined ? buffer.byteOffset : 0;
        const byteLength =
            buffer.byteLength !== undefined
                ? buffer.byteLength
                : rawBuf
                  ? rawBuf.byteLength
                  : 0;
        if (!rawBuf || byteLength < 41) return null;

        const view = new DataView(rawBuf, byteOffset, byteLength);
        const u8 = new Uint8Array(rawBuf, byteOffset, byteLength);
        let offset = 0;

        const magic = view.getUint8(offset);
        offset += 1;
        if (magic !== BINARY_MAGIC) return null;
        offset += 1; // packet format version

        const seq = view.getUint32(offset, true);
        offset += 4;
        const serverTime = view.getUint32(offset, true);
        offset += 4;

        const flags = view.getUint8(offset);
        offset += 1;
        const hasGems = (flags & (1 << 0)) !== 0;
        const hasHitEvents = (flags & (1 << 1)) !== 0;
        const hasSoundEvents = (flags & (1 << 2)) !== 0;
        const hasVfxEvents = (flags & (1 << 3)) !== 0;
        const hasBlobDeforms = (flags & (1 << 4)) !== 0;
        const hasDeadEnemies = (flags & (1 << 5)) !== 0;

        const rawStateByte = view.getUint8(offset);
        offset += 1;
        const stateByte = rawStateByte & 0x0f;
        const diffId = (rawStateByte >> 4) & 0x0f;
        if (
            typeof DIFFICULTIES !== 'undefined' &&
            typeof GAME_STATE !== 'undefined'
        ) {
            if (diffId === 1 && DIFFICULTIES.easy)
                GAME_STATE.difficulty = DIFFICULTIES.easy;
            else if (diffId === 3 && DIFFICULTIES.hard)
                GAME_STATE.difficulty = DIFFICULTIES.hard;
            else if (diffId === 2 && DIFFICULTIES.normal)
                GAME_STATE.difficulty = DIFFICULTIES.normal;
        }
        const currentGameState =
            typeof STATES !== 'undefined' &&
            BYTE_TO_STATE[stateByte] &&
            STATES[BYTE_TO_STATE[stateByte]] !== undefined
                ? STATES[BYTE_TO_STATE[stateByte]]
                : typeof STATES !== 'undefined'
                  ? STATES.GAMEPLAY
                  : 2;

        const elapsed = view.getUint32(offset, true);
        offset += 4;
        const level = view.getUint16(offset, true);
        offset += 2;
        const xp = view.getUint32(offset, true);
        offset += 4;
        const nextXp = view.getUint32(offset, true);
        offset += 4;
        const kills = view.getUint16(offset, true);
        offset += 2;
        const hostW = view.getUint16(offset, true);
        offset += 2;
        const hostH = view.getUint16(offset, true);
        offset += 2;

        const bossByte = view.getUint8(offset);
        offset += 1;
        const activeBoss = BYTE_TO_BOSS_ID[bossByte] || null;
        const activeBossStartTime = view.getUint32(offset, true);
        offset += 4;
        const hordeStartTime = view.getUint32(offset, true);
        offset += 4;

        // 1. Players
        const playerCount = view.getUint8(offset);
        offset += 1;
        const players = [];
        for (let i = 0; i < playerCount; i++) {
            const idx = view.getUint8(offset);
            offset += 1;
            const x = view.getInt16(offset, true);
            offset += 2;
            const y = view.getInt16(offset, true);
            offset += 2;
            const hp = view.getUint16(offset, true) / 10;
            offset += 2;
            const mhp = view.getUint16(offset, true);
            offset += 2;
            const fa =
                Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
            offset += 1;

            const pFlags = view.getUint8(offset);
            offset += 1;
            const al = pFlags & (1 << 0) ? 1 : 0;
            const mv = pFlags & (1 << 1) ? 1 : 0;
            const ma = pFlags & (1 << 2) ? 1 : 0;
            const mp = pFlags & (1 << 3) ? 1 : 0;
            const dc = pFlags & (1 << 4) ? 1 : 0;
            const hasFlail = (pFlags & (1 << 5)) !== 0;
            const hasSledge = (pFlags & (1 << 6)) !== 0;
            const hasUpName = (pFlags & (1 << 7)) !== 0;

            const weaponIdByte = view.getUint8(offset);
            offset += 1;
            const w = ID_TO_WEAPON_TYPE[weaponIdByte] || '';
            const wl =
                typeof WEAPON_LABELS !== 'undefined' && WEAPON_LABELS[w]
                    ? WEAPON_LABELS[w]
                    : '';

            const cv = view.getUint32(offset, true);
            offset += 4;
            const iv = view.getUint16(offset, true);
            offset += 2;
            const mf = view.getUint32(offset, true);
            offset += 4;
            const mrm = view.getUint8(offset) / 50;
            offset += 1;

            let fx = undefined,
                fy = undefined;
            if (hasFlail) {
                fx = view.getInt16(offset, true);
                offset += 2;
                fy = view.getInt16(offset, true);
                offset += 2;
            }
            let sh = undefined;
            if (hasSledge) {
                const st = view.getUint32(offset, true);
                offset += 4;
                const du = view.getUint16(offset, true);
                offset += 2;
                const a =
                    Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
                offset += 1;
                sh = { st, du, a };
            }
            let up = '';
            if (hasUpName) {
                const upLen = view.getUint8(offset);
                offset += 1;
                for (let j = 0; j < upLen; j++) {
                    up += String.fromCharCode(u8[offset++]);
                }
            }

            players.push({
                i: idx,
                x,
                y,
                hp,
                mhp,
                al,
                fa,
                mv,
                w,
                wl,
                up,
                cv,
                iv,
                ma,
                mp,
                dc,
                fx,
                fy,
                mf,
                mrm,
                sh,
            });
        }

        // 2. Enemies (compact flat tuples: [id, type, x, y, hp, mhp, fa, r, color, state, shieldRadius, airborne, landY, landAt])
        const enemyCount = view.getUint16(offset, true);
        offset += 2;
        const enemies = [];
        for (let i = 0; i < enemyCount; i++) {
            const id = view.getUint16(offset, true);
            offset += 2;
            const typeId = view.getUint8(offset);
            offset += 1;
            const type = ID_TO_ENEMY_TYPE[typeId] || 'swarm';
            const x = view.getInt16(offset, true);
            offset += 2;
            const y = view.getInt16(offset, true);
            offset += 2;
            const hp = view.getUint16(offset, true);
            offset += 2;
            const mhp = view.getUint16(offset, true);
            offset += 2;
            const fa =
                Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
            offset += 1;

            const eFlags = view.getUint8(offset);
            offset += 1;
            const ab = eFlags & (1 << 0) ? 1 : 0;
            let r = 0,
                sr = 0,
                ly = 0,
                la = 0,
                fz = 0,
                vs = 0,
                vp = 0;
            if (eFlags & (1 << 1)) {
                r = view.getUint8(offset);
                offset += 1;
            }
            if (eFlags & (1 << 2)) {
                sr = view.getUint8(offset);
                offset += 1;
            }
            if (eFlags & (1 << 3)) {
                ly = view.getInt16(offset, true);
                offset += 2;
                la = view.getUint32(offset, true);
                offset += 4;
            }
            if (eFlags & (1 << 4)) {
                fz = view.getUint16(offset, true);
                offset += 2;
            }
            if (eFlags & (1 << 5)) {
                vs = view.getUint8(offset);
                offset += 1;
                vp = view.getUint16(offset, true);
                offset += 2;
            }

            enemies.push([
                id,
                type,
                x,
                y,
                hp,
                mhp,
                fa,
                r,
                '',
                '',
                sr,
                ab,
                ly,
                la,
                fz,
                vs,
                vp,
            ]);
        }

        // 3. Projectiles (compact flat tuples)
        const projectileCount = view.getUint16(offset, true);
        offset += 2;
        const projectiles = [];
        for (let i = 0; i < projectileCount; i++) {
            const typeId = view.getUint8(offset);
            offset += 1;
            const t = ID_TO_PROJECTILE_TYPE[typeId] || 'missile';
            const x = view.getInt16(offset, true);
            offset += 2;
            const y = view.getInt16(offset, true);
            offset += 2;
            const r = view.getUint8(offset);
            offset += 1;
            const a =
                Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
            offset += 1;

            const pFlags = view.getUint8(offset);
            offset += 1;
            const mr = pFlags & (1 << 0) ? 1 : 0;
            const hasTarget = (pFlags & (1 << 1)) !== 0;
            const hasStart = (pFlags & (1 << 2)) !== 0;
            const pi = (pFlags >> 3) & 3;

            let tx = 0,
                ty = 0,
                sx = 0,
                sy = 0;
            if (hasTarget) {
                tx = view.getInt16(offset, true);
                offset += 2;
                ty = view.getInt16(offset, true);
                offset += 2;
            }
            if (hasStart) {
                sx = view.getInt16(offset, true);
                offset += 2;
                sy = view.getInt16(offset, true);
                offset += 2;
            }

            const owner =
                typeof GAME_STATE !== 'undefined' && GAME_STATE.players
                    ? GAME_STATE.players[pi]
                    : null;
            const c =
                t === 'fire_ring'
                    ? '#ff6600'
                    : t === 'deflector_shield'
                      ? '#00e5ff'
                      : owner?.color || '#00ffcc';
            projectiles.push([t, x, y, r, c, a, tx, ty, sx, sy, mr, pi]);
        }

        // 4. Enemy Projectiles
        const enemyProjectileCount = view.getUint16(offset, true);
        offset += 2;
        const enemyProjectiles = [];
        for (let i = 0; i < enemyProjectileCount; i++) {
            const id = view.getUint16(offset, true);
            offset += 2;
            const x = view.getInt16(offset, true);
            offset += 2;
            const y = view.getInt16(offset, true);
            offset += 2;
            const r = view.getUint8(offset);
            offset += 1;
            const a =
                Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
            offset += 1;
            enemyProjectiles.push([id, x, y, r, '#ff3344', a]);
        }

        // 5. Gems
        let gems = undefined;
        if (hasGems) {
            const gemCount = view.getUint16(offset, true);
            offset += 2;
            gems = [];
            for (let i = 0; i < gemCount; i++) {
                const id = view.getUint16(offset, true);
                offset += 2;
                const x = view.getInt16(offset, true);
                offset += 2;
                const y = view.getInt16(offset, true);
                offset += 2;
                const v = view.getUint8(offset);
                offset += 1;
                const rawSpType = view.getUint8(offset);
                offset += 1;

                const isAttracted = (rawSpType & (1 << 7)) !== 0;
                const spType = rawSpType & ~(1 << 7);
                const isHp = spType === 1 ? 1 : 0;
                const isSd = spType >= 2 ? spType - 1 : 0;
                gems.push([x, y, v, isHp, isSd, id, isAttracted]);
            }
        }

        // 6. Turrets
        const turretCount = view.getUint8(offset);
        offset += 1;
        const turrets = [];
        for (let i = 0; i < turretCount; i++) {
            const id = view.getUint16(offset, true);
            offset += 2;
            const x = view.getInt16(offset, true);
            offset += 2;
            const y = view.getInt16(offset, true);
            offset += 2;
            const a =
                Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
            offset += 1;
            const fa =
                Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
            offset += 1;
            const hp = view.getUint16(offset, true);
            offset += 2;
            const mhp = view.getUint16(offset, true);
            offset += 2;
            const pi = view.getUint8(offset);
            offset += 1;
            const st = view.getUint32(offset, true);
            offset += 4;

            const tFlags = view.getUint8(offset);
            offset += 1;
            const fl = tFlags & (1 << 0) ? 1 : 0;
            const lw = tFlags & (1 << 2) ? 1 : 0;
            const sw = tFlags & (1 << 3) ? 1 : 0;
            const ts = tFlags & (1 << 6) ? 1 : 0;
            const connCount = (tFlags >> 4) & 3;
            let faU = 0,
                fcA = 0;
            if (tFlags & (1 << 1)) {
                faU = view.getUint32(offset, true);
                offset += 4;
                fcA =
                    Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
                offset += 1;
            }

            const conns = [];
            for (let cIdx = 0; cIdx < connCount; cIdx++) {
                conns.push(view.getUint16(offset, true));
                offset += 2;
            }

            turrets.push({
                id,
                x,
                y,
                a,
                fa,
                hp,
                mhp,
                pi,
                st,
                fl,
                faU,
                fcA,
                lw,
                sw,
                ts,
                conns,
            });
        }

        // 7. Hazards
        const hazardCount = view.getUint16(offset, true);
        offset += 2;
        const hazards = [];
        for (let i = 0; i < hazardCount; i++) {
            const id = view.getUint16(offset, true);
            offset += 2;
            const typeId = view.getUint8(offset);
            offset += 1;
            const t = ID_TO_HAZARD_TYPE[typeId] || 'hazard';
            const x = view.getInt16(offset, true);
            offset += 2;
            const y = view.getInt16(offset, true);
            offset += 2;
            const r = view.getUint8(offset);
            offset += 1;
            const a =
                Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
            offset += 1;
            const pi = view.getUint8(offset);
            offset += 1;
            const st = view.getUint32(offset, true);
            offset += 4;

            const hFlags = view.getUint8(offset);
            offset += 1;
            let x2 = undefined,
                y2 = undefined,
                ca = undefined,
                dur = undefined,
                lt = undefined;
            if (hFlags & (1 << 0)) {
                x2 = view.getInt16(offset, true);
                offset += 2;
                y2 = view.getInt16(offset, true);
                offset += 2;
            }
            if (hFlags & (1 << 1)) {
                ca = view.getUint8(offset) / 50;
                offset += 1;
            }
            if (hFlags & (1 << 2)) {
                dur = view.getUint16(offset, true);
                offset += 2;
            }
            if (hFlags & (1 << 3)) {
                lt = view.getUint32(offset, true);
                offset += 4;
            }
            const tr = hFlags & (1 << 4) ? 1 : 0;

            hazards.push({
                id,
                t,
                x,
                y,
                x2,
                y2,
                r,
                a,
                ca,
                st,
                dur,
                lt,
                tr,
                pi,
            });
        }

        // 8. Terrains
        const terrainCount = view.getUint8(offset);
        offset += 1;
        const terrains = [];
        for (let i = 0; i < terrainCount; i++) {
            const type = view.getUint8(offset);
            offset += 1;
            const x = view.getInt16(offset, true);
            offset += 2;
            const y = view.getInt16(offset, true);
            offset += 2;
            if (type === 1) {
                const hw = view.getUint8(offset);
                offset += 1;
                const hh = view.getUint8(offset);
                offset += 1;
                const ang =
                    Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
                offset += 1;
                terrains.push({ type: 'wall', x, y, hw, hh, ang });
            } else {
                const r = view.getUint8(offset);
                offset += 1;
                const fa =
                    Math.round(uint8ToAngle(view.getUint8(offset)) * 100) / 100;
                offset += 1;
                terrains.push({ type: 'shield', x, y, r, fa });
            }
        }

        let hitEvents = undefined;
        if (hasHitEvents && offset < byteLength) {
            const hitCount = view.getUint8(offset);
            offset += 1;
            hitEvents = [];
            for (let i = 0; i < hitCount; i++) {
                const hx = view.getInt16(offset, true);
                offset += 2;
                const hy = view.getInt16(offset, true);
                offset += 2;
                const hcByte = view.getUint8(offset);
                offset += 1;
                hitEvents.push([hx, hy, byteToColor(hcByte)]);
            }
        }

        let soundEvents = undefined;
        if (hasSoundEvents && offset < byteLength) {
            const soundCount = view.getUint8(offset);
            offset += 1;
            soundEvents = [];
            for (let i = 0; i < soundCount; i++) {
                soundEvents.push(view.getUint8(offset));
                offset += 1;
            }
        }

        let vfxEvents = undefined;
        if (hasVfxEvents && offset < byteLength) {
            const vfxCount = view.getUint8(offset);
            offset += 1;
            vfxEvents = [];
            for (let i = 0; i < vfxCount; i++) {
                const rawType = view.getUint8(offset);
                offset += 1;
                const playerIndex = (rawType >> 4) & 0x03;
                const type = rawType & 0x0f;
                const x = view.getInt16(offset, true);
                offset += 2;
                const y = view.getInt16(offset, true);
                offset += 2;
                const param = view.getUint8(offset);
                offset += 1;
                vfxEvents.push({ type, playerIndex, x, y, param });
            }
        }

        let blobDeforms = undefined;
        if (hasBlobDeforms && offset < byteLength) {
            const deformCount = view.getUint8(offset);
            offset += 1;
            blobDeforms = [];
            for (let i = 0; i < deformCount; i++) {
                const header = view.getUint8(offset);
                offset += 1;
                const angleByte = view.getUint8(offset);
                offset += 1;
                const playerIndex = (header >> 4) & 0x0f;
                const deformType = header & 0x0f;
                blobDeforms.push({
                    playerIndex,
                    deformType,
                    angle: uint8ToAngle(angleByte),
                });
            }
        }

        let deadEnemies = undefined;
        if (hasDeadEnemies && offset < byteLength) {
            const deadCount = view.getUint8(offset);
            offset += 1;
            deadEnemies = [];
            for (let i = 0; i < deadCount; i++) {
                deadEnemies.push(view.getUint16(offset, true));
                offset += 2;
            }
        }

        return {
            seq,
            serverTime,
            players,
            enemies,
            deadEnemies: deadEnemies || [],
            projectiles,
            enemyProjectiles,
            gems,
            turrets,
            hazards,
            terrains,
            hits: hitEvents,
            sounds: soundEvents,
            vfx: vfxEvents,
            blobDeforms: blobDeforms,
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
            currentGameState,
        };
    } catch (err) {
        console.warn('[Net] unpackWorldSnapshotBinary failed:', err);
        return null;
    }
}

function serializeWorldForNetwork() {
    if (typeof packWorldSnapshotBinary === 'function') {
        return packWorldSnapshotBinary();
    }
    return serializeWorldForNetworkJSON();
}

function serializeWorldForNetworkJSON() {
    // 1. Players
    const players = (GAME_STATE.players || [])
        .filter(Boolean)
        .map((p) => {
        const flail = p.weapons
            ? p.weapons.find((w) => w.id === 'player_flail')
            : null;
        const melee = p.weapons
            ? p.weapons.find((w) => w.id === 'melee_sweep')
            : null;
        return {
            i: p.index,
            nm: p.name || '',
            x: Math.round(p.x),
            y: Math.round(p.y),
            hp: Math.round(p.hp * 10) / 10,
            mhp: p.maxHp,
            al:
                (typeof p.isAlive === 'function' ? p.isAlive() : p.alive) &&
                p.hp > 0
                    ? 1
                    : 0,
            da:
                !(typeof p.isAlive === 'function' ? p.isAlive() : p.alive) &&
                p.deadAt
                    ? Math.round(p.deadAt)
                    : 0,
            fa: Math.round(p.facingAngle * 100) / 100,
            mv: p.isMoving ? 1 : 0,
            w: p.selectedWeapon || '',
            wl: p.selectedWeaponLabel || '',
            up: p.currentLevelUpgradeName || '',
            cv:
                p.campervanUntil >
                (typeof gameClock !== 'undefined'
                    ? gameClock
                    : typeof performance !== 'undefined'
                      ? performance.now()
                      : 0)
                    ? Math.round(p.campervanUntil)
                    : 0,
            iv:
                p.invuln > 0
                    ? Math.round(p.invuln)
                    : p.spawnInvuln > 0
                      ? Math.round(p.spawnInvuln)
                      : 0,
            ma: p.martyrdomAuraEnabled ? 1 : 0,
            mp: p.martyrsPresenceEnabled ? 1 : 0,
            dc: p.disconnected || p.kicked ? 1 : 0,
            fx: flail ? Math.round(flail.x) : undefined,
            fy: flail ? Math.round(flail.y) : undefined,
            mf: melee && melee.lastFire > 0 ? Math.round(melee.lastFire) : 0,
            mrm: p.meleeRangeModifier || 1.0,
            sh: p.sledgeHammerAnimation
                ? {
                      st: Math.round(p.sledgeHammerAnimation.startTime),
                      du: Math.round(p.sledgeHammerAnimation.duration),
                      a: Math.round(p.sledgeHammerAnimation.angle * 100) / 100,
                  }
                : undefined,
        };
    });

    // 2. Enemies: compact flat tuples [id, type, x, y, hp, mhp, fa, r, color, state, shieldRadius, airborne, landY, landAt]
    const hostClock =
        typeof gameClock !== 'undefined' && gameClock > 0
            ? gameClock
            : typeof GAME_STATE !== 'undefined' &&
                GAME_STATE.elapsed !== undefined
              ? GAME_STATE.elapsed
              : 0;
    const enemies = GAME_STATE.enemies
        .filter((e) => e.alive && e.hp > 0)
        .map((e) => {
            if (!e._nid) e._nid = ++netEntityCounter;
            const fa = Math.round((e.facingAngle || 0) * 100) / 100;
            const r = e.r || 0;
            const c = e.color || '';
            const st = e.viperState || e.stalkerState || '';
            const sr = e.shieldRadius || 0;
            const ab = e.airborne ? 1 : 0;
            const ly = Math.round(e.landY || 0);
            const la = Math.round(e.landAt || 0);

            const fz = Boolean(e.frozenUntil && e.frozenUntil > hostClock)
                ? Math.max(0, Math.round(e.frozenUntil - hostClock))
                : 0;

            const { vState, vParam } = getEnemyVisualState(e, hostClock);
            const hp = Math.max(1, Math.round(e.hp));
            if (
                !r &&
                !c &&
                !st &&
                !sr &&
                !ab &&
                !ly &&
                !la &&
                !fz &&
                !vState
            ) {
                return [
                    e._nid,
                    e.type,
                    Math.round(e.x),
                    Math.round(e.y),
                    hp,
                    e.maxHp,
                    fa,
                ];
            }
            return [
                e._nid,
                e.type,
                Math.round(e.x),
                Math.round(e.y),
                hp,
                e.maxHp,
                fa,
                r,
                c,
                st,
                sr,
                ab,
                ly,
                la,
                fz,
                vState,
                vParam,
            ];
        });

    // 3. Projectiles: compact flat tuples [id, type, x, y, r, color, angle, tx, ty, sx, sy, mr, pi]
    const projectiles = GAME_STATE.projectiles.map((p) => {
        if (!p._nid) p._nid = ++netEntityCounter;
        const t =
            p instanceof OrbitProjectile
                ? 'fire_ring'
                : p instanceof DeflectorOrbiter
                  ? 'deflector_shield'
                  : p instanceof RocketProjectile || p.isRocket
                    ? 'rocket'
                    : p instanceof SniperProjectile
                      ? 'sniper'
                      : p instanceof MagicMissileProjectile
                        ? p.kind === 'laser'
                            ? 'laser'
                            : 'magic_missile'
                        : p.type || '';
        const owner =
            p.player ||
            (typeof GAME_STATE !== 'undefined' && GAME_STATE.players
                ? GAME_STATE.players[p.player?.index ?? 0]
                : null);
        const c =
            p instanceof OrbitProjectile
                ? '#ff6600'
                : p instanceof DeflectorOrbiter
                  ? '#00e5ff'
                  : owner?.color || p.color || '#00ffcc';
        const r = p.r || (p instanceof OrbitProjectile ? 10 : 3);
        const a = Math.round((p.angle || 0) * 100) / 100;
        const tx = p.targetX !== undefined ? Math.round(p.targetX) : 0;
        const ty = p.targetY !== undefined ? Math.round(p.targetY) : 0;
        const sx = p.startX !== undefined ? Math.round(p.startX) : 0;
        const sy = p.startY !== undefined ? Math.round(p.startY) : 0;
        const mr =
            p instanceof OrbitProjectile && p.player && p.player.mineRingEnabled
                ? 1
                : p instanceof DeflectorOrbiter &&
                    (p.growth === undefined || p.growth > 0.05)
                  ? 1
                  : 0;
        const pi =
            p.player && p.player.index !== undefined ? p.player.index : 0;

        if (!tx && !ty && !sx && !sy && !mr && !pi) {
            return [p._nid, t, Math.round(p.x), Math.round(p.y), r, c, a];
        }
        return [
            p._nid,
            t,
            Math.round(p.x),
            Math.round(p.y),
            r,
            c,
            a,
            tx,
            ty,
            sx,
            sy,
            mr,
            pi,
        ];
    });

    // 4. Enemy Projectiles: compact flat tuples [id, x, y, r, color, angle]
    const enemyProjectiles = GAME_STATE.enemyProjectiles.map((ep) => {
        if (!ep._nid) ep._nid = ++netEntityCounter;
        return [
            ep._nid,
            Math.round(ep.x),
            Math.round(ep.y),
            ep.r || 4,
            ep.color || '#ff3344',
            Math.round((ep.angle || 0) * 100) / 100,
        ];
    });

    // 5. Gems, Health Packs & Supply Drops (sync every 6 network ticks to save 80%+ bandwidth on static gems)
    let gems = undefined;
    netGemSyncTick = (netGemSyncTick + 1) % 6;
    if (netGemSyncTick === 0 || GAME_STATE.activeBoss) {
        gems = GAME_STATE.gems.map((g) => {
            if (!g._nid) g._nid = ++netEntityCounter;
            const isHp = g instanceof HealthPack ? 1 : 0;
            const isSd = g instanceof SupplyDrop ? g.type : 0;
            return [
                Math.round(g.x),
                Math.round(g.y),
                g.value || 5,
                isHp,
                isSd,
                g._nid,
                g.attracted ? 1 : 0,
            ];
        });
    }

    // 6. Turrets
    const turrets = GAME_STATE.turrets.map((t) => {
        if (!t._nid) t._nid = ++netEntityCounter;
        return {
            id: t._nid,
            x: Math.round(t.x),
            y: Math.round(t.y),
            a: Math.round((t.angle || 0) * 100) / 100,
            fa: Math.round((t.flameAngle || 0) * 100) / 100,
            hp: Math.round(t.hp),
            mhp: t.maxHp,
            pi:
                t.player && t.player.index !== undefined
                    ? t.player.index
                    : t.playerIndex || 0,
            st: t.spawnTime || 0,
            fl: t.isFlamethrower ? 1 : 0,
            lw: t.laserWallsEnabled || t.player?.laserWallsEnabled ? 1 : 0,
            sw: t.slowWallsEnabled || t.player?.slowWallsEnabled ? 1 : 0,
            ts: t.turretSawEnabled || t.player?.turretSawEnabled ? 1 : 0,
            faU: t.flameActiveUntil ? Math.round(t.flameActiveUntil) : 0,
            fcA: t.flameCenterAngle
                ? Math.round(t.flameCenterAngle * 100) / 100
                : 0,
            conns: (t.connections || [])
                .filter((c) => c?.alive && c._nid)
                .map((c) => c._nid),
        };
    });

    // 7. Hazards, Mines & Visual Explosion FX (excluding transient CombatVFX sent via 1-shot vfx)
    const hazards = GAME_STATE.hazards
        .filter(
            (h) => !(typeof CombatVFX !== 'undefined' && h instanceof CombatVFX),
        )
        .map((h) => {
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
            x: Math.round(h.x !== undefined ? h.x : h.x1 || 0),
            y: Math.round(h.y !== undefined ? h.y : h.y1 || 0),
            x2:
                h.x2 !== undefined
                    ? Math.round(h.x2)
                    : h.targetX !== undefined
                      ? Math.round(h.targetX)
                      : undefined,
            y2:
                h.y2 !== undefined
                    ? Math.round(h.y2)
                    : h.targetY !== undefined
                      ? Math.round(h.targetY)
                      : undefined,
            r: Math.round(h.r || h.radius || 15),
            a: Math.round((h.angle || h.facingAngle || 0) * 100) / 100,
            ca:
                h.coneAngle !== undefined
                    ? Math.round(h.coneAngle * 100) / 100
                    : undefined,
            c: h.color || undefined,
            st: h.spawnTime || 0,
            dur: h.duration || undefined,
            lt: h.landTime || undefined,
            tr: h.triggeredTime ? 1 : 0,
            pi: h.player && h.player.index !== undefined ? h.player.index : 0,
        };
    });

    const terrains = (GAME_STATE.terrains || []).map((t) => {
        const isWall = !!(t.isWallObstacle || t.obstacleType === 'wall');
        if (isWall) {
            return {
                type: 'wall',
                x: Math.round(t.x || 0),
                y: Math.round(t.y || 0),
                hw: Math.round(t.halfW || 95),
                hh: Math.round(t.halfH || 22),
                ang: Math.round((t.angle || 0) * 100) / 100,
            };
        }
        return {
            type: 'shield',
            x: Math.round(t.x || 0),
            y: Math.round(t.y || 0),
            r: Math.round(t.radius || t.r || 0),
            fa: Math.round((t.facingAngle || 0) * 100) / 100,
        };
    });

    const hits =
        netHitEvents.length > 0
            ? netHitEvents
                  .slice(0, 24)
                  .map((h) => [h[0], h[1], byteToColor(h[2])])
            : undefined;
    netHitEvents.length = 0;

    const sounds =
        netSoundEvents.length > 0 ? netSoundEvents.slice(0, 16) : undefined;
    netSoundEvents.length = 0;

    const vfx =
        netVfxEvents.length > 0
            ? netVfxEvents.slice(0, 32).map((v) => ({
                  type: v[0] & 0x0f,
                  playerIndex: (v[0] >> 4) & 0x03,
                  x: v[1],
                  y: v[2],
                  param: v[3],
              }))
            : undefined;
    netVfxEvents.length = 0;

    const blobDeforms =
        netBlobDeforms.length > 0
            ? netBlobDeforms.slice(0, 16).map((d) => ({
                  playerIndex: d[0],
                  deformType: d[1],
                  angle: uint8ToAngle(d[2]),
              }))
            : undefined;
    netBlobDeforms.length = 0;

    const curTimeForDead =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const [nid, expiry] of netDeadEnemyMap.entries()) {
        if (curTimeForDead >= expiry) netDeadEnemyMap.delete(nid);
    }
    const deadEnemies = Array.from(netDeadEnemyMap.keys()).slice(0, 32);

    return {
        serverTime:
            typeof performance !== 'undefined' ? performance.now() : Date.now(),
        seq: ++snapshotSeq,
        players,
        enemies,
        deadEnemies,
        projectiles,
        enemyProjectiles,
        gems,
        turrets,
        hazards,
        terrains,
        hits,
        sounds,
        vfx,
        blobDeforms,
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
        currentGameState: GAME_STATE.current,
        difficulty:
            typeof GAME_STATE !== 'undefined' && GAME_STATE.difficulty
                ? GAME_STATE.difficulty.name.toLowerCase()
                : 'normal',
    };
}

const NetworkProjectileProto = {
    alive: true,
    draw(now) {
        if (!ctx) return;
        ctx.save();
        if (this.type === 'fire_ring') {
            const owner = GAME_STATE.players[this.playerIndex];
            if (
                this.mineRing &&
                owner &&
                typeof drawBioMineVesicle === 'function'
            ) {
                drawBioMineVesicle(
                    ctx,
                    this.x,
                    this.y,
                    this.r,
                    now,
                    owner,
                    false,
                    0,
                    false,
                );
            } else {
                ctx.fillStyle = '#ff6600';
                ctx.shadowColor = owner ? owner.color : '#ff9900';
                ctx.shadowBlur = 15;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (this.type === 'deflector_shield') {
            const owner =
                this.owner ||
                (typeof GAME_STATE !== 'undefined' && GAME_STATE.players
                    ? GAME_STATE.players[this.playerIndex]
                    : null);
            const curNow =
                typeof now === 'number'
                    ? now
                    : typeof gameClock !== 'undefined'
                      ? gameClock
                      : performance.now();
            if (typeof drawDeflectorOrbiterPlate === 'function') {
                const growth = this.mineRing === 0 ? 0.0 : 1.0;
                drawDeflectorOrbiterPlate(
                    ctx,
                    this.x,
                    this.y,
                    this.angle || 0,
                    owner,
                    growth,
                    curNow,
                    false,
                );
            } else {
                ctx.fillStyle = owner ? owner.color : '#00e5ff';
                ctx.shadowColor = owner ? owner.color : '#00e5ff';
                ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (this.type === 'rocket') {
            const owner = GAME_STATE.players[this.playerIndex];
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle || 0);
            ctx.scale(2.2, 2.2);

            ctx.fillStyle = '#cfd8dc';
            ctx.strokeStyle = '#37474f';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.rect(-10, -3, 14, 6);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = owner ? owner.color : this.color || '#ff3333';
            ctx.beginPath();
            ctx.moveTo(4, -3);
            ctx.lineTo(10, 0);
            ctx.lineTo(4, 3);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else if (this.type === 'sniper' || this.type === 'laser') {
            const owner = GAME_STATE.players[this.playerIndex];
            const length = this.type === 'sniper' ? 120 : 20;
            const a = this.angle || 0;
            const x1 = this.x - Math.cos(a) * length;
            const y1 = this.y - Math.sin(a) * length;

            ctx.strokeStyle = owner ? owner.color : this.color || '#00ffff';
            ctx.lineWidth = this.type === 'sniper' ? 3 : 1.8;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(this.x, this.y);
            ctx.stroke();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = this.type === 'sniper' ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(this.x, this.y);
            ctx.stroke();

            if (this.type === 'sniper') {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(this.x, this.y, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (this.type === 'magic_missile' || this.type === 'missile') {
            const owner =
                this.owner ||
                GAME_STATE.players?.[this.playerIndex] ||
                GAME_STATE.players?.[0];
            if (typeof drawMagicMissileVisual === 'function') {
                drawMagicMissileVisual(
                    ctx,
                    this.x,
                    this.y,
                    this.angle || 0,
                    this.r,
                    owner,
                    now,
                    this.spawnTime,
                );
            } else {
                ctx.fillStyle = owner ? owner.color : this.color || '#00ffcc';
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            const owner =
                this.owner || GAME_STATE.players?.[this.playerIndex];
            ctx.fillStyle = owner ? owner.color : this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    },
};

const NetworkEnemyProjectileProto = {
    alive: true,
    draw() {
        if (!ctx) return;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle || 0);

        if (this.r === 6) {
            // Shooter enemy bio-bolt
            const baseColor =
                this.color && this.color !== '#ff3344'
                    ? this.color
                    : '#661144';
            const bodyColor =
                typeof brightenColor === 'function'
                    ? brightenColor(baseColor, 1.8)
                    : '#bb44ff';
            const glowColor =
                typeof brightenColor === 'function'
                    ? brightenColor(baseColor, 2.2)
                    : '#cc66ff';

            // Outer glowing oval
            ctx.fillStyle = glowColor;
            ctx.globalAlpha = 0.35;
            ctx.beginPath();
            ctx.ellipse(
                0,
                0,
                (this.r + 3) * 1.5,
                (this.r + 2) * 0.8,
                0,
                0,
                Math.PI * 2,
            );
            ctx.fill();

            // Core oval
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = bodyColor;
            ctx.beginPath();
            ctx.ellipse(0, 0, this.r * 1.5, this.r * 0.8, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#1a0033'; // Dark outline around projectile
            ctx.lineWidth = 1.5;
            ctx.stroke();
        } else if (this.r === 4) {
            // Spiky enemy red arrowhead
            ctx.fillStyle = '#ff1100';
            ctx.strokeStyle = '#110000';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(12, 0);
            ctx.lineTo(-6, -4);
            ctx.lineTo(-3, 0);
            ctx.lineTo(-6, 4);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else if (this.r === 7) {
            // Marauder concussive missile
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = '#78909c';
            ctx.beginPath();
            ctx.arc(0, 0, this.r + 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 1.0;
            ctx.fillStyle = '#546e7a';
            ctx.beginPath();
            ctx.ellipse(0, 0, this.r + 2, this.r - 1, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#263238';
            ctx.beginPath();
            ctx.ellipse(this.r + 1, 0, 4, this.r - 2, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#eceff1';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-this.r + 2, -2);
            ctx.lineTo(this.r - 2, -2);
            ctx.stroke();
        } else {
            ctx.fillStyle = this.color || '#ff3344';
            ctx.beginPath();
            ctx.arc(0, 0, this.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    },
};

window.onWorldSnapshotReceived = (snapshot) => {
    if (!snapshot) return;

    // Discard stale or duplicate snapshots received out of order over unreliable channel
    if (typeof snapshot.seq === 'number' && snapshot.seq > 0) {
        if (lastReceivedSnapshotSeq > 0) {
            const diff = (snapshot.seq - lastReceivedSnapshotSeq) | 0;
            if (diff <= 0 && diff > -1000000) {
                return; // Stale snapshot arrived late -> discard
            }
        }
        lastReceivedSnapshotSeq = snapshot.seq;
    }

    const nowTime =
        typeof gameClock !== 'undefined'
            ? gameClock
            : snapshot.elapsed !== undefined
              ? snapshot.elapsed
              : typeof performance !== 'undefined'
                ? performance.now()
                : Date.now();
    const arrivalTime =
        typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Buffer incoming snapshot with arrival timestamp for smooth 60fps interpolation
    clientSnapshotBuffer.push({
        clientTime: arrivalTime,
        serverTime: snapshot.serverTime || arrivalTime,
        snapshot: snapshot,
    });
    if (clientSnapshotBuffer.length > 6) {
        clientSnapshotBuffer.shift();
    }

    if (
        snapshot.hostW !== undefined &&
        (GAME_STATE.hostW !== snapshot.hostW || W !== snapshot.hostW)
    ) {
        GAME_STATE.hostW = snapshot.hostW;
        if (typeof resizeCanvas === 'function') resizeCanvas();
    }
    if (
        snapshot.hostH !== undefined &&
        (GAME_STATE.hostH !== snapshot.hostH || H !== snapshot.hostH)
    ) {
        GAME_STATE.hostH = snapshot.hostH;
        if (typeof resizeCanvas === 'function') resizeCanvas();
    }

    // 0. Trigger hit particle visual signals computed locally on client device
    if (snapshot.hits && Array.isArray(snapshot.hits)) {
        for (let i = 0; i < snapshot.hits.length; i++) {
            const h = snapshot.hits[i];
            spawnHitParticles(h[0], h[1], h[2] || '#ffffff', 2);
        }
    }

    // 0.1 Trigger audio events sent from host
    if (snapshot.sounds && Array.isArray(snapshot.sounds)) {
        for (let i = 0; i < snapshot.sounds.length; i++) {
            playNetworkSound(snapshot.sounds[i]);
        }
    }

    // 0.2 Trigger combat VFX sent from host (explosions, flashes, novas)
    if (snapshot.vfx && Array.isArray(snapshot.vfx)) {
        for (let i = 0; i < snapshot.vfx.length; i++) {
            const v = snapshot.vfx[i];
            spawnNetworkCombatVfx(v.type, v.x, v.y, v.param, v.playerIndex);
        }
    }

    // 0.3 Trigger organic blob deformations sent from host
    if (snapshot.blobDeforms && Array.isArray(snapshot.blobDeforms)) {
        for (let i = 0; i < snapshot.blobDeforms.length; i++) {
            const d = snapshot.blobDeforms[i];
            applyNetworkBlobDeform(d.playerIndex, d.deformType, d.angle);
        }
    }

    // 1. Reconcile Players
    if (snapshot.players) {
        for (const sp of snapshot.players) {
            let p = GAME_STATE.players[sp.i];
            if (!p) {
                p = new Player(
                    sp.i,
                    PLAYER_DEFS[sp.i] || {
                        keysText: 'WASD',
                        color: '#00ffcc',
                        ring: 'rgba(0,255,204,0.3)',
                        keys: {},
                    },
                );
                GAME_STATE.players[sp.i] = p;
            }
            const wasAlive =
                typeof p.isAlive === 'function' ? p.isAlive() : p.alive;
            p.hp = sp.hp;
            p.maxHp = sp.mhp;
            const nowAlive = sp.al === 1 && sp.hp > 0;
            p.alive = nowAlive;
            if (sp.da !== undefined && !nowAlive) {
                p.deadAt = sp.da;
            }

            // Sync death & revive sound and visual effects on client
            if (wasAlive && !nowAlive) {
                if (
                    typeof SoundEngine !== 'undefined' &&
                    SoundEngine.playerDeath
                ) {
                    SoundEngine.playerDeath();
                }
            } else if (!wasAlive && nowAlive) {
                p.x = sp.x;
                p.y = sp.y;
                if (
                    typeof SoundEngine !== 'undefined' &&
                    SoundEngine.playerRevived
                ) {
                    SoundEngine.playerRevived();
                }
                if (typeof triggerReviveAnimation === 'function') {
                    const animTime =
                        typeof gameClock !== 'undefined'
                            ? gameClock
                            : typeof performance !== 'undefined'
                              ? performance.now()
                              : 0;
                    triggerReviveAnimation(p, animTime);
                }
            }
            if (sp.nm && sp.nm !== p.name) {
                p.name = sp.nm;
            }
            if (p.selectedWeapon !== sp.w) {
                p.selectedWeapon = sp.w;
                p.selectedWeaponLabel = sp.wl;
                p.weapons = [];
                if (sp.w) p.unlockWeapon(sp.w);
            }
            if (sp.fx !== undefined && sp.fy !== undefined) {
                let flail = p.weapons
                    ? p.weapons.find((w) => w.id === 'player_flail')
                    : null;
                if (!flail) {
                    p.unlockWeapon('player_flail');
                    flail = p.weapons
                        ? p.weapons.find((w) => w.id === 'player_flail')
                        : null;
                }
                if (flail) {
                    flail.targetX = sp.fx;
                    flail.targetY = sp.fy;
                    if (
                        flail.x === undefined ||
                        flail.y === undefined ||
                        (p.index !== netManager.localPlayerIndex &&
                            (!clientSnapshotBuffer ||
                                clientSnapshotBuffer.length < 2) &&
                            (flail.x - sp.fx) ** 2 +
                                (flail.y - sp.fy) ** 2 >
                                32400)
                    ) {
                        flail.x = sp.fx;
                        flail.y = sp.fy;
                    }
                }
            } else if (p.weapons && p.index !== netManager.localPlayerIndex) {
                p.weapons = p.weapons.filter((w) => w.id !== 'player_flail');
            }
            p.currentLevelUpgradeName = sp.up;
            p.campervanUntil = sp.cv || 0;
            p.invuln = sp.iv || 0;
            p.martyrdomAuraEnabled = sp.ma === 1;
            p.martyrsPresenceEnabled = sp.mp === 1;
            p.disconnected = sp.dc === 1;

            if (sp.i === netManager.localPlayerIndex) {
                // Client's own player: trust local joystick prediction while moving
                const dist2 = (p.x - sp.x) ** 2 + (p.y - sp.y) ** 2;
                if (dist2 > 22500) {
                    // Hard snap only if severely desynced (> 150px, e.g. teleport / respawn / massive knockback)
                    p.x = sp.x;
                    p.y = sp.y;
                    const myFlail = p.weapons
                        ? p.weapons.find((w) => w.id === 'player_flail')
                        : null;
                    if (myFlail && sp.fx !== undefined && sp.fy !== undefined) {
                        myFlail.x = sp.fx;
                        myFlail.y = sp.fy;
                    }
                } else if (!p.isMoving && dist2 > 900) {
                    // Smooth exponential decay towards authoritative position only when stationary
                    p.x += (sp.x - p.x) * 0.15;
                    p.y += (sp.y - p.y) * 0.15;
                }
            } else {
                // Remote player: update target position and state for smooth 60fps interpolation
                p.targetX = sp.x;
                p.targetY = sp.y;
                if (
                    p.x === undefined ||
                    (p.x - sp.x) ** 2 + (p.y - sp.y) ** 2 > 32400
                ) {
                    p.x = sp.x;
                    p.y = sp.y;
                }
                if (sp.fa !== undefined) {
                    if (p.targetFacingAngle === undefined) {
                        p.facingAngle = sp.fa;
                    }
                    p.targetFacingAngle = sp.fa;
                }
                p.isMoving = sp.mv === 1;
            }

            // Sync Melee Sweep and Sledgehammer animations for ALL players (local & remote)
            if (sp.mf !== undefined && sp.mf > 0) {
                let melee = p.weapons
                    ? p.weapons.find((w) => w.id === 'melee_sweep')
                    : null;
                if (!melee) {
                    p.unlockWeapon('melee_sweep');
                    melee = p.weapons
                        ? p.weapons.find((w) => w.id === 'melee_sweep')
                        : null;
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
                    angle: sp.sh.a,
                };
            }
        }
    }

    // 1.5 Reconcile Authoritative Dead Enemies from Host
    if (snapshot.deadEnemies && Array.isArray(snapshot.deadEnemies)) {
        for (let i = 0; i < snapshot.deadEnemies.length; i++) {
            const deadId = snapshot.deadEnemies[i];
            clientDeadEnemyIds.add(deadId);
            const e = clientEnemyCache.get(deadId);
            if (e) {
                if (typeof spawnHitParticles === 'function') {
                    spawnHitParticles(e.x, e.y, e.color || '#ff4444', 3);
                }
                e.alive = false;
                e.hp = 0;
                clientEnemyCache.delete(deadId);
            }
        }
        if (clientDeadEnemyIds.size > 500) {
            const it = clientDeadEnemyIds.values();
            for (let i = 0; i < 100; i++) {
                const next = it.next();
                if (next.done) break;
                clientDeadEnemyIds.delete(next.value);
            }
        }
    }

    // 2. Reconcile Enemies (smooth target coordinates for 60fps interpolation)
    if (snapshot.enemies) {
        const seenIds = new Set();
        const activeEnemies = [];
        for (const se of snapshot.enemies) {
            let id, type, x, y, hp, mhp, fa, r, c, st, sr, ab, ly, la, fz, vs, vp;
            if (Array.isArray(se)) {
                id = se[0];
                type = se[1];
                x = se[2];
                y = se[3];
                hp = se[4];
                mhp = se[5];
                fa = se[6];
                r = se[7] || 0;
                c = se[8] || '';
                st = se[9] || '';
                sr = se[10] || 0;
                ab = se[11] === 1;
                ly = se[12] || 0;
                la = se[13] || 0;
                fz = se[14] || 0;
                vs = se[15] || 0;
                vp = se[16] || 0;
            } else {
                id = se.id;
                type = se.t;
                x = se.x;
                y = se.y;
                hp = se.hp;
                mhp = se.mhp;
                fa = se.fa;
                r = se.r || 0;
                c = se.c || '';
                st = se.st || '';
                sr = se.sr || 0;
                ab = se.ab === 1;
                ly = se.ly || 0;
                la = se.la || 0;
                fz = se.fz || 0;
                vs = se.vs || 0;
                vp = se.vp || 0;
            }
            if (hp <= 0 || clientDeadEnemyIds.has(id)) continue;
            seenIds.add(id);
            let e = clientEnemyCache.get(id);
            if (!e) {
                e = Enemy.create(x, y, type, nowTime);
                e._nid = id;
                e.x = x;
                e.y = y;
                e.targetX = x;
                e.targetY = y;
                e.facingAngle = fa;
                clientEnemyCache.set(id, e);
            } else {
                e.targetX = x;
                e.targetY = y;
                const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
                if (d2 > 32400) {
                    e.x = x;
                    e.y = y;
                }
                if (
                    typeof clientSnapshotBuffer === 'undefined' ||
                    clientSnapshotBuffer.length < 2
                ) {
                    e.facingAngle = fa;
                }
            }
            e.lastSeenNetTime = nowTime;
            e.alive = true;
            e.hp = hp;
            e.maxHp = mhp;
            if (r) e.r = r;
            if (c) e.color = c;
            if (st) {
                e.viperState = st;
                e.stalkerState = st;
            }
            if (sr) e.shieldRadius = sr;
            e.airborne = ab;
            if (ly) e.landY = ly;
            if (la) {
                e.landAt = la;
                if (typeof METEOR_FALL_MS !== 'undefined') {
                    const warnMult =
                        typeof GAME_STATE !== 'undefined' &&
                        GAME_STATE.difficulty
                            ? GAME_STATE.difficulty.difficultyMultiplier || 1.0
                            : 1.0;
                    e.fallDuration = METEOR_FALL_MS * warnMult;
                }
            }
            if (fz > 0) {
                const targetFrozenUntil = nowTime + fz;
                if (nowTime >= (e.frozenUntil || 0)) {
                    e.frozenStart = nowTime;
                    if (
                        typeof SoundEngine !== 'undefined' &&
                        SoundEngine.enemyFreeze
                    ) {
                        SoundEngine.enemyFreeze();
                    }
                }
                e.frozenUntil = targetFrozenUntil;
            } else if (e.frozenUntil && e.frozenUntil > nowTime) {
                e.frozenUntil = 0;
            }
            if (typeof applyEnemyVisualState === 'function') {
                applyEnemyVisualState(e, vs, vp, nowTime);
            }
            activeEnemies.push(e);
        }
        for (const [id, e] of clientEnemyCache.entries()) {
            if (!seenIds.has(id) && !clientDeadEnemyIds.has(id)) {
                const timeSinceSeen = nowTime - (e.lastSeenNetTime || nowTime);
                if (timeSinceSeen < 300 && e.alive && e.hp > 0) {
                    activeEnemies.push(e);
                } else if (timeSinceSeen > 5000) {
                    clientEnemyCache.delete(id);
                }
            }
        }
        GAME_STATE.enemies = activeEnemies;
    }

    // 3. Reconcile Projectiles & Enemy Projectiles with persistent _nid tracking
    if (snapshot.projectiles) {
        const seenIds = new Set();
        const activeProjectiles = [];
        for (let i = 0; i < snapshot.projectiles.length; i++) {
            const sp = snapshot.projectiles[i];
            let id, type, x, y, r, color, angle, tx, ty, sx, sy, mr, pi;
            if (Array.isArray(sp)) {
                if (typeof sp[0] === 'number' && typeof sp[1] === 'string') {
                    // Modern format with _nid: [id, type, x, y, r, color, angle, ...]
                    id = sp[0];
                    type = sp[1];
                    x = sp[2];
                    y = sp[3];
                    r = sp[4] || 3;
                    color = sp[5] || '#00ffcc';
                    angle = sp[6] || 0;
                    tx = sp[7] || undefined;
                    ty = sp[8] || undefined;
                    sx = sp[9] || undefined;
                    sy = sp[10] || undefined;
                    mr = sp[11] === 1;
                    pi = sp[12] || 0;
                } else {
                    // Legacy tuple format: [type, x, y, r, color, angle, ...]
                    id = i + 1;
                    type = sp[0];
                    x = sp[1];
                    y = sp[2];
                    r = sp[3] || 3;
                    color = sp[4] || '#00ffcc';
                    angle = sp[5] || 0;
                    tx = sp[6] || undefined;
                    ty = sp[7] || undefined;
                    sx = sp[8] || undefined;
                    sy = sp[9] || undefined;
                    mr = sp[10] === 1;
                    pi = sp[11] || 0;
                }
            } else {
                id = sp.id || i + 1;
                type = sp.t;
                x = sp.x;
                y = sp.y;
                r = sp.r || 3;
                color = sp.c || '#00ffcc';
                angle = sp.a || 0;
                tx = sp.tx;
                ty = sp.ty;
                sx = sp.sx;
                sy = sp.sy;
                mr = sp.mr === 1;
                pi = sp.pi || 0;
            }
            seenIds.add(id);
            let p = clientProjectileCache.get(id);
            if (!p) {
                p = Object.create(NetworkProjectileProto);
                p._nid = id;
                p.x = x;
                p.y = y;
                p.spawnTime = performance.now();
                p.targetX = x;
                p.targetY = y;
                p.angle = angle;
                p.targetAngle = angle;
                clientProjectileCache.set(id, p);
            } else {
                p.targetX = x;
                p.targetY = y;
                p.targetAngle = angle;
                if (type !== 'fire_ring' && type !== 'deflector_shield') {
                    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
                    if (d2 > 14400) {
                        // snap if desynced by > 120px
                        p.x = x;
                        p.y = y;
                    }
                }
            }
            p.type = type;
            p.r = r;
            p.color = color;
            if (p.type === 'fire_ring' || p.type === 'deflector_shield') {
                if (p.angle === undefined) p.angle = angle;
                p.targetAngle = angle;
            } else {
                p.angle = angle;
            }
            p.tx = tx;
            p.ty = ty;
            p.startX = sx;
            p.startY = sy;
            p.mineRing = mr;
            p.playerIndex = pi;
            p.owner =
                typeof GAME_STATE !== 'undefined' && GAME_STATE.players
                    ? GAME_STATE.players[pi] || GAME_STATE.players[0]
                    : null;
            const speed =
                p.type === 'missile' || p.type === 'laser'
                    ? 8
                    : p.type === 'lightning'
                      ? 0
                      : 5;
            p.vx = Math.cos(p.angle) * speed;
            p.vy = Math.sin(p.angle) * speed;
            p.alive = true;
            activeProjectiles.push(p);
        }
        for (const [id, p] of clientProjectileCache.entries()) {
            if (!seenIds.has(id)) {
                if (
                    p?.alive &&
                    p.x >= 0 &&
                    p.x <= (GAME_STATE.hostW || W || 1512) &&
                    p.y >= 0 &&
                    p.y <= (GAME_STATE.hostH || H || 900)
                ) {
                    if (p.type === 'rocket') {
                        spawnHitParticles(p.x, p.y, '#ffaa00', 4);
                        if (typeof MineExplosion !== 'undefined') {
                            const r = p.blastRadius || 60;
                            GAME_STATE.particles.push(
                                new MineExplosion(p.x, p.y, r, nowTime, null, true),
                            );
                        }
                    }
                }
                clientProjectileCache.delete(id);
            }
        }
        GAME_STATE.projectiles = activeProjectiles;
    }

    if (snapshot.enemyProjectiles) {
        const seenIds = new Set();
        const activeEnemyProjectiles = [];
        for (let i = 0; i < snapshot.enemyProjectiles.length; i++) {
            const sep = snapshot.enemyProjectiles[i];
            let id, x, y, r, color, angle;
            if (Array.isArray(sep)) {
                if (sep.length >= 6) {
                    // Modern format with _nid and angle: [id, x, y, r, color, angle]
                    id = sep[0];
                    x = sep[1];
                    y = sep[2];
                    r = sep[3] || 4;
                    color = sep[4] || '#ff3344';
                    angle = sep[5];
                } else if (sep.length >= 5) {
                    // Format with _nid: [id, x, y, r, color]
                    id = sep[0];
                    x = sep[1];
                    y = sep[2];
                    r = sep[3] || 4;
                    color = sep[4] || '#ff3344';
                } else {
                    // Legacy format: [x, y, r, color]
                    id = i + 1;
                    x = sep[0];
                    y = sep[1];
                    r = sep[2] || 4;
                    color = sep[3] || '#ff3344';
                }
            } else {
                id = sep.id || i + 1;
                x = sep.x;
                y = sep.y;
                r = sep.r || 4;
                color = sep.c || '#ff3344';
                angle = sep.a;
            }
            seenIds.add(id);
            let ep = clientEnemyProjectileCache.get(id);
            if (!ep) {
                ep = Object.create(NetworkEnemyProjectileProto);
                ep._nid = id;
                ep.x = x;
                ep.y = y;
                ep.targetX = x;
                ep.targetY = y;
                ep.vx = 0;
                ep.vy = 0;
                ep.angle = angle !== undefined ? angle : 0;
                clientEnemyProjectileCache.set(id, ep);
            } else {
                const prevX = ep.targetX !== undefined ? ep.targetX : ep.x;
                const prevY = ep.targetY !== undefined ? ep.targetY : ep.y;
                ep.vx = (x - prevX) / 2.0;
                ep.vy = (y - prevY) / 2.0;
                ep.targetX = x;
                ep.targetY = y;
                const d2 = (ep.x - x) ** 2 + (ep.y - y) ** 2;
                if (d2 > 14400) {
                    ep.x = x;
                    ep.y = y;
                }
                if (angle !== undefined) {
                    ep.angle = angle;
                } else if (Math.hypot(ep.vx, ep.vy) > 0.01) {
                    ep.angle = Math.atan2(ep.vy, ep.vx);
                }
            }
            ep.r = r;
            ep.color = color;
            ep.alive = true;
            activeEnemyProjectiles.push(ep);
        }
        for (const [id, ep] of clientEnemyProjectileCache.entries()) {
            if (!seenIds.has(id)) {
                if (
                    ep &&
                    ep.x >= 0 &&
                    ep.x <= (GAME_STATE.hostW || W || 1512) &&
                    ep.y >= 0 &&
                    ep.y <= (GAME_STATE.hostH || H || 900)
                ) {
                    if (typeof spawnHitParticles === 'function') {
                        const hitCol =
                            ep.r === 6 ? '#bb44ff' : ep.color || '#ff3344';
                        spawnHitParticles(ep.x, ep.y, hitCol, 3);
                    }
                }
                clientEnemyProjectileCache.delete(id);
            }
        }
        GAME_STATE.enemyProjectiles = activeEnemyProjectiles;
    }

    // 4. Reconcile Gems, Health Packs & Supply Drops (Persistent ID tracking & client attraction prediction)
    if (snapshot.gems !== undefined) {
        const seenGems = new Set();
        const activeGems = [];
        const count = snapshot.gems.length;
        for (let i = 0; i < count; i++) {
            const sg = snapshot.gems[i];
            let id, gx, gy, gv, ghp, gsd, isAttracted;
            if (Array.isArray(sg)) {
                gx = sg[0];
                gy = sg[1];
                gv = sg[2] || 5;
                ghp = sg[3] || 0;
                gsd = sg[4] || 0;
                id = sg[5] || i + 1;
                isAttracted = sg[6] === 1 || sg[6] === true;
            } else {
                id = sg.id || i + 1;
                gx = sg.x;
                gy = sg.y;
                gv = sg.v || 5;
                ghp = sg.hp || 0;
                gsd = sg.sd || 0;
                isAttracted = sg.at === 1;
            }

            seenGems.add(id);

            // Ignore if already collected locally on client
            if (clientCollectedGems.has(id)) {
                continue;
            }

            let g = clientGemCache.get(id);
            if (!g) {
                if (ghp) {
                    g = new HealthPack(gx, gy, nowTime);
                } else if (gsd) {
                    g = new SupplyDrop(gx, gy, gsd, nowTime);
                } else {
                    g = new XPGem(gx, gy, gv);
                    if (!GAME_STATE.xpArrowDone && !GAME_STATE.firstXpGem) {
                        GAME_STATE.firstXpGem = g;
                    }
                }
                g._nid = id;
                g.x = gx;
                g.y = gy;
                g.targetX = gx;
                g.targetY = gy;
                g.attracted = isAttracted;
                clientGemCache.set(id, g);
            } else {
                if (isAttracted) {
                    g.attracted = true;
                }
                if (!g.attracted) {
                    g.targetX = gx;
                    g.targetY = gy;
                    if (
                        g.x === undefined ||
                        (g.x - gx) ** 2 + (g.y - gy) ** 2 > 22500
                    ) {
                        g.x = gx;
                        g.y = gy;
                    }
                }
                g.alive = true;
            }
            activeGems.push(g);
        }

        for (const [id] of clientGemCache.entries()) {
            if (!seenGems.has(id)) {
                clientGemCache.delete(id);
                clientCollectedGems.delete(id);
            }
        }
        GAME_STATE.gems = activeGems;
    }

    // 5. Reconcile Turrets (with spawnTime and flame angles preserved)
    if (snapshot.turrets) {
        const seenTurretIds = new Set();
        const activeTurrets = [];
        for (const st of snapshot.turrets) {
            seenTurretIds.add(st.id);
            let turret = clientTurretCache.get(st.id);
            const owner = GAME_STATE.players[st.pi] || GAME_STATE.players[0];
            if (owner) {
                if (st.lw) owner.laserWallsEnabled = true;
                if (st.sw) owner.slowWallsEnabled = true;
                if (st.ts) owner.turretSawEnabled = true;
            }
            if (!turret) {
                turret = new TurretEntity(st.x, st.y, owner, st.st || nowTime);
                turret._nid = st.id;
                turret.spawnTime = st.st || nowTime;
                turret.x = st.x;
                turret.y = st.y;
                turret.angle = st.a || 0;
                turret.flameAngle = st.fa || 0;
                clientTurretCache.set(st.id, turret);
            } else if (
                typeof clientSnapshotBuffer === 'undefined' ||
                clientSnapshotBuffer.length < 2
            ) {
                turret.x = st.x;
                turret.y = st.y;
                turret.angle = st.a || 0;
                turret.flameAngle = st.fa || 0;
            }
            turret.hp = st.hp;
            turret.maxHp = st.mhp;
            turret.isFlamethrower = st.fl === 1;
            turret.flameActiveUntil = st.faU || 0;
            turret.flameCenterAngle = st.fcA || 0;
            turret.player = owner;
            turret.laserWallsEnabled = Boolean(st.lw);
            turret.slowWallsEnabled = Boolean(st.sw);
            turret.turretSawEnabled = Boolean(st.ts);
            turret.alive = true;
            activeTurrets.push(turret);
        }
        for (const [id, turret] of clientTurretCache.entries()) {
            if (!seenTurretIds.has(id)) {
                if (turret) {
                    turret.alive = false;
                    for (const conn of turret.connections) {
                        const idx = conn.connections.indexOf(turret);
                        if (idx !== -1) conn.connections.splice(idx, 1);
                    }
                    turret.connections = [];
                    if (typeof spawnHitParticles === 'function') {
                        spawnHitParticles(turret.x, turret.y, '#ff8800', 8);
                    }
                }
                clientTurretCache.delete(id);
            }
        }
        GAME_STATE.turrets = activeTurrets;

        // Reconstruct turret connections authoritatively from host
        for (const t of activeTurrets) {
            t.connections = [];
        }
        let hasAuthoritativeConns = false;
        for (const st of snapshot.turrets) {
            if (st.conns !== undefined) {
                hasAuthoritativeConns = true;
                const turret = clientTurretCache.get(st.id);
                if (turret?.alive) {
                    for (const connId of st.conns) {
                        const targetTurret = clientTurretCache.get(connId);
                        if (
                            targetTurret?.alive &&
                            !turret.connections.includes(targetTurret)
                        ) {
                            turret.connections.push(targetTurret);
                        }
                    }
                }
            }
        }
        if (!hasAuthoritativeConns) {
            const sortedTurrets = activeTurrets
                .slice()
                .sort((a, b) => (a.spawnTime || 0) - (b.spawnTime || 0));
            for (const t of sortedTurrets) {
                if (
                    t.alive &&
                    (t.laserWallsEnabled ||
                        t.slowWallsEnabled ||
                        (t.player &&
                            (t.player.laserWallsEnabled ||
                                t.player.slowWallsEnabled)))
                ) {
                    t.linkWalls();
                }
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
                        hazard = new PlayerMine(
                            sh.x,
                            sh.y,
                            sh.r || 8,
                            50,
                            owner,
                            sh.st || nowTime,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        if (sh.tr) hazard.triggeredTime = nowTime;
                        break;
                    case 'mine_explosion':
                        hazard = new MineExplosion(
                            sh.x,
                            sh.y,
                            sh.r,
                            sh.st || nowTime,
                            owner,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'nuke_explosion':
                        hazard = new NukeExplosion(
                            sh.x,
                            sh.y,
                            sh.r,
                            sh.st || nowTime,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'freeze_explosion':
                        hazard = new FreezeBlastVisual(
                            sh.x,
                            sh.y,
                            sh.r,
                            sh.st || nowTime,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'sledge_hit':
                        hazard = new SledgeHitVisual(
                            sh.x,
                            sh.y,
                            sh.r,
                            sh.ca || 1.2,
                            sh.a || 0,
                            sh.st || nowTime,
                            owner,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'muzzle_flash':
                        hazard = new InstantMuzzleFlash(
                            sh.x,
                            sh.y,
                            sh.a || 0,
                            sh.c || (owner ? owner.color : '#00ffcc'),
                            sh.st || nowTime,
                            owner,
                            sh.r || 16,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'hit_impact':
                        hazard = new InstantHitImpact(
                            sh.x,
                            sh.y,
                            sh.a || 0,
                            owner ? owner.color : (sh.c || '#ffcc00'),
                            sh.st || nowTime,
                            owner,
                            sh.r || 20,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'burning_surface':
                        hazard = new BurningSurface(
                            sh.x,
                            sh.y,
                            sh.r,
                            sh.st || nowTime,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'burning_trail':
                        hazard = new BurningTrailSegment(
                            sh.x,
                            sh.y,
                            sh.x2 || sh.x,
                            sh.y2 || sh.y,
                            sh.st || nowTime,
                            owner,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'laser_trail':
                        hazard = new LaserTrailSegment(
                            sh.x,
                            sh.y,
                            sh.x2 || sh.x,
                            sh.y2 || sh.y,
                            sh.st || nowTime,
                            owner,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'ice_trail':
                        hazard = new IceTrailSegment(
                            sh.x,
                            sh.y,
                            sh.x2 || sh.x,
                            sh.y2 || sh.y,
                            sh.st || nowTime,
                            owner,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'bile_mortar':
                        hazard = new BileMortarPod(
                            sh.x,
                            sh.y,
                            sh.x2 || sh.x,
                            sh.y2 || sh.y,
                            sh.st || nowTime,
                            sh.lt || sh.st + 1500,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'acid_pool':
                        hazard = new AcidPoolHazard(
                            sh.x,
                            sh.y,
                            sh.r,
                            sh.st || nowTime,
                            sh.dur || 5000,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'white_hole':
                        hazard = new WhiteHolePush(
                            sh.x,
                            sh.y,
                            sh.r,
                            sh.st || nowTime,
                        );
                        hazard.spawnTime = sh.st || nowTime;
                        break;
                    case 'black_hole':
                        hazard = new BlackHolePull(
                            sh.x,
                            sh.y,
                            sh.r,
                            sh.st || nowTime,
                        );
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
                            draw: function (now) {
                                ctx.save();
                                ctx.fillStyle = 'rgba(255, 68, 68, 0.4)';
                                ctx.beginPath();
                                ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
                                ctx.fill();
                                ctx.restore();
                            },
                        };
                        break;
                }
                hazard._nid = sh.id;
                clientHazardCache.set(sh.id, hazard);
            } else {
                // Update position / state of ongoing hazard
                if (hazard.x !== undefined) hazard.x = sh.x;
                if (hazard.y !== undefined) hazard.y = sh.y;
                if (sh.tr && hazard.triggeredTime === 0)
                    hazard.triggeredTime = nowTime;
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
        GAME_STATE.terrains = snapshot.terrains.map((st) => {
            if (
                st.type === 'wall' ||
                st.hw !== undefined ||
                st.isWallObstacle
            ) {
                if (typeof WallDebrisObstacle !== 'undefined') {
                    return new WallDebrisObstacle(
                        st.x,
                        st.y,
                        st.hw || 95,
                        st.hh || 22,
                        st.ang || 0,
                    );
                }
            }
            if (typeof ShieldTerrain !== 'undefined') {
                return new ShieldTerrain(
                    st.x,
                    st.y,
                    st.r || 100,
                    st.fa || 0,
                    nowTime + 10000,
                );
            }
            return st;
        });
    }

    // 7. World Stats & State Sync
    if (
        snapshot.currentGameState !== undefined &&
        typeof STATES !== 'undefined'
    ) {
        if (
            snapshot.currentGameState === STATES.GAMEPLAY &&
            (GAME_STATE.current === STATES.WEAPON_SELECT ||
                GAME_STATE.current === STATES.COUNTDOWN)
        ) {
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
        if (
            typeof gameClock === 'undefined' ||
            gameClock === 0 ||
            Math.abs(gameClock - snapshot.elapsed) > 500
        ) {
            gameClock = snapshot.elapsed;
        } else if (snapshot.elapsed > gameClock) {
            gameClock += (snapshot.elapsed - gameClock) * 0.05;
        }
    }
    if (snapshot.level !== undefined) GAME_STATE.level = snapshot.level;
    if (snapshot.xp !== undefined) GAME_STATE.xp = snapshot.xp;
    if (snapshot.nextXp !== undefined) GAME_STATE.nextXp = snapshot.nextXp;
    if (snapshot.kills !== undefined) GAME_STATE.kills = snapshot.kills;
    if (snapshot.activeBoss !== undefined)
        GAME_STATE.activeBoss = snapshot.activeBoss;
    if (snapshot.activeBossStartTime !== undefined)
        GAME_STATE.activeBossStartTime = snapshot.activeBossStartTime;
    if (snapshot.hordeStartTime !== undefined)
        GAME_STATE.hordeStartTime = snapshot.hordeStartTime;
    if (
        snapshot.difficulty &&
        typeof DIFFICULTIES !== 'undefined' &&
        DIFFICULTIES[snapshot.difficulty]
    ) {
        GAME_STATE.difficulty = DIFFICULTIES[snapshot.difficulty];
    }
};

window.onOnlineLevelUpStarted = (pendingLevels, upgradesMap) => {
    GAME_STATE.pendingLevels = pendingLevels || 1;
    GAME_STATE.current = STATES.LEVEL_UP;
    if (typeof SoundEngine !== 'undefined' && SoundEngine.levelUp) {
        SoundEngine.levelUp();
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
    if (upgradesMap) {
        for (const idx in upgradesMap) {
            const p = GAME_STATE.players[idx];
            if (p) {
                p.currentUpgradeOptions = upgradesMap[idx]
                    .map((id) => UPGRADE_POOL.find((u) => u.id === id))
                    .filter(Boolean);
            }
        }
    }
    beginSelectionRound();
};

window.onOnlinePauseSynced = (paused) => {
    const hostOverlay = document.getElementById('hostPauseOverlay');
    if (paused) {
        if (typeof GAME_STATE !== 'undefined') {
            GAME_STATE.current = STATES.PAUSED;
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
        if (hostOverlay) hostOverlay.style.display = 'block';
    } else {
        if (hostOverlay) hostOverlay.style.display = 'none';
    }
};

window.onOnlineGameOver = () => {
    gameOver();
};

window.onOnlineVictory = () => {
    showVictory();
};

function interpolateNetworkWorld(renderTime, dtFactor = 1.0) {
    if (typeof netManager === 'undefined' || !netManager.isClient) return;
    if (!clientSnapshotBuffer || clientSnapshotBuffer.length < 2) return;

    let s0 = null;
    let s1 = null;

    // Locate bounding snapshots s0 and s1 around renderTime
    for (let i = clientSnapshotBuffer.length - 1; i >= 0; i--) {
        const entry = clientSnapshotBuffer[i];
        if (entry.clientTime <= renderTime) {
            s0 = entry;
            s1 = clientSnapshotBuffer[i + 1] || null;
            break;
        }
    }

    let alpha = 1.0;
    let snapA = null;
    let snapB = null;

    if (s0 && s1) {
        const span = Math.max(1, s1.clientTime - s0.clientTime);
        alpha = Math.max(0, Math.min(1.0, (renderTime - s0.clientTime) / span));
        snapA = s0.snapshot;
        snapB = s1.snapshot;
    } else if (!s0 && clientSnapshotBuffer.length >= 2) {
        snapA = clientSnapshotBuffer[0].snapshot;
        snapB = clientSnapshotBuffer[1].snapshot;
        alpha = 0.0;
    } else {
        const len = clientSnapshotBuffer.length;
        s0 = clientSnapshotBuffer[len - 2];
        s1 = clientSnapshotBuffer[len - 1];
        const span = Math.max(1, s1.clientTime - s0.clientTime);
        const extrapMs = Math.min(66, Math.max(0, renderTime - s1.clientTime));
        alpha = 1.0 + extrapMs / span;
        snapA = s0.snapshot;
        snapB = s1.snapshot;
    }

    if (!snapA || !snapB) return;

    // 1. Interpolate Remote Players
    if (snapB.players) {
        const pMapA = new Map();
        if (snapA.players) {
            for (const spA of snapA.players) pMapA.set(spA.i, spA);
        }
        for (const spB of snapB.players) {
            if (spB.i === netManager.localPlayerIndex) continue;
            const p = GAME_STATE.players[spB.i];
            if (!p) continue;
            const spA = pMapA.get(spB.i);
            if (spA) {
                p.x = spA.x + alpha * (spB.x - spA.x);
                p.y = spA.y + alpha * (spB.y - spA.y);
                if (spA.fa !== undefined && spB.fa !== undefined) {
                    let da = spB.fa - spA.fa;
                    while (da > Math.PI) da -= Math.PI * 2;
                    while (da < -Math.PI) da += Math.PI * 2;
                    p.facingAngle = spA.fa + da * alpha;
                }
            } else {
                p.x = spB.x;
                p.y = spB.y;
                if (spB.fa !== undefined) p.facingAngle = spB.fa;
            }

            if (p.weapons) {
                let flail = p.weapons.find((w) => w.id === 'player_flail');
                if (
                    !flail &&
                    (spB.fx !== undefined || (spA && spA.fx !== undefined))
                ) {
                    p.unlockWeapon('player_flail');
                    flail = p.weapons.find((w) => w.id === 'player_flail');
                }
                if (flail) {
                    if (spA && spA.fx !== undefined && spB.fx !== undefined) {
                        const oldX = flail.x !== undefined ? flail.x : spA.fx;
                        const oldY = flail.y !== undefined ? flail.y : spA.fy;
                        flail.x = spA.fx + alpha * (spB.fx - spA.fx);
                        flail.y = spA.fy + alpha * (spB.fy - spA.fy);
                        const dist = Math.hypot(flail.x - p.x, flail.y - p.y);
                        const restLen =
                            flail.length * (p.meleeRangeModifier || 1.0);
                        if (dist > 1) {
                            flail.x =
                                p.x + ((flail.x - p.x) / dist) * restLen;
                            flail.y =
                                p.y + ((flail.y - p.y) / dist) * restLen;
                        }
                        flail.vx = flail.x - oldX;
                        flail.vy = flail.y - oldY;
                    } else if (spB.fx !== undefined) {
                        flail.x = spB.fx;
                        flail.y = spB.fy;
                    }
                }
            }
        }
    }

    // 2. Interpolate Enemies
    if (snapB.enemies) {
        const eMapA = new Map();
        if (snapA.enemies) {
            for (const seA of snapA.enemies) {
                const nid = Array.isArray(seA) ? seA[0] : seA.id;
                eMapA.set(nid, seA);
            }
        }
        for (const seB of snapB.enemies) {
            const nid = Array.isArray(seB) ? seB[0] : seB.id;
            const e = clientEnemyCache.get(nid);
            if (!e) continue;
            const seA = eMapA.get(nid);
            const bx = Array.isArray(seB) ? seB[2] : seB.x;
            const by = Array.isArray(seB) ? seB[3] : seB.y;
            const bfa = Array.isArray(seB) ? seB[6] : seB.fa;
            if (seA) {
                const ax = Array.isArray(seA) ? seA[2] : seA.x;
                const ay = Array.isArray(seA) ? seA[3] : seA.y;
                const afa = Array.isArray(seA) ? seA[6] : seA.fa;
                e.x = ax + alpha * (bx - ax);
                e.y = ay + alpha * (by - ay);
                if (afa !== undefined && bfa !== undefined) {
                    let da = bfa - afa;
                    while (da > Math.PI) da -= Math.PI * 2;
                    while (da < -Math.PI) da += Math.PI * 2;
                    e.facingAngle = afa + da * alpha;
                }
            } else {
                e.x = bx;
                e.y = by;
                if (bfa !== undefined) e.facingAngle = bfa;
            }
        }
    }

    // 3. Interpolate Turrets
    if (snapB.turrets) {
        const tMapA = new Map();
        if (snapA.turrets) {
            for (const stA of snapA.turrets) tMapA.set(stA.id, stA);
        }
        for (const stB of snapB.turrets) {
            const turret = (GAME_STATE.turrets || []).find(
                (t) => t && t._nid === stB.id,
            );
            if (!turret) continue;
            const stA = tMapA.get(stB.id);
            if (stA) {
                turret.x = stA.x + alpha * (stB.x - stA.x);
                turret.y = stA.y + alpha * (stB.y - stA.y);
                if (stA.a !== undefined && stB.a !== undefined) {
                    let da = stB.a - stA.a;
                    while (da > Math.PI) da -= Math.PI * 2;
                    while (da < -Math.PI) da += Math.PI * 2;
                    turret.angle = stA.a + da * alpha;
                }
                if (stA.fa !== undefined && stB.fa !== undefined) {
                    let dfa = stB.fa - stA.fa;
                    while (dfa > Math.PI) dfa -= Math.PI * 2;
                    while (dfa < -Math.PI) dfa += Math.PI * 2;
                    turret.flameAngle = stA.fa + dfa * alpha;
                }
            } else {
                turret.x = stB.x;
                turret.y = stB.y;
                if (stB.a !== undefined) turret.angle = stB.a;
                if (stB.fa !== undefined) turret.flameAngle = stB.fa;
            }
        }
    }
}

function recalculateDynamicDifficulty() {
    if (typeof GAME_STATE === 'undefined' || !GAME_STATE.players) return;
    const activePlayers =
        GAME_STATE.players.filter((p) => p && !p.disconnected).length || 1;
    const diff = GAME_STATE.difficulty || DIFFICULTIES.normal;
    GAME_STATE.dmgFactor =
        (1.5 / (activePlayers + 0.5)) * (diff.dmgMult || 1.0);
    const coopSpeedBonus = activePlayers > 1 ? 1 + 0.05 * activePlayers : 1.0;
    const speedFactor = coopSpeedBonus * (diff.speedMult || 1.0);
    for (const p of GAME_STATE.players) {
        if (p) p.speed = 1.0 * speedFactor;
    }
}

const netManager = typeof window !== 'undefined' ? new NetworkManager() : null;

if (typeof window !== 'undefined') {
    window.NetworkManager = NetworkManager;
    window.netManager = netManager;
    window.serializeWorldForNetwork = serializeWorldForNetwork;
    window.serializeWorldForNetworkJSON = serializeWorldForNetworkJSON;
    window.packWorldSnapshotBinary = packWorldSnapshotBinary;
    window.unpackWorldSnapshotBinary = unpackWorldSnapshotBinary;
    window.uint8ToBase64 = uint8ToBase64;
    window.base64ToUint8 = base64ToUint8;
    window.despawnPlayerEntities = despawnPlayerEntities;
    window.recalculateDynamicDifficulty = recalculateDynamicDifficulty;
    window.interpolateNetworkWorld = interpolateNetworkWorld;
    window.clientSnapshotBuffer = clientSnapshotBuffer;
    window.clientEnemyCache = clientEnemyCache;
    window.clientProjectileCache = clientProjectileCache;
    window.clientEnemyProjectileCache = clientEnemyProjectileCache;
    window.clientGemCache = clientGemCache;
    window.clientCollectedGems = clientCollectedGems;
    window.netHitEvents = netHitEvents;
    window.netSoundEvents = netSoundEvents;
    setupHostSoundBroadcasting();

    const handleWindowUnload = () => {
        if (typeof netManager !== 'undefined' && netManager) {
            netManager.reset();
        }
    };
    window.addEventListener('beforeunload', handleWindowUnload);
    window.addEventListener('pagehide', handleWindowUnload);
}
