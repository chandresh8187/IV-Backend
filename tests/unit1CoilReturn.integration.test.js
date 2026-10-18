const test = require('node:test');
const assert = require('node:assert/strict');

test('MySQL preserves returned coil history and prevents simultaneous reuse', { skip: process.env.UNIT1_DB_INTEGRATION !== '1' }, async () => {
  require('dotenv-flow').config({ silent: true });
  const db = require('../config/unit1Db');
  const { returnCoil } = require('../services/unit1ReturnCoil');
  const { coilBalance } = require('../services/unit1CoilBalance');
  const connection = await db.getConnection();
  const tables = ['unit1_production_events', 'unit1_production_bundles', 'unit1_production_runs', 'coils'];
  try {
    // Session-local tables shadow real tables. No production rows are changed.
    for (const table of ['unit1_production_runs', 'unit1_production_events']) {
      const [[definition]] = await connection.query(`SHOW CREATE TABLE ${table}`);
      const sql = definition['Create Table'].split('\n').filter(line => !line.trim().startsWith('CONSTRAINT ')).join('\n')
        .replace('CREATE TABLE', 'CREATE TEMPORARY TABLE').replace(/,\n\)/, '\n)');
      await connection.query(sql);
    }
    await connection.query('CREATE TEMPORARY TABLE coils (id BIGINT PRIMARY KEY,actual_net_kg DECIMAL(16,4),coil_qty INT)');
    await connection.query('CREATE TEMPORARY TABLE unit1_production_bundles (run_id BIGINT,theoretical_used_kg DECIMAL(16,4))');
    await connection.beginTransaction();
    await connection.execute('INSERT INTO coils VALUES (1,2000,2)');
    const insertRun = async status => {
      const [result] = await connection.execute('INSERT INTO unit1_production_runs (machine_id,coil_id,coil_number,product_type,job_card_id,status,created_by,produced_pieces,last_resumed_at) VALUES (1,1,2,?,9,?,3,100,UTC_TIMESTAMP(3))', ['solar_mounting_structure', status]);
      return result.insertId;
    };
    const first = await insertRun('running');
    await connection.execute('INSERT INTO unit1_production_bundles VALUES (?,400)', [first]);
    assert.equal((await returnCoil(connection, first, 3)).remainingKg, 600);
    const second = await insertRun('setup');
    await assert.rejects(insertRun('setup'), { code: 'ER_DUP_ENTRY' });
    await connection.execute("UPDATE unit1_production_runs SET status='running' WHERE id=?", [second]);
    await connection.execute('INSERT INTO unit1_production_bundles VALUES (?,100)', [second]);
    assert.equal((await returnCoil(connection, second, 3)).remainingKg, 500);
    const third = await insertRun('paused');
    assert.equal((await coilBalance(connection, 1, 2)).remainingKg, 500);
    const [[progress]] = await connection.execute('SELECT SUM(produced_pieces) AS pieces FROM unit1_production_runs WHERE job_card_id=9');
    assert.equal(Number(progress.pieces), 300);
    const [[events]] = await connection.execute("SELECT COUNT(*) AS count FROM unit1_production_events WHERE event_type='coil_returned'");
    assert.equal(Number(events.count), 2);
    await assert.rejects(returnCoil(connection, first, 3), { status: 409 });
    const [blocked] = await connection.execute("SELECT coil_number FROM unit1_production_runs WHERE coil_id=1 AND status <> 'returned'");
    assert.deepEqual(blocked.map(row => row.coil_number), [2]);
    await connection.execute('INSERT INTO unit1_production_bundles VALUES (?,500)', [third]);
    await assert.rejects(returnCoil(connection, third, 3), { status: 409 });
  } finally {
    await connection.rollback();
    for (const table of tables) await connection.query(`DROP TEMPORARY TABLE IF EXISTS ${table}`);
    connection.release();
    await db.end();
  }
});
