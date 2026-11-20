const {positiveId}=require('./unit1ProductionValidation');
const {coilMatchesJob}=require('./unit1CoilMatch');
const fail=(status,message)=>Object.assign(new Error(message),{status});
function normalizeSelections(input){
 if(!Array.isArray(input)||!input.length||input.length>200)throw fail(400,'Select 1 to 200 physical coils for this job card.');
 const seen=new Set();return input.map(item=>{const coilId=positiveId(item?.coilId),coilNumber=positiveId(item?.coilNumber),key=`${coilId}:${coilNumber}`;if(!coilId||!coilNumber||seen.has(key))throw fail(400,'Select valid, unique physical coils.');seen.add(key);return{coilId,coilNumber};});
}
async function getSelections(db,jobId){
 const ids=Array.isArray(jobId)?jobId:[jobId];if(!ids.length)return [];
 const [rows]=await db.execute(`SELECT jc.job_card_id AS jobCardId,jc.coil_id AS coilId,jc.coil_number AS coilNumber,CAST(ci.code AS CHAR) AS internalId,c.invoice,c.material_type AS materialType,c.width_mm AS widthMm,c.thickness_mm AS thicknessMm,c.grade
 FROM unit1_job_card_coils jc JOIN coils c ON c.id=jc.coil_id LEFT JOIN unit1_coil_identifiers ci ON ci.batch_id=jc.coil_id AND ci.coil_number=jc.coil_number WHERE jc.job_card_id IN (${ids.map(()=>'?').join(',')}) ORDER BY jc.coil_id,jc.coil_number`,ids);return rows;
}
async function requireSelectedCoil(db,jobId,coilId,coilNumber){
 const [[job]]=await db.execute('SELECT allowed_coil_sizes AS allowedCoilSizes FROM unit1_job_cards WHERE id=?',[jobId]);
 if(job?.allowedCoilSizes!=null){
  const [[coil]]=await db.execute('SELECT width_mm AS widthMm,thickness_mm AS thicknessMm FROM coils WHERE id=?',[coilId]);
  if(!coilMatchesJob(coil,job))throw fail(409,'Scanned coil width and thickness do not match any allowed size on this job card.');
  return;
 }
 const [rows]=await db.execute('SELECT coil_id FROM unit1_job_card_coils WHERE job_card_id=? AND coil_id=? AND coil_number=?',[jobId,coilId,coilNumber]);if(!rows.length)throw fail(409,'This coil was not selected on the assigned job card. Scan or enter one of its selected coil IDs.');
}
async function saveSelections(db,jobId,input,value,actorId){
 const selected=normalizeSelections(input),before=await getSelections(db,jobId),keys=new Set(selected.map(c=>`${c.coilId}:${c.coilNumber}`));
 const [active]=await db.execute("SELECT coil_id AS coilId,coil_number AS coilNumber FROM unit1_production_runs WHERE job_card_id=? AND status IN ('setup','running','paused') FOR UPDATE",[jobId]);
 if(active.some(c=>!keys.has(`${c.coilId}:${c.coilNumber}`)))throw fail(409,'Return or remove the active coil before removing it from this job card.');
 // Lock batches in stable order so simultaneous assignment cannot claim an unavailable coil.
 for(const item of [...selected].sort((a,b)=>a.coilId-b.coilId||a.coilNumber-b.coilNumber)){
  const [[coil]]=await db.execute('SELECT id,status,coil_qty AS coilQty,material_type AS materialType,width_mm AS widthMm,thickness_mm AS thicknessMm FROM coils WHERE id=? FOR UPDATE',[item.coilId]);
  if(!coil||item.coilNumber>Number(coil.coilQty))throw fail(400,'A selected physical coil no longer exists.');
  if(!coilMatchesJob(coil,value,{allowSizeVariation:true}))throw fail(409,'Every selected coil must match this job card material. Width and thickness may differ.');
  const [used]=await db.execute("SELECT job_card_id AS jobCardId FROM unit1_production_runs WHERE coil_id=? AND coil_number=? AND status<>'returned'",[item.coilId,item.coilNumber]);
  const retained=before.some(c=>Number(c.coilId)===item.coilId&&Number(c.coilNumber)===item.coilNumber);
  if((!['in_stock','allocated'].includes(coil.status)||used.length>0)&&!retained)throw fail(409,'A selected physical coil is no longer available. Refresh stock and select another coil.');
 }
 const prior=before.map(c=>({coilId:Number(c.coilId),coilNumber:Number(c.coilNumber)}));
 const sort=items=>JSON.stringify([...items].sort((a,b)=>a.coilId-b.coilId||a.coilNumber-b.coilNumber));
 if(sort(prior)!==sort(selected)){
  await db.execute('INSERT INTO unit1_job_coil_revisions (job_card_id,actor_user_id,before_data,after_data) VALUES (?,?,?,?)',[jobId,actorId,JSON.stringify(before),JSON.stringify(input)]);
  await db.execute('DELETE FROM unit1_job_card_coils WHERE job_card_id=?',[jobId]);
  for(const c of selected)await db.execute('INSERT INTO unit1_job_card_coils (job_card_id,coil_id,coil_number) VALUES (?,?,?)',[jobId,c.coilId,c.coilNumber]);
 }
 return selected;
}
module.exports={normalizeSelections,getSelections,requireSelectedCoil,saveSelections};
