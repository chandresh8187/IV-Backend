const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture({ rows = [{ token: 'android-token' }], configured = true, responses = [{ success: true }] } = {}) {
  const routes = {}, queries = [], sent = [], removed = [];
  let protectedRoutes = false;
  const router = { use: () => { protectedRoutes = true; }, get: (p, handler) => { routes[`GET ${p}`] = handler; }, post: (p, handler) => { routes[`POST ${p}`] = handler; }, delete: () => {} };
  const db = { execute: async (sql, params) => { queries.push({ sql, params: Array.from(params) }); return [rows]; }, query: async (sql, params) => { removed.push({ sql, params: Array.from(params) }); } };
  const firebase = { configured: () => configured, messaging: () => ({ sendEachForMulticast: async payload => { sent.push(payload); return { responses, successCount: responses.filter(r => r.success).length, failureCount: responses.filter(r => !r.success).length }; } }) };
  const dependencies = { express: { Router: () => router }, '../config/unit1Db': db, '../middleware/unit1AuthMiddleware': () => {}, '../config/unit1FirebaseAdmin': firebase };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../routes/unit1NotificationRoutes.js'), 'utf8'), { require: name => dependencies[name], module: { exports: {} } });
  async function request(route, body) {
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; } };
    await routes[route]({ user: { id: 42 }, body }, res, error => { throw error; });
    return res;
  }
  return { queries, sent, removed, request, protectedRoutes };
}

test('device listing is authenticated, Android-only and never selects FCM tokens', async () => {
  const f = fixture({ rows: [{ id: 8, installationId: 'unit1_installation_123', updatedAt: '2026-10-17' }] });
  const res = await f.request('GET /devices');
  assert.equal(f.protectedRoutes, true);
  assert.match(f.queries[0].sql, /user_id=\? AND device_type='android'/);
  assert.doesNotMatch(f.queries[0].sql.split(' FROM ')[0], /fcm_token/);
  assert.deepEqual(f.queries[0].params, [42]);
  assert.equal(res.body.data.devices[0].id, 8);
});

test('selected Android send is scoped to the current account and uses the app channel', async () => {
  const f = fixture();
  const res = await f.request('POST /test', { deviceType: 'android', deviceId: 8, title: ' Test ', body: ' Hello ' });
  assert.deepEqual(f.queries[0].params, [42, 'android', 8]);
  assert.match(f.queries[0].sql, /user_id=\? AND device_type=\? AND id=\?/);
  assert.deepEqual(Array.from(f.sent[0].tokens), ['android-token']);
  assert.equal(f.sent[0].notification.title, 'Test');
  assert.equal(f.sent[0].android.notification.channelId, 'unit1_production_alerts');
  assert.deepEqual(res.body.data, { sent: 1, failed: 0 });
});

test('rejects invalid input before querying or sending', async () => {
  for (const body of [{ deviceType: 'web' }, { deviceType: 'android', deviceId: -1 }, { deviceType: 'android', deviceId: '8' }, { deviceId: 8 }, { title: ' ' }, { body: 'a'.repeat(501) }]) {
    const f = fixture();
    assert.equal((await f.request('POST /test', body)).statusCode, 400);
    assert.equal(f.queries.length, 0);
    assert.equal(f.sent.length, 0);
  }
});

test('does not send when a device is absent, belongs to another user, or sender is unavailable', async () => {
  const missing = fixture({ rows: [] });
  assert.equal((await missing.request('POST /test', { deviceType: 'android', deviceId: 999 })).statusCode, 409);
  assert.deepEqual(missing.queries[0].params, [42, 'android', 999]);
  assert.equal(missing.sent.length, 0);
  const unconfigured = fixture({ configured: false });
  assert.equal((await unconfigured.request('POST /test', { deviceType: 'android' })).statusCode, 503);
  assert.equal(unconfigured.sent.length, 0);
});

test('preserves mobile default send and removes only invalid recipient registrations', async () => {
  const f = fixture({ responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }] });
  const res = await f.request('POST /test');
  assert.deepEqual(f.queries[0].params, [42]);
  assert.equal(f.sent[0].notification.title, 'Unit 1 notifications ready');
  assert.deepEqual(res.body.data, { sent: 0, failed: 1 });
  assert.deepEqual(f.removed[0].params, ['android-token']);
});
