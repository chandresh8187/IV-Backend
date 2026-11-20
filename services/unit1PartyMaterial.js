const { createHash } = require('node:crypto');
const { lockWeights, weightInput, finishCoils, refreshSettlement } = require('./unit1Weighbridge');
const { physicalCoilCodeSql } = require('./unit1PhysicalCoils');
const { ensurePartyCode, resolvePartyCode, validPartyCode } = require('./unit1MaterialPartyCodes');
const fail = (status,message)=>Object.assign(new Error(message),{status});
const partyKeySql = "SHA2(LOWER(TRIM(COALESCE(i.customer_name,''))),256)";
const partyKey = name=>createHash('sha256').update(String(name||'').trim().toLowerCase()).digest('hex');
const validKey = key=>typeof key==='string'&&/^[a-f0-9]{64}$/.test(key);
const requestKey = value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(value))throw fail(400,'A valid request ID is required.');return value;};
const whole = (value,label)=>{if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)>1000000)throw fail(400,`${label} must be a positive whole number, up to 1,000,000.`);return Number(value);};
const positiveId = value=>{if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail(400,'Select a valid production source or bundle.');return Number(value);};
const sourceUsed = '(SELECT COALESCE(SUM(a.quantity),0) FROM unit1_material_dispatch_allocations a WHERE a.source_movement_id=m.id)';
const itemColumns = 'i.id AS itemId,i.customer_name AS customerName,i.member_name AS memberName,i.section_size AS sectionSize,i.length_mm AS lengthMm,i.material_type AS materialType,i.grade,i.thickness_mm AS thicknessMm';
const itemSnapshot = row=>({itemId:Number(row.itemId),customerName:row.customerName,memberName:row.memberName,sectionSize:row.sectionSize,lengthMm:Number(row.lengthMm),materialType:row.materialType,grade:row.grade,thicknessMm:Number(row.thicknessMm)});
const sourceFrom = 'FROM unit1_material_stock_movements m JOIN unit1_material_stock_items i ON i.id=m.item_id';
const productionWhere = "m.movement_type='production' AND m.quantity>0";

