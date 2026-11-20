const test = require('node:test');
const assert = require('node:assert/strict');
const { unit1FlowDatabase } = require('./fixtures/unit1FlowDatabase');

test('bundle entry persists blade size and gross usage and feeds stock and history', { skip: process.env.UNIT1_EDIT_DB_TEST !== '1' }, async () => {
  const fixture = await unit1FlowDatabase();
  const { db } = fixture;
  const dbPath = require.resolve('../config/unit1Db');
  const originalDb = require.cache[dbPath];
  require.cache[dbPath] = { exports: db };
  try {
    const router = require('../routes/unit1ProductionRoutes');
    const postBundle = router.stack.find(layer => layer.route?.path === '/runs/:id/bundles').route.stack.at(-1).handle;
    const liveEntries = router.stack.find(layer => layer.route?.path === '/entries').route.stack.at(-1).handle;
    const machineRouter = require('../routes/unit1MachineRoutes');
    const updateMachine = machineRouter.stack.find(layer => layer.route?.methods.put).route.stack.at(-1).handle;
    const { coilBalance } = require('../services/unit1CoilBalance');
    const { productionReport } = require('../services/unit1ProductionReport');
    const { listStock, materialBundles, traceStock } = require('../services/unit1MaterialRegister');
    const { editJobCard } = require('../services/unit1EditJobCard');
    const { unit1DbTransaction } = require('../services/unit1DbTransaction');
    const [[actor]] = await db.query('SELECT id FROM users LIMIT 1');
    const [[coil]] = await db.query('SELECT id FROM coils LIMIT 1');
    const req = { user: { id: actor.id, role: 'superadmin' }, app: { get: () => null } };
    const response = { json: body => body };
    const propagate = error => { throw error; };
    const updateBlade = async cutBladeSizeMm => {
      let result;
      await updateMachine({ ...req, params: { id: '1' }, body: { name: 'Audit former', cutBladeSizeMm } },
        { json: body => { result = body; } }, propagate);
      return result;
    };
    assert.equal((await updateBlade('5')).data.cutBladeSizeMm, 5);
    const [job] = await db.execute(`INSERT INTO unit1_job_cards
      (job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,machine_id,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by)
      VALUES (CURDATE(),'Blade test party','Blade test job',150,'solar_mounting_structure','Test member','150x65x20','day',1500,1,'MS',254,3,'Ø9',?)`, [actor.id]);
    await db.execute("INSERT INTO unit1_job_card_holes (job_card_id,sequence_no,profile,punch_size,target_mm) VALUES (?,1,'web','Ø9',100)", [job.insertId]);
    const [run] = await db.execute(`INSERT INTO unit1_production_runs (machine_id,coil_id,coil_number,product_type,status,created_by,job_card_id,hole_checked_at)
      VALUES (1,?,1,'solar_mounting_structure','running',?,?,UTC_TIMESTAMP(3))`, [coil.id, actor.id, job.insertId]);
    await db.execute("INSERT INTO unit1_hole_checks (run_id,check_type,checked_by) VALUES (?,'first_piece',?)", [run.insertId, actor.id]);
    const connection = await db.getConnection();
    let startingKg;
    try { startingKg = (await coilBalance(connection, coil.id, 1)).remainingKg; } finally { connection.release(); }

    const add = pieces => postBundle({ ...req, params: { id: run.insertId }, body: { pieces } }, response, propagate);
    await add(100);
    assert.equal((await updateBlade('10')).data.cutBladeSizeMm, 10);
    await add(10);
    const [rows] = await db.execute(`SELECT pieces,cut_blade_size_mm sizeMm,cut_blade_scrap_kg bladeKg,theoretical_used_kg usedKg,
      hole_scrap_kg holeKg,DATE_FORMAT(shift_date,'%Y-%m-%d') date FROM unit1_production_bundles WHERE run_id=? ORDER BY bundle_no`, [run.insertId]);
    assert.deepEqual(rows.map(({ pieces, sizeMm, bladeKg }) => [pieces, sizeMm, bladeKg]), [[100, 5, 2.9909], [10, 10, .5982]]);
    assert.equal(rows[0].usedKg, 900.2459);
    let live;
    await liveEntries({ ...req, params: {}, query: { machineId: '1' } }, { json: body => { live = body.data; } }, propagate);
    assert.deepEqual(live.entries.map(entry => entry.cutBladeScrapKg), [.5982, 2.9909]);
    const [stock] = await listStock(db);
    const bundleDetails = await materialBundles(db, stock.key);
    assert.deepEqual(bundleDetails.bundles.map(bundle => bundle.cutBladeScrapKg), [.5982, 2.9909]);
    assert.equal((await traceStock(db, stock.key)).sourceCoils[0].cutBladeScrapKg, 3.5891);
    const history = await productionReport(db, {date: rows[0].date});
    assert.equal(history.summary.cutBladeScrapKg, 3.589);
    assert.ok(Math.abs(history.summary.productionKg - rows.reduce((sum, row) => sum + row.usedKg - row.bladeKg - row.holeKg, 0)) < .001);
    const balanceConnection = await db.getConnection();
    try {
      const balance = await coilBalance(balanceConnection, coil.id, 1);
      assert.ok(Math.abs((startingKg - balance.remainingKg) - rows.reduce((sum, row) => sum + row.usedKg, 0)) < .001);
    } finally { balanceConnection.release(); }

    assert.equal((await updateBlade('')).data.cutBladeSizeMm, null);
    await unit1DbTransaction(db, tx => editJobCard(tx, job.insertId, {
      jobDate: rows[0].date, customerName: 'Blade test party', projectNameCapacity: 'Blade test job',
      productionQty: 150, structureType: 'solar_mounting_structure', memberName: 'Test member', sectionSize: '150x65x20',
      shift: 'day', cutLengthMm: 1600, plannedMachineId: 1, materialType: 'MS', coilWidthMm: 254, coilThicknessMm: 3,
      punchSize: 'Ø9', holes: [{ sequenceNo: 1, profile: 'web', punchSize: 'Ø9', targetMm: 100 }],
    }, actor.id));
    const revised = await productionReport(db, { date: rows[0].date });
    assert.equal(revised.summary.cutBladeScrapKg, 3.589);
    assert.ok(revised.summary.coilUsedKg > history.summary.coilUsedKg);
  } finally {
    if (originalDb) require.cache[dbPath] = originalDb;
    else delete require.cache[dbPath];
    await fixture.close();
  }
});
