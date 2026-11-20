const test=require('node:test'),assert=require('node:assert/strict');
test('editing existing production updates balances, stock, planning, reports and audit atomically', {skip:process.env.UNIT1_PRODUCTION_CORRECTION_DB_TEST!=='1'},async()=>{
 require('dotenv-flow').config({silent:true});
 assert.ok(['localhost','127.0.0.1','::1'].includes(process.env.UNIT1_DB_HOST||process.env.DB_HOST));
 const db=require('../config/unit1Db'),c=await db.getConnection();
 const planning=require('../services/unit1Planning');
 const {correctProduction}=require('../services/unit1ProductionCorrection');
 const {captureProduction}=require('../services/unit1MaterialStock');
 const {productionWeightKg,holeScrapKg}=require('../services/unit1MaterialWeight');
 const {stockPositions}=require('../services/unit1CoilStock');
 const {sourceRows,materialKey,materialBundles,traceStock}=require('../services/unit1MaterialRegister');
 const {monthlyProduction}=require('../services/unit1MonthlyProduction');
 const {saveDispatch}=require('../services/unit1DispatchNotes');
 const facade={execute:c.execute.bind(c),query:(sql,...args)=>sql.startsWith('SET TRANSACTION')?Promise.resolve([]):c.query(sql,...args),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}};
 const scoped={...facade,getConnection:async()=>facade};
 try{
  await require('../scripts/migrateUnit1ProductionCorrections').migrateUnit1ProductionCorrections(c);
  await c.beginTransaction();
  const [[machine]]=await c.query('SELECT id FROM unit1_machines LIMIT 1');
  const [[actor]]=await c.query('SELECT id FROM users LIMIT 1');
  const stamp=Date.now();
  const spec={name:'Production correction test',structureType:'solar_mounting_structure',memberName:'Correction test',sectionSize:'150x50x15',cutLengthMm:2300,materialType:'MS',punchSize:'12x20',holes:[{profile:'web',punchSize:'12x20',targetMm:100}],allowedCoilSizes:[{widthMm:298,thicknessMm:2}]};
  const template=await planning.saveTemplate(scoped,null,spec,actor.id);
  const plan=await planning.savePlan(scoped,null,{partyName:'CORRECTION TEST '+stamp,projectName:'',planDate:'2026-11-19',shift:'day',requestKey:'correction_plan_'+stamp,lines:[{templateId:template.id,machineId:machine.id,quantity:120}]},actor.id);
  const [[line]]=await c.execute('SELECT job_card_id jobId FROM unit1_production_plan_lines WHERE plan_id=?',[plan.id]);
  const reference='Production-correction-'+stamp;
  const [coil]=await c.execute(`INSERT INTO coils(internal_id,supplier,supplier_coil_id,invoice,invoice_date,vendor_code,tc_number,grade,material_type,coil_qty,thickness_mm,width_mm,estimated_kg,gross_kg,tare_kg,actual_net_kg,rate_per_kg,status) VALUES(?,'Test',?,'Test','2026-11-19','TEST','TC','TEST','MS',1,2,298,5000,5000,0,5000,60,'in_stock')`,[reference,reference]);
  const [run]=await c.execute("INSERT INTO unit1_production_runs(machine_id,coil_id,coil_number,job_card_id,product_type,status,produced_pieces,created_by) VALUES(?,?,1,?,'solar_mounting_structure','running',100,?)",[machine.id,coil.insertId,line.jobId,actor.id]);
  const weight=productionWeightKg({widthMm:298,thicknessMm:2,lengthMm:2300,pieces:100,densityGcm3:7.85,cutBladeSizeMm:5,cutBladeThicknessMm:2});
  const holes=holeScrapKg({holes:spec.holes,thicknessMm:2,pieces:100});
  const [bundle]=await c.execute("INSERT INTO unit1_production_bundles(run_id,bundle_no,pieces,theoretical_used_kg,density_g_cm3,hole_scrap_kg,cut_blade_size_mm,cut_blade_scrap_kg,shift,shift_date,member_name,entered_by,created_at) VALUES(?,1,100,?,7.85,?,5,?,'day','2026-11-19','Correction test',?,'2026-11-19 10:00:00')",[run.insertId,weight.usedKg,holes,weight.bladeKg,actor.id]);
  await captureProduction(c,bundle.insertId);
  const source=(await sourceRows(c)).find(row=>row.id===bundle.insertId),key=materialKey(source);
  await saveDispatch(c,{dcNumber:'TEST-'+stamp,dcDate:'2026-11-19',destination:'unit2',requestId:'correction_dispatch_'+stamp,lines:[{key,dispatchQty:20,weightKg:200}]},actor.id);
  const beforeMonthly=await monthlyProduction(scoped,'2026-11');
  const input={pieces:120,expectedPieces:100,reason:'Verified count',requestKey:'correction_up_'+stamp};
  await correctProduction(c,bundle.insertId,input,actor.id);await correctProduction(c,bundle.insertId,input,actor.id);
  assert.equal((await c.execute('SELECT status FROM unit1_job_cards WHERE id=?',[line.jobId]))[0][0].status,'completed');
  await correctProduction(c,bundle.insertId,{pieces:64,expectedPieces:120,reason:'Corrected count',requestKey:'correction_down_'+stamp},actor.id);
  const [[saved]]=await c.execute('SELECT * FROM unit1_production_bundles WHERE id=?',[bundle.insertId]);
  assert.equal(saved.pieces,64);assert.equal(saved.entered_by,actor.id);assert.equal(Number(saved.cut_blade_size_mm),5);
  const [[updatedRun]]=await c.execute('SELECT produced_pieces quantity FROM unit1_production_runs WHERE id=?',[run.insertId]);assert.equal(updatedRun.quantity,64);
  assert.equal((await c.execute('SELECT status FROM unit1_job_cards WHERE id=?',[line.jobId]))[0][0].status,'open');
  const [position]=await stockPositions(c,[coil.insertId],true);assert.equal(position.usedKg,Number(saved.theoretical_used_kg));assert.ok(Math.abs(position.remainingKg-(5000-position.usedKg))<.00001);
  const [[movement]]=await c.execute("SELECT quantity FROM unit1_material_stock_movements WHERE source_bundle_id=? AND movement_type='production'",[bundle.insertId]);assert.equal(movement.quantity,64);
  const qr=await materialBundles(c,key);assert.equal(qr.bundles[0].quantity,64);assert.equal(qr.bundles[0].availableNos,44);assert.equal(qr.stock.key,key);
  const trace=await traceStock(c,key,[]);assert.equal(trace.sourceCoils[0].producedNos,64);assert.equal(trace.sourceCoils[0].usedKg,Number(saved.theoretical_used_kg));
  const report=await require('../services/unit1ProductionReport').productionReport(c,{date:'2026-11-19'});
  assert.equal(report.entries.find(row=>row.id===bundle.insertId).pieces,64);
  const afterMonthly=await monthlyProduction(scoped,'2026-11');
  const beforeFinished=Number((weight.usedKg-holes-weight.bladeKg).toFixed(3));
  const afterFinished=Number(saved.theoretical_used_kg)-Number(saved.hole_scrap_kg)-Number(saved.cut_blade_scrap_kg);
  assert.ok(Math.abs((afterMonthly.productionKg-beforeMonthly.productionKg)-(afterFinished-beforeFinished))<.003);
  for(const input of [
   {pieces:10,expectedPieces:64,reason:'Below dispatch',requestKey:'correction_dispatched_'+stamp},
   {pieces:65,expectedPieces:100,reason:'Stale form',requestKey:'correction_stale_'+stamp},
   {pieces:121,expectedPieces:64,reason:'Above plan',requestKey:'correction_plan_limit_'+stamp},
  ])await assert.rejects(correctProduction(c,bundle.insertId,input,actor.id),{status:409});
  await c.execute('UPDATE coils SET actual_net_kg=1000 WHERE id=?',[coil.insertId]);
  await assert.rejects(correctProduction(c,bundle.insertId,{pieces:120,expectedPieces:64,reason:'Above stock',requestKey:'correction_stock_limit_'+stamp},actor.id),{status:409});
  // An error after the bundle and stock writes must roll back the complete edit.
  const faultDb={getConnection:async()=>({
   ...facade,
   execute:(sql,...args)=>sql.startsWith('INSERT INTO unit1_production_bundle_revisions')?Promise.reject(new Error('Simulated audit failure')):c.execute(sql,...args),
   beginTransaction:()=>c.query('SAVEPOINT production_correction_fault'),
   commit:()=>c.query('RELEASE SAVEPOINT production_correction_fault'),
   rollback:()=>c.query('ROLLBACK TO SAVEPOINT production_correction_fault'),
  })};
  await assert.rejects(require('../services/unit1DbTransaction').unit1DbTransaction(faultDb,tx=>correctProduction(tx,bundle.insertId,{pieces:65,expectedPieces:64,reason:'Atomic rollback test',requestKey:'correction_fault_'+stamp},actor.id)),/Simulated audit failure/);
  assert.equal((await c.execute('SELECT produced_pieces quantity FROM unit1_production_runs WHERE id=?',[run.insertId]))[0][0].quantity,64);
  assert.equal((await c.execute("SELECT quantity FROM unit1_material_stock_movements WHERE source_bundle_id=? AND movement_type='production'",[bundle.insertId]))[0][0].quantity,64);
  await assert.rejects(correctProduction(c,bundle.insertId,{pieces:65,expectedPieces:64,reason:'Machine scope',requestKey:'correction_machine_scope_'+stamp},actor.id,0),{status:403});
  const [audits]=await c.execute('SELECT * FROM unit1_production_bundle_revisions WHERE bundle_id=? ORDER BY id',[bundle.insertId]);assert.equal(audits.length,2);
  assert.equal(JSON.parse(audits[0].before_data).bundle.pieces,100);assert.equal(JSON.parse(audits[1].after_data).bundle.pieces,64);
  assert.equal((await c.execute('SELECT pieces FROM unit1_production_bundles WHERE id=?',[bundle.insertId]))[0][0].pieces,64);
 }finally{await c.rollback();c.release();await db.end();}
});
