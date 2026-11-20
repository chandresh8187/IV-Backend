const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
function load(file, mocks) {
  const filename = path.join(__dirname, '..', file);
  const module = { exports: {} };
  const real = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => name in mocks ? mocks[name] : real(name) });
  return module.exports;
}
function fixture({ exists = true, override = null } = {}) {
  const writes = [], events = [];
  let stored = null;
  const db = { query: async (sql, params) => {
    if (sql.includes('user_permission_overrides')) return [override == null ? [] : [{ allowed: override }]];
    if (sql.startsWith('SELECT c.id')) return [[stored]];
    if (sql.startsWith('UPDATE chemical_checks')) stored = { id: params[7], inspection_date: params[0], flux_ph: params[1], flux_density: params[2], flux_temperature_c: params[3], acid_ph: params[4], acid_density: params[5], note: params[6], checked_by_name: 'Original checker' };
    if (sql.startsWith('SELECT id')) return [exists ? [{ id: 8 }] : []];
    writes.push({ sql, params }); return [{ affectedRows: 1, insertId: 9 }];
  } };
  const permissions = load('services/permissionService.js', { '../config/db': db });
  const access = load('middleware/roleMiddleware.js', { '../services/permissionService': permissions });
  const controller = load('controllers/chemicalChecksController.js', { '../config/db': db, '../services/pdf/chemicalChecksPdfGenerator': {} });
  const routes = [];
  const router = Object.fromEntries(['use', 'get', 'post', 'put'].map(method => [method, (...args) => routes.push({ method, args })]));
  load('routes/chemicalChecksRoutes.js', { express: { Router: () => router }, '../middleware/authMiddleware': () => {}, '../middleware/roleMiddleware': access, '../controllers/chemicalChecksController': controller });
  const route = routes.find(row => row.method === 'put');
  assert.equal(route.args[0], '/:id');
  const body = { inspection_date: '2026-10-18', flux_ph: 4.5, flux_density: 1.3, flux_temperature_c: 68, acid_ph: -1.2, acid_density: 1.835, note: 'Corrected readings' };
  async function update(role = 'superadmin', changes = {}, id = '8') {
    const req = { user: { id: 3, role }, params: { id }, body: { ...body, ...changes }, app: { get: () => ({ emit: (...args) => events.push(args) }) } };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await route.args[1](req, res, async error => { if (error) throw error; await route.args[2](req, res); });
    return res;
  }
  return { update, writes, events, controller, body };
}
test('superadmin edits chemical readings while preserving original checker and timestamp', async () => {
  const f = fixture(); const res = await f.update();
  assert.equal(res.code, 200);
  assert.equal(f.writes.length, 1);
  assert.match(f.writes[0].sql, /UPDATE chemical_checks/);
  assert.doesNotMatch(f.writes[0].sql, /checked_by_user_id|created_at/);
  assert.deepEqual(Array.from(f.writes[0].params), ['2026-10-18',4.5,1.3,68,-1.2,1.835,'Corrected readings',8]);
  assert.equal(f.events[0][0], 'chemical_checks_updated');
  assert.equal(res.body.data.id, 8);
  assert.equal(res.body.data.flux_ph, 4.5);
  assert.equal(res.body.data.acid_ph, -1.2);
  assert.equal(res.body.data.checked_by_name, 'Original checker');
});
test('record permission does not give edit permission to supervisors or plant managers', async () => {
  for (const role of ['supervisor', 'plant_manager', 'admin']) {
    const f = fixture(); assert.equal((await f.update(role)).code, 403); assert.equal(f.writes.length, 0);
  }
});
test('explicit edit permission allows another user, and revocation blocks editing', async () => {
  assert.equal((await fixture({ override: 1 }).update('supervisor')).code, 200);
  assert.equal((await fixture({ override: 0 }).update('supervisor')).code, 403);
});
test('invalid readings and IDs never update chemical entries', async () => {
  for (const changes of [{ acid_ph: 'abc' }, { flux_ph: '1e2' }, { flux_density: '1.2.3' }, { acid_density: '' }, { flux_temperature_c: Infinity }, { flux_ph: true }, { inspection_date: '2026-02-30' }, { note: 'a'.repeat(256) }]) {
    const f = fixture(); assert.equal((await f.update('superadmin', changes)).code, 400); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); assert.equal((await f.update('superadmin', {}, 'bad')).code, 400); assert.equal(f.writes.length, 0);
});
test('missing chemical entry returns 404 without creating an entry', async () => {
  const f = fixture({ exists: false }); assert.equal((await f.update()).code, 404); assert.equal(f.writes.length, 0);
});

test('all chemical fields accept signed decimal readings outside former ranges on create and edit', async () => {
  const values = { flux_ph: '-25.12345', acid_ph: '+18.5', flux_density: '-.75', acid_density: '0', flux_temperature_c: '+250.12345' };
  const f = fixture(); assert.equal((await f.update('superadmin', values)).code, 200);
  assert.deepEqual(Array.from(f.writes[0].params.slice(1,6)), [-25.12345,-0.75,250.12345,18.5,0]);
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await f.controller.createChemicalCheck({ body: { ...f.body, ...values }, user: { id: 3 }, app: { get: () => null } }, res);
  assert.equal(res.code, 201);
  assert.match(f.writes[1].sql, /INSERT INTO chemical_checks/);
});
