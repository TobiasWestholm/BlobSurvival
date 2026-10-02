/**
 * Blob Survival - TURN credential Worker (Cloudflare Workers)
 * Serves short-lived Metered TURN credentials so no Metered key ever reaches the browser.
 *
 * Metered credentials take up to ~1 minute to become usable after creation, so the Worker
 * keeps the active credential in KV and creates its successor well before it expires.
 *
 * Required bindings (Worker > Settings):
 *   METERED_SECRET_KEY - Secret
 *   TURN_KV            - KV namespace binding
 *   Cron trigger, e.g. "0 * * * *", so rotation also happens when nobody is playing.
 */

const METERED_APP = 'blobsurvival';
const STATE_KEY = 'turn-state';
const CREDENTIAL_TTL_SECONDS = 8 * 60 * 60;
// Served credentials keep at least this much lifetime, covering client caching (1h) plus a long session.
const ROTATE_BEFORE_EXPIRY_MS = 4 * 60 * 60 * 1000;
const ACTIVATION_DELAY_MS = 2 * 60 * 1000;

// 'null' is the Origin sent by pages opened via file://. Entries ending in '*' match by prefix.
const ALLOWED_ORIGINS = [
    'https://tobiaswestholm.github.io',
    'https://html-classic.itch.zone',
    'http://localhost:*',
    'http://127.0.0.1:*',
    'null',
];

const TURN_URLS = [
    'turn:global.relay.metered.ca:80',
    'turn:global.relay.metered.ca:80?transport=tcp',
    'turn:global.relay.metered.ca:443',
    'turns:global.relay.metered.ca:443?transport=tcp',
];

function isAllowedOrigin(origin) {
    return ALLOWED_ORIGINS.some((allowed) =>
        allowed.endsWith('*')
            ? origin.startsWith(allowed.slice(0, -1))
            : origin === allowed,
    );
}

function respond(body, status, origin) {
    return new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            Vary: 'Origin',
        },
    });
}

async function createCredential(env) {
    const res = await fetch(
        `https://${METERED_APP}.metered.live/api/v1/turn/credential?secretKey=${encodeURIComponent(env.METERED_SECRET_KEY)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                expiryInSeconds: CREDENTIAL_TTL_SECONDS,
                label: 'blobsurvival-rotating',
            }),
        },
    );
    if (!res.ok) {
        throw new Error(`Metered credential request failed: ${res.status}`);
    }
    const { username, password } = await res.json();
    const now = Date.now();
    return {
        username,
        password,
        createdAt: now,
        expiresAt: now + CREDENTIAL_TTL_SECONDS * 1000,
    };
}

async function getActiveCredential(env) {
    const now = Date.now();
    const state = (await env.TURN_KV.get(STATE_KEY, 'json')) || {};
    let current = state.current || null;
    let next = state.next || null;
    let changed = false;

    if (next && now - next.createdAt >= ACTIVATION_DELAY_MS) {
        current = next;
        next = null;
        changed = true;
    }
    if (current && current.expiresAt <= now) {
        current = null;
        changed = true;
    }
    if (
        !next &&
        (!current || current.expiresAt - now < ROTATE_BEFORE_EXPIRY_MS)
    ) {
        next = await createCredential(env);
        changed = true;
    }
    if (changed) {
        await env.TURN_KV.put(STATE_KEY, JSON.stringify({ current, next }));
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
            const active = await getActiveCredential(env);
            if (!active) {
                return respond(
                    {
                        error: 'TURN credentials are activating',
                        retryAfterSeconds: ACTIVATION_DELAY_MS / 1000,
                    },
                    503,
                    origin,
                );
            }
            const { username, password } = active;
            return respond(
                TURN_URLS.map((urls) => ({
                    urls,
                    username,
                    credential: password,
                })),
                200,
                origin,
            );
        } catch (e) {
            console.error(e);
            return respond({ error: 'TURN provider error' }, 502, origin);
        }
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(getActiveCredential(env));
    },
};
