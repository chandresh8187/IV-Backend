const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv-flow').config({ silent: true });
const mysql = require('mysql2/promise');
const { editPurchase, recordPurchase } = require('../services/zincPurchaseService');
const { zincMovementLedgerSql, buildZincMovementReport } = require('../services/zincMovementReportService');
const { summarizeZincMovements } = require('../services/monthlyReportService');
const { validateMigrationSql } = require('../scripts/migrationSafety');
const migrations = ['20261102000100_create_zinc_purchases.sql', '20261102000200_backfill_zinc_purchases.sql', '20261102000300_create_zinc_purchase_audit.sql', '20261102000400_create_zinc_recovery_purchase_links.sql', '20261102000500_link_existing_zinc_recoveries.sql'];

test('purchase migrations preserve legacy rows and pass additive migration checks', () => {
  for (const name of migrations) validateMigrationSql(fs.readFileSync(path.join(__dirname, '../migrations/versioned', name), 'utf8'));
});

test('MySQL purchase migration, edits, FIFO, recovery, audit, retries and rollback remain consistent', { skip: process.env.ZINC_PURCHASE_DB_TEST !== '1' }, async () => {
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST), 'Disposable localhost database only');
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD, decimalNumbers: true, timezone: '+05:30' };
  const name = `zinc_purchase_test_${Date.now()}`;
  assert.match(name, /^zinc_purchase_test_\d+$/);
  const root = await mysql.createConnection(config);
  let c;
  try {
    await root.query(`CREATE DATABASE \`${name}\``);
    c = await mysql.createConnection({ ...config, database: name });
    await c.query("SET time_zone='+05:30'");
    await c.query('CREATE TABLE users(id INT PRIMARY KEY, name VARCHAR(100))');
    await c.query("INSERT INTO users VALUES(1,'Test manager')");
    await c.query('CREATE TABLE production_entries(id BIGINT PRIMARY KEY, shift_date DATE, shift_name VARCHAR(20))');
    for (const file of ['20260920000100_create_zinc_stock.sql', '20260921000200_add_current_zinc_rate.sql', '20260921000300_create_zinc_byproduct_transactions.sql']) await c.query(fs.readFileSync(path.join(__dirname, '../migrations/versioned', file), 'utf8'));
    // Use the current clean-install movement schema, including all date metadata.
    const clean = fs.readFileSync(path.join(__dirname, '../database/u436685010_iv_app_clean_install.sql'), 'utf8');
    await c.query(clean.match(/CREATE TABLE IF NOT EXISTS `zinc_stock_movements` \([\s\S]*?\) ENGINE=[^;]+;/)[0]);
    for (const file of ['20261101000100_add_zinc_transfer_date.sql', '20261101000200_add_zinc_transfer_time.sql']) await c.query(fs.readFileSync(path.join(__dirname, '../migrations/versioned', file), 'utf8'));
    const insert = async (type, amount, plant, kettle, date, rate = null) => {
      const [result] = await c.query(`INSERT INTO zinc_stock_movements (request_id,request_hash,movement_type,amount_kg,plant_after_kg,kettle_after_kg,actor_user_id,transaction_date,transaction_time,zinc_rate_per_kg,created_at) VALUES (?,REPEAT('a',64),?,?,?,?,1,?,'10:00',?,?)`, [`seed_${type}_${date}_00000001`, type, amount, plant, kettle, date, rate, `${date} 10:00:00`]);
      return result.insertId;
    };
    await insert('initialize', 0, 1000, 0, '2026-10-01');
    const receiptId = await insert('receive', 1000, 2000, 0, '2026-10-20', 300);
    await insert('transfer', 1600, 400, 1600, '2026-10-28');
    await insert('production_use', 100, 400, 1500, '2026-10-29');
    await c.query('INSERT INTO zinc_stock(id,initialized,plant_kg,kettle_kg,kg_per_mm,revision,current_zinc_rate) VALUES(1,1,400,1500,35.7,4,300)');
    await c.query(`INSERT INTO zinc_byproduct_transactions(transaction_date,ash_weight_kg,ash_rate,total_with_gst,zinc_rate_snapshot,recovered_zinc_kg,actor_user_id,created_at) VALUES('2026-10-31',100,30,3540,300,11.8,1,'2026-10-31 10:00:00')`);
    for (const file of migrations) await c.query(fs.readFileSync(path.join(__dirname, '../migrations/versioned', file), 'utf8'));
    assert.equal((await c.query('SELECT COUNT(*) n FROM zinc_purchases'))[0][0].n, 1);
    assert.equal((await c.query('SELECT COUNT(*) n FROM zinc_recovery_purchase_links'))[0][0].n, 1);
    const body = { transaction_date: '2026-10-27', transaction_time: '14:35', amount_kg: '1200', zinc_rate_per_kg: '600', batch_number: 'B-EDIT', invoice_number: 'INV-EDIT', note: 'Corrected invoice', expected_revision: 4, purchase_revision: 0, request_id: 'zinc_purchase_edit_0001' };
    const run = async (data, queryable = c) => {
      await c.beginTransaction();
      try { const result = await editPurchase(queryable, { id: 1, body: data, actorId: 1 }); await c.commit(); return result; }
      catch (error) { await c.rollback(); throw error; }
    };
    const result = await run(body);
    assert.equal(result.data.plant_kg, 600);
    assert.equal(result.data.kettle_kg, 1500);
    assert.equal(result.data.current_zinc_rate, 600);
    const [ledger] = await c.query(zincMovementLedgerSql);
    const october = buildZincMovementReport(ledger, { period: { from: '2026-10-01', to: '2026-10-31' } });
    assert.equal(summarizeZincMovements(october.recorded_movements).received_kg, 1200);
    assert.deepEqual(october.closing_balance, { plant_after_kg: 600, kettle_after_kg: 1500 });
    assert.equal(october.rows.find(row => row.movement_type === 'production_summary').amount_kg, 100);
    assert.equal(october.rows.find(row => row.movement_type === 'transfer').batch_allocations.find(row => Number(row.receipt_id) === receiptId).invoice_number, 'INV-EDIT');
    const [[recovery]] = await c.query('SELECT * FROM zinc_byproduct_transactions');
    assert.equal(recovery.recovered_zinc_kg, 5.9);
    assert.equal(recovery.ash_weight_kg, 100);
    const [[audit]] = await c.query('SELECT before_json FROM zinc_purchase_audit');
    const before = typeof audit.before_json === 'string' ? JSON.parse(audit.before_json) : audit.before_json;
    assert.equal(Number(before.purchase.amount_kg), 1000);
    assert.equal(Number(before.recoveries[0].recovered_zinc_kg), 11.8);
    assert.equal((await run(body)).alreadySaved, true);
    await assert.rejects(run({ ...body, amount_kg: '1201' }), /request ID/);
    await assert.rejects(run({ ...body, request_id: 'zinc_purchase_stale_0001' }), /changed/);
    const next = { ...body, expected_revision: 5, purchase_revision: 1, request_id: 'zinc_purchase_edit_0002' };
    await assert.rejects(run({ ...next, amount_kg: '500' }), /already transferred or used/);
    await assert.rejects(run({ ...next, amount_kg: '1300' }, { query: async (sql, params) => { if (sql.includes('INSERT INTO zinc_purchase_audit')) throw new Error('Simulated audit failure'); return c.query(sql, params); } }), /audit failure/);
    assert.equal((await c.query('SELECT plant_kg FROM zinc_stock'))[0][0].plant_kg, 600);
    assert.equal((await c.query('SELECT amount_kg FROM zinc_purchases'))[0][0].amount_kg, 1200);
    await run({ ...next, transaction_date: '2026-09-30' });
    const [moved] = await c.query(zincMovementLedgerSql);
    assert.equal(summarizeZincMovements(buildZincMovementReport(moved, { period: { from: '2026-10-01', to: '2026-10-31' } }).recorded_movements).received_kg, 0);
    assert.equal(summarizeZincMovements(buildZincMovementReport(moved, { period: { from: '2026-09-01', to: '2026-09-30' } }).recorded_movements).received_kg, 1200);
    // New/older app receive clients create a dedicated purchase in the same transaction.
    const anotherId = await insert('receive', 100, 700, 1500, '2026-11-01', 500);
    await recordPurchase(c, anotherId);
    assert.equal((await c.query('SELECT COUNT(*) n FROM zinc_purchases'))[0][0].n, 2);
    assert.equal((await c.query('SELECT movement_id FROM zinc_purchases WHERE id=1'))[0][0].movement_id, receiptId);
  } finally {
    if (c) await c.end();
    await root.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await root.end();
  }
});
