const {createHash}=require('node:crypto');
const {historicalJobSql}=require('./unit1JobHistory');
const {physicalCoilCodeSql}=require('./unit1PhysicalCoils');
const {FIELDS,DEFAULT_FIELDS}=require('./unit1CoilQr');
const clean=v=>String(v??'').trim();
const materialKey=r=>createHash('sha256').update(JSON.stringify([clean(r.customerName).toUpperCase(),clean(r.memberName).toUpperCase(),clean(r.sectionSize).toUpperCase().replace(/\s/g,'').replace(/[×*]/g,'X'),Number(r.lengthMm),clean(r.materialType).toUpperCase(),clean(r.grade).toUpperCase(),Number(r.thicknessMm)])).digest('hex');
function summarize(rows){
 const groups=new Map();
 for(const r of rows){const key=materialKey(r);
 if(!groups.has(key))groups.set(key,{key,customerName:clean(r.customerName),memberName:clean(r.memberName),sectionSize:r.sectionSize,lengthMm:r.lengthMm,materialType:r.materialType,grade:r.grade,thicknessMm:r.thicknessMm,producedNos:0,transferredInNos:0,transferredOutNos:0,dispatchedNos:0,availableNos:0,lastProducedAt:null});
 const g=groups.get(key);g.producedNos+=Number(r.originalProducedNos??r.producedNos);g.transferredInNos+=Number(r.transferredInNos||0);g.transferredOutNos+=Number(r.transferredOutNos||0);g.dispatchedNos+=Number(r.dispatchedNos||0);g.availableNos+=Number(r.producedNos)-Number(r.dispatchedNos||0);if(!g.lastProducedAt||new Date(r.createdAt)>new Date(g.lastProducedAt))g.lastProducedAt=r.createdAt;
 }
 return [...groups.values()].sort((a,b)=>a.customerName.localeCompare(b.customerName)||a.memberName.localeCompare(b.memberName)||a.key.localeCompare(b.key));
}
async function sourceRows(db,correction=null){
 if(db.getConnection){const c=await db.getConnection();try{await c.beginTransaction();const rows=await sourceRows(c,correction);await c.commit();return rows;}catch(e){await c.rollback();throw e;}finally{c.release();}}
 const [rows]=await db.execute(historicalJobSql(`SELECT b.id,b.bundle_no bundleNo,r.id runId,r.coil_id coilId,r.coil_number coilNumber,${physicalCoilCodeSql()} coilReference,b.theoretical_used_kg usedKg,b.hole_scrap_kg holeScrapKg,b.cut_blade_scrap_kg cutBladeScrapKg,c.width_mm widthMm,c.rate_per_kg ratePerKg,c.invoice,DATE_FORMAT(c.invoice_date,'%Y-%m-%d') invoiceDate,(SELECT v.name FROM unit1_coil_invoices vi JOIN unit1_vendors v ON v.id=vi.vendor_id WHERE vi.id=c.invoice_group_id) vendorName,c.vendor_code vendorCode,c.tc_number tcNumber,c.coil_qty coilQty,CASE WHEN c.weight_recorded=0 THEN NULL ELSE c.actual_net_kg END totalWeightKg,c.received_at receivedAt,(SELECT ci.total_weight_kg FROM unit1_coil_invoices ci WHERE ci.id=c.invoice_group_id) invoiceTotalWeightKg,b.pieces producedNos,b.created_at createdAt,j.customer_name customerName,j.member_name memberName,j.section_size sectionSize,j.cut_length_mm lengthMm,c.material_type materialType,c.grade,c.thickness_mm thicknessMm,
 (SELECT COALESCE(SUM(a.quantity),0) FROM unit1_material_dispatch_allocations a JOIN unit1_material_stock_movements m ON m.id=a.source_movement_id WHERE m.source_bundle_id=b.id AND m.movement_type='production') legacyDispatchedNos,
 (SELECT COALESCE(SUM(p.quantity-(SELECT COALESCE(SUM(w.quantity),0) FROM unit1_material_dispatch_bundle_weights w WHERE w.bundle_id=p.id)),0) FROM unit1_material_packed_bundles p JOIN unit1_material_stock_movements m ON m.id=p.source_movement_id WHERE m.source_bundle_id=b.id AND m.movement_type='production') reservedNos
 FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id JOIN unit1_job_cards j ON j.id=r.job_card_id JOIN coils c ON c.id=r.coil_id ORDER BY b.id`));
 if(correction)for(const row of rows)if(Number(row.id)===Number(correction.bundleId))row.producedNos=correction.pieces;
 return require('./unit1MaterialOwnership').ownershipRows(db,rows);
}
async function listStock(db){return summarize(await sourceRows(db));}
module.exports={summarize,listStock,sourceRows,materialKey};

