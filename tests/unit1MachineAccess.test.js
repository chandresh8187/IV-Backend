const test = require('node:test');
const assert = require('node:assert/strict');
const { hasPermission, getUserAccess } = require('../services/permissionService');
const management = ['unit1.jobcards.assign', 'unit1.jobcards.unassign', 'unit1.production.coil.assign', 'unit1.production.coil.remove', 'unit1.production.operate'];
const queryable = allowed => ({ query: async () => [[...management, 'unit1.production.bundle', 'unit1.production.supervise'].map(permission_key => ({ permission_key, allowed }))] });

test('supervisors check material and record bundles; labour is read-only despite contradictory overrides', async () => {
  for (const role of ['supervisor', 'labour']) {
    for (const permissionKey of management) assert.equal(await hasPermission({ userId: 1, role, permissionKey, queryable: queryable(true) }), role==='supervisor'&&permissionKey==='unit1.production.coil.assign', `${role}: ${permissionKey}`);
    assert.equal(await hasPermission({ userId: 1, role, permissionKey: 'unit1.production.bundle', queryable: queryable(true) }), role === 'supervisor');
    assert.equal(await hasPermission({ userId: 1, role, permissionKey: 'unit1.production.supervise', queryable: queryable(true) }), role === 'supervisor');
  }
});
test('plant managers and superadmins retain all machine controls', async () => {
  for (const role of ['plant_manager', 'superadmin']) {
    for (const permissionKey of [...management, 'unit1.production.bundle', 'unit1.production.supervise', 'unit1.coils.view']) assert.equal(await hasPermission({ userId: 1, role, permissionKey, queryable: queryable(false) }), true, `${role}: ${permissionKey}`);
  }
});
test('login permission lists match API access for fixed machine responsibilities', async () => {
  for (const role of ['supervisor', 'labour', 'plant_manager']) {
    const { allowedKeys } = await getUserAccess({ userId: 1, role, scope: 'unit1', queryable: queryable(true) });
    for (const permissionKey of [...management, 'unit1.production.bundle', 'unit1.production.supervise']) assert.equal(allowedKeys.includes(permissionKey), await hasPermission({ userId: 1, role, permissionKey, queryable: queryable(true) }));
  }
});
test('unrelated unit permissions still respect overrides', async () => {
  for (const allowed of [true, false]) {
    const db = { query: async () => [[{ allowed }]] };
    assert.equal(await hasPermission({ userId: 1, role: 'supervisor', permissionKey: 'unit1.materials.manage', queryable: db }), allowed);
  }
});
