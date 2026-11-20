const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

test('four physical coils have distinct stable IDs, resolve their inward, retain legacy QR mapping, and appear correctly in production', {skip:process.env.UNIT1_PHYSICAL_COIL_DB_TEST !== '1'}, async () => {
  require('dotenv').config({quiet:true});
  assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.UNIT1_DB_HOST || process.env.DB_HOST));
  const db = require('../config/unit1Db');
  const { assignCoilCode } = require('../services/unit1CoilCode');
  const { ensurePhysicalCoils } = require('../services/unit1PhysicalCoils');
  const connection = await db.getConnection();
  const load = file => {
    const routes = {};
    const source = path.join(__dirname,'../routes',file);
    const localRequire = createRequire(source);
    const router = { use(){},get:(route,...handlers)=>{routes['GET '+route]=handlers.at(-1);},post:(route,...handlers)=>{routes['POST '+route]=handlers.at(-1);},put(){},delete(){} };
    const mocks = {express:{Router:()=>router},'../config/unit1Db':connection,'../middleware/unit1AuthMiddleware':()=>{},'../middleware/roleMiddleware':()=>()=>{},'./unit1JobCardRoutes':{}};
    vm.runInNewContext(fs.readFileSync(source,'utf8'), {require:name=>mocks[name] || localRequire(name),module:{exports:{}}});
    return routes;
  };
  const call = async (handler, params = {}, query = {}, role = 'superadmin') => {
    let error;
    const response = {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await handler({params,query,user:{role}},response,value=>{error=value;});
    if (error) throw error;
    return response;
  };
  try {
    await connection.beginTransaction();
    const legacy = 'U1-physical-test-'+Date.now();
    const [insert] = await connection.execute(`INSERT INTO coils (internal_id,supplier,supplier_coil_id,invoice,invoice_date,vendor_code,tc_number,grade,material_type,coil_qty,thickness_mm,width_mm,estimated_kg,gross_kg,tare_kg,actual_net_kg,rate_per_kg,status)
      VALUES (?,'Test vendor',?,'Four-coil invoice','2026-10-20','VENDOR-4','TC-4','E350','MS',4,3,254,4000,4000,0,4000,65,'in_stock')`, [legacy,legacy]);
    const batchId = insert.insertId;
    const batchCode = await assignCoilCode(connection,batchId,legacy);
    const [[machine]] = await connection.execute('SELECT id FROM unit1_machines LIMIT 1');
    const [[actor]] = await connection.execute('SELECT id FROM users LIMIT 1');
    const [run] = await connection.execute("INSERT INTO unit1_production_runs (machine_id,coil_id,coil_number,product_type,status,created_by) VALUES (?,?,3,'solar_mounting_structure','running',?)",[machine.id,batchId,actor.id]);
    await ensurePhysicalCoils(connection,batchId,4);
    const [identities] = await connection.execute('SELECT CAST(code AS CHAR) AS code,coil_number AS coilNumber FROM unit1_coil_identifiers WHERE batch_id=? AND coil_number IS NOT NULL ORDER BY coil_number', [batchId]);
    assert.equal(identities.length,4);
    assert.equal(new Set(identities.map(row=>row.code)).size,4);
    for (const row of identities) { assert.match(row.code,/^[1-9]\d{5}$/); assert.notEqual(row.code,batchCode); }
    await ensurePhysicalCoils(connection,batchId,4);
    const [again] = await connection.execute('SELECT CAST(code AS CHAR) AS code FROM unit1_coil_identifiers WHERE batch_id=? AND coil_number IS NOT NULL ORDER BY coil_number', [batchId]);
    assert.deepEqual(again.map(row=>row.code),identities.map(row=>row.code));
    const coils = load('unit1CoilRoutes.js');
    for (const identity of identities) {
      const lookup = await call(coils['GET /lookup/:internalId'], {internalId:identity.code});
      assert.equal(lookup.statusCode,200);
      assert.equal(lookup.body.data.coilId,batchId);
      assert.equal(lookup.body.data.coilNumber,identity.coilNumber);
      assert.equal(lookup.body.data.reference,identity.code);
      const details = await call(coils['GET /:id/physical/:number'],{id:String(batchId),number:String(identity.coilNumber)});
      assert.equal(details.body.data.invoice,'Four-coil invoice');
      assert.equal(details.body.data.vendorCode,'VENDOR-4');
      assert.equal(details.body.data.tcNumber,'TC-4');
      assert.equal(details.body.data.internalId,identity.code);
      assert.equal(details.body.data.perCoilWeightKg,null);
    }
    for (const reference of [legacy,batchCode]) {
      const qr = await call(coils['GET /scan/:internalId/:coilNumber'],{internalId:reference,coilNumber:'3'});
      assert.equal(qr.body.data.reference,identities[2].code);
      assert.equal(qr.body.data.coilNumber,3);
    }
    const ambiguous = await call(coils['GET /lookup/:internalId'],{internalId:batchCode});
    assert.equal(ambiguous.statusCode,404);
    const usage = await call(coils['GET /:id/usage'],{id:String(batchId)});
    assert.deepEqual(Array.from(usage.body.data.coils,row=>row.internalId),identities.map(row=>row.code));
    const production = load('unit1ProductionRoutes.js');
    const runs = await call(production['GET /runs']);
    const active = runs.body.data.find(row=>row.id===run.insertId);
    assert.equal(active.coilInternalId,identities[2].code);
    assert.equal(active.invoice,'Four-coil invoice'); assert.equal(active.vendorCode,'VENDOR-4');
    await ensurePhysicalCoils(connection,batchId,5);
    const [[fifth]] = await connection.execute('SELECT CAST(code AS CHAR) AS code FROM unit1_coil_identifiers WHERE batch_id=? AND coil_number=5',[batchId]);
    assert.ok(!identities.some(row=>row.code===fifth.code));
    await connection.execute('UPDATE coils SET coil_qty=3 WHERE id=?',[batchId]);
    assert.equal((await call(coils['GET /lookup/:internalId'],{internalId:identities[3].code})).statusCode,404);
    await connection.execute('UPDATE coils SET coil_qty=4 WHERE id=?',[batchId]);
    assert.equal((await call(coils['GET /lookup/:internalId'],{internalId:identities[3].code})).body.data.reference,identities[3].code);
    // Size stock combines weighted inwards while each physical coil keeps its own rate/QR.
    const {createQrRecord}=require('../services/unit1CoilQrGenerator');
    const input={vendorCode:'VENDOR-INWARD',invoice:'INV-TEST-1',tcNumber:'TC-TEST-1',materialType:'MS',grade:'E350',widthMm:4901.123,thicknessMm:2,coilQty:10,ratePerKg:60,totalWeightKg:10000,requestId:'stock_inward_first_'+Date.now()};
    const first=await createQrRecord(connection,input);
    const second=await createQrRecord(connection,{...input,ratePerKg:65,requestId:'stock_inward_second_'+Date.now()});
    assert.equal(await createQrRecord(connection,input),first);
    const differentGrade=await createQrRecord(connection,{...input,grade:'E250',requestId:'stock_grade_'+Date.now()});
    const differentMaterial=await createQrRecord(connection,{...input,materialType:'GP',grade:'GSM - 120',requestId:'stock_material_'+Date.now()});

    const firstLabels=await call(coils['GET /:id/labels'],{id:String(first)});
    const secondLabels=await call(coils['GET /:id/labels'],{id:String(second)});
    await connection.execute("INSERT INTO unit1_qr_scan_role_fields(role,fields_json) VALUES ('labour',?) ON DUPLICATE KEY UPDATE fields_json=VALUES(fields_json)",[JSON.stringify(['grade','vendorCode'])]);
    for(const label of firstLabels.body.data){
      const details=(await call(coils['GET /:id/physical/:number'],{id:String(first),number:String(label.coilNumber)})).body.data;
      assert.equal(details.vendorCode,'VENDOR-INWARD');assert.equal(details.invoice,'INV-TEST-1');assert.equal(details.tcNumber,'TC-TEST-1');assert.equal(details.grade,'E350');assert.equal(details.ratePerKg,60);
      const restricted=(await call(coils['GET /lookup/:internalId'],{internalId:label.internalId},{},'labour')).body.data;
      assert.deepEqual(Array.from(restricted.fields,f=>f.key),['vendorCode','grade']);assert.equal(restricted.ratePerKg,undefined);assert.equal(restricted.invoice,undefined);assert.equal(restricted.coilQty,undefined);
    }
    assert.equal(firstLabels.body.data.length,10);assert.equal(secondLabels.body.data.length,10);
    assert.equal(new Set([...firstLabels.body.data,...secondLabels.body.data].map(row=>row.internalId)).size,20);
    assert.equal((await call(coils['GET /:id/physical/:number'],{id:String(first),number:'1'})).body.data.ratePerKg,60);
    assert.equal((await call(coils['GET /:id/physical/:number'],{id:String(second),number:'1'})).body.data.ratePerKg,65);
    const groupSource=fs.readFileSync(path.join(__dirname,'../../IV_UNIT_1_APP/src/production/coilStockGroups.js'),'utf8');
    const {groupCoilStock}=await import('data:text/javascript;base64,'+Buffer.from(groupSource).toString('base64'));
    const readGroup=async()=>{const response=await call(coils['GET /']);return groupCoilStock(response.body.data.filter(row=>[first,second].includes(row.id)),{includeMaterialGrade:true})[0];};
    assert.equal((await readGroup()).remainingKg,20000);
    const allStock=(await call(coils['GET /'])).body.data;
    assert.equal(groupCoilStock(allStock.filter(r=>[first,second,differentGrade,differentMaterial].includes(r.id)),{includeMaterialGrade:true}).length,3);
    assert.equal((await require('../services/unit1CoilBalance').coilBalance(connection,first,1)).remainingKg,20000);

    const [weightedRun]=await connection.execute("INSERT INTO unit1_production_runs(machine_id,coil_id,coil_number,product_type,status,created_by) VALUES (?,?,1,'solar_mounting_structure','running',?)",[machine.id,first,actor.id]);
    await connection.execute("INSERT INTO unit1_production_bundles(run_id,bundle_no,pieces,member_name,entered_by,theoretical_used_kg,density_g_cm3,hole_scrap_kg) VALUES (?,1,100,'Stock test',?,467.86,7.85,10)",[weightedRun.insertId,actor.id]);
    await connection.execute("INSERT INTO unit1_hole_checks(run_id,check_type,checked_by,report_snapshot) VALUES (?,'recheck',?,?)",[weightedRun.insertId,actor.id,JSON.stringify({rejectedPieces:10,rejectedUsedKg:46.786,rejectedHoleScrapKg:1,rejectedWeightKg:45.786})]);
    const group=await readGroup();assert.equal(group.receivedKg,20000);assert.equal(group.usedKg,514.646);assert.equal(group.remainingKg,19485.354);
    const {changeStock}=require('../services/unit1CoilStock');
    const {coilBalance}=require('../services/unit1CoilBalance');
    const request=(g,action,targetKg)=>({action,materialType:g.materialType,grade:g.grade,widthMm:g.widthMm,thicknessMm:g.thicknessMm,targetKg,reason:'Physical stock verification',requestKey:'stock_test_'+Date.now()+'_'+Math.random().toString(36).slice(2),expected:g.records.map(r=>({id:r.id,fingerprint:r.stockFingerprint}))});
    const adjust=request(group,'adjust',18000);
    await changeStock(connection,adjust,'adjust',actor.id);
    assert.equal((await readGroup()).remainingKg,18000);
    assert.equal((await changeStock(connection,adjust,'adjust',actor.id)).retried,true);
    await assert.rejects(changeStock(connection,{...adjust,requestKey:adjust.requestKey+'_stale'},'adjust',actor.id),/Stock changed/);
    const beforeBalance=await coilBalance(connection,first,1);
    assert.equal(beforeBalance.remainingKg,18000);assert.equal(beforeBalance.startingKg,null);
    await connection.execute("INSERT INTO unit1_production_bundles(run_id,bundle_no,pieces,member_name,entered_by,theoretical_used_kg,density_g_cm3,hole_scrap_kg) VALUES (?,2,10,'Stock test',?,3000,7.85,2)",[weightedRun.insertId,actor.id]);
    assert.equal((await readGroup()).remainingKg,15000);
    assert.ok(Math.abs((await coilBalance(connection,first,1)).remainingKg-(beforeBalance.remainingKg-3000))<0.001);
    const {partyKey,getParty,listParties}=require('../services/unit1PartyMaterial');
    const customer='Cost review '+Date.now();
    const [stockItem]=await connection.execute("INSERT INTO unit1_material_stock_items(stock_key,customer_name,member_name,section_size,length_mm,material_type,grade,thickness_mm) VALUES (?,?,'Cost material','100x50',1000,'MS','E350',2)",['c'.repeat(48)+String(Date.now()).padStart(16,'0'),customer]);
    const [secondRun]=await connection.execute("INSERT INTO unit1_production_runs(machine_id,coil_id,coil_number,product_type,status,created_by) VALUES (?,?,1,'solar_mounting_structure','completed',?)",[machine.id,second,actor.id]);
    const [secondBundle]=await connection.execute("INSERT INTO unit1_production_bundles(run_id,bundle_no,pieces,member_name,entered_by,theoretical_used_kg,density_g_cm3,hole_scrap_kg) VALUES (?,1,100,'Cost material',?,1000,7.85,20)",[secondRun.insertId,actor.id]);
    const [[firstBundle]]=await connection.execute('SELECT id FROM unit1_production_bundles WHERE run_id=? AND bundle_no=1',[weightedRun.insertId]);
    for(const [bundleId,runId] of [[firstBundle.id,weightedRun.insertId],[secondBundle.insertId,secondRun.insertId]])await connection.execute("INSERT INTO unit1_material_stock_movements(item_id,movement_type,quantity,source_bundle_id,source_run_id,actor_user_id) VALUES (?,'production',100,?,?,?)",[stockItem.insertId,bundleId,runId,actor.id]);
    const costParty=await getParty(connection,partyKey(customer));
    assert.deepEqual(costParty.costing.rates.map(row=>row.ratePerKg),[60,65]);
    assert.equal(costParty.costing.averageRatePerKg,Number(((467.86*60+1000*65)/1467.86).toFixed(4)));
    assert.deepEqual(costParty.sources.map(row=>row.coilRatePerKg),[60,65]);
    const costList=await listParties(connection,customer);assert.equal(costList.items[0].costing.averageRatePerKg,costParty.costing.averageRatePerKg);
    await connection.execute('UPDATE coils SET rate_per_kg=70 WHERE id=?',[second]);
    assert.equal((await getParty(connection,partyKey(customer))).costing.averageRatePerKg,Number(((467.86*60+1000*70)/1467.86).toFixed(4)));
    const deleteInput=request(await readGroup(),'delete');
    await assert.rejects(changeStock(connection,deleteInput,'delete',actor.id),/active coil assignments/);
    await connection.execute("UPDATE unit1_production_runs SET status='completed' WHERE id=?",[weightedRun.insertId]);
    await changeStock(connection,deleteInput,'delete',actor.id);
    assert.equal(await readGroup(),undefined);
    const kept=(await call(coils['GET /'])).body.data;assert.ok(kept.some(r=>r.id===differentGrade));assert.ok(kept.some(r=>r.id===differentMaterial));
    assert.equal((await coilBalance(connection,differentGrade,1)).remainingKg,10000);

    const [[preserved]]=await connection.execute('SELECT COUNT(*) n FROM unit1_production_bundles WHERE run_id=?',[weightedRun.insertId]);
    assert.equal(preserved.n,2);
    const [[original]]=await connection.execute('SELECT actual_net_kg weight,status FROM coils WHERE id=?',[first]);
    assert.equal(original.weight,10000);assert.equal(original.status,'closed');
    const [[audit]]=await connection.execute('SELECT COUNT(*) n FROM unit1_coil_stock_changes WHERE request_key IN (?,?)',[adjust.requestKey,deleteInput.requestKey]);assert.equal(audit.n,2);
    const fresh=await createQrRecord(connection,{...input,requestId:'stock_after_archive_'+Date.now()});
    const list=await call(coils['GET /']);const newGroup=groupCoilStock(list.body.data.filter(row=>[first,second,fresh].includes(row.id)),{includeMaterialGrade:true})[0];assert.equal(newGroup.remainingKg,10000);assert.equal(newGroup.records.length,1);
  } finally { await connection.rollback(); connection.release(); await db.end(); }
});