function traceRows(rows,key,allowedFields=DEFAULT_FIELDS){
 if(!/^[a-f0-9]{64}$/.test(String(key)))throw Object.assign(new Error('Invalid material stock QR.'),{status:400});
 const own=rows.filter(r=>materialKey(r)===key);if(!own.length)throw Object.assign(new Error('Material stock was not found. Its details may have changed.'),{status:404});
 const sources=new Map();for(const r of own){const sourceKey=`${r.coilId}:${r.coilNumber}`;if(!sources.has(sourceKey))sources.set(sourceKey,{key:sourceKey,reference:r.coilReference,producedNos:0,usedKg:0,holeScrapKg:0,cutBladeScrapKg:null,firstProducedAt:r.createdAt,lastProducedAt:r.createdAt,fields:FIELDS.filter(f=>allowedFields.includes(f.key)).map(f=>({...f,value:r[f.key]??null}))});const source=sources.get(sourceKey);source.producedNos+=Number(r.producedNos);source.usedKg=source.usedKg==null||r.usedKg==null?null:source.usedKg+Number(r.usedKg);source.holeScrapKg=source.holeScrapKg==null||r.holeScrapKg==null?null:source.holeScrapKg+Number(r.holeScrapKg);if(r.cutBladeScrapKg!=null)source.cutBladeScrapKg=Number(source.cutBladeScrapKg||0)+Number(r.cutBladeScrapKg);if(new Date(r.createdAt)<new Date(source.firstProducedAt))source.firstProducedAt=r.createdAt;if(new Date(r.createdAt)>new Date(source.lastProducedAt))source.lastProducedAt=r.createdAt;}
 return {stock:summarize(own)[0],sourceCoils:[...sources.values()].map(r=>({...r,usedKg:r.usedKg==null?null:Number(r.usedKg.toFixed(4)),holeScrapKg:r.holeScrapKg==null?null:Number(r.holeScrapKg.toFixed(4)),cutBladeScrapKg:r.cutBladeScrapKg==null?null:Number(r.cutBladeScrapKg.toFixed(4))})), originalParties:[...new Set(own.map(r=>r.originalPartyName||r.customerName))],productionEntries:new Set(own.map(r=>r.id)).size,scope:'party-material-stock'};
}
async function traceStock(db,key,allowedFields){if(!/^[a-f0-9]{64}$/.test(String(key)))throw Object.assign(new Error('Invalid material stock QR.'),{status:400});return traceRows(await sourceRows(db),key,allowedFields);}
module.exports.traceRows=traceRows;module.exports.traceStock=traceStock;

async function materialBundles(db,key){
 if(!/^[a-f0-9]{64}$/.test(String(key)))throw Object.assign(new Error('Invalid material stock.'),{status:400});
 const rows=(await sourceRows(db)).filter(r=>materialKey(r)===key);if(!rows.length)throw Object.assign(new Error('Material stock not found.'),{status:404});
 const bundles=new Map();for(const r of rows){
  if(!bundles.has(r.id))bundles.set(r.id,{id:r.id,bundleNo:r.bundleNo,runId:r.runId,coilReference:r.coilReference,quantity:0,dispatchedNos:0,availableNos:0,usedKg:0,holeScrapKg:0,cutBladeScrapKg:0,originalPartyName:r.originalPartyName,createdAt:r.createdAt});
  const b=bundles.get(r.id);b.quantity+=Number(r.producedNos);b.dispatchedNos+=Number(r.dispatchedNos||0);b.availableNos=b.quantity-b.dispatchedNos;
  for(const k of ['usedKg','holeScrapKg','cutBladeScrapKg'])b[k]=b[k]==null||r[k]==null?null:b[k]+Number(r[k]);
 }
 return {stock:summarize(rows)[0],bundles:[...bundles.values()].filter(b=>b.quantity>0).reverse()};
}
module.exports.materialBundles=materialBundles;