function productionCosting(rows){
 const groups=new Map();let usedKg=0,cost=0,incomplete=false,totalProducedNos=0,unknownRateNos=0;
 for(const row of rows){
  const nos=Number(row.producedNos||0),rate=row.coilRatePerKg==null?null:Number(row.coilRatePerKg),kg=row.coilUsedKg==null?null:Number(row.coilUsedKg);
  totalProducedNos+=nos;
  if(rate==null||!Number.isFinite(rate)||rate<=0){incomplete=true;unknownRateNos+=nos;continue;}
  if(!groups.has(rate))groups.set(rate,{ratePerKg:rate,usedKg:0,producedNos:0,cost:0,weightPending:false});
  const group=groups.get(rate);group.producedNos+=nos;
  if(kg==null||!Number.isFinite(kg)||kg<0){incomplete=true;group.weightPending=true;continue;}
  usedKg+=kg;cost+=rate*kg;group.usedKg+=kg;group.cost+=rate*kg;
 }
 return {rates:[...groups.values()].sort((a,b)=>a.ratePerKg-b.ratePerKg).map(row=>({...row,productionPercent:totalProducedNos>0?Number((row.producedNos/totalProducedNos*100).toFixed(2)):0,usedKg:row.weightPending?null:Number(row.usedKg.toFixed(4)),cost:row.weightPending?null:Number(row.cost.toFixed(2))})),totalProducedNos,unknownRateNos,unknownRatePercent:totalProducedNos>0?Number((unknownRateNos/totalProducedNos*100).toFixed(2)):0,percentageBasis:'produced-nos',usedKg:Number(usedKg.toFixed(4)),materialCost:incomplete?null:Number(cost.toFixed(2)),averageRatePerKg:incomplete||usedKg<=0?null:Number((cost/usedKg).toFixed(4)),incomplete};
}
async function partyCosts(db,keys){
 if(!keys.length)return new Map();
 const [rows]=await db.execute(`SELECT ${partyKeySql} partyKey,m.quantity producedNos,c.rate_per_kg coilRatePerKg,b.theoretical_used_kg coilUsedKg ${sourceFrom} LEFT JOIN unit1_production_runs r ON r.id=m.source_run_id LEFT JOIN coils c ON c.id=r.coil_id LEFT JOIN unit1_production_bundles b ON b.id=m.source_bundle_id WHERE ${productionWhere} AND BINARY ${partyKeySql} IN (${keys.map(()=>'BINARY ?').join(',')})`,keys);
 return new Map(keys.map(key=>[key,productionCosting(rows.filter(row=>row.partyKey===key))]));
}
async function listParties(db,q='',page=1,status='all'){
 const statuses={all:'',available:'WHERE availableNos>0',partial:'WHERE availableNos>0 AND dispatchedNos>0',dispatched:'WHERE availableNos=0 AND dispatchedNos>0'};
 if(!Object.hasOwn(statuses,status))throw fail(400,'Select a valid stock status.');
 const statusWhere=statuses[status];
 const filter=q?" AND CONCAT_WS(' ',i.customer_name,i.member_name,i.section_size,i.material_type) LIKE ? ESCAPE '!'":'';
 const args=q?['%'+q.replace(/[!%_]/g,v=>'!'+v)+'%']:[];
 // Search chooses parties, then all their material quantities are included.
 const eligible=`SELECT DISTINCT ${partyKeySql} ${sourceFrom} WHERE ${productionWhere}${filter}`;
 const from=`${sourceFrom} WHERE ${productionWhere} AND ${partyKeySql} IN (${eligible})`;
 const grouped=`SELECT ${partyKeySql} AS partyKey,MIN(i.customer_name) AS customerName,GROUP_CONCAT(DISTINCT i.member_name ORDER BY i.member_name SEPARATOR ', ') AS materials,SUM(m.quantity) AS producedNos,SUM(${sourceUsed}) AS dispatchedNos,SUM(m.quantity-${sourceUsed}) AS availableNos ${from} GROUP BY ${partyKeySql}`;
 const [[summary]]=await db.execute(`SELECT COUNT(*) AS total,COALESCE(SUM(producedNos),0) AS producedNos,COALESCE(SUM(dispatchedNos),0) AS dispatchedNos,COALESCE(SUM(availableNos),0) AS availableNos FROM (${grouped}) parties ${statusWhere}`,args);
 const [items]=await db.execute(`SELECT * FROM (${grouped}) parties ${statusWhere} ORDER BY customerName,partyKey LIMIT 30 OFFSET ${(page-1)*30}`,args);
 const costs=await partyCosts(db,items.map(item=>item.partyKey));
 for(const item of items){item.partyCode=await ensurePartyCode(db,item.partyKey);item.costing=costs.get(item.partyKey);}
 return {items,...summary,page,pageSize:30,status};
}
async function getParty(db,key){
 if(validPartyCode(String(key).trim().toUpperCase()))key=await resolvePartyCode(db,key);
 if(!validKey(key))throw fail(400,'Invalid party QR.');
 const [sources]=await db.execute(`SELECT m.id AS movementId,m.source_bundle_id AS productionBundleId,m.source_job_card_id AS jobCardId,(SELECT pl.plan_id FROM unit1_production_plan_lines pl WHERE pl.job_card_id=m.source_job_card_id) AS planningId,(SELECT pl.template_id FROM unit1_production_plan_lines pl WHERE pl.job_card_id=m.source_job_card_id) AS templateId,r.coil_id AS coilId,r.coil_number AS coilNumber,${physicalCoilCodeSql()} AS coilCode,m.quantity AS producedNos,c.rate_per_kg AS coilRatePerKg,(SELECT b.theoretical_used_kg FROM unit1_production_bundles b WHERE b.id=m.source_bundle_id) AS coilUsedKg,${sourceUsed} AS dispatchedNos,${itemColumns},
  (SELECT COALESCE(SUM(pb.quantity),0) FROM unit1_material_packed_bundles pb WHERE pb.source_movement_id=m.id) AS packedNos,
  (SELECT COALESCE(SUM(bw.quantity),0) FROM unit1_material_dispatch_bundle_weights bw WHERE bw.source_movement_id=m.id) AS packedDispatchedNos
  ${sourceFrom} LEFT JOIN unit1_production_runs r ON r.id=m.source_run_id LEFT JOIN coils c ON c.id=r.coil_id WHERE ${productionWhere} AND BINARY ${partyKeySql}=BINARY ? ORDER BY m.id`,[key]);
 if(!sources.length)throw fail(404,'No produced material belongs to this party. The job party may have been corrected; use its updated QR label.');
 const [bundles]=await db.execute(`SELECT pb.id,pb.quantity,pb.item_snapshot AS originalDetails,pb.created_at AS createdAt,m.id AS movementId,m.source_bundle_id AS productionBundleId,m.source_job_card_id AS jobCardId,(SELECT pl.plan_id FROM unit1_production_plan_lines pl WHERE pl.job_card_id=m.source_job_card_id) AS planningId,(SELECT pl.template_id FROM unit1_production_plan_lines pl WHERE pl.job_card_id=m.source_job_card_id) AS templateId,r.coil_id AS coilId,r.coil_number AS coilNumber,${physicalCoilCodeSql()} AS coilCode,${itemColumns},
  pb.quantity-(SELECT COALESCE(SUM(bw.quantity),0) FROM unit1_material_dispatch_bundle_weights bw WHERE bw.bundle_id=pb.id) AS availableNos
  FROM unit1_material_packed_bundles pb JOIN unit1_material_stock_movements m ON m.id=pb.source_movement_id JOIN unit1_material_stock_items i ON i.id=m.item_id LEFT JOIN unit1_production_runs r ON r.id=m.source_run_id LEFT JOIN coils c ON c.id=r.coil_id WHERE BINARY ${partyKeySql}=BINARY ? ORDER BY pb.id DESC`,[key]);
 const customerName=sources[0].customerName;
 const partyCode=await ensurePartyCode(db,key);
 return {partyKey:key,partyCode,customerName,costing:productionCosting(sources),producedNos:sources.reduce((n,r)=>n+Number(r.producedNos),0),dispatchedNos:sources.reduce((n,r)=>n+Number(r.dispatchedNos),0),availableNos:sources.reduce((n,r)=>n+Number(r.producedNos)-Number(r.dispatchedNos),0),
  sources:sources.map(row=>({...row,unpackedNos:Number(row.producedNos)-Number(row.packedNos)-(Number(row.dispatchedNos)-Number(row.packedDispatchedNos))})),
  bundles:bundles.map(row=>{const original=JSON.parse(row.originalDetails);return {...row,originalDetails:original,needsReprint:Number(original.itemId)!==Number(row.itemId),partyKey:key,partyCode,qrPayload:`https://webapp.ivsquarestructure.com/unit1/production/material-stock?party=${partyCode}`,labelId:`U1-MB-${row.id}`};})};
}
async function packBundle(c,body={},actorId){
 const movementId=positiveId(body?.movementId),quantity=whole(body?.quantity,'Bundle quantity'),key=requestKey(body?.requestId);
 await lockWeights(c);
 const [[prior]]=await c.execute('SELECT * FROM unit1_material_packed_bundles WHERE request_key=? FOR UPDATE',[key]);
 if(prior){if(Number(prior.source_movement_id)!==movementId||Number(prior.quantity)!==quantity||Number(prior.actor_user_id)!==Number(actorId))throw fail(409,'This request was already used for another bundle.');return {id:prior.id};}
 const [[source]]=await c.execute(`SELECT m.id,m.quantity,${itemColumns},${partyKeySql} AS partyKey,${sourceUsed} AS dispatchedNos ${sourceFrom} WHERE m.id=? AND ${productionWhere} FOR UPDATE`,[movementId]);
 if(!source)throw fail(404,'Production source not found.');
 if(!validKey(body.partyKey)||source.partyKey!==body.partyKey)throw fail(409,'The party changed. Refresh stock before creating a bundle.');
 const [[packed]]=await c.execute('SELECT COALESCE(SUM(quantity),0) AS quantity FROM unit1_material_packed_bundles WHERE source_movement_id=?',[movementId]);
 const [[labelled]]=await c.execute('SELECT COALESCE(SUM(quantity),0) AS quantity FROM unit1_material_dispatch_bundle_weights WHERE source_movement_id=?',[movementId]);
 const available=Number(source.quantity)-Number(packed.quantity)-(Number(source.dispatchedNos)-Number(labelled.quantity));
 if(quantity>available)throw fail(409,`Only ${available} produced nos are available to pack. Refresh stock.`);
 const [entry]=await c.execute('INSERT INTO unit1_material_packed_bundles (source_movement_id,quantity,item_snapshot,request_key,actor_user_id) VALUES (?,?,?,?,?)',[movementId,quantity,JSON.stringify(itemSnapshot(source)),key,actorId]);
 return {id:entry.insertId};
}
function normalizePartyDispatch(body={}){
 if(!validKey(body?.partyKey))throw fail(400,'Select a party.');
 requestKey(body.requestId);
 if(!['unit2','other'].includes(body.destination))throw fail(400,'Select To Unit 2 or To Other.');
 if(typeof (body.note??'')!=='string'||(body.note||'').trim().length>255||/[\x00-\x1f]/.test(body.note||''))throw fail(400,'Enter a valid dispatch reference.');
 if(body.finishCoils!=null&&typeof body.finishCoils!=='boolean')throw fail(400,'Choose whether source production is finished.');
 if(!Array.isArray(body.lines)||body.lines.length<1||body.lines.length>100)throw fail(400,'Select 1 to 100 bundles for dispatch.');
 const lines=body.lines.map(row=>({bundleId:positiveId(row?.bundleId),quantity:whole(row?.quantity,'Dispatch quantity'),weightKg:weightInput(row?.weighbridgeWeightKg)})).sort((a,b)=>a.bundleId-b.bundleId);
 if(new Set(lines.map(r=>r.bundleId)).size!==lines.length)throw fail(400,'Select each bundle only once.');
 const totalNos=lines.reduce((n,r)=>n+r.quantity,0),totalWeight=lines.reduce((n,r)=>n+Math.round(r.weightKg*1000),0)/1000;
 if(totalNos>1000000||totalWeight>100000000)throw fail(400,'Dispatch totals exceed the supported limit.');
 return {...body,note:(body.note||'').trim(),finishCoils:body.finishCoils===true,lines,totalNos,totalWeight};
}
async function dispatchParty(c,body,actorId){
 const v=normalizePartyDispatch(body);await lockWeights(c);
 const [[prior]]=await c.execute('SELECT * FROM unit1_material_dispatches WHERE request_key=? FOR UPDATE',[v.requestId]);
 if(prior){
  const snapshot=JSON.parse(prior.item_snapshot);
  if(snapshot.partyKey!==v.partyKey||JSON.stringify(snapshot.requestLines)!==JSON.stringify(v.lines)||Number(prior.actor_user_id)!==Number(actorId)||prior.destination!==v.destination||(prior.note||'')!==v.note||Boolean(prior.finish_requested)!==v.finishCoils)throw fail(409,'This request was already used for another dispatch.');
  return {id:prior.id,quantity:Number(prior.quantity),weighbridgeWeightKg:Number(prior.weighbridge_weight_kg)};
 }
 const sources=new Map(),details=[];
 for(const line of v.lines){
  const [[bundle]]=await c.execute(`SELECT pb.id,pb.quantity,m.id AS movementId,m.quantity AS sourceQuantity,${itemColumns},${partyKeySql} AS partyKey,${sourceUsed} AS sourceDispatched
   FROM unit1_material_packed_bundles pb JOIN unit1_material_stock_movements m ON m.id=pb.source_movement_id JOIN unit1_material_stock_items i ON i.id=m.item_id WHERE pb.id=? FOR UPDATE`,[line.bundleId]);
  if(!bundle)throw fail(404,'Bundle not found.');
  if(bundle.partyKey!==v.partyKey)throw fail(409,'A selected bundle belongs to a different party. Refresh and check its label.');
  const [[used]]=await c.execute('SELECT COALESCE(SUM(quantity),0) AS quantity FROM unit1_material_dispatch_bundle_weights WHERE bundle_id=?',[line.bundleId]);
  if(line.quantity>Number(bundle.quantity)-Number(used.quantity))throw fail(409,`Bundle U1-MB-${line.bundleId} has insufficient undispatched nos.`);
  const source=sources.get(bundle.movementId)||{quantity:0,bundle};source.quantity+=line.quantity;sources.set(bundle.movementId,source);
  details.push({...line,movementId:bundle.movementId,...itemSnapshot(bundle)});
 }
 for(const source of sources.values())if(source.quantity>Number(source.bundle.sourceQuantity)-Number(source.bundle.sourceDispatched))throw fail(409,'Produced stock changed. Refresh before dispatching these bundles.');
 const snapshot={partyKey:v.partyKey,requestLines:v.lines,bundles:details};
 const [entry]=await c.execute(`INSERT INTO unit1_material_dispatches (item_id,quantity,destination,note,request_key,actor_user_id,item_snapshot,weighbridge_weight_kg,weighed_at,weighed_by,finish_requested) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3),?,?)`,[details[0].itemId,v.totalNos,v.destination,v.note||null,v.requestId,actorId,JSON.stringify(snapshot),v.totalWeight,actorId,v.finishCoils?1:0]);
 for(const [movementId,source]of sources)await c.execute('INSERT INTO unit1_material_dispatch_allocations (dispatch_id,source_movement_id,quantity) VALUES (?,?,?)',[entry.insertId,movementId,source.quantity]);
 for(const row of details)await c.execute('INSERT INTO unit1_material_dispatch_bundle_weights (dispatch_id,bundle_id,source_movement_id,quantity,weight_kg,item_snapshot) VALUES (?,?,?,?,?,?)',[entry.insertId,row.bundleId,row.movementId,row.quantity,row.weightKg,JSON.stringify(row)]);
 const reconciliation=v.finishCoils?await finishCoils(c,entry.insertId,actorId):null;
 return {id:entry.insertId,quantity:v.totalNos,weighbridgeWeightKg:v.totalWeight,reconciliation};
}
async function reviseBundleWeight(c,dispatchId,bundleId,value,actorId){
 const weight=weightInput(value);await lockWeights(c);
 const [[dispatch]]=await c.execute('SELECT * FROM unit1_material_dispatches WHERE id=? FOR UPDATE',[dispatchId]);
 const [[before]]=await c.execute('SELECT * FROM unit1_material_dispatch_bundle_weights WHERE dispatch_id=? AND bundle_id=? FOR UPDATE',[dispatchId,bundleId]);
 if(!dispatch||!before)throw fail(404,'Dispatched bundle not found.');
 await c.execute('INSERT INTO unit1_dispatch_weight_revisions (dispatch_id,actor_user_id,before_data,after_data) VALUES (?,?,?,?)',[dispatchId,actorId,JSON.stringify({dispatch,bundle:before}),JSON.stringify({bundleId,weightKg:weight})]);
 await c.execute('UPDATE unit1_material_dispatch_bundle_weights SET weight_kg=? WHERE dispatch_id=? AND bundle_id=?',[weight,dispatchId,bundleId]);
 await c.execute('UPDATE unit1_material_dispatches SET weighbridge_weight_kg=(SELECT SUM(weight_kg) FROM unit1_material_dispatch_bundle_weights WHERE dispatch_id=?),weighed_at=CURRENT_TIMESTAMP(3),weighed_by=? WHERE id=?',[dispatchId,actorId,dispatchId]);
 const [[link]]=await c.execute('SELECT settlement_id AS id FROM unit1_coil_weight_dispatches WHERE dispatch_id=?',[dispatchId]);
 if(link)await refreshSettlement(c,link.id,actorId);
 return {id:dispatchId,bundleId,weightKg:weight};
}
module.exports={partyKeySql,partyKey,validKey,listParties,getParty,packBundle,normalizePartyDispatch,dispatchParty,reviseBundleWeight};

module.exports.productionCosting=productionCosting;
