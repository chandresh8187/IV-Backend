const {createHash} = require('node:crypto');
const {roundKg} = require('./unit1MaterialWeight');
const {rejectedUsedSql} = require('./unit1RejectedMaterial');
const fail = (message, status = 409) => Object.assign(new Error(message), {status});

async function stockPositions(db, ids, current = false) {
 if(!ids.length)return [];
 const [rows]=await db.execute(`SELECT c.id coilId,0 coilNumber,c.coil_qty coilQty,c.weight_recorded weightRecorded,c.actual_net_kg totalWeightKg,c.stock_archived_at archivedAt,
 (SELECT COALESCE(SUM(sb.adjustment_kg),0) FROM unit1_coil_stock_balances sb WHERE sb.coil_id=c.id) adjustmentKg,
 (SELECT COALESCE(SUM(sb.adjustment_kg),0) FROM unit1_coil_stock_balances sb WHERE sb.coil_id=c.id AND sb.coil_number<>0) legacyAdjustmentKg,
 (SELECT COALESCE(MAX(sb.confirmed),0) FROM unit1_coil_stock_balances sb WHERE sb.coil_id=c.id) confirmed,
 (SELECT COALESCE(SUM(b.theoretical_used_kg),0) FROM unit1_production_runs r JOIN unit1_production_bundles b ON b.run_id=r.id WHERE r.coil_id=c.id)
 +(SELECT COALESCE(SUM(${rejectedUsedSql('rr')}),0) FROM unit1_production_runs rr WHERE rr.coil_id=c.id) usedKg,
 (SELECT COALESCE(SUM(wm.starting_kg-(SELECT COALESCE(SUM(b.theoretical_used_kg),0) FROM unit1_production_runs r JOIN unit1_production_bundles b ON b.run_id=r.id WHERE r.coil_id=c.id AND r.coil_number=wm.coil_number)-(SELECT COALESCE(SUM(${rejectedUsedSql('rr')}),0) FROM unit1_production_runs rr WHERE rr.coil_id=c.id AND rr.coil_number=wm.coil_number)),0) FROM unit1_coil_weight_members wm WHERE wm.coil_id=c.id) residualKg
 FROM coils c WHERE c.id IN (${ids.map(()=>'?').join(',')}) ORDER BY c.id ${current?'FOR UPDATE':''}`,ids);
 if(current){
   // Use locking reads after waiting for the size pool lock; an earlier transaction snapshot must not hide concurrent production.
   const marks=ids.map(()=>'?').join(',');
   const [bundles]=await db.execute(`SELECT r.coil_id coilId,r.coil_number coilNumber,b.theoretical_used_kg usedKg FROM unit1_production_runs r JOIN unit1_production_bundles b ON b.run_id=r.id WHERE r.coil_id IN (${marks}) FOR UPDATE`,ids);
   const [checks]=await db.execute(`SELECT r.coil_id coilId,r.coil_number coilNumber,h.report_snapshot snapshot FROM unit1_production_runs r JOIN unit1_hole_checks h ON h.run_id=r.id WHERE r.coil_id IN (${marks}) FOR UPDATE`,ids);
   const [balances]=await db.execute(`SELECT coil_id coilId,coil_number coilNumber,adjustment_kg adjustmentKg,confirmed FROM unit1_coil_stock_balances WHERE coil_id IN (${marks}) FOR UPDATE`,ids);
   const [members]=await db.execute(`SELECT coil_id coilId,coil_number coilNumber,starting_kg startingKg FROM unit1_coil_weight_members WHERE coil_id IN (${marks}) FOR UPDATE`,ids);
   const usage=[...bundles,...checks.map(row=>({...row,usedKg:JSON.parse(row.snapshot||'{}').rejectedUsedKg||0}))];
   for(const row of rows){const own=usage.filter(x=>Number(x.coilId)===Number(row.coilId)),ledger=balances.filter(x=>Number(x.coilId)===Number(row.coilId));row.usedKg=own.reduce((n,x)=>n+Number(x.usedKg||0),0);row.adjustmentKg=ledger.reduce((n,x)=>n+Number(x.adjustmentKg),0);row.legacyAdjustmentKg=ledger.filter(x=>Number(x.coilNumber)!==0).reduce((n,x)=>n+Number(x.adjustmentKg),0);row.confirmed=ledger.some(x=>Number(x.confirmed))?1:0;row.residualKg=members.filter(x=>Number(x.coilId)===Number(row.coilId)&&x.startingKg!=null).reduce((n,m)=>n+Number(m.startingKg)-own.filter(x=>Number(x.coilNumber)===Number(m.coilNumber)).reduce((sum,x)=>sum+Number(x.usedKg||0),0),0);}
 }
 return rows.map(row=>{const startingKg=Number(row.weightRecorded)===0?null:Number(row.totalWeightKg),known=startingKg!=null||Boolean(Number(row.confirmed)),closed=Boolean(row.archivedAt);return {...row,startingKg,known,closed,remainingKg:closed?0:known?(startingKg||0)+Number(row.adjustmentKg)-Number(row.usedKg)-Number(row.residualKg):null};});
}

