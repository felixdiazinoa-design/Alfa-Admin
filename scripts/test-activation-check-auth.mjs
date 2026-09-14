import assert from 'node:assert/strict';

process.env.CLOUD_ADMIN_PROVISION_TOKEN = 'test-activation-token-32-characters';

const { default: handler } = await import('../api/activations/check.ts');

function makeRequest(authorization, body = {}) {
    return {
        method: 'POST',
        headers: authorization ? { authorization } : {},
        body,
    };
}

function makeResponse() {
    return {
        statusCode: 0,
        headers: new Map(),
        payload: null,
        setHeader(name, value) {
            this.headers.set(name, value);
        },
        end(body) {
            this.payload = JSON.parse(body);
        },
    };
}

for (const authorization of [undefined, 'Bearer incorrect-token']) {
    const response = makeResponse(authorization);
    await handler(makeRequest(authorization), response);
    assert.equal(response.statusCode, 401);
    assert.equal(response.payload.code, 'UNAUTHORIZED');
}

const authorizedResponse = makeResponse();
await handler(makeRequest(`Bearer ${process.env.CLOUD_ADMIN_PROVISION_TOKEN}`), authorizedResponse);
assert.equal(authorizedResponse.statusCode, 400);
assert.equal(authorizedResponse.payload.code, 'VALIDATION_ERROR');

console.log('activation check authentication regression: ok');
