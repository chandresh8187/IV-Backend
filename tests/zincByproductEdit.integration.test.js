const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { editByproduct, byproductVersion } = require('../services/zincByproductEditService');
const { calculateByproductRecovery } = require('../services/zincByproductService');
require('dotenv-flow').config({ silent: true });
test('ash/dross corrections preserve snapshots, audit, dates, concurrency and rollback', { skip: process.env.ZINC_BYPRODUCT_DB_TEST !== '1' }, async () => {
  assert.ok(['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST), 'Disposable test requires localhost');
  const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD, timezone: '+05:30' });
  const database = 'test_ash_edit_' + process.pid + '_' + Date.now();
  try {
    await conn.query('CREATE DATABASE ??', [database]); await conn.query('USE ??', [database]);
    await conn.query('CREATE TABLE zinc_stock (id INT PRIMARY KEY)'); await conn.query('INSERT INTO zinc_stock VALUES (1)');
    for (const name of ['zinc_byproduct_transactions','zinc_byproduct_audit']) await conn.query('CREATE TABLE ?? LIKE ??.??', [name, process.env.DB_NAME, name]);
    const initial = { transaction_date: '2026-10-27', ...calculateByproductRecovery({ash_weight_kg:100,ash_rate:50,zinc_rate:200}), note:'Original',actor_user_id:1 };
    const [insert] = await conn.query('INSERT INTO zinc_byproduct_transactions SET ?', initial);
    const get = async () => (await conn.query("SELECT *, DATE_FORMAT(transaction_date,'%Y-%m-%d') transaction_date FROM zinc_byproduct_transactions WHERE id=?", [insert.insertId]))[0][0];
    const original = await get();
    const body = { transaction_date:'2026-09-27', ash_weight_kg:0,ash_rate:0,dross_weight_kg:100,dross_rate:100,note:'Corrected',edit_version:byproductVersion(original),request_id:'ash_edit_test_request_001' };
    const run = async (input, connection=conn) => {
      await conn.beginTransaction();
      try { const result=await editByproduct(connection,{id:insert.insertId,body:input,actorId:2}); await conn.commit(); return result; }
      catch(error) { await conn.rollback(); throw error; }
    };
    await run(body);
    const edited=await get();
    assert.equal(edited.transaction_date,'2026-09-27'); assert.equal(Number(edited.recovered_zinc_kg),59);
    assert.equal(Number(edited.zinc_rate_snapshot),200); assert.equal(Number(edited.actor_user_id),1);
    assert.equal(String(edited.created_at),String(original.created_at));
    const [[audit]]=await conn.query('SELECT * FROM zinc_byproduct_audit');
    const before=typeof audit.before_json==='string'?JSON.parse(audit.before_json):audit.before_json;
    assert.equal(Number(before.ash_weight_kg),100); assert.equal(before.note,'Original');
    assert.equal((await run(body)).alreadySaved,true);
    await assert.rejects(run({...body,note:'Different request'}), /Request ID/);
    await assert.rejects(run({...body,request_id:'ash_edit_test_request_002'}), /changed/);
    await assert.rejects(run({...body,edit_version:byproductVersion(edited),request_id:'ash_edit_test_request_003',dross_weight_kg:0}), /weight/);
    const failAudit={query:async(sql,params)=>{if(sql.startsWith('INSERT INTO zinc_byproduct_audit')) throw new Error('audit unavailable'); return conn.query(sql,params);}};
    await assert.rejects(run({...body,edit_version:byproductVersion(edited),request_id:'ash_edit_test_request_004',dross_weight_kg:50},failAudit), /audit unavailable/);
    assert.equal(Number((await get()).recovered_zinc_kg),59);
    const [[months]]=await conn.query("SELECT SUM(CASE WHEN MONTH(transaction_date)=9 THEN recovered_zinc_kg ELSE 0 END) september, SUM(CASE WHEN MONTH(transaction_date)=10 THEN recovered_zinc_kg ELSE 0 END) october FROM zinc_byproduct_transactions");
    assert.equal(Number(months.september),59); assert.equal(Number(months.october),0);
    // A linked purchase-rate correction changes the version and prevents overwrites.
    await conn.query('UPDATE zinc_byproduct_transactions SET zinc_rate_snapshot=300,recovered_zinc_kg=ROUND(total_with_gst/300,3)');
    await assert.rejects(run({...body,edit_version:byproductVersion(edited),request_id:'ash_edit_test_request_005'}), /changed/);
  } finally {
    await conn.query('DROP DATABASE IF EXISTS ??',[database]); await conn.end();
  }
});
