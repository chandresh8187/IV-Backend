const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');

test('Unit 1 clean SQL imports, matches migrations, and supports the complete coil workflow', { skip: process.env.UNIT1_DB_INTEGRATION !== '1' }, async () => {
  require('dotenv-flow').config({ silent: true });
  const db = require('../config/unit1Db');
  const connection = await db.getConnection();
  const scratch = `codex_unit1_import_${randomBytes(6).toString('hex')}`;
  let created = false;
  const executor = {
    query: connection.query.bind(connection), execute: connection.execute.bind(connection),
    getConnection: async () => ({
      query: connection.query.bind(connection), execute: connection.execute.bind(connection),
      beginTransaction: connection.beginTransaction.bind(connection),
      commit: connection.commit.bind(connection), rollback: connection.rollback.bind(connection), release() {},
    }),
  };
  const cache = new Map();
  const shift = require('../services/unit1ShiftService');
  function load(relative) {
    const filename = path.resolve(__dirname, '..', relative);
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    const realRequire = createRequire(filename);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, console, process,
      require: name => {
        if (name === '../config/unit1Db') return executor;
        if (name === '../services/unit1ShiftService') return { ...shift, getSchedule: () => shift.getSchedule(executor) };
        if (name === './unit1JobCardRoutes') return load('routes/unit1JobCardRoutes.js');
        return realRequire(name);
      },
    }, { filename });
    cache.set(filename, module.exports);
    return module.exports;
  }
  async function call(router, method, route, options = {}, expectedStatus = 200) {
    const layer = router.stack.find(item => item.route?.path === route && item.route.methods[method]);
    assert.ok(layer, `${method} ${route} exists`);
    const req = { params: {}, query: {}, body: {}, user: { id: 1, role: 'superadmin' }, app: { get: () => null }, ...options };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    let failure;
    await layer.route.stack.at(-1).handle(req, res, error => { failure = error; });
    if (failure) throw failure;
    assert.equal(res.statusCode, expectedStatus, JSON.stringify(res.body));
    return res.body;
  }
  async function definitions() {
    const [tables] = await connection.query('SHOW TABLES');
    const result = {};
    for (const row of tables) {
      const name = Object.values(row)[0];
      const [[ddl]] = await connection.query(`SHOW CREATE TABLE \`${name}\``);
      result[name] = ddl['Create Table'].replace(/\sAUTO_INCREMENT=\d+/g, '');
    }
    return result;
  }
  try {
    await connection.query(`CREATE DATABASE \`${scratch}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    const sql = fs.readFileSync(path.join(__dirname, '../database/u436685010_iv1_app_clean_install.sql'), 'utf8');
    assert.ok(!/DROP\s+(TABLE|DATABASE)/i.test(sql));
    const statements = sql.replace(/^--.*$/gm, '').replace('USE `u436685010_iv1_app`', `USE \`${scratch}\``).split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean);
    for (const statement of statements) await connection.query(statement);
    const initial = await definitions();
    assert.equal(Object.keys(initial).length, 17);
    for (const [table, expected] of [['unit1_material_densities', 4], ['unit1_material_grades', 5], ['unit1_shift_settings', 1], ['users', 1], ['coils', 0], ['unit1_fcm_tokens', 0]]) {
      const [[row]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
      assert.equal(Number(row.count), expected, table);
    }
    await load('scripts/migrateUnit1Coils.js').migrateUnit1Coils();
    assert.deepEqual(await definitions(), initial, 'Startup migration does not need to repair the clean schema');

    const [[bootstrap]] = await connection.execute('SELECT email,password,role,status FROM users');
    assert.equal(bootstrap.email, 'dev@iv.com');
    assert.equal(bootstrap.role, 'superadmin');
    assert.equal(bootstrap.status, 'active');
    assert.notEqual(bootstrap.password, '12345678');
    assert.ok(await require('bcryptjs').compare('12345678', bootstrap.password));
    const auth = load('routes/unit1AuthRoutes.js');
    const login = await call(auth, 'post', '/login', { body: { email: 'dev@iv.com', password: '12345678' } });
    assert.ok(login.token);
    assert.equal(login.user.scope, 'unit1');
    const materials = await call(load('routes/unit1MaterialGradeRoutes.js'), 'get', '/');
    assert.equal(materials.data.length, 4);
    const qr = await call(load('routes/unit1QrSettingsRoutes.js'), 'get', '/');
    assert.equal(qr.data.roles.length, 6);
    const machines = load('routes/unit1MachineRoutes.js');
    const machine = (await call(machines, 'post', '/', { body: { code: 'TEST1', name: 'Test machine', isActive: true } }, 201)).data;
    const coils = load('routes/unit1CoilRoutes.js');
    const coil = (await call(coils, 'post', '/', { body: { invoice: 'TEST', invoiceDate: '2026-10-16', vendorCode: 'TEST', materialType: 'MS', grade: 'E250', coilQty: 2, widthMm: 100, thicknessMm: 1, totalWeightKg: 2000 } }, 201)).data;
    assert.equal(coil.ratePerKg, null);
    const editInward = { invoice: 'TEST', invoiceDate: '2026-10-16', vendorCode: 'TEST', materialType: 'MS', grade: 'E250', coilQty: 2, widthMm: 100, thicknessMm: 1, totalWeightKg: 2000 };
    const priced = (await call(coils, 'put', '/:id', { params: { id: String(coil.id) }, body: { ...editInward, ratePerKg: '62.75' } })).data;
    assert.equal(Number(priced.ratePerKg), 62.75);
    await call(coils, 'post', '/:id/generate-qr', { params: { id: String(coil.id) } });
    await call(coils, 'get', '/scan/:internalId/:coilNumber', { params: { internalId: coil.internalId, coilNumber: '1' } });
    const jobs = load('routes/unit1JobCardRoutes.js');
    const job = (await call(jobs, 'post', '/', { body: {
      jobDate: '2026-10-16', customerName: 'Test', projectNameCapacity: 'Test', productionQty: 200,
      structureType: 'solar_mounting_structure', memberName: 'Test', sectionSize: '100', shift: 'day', cutLengthMm: 1000,
      plannedMachineId: machine.id, stockCoilId: coil.id, materialType: 'MS', coilWidthMm: 100, coilThicknessMm: 1, punchSize: '10',
      holes: [{ profile: 'web', targetMm: 20 }],
    } }, 201)).data;
    await call(jobs, 'put', '/:id/assign', { params: { id: String(job.id) }, body: { machineId: machine.id } });
    const production = load('routes/unit1ProductionRoutes.js');
    const input = { jobCardId: job.id, coilId: coil.id, coilNumber: 1 };
    await call(production, 'post', '/verify-coil', { body: input });
    const first = (await call(production, 'post', '/runs', { body: input }, 201)).data;
    assert.equal(Number(first.coilRatePerKg), 62.75);
    await call(coils, 'put', '/:id', { params: { id: String(coil.id) }, body: { ...editInward, ratePerKg: '63.00' } }, 409);
    const legacyEdit = (await call(coils, 'put', '/:id', { params: { id: String(coil.id) }, body: editInward })).data;
    assert.equal(Number(legacyEdit.ratePerKg), 62.75);
    const approve = id => call(production, 'post', '/runs/:id/hole-check', { params: { id: String(id) }, body: { approved: true, measurements: job.holes.map(hole => ({ holeId: hole.id, measuredMm: 20 })) } });
    await approve(first.id);
    await call(production, 'post', '/runs/:id/bundles', { params: { id: String(first.id) }, body: { pieces: 100 } });
    const returned = (await call(production, 'post', '/runs/:id/return-coil', { params: { id: String(first.id) } })).data;
    assert.equal(returned.status, 'returned');
    assert.equal(returned.theoreticalRemainingKg, 921.5);
    const available = (await call(production, 'get', '/available-coils')).data;
    assert.equal(available[0].availableQty, 2);
    await call(production, 'post', '/verify-coil', { body: input });
    const second = (await call(production, 'post', '/runs', { body: input }, 201)).data;
    assert.equal(second.status, 'setup');
    assert.equal(second.jobProducedPieces, 100);
    assert.equal(second.theoreticalRemainingKg, 921.5);
    await approve(second.id);
    await call(production, 'post', '/runs/:id/bundles', { params: { id: String(second.id) }, body: { pieces: 100 } });
    await call(production, 'post', '/runs/:id/:action', { params: { id: String(second.id), action: 'complete' } });
    const usage = (await call(coils, 'get', '/:id/usage', { params: { id: String(coil.id) } })).data;
    assert.equal(usage.coils[0].producedPieces, 200);
    assert.equal(usage.coils[0].theoreticalRemainingKg, 843);
    const dates = (await call(production, 'get', '/history/dates')).data;
    const history = (await call(production, 'get', '/history', { query: { date: dates[0].shiftDate } })).data;
    assert.equal(Number(history.summary.pieces), 200);
    assert.ok(history.entries.every(entry => Number(entry.coilRatePerKg) === 62.75));
    await call(production, 'get', '/live');
    await call(production, 'get', '/machines/:machineId/entries', { params: { machineId: String(machine.id) } });
    console.log('Verified 17 tables, system seeds, migration parity, login, settings, inward, QR, job assignment, approval, bundles, return/reinsert, completion, usage and history.');
  } finally {
    await connection.rollback();
    if (created && /^codex_unit1_import_[a-f0-9]{12}$/.test(scratch)) await connection.query(`DROP DATABASE \`${scratch}\``);
    connection.release();
    await db.end();
  }
});
