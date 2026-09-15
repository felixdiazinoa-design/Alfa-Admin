import assert from 'node:assert/strict';

process.env.CLOUD_ADMIN_PROVISION_TOKEN = 'test-provision-token-32-characters';

const { default: handler } = await import('../api/activation/provision-tenant.ts');

function makeRequest(authorization) {
    return {
        method: 'POST',
        headers: authorization ? { authorization } : {},
        body: {},
        socket: { remoteAddress: '127.0.0.1' },
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
    const response = makeResponse();
    await handler(makeRequest(authorization), response);
    assert.equal(response.statusCode, 401);
    assert.equal(response.payload.code, 'UNAUTHORIZED');
}

const previousToken = process.env.CLOUD_ADMIN_PROVISION_TOKEN;
delete process.env.CLOUD_ADMIN_PROVISION_TOKEN;
const unconfiguredResponse = makeResponse();
await handler(makeRequest('Bearer any-token'), unconfiguredResponse);
assert.equal(unconfiguredResponse.statusCode, 503);
assert.equal(unconfiguredResponse.payload.code, 'PROVISIONING_AUTH_NOT_CONFIGURED');
process.env.CLOUD_ADMIN_PROVISION_TOKEN = previousToken;

const authorizedResponse = makeResponse();
await handler(makeRequest(`Bearer ${previousToken}`), authorizedResponse);
assert.equal(authorizedResponse.statusCode, 400);
assert.equal(authorizedResponse.payload.code, 'VALIDATION_ERROR');

console.log('provision tenant service authentication regression: ok');
