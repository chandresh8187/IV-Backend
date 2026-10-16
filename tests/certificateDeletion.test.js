const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fixture = () => {
  const queries = [];
  const events = [];
  const db = { query: async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('UPDATE coating_certificates SET deleted_at')) return [{ affectedRows: 2 }];
    if (sql.includes('SELECT tc_no') && sql.includes('FROM coating_certificates')) return [[{ tc_no: 'IVS-HDGI-2026-27-007' }]];
    if (sql.includes('SELECT * FROM production_planning')) return [[{ id: 3, challan_no: 'C-3', party_name: 'Client', planned_qty: 2 }]];
    if (sql.includes('INSERT INTO coating_certificates')) return [{ insertId: 18 }];
    if (sql.includes('FROM coating_certificates cc')) return [[]];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const module = { exports: {} };
  const filename = path.join(__dirname, '../controllers/productionCertificateController.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: name => name === '../config/db' ? db : require(name), console, Date, Number, String, Set,
  });
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const app = { get: () => ({ emit: (...args) => events.push(args) }) };
  return { controller: module.exports, queries, events, response, app };
};

test('bulk deletion hides certificates without removing issued TC numbers', async () => {
  const f = fixture();
  const res = f.response();
  await f.controller.deleteCertificates({ body: { ids: [17, 18] }, params: {}, app: f.app }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.data.deleted_count, 2);
  const update = f.queries.find(item => item.sql.includes('UPDATE coating_certificates'));
  assert.match(update.sql, /SET deleted_at = NOW\(\)/);
  assert.deepEqual(Array.from(update.params), [17, 18]);
  assert.equal(f.events[0][0], 'certificate_updated');

  await f.controller.getCertificates({ query: {} }, f.response());
  assert.match(f.queries.at(-1).sql, /cc\.deleted_at IS NULL/);
});

test('next TC number advances past a deleted certificate', async () => {
  const f = fixture();
  const res = f.response();
  await f.controller.createCertificate({
    body: { planning_id: 3, inspection_date: '2026-10-10', reference_standard: 'IS 4759', coating_readings: [] },
    user: { id: 4 }, app: f.app,
  }, res);
  assert.equal(res.code, 201, JSON.stringify({ body: res.body, queries: f.queries.map(item => item.sql) }));
  assert.equal(res.body.data.tc_no, 'IVS-HDGI-2026-27-008');
  const sequenceQuery = f.queries.find(item => item.sql.includes('SELECT tc_no'));
  assert.doesNotMatch(sequenceQuery.sql, /deleted_at IS NULL/);
});
