const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('zinc kettle auto-stops at its saved limit and updates linked production', async () => {
  const entry = {
    id: 9,
    production_entry_id: 21,
    zinc_kettle_started_at: new Date(Date.now() - 301000),
    zinc_kettle_client_started_at_ms: null,
    zinc_kettle_limit_seconds: 300,
  };
  const writes = [];
  const events = [];
  let commits = 0;
  const connection = {
    beginTransaction: async () => {},
    commit: async () => { commits += 1; },
    rollback: async () => {},
    release: () => {},
    query: async (sql, params) => {
      if (sql.includes('SELECT *')) return [[entry]];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
  const db = {
    query: async () => [[{ id: 9 }]],
    getConnection: async () => connection,
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/labourTimerService.js'), 'utf8'), {
    module,
    require: name => name === '../config/db' ? db : require(name),
    Date,
  });
  await module.exports.expireDueTimers({ emit: (...args) => events.push(args) });
  assert.equal(commits, 1);
  assert.ok(writes.some(write => write.sql.includes('zinc_kettle_duration_seconds = ?') && write.params[0] === 300));
  assert.ok(writes.some(write => write.sql.includes('JOIN labour_weight_consumptions') && write.params[0] === 300));
  assert.ok(events.some(event => event[0] === 'production_updated'));
});
