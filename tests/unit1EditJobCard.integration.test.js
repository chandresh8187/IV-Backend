const test = require('node:test'), assert = require('node:assert/strict');

test('full corrections update history, stock and weights atomically while retaining entered readings and audit data', { skip: process.env.UNIT1_EDIT_DB_TEST !== '1' }, async () => {
  require('dotenv').config({ quiet: true });
  const host = process.env.UNIT1_DB_HOST || process.env.DB_HOST;
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'Local database required');
  const fixture=await require('./fixtures/unit1FlowDatabase').unit1FlowDatabase(),db=fixture.db;
  const { editJobCard } = require('../services/unit1EditJobCard');
  const { productionReport } = require('../services/unit1ProductionReport');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[machine]] = await connection.execute('SELECT id FROM unit1_machines LIMIT 1');
    const [[coil]] = await connection.execute('SELECT id,material_type AS materialType,width_mm AS coilWidthMm,thickness_mm AS coilThicknessMm FROM coils LIMIT 1');
    const [[actor]] = await connection.execute('SELECT id FROM users LIMIT 1');
    assert.ok(machine && coil && actor, 'Local seed machine, coil and user are required');
    const [insert] = await connection.execute(`INSERT INTO unit1_job_cards (job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,machine_id,planned_machine_id,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by)
      VALUES ('2026-10-19','Edit test customer','Edit test project',100,'solar_mounting_structure','Original member','150x65x20','day',2300,?,?,?,?,?,'12x20',?)`, [machine.id,machine.id,coil.materialType,coil.coilWidthMm,coil.coilThicknessMm,actor.id]);
    const jobId = insert.insertId;
    const [hole] = await connection.execute("INSERT INTO unit1_job_card_holes (job_card_id,sequence_no,profile,punch_size,target_mm) VALUES (?,1,'web','12x20',100)", [jobId]);
    const [run] = await connection.execute("INSERT INTO unit1_production_runs (machine_id,coil_id,coil_number,product_type,status,produced_pieces,created_by,job_card_id,hole_checked_at,last_resumed_at) VALUES (?,?,999999999,'solar_mounting_structure','running',20,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [machine.id,coil.id,actor.id,jobId]);
    const [check] = await connection.execute("INSERT INTO unit1_hole_checks (run_id,check_type,checked_by) VALUES (?,'first_piece',?)", [run.insertId,actor.id]);
    await connection.execute('INSERT INTO unit1_hole_check_measurements (check_id,job_card_hole_id,measured_mm) VALUES (?,?,100.1)', [check.insertId,hole.insertId]);
    await connection.execute("INSERT INTO unit1_production_bundles (run_id,bundle_no,pieces,member_name,entered_by,hole_check_id,shift,shift_date,theoretical_used_kg,hole_scrap_kg) VALUES (?,1,20,'Original member',?,?,'day','2026-10-19',100,1)", [run.insertId,actor.id,check.insertId]);
    const value = { id: jobId,jobDate:'2026-10-19',customerName:'Revised customer',projectNameCapacity:'Revised project',productionQty:200,structureType:'purlin_c_lip',memberName:'Revised member',sectionSize:'160x70x20',shift:'night',cutLengthMm:2500,plannedMachineId:machine.id,materialType:coil.materialType,coilWidthMm:coil.coilWidthMm,coilThicknessMm:coil.coilThicknessMm,punchSize:'18x20',holes:[{sequenceNo:1,profile:'web',punchSize:'18x20',targetMm:200}] };
    await editJobCard(connection,jobId,value,actor.id);
    const [[saved]] = await connection.execute('SELECT member_name,cut_length_mm FROM unit1_job_cards WHERE id=?',[jobId]);
    assert.equal(saved.member_name,'Revised member'); assert.equal(Number(saved.cut_length_mm),2500);
    const [[state]] = await connection.execute('SELECT status,hole_checked_at FROM unit1_production_runs WHERE id=?',[run.insertId]);
    assert.equal(state.status,'setup'); assert.equal(state.hole_checked_at,null);
    const [[old]] = await connection.execute('SELECT is_active,target_mm FROM unit1_job_card_holes WHERE id=?',[hole.insertId]);
    assert.equal(old.is_active,0); assert.equal(Number(old.target_mm),100);
    const [[stored]] = await connection.execute('SELECT report_snapshot FROM unit1_hole_checks WHERE id=?',[check.insertId]);
    const snapshot=JSON.parse(stored.report_snapshot); assert.equal(snapshot.memberName,'Revised member'); assert.equal(snapshot.measurements[0].targetMm,200);
    assert.equal(snapshot.measurements[0].originalTargetMm,100);
    assert.equal(snapshot.measurements[0].measuredMm,100.1);
    const history=await productionReport(connection,{date:'2026-10-19',machineId:String(machine.id)});
    const entry=history.entries.find(row=>row.jobCardId===jobId);
    assert.equal(entry.memberName,'Revised member');
    assert.ok(Math.abs(entry.theoreticalUsedKg - coil.coilWidthMm*coil.coilThicknessMm*2500*20*7.85/1000000)<.0001);
    const [[stock]] = await connection.execute(`SELECT i.member_name AS memberName,i.length_mm AS lengthMm,m.quantity,m.id FROM unit1_material_stock_movements m JOIN unit1_material_stock_items i ON i.id=m.item_id WHERE m.source_bundle_id=?`,[entry.id]);
    assert.equal(stock.memberName,'Revised member'); assert.equal(Number(stock.lengthMm),2500); assert.equal(Number(stock.quantity),20);
    const [[audit]] = await connection.execute('SELECT before_data FROM unit1_job_card_revisions WHERE job_card_id=? ORDER BY id LIMIT 1',[jobId]);
    assert.equal(JSON.parse(audit.before_data).job.memberName,'Original member');
    await editJobCard(connection,jobId,{...value,customerName:'Another revision'},actor.id);
    const [[stockAgain]]=await connection.execute('SELECT COUNT(*) AS count,MIN(id) AS id FROM unit1_material_stock_movements WHERE source_bundle_id=?',[entry.id]);
    assert.equal(Number(stockAgain.count),1); assert.equal(Number(stockAgain.id),Number(stock.id));
    const [[active]] = await connection.execute('SELECT COUNT(*) AS count FROM unit1_job_card_holes WHERE job_card_id=? AND is_active=1',[jobId]);
    assert.equal(Number(active.count),1);
    await connection.query('SAVEPOINT before_invalid_correction');
    await connection.execute('UPDATE coils SET actual_net_kg=?*coil_qty WHERE id=?',[Number(entry.theoreticalUsedKg)+.01,coil.id]);
    await assert.rejects(editJobCard(connection,jobId,{...value,cutLengthMm:5000},actor.id), /exceeds the material available/);
    await connection.query('ROLLBACK TO SAVEPOINT before_invalid_correction');
    const [[unchanged]]=await connection.execute('SELECT member_name,cut_length_mm FROM unit1_job_cards WHERE id=?',[jobId]);
    assert.equal(Number(unchanged.cut_length_mm),2500);
  } finally { await connection.rollback(); connection.release(); await fixture.close(); }
});
