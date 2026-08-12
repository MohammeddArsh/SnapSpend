import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callChatCompletion } from '../eval/lib/openrouter.mjs';

const okResponse = (body) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
});

const errorResponse = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

test('retries transient 429s with backoff and returns the content', async () => {
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
        calls++;
        if (calls < 3) return errorResponse(429, 'Rate limit exceeded: free-models-per-min');
        return okResponse({ choices: [{ message: { content: '{"ok":1}' } }], usage: {} });
    };
    try {
        const out = await callChatCompletion({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }], baseDelayMs: 1 });
        assert.equal(calls, 3);
        assert.equal(out.content, '{"ok":1}');
    } finally {
        global.fetch = originalFetch;
    }
});

test('fails fast on the daily free quota (no pointless retries)', async () => {
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
        calls++;
        return errorResponse(429, 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day.');
    };
    try {
        await assert.rejects(
            callChatCompletion({ apiKey: 'k', model: 'm', messages: [], baseDelayMs: 1 }),
            (err) => {
                assert.equal(err.dailyQuota, true);
                assert.equal(err.status, 429);
                assert.match(err.message, /daily free quota exhausted/i);
                return true;
            }
        );
        assert.equal(calls, 1);
    } finally {
        global.fetch = originalFetch;
    }
});

test('honors the Retry-After header instead of the default backoff', async () => {
    let calls = 0;
    const originalFetch = global.fetch;
    const started = Date.now();
    global.fetch = async () => {
        calls++;
        if (calls === 1) return errorResponse(429, 'slow down', { 'Retry-After': '1' });
        return okResponse({ choices: [{ message: { content: '{"ok":1}' } }], usage: {} });
    };
    try {
        const out = await callChatCompletion({ apiKey: 'k', model: 'm', messages: [], baseDelayMs: 1 });
        assert.equal(calls, 2);
        assert.ok(Date.now() - started >= 900, `expected ~1s wait, got ${Date.now() - started}ms`);
        assert.equal(out.content, '{"ok":1}');
    } finally {
        global.fetch = originalFetch;
    }
});

test('treats HTTP 200 with an error body as an API error', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => okResponse({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-day. Add 10 credits.' } });
    try {
        await assert.rejects(
            callChatCompletion({ apiKey: 'k', model: 'm', messages: [], baseDelayMs: 1 }),
            (err) => err.dailyQuota === true && err.status === 429
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test('downgrades JSON mode when the model rejects response_format', async () => {
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
        calls++;
        if (calls === 1) return errorResponse(400, 'response_format is not supported');
        return okResponse({ choices: [{ message: { content: '{"ok":1}' } }], usage: {} });
    };
    try {
        const out = await callChatCompletion({ apiKey: 'k', model: 'm', messages: [], baseDelayMs: 1 });
        assert.equal(calls, 2);
        assert.equal(out.content, '{"ok":1}');
    } finally {
        global.fetch = originalFetch;
    }
});

test('gives up after maxRetries and surfaces the last status', async () => {
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
        calls++;
        return errorResponse(503, 'unavailable');
    };
    try {
        await assert.rejects(
            callChatCompletion({ apiKey: 'k', model: 'm', messages: [], maxRetries: 2, baseDelayMs: 1 }),
            (err) => err.status === 503 && /HTTP 503/.test(err.message)
        );
        assert.equal(calls, 3); // initial + 2 retries
    } finally {
        global.fetch = originalFetch;
    }
});

const congestionBody = {
    error: {
        message: 'Provider returned error',
        code: 429,
        metadata: {
            raw: 'google/gemma-4-31b-it:free is temporarily rate-limited upstream. Please retry shortly.',
            limit_source: 'upstream_provider_shared_pool',
        },
    },
};

test('flags upstream shared-pool congestion with a clear error once retries are exhausted', async () => {
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
        calls++;
        return errorResponse(429, congestionBody);
    };
    try {
        await assert.rejects(
            callChatCompletion({ apiKey: 'k', model: 'google/gemma-4-31b-it:free', messages: [], maxRetries: 1, baseDelayMs: 1 }),
            (err) => {
                assert.equal(err.upstreamCongestion, true);
                assert.equal(err.status, 429);
                assert.match(err.message, /congested/i);
                assert.match(err.message, /google\/gemma-4-31b-it:free/);
                assert.doesNotMatch(err.message, /daily free quota/i);
                return true;
            }
        );
        assert.equal(calls, 2); // initial + 1 retry, then fails cleanly
    } finally {
        global.fetch = originalFetch;
    }
});

test('recovers from transient congestion after retries', async () => {
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
        calls++;
        if (calls < 3) return errorResponse(429, congestionBody);
        return okResponse({ choices: [{ message: { content: '{"ok":1}' } }], usage: {} });
    };
    try {
        const out = await callChatCompletion({ apiKey: 'k', model: 'm', messages: [], baseDelayMs: 1 });
        assert.equal(calls, 3);
        assert.equal(out.content, '{"ok":1}');
    } finally {
        global.fetch = originalFetch;
    }
});

test('coerces string error codes in 200-with-error bodies', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => okResponse({ error: { code: '429', message: 'Rate limit exceeded: free-models-per-day. Add 10 credits.' } });
    try {
        await assert.rejects(
            callChatCompletion({ apiKey: 'k', model: 'm', messages: [], baseDelayMs: 1 }),
            (err) => err.dailyQuota === true && err.status === 429
        );
    } finally {
        global.fetch = originalFetch;
    }
});
