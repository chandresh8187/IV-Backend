const test=require('node:test'),assert=require('node:assert/strict');
test('party transfers, merging, dispatch, QR, corrections and rollback preserve real production',{skip:process.env.UNIT1_MATERIAL_TRANSFER_DB_TEST!=='1'},async()=>{
 require('dotenv-flow').config({silent:true});assert.ok(['localhost','127.0.0.1','::1'].includes(process.env.UNIT1_DB_HOST||process.env.DB_HOST));
 const db=require('../config/unit1Db'),c=await db.getConnection();
 const {saveTransfer,transferHistory}=require('../services/unit1MaterialTransfers');
 const {listStock,materialBundles,traceStock}=require('../services/unit1MaterialRegister');
 const {saveDispatch,report}=require('../services/unit1DispatchNotes');
 const {correctProduction}=require('../services/unit1ProductionCorrection');
 const {monthlyProduction}=require('../services/unit1MonthlyProduction');
 const facade={execute:c.execute.bind(c),query:(sql,...args)=>sql.startsWith('SET TRANSACTION')?Promise.resolve([]):c.query(sql,...args),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}};
 const scoped={...facade,getConnection:async()=>facade};
 try{
  await require('../scripts/migrateUnit1MaterialTransfers').migrateUnit1MaterialTransfers(c);
  await require('../scripts/migrateUnit1MaterialTransfers').migrateUnit1MaterialTransfers(c);
  await c.beginTransaction();
  const [[actor]]=await c.execute('SELECT id FROM users LIMIT 1'),[[machine]]=await c.execute('SELECT id FROM unit1_machines LIMIT 1'),stamp=Date.now(),ab='AB TRANSFER '+stamp,ac='AC TRANSFER '+stamp;
  const reference='Transfer-'+stamp;
  const [coil]=await c.execute(`INSERT INTO coils(internal_id,supplier,supplier_coil_id,invoice,invoice_date,vendor_code,tc_number,grade,material_type,coil_qty,thickness_mm,width_mm,estimated_kg,gross_kg,tare_kg,actual_net_kg,rate_per_kg,status) VALUES(?,'Test',?,'Test','2026-11-20','TEST','TC','TEST','MS',1,2,298,5000,5000,0,5000,60,'in_stock')`,[reference,reference]);
  const fixtures=[];
  for(const [party,pieces] of [[ab,100],[ac,25]]){
   const [job]=await c.execute("INSERT INTO unit1_job_cards(job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by) VALUES('2026-11-20',?,'',200,'solar_mounting_structure','PURLIN','150X50X15','day',2300,'MS',298,2,'10',?)",[party,actor.id]);
   const [run]=await c.execute("INSERT INTO unit1_production_runs(machine_id,coil_id,coil_number,job_card_id,product_type,status,produced_pieces,created_by) VALUES(?,?,1,?,'solar_mounting_structure','completed',?,?)",[machine.id,coil.insertId,job.insertId,pieces,actor.id]);
   const [bundle]=await c.execute("INSERT INTO unit1_production_bundles(run_id,bundle_no,pieces,theoretical_used_kg,density_g_cm3,hole_scrap_kg,cut_blade_scrap_kg,shift,shift_date,member_name,entered_by,created_at) VALUES(?,1,?,?,7.85,?,?,'day','2026-11-20','PURLIN',?,'2026-11-20 10:00:00')",[run.insertId,pieces,pieces*5,pieces*.1,pieces*.02,actor.id]);
   fixtures.push({job:job.insertId,run:run.insertId,bundle:bundle.insertId});
  }
  let stocks=await listStock(c),from=stocks.find(r=>r.customerName===ab),target=stocks.find(r=>r.customerName===ac);
  await saveDispatch(c,{dcNumber:'AB-'+stamp,dcDate:'2026-11-20',destination:'other',requestId:'transfer_prior_dispatch_'+stamp,lines:[{key:from.key,dispatchQty:20,weightKg:98}]},actor.id);
  const monthlyBefore=await monthlyProduction(scoped,'2026-11');
  const input={key:from.key,targetParty:ac,quantity:60,requestId:'transfer_save_'+stamp};
  const saved=await saveTransfer(c,input,actor.id);assert.equal(saved.targetKey,target.key);
  assert.equal((await saveTransfer(c,input,actor.id)).id,saved.id);
  await assert.rejects(saveTransfer(c,{...input,quantity:1},actor.id),{status:409});
  stocks=await listStock(c);assert.equal(stocks.find(r=>r.key===from.key).availableNos,20);assert.equal(stocks.find(r=>r.key===target.key).availableNos,85);
  assert.equal((await materialBundles(c,target.key)).bundles.find(b=>b.id===fixtures[0].bundle).quantity,60);
  const trace=await traceStock(c,target.key,['ratePerKg']);assert.deepEqual(trace.originalParties,[ab,ac]);assert.equal(trace.sourceCoils[0].usedKg,425);assert.equal(trace.stock.producedNos,25);
  assert.deepEqual(await monthlyProduction(scoped,'2026-11'),monthlyBefore);
  assert.equal((await c.execute('SELECT customer_name FROM unit1_job_cards WHERE id=?',[fixtures[0].job]))[0][0].customer_name,ab);
  assert.equal((await c.execute('SELECT pieces FROM unit1_production_bundles WHERE id=?',[fixtures[0].bundle]))[0][0].pieces,100);
  await assert.rejects(saveTransfer(c,{...input,quantity:21,requestId:'transfer_excess_'+stamp},actor.id),{status:409});
  await saveDispatch(c,{dcNumber:'AC-'+stamp,dcDate:'2026-11-20',destination:'unit2',requestId:'transfer_target_dispatch_'+stamp,lines:[{key:target.key,dispatchQty:70,weightKg:340}]},actor.id);
  assert.equal((await listStock(c)).find(r=>r.key===target.key).availableNos,15);
  assert.equal((await report(c,'AC-'+stamp)).items[0].customerName,ac);
  const history=(await transferHistory(c)).items.find(r=>r.id===saved.id);assert.equal(history.customerName,ab);assert.equal(history.targetParty,ac);assert.equal(history.quantity,60);assert.ok(history.createdAt);
  await assert.rejects(correctProduction(c,fixtures[0].bundle,{pieces:79,expectedPieces:100,reason:'Would remove transferred stock',requestKey:'transfer_correction_bad_'+stamp},actor.id),{status:409});
  await correctProduction(c,fixtures[0].bundle,{pieces:90,expectedPieces:100,reason:'Verified original bundle count',requestKey:'transfer_correction_ok_'+stamp},actor.id);
  assert.equal((await listStock(c)).find(r=>r.key===from.key).availableNos,10);assert.equal((await listStock(c)).find(r=>r.key===target.key).availableNos,15);
  const third='AD TRANSFER '+stamp;
  const thirdSaved=await saveTransfer(c,{key:target.key,targetParty:third,quantity:10,requestId:'transfer_third_'+stamp},actor.id);
  assert.equal((await listStock(c)).find(r=>r.key===thirdSaved.targetKey).availableNos,10);
  await saveTransfer(c,{key:thirdSaved.targetKey,targetParty:ab,quantity:10,requestId:'transfer_back_'+stamp},actor.id);
  assert.equal((await listStock(c)).find(r=>r.key===from.key).availableNos,20);
  // When a template changes, ownership follows its material details, not its party.
  await c.execute("UPDATE unit1_job_cards SET section_size='160X60X15' WHERE id=?",[fixtures[0].job]);
  const updated=(await listStock(c)).find(r=>r.customerName===ac&&r.sectionSize==='160X60X15');assert.equal(updated.dispatchedNos,60);
  const before=(await transferHistory(c)).total;
  const faultDb={getConnection:async()=>({...facade,execute:(sql,...args)=>sql.startsWith('INSERT INTO unit1_material_party_transfer_allocations')?Promise.reject(Error('Simulated allocation failure')):c.execute(sql,...args),beginTransaction:()=>c.query('SAVEPOINT material_transfer_fault'),commit:()=>c.query('RELEASE SAVEPOINT material_transfer_fault'),rollback:()=>c.query('ROLLBACK TO SAVEPOINT material_transfer_fault')})};
  const source=(await listStock(c)).find(r=>r.customerName===ab&&r.availableNos>0);
  await assert.rejects(require('../services/unit1DbTransaction').unit1DbTransaction(faultDb,tx=>saveTransfer(tx,{key:source.key,targetParty:'FAULT TEST',quantity:1,requestId:'transfer_fault_'+stamp},actor.id)),/Simulated allocation failure/);
  assert.equal((await transferHistory(c)).total,before);
  // A later planning party correction may put two ownership buckets in one stock
  // key. Keep one bundle row, and allocate each bucket once during dispatch.
  await c.execute('UPDATE unit1_job_cards SET customer_name=? WHERE id=?',[ac,fixtures[0].job]);
  const merged=(await listStock(c)).find(r=>r.customerName===ac&&r.sectionSize==='160X60X15');
  const mergedBundles=await materialBundles(c,merged.key);assert.equal(mergedBundles.bundles.filter(b=>b.id===fixtures[0].bundle).length,1);
  assert.equal(mergedBundles.bundles.find(b=>b.id===fixtures[0].bundle).quantity,90);
  await saveDispatch(c,{dcNumber:'MERGED-'+stamp,dcDate:'2026-11-20',destination:'other',requestId:'transfer_merged_owners_'+stamp,lines:[{key:merged.key,dispatchQty:10,weightKg:48}]},actor.id);
  assert.equal((await listStock(c)).find(r=>r.key===merged.key).availableNos,0);
 }finally{await c.rollback();c.release();await db.end();}
});
