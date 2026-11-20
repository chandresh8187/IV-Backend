const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const access = require('../middleware/roleMiddleware');
const { recordOpening, normalizeOpening } = require('../services/unit1MaterialStock');
const { publishUnit1Change } = require('../services/unit1Realtime');
const { recordDispatch, normalizeDispatch, balanceJoin } = require('../services/unit1MaterialDispatch');
const { lockWeights, finishCoils, inspectReconciliation, reviseDispatchWeight } = require('../services/unit1Weighbridge');
const partyStock = require('../services/unit1PartyMaterial');
router.use(auth);
router.get('/rejected',access([], 'unit1.material-stock.view'),async(req,res,next)=>{
 try{res.json({data:await require('../services/unit1RejectedMaterial').rejectedStock(db,req.query)});}catch(error){next(error);}
});
router.get('/parties',access([], 'unit1.material-stock.view'),async(req,res,next)=>{
 try{res.json({data:await partyStock.listParties(db,String(req.query.q||'').trim().slice(0,120),pageOf(req.query.page),String(req.query.status||'all'))});}catch(error){next(error);}
});
router.get('/parties/:key',access([], 'unit1.material-stock.view'),async(req,res,next)=>{
 try{res.json({data:await partyStock.getParty(db,req.params.key)});}catch(error){next(error);}
});
for(const action of ['bundles','party-dispatch'])router.post('/'+action,access([], 'unit1.material-stock.dispatch'),async(req,res,next)=>{
 let c;try{
  c=await db.getConnection();await c.beginTransaction();
  const data=action==='bundles'?await partyStock.packBundle(c,req.body,req.user.id):await partyStock.dispatchParty(c,req.body,req.user.id);
  await c.commit();publishUnit1Change(req,'material-stock',{action});
  if(data.reconciliation)publishUnit1Change(req,'production',{action:'coil-finished'});
  res.status(201).json({data});
 }catch(error){if(c)await c.rollback();next(error);}finally{c?.release();}
});
router.post('/dispatches/:id/bundles/:bundleId/weight',access([], 'unit1.material-stock.dispatch'),async(req,res,next)=>{
 let c;try{
  if(!/^[1-9]\d*$/.test(req.params.id)||!/^[1-9]\d*$/.test(req.params.bundleId))return res.status(400).json({error:'Invalid dispatched bundle.'});
  c=await db.getConnection();await c.beginTransaction();
  const data=await partyStock.reviseBundleWeight(c,req.params.id,req.params.bundleId,req.body.weighbridgeWeightKg,req.user.id);
  await c.commit();publishUnit1Change(req,'material-stock',{action:'bundle-weight-corrected'});publishUnit1Change(req,'production',{action:'bundle-weight-corrected'});res.json({data});
 }catch(error){if(c)await c.rollback();next(error);}finally{c?.release();}
});
const columns = 'i.id,i.customer_name AS customerName,i.member_name AS memberName,i.section_size AS sectionSize,i.length_mm AS lengthMm,i.material_type AS materialType,i.grade,i.thickness_mm AS thicknessMm';
const balances = balanceJoin;
const pageOf = value => /^\d+$/.test(String(value || '1')) && Number(value || 1) > 0 && Number(value || 1) <= 1000000 ? Number(value || 1) : 1;
router.get('/', access([], 'unit1.material-stock.view'), async (req,res,next) => {
 try {
  const q = String(req.query.q || '').trim().slice(0,120), page = pageOf(req.query.page);
  const where = q ? "WHERE s.quantity IS NOT NULL AND CONCAT_WS(' ',i.customer_name,i.member_name,i.section_size,i.material_type,i.grade,CAST(i.length_mm AS CHAR)) LIKE ? ESCAPE '!'" : 'WHERE s.quantity IS NOT NULL';
  const params = q ? ['%'+q.replace(/[!%_]/g, v => '!'+v)+'%'] : [];
  const [[summary]] = await db.execute(`SELECT COUNT(*) AS total,COALESCE(SUM(s.quantity),0) AS totalNos,COALESCE(SUM(s.productionNos),0) AS productionNos,COALESCE(SUM(s.openingNos),0) AS openingNos,COALESCE(SUM(s.dispatchedNos),0) AS dispatchedNos FROM unit1_material_stock_items i ${balances} ${where}`, params);
  const [items] = await db.execute(`SELECT ${columns},COALESCE(s.quantity,0) AS quantity,COALESCE(s.productionNos,0) AS productionNos,COALESCE(s.openingNos,0) AS openingNos,COALESCE(s.dispatchedNos,0) AS dispatchedNos FROM unit1_material_stock_items i ${balances} ${where} ORDER BY i.customer_name,i.member_name,i.length_mm,i.id LIMIT 30 OFFSET ${(page-1)*30}`,params);
  res.json({data:{items,page,pageSize:30,...summary}});
 } catch(error){next(error);}
});
router.get('/dispatches', access([], 'unit1.material-stock.view'), async(req,res,next)=>{
 try {
  const page=pageOf(req.query.page), params=[], filters=[];
  if(req.query.date){
   const date=String(req.query.date);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return res.status(400).json({error:'Select a valid dispatch date.'});
   filters.push('d.created_at>=? AND d.created_at<DATE_ADD(?,INTERVAL 1 DAY)');params.push(date,date);
  }
  if(req.query.destination){if(!['unit2','other'].includes(req.query.destination))return res.status(400).json({error:'Select a valid dispatch destination.'});filters.push('d.destination=?');params.push(req.query.destination);}
  const q=String(req.query.q||'').trim().slice(0,120);
  if(q){filters.push("CONCAT_WS(' ',i.customer_name,i.member_name,i.section_size,d.note) LIKE ? ESCAPE '!'");params.push('%'+q.replace(/[!%_]/g,v=>'!'+v)+'%');}
  const grouped=`FROM unit1_material_dispatches d JOIN unit1_material_dispatch_allocations a ON a.dispatch_id=d.id
    JOIN unit1_material_stock_movements m ON m.id=a.source_movement_id JOIN unit1_material_stock_items i ON i.id=m.item_id
    LEFT JOIN users u ON u.id=d.actor_user_id ${filters.length?'WHERE '+filters.join(' AND '):''}`;
  const [[summary]]=await db.execute(`SELECT COUNT(*) AS total,COALESCE(SUM(quantity),0) AS totalNos,COALESCE(SUM(weightKg),0) AS weighedKg,SUM(weightKg IS NULL) AS missingWeights FROM (SELECT DISTINCT d.id,d.quantity,d.weighbridge_weight_kg AS weightKg ${grouped}) report`,params);
  const [headers]=await db.execute(`SELECT DISTINCT d.id,d.created_at ${grouped} ORDER BY d.created_at DESC,d.id DESC LIMIT 30 OFFSET ${(page-1)*30}`,params);
  const ids=headers.map(row=>row.id);
  const detailsFrom=`FROM unit1_material_dispatches d JOIN unit1_material_dispatch_allocations a ON a.dispatch_id=d.id JOIN unit1_material_stock_movements m ON m.id=a.source_movement_id JOIN unit1_material_stock_items i ON i.id=m.item_id LEFT JOIN users u ON u.id=d.actor_user_id LEFT JOIN users wu ON wu.id=d.weighed_by WHERE d.id IN (${ids.map(()=>'?').join(',')||'NULL'})`;
  const [items]=await db.execute(`SELECT d.id,i.id AS itemId,i.customer_name AS customerName,i.member_name AS memberName,i.section_size AS sectionSize,i.length_mm AS lengthMm,i.material_type AS materialType,i.grade,i.thickness_mm AS thicknessMm,
    d.weighbridge_weight_kg AS weighbridgeWeightKg,d.weighed_at AS weighedAt,wu.name AS weighedByName,d.destination,d.note,d.created_at AS createdAt,u.name AS actorName,SUM(a.quantity) AS quantity ${detailsFrom}
    GROUP BY d.id,i.id,i.customer_name,i.member_name,i.section_size,i.length_mm,i.material_type,i.grade,i.thickness_mm,d.weighbridge_weight_kg,d.weighed_at,wu.name,d.destination,d.note,d.created_at,u.name
    ORDER BY d.created_at DESC,d.id DESC,i.id`,ids);
  // One measured weight per transaction, even after a job correction splits its material lines.
  const transactions=new Map();
  for(const row of items){
   if(!transactions.has(row.id))transactions.set(row.id,{...row,details:[],quantity:0});
   const transaction=transactions.get(row.id);transaction.details.push({...row});transaction.quantity+=Number(row.quantity);
  }
  const pageItems=[...transactions.values()];
  for(const row of pageItems){
   const [bundleWeights]=await db.execute(`SELECT bw.bundle_id AS bundleId,bw.quantity,bw.weight_kg AS weightKg,i.customer_name AS customerName,i.member_name AS memberName,i.section_size AS sectionSize,${require('../services/unit1PhysicalCoils').physicalCoilCodeSql()} AS coilCode FROM unit1_material_dispatch_bundle_weights bw JOIN unit1_material_stock_movements m ON m.id=bw.source_movement_id JOIN unit1_material_stock_items i ON i.id=m.item_id LEFT JOIN unit1_production_runs r ON r.id=m.source_run_id LEFT JOIN coils c ON c.id=r.coil_id WHERE bw.dispatch_id=? ORDER BY bw.bundle_id`,[row.id]);
   row.bundleWeights=bundleWeights;
   const [sources]=await db.execute(`SELECT DISTINCT ${require('../services/unit1PhysicalCoils').physicalCoilCodeSql()} AS code FROM unit1_material_dispatch_allocations a JOIN unit1_material_stock_movements m ON m.id=a.source_movement_id JOIN unit1_production_runs r ON r.id=m.source_run_id JOIN coils c ON c.id=r.coil_id WHERE a.dispatch_id=?`,[row.id]);
   row.sourceCoils=sources.map(source=>source.code).join(', ');
   const [[settlement]]=await db.execute(`SELECT s.id,s.closing_dispatch_id AS closingDispatchId,s.starting_kg AS startingKg,s.material_kg AS materialKg,s.scrap_kg AS scrapKg,s.created_at AS finishedAt FROM unit1_coil_weight_dispatches link JOIN unit1_coil_weight_settlements s ON s.id=link.settlement_id WHERE link.dispatch_id=?`,[row.id]);
   row.reconciliation=settlement||null;
   if(row.details.length>1){for(const key of ['customerName','memberName','sectionSize','lengthMm','materialType','grade','thicknessMm'])row[key]=[...new Set(row.details.map(detail=>detail[key]??'Not recorded'))].join(' / ');}
  }
  res.json({data:{items:pageItems,page,pageSize:30,...summary}});
 }catch(error){next(error);}
});
router.post('/dispatch',access([], 'unit1.material-stock.dispatch'),async(req,res,next)=>{
 let c;
 try{
  normalizeDispatch(req.body);c=await db.getConnection();await c.beginTransaction();
  const entry=await recordDispatch(c,req.body,req.user.id);
  await c.commit();publishUnit1Change(req,'material-stock',{itemId:entry.itemId,action:'dispatched'});
  if(entry.reconciliation)publishUnit1Change(req,'production',{action:'coil-finished'});
  res.status(201).json({data:entry});
 }catch(error){if(c)await c.rollback();if(error.code==='ER_DUP_ENTRY')error=Object.assign(new Error('Dispatch request already exists. Refresh and retry.'),{status:409});next(error);}finally{c?.release();}
});
router.get('/dispatches/:id/reconciliation',access([], 'unit1.material-stock.dispatch'),async(req,res,next)=>{
 let c;try{
  if(!/^[1-9]\d*$/.test(req.params.id))return res.status(400).json({error:'Invalid dispatch.'});
  c=await db.getConnection();await c.beginTransaction();await lockWeights(c);
  const data=await inspectReconciliation(c,req.params.id);await c.commit();res.json({data});
 }catch(error){if(c)await c.rollback();next(error);}finally{c?.release();}
});
for(const action of ['weight','finish'])router.post('/dispatches/:id/'+action,access([], 'unit1.material-stock.dispatch'),async(req,res,next)=>{
 let c;try{
  if(!/^[1-9]\d*$/.test(req.params.id))return res.status(400).json({error:'Invalid dispatch.'});
  c=await db.getConnection();await c.beginTransaction();
  let data;if(action==='weight')data=await reviseDispatchWeight(c,req.params.id,req.body.weighbridgeWeightKg,req.user.id);
  else{await lockWeights(c);data=await finishCoils(c,req.params.id,req.user.id);}
  await c.commit();publishUnit1Change(req,'material-stock',{action:'weight-reconciled'});publishUnit1Change(req,'production',{action:'weight-reconciled'});res.json({data});
 }catch(error){if(c)await c.rollback();next(error);}finally{c?.release();}
});
router.get('/:id/movements', access([], 'unit1.material-stock.view'), async(req,res,next) => {
 if(!/^[1-9]\d*$/.test(req.params.id))return res.status(400).json({error:'Invalid stock item.'});
 try {
  const [items] = await db.execute(`SELECT ${columns} FROM unit1_material_stock_items i WHERE i.id=?`,[req.params.id]);
  if(!items.length)return res.status(404).json({error:'Material not found.'});
  const page=pageOf(req.query.page);
  const ledger=`SELECT CONCAT('source-',m.id) AS id,m.movement_type AS type,m.quantity,m.note,m.created_at AS createdAt,m.source_bundle_id AS bundleId,m.source_run_id AS runId,m.source_job_card_id AS jobCardId,u.name AS actorName,NULL AS destination
    FROM unit1_material_stock_movements m LEFT JOIN users u ON u.id=m.actor_user_id WHERE m.item_id=?
    UNION ALL SELECT CONCAT('dispatch-',d.id),'dispatch',-SUM(a.quantity),d.note,d.created_at,NULL,NULL,NULL,u.name,d.destination
    FROM unit1_material_dispatches d JOIN unit1_material_dispatch_allocations a ON a.dispatch_id=d.id JOIN unit1_material_stock_movements m ON m.id=a.source_movement_id
    LEFT JOIN users u ON u.id=d.actor_user_id WHERE m.item_id=? GROUP BY d.id,d.note,d.created_at,u.name,d.destination`;
  const [[count]]=await db.execute(`SELECT COUNT(*) AS total FROM (${ledger}) ledger`,[req.params.id,req.params.id]);
  const [movements]=await db.execute(`SELECT * FROM (${ledger}) ledger ORDER BY createdAt DESC,id DESC LIMIT 30 OFFSET ${(page-1)*30}`,[req.params.id,req.params.id]);
  res.json({data:{item:items[0],movements,page,total:Number(count.total),pageSize:30}});
 }catch(error){next(error);}
});
router.post('/opening', access([], 'unit1.material-stock.manage'), async(req,res,next)=>{
 let c;
 try{
  normalizeOpening(req.body);
  c=await db.getConnection();await c.beginTransaction();
  const entry=await recordOpening(c,req.body,req.user.id);
  await c.commit();publishUnit1Change(req,'material-stock',{itemId:entry.itemId,action:'opening'});
  res.status(201).json({data:entry});
 }catch(error){if(c)await c.rollback();next(error);}finally{c?.release();}
});
module.exports=router;
