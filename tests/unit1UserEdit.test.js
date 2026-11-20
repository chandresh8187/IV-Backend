const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture(role = 'labour', assignedMachineId = 12) {
  const filename = path.join(__dirname, '../routes/unit1UserRoutes.js');
  const localRequire = createRequire(filename);
  const user = { id: 7, name: 'Existing user', email: 'old@example.com', role, assignedMachineId };
  const updates = [], events = [];
  const db = { execute: async (sql, params) => {
    if (sql.startsWith('SELECT')) return [[{ ...user }]];
    updates.push({ sql, params });
    // Model a host where the prepared string-vs-literal comparison is rejected.
    if (typeof params[4] !== 'number') throw new Error('Illegal mix of collations');
    Object.assign(user, { name: params[0], email: params[1], role: params[2], assignedShift: params[3], assignedMachineId: params[4] ? user.assignedMachineId : null });
    return [{ affectedRows: 1 }];
  } };
  const mocks = {
    '../config/unit1Db': db,
    '../middleware/unit1AuthMiddleware': (_req, _res, next) => next(),
    '../middleware/roleMiddleware': () => (_req, _res, next) => next(),
    '../services/unit1Realtime': { publishUnit1Change: (_req, resource, detail) => events.push({ resource, ...detail }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => mocks[name] || localRequire(name) }, { filename });
  const handler = module.exports.stack.find(layer => layer.route?.path === '/:id' && layer.route.methods.put).route.stack.at(-1).handle;
  const save = async body => {
    let error;
    const res = { status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ params: { id: '7' }, body }, res, value => { error = value; });
    if (error) throw error;
    return res.body.data;
  };
  return { save, updates, events };
}

test('editing an existing labour user preserves machine assignment without a string SQL condition', async () => {
  const f = fixture();
  const user = await f.save({ name: 'Updated user', email: 'new@example.com', role: 'labour' });
  assert.equal(user.assignedMachineId, 12);
  assert.equal(user.name, 'Updated user');
  assert.equal(f.updates.length, 1);
  assert.match(f.updates[0].sql, /assigned_machine_id=IF\(\?,assigned_machine_id,NULL\)/);
  assert.equal(f.updates[0].params[4], 1);
  assert.deepEqual(f.events, [{ resource: 'users', userId: 7, action: 'updated' }]);
});

test('changing a labour user to another role clears machine assignment in the same update', async () => {
  for (const role of ['supervisor', 'production_manager', 'plant_manager', 'admin']) {
    const f = fixture();
    const user = await f.save({ name: 'Updated user', email: 'new@example.com', role, assignedShift: 'day' });
    assert.equal(user.assignedMachineId, null);
    assert.equal(user.assignedShift, role === 'supervisor' ? 'Day' : null);
    assert.equal(f.updates.length, 1);
    assert.equal(f.updates[0].params[4], 0);
  }
});

test('protected users and invalid edits do not write or publish refresh events', async () => {
  for (const [role, body, status] of [
    ['superadmin', { name: 'New name', email: 'new@example.com', role: 'labour' }, 403],
    ['labour', { name: 'New name', email: 'new@example.com', role: 'invalid' }, 400],
  ]) {
    const f = fixture(role);
    await assert.rejects(f.save(body), { status });
    assert.equal(f.updates.length, 0);
    assert.equal(f.events.length, 0);
  }
});