function decorateRows(rows, positions) {
  return rows.map(row => {
    const coils = positions.filter(coil => Number(coil.coilId) === Number(row.id));
    const pending = coils.filter(coil => !coil.closed && !coil.known).length;
    const stockKnownRemainingKg = roundKg(coils.reduce((total,coil) => total+(coil.remainingKg || 0),0));
    const stockFingerprint = createHash('sha256').update(JSON.stringify([
      Number(row.id),String(row.materialType||'').trim().toUpperCase(),String(row.grade||'').trim().toUpperCase(),Number(row.widthMm),Number(row.thicknessMm),Number(row.weightRecorded)===0||row.totalWeightKg==null?null:Number(row.totalWeightKg),Number(row.weightRecorded),Number(row.coilQty),
      coils.map(coil => [Number(coil.coilNumber),Number(coil.usedKg),Number(coil.adjustmentKg),Number(coil.confirmed),Number(coil.residualKg||0)]),
    ])).digest('hex');
    return {...row,theoreticalRemainingKg:pending ? null : stockKnownRemainingKg,stockKnownRemainingKg,stockRemainingKg:pending ? null : stockKnownRemainingKg,
      stockPendingCoils:pending,stockFingerprint};
  });
}

async function decorateStockRows(db, rows) {
  return decorateRows(rows,await stockPositions(db,rows.map(row => row.id)));
}

function allocateStock(targetKg, positions) {
  const available = positions.filter(coil => !coil.closed);
  if (!available.length && targetKg > 0) throw fail('All source coils are finished. Add a new inward to record new stock.');
  const grams = Math.round(targetKg*1000);
  const weights = available.map(coil => Math.max(0,Number(coil.remainingKg || 0)));
  const total = weights.reduce((sum,value) => sum+value,0);
  const allocations = available.map((coil,index) => {
    const exact = grams*(total > 0 ? weights[index]/total : 1/available.length);
    return {...coil,grams:Math.floor(exact),fraction:exact-Math.floor(exact)};
  });
  const remainder = grams-allocations.reduce((sum,coil) => sum+coil.grams,0);
  const priority = [...allocations].sort((a,b) => b.fraction-a.fraction || Number(a.coilId)-Number(b.coilId) || a.coilNumber-b.coilNumber);
  for (let index=0;index<remainder;index++) priority[index].grams++;
  return allocations.map(coil => ({coilId:Number(coil.coilId),coilNumber:Number(coil.coilNumber),
    remainingKg:coil.grams/1000,
    adjustmentKg:Number((coil.grams/1000+Number(coil.usedKg)+Number(coil.residualKg||0)-(coil.startingKg || 0)-Number(coil.legacyAdjustmentKg||0)).toFixed(4))}));
}

function validateStockChange(body, action) {
  const dimension = value => /^\d+(?:\.\d{1,3})?$/.test(String(value)) && Number(value)>0 && Number(value)<1000000;
  if (!dimension(body.widthMm) || !dimension(body.thicknessMm)) throw fail('Select a valid coil size.',400);
  const materialType=String(body.materialType||'').trim(),grade=String(body.grade||'').trim();
  if(!materialType||!grade||materialType.length>20||grade.length>100)throw fail('Select a material and grade stock card.',400);
  const reason = String(body.reason || '').trim();
  if (!reason || reason.length>1000) throw fail('Enter a reason, up to 1000 characters.',400);
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(String(body.requestKey || ''))) throw fail('Reopen the stock form.',400);
  if (!Array.isArray(body.expected) || (action!=='delete' && !body.expected.length) || body.expected.some(row => !Number.isSafeInteger(Number(row.id)) || Number(row.id)<1 || !/^[a-f0-9]{64}$/.test(row.fingerprint))) throw fail('Refresh coil stock before changing it.',400);
  let targetKg = null;
  if (action==='adjust') {
    if (!/^\d+(?:\.\d{1,3})?$/.test(String(body.targetKg)) || Number(body.targetKg)>999999999) throw fail('Enter current stock kg from 0 to 999999999, up to three decimals.',400);
    targetKg = Number(body.targetKg);
  }
  return {materialType:materialType.toUpperCase(),grade:grade.toUpperCase(),widthMm:Number(body.widthMm),thicknessMm:Number(body.thicknessMm),reason,targetKg,
    expected:body.expected.map(row => ({id:Number(row.id),fingerprint:row.fingerprint})).sort((a,b) => a.id-b.id),requestKey:body.requestKey};
}

