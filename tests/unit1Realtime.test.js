const test = require('node:test');
const assert = require('node:assert/strict');
const { publishUnit1Change } = require('../services/unit1Realtime');

test('Unit 1 changes reach the authenticated production room with a resource name', () => {
  const events = [];
  const req = { app: { get: () => ({ to: room => ({ emit: (name, payload) => events.push({ room, name, payload }) }) }) } };
  publishUnit1Change(req, 'machines', { machineId: 7, action: 'updated' });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.room), ['unit1:production', 'unit1:production']);
  assert.deepEqual(events.map(event => event.name), ['unit1:data:changed', 'unit1:production:changed']);
  assert.equal(events[0].payload.resource, 'machines');
  assert.equal(events[0].payload.machineId, 7);
  assert.ok(!Number.isNaN(Date.parse(events[0].payload.at)));
});

test('settings changes use the shared event without a production legacy event', () => {
  const events = [];
  const req = { app: { get: () => ({ to: () => ({ emit: name => events.push(name) }) }) } };
  publishUnit1Change(req, 'materials', { action: 'updated' });
  assert.deepEqual(events, ['unit1:data:changed']);
});
