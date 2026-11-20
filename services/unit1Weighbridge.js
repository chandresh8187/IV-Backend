const fail = message => Object.assign(new Error(message), { status: 409 });
const grams = value => Math.round(Number(value) * 1000);
const marks = rows => rows.map(() => '?').join(',');
const pairWhere = (coils, alias='r') => coils.map(() => `(${alias}.coil_id=? AND ${alias}.coil_number=?)`).join(' OR ');
const pairArgs = coils => coils.flatMap(coil => [coil.coilId,coil.coilNumber]);

function weightInput(value) {
  if (!/^\d+(?:\.\d{1,3})?$/.test(String(value ?? '')) || !Number.isFinite(Number(value)) || Number(value)<=0 || Number(value)>100000000) throw Object.assign(new Error('Enter the net weighbridge material weight in kg, greater than zero, with up to three decimals.'), { status:400 });
  return grams(value)/1000;
}
async function lockWeights(c) { await c.execute('SELECT id FROM unit1_coil_weight_lock WHERE id=1 FOR UPDATE'); }

// A measured dispatch total is never invented for individual source coils.
// Dispatches sharing a physical coil form one connected reconciliation group.
async function coilGroup(c, dispatchId) {
  const ids = new Set([Number(dispatchId)]), coils = new Map();
  let changed = true, hasOpening = false;
  while (changed) {
    changed = false;
    const [sources] = await c.execute(`SELECT DISTINCT a.dispatch_id AS dispatchId,r.coil_id AS coilId,r.coil_number AS coilNumber
      FROM unit1_material_dispatch_allocations a JOIN unit1_material_stock_movements m ON m.id=a.source_movement_id
      LEFT JOIN unit1_production_runs r ON r.id=m.source_run_id WHERE a.dispatch_id IN (${marks([...ids])})`,[...ids]);
    for (const source of sources) {
      if (!source.coilId) { hasOpening=true; continue; }
      coils.set(`${source.coilId}:${source.coilNumber}`,{coilId:Number(source.coilId),coilNumber:Number(source.coilNumber)});
    }
    if (!coils.size) break;
    const members=[...coils.values()];
    const [related]=await c.execute(`SELECT DISTINCT a.dispatch_id AS id FROM unit1_material_dispatch_allocations a
      JOIN unit1_material_stock_movements m ON m.id=a.source_movement_id JOIN unit1_production_runs r ON r.id=m.source_run_id
      WHERE ${pairWhere(members)}`,pairArgs(members));
    for (const row of related) if (!ids.has(Number(row.id))) { ids.add(Number(row.id));changed=true; }
    if(ids.size>5000||coils.size>1000)throw fail('This reconciliation group is too large. Contact your administrator.');
  }
  const [dispatches]=await c.execute(`SELECT id,weighbridge_weight_kg AS weightKg FROM unit1_material_dispatches WHERE id IN (${marks([...ids])}) ORDER BY id FOR UPDATE`,[...ids]);
  if(!dispatches.some(row=>Number(row.id)===Number(dispatchId)))throw Object.assign(new Error('Dispatch not found.'),{status:404});
  return {dispatches,coils:[...coils.values()].sort((a,b)=>a.coilId-b.coilId||a.coilNumber-b.coilNumber),hasOpening};
}
async function startingWeights(c, members) {
  const ids=[...new Set(members.map(row=>row.coilId))];
  const [batches]=await c.execute(`SELECT id,actual_net_kg AS totalKg,coil_qty AS quantity,weight_recorded AS weightRecorded FROM coils WHERE id IN (${marks(ids)}) ORDER BY id FOR UPDATE`,ids);
  const [codes]=await c.execute(`SELECT batch_id AS coilId,coil_number AS coilNumber,CAST(code AS CHAR) AS code FROM unit1_coil_identifiers WHERE batch_id IN (${marks(ids)}) AND coil_number IS NOT NULL`,ids);
  return members.map(member=>{
    const batch=batches.find(row=>Number(row.id)===Number(member.coilId));
    const startingKg=null; // Only total inward weight is recorded; individual coil weight is unknown.
    if(!batch)throw fail('A source coil no longer has valid starting weight. Correct its inward record first.');
    return {...member,startingKg,code:codes.find(row=>Number(row.coilId)===member.coilId&&Number(row.coilNumber)===member.coilNumber)?.code||`${member.coilId}/${member.coilNumber}`};
  });
}
async function inspectReconciliation(c, dispatchId) {
  const group=await coilGroup(c,dispatchId);
  if(!group.coils.length)throw fail('Opening stock has no source coil to finish. Its weighbridge weight is still recorded.');
  if(group.hasOpening)throw fail('A related dispatch includes opening stock with no source coil. Its combined weight cannot safely be assigned to coils.');
  const coils=await startingWeights(c,group.coils);
  const [closed]=await c.execute(`SELECT settlement_id AS settlementId FROM unit1_coil_weight_members r WHERE ${pairWhere(coils)} LIMIT 1 FOR UPDATE`,pairArgs(coils));
  if(closed.length)return {settlementId:closed[0].settlementId,alreadyFinished:true};
  const missing=group.dispatches.filter(row=>row.weightKg==null).map(row=>row.id);
  if(missing.length)throw fail(`Record actual weighbridge weight for dispatch ${missing.join(', ')} before finishing these coils.`);
  const [runs]=await c.execute(`SELECT r.id,r.produced_pieces AS pieces,
    (SELECT COALESCE(SUM(b.pieces),0) FROM unit1_production_bundles b WHERE b.run_id=r.id) AS bundledPieces
    FROM unit1_production_runs r WHERE ${pairWhere(coils)} ORDER BY r.id FOR UPDATE`,pairArgs(coils));
  if(runs.some(row=>Number(row.pieces)!==Number(row.bundledPieces)))throw fail('A source coil has legacy production without stock bundles. Reconcile that history before finishing.');
  const [bundles]=await c.execute(`SELECT b.id,b.pieces,m.id AS movementId,m.quantity,
    (SELECT COALESCE(SUM(a.quantity),0) FROM unit1_material_dispatch_allocations a WHERE a.source_movement_id=m.id) AS dispatched
    FROM unit1_production_runs r JOIN unit1_production_bundles b ON b.run_id=r.id LEFT JOIN unit1_material_stock_movements m ON m.source_bundle_id=b.id
    WHERE ${pairWhere(coils)} ORDER BY b.id FOR UPDATE`,pairArgs(coils));
  const outstanding=bundles.reduce((sum,row)=>sum+Number(row.pieces)-Number(row.dispatched||0),0);
  if(!bundles.length||bundles.some(row=>!row.movementId||Number(row.quantity)!==Number(row.pieces)))throw fail('Some source production is missing from material stock. Run the stock migration before finishing.');
  if(outstanding!==0)throw fail(`${outstanding} produced nos from these coils are still undispatched. Dispatch all source material before finishing.`);
  const startingGrams=coils.some(row=>row.startingKg==null)?null:coils.reduce((sum,row)=>sum+grams(row.startingKg),0),materialGrams=group.dispatches.reduce((sum,row)=>sum+grams(row.weightKg),0);
  if(startingGrams!=null&&materialGrams>startingGrams)throw fail('Total weighbridge material weight exceeds the starting weight of the source coils. Correct the recorded weights first.');
  return {coils,dispatches:group.dispatches,startingKg:startingGrams==null?null:startingGrams/1000,materialKg:materialGrams/1000,scrapKg:startingGrams==null?null:(startingGrams-materialGrams)/1000,remainingKg:0,runIds:runs.map(row=>row.id)};
}
async function finishCoils(c, dispatchId, actorId) {
  const group=await inspectReconciliation(c,dispatchId);
  if(group.alreadyFinished)return group;
  const [entry]=await c.execute(`INSERT INTO unit1_coil_weight_settlements (closing_dispatch_id,starting_kg,material_kg,scrap_kg,source_snapshot,actor_user_id) VALUES (?,?,?,?,?,?)`,[dispatchId,group.startingKg,group.materialKg,group.scrapKg,JSON.stringify(group),actorId]);
  for(const member of group.coils)await c.execute('INSERT INTO unit1_coil_weight_members (settlement_id,coil_id,coil_number,starting_kg) VALUES (?,?,?,?)',[entry.insertId,member.coilId,member.coilNumber,member.startingKg]);
  for(const dispatch of group.dispatches)await c.execute('INSERT INTO unit1_coil_weight_dispatches (dispatch_id,settlement_id) VALUES (?,?)',[dispatch.id,entry.insertId]);
  for(const member of group.coils){
    await c.execute(`UPDATE unit1_production_runs SET run_seconds=COALESCE(run_seconds,0)+CASE WHEN status='running' AND last_resumed_at IS NOT NULL THEN GREATEST(TIMESTAMPDIFF(SECOND,last_resumed_at,UTC_TIMESTAMP(3)),0) ELSE 0 END,
      status='completed',last_resumed_at=NULL,completed_at=COALESCE(completed_at,UTC_TIMESTAMP(3)) WHERE coil_id=? AND coil_number=? AND status<>'completed'`,[member.coilId,member.coilNumber]);
    await c.execute(`UPDATE coils c SET status='consumed' WHERE c.id=? AND c.coil_qty<=(SELECT COUNT(DISTINCT r.coil_number) FROM unit1_production_runs r WHERE r.coil_id=c.id AND r.status='completed')`,[member.coilId]);
  }
  for(const runId of group.runIds)await c.execute("INSERT INTO unit1_production_events (run_id,event_type,note,actor_user_id) VALUES (?,'completed',?,?)",[runId,`Weighbridge reconciliation #${entry.insertId}: source coils finished; scrap ${(group.scrapKg==null?'not calculated (starting weight not recorded)':group.scrapKg.toFixed(3))} kg for the complete group.`,actorId]);
  return {...group,settlementId:entry.insertId};
}
async function refreshSettlement(c, settlementId, actorId) {
  const [[before]]=await c.execute('SELECT * FROM unit1_coil_weight_settlements WHERE id=? FOR UPDATE',[settlementId]);
  const [members]=await c.execute('SELECT coil_id AS coilId,coil_number AS coilNumber FROM unit1_coil_weight_members WHERE settlement_id=? ORDER BY coil_id,coil_number FOR UPDATE',[settlementId]);
  const coils=await startingWeights(c,members);
  const [dispatches]=await c.execute(`SELECT d.id,d.weighbridge_weight_kg AS weightKg FROM unit1_coil_weight_dispatches link JOIN unit1_material_dispatches d ON d.id=link.dispatch_id WHERE link.settlement_id=? ORDER BY d.id FOR UPDATE`,[settlementId]);
  if(dispatches.some(row=>row.weightKg==null))throw fail('A finished-coil reconciliation needs all recorded weighbridge weights.');
  const startingKg=coils.some(row=>row.startingKg==null)?null:coils.reduce((sum,row)=>sum+grams(row.startingKg),0)/1000, materialKg=dispatches.reduce((sum,row)=>sum+grams(row.weightKg),0)/1000;
  const scrapKg=startingKg==null?null:(grams(startingKg)-grams(materialKg))/1000;
  if(scrapKg!=null&&scrapKg<0)throw fail('This correction would make finished material heavier than the source coils. Check the weighbridge and inward weights.');
  const after={coils,dispatches,startingKg,materialKg,scrapKg};
  await c.execute('INSERT INTO unit1_dispatch_weight_revisions (settlement_id,actor_user_id,before_data,after_data) VALUES (?,?,?,?)',[settlementId,actorId,JSON.stringify(before),JSON.stringify(after)]);
  await c.execute('UPDATE unit1_coil_weight_settlements SET starting_kg=?,material_kg=?,scrap_kg=?,updated_at=CURRENT_TIMESTAMP(3) WHERE id=?',[startingKg,materialKg,scrapKg,settlementId]);
  for(const member of coils)await c.execute('UPDATE unit1_coil_weight_members SET starting_kg=? WHERE coil_id=? AND coil_number=?',[member.startingKg,member.coilId,member.coilNumber]);
  return after;
}
async function refreshCoilSettlements(c,coilId,actorId){
  const [rows]=await c.execute('SELECT DISTINCT settlement_id AS id FROM unit1_coil_weight_members WHERE coil_id=?',[coilId]);
  if(!rows.length)return;
  await lockWeights(c);
  for(const row of rows)await refreshSettlement(c,row.id,actorId);
}
async function reviseDispatchWeight(c,id,value,actorId){
  const weight=weightInput(value);
  await lockWeights(c);
  const [[before]]=await c.execute('SELECT * FROM unit1_material_dispatches WHERE id=? FOR UPDATE',[id]);
  if(!before)throw Object.assign(new Error('Dispatch not found.'),{status:404});
  const [[bundles]]=await c.execute('SELECT COUNT(*) AS count FROM unit1_material_dispatch_bundle_weights WHERE dispatch_id=?',[id]);
  if(Number(bundles.count))throw fail('This dispatch records a weight for each bundle. Correct its bundle weights instead of the total.');
  await c.execute('INSERT INTO unit1_dispatch_weight_revisions (dispatch_id,actor_user_id,before_data,after_data) VALUES (?,?,?,?)',[id,actorId,JSON.stringify(before),JSON.stringify({weighbridgeWeightKg:weight})]);
  await c.execute('UPDATE unit1_material_dispatches SET weighbridge_weight_kg=?,weighed_at=CURRENT_TIMESTAMP(3),weighed_by=? WHERE id=?',[weight,actorId,id]);
  const [[link]]=await c.execute('SELECT settlement_id AS id FROM unit1_coil_weight_dispatches WHERE dispatch_id=?',[id]);
  if(link)await refreshSettlement(c,link.id,actorId);
  return {id,weighbridgeWeightKg:weight};
}
const coilClosedSql = (coil='r.coil_id',number='r.coil_number')=>`EXISTS(SELECT 1 FROM unit1_coil_weight_members wm WHERE wm.coil_id=${coil} AND wm.coil_number=${number})`;
module.exports={weightInput,lockWeights,finishCoils,inspectReconciliation,refreshSettlement,refreshCoilSettlements,reviseDispatchWeight,coilClosedSql};

