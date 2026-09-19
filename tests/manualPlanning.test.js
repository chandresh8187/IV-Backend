const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { normalizePlanningChallan, formatPlanningChallan } = require('../services/planningChallanService');
const { validateMigrationSql } = require('../scripts/migrationSafety');

test('in-house numbering uses financial year; external references are unchanged', () => {
  assert.equal(formatPlanningChallan(normalizePlanningChallan({ challan_number: '007' }), '2026-27'), 'DC/2026-27/007');
  assert.equal(formatPlanningChallan(normalizePlanningChallan({ planning_source: 'other_party', challan_number: ' AB/2025-26/007-X ' }), '2026-27'), 'AB/2025-26/007-X');
  for (const suffix of ['123-1', '123-2', 'AB/7', '123_A', '123.1', 'ABC#7']) {
    assert.equal(formatPlanningChallan(normalizePlanningChallan({ challan_number: suffix }), '2026-27'), 'DC/2026-27/' + suffix);
  }
  for (const suffix of ['', ' ', 'a'.repeat(41), '123\n1']) assert.throws(() => normalizePlanningChallan({ challan_number: suffix }));
  assert.throws(() => normalizePlanningChallan({ planning_source: 'unknown', challan_number: '7' }));
  assert.throws(() => normalizePlanningChallan({ planning_source: 'other_party', challan_number: ' ' }));
});
test('source migration is one additive statement and defaults existing items to in-house', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/versioned/20260919000100_add_planning_source.sql'), 'utf8');
  assert.doesNotThrow(() => validateMigrationSql(sql));
  assert.match(sql, /DEFAULT 'in_house'/);
});

function fixture() {
  const calls = [];
  const query = async (sql, params = []) => {
    assert.equal((sql.match(/\?/g) || []).length, params.length, sql);
    calls.push({ sql, params });
    if (sql.includes('SELECT * FROM production_planning')) return [[{ id: 7, financial_year_id: 1 }]];
    if (sql.includes('FROM items WHERE')) return [[{ id: 2, item_name: 'MS W BEAM' }]];
    if (sql.includes('FROM financial_years')) return [[{ id: 1, financial_year: '2025-26' }]];
    if (sql.includes('UNION ALL')) return [[]];
    if (sql.includes('FROM production_entries')) return [[{ planning_item_id: 8, completed_qty: 40 }]];
    if (sql.includes('FROM production_planning_items')) return [[{ id: 8, planning_id: 7, item_id: 2, challan_no: 'DC/2025-26/7', completed_qty: 40, planned_qty: 100 }]];
    if (sql.includes('SELECT pp.id')) return [[{ planning_item_id: 8 }, { planning_item_id: 9 }]];
    return [{ insertId: 7, affectedRows: 1 }];
  };
  const conn = { query, beginTransaction: async () => {}, commit: async () => calls.push('commit'), rollback: async () => calls.push('rollback'), release() {} };
  const filename = path.join(__dirname, '../controllers/productionPlanningController.js');
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, require: name => {
    if (name === '../config/db') return { query, getConnection: async () => conn };
    if (name === '../services/financialYearService') return { getConfiguredCurrentFinancialYear: async () => ({ id: 1, financial_year: '2026-27' }) };
    if (name === '../utils/checkEntryZincNotification') return { checkPlanningZincNotification: async () => {} };
    return realRequire(name);
  } });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const req = { body: { financial_year_id: 1, items: [{ planning_source: 'other_party', challan_number: 'EXT/7-A', party_name: 'Party', item_id: 2, material_detail: '1.7mm', planned_qty: 100, target_zinc_percentage: 6.5 }] }, params: { id: 7 }, user: { id: 1 }, app: { get: () => ({ emit() {} }) } };
  return { controller: module.exports, req, res, calls };
}
test('creating other-party planning saves exact reference, source, material and year', async () => {
  const f = fixture(); await f.controller.createProductionPlanning(f.req, f.res);
  assert.equal(f.res.statusCode, 201);
  const insert = f.calls.find(call => call.sql?.includes('INSERT INTO production_planning_items'));
  assert.equal(insert.params[1], 'EXT/7-A');
  assert.equal(insert.params[5], 'MS W BEAM 1.7mm');
  assert.equal(insert.params[9], 'other_party');
});
test('creating in-house planning adds current-year prefix', async () => {
  const f = fixture(); Object.assign(f.req.body.items[0], { planning_source: 'in_house', challan_number: '123' });
  await f.controller.createProductionPlanning(f.req, f.res);
  assert.equal(f.res.statusCode, 201); assert.equal(f.res.body.data.challan_no, 'DC/2026-27/123');
});
test('editing linked planning preserves item ID, production progress and synchronizes entries', async () => {
  const f = fixture(); f.req.body.items[0].id = 8;
  await f.controller.updateProductionPlanning(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  const update = f.calls.find(call => call.sql?.includes('SET challan_no = ?'));
  assert.equal(update.params[0], 'EXT/7-A'); assert.equal(update.params[6], 'other_party');
  assert.equal(update.params[7], 40); assert.equal(update.params[12], 8);
  assert.ok(f.calls.some(call => call.sql?.includes('UPDATE production_entries pe')));
  assert.ok(!f.calls.some(call => call.sql?.includes('DELETE FROM')));
});
test('editing in-house planning keeps its linked financial year', async () => {
  const f = fixture(); Object.assign(f.req.body.items[0], { id: 8, planning_source: 'in_house', challan_number: '7' });
  await f.controller.updateProductionPlanning(f.req, f.res);
  assert.equal(f.res.body.data.challan_no, 'DC/2025-26/7');
});
test('planned quantity cannot fall below existing completed quantity', async () => {
  const f = fixture(); Object.assign(f.req.body.items[0], { id: 8, planned_qty: 20 });
  await f.controller.updateProductionPlanning(f.req, f.res);
  assert.equal(f.res.statusCode, 409); assert.ok(f.calls.includes('rollback'));
});
test('dropdown returns all pending challans, not a single auto-assigned flow', async () => {
  const f = fixture(); await f.controller.getAvailablePlanningDropdown(f.req, f.res);
  assert.equal(f.res.body.data.length, 2);
  assert.match(f.calls[0].sql, /ppi.planned_qty > ppi.completed_qty/);
  assert.doesNotMatch(f.calls[0].sql, /LIMIT 1/);
});
