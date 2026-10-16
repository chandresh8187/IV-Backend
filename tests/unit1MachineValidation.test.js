const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMachine } = require('../services/unit1MachineValidation');

test('new machine normalizes its stable code and optional description', () => {
  assert.deepEqual(normalizeMachine({ code: ' machine-01 ', name: ' Roll Former ', description: '' }, { creating: true }).value, {
    code: 'MACHINE-01', name: 'Roll Former', description: null, isActive: true,
  });
});

test('machine code and name are validated', () => {
  assert.match(normalizeMachine({ code: 'bad code', name: 'Machine' }, { creating: true }).error, /Machine code/);
  assert.match(normalizeMachine({ code: 'M-01', name: '' }, { creating: true }).error, /Machine name/);
});

test('editing a machine preserves status when it is omitted', () => {
  assert.equal(normalizeMachine({ name: 'Updated' }).value.isActive, undefined);
  assert.equal(normalizeMachine({ name: 'Updated', isActive: false }).value.isActive, false);
});
