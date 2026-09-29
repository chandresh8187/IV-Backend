const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('stock alerts trigger at inclusive limits and re-arm after replenishment', async () => {
  let zincKg = 6000;
  let gasBottles = 4;
  const states = new Map();
  const sent = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      if (sql.startsWith('INSERT IGNORE')) {
        if (!states.has(params[0])) states.set(params[0], { is_low: 0, generation: 0 });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT is_low')) return [[{ ...states.get(params[0]) }]];
      if (sql.includes('SET is_low = 1')) states.set(params[1], { is_low: 1, generation: params[0] });
      if (sql.includes('SET is_low = 0')) states.get(params[0]).is_low = 0;
      return [{ affectedRows: 1 }];
    },
  };
  const db = {
    getConnection: async () => connection,
    query: async sql => {
      if (sql.includes('FROM zinc_stock')) return [[{ initialized: 1, plant_kg: zincKg }]];
      if (sql.includes('FROM gas_bottles')) return [[{ total: 10, filled: gasBottles }]];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/stockAlertService.js'), 'utf8'), {
    module,
    require: name => name === '../config/db' ? db : name === '../utils/checkEntryZincNotification'
      ? { publishOnce: async alert => { sent.push(alert); return { triggered: true }; } } : require(name),
  });
  await module.exports.checkStockAlerts();
  assert.deepEqual(sent.map(alert => alert.referenceKey), ['zinc_stock_episode_1', 'gas_stock_episode_1']);
  assert.deepEqual(Array.from(sent[0].roles), ['superadmin', 'admin', 'plant_manager']);
  await module.exports.checkStockAlerts();
  assert.deepEqual(sent.slice(2).map(alert => alert.referenceKey), ['zinc_stock_episode_1', 'gas_stock_episode_1']);
  zincKg = 6001; gasBottles = 5;
  await module.exports.checkStockAlerts();
  assert.equal(sent.length, 4);
  zincKg = 5999; gasBottles = 3;
  await module.exports.checkStockAlerts();
  assert.deepEqual(sent.slice(4).map(alert => alert.referenceKey), ['zinc_stock_episode_2', 'gas_stock_episode_2']);
});
