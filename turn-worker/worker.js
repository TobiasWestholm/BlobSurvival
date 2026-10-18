/**
 * Blob Survival - Cloudflare Realtime TURN credential Worker
 * Serves short-lived Cloudflare TURN ICE servers so the TURN key never reaches
 * the browser.
 *
 * Dashboard: Realtime → TURN → create key → copy Turn Token ID + API Token.
 *
 * Required bindings (Worker > Settings):
 *   TURN_KEY_ID     - Secret (Turn Token ID)
 *   TURN_API_TOKEN  - Secret (API Token for that key)
 *   TURN_KV         - KV namespace binding (caches shared credentials)
 *   Optional cron, e.g. "0 * * * *", to refresh cache while idle.
 *
 * Deploy (from this directory, after secrets are set):
 *   npx wrangler secret put TURN_KEY_ID
 *   npx wrangler secret put TURN_API_TOKEN
 *   npx wrangler deploy
 */

const STATE_KEY = 'cf-turn-state';
/** Credential lifetime sent to Cloudflare (max 48h). */
const CREDENTIAL_TTL_SECONDS = 8 * 60 * 60;
/** Refresh when less than this remains (covers 1h client cache + long session). */
const REFRESH_BEFORE_EXPIRY_MS = 4 * 60 * 60 * 1000;

// 'null' is the Origin sent by pages opened via file://. Entries ending in '*' match by prefix.
const ALLOWED_ORIGINS = [
    'https://tobiaswestholm.github.io',
    'https://html-classic.itch.zone',
    'http://localhost:*',
    'http://127.0.0.1:*',
    'null',
];

function isAllowedOrigin(origin) {
    return ALLOWED_ORIGINS.some((allowed) =>
        allowed.endsWith('*')
            ? origin.startsWith(allowed.slice(0, -1))
            : origin === allowed,
    );
}

function respond(body, status, origin, extraHeaders = {}) {
    return new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Expose-Headers': 'X-Turn-Provider',
            Vary: 'Origin',
            ...extraHeaders,
        },
    });
}

/** Flatten CF generate-ice-servers payload into RTCIceServer[] (TURN only). */
function iceServersFromCloudflareResponse(data) {
    const raw = Array.isArray(data?.iceServers) ? data.iceServers : [];
    const out = [];
    for (const entry of raw) {
        if (!entry || entry.username == null || entry.credential == null) {
            continue; // skip STUN-only entries
        }
        const urls = Array.isArray(entry.urls)
            ? entry.urls
            : entry.urls
              ? [entry.urls]
              : [];
        // Browsers block TURN on port 53 — drop those URLs if present.
        const filtered = urls.filter((u) => !/:53(?:\?|$)/.test(String(u)));
        if (!filtered.length) continue;
        out.push({
            urls: filtered.length === 1 ? filtered[0] : filtered,
            username: entry.username,
            credential: entry.credential,
        });
    }
    return out;
}

async function createCloudflareIceServers(env) {
    const keyId = env.TURN_KEY_ID;
    const token = env.TURN_API_TOKEN;
    if (!keyId || !token) {
        throw new Error('TURN_KEY_ID / TURN_API_TOKEN secrets are not set');
    }
    const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
        },
    );
    if (res.status !== 201 && !res.ok) {
        const text = await res.text();
        throw new Error(
            `Cloudflare TURN credential request failed: ${res.status} ${text}`,
        );
    }
    const data = await res.json();
    const iceServers = iceServersFromCloudflareResponse(data);
    if (!iceServers.length) {
        throw new Error('Cloudflare TURN response had no usable ICE servers');
    }
    const now = Date.now();
    return {
        iceServers,
        createdAt: now,
        expiresAt: now + CREDENTIAL_TTL_SECONDS * 1000,
    };
}

async function getActiveIceServers(env) {
    const now = Date.now();
    const state = (await env.TURN_KV.get(STATE_KEY, 'json')) || {};
    let current = state.current || null;

    if (current && current.expiresAt <= now) {
        current = null;
    }
    if (
        !current ||
        current.expiresAt - now < REFRESH_BEFORE_EXPIRY_MS
    ) {
        current = await createCloudflareIceServers(env);
        await env.TURN_KV.put(STATE_KEY, JSON.stringify({ current }));
    }
    return current;
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        if (!isAllowedOrigin(origin)) {
            return respond({ error: 'Origin not allowed' }, 403, 'null');
        }
        if (request.method === 'OPTIONS') return respond(null, 204, origin);
        if (request.method !== 'GET') {
            return respond({ error: 'Method not allowed' }, 405, origin);
        }

        try {
            const active = await getActiveIceServers(env);
            return respond(active.iceServers, 200, origin, {
                'X-Turn-Provider': 'cloudflare',
            });
        } catch (e) {
            console.error(e);
            return respond({ error: 'TURN provider error' }, 502, origin);
        }
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(
            getActiveIceServers(env).catch((e) => {
                console.error('[TURN] scheduled refresh failed:', e);
            }),
        );
    },
};
