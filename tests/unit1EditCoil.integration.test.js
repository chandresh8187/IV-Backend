const test = require('node:test');
const assert = require('node:assert/strict');

test('inward corrections preserve coil identity and readings, reconcile weights and stock, and reject invalid balances atomically', { skip: process.env.UNIT1_EDIT_COIL_DB_TEST !== '1' }, async () => {
  require('dotenv').config({ quiet: true });
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.UNIT1_DB_HOST || process.env.DB_HOST), 'Local database required');
  const fixture=await require('./fixtures/unit1FlowDatabase').unit1FlowDatabase(),db=fixture.db;
  const { editCoil } = require('../services/unit1EditCoil');
  const { validateInward } = require('../services/unit1CoilValidation');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[machine]] = await connection.execute('SELECT id FROM unit1_machines LIMIT 1');
    const [[actor]] = await connection.execute('SELECT id FROM users LIMIT 1');
    const legacy = `U1-inward-edit-${Date.now()}`;
    const [coil] = await connection.execute(`INSERT INTO coils (internal_id,public_code,supplier,supplier_coil_id,invoice,invoice_date,vendor_code,grade,material_type,coil_qty,thickness_mm,width_mm,estimated_kg,gross_kg,tare_kg,actual_net_kg,rate_per_kg,status)
      VALUES (?,NULL,'Vendor',?,'Original','2026-10-19','Vendor','E350','MS',2,3,254,2000,2000,0,2000,50,'in_stock')`, [legacy,legacy]);
    const [job] = await connection.execute(`INSERT INTO unit1_job_cards (job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,machine_id,planned_machine_id,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by)
      VALUES ('2026-10-19','Customer','Project',100,'solar_mounting_structure','Column','150x65x20','day',2300,?,?,'MS',254,3,'12x20',?)`, [machine.id,machine.id,actor.id]);
    const [hole] = await connection.execute("INSERT INTO unit1_job_card_holes (job_card_id,sequence_no,profile,punch_size,target_mm) VALUES (?,1,'web','12x20',100)", [job.insertId]);
    const [run] = await connection.execute("INSERT INTO unit1_production_runs (machine_id,coil_id,coil_number,product_type,status,produced_pieces,created_by,job_card_id,hole_checked_at,last_resumed_at) VALUES (?,?,2,'solar_mounting_structure','running',20,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [machine.id,coil.insertId,actor.id,job.insertId]);
    const [check] = await connection.execute("INSERT INTO unit1_hole_checks (run_id,check_type,checked_by) VALUES (?,'first_piece',?)", [run.insertId,actor.id]);
    await connection.execute('INSERT INTO unit1_hole_check_measurements (check_id,job_card_hole_id,measured_mm) VALUES (?,?,100.1)', [check.insertId,hole.insertId]);
    const [bundle] = await connection.execute("INSERT INTO unit1_production_bundles (run_id,bundle_no,pieces,member_name,entered_by,hole_check_id,shift,shift_date,theoretical_used_kg,hole_scrap_kg) VALUES (?,1,20,'Column',?,?,'day','2026-10-19',100,1)", [run.insertId,actor.id,check.insertId]);
    const body = { invoice:'Corrected',invoiceDate:'2026-10-20',vendorCode:'Revised vendor',tcNumber:'TC-1',materialType:'MS',grade:'E350',widthMm:300,thicknessMm:3,coilQty:2,totalWeightKg:2400,ratePerKg:65 };
    const value = validateInward(body).value;
    assert.ok(value);
    await editCoil(connection,coil.insertId,value,actor.id);
    const [[saved]] = await connection.execute('SELECT * FROM coils WHERE id=?',[coil.insertId]);
    assert.equal(saved.internal_id,legacy); assert.equal(saved.supplier_coil_id,legacy);
    assert.equal(saved.invoice,'Corrected'); assert.equal(Number(saved.rate_per_kg),65);
    const [physicalIds] = await connection.execute('SELECT code FROM unit1_coil_identifiers WHERE batch_id=? AND coil_number IS NOT NULL ORDER BY coil_number',[coil.insertId]);
    assert.equal(physicalIds.length,2);
    const [[weights]] = await connection.execute('SELECT pieces,theoretical_used_kg,hole_scrap_kg FROM unit1_production_bundles WHERE id=?',[bundle.insertId]);
    assert.equal(weights.pieces,20); assert.ok(Math.abs(Number(weights.theoretical_used_kg)-300*3*2300*20*7.85/1e6)<.0001);
    assert.ok(Number(weights.hole_scrap_kg)>0);
    const [[stock]] = await connection.execute('SELECT m.id,m.quantity,i.grade,i.thickness_mm FROM unit1_material_stock_movements m JOIN unit1_material_stock_items i ON i.id=m.item_id WHERE m.source_bundle_id=?',[bundle.insertId]);
    assert.equal(Number(stock.quantity),20); assert.equal(stock.grade,'E350');
    const [[plan]] = await connection.execute('SELECT coil_width_mm FROM unit1_job_cards WHERE id=?',[job.insertId]);
    assert.equal(Number(plan.coil_width_mm),300);
    const [[state]] = await connection.execute('SELECT status,hole_checked_at FROM unit1_production_runs WHERE id=?',[run.insertId]);
    assert.equal(state.status,'setup'); assert.equal(state.hole_checked_at,null);
    const [[inspection]] = await connection.execute('SELECT report_snapshot FROM unit1_hole_checks WHERE id=?',[check.insertId]);
    const snapshot = JSON.parse(inspection.report_snapshot);
    assert.equal(snapshot.coilSize,'300 x 3 mm'); assert.equal(snapshot.measurements[0].measuredMm,100.1);
    const [[audit]] = await connection.execute('SELECT before_data FROM unit1_coil_revisions WHERE coil_id=?',[coil.insertId]);
    assert.equal(JSON.parse(audit.before_data).coil.invoice,'Original');
    await connection.execute("UPDATE unit1_production_runs SET status='running',hole_checked_at=UTC_TIMESTAMP(3) WHERE id=?",[run.insertId]);
    await editCoil(connection,coil.insertId,validateInward({...body,ratePerKg:70}).value,actor.id);
    const [correctedIds] = await connection.execute('SELECT code FROM unit1_coil_identifiers WHERE batch_id=? AND coil_number IS NOT NULL ORDER BY coil_number',[coil.insertId]);
    assert.deepEqual(correctedIds,physicalIds);
    const [[rateState]] = await connection.execute('SELECT status,hole_checked_at FROM unit1_production_runs WHERE id=?',[run.insertId]);
    assert.equal(rateState.status,'running'); assert.ok(rateState.hole_checked_at);
    const [[sameStock]] = await connection.execute('SELECT COUNT(*) AS count,MIN(id) AS id FROM unit1_material_stock_movements WHERE source_bundle_id=?',[bundle.insertId]);
    assert.equal(Number(sameStock.count),1); assert.equal(sameStock.id,stock.id);
    await connection.query('SAVEPOINT invalid_inward');
    await assert.rejects(editCoil(connection,coil.insertId,validateInward({...body,coilQty:1}).value,actor.id), /physical coil number/);
    await connection.query('ROLLBACK TO SAVEPOINT invalid_inward');
    await assert.rejects(editCoil(connection,coil.insertId,validateInward({...body,totalWeightKg:1}).value,actor.id), /exceeds the material available/);
    await connection.query('ROLLBACK TO SAVEPOINT invalid_inward');
    const [[unchanged]] = await connection.execute('SELECT actual_net_kg,rate_per_kg FROM coils WHERE id=?',[coil.insertId]);
    assert.equal(Number(unchanged.actual_net_kg),2400); assert.equal(Number(unchanged.rate_per_kg),70);
  } finally {
    await connection.rollback(); connection.release(); await fixture.close();
  }
});