async function changeStock(connection, body, action, actorId) {
  const input = validateStockChange(body,action);
  const requestHash = createHash('sha256').update(JSON.stringify({action,actorId,...input})).digest('hex');
  // Existing coil row locks also serialize production balance checks and inward edits.
  const [rows] = await connection.execute(`SELECT id,material_type materialType,grade,width_mm widthMm,thickness_mm thicknessMm,
    actual_net_kg totalWeightKg,weight_recorded weightRecorded,coil_qty coilQty,status
    FROM coils WHERE width_mm=? AND thickness_mm=? AND UPPER(TRIM(material_type))=UPPER(TRIM(?)) AND UPPER(TRIM(grade))=UPPER(TRIM(?)) AND stock_archived_at IS NULL ORDER BY id FOR UPDATE`,[input.widthMm,input.thicknessMm,input.materialType,input.grade]);
  const [[previous]] = await connection.execute('SELECT id,request_hash requestHash FROM unit1_coil_stock_changes WHERE request_key=?',[input.requestKey]);
  if (previous) {
    if (previous.requestHash!==requestHash) throw fail('This stock request was already used with different details.');
    return {id:previous.id,action,retried:true};
  }
  const positions = await stockPositions(connection,rows.map(row => row.id),true);
  const current = decorateRows(rows,positions);
  const expected = current.map(row => ({id:Number(row.id),fingerprint:row.stockFingerprint}));
  if (JSON.stringify(expected)!==JSON.stringify(input.expected)) throw fail('Stock changed. Close this form, refresh and try again.');
  if (action==='delete') {
    const [[active]] = rows.length ? await connection.execute(`SELECT COUNT(*) n FROM unit1_production_runs WHERE coil_id IN (${rows.map(() => '?').join(',')}) AND status IN ('setup','running','paused')`,rows.map(row => row.id)) : [[{n:0}]];
    if (Number(active.n)) throw fail('Finish or remove active coil assignments before deleting this size card.');
    for (const row of rows) {
      await connection.execute('INSERT INTO unit1_coil_revisions(coil_id,actor_user_id,before_data,after_data) VALUES (?,?,?,?)',[row.id,actorId,JSON.stringify(row),JSON.stringify({stockArchived:true,reason:input.reason})]);
      await connection.execute("UPDATE coils SET stock_archived_at=UTC_TIMESTAMP(3),status='closed' WHERE id=?",[row.id]);
    }
  }
  if(action==='delete') await connection.execute('UPDATE unit1_coil_stock_cards SET archived_at=UTC_TIMESTAMP(3) WHERE spec_key=?',[require('./unit1StockCards').specKey(input)]);
  const allocations = action==='adjust' ? allocateStock(input.targetKg,positions) : [];
  for (const coil of allocations) {
    await connection.execute(`INSERT INTO unit1_coil_stock_balances(coil_id,coil_number,adjustment_kg,confirmed)
      VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE adjustment_kg=VALUES(adjustment_kg),confirmed=1,updated_at=UTC_TIMESTAMP(3)`,[coil.coilId,coil.coilNumber,coil.adjustmentKg]);
  }
  const [change] = await connection.execute(`INSERT INTO unit1_coil_stock_changes
    (width_mm,thickness_mm,action,target_kg,reason,actor_user_id,request_key,request_hash,before_data,after_data) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [input.widthMm,input.thicknessMm,action,input.targetKg,input.reason,actorId,input.requestKey,requestHash,
      JSON.stringify({rows:current,positions}),JSON.stringify({action,materialType:input.materialType,grade:input.grade,targetKg:input.targetKg,allocations})]);
  return {id:change.insertId,action,targetKg:input.targetKg};
}

module.exports = {stockPositions,decorateRows,decorateStockRows,allocateStock,validateStockChange,changeStock};
