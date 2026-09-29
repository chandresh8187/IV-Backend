const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const entry = { id: 17, labour_user_id: 3, production_entry_id: 41, pickling_started_at: null, pickling_duration_seconds: null, pickling_client_started_at_ms: null };
  const writes = [];
  const events = [];
  let committed = 0;
  const query = async (sql, params) => {
    if (sql.includes('SELECT * FROM labour_weight_entries')) return [[{ ...entry }]];
    if (sql.includes('TIMESTAMPDIFF')) return [[{ seconds: 15 }]];
    writes.push({ sql, params });
    if (sql.includes('SET pickling_started_at = CURRENT_TIMESTAMP')) { entry.pickling_started_at = new Date(); entry.pickling_client_started_at_ms = params[0]; }
    if (sql.includes('SET pickling_started_at = NULL')) { entry.pickling_started_at = null; entry.pickling_client_started_at_ms = null; entry.pickling_duration_seconds = params[0]; }
    return [{ affectedRows: 1 }];
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => { committed++; }, rollback: async () => {}, release() {} };
  const mocks = {
    '../config/db': { getConnection: async () => connection },
    '../services/productionZincStockService': {},
    '../services/productionPlanningFlowService': {},
    '../services/productionCostService': {},
    '../services/permissionService': { hasPermission: async () => true },
    '../services/appSettingsService': { getSetting: async () => ({ pickling: 7, flux: 2, hot_drier: 5, zinc_kettle: 5 }) },
    '../services/labourTimerService': {
      DEFAULT_LIMIT_SECONDS: { pickling: 420, flux: 120, hot_drier: 300, zinc_kettle: 300 },
      effectiveStartMs: () => Date.now(),
      expireDueTimers: async () => {},
      finishTimer: async (connection, current, process, seconds) => {
        await connection.query(`UPDATE labour_weight_entries SET ${process}_started_at = NULL, ${process}_client_started_at_ms = NULL, ${process}_duration_seconds = ? WHERE id = ?`, [seconds, current.id]);
        await connection.query(`UPDATE production_entries p JOIN labour_weight_consumptions c ON c.production_entry_id = p.id SET p.${process}_duration_seconds = ? WHERE c.labour_weight_id = ?`, [seconds, current.id]);
        await connection.query(`UPDATE production_entries SET ${process}_duration_seconds = ? WHERE id = ?`, [seconds, current.production_entry_id]);
      },
    },
    luxon: require('luxon'),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/labourWeightController.js'), 'utf8'), { module, require: name => mocks[name] });
  async function toggle(user = { id: 3, role: 'labour' }, action = entry.pickling_started_at ? 'stop' : 'start', clientEventAtMs = action === 'stop' ? 1017000 : 1000000) {
    const req = { params: { id: '17', process: 'pickling' }, body: { action, client_event_at_ms: clientEventAtMs }, user, app: { get: () => ({ emit: (...args) => events.push(args) }) } };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await module.exports.toggleTimer(req, res);
    return res;
  }
  return { toggle, entry, writes, events, committed: () => committed };
}

test('timer saves frontend tap duration despite two seconds of request delay', async () => {
  const f = fixture();
  assert.equal((await f.toggle()).body.action, 'started');
  assert.equal((await f.toggle({ id: 3, role: 'labour' }, 'start')).code, 409);
  const stopped = await f.toggle();
  assert.equal(stopped.body.data.duration_seconds, 17);
  assert.equal(stopped.body.data.duration_source, 'client');
  assert.equal(f.entry.pickling_duration_seconds, 17);
  assert.equal(f.committed(), 2);
  assert.ok(f.writes.some(write => write.sql.includes('JOIN labour_weight_consumptions') && write.params[0] === 17));
  assert.ok(f.writes.some(write => write.sql.includes('UPDATE production_entries SET pickling_duration_seconds') && write.params[1] === 41));
  assert.ok(f.events.some(event => event[0] === 'production_updated'));
  assert.equal((await f.toggle()).code, 409);
});

test('inconsistent client clock falls back to server elapsed time', async () => {
  const f = fixture();
  await f.toggle();
  const stopped = await f.toggle({ id: 3, role: 'labour' }, 'stop', 1040000);
  assert.equal(stopped.body.data.duration_seconds, 15);
  assert.equal(stopped.body.data.duration_source, 'server');
});

test('a different labour user cannot operate the weight timer', async () => {
  const f = fixture();
  assert.equal((await f.toggle({ id: 4, role: 'labour' })).code, 403);
  assert.equal(f.writes.length, 0);
});
