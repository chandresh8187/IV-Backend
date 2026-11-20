const {createHash}=require('node:crypto');
const {coilBalance}=require('./unit1CoilBalance');
const {captureProduction}=require('./unit1MaterialStock');
const {lockWeights}=require('./unit1Weighbridge');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});

function validateCorrection(body={}) {
  const whole=value=>/^[1-9]\d*$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)<=100000;
  if(!whole(body.pieces)||!whole(body.expectedPieces))throw fail('Enter a production quantity from 1 to 100000 whole NOS.',400);
  const reason=String(body.reason??'').trim();
  if(!reason||reason.length>255)throw fail('Enter a correction reason, up to 255 characters.',400);
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(body.requestKey??'')))throw fail('Reopen the edit form before saving this correction.',400);
  return {pieces:Number(body.pieces),expectedPieces:Number(body.expectedPieces),reason,requestKey:body.requestKey};
}

// Quantity corrections retain this entry's saved per-piece weight basis, including
// its density, punch scrap and blade scrap, rather than today's machine settings.
function correctedWeights(bundle,pieces) {
  const weight=value=>value==null?null:Number((Number(value)*pieces/Number(bundle.pieces)).toFixed(4));
  return {theoretical_used_kg:weight(bundle.theoretical_used_kg),hole_scrap_kg:weight(bundle.hole_scrap_kg),cut_blade_scrap_kg:weight(bundle.cut_blade_scrap_kg)};
}

