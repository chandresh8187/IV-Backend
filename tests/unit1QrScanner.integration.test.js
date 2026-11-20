const test=require('node:test'),assert=require('node:assert/strict');
test('actual invoice and material QR lookups enforce role fields without changing factory data',{skip:process.env.UNIT1_QR_SCANNER_DB_TEST!=='1'},async()=>{
 require('dotenv-flow').config({silent:true});assert.ok(['localhost','127.0.0.1','::1'].includes(process.env.UNIT1_DB_HOST||process.env.DB_HOST));
 const db=require('../config/unit1Db'),c=await db.getConnection(),moduleId=require.resolve('../config/unit1Db');
 const facade={execute:c.execute.bind(c),query:c.query.bind(c),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}};
 const scoped={...facade,getConnection:async()=>facade};
 try{
  await c.beginTransaction();const stamp=Date.now(),[[actor]]=await c.execute('SELECT id FROM users LIMIT 1'),[[machine]]=await c.execute('SELECT id FROM unit1_machines LIMIT 1');
  const [vendor]=await c.execute('INSERT INTO unit1_vendors(name,code,created_by) VALUES(?,?,?)',['QR scanner vendor '+stamp,'QRS-'+stamp,actor.id]);
  const stock=await require('../services/unit1StockRegister').addStock(c,{vendorId:vendor.insertId,invoice:'QRS-'+stamp,requestId:'qr_scanner_stock_'+stamp,lines:[{materialType:'MS',grade:'E350',widthMm:298,thicknessMm:2,totalWeightKg:5000,coilQty:3,ratePerKg:60,tcNumber:'TC-SCAN'}]},actor.id);
  const inward=stock.lines[0],qr=await require('../services/unit1StockQr').invoiceQr(c,inward.id,actor.id);
  const select=fields=>c.execute('INSERT INTO unit1_qr_scan_role_fields(role,fields_json) VALUES(?,?) ON DUPLICATE KEY UPDATE fields_json=VALUES(fields_json)',['supervisor',JSON.stringify(fields)]);
  // The route handler uses this connection so every test row remains uncommitted.
  require.cache[moduleId].exports=c;
  const {scanCoil}=require('../routes/unit1CoilRoutes'),service=require('../services/unit1QrScanner');
  const read=async reference=>{let answer;await scanCoil({params:{internalId:reference,coilNumber:'1'},user:{id:actor.id,role:'supervisor'}},{status(code){this.code=code;return this;},json(body){answer=body.data;}},error=>{throw error;});return service.coilDetails(answer);};
  await select(['grade']);let coil=await read(qr.code);assert.deepEqual(coil.fields.map(f=>f.key),['grade']);assert.doesNotMatch(JSON.stringify(coil),/invoice|vendor|ratePerKg|scanProof|stockQrId/);
  await select(['invoice','vendorName','tcNumber','ratePerKg']);coil=await read(qr.code);assert.equal(coil.fields.find(f=>f.key==='vendorName').value,'QR scanner vendor '+stamp);assert.equal(Number(coil.fields.find(f=>f.key==='ratePerKg').value),60);assert.equal(coil.fields.find(f=>f.key==='tcNumber').value,'TC-SCAN');
  const party='QR SCANNER PARTY '+stamp;
  const [job]=await c.execute("INSERT INTO unit1_job_cards(job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by) VALUES('2026-11-20',?,'',100,'solar_mounting_structure','PURLIN','150X50X15','day',2300,'MS',298,2,'12',?)",[party,actor.id]);
  const [run]=await c.execute("INSERT INTO unit1_production_runs(machine_id,coil_id,coil_number,stock_qr_id,job_card_id,product_type,status,produced_pieces,created_by) VALUES(?,?,1,?,?,'solar_mounting_structure','completed',70,?)",[machine.id,inward.id,qr.id,job.insertId,actor.id]);
  await c.execute("INSERT INTO unit1_production_bundles(run_id,bundle_no,pieces,theoretical_used_kg,density_g_cm3,hole_scrap_kg,cut_blade_scrap_kg,member_name,entered_by) VALUES(?,1,70,350,7.85,7,1.4,'PURLIN',?)",[run.insertId,actor.id]);
  for(const [index,offset] of [-20,20].entries())await c.execute("INSERT INTO unit1_job_card_holes(job_card_id,sequence_no,profile,punch_size,target_mm,center_offset_mm) VALUES(?,?,'web','12x20',500,?)",[job.insertId,index+1,offset]);
  const material=(await require('../services/unit1MaterialRegister').listStock(c)).find(r=>r.customerName===party),target={type:'material',key:material.key};
  const limited=await service.scanMaterial(scoped,target,['material.memberName','material.availableNos']);assert.deepEqual(limited.fields.map(f=>f.value),['PURLIN',70]);assert.doesNotMatch(JSON.stringify(limited),new RegExp(party));
  const full=await service.scanMaterial(scoped,target,['material.customerName','material.sourceCoils','material.coilUsage','material.bundles','vendorName','ratePerKg']);assert.equal(full.fields[0].value,party);assert.equal(full.bundles[0].quantity,70);assert.equal(full.sourceCoils[0].reference,qr.code);assert.equal(full.sourceCoils[0].usedKg,350);assert.equal(full.sourceCoils[0].fields.find(f=>f.key==='vendorName').value,'QR scanner vendor '+stamp);
  const empty=await service.scanMaterial(scoped,target,[]);assert.deepEqual(empty.fields,[]);assert.equal(Object.hasOwn(empty,'bundles'),false);assert.equal(Object.hasOwn(empty,'sourceCoils'),false);
  assert.equal(Object.hasOwn(empty,'jobCards'),false);
  const linked=await service.scanMaterial(scoped,target,['material.jobCards','material.jobCardPreview']);assert.equal(linked.jobCards.length,1);assert.deepEqual(linked.jobCards[0].preview.holes.map(h=>[Number(h.targetMm),Number(h.centerOffsetMm)]),[[500,-20],[500,20]]);assert.doesNotMatch(JSON.stringify(linked.jobCards),new RegExp(party));assert.equal(Object.hasOwn(linked.jobCards[0].details,'productionQty'),false);
  const snapshot={structureType:'solar_mounting_structure',memberName:'PURLIN',sectionSize:'150X50X15',cutLengthMm:2300,coilThicknessMm:2,sectionProfile:'c_lip',holes:[{profile:'web',punchSize:'12x20',targetMm:200,centerOffsetMm:0}]};
  await c.execute('UPDATE unit1_production_bundles SET job_snapshot=? WHERE run_id=?',[JSON.stringify(snapshot),run.insertId]);await c.execute('UPDATE unit1_job_card_holes SET target_mm=900 WHERE job_card_id=?',[job.insertId]);
  const savedPreview=await service.scanMaterial(scoped,target,['material.jobCardPreview']);assert.equal(Number(savedPreview.jobCards[0].preview.holes[0].targetMm),200);assert.equal(Object.hasOwn(savedPreview.jobCards[0],'details'),false);
  assert.equal((await c.execute('SELECT produced_pieces n FROM unit1_production_runs WHERE id=?',[run.insertId]))[0][0].n,70);
  assert.equal(Number((await c.execute('SELECT actual_net_kg n FROM coils WHERE id=?',[inward.id]))[0][0].n),5000);
 }finally{require.cache[moduleId].exports=db;await c.rollback();c.release();await db.end();}
});
