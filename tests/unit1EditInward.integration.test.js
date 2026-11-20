const test = require('node:test');
const assert = require('node:assert/strict');

test('whole inward edits correct two produced sizes atomically and preserve individual coil IDs', {skip:process.env.UNIT1_EDIT_INWARD_DB_TEST!=='1'}, async () => {
  require('dotenv').config({quiet:true});
  assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.UNIT1_DB_HOST || process.env.DB_HOST));
  const db = require('../config/unit1Db');
  const {editInward} = require('../services/unit1EditInward');
  const {assignCoilCode} = require('../services/unit1CoilCode');
  const {ensurePhysicalCoils} = require('../services/unit1PhysicalCoils');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[machine]] = await connection.execute('SELECT id FROM unit1_machines LIMIT 1');
    const [[actor]] = await connection.execute('SELECT id FROM users LIMIT 1');
    const invoice = `Invoice-edit-${Date.now()}`;
    const batches = [];
    for (const width of [254,300]) {
      const reference = `U1-${invoice}-${width}`;
      const [batch] = await connection.execute(`INSERT INTO coils (internal_id,supplier,supplier_coil_id,invoice,invoice_date,vendor_code,tc_number,grade,material_type,coil_qty,thickness_mm,width_mm,estimated_kg,gross_kg,tare_kg,actual_net_kg,rate_per_kg,status)
        VALUES (?,'Original vendor',?,?,'2026-10-20','Original vendor','OLD-TC','E350','MS',2,3,?,2000,2000,0,2000,50,'in_stock')`,[reference,reference,invoice,width]);
      await assignCoilCode(connection,batch.insertId);
      await ensurePhysicalCoils(connection,batch.insertId,2);
      const [job] = await connection.execute(`INSERT INTO unit1_job_cards (job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,machine_id,planned_machine_id,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by)
        VALUES ('2026-10-20','Customer','Project',100,'solar_mounting_structure','Column','150x65x20','day',2300,?,?,'MS',?,3,'12x20',?)`,[machine.id,machine.id,width,actor.id]);
      await connection.execute("INSERT INTO unit1_job_card_holes (job_card_id,sequence_no,profile,punch_size,target_mm) VALUES (?,1,'web','12x20',100)",[job.insertId]);
      const [run] = await connection.execute("INSERT INTO unit1_production_runs (machine_id,coil_id,coil_number,product_type,status,produced_pieces,created_by,job_card_id,hole_checked_at) VALUES (?,?,1,'solar_mounting_structure','running',20,?,?,UTC_TIMESTAMP(3))",[machine.id,batch.insertId,actor.id,job.insertId]);
      const [bundle] = await connection.execute("INSERT INTO unit1_production_bundles (run_id,bundle_no,pieces,member_name,entered_by,shift,shift_date,theoretical_used_kg,hole_scrap_kg) VALUES (?,1,20,'Column',?,'day','2026-10-20',100,1)",[run.insertId,actor.id]);
      batches.push({id:batch.insertId,jobId:job.insertId,bundleId:bundle.insertId,widthMm:width});
    }
    const ids = batches.map(batch=>batch.id);
    const [originalCodes] = await connection.query('SELECT code,batch_id,coil_number FROM unit1_coil_identifiers WHERE batch_id IN (?,?) ORDER BY code',ids);
    const line = (batch,index) => ({id:batch.id,materialType:'MS',grade:'E350',widthMm:index ? 320 : 260,thicknessMm:3,coilQty:2,totalWeightKg:2600,ratePerKg:65+index});
    const body = {invoice:invoice+'-corrected',invoiceDate:'2026-10-21',vendorCode:'Corrected vendor',tcNumber:'NEW-TC',batchIds:ids,lines:batches.map(line)};
    const savedIds = await editInward(connection,ids[0],body,actor.id);
    assert.deepEqual(savedIds,ids);
    const [saved] = await connection.query("SELECT id,invoice,DATE_FORMAT(invoice_date,'%Y-%m-%d') AS invoiceDate,vendor_code,tc_number,width_mm FROM coils WHERE id IN (?,?) ORDER BY id",ids);
    for (const row of saved) { assert.equal(row.invoice,body.invoice); assert.equal(row.invoiceDate,body.invoiceDate); assert.equal(row.vendor_code,body.vendorCode); assert.equal(row.tc_number,'NEW-TC'); }
    for (const [index,batch] of batches.entries()) {
      const [[bundle]] = await connection.execute('SELECT theoretical_used_kg,pieces FROM unit1_production_bundles WHERE id=?',[batch.bundleId]);
      assert.equal(bundle.pieces,20);
      assert.ok(Math.abs(Number(bundle.theoretical_used_kg)-(index ? 320 : 260)*3*2300*20*7.85/1e6)<.0001);
      const [[stock]] = await connection.execute('SELECT COUNT(*) AS count,SUM(quantity) AS qty FROM unit1_material_stock_movements WHERE source_bundle_id=?',[batch.bundleId]);
      assert.equal(Number(stock.count),1); assert.equal(Number(stock.qty),20);
      const [[plan]] = await connection.execute('SELECT coil_width_mm FROM unit1_job_cards WHERE id=?',[batch.jobId]);
      assert.equal(Number(plan.coil_width_mm),index ? 320 : 260);
    }
    const [currentCodes] = await connection.query('SELECT code,batch_id,coil_number FROM unit1_coil_identifiers WHERE batch_id IN (?,?) ORDER BY code',ids);
    assert.deepEqual(currentCodes,originalCodes);
    const [[audit]] = await connection.query('SELECT COUNT(*) AS count FROM unit1_coil_revisions WHERE coil_id IN (?,?)',ids);
    assert.equal(Number(audit.count),2);
    await connection.query('SAVEPOINT before_invalid_invoice');
    await assert.rejects(editInward(connection,ids[0],{...body,invoice:'Must roll back',lines:body.lines.map((entry,index)=>({...entry,totalWeightKg:index ? 1 : 3000}))},actor.id),/exceeds the material available/);
    await connection.query('ROLLBACK TO SAVEPOINT before_invalid_invoice');
    const [afterFailure] = await connection.query('SELECT invoice,actual_net_kg FROM coils WHERE id IN (?,?)',ids);
    for (const row of afterFailure) { assert.equal(row.invoice,body.invoice); assert.equal(Number(row.actual_net_kg),2600); }
    await assert.rejects(editInward(connection,ids[0],{...body,batchIds:[ids[0]],lines:[body.lines[0]]},actor.id),/inward has changed/);
    const newLine = {materialType:'MS',grade:'E350',widthMm:400,thicknessMm:3,coilQty:1,totalWeightKg:1000,ratePerKg:70};
    const expanded = await editInward(connection,ids[0],{...body,lines:[...body.lines,newLine]},actor.id);
    assert.equal(expanded.length,3);
    const [[newCoil]] = await connection.execute('SELECT invoice,vendor_code FROM coils WHERE id=?',[expanded[2]]);
    assert.equal(newCoil.invoice,body.invoice); assert.equal(newCoil.vendor_code,body.vendorCode);
    const [[newIdentity]] = await connection.execute('SELECT code FROM unit1_coil_identifiers WHERE batch_id=? AND coil_number=1',[expanded[2]]);
    assert.ok(!originalCodes.some(row=>row.code===newIdentity.code));
    await assert.rejects(editInward(connection,ids[0],body,actor.id),/inward has changed/);
  } finally { await connection.rollback(); connection.release(); await db.end(); }
});