async function correctProduction(c,bundleId,input,actorId,assignedMachineId=null) {
  const value=validateCorrection(input);
  if(!/^[1-9]\d*$/.test(String(bundleId))||!Number.isSafeInteger(Number(bundleId)))throw fail('Invalid production entry.',400);
  const hash=createHash('sha256').update(JSON.stringify({bundleId:Number(bundleId),actorId:Number(actorId),...value})).digest('hex');
  await c.execute('SELECT id FROM unit1_planning_lock WHERE id=1 FOR UPDATE');
  await lockWeights(c);
  await c.execute('SELECT id FROM unit1_dispatch_note_lock WHERE id=1 FOR UPDATE');
  const [[prior]]=await c.execute('SELECT bundle_id,request_hash,after_data FROM unit1_production_bundle_revisions WHERE request_key=? FOR UPDATE',[value.requestKey]);
  if(prior){
    if(prior.request_hash!==hash)throw fail('This correction request was already used for different values. Reopen the entry.');
    return JSON.parse(prior.after_data).result;
  }
  const [[ref]]=await c.execute('SELECT run_id FROM unit1_production_bundles WHERE id=?',[bundleId]);
  if(!ref)throw fail('Production entry not found.',404);
  const [[run]]=await c.execute('SELECT * FROM unit1_production_runs WHERE id=? FOR UPDATE',[ref.run_id]);
  if(assignedMachineId!=null&&Number(run.machine_id)!==Number(assignedMachineId))throw fail('This machine is not assigned to you.',403);
  const [[job]]=await c.execute('SELECT * FROM unit1_job_cards WHERE id=? FOR UPDATE',[run.job_card_id]);
  const [[bundle]]=await c.execute('SELECT * FROM unit1_production_bundles WHERE id=? FOR UPDATE',[bundleId]);
  if(!job)throw fail('The source job card could not be found.');
  if(Number(bundle.pieces)!==value.expectedPieces)throw fail('This production entry changed. Refresh the list and reopen Edit.');
  const delta=value.pieces-Number(bundle.pieces);
  const [[totals]]=await c.execute('SELECT COALESCE(SUM(produced_pieces),0) produced FROM unit1_production_runs WHERE job_card_id=?',[job.id]);
  if(Number(totals.produced)+delta>Number(job.production_qty))throw fail('Corrected quantity exceeds the remaining production planning quantity.');
  const [movements]=await c.execute("SELECT * FROM unit1_material_stock_movements WHERE source_bundle_id=? AND movement_type='production' FOR UPDATE",[bundleId]);
  const [[notes]]=await c.execute('SELECT COALESCE(SUM(quantity),0) quantity FROM unit1_dispatch_note_allocations WHERE bundle_id=?',[bundleId]);
  let legacyDispatched=0,packed=0,packedDispatched=0;
  for(const movement of movements){
    const [[used]]=await c.execute('SELECT COALESCE(SUM(quantity),0) quantity FROM unit1_material_dispatch_allocations WHERE source_movement_id=?',[movement.id]);
    const [[packs]]=await c.execute('SELECT COALESCE(SUM(quantity),0) quantity FROM unit1_material_packed_bundles WHERE source_movement_id=?',[movement.id]);
    const [[sentPacks]]=await c.execute('SELECT COALESCE(SUM(w.quantity),0) quantity FROM unit1_material_dispatch_bundle_weights w JOIN unit1_material_packed_bundles p ON p.id=w.bundle_id WHERE p.source_movement_id=?',[movement.id]);
    legacyDispatched+=Number(used.quantity);packed+=Number(packs.quantity);
    packedDispatched+=Number(sentPacks.quantity);
  }
  if(value.pieces<Number(notes.quantity)+packed+legacyDispatched-packedDispatched)throw fail('Corrected quantity cannot be less than pieces already dispatched or packed from this bundle.');
  if(delta<0)await require('./unit1MaterialRegister').sourceRows(c,{bundleId,pieces:value.pieces});
  const [[lastRevision]]=await c.execute('SELECT after_data FROM unit1_production_bundle_revisions WHERE bundle_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE',[bundleId]);
  const last=lastRevision?JSON.parse(lastRevision.after_data):null;
  const sameBasis=last?.weightBasis&&['pieces','theoretical_used_kg','hole_scrap_kg','cut_blade_scrap_kg'].every(key=>bundle[key]==null?last.bundle[key]==null:Number(bundle[key])===Number(last.bundle[key]));
  const weightBasis=sameBasis?last.weightBasis:bundle;
  const weights=correctedWeights(weightBasis,value.pieces);
  const balance=await coilBalance(c,run.coil_id,run.coil_number);
  const addedKg=Number(weights.theoretical_used_kg??0)-Number(bundle.theoretical_used_kg??0);
  if(balance.weightFinished&&delta!==0)throw fail('This coil has already been closed or weight-confirmed. Its reconciliation must be corrected before changing production quantity.');
  if(balance.remainingKg!=null&&addedKg>Number(balance.remainingKg)+.00005)throw fail('Corrected quantity exceeds the available stock for this coil size.');
  const after={...bundle,pieces:value.pieces,...weights};
  const produced=Number(run.produced_pieces)+delta;
  if(produced<0)throw fail('Run quantity is inconsistent with its recorded bundles.');
  await c.execute('UPDATE unit1_production_bundles SET pieces=?,theoretical_used_kg=?,hole_scrap_kg=?,cut_blade_scrap_kg=? WHERE id=?',[value.pieces,weights.theoretical_used_kg,weights.hole_scrap_kg,weights.cut_blade_scrap_kg,bundleId]);
  await c.execute('UPDATE unit1_production_runs SET produced_pieces=? WHERE id=?',[produced,run.id]);
  if(['open','completed'].includes(job.status))await c.execute('UPDATE unit1_job_cards SET status=? WHERE id=?',[Number(totals.produced)+delta>=Number(job.production_qty)?'completed':'open',job.id]);
  // Keep legacy stock sources and their existing dispatch references in sync.
  if(movements.length)await captureProduction(c,bundleId,null,true,true);
  const result={id:Number(bundleId),runId:Number(run.id),pieces:value.pieces};
  await c.execute('INSERT INTO unit1_production_bundle_revisions (bundle_id,actor_user_id,request_key,request_hash,reason,before_data,after_data) VALUES (?,?,?,?,?,?,?)',[bundleId,actorId,value.requestKey,hash,value.reason,JSON.stringify({bundle,run,job,movements}),JSON.stringify({bundle:after,weightBasis,result})]);
  return result;
}
module.exports={validateCorrection,correctedWeights,correctProduction};
