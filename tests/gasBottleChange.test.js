const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture({ priorPeriod = false } = {}) {
  const filename = path.join(__dirname, '..', 'controllers/gasManagementController.js');
  const module = { exports: {} };
  const realRequire = createRequire(filename);
  const writes = [];
  let pending = false;
  let commits = 0;
  const bottles = [
    { id: 1, status: 'running', position_no: 1, filled_weight_kg: 525, remaining_gas_kg: 425 },
    { id: 2, status: 'ready', position_no: 2, filled_weight_kg: 530, remaining_gas_kg: 425 },
    { id: 3, status: 'filled', position_no: null, remaining_gas_kg: 425 },
  ];
  const run = { id: 10, bottle_id: 1, position_no: 1, started_at: '2026-10-01 10:00:00', start_gas_kg: 425, filled_weight_kg: 525, finished_at: '2026-10-01 11:00:00', production_ton: 1, kg_per_bottle: 425, price_per_bottle: 44625 };
  const earlier = { id: 9, bottle_id: 1, position_no: 1, started_at: '2026-10-01 08:00:00', finished_at: '2026-10-01 09:00:00', production_ton: 2 };
  const query = async (sql, params = []) => {
    assert.equal((sql.match(/\?/g) || []).length, params.length, sql);
    if (sql.startsWith('SELECT * FROM gas_bottles')) return [bottles];
    if (sql.startsWith('SELECT id FROM gas_bottle_runs WHERE finished_at IS NULL')) return [[]];
    if (sql.startsWith('SELECT MAX(finished_at)')) return [[{ last_finished: '2026-10-01 09:00:00' }]];
    if (sql.includes('FROM gas_bottle_runs gr') && sql.includes('gr.finished_at IS NULL')) return [[{ ...run, finished_at: null }]];
    if (sql.includes('FROM gas_bottle_runs gr') && sql.includes('gr.empty_weight_kg IS NULL')) return [pending ? [run] : []];
    if (sql.includes('FROM gas_bottle_runs WHERE bottle_id=')) return [priorPeriod ? [earlier, run] : [run]];
    if (sql.includes('FROM gas_bottle_runs WHERE started_at>=')) return [[{ started_at: '2026-10-01 11:00:00' }]];
    if (sql.includes('FROM production_entries')) return [[{ production_ton: priorPeriod && String(params[0]).includes('08:00:00') ? 2 : 1 }]];
    if (sql.startsWith('UPDATE') || sql.startsWith('INSERT')) {
      writes.push({ sql, params });
      if (sql.startsWith('UPDATE gas_bottles SET status=\'finished\'')) { pending = true; bottles[0].position_no = null; bottles[0].status = 'finished'; }
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unhandled SQL: ${sql}`);
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => { commits++; }, rollback: async () => {}, release() {} };
  const dependencies = {
    '../config/db': { getConnection: async () => connection, query },
    '../services/pdf/gasManagementPdfGenerator': { generateGasManagementPdf: async () => Buffer.alloc(0) },
    '../services/stockAlertService': { checkStockAlerts: async () => {}, GAS_LIMIT_BOTTLES: 4 },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: name => dependencies[name] || realRequire(name), console }, { filename });
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const request = (body, position) => ({ body, params: { position }, user: { id: 7 }, app: { get: () => ({ emit() {} }) } });
  return { controller: module.exports, writes, response, request, getCommits: () => commits };
}

test('gas change defers empty weight and refill calculates usage from the old bottle', async () => {
  const f = fixture();
  const changed = f.response();
  await f.controller.changeBottle(f.request({ bottle_number: 2, changed_at: '2026-10-01 11:00:00' }), changed);
  assert.equal(changed.body.success, true);
  assert.ok(f.writes.some(x => x.sql.includes('UPDATE gas_bottle_runs SET finished_at') && !x.sql.includes('empty_weight_kg')));
  const missing = f.response();
  await f.controller.fillPosition(f.request({ filled_weight_kg: 540 }, 1), missing);
  assert.equal(missing.statusCode, 400);
  const placed = f.response();
  await f.controller.fillPosition(f.request({ filled_weight_kg: 540, empty_weight_kg: 125 }, 1), placed);
  assert.equal(placed.body.success, true);
  const usage = f.writes.find(x => x.sql.includes('UPDATE gas_bottle_runs SET finished_at=') && x.sql.includes('empty_weight_kg'));
  assert.equal(usage.params[2], 125);
  assert.equal(usage.params[4], 400);
  assert.equal(usage.params[6], 42000);
  assert.equal(f.getCommits(), 2);
});

test('a partly used bottle remains in its slot for later resumption', async () => {
  const f = fixture();
  const changed = f.response();
  await f.controller.changeBottle(f.request({ bottle_number: 2, changed_at: '2026-10-01 11:00:00', finish_reason: 'paused' }), changed);
  assert.equal(changed.body.success, true);
  const runUpdate = f.writes.find(x => x.sql.startsWith('UPDATE gas_bottle_runs SET finished_at'));
  assert.equal(runUpdate.params[1], 'paused');
  assert.ok(f.writes.some(x => x.sql.includes("UPDATE gas_bottles SET status='ready'")));
  assert.equal(f.writes.some(x => x.sql.includes("SET status='finished'")), false);
});

test('production is counted separately for each running period of a resumed bottle', async () => {
  const f = fixture({ priorPeriod: true });
  await f.controller.changeBottle(f.request({ bottle_number: 2, changed_at: '2026-10-01 11:00:00' }), f.response());
  const placed = f.response();
  await f.controller.fillPosition(f.request({ filled_weight_kg: 540, empty_weight_kg: 125 }, 1), placed);
  assert.equal(placed.body.success, true);
  const periods = f.writes.filter(x => x.sql.includes('UPDATE gas_bottle_runs SET finished_at=') && x.sql.includes('empty_weight_kg'));
  assert.equal(periods.length, 2);
  assert.equal(periods[0].params[1], 2);
  assert.equal(periods[1].params[1], 1);
  assert.equal(periods.reduce((total,period) => total + period.params[4], 0), 400);
});

test('placing a new bottle can record its selected supply start time', async () => {
  const f = fixture();
  const placed = f.response();
  await f.controller.fillPosition(f.request({ filled_weight_kg: 540, started_at: '2026-10-01 10:30:00' }, 4), placed);
  assert.equal(placed.body.success, true);
  assert.ok(f.writes.some(x => x.sql.includes('UPDATE gas_bottles SET status=?') && x.params[0] === 'running'));
  assert.ok(f.writes.some(x => x.sql.startsWith('INSERT INTO gas_bottle_runs') && x.params[2] === '2026-10-01 10:30:00'));
});

test('Gas Stock can correct the current bottle start time after a gas change', async () => {
  const f = fixture();
  const saved = f.response();
  await f.controller.updateStartTime(f.request({ started_at: '2026-10-01 10:30:00' }, 1), saved);
  assert.equal(saved.body.success, true);
  assert.ok(f.writes.some(x => x.sql.startsWith('UPDATE gas_bottle_runs SET started_at=') && x.params[0] === '2026-10-01 10:30:00'));
});
