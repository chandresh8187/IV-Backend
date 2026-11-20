const {createHash}=require('node:crypto');
const {sourceRows,materialKey}=require('./unit1MaterialRegister');
const {partyName,ownerKey}=require('./unit1MaterialOwnership');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function validate(body={}){
  const key=String(body.key||''),targetParty=partyName(body.targetParty),quantity=Number(body.quantity),requestId=String(body.requestId||'');
  if(!/^[a-f0-9]{64}$/.test(key))throw fail('Select a valid material stock.');
  if(typeof body.targetParty!=='string'||!targetParty||targetParty.length>160||/[\x00-\x1f]/.test(body.targetParty))throw fail('Enter a destination party up to 160 characters.');
  if(!/^[1-9]\d*$/.test(String(body.quantity))||!Number.isSafeInteger(quantity)||quantity>1000000)throw fail('Enter a whole transfer quantity from 1 to 1,000,000 nos.');
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))throw fail('Reopen Transfer party before saving.');
  return {key,targetParty,quantity,requestId};
}
async function saveTransfer(c,body,actor){
  const v=validate(body),hash=createHash('sha256').update(JSON.stringify({...v,actor})).digest('hex');
  await require('./unit1Weighbridge').lockWeights(c);
  await c.execute('SELECT id FROM unit1_dispatch_note_lock WHERE id=1 FOR UPDATE');
  const [[prior]]=await c.execute('SELECT id,request_hash hash,target_key targetKey FROM unit1_material_party_transfers WHERE request_key=? FOR UPDATE',[v.requestId]);
  if(prior){if(prior.hash!==hash)throw fail('This transfer request was already saved with different details.',409);return {id:prior.id,targetKey:prior.targetKey,retried:true};}
  await c.execute('SELECT id FROM unit1_production_bundles ORDER BY id FOR UPDATE');
  const rows=(await sourceRows(c)).filter(r=>materialKey(r)===v.key),first=rows[0];
  if(!first)throw fail('Material stock changed. Refresh and reopen Transfer party.',409);
  if(partyName(first.customerName)===v.targetParty)throw fail('Select a different destination party.');
  const available=r=>Math.max(0,Number(r.producedNos)-Number(r.dispatchedNos||0)-Number(r.reservedNos||0));
  if(v.quantity>rows.reduce((n,r)=>n+available(r),0))throw fail('Transfer quantity exceeds available stock. Dispatched or packed pieces cannot be transferred.',409);
  const snapshot={customerName:first.customerName,memberName:first.memberName,sectionSize:first.sectionSize,lengthMm:first.lengthMm,materialType:first.materialType,grade:first.grade,thicknessMm:first.thicknessMm};
  const targetKey=materialKey({...snapshot,customerName:v.targetParty});
  const [saved]=await c.execute('INSERT INTO unit1_material_party_transfers(source_key,target_key,source_snapshot,target_party,quantity,actor_user_id,request_key,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',[v.key,targetKey,JSON.stringify(snapshot),v.targetParty,v.quantity,actor,v.requestId,hash]);
  let needed=v.quantity;
  for(const row of rows){const qty=Math.min(needed,available(row));if(!qty)continue;
    const toOwner=partyName(row.originalPartyName)===v.targetParty?'origin':ownerKey(v.targetParty);
    await c.execute('INSERT INTO unit1_material_party_transfer_allocations(transfer_id,bundle_id,from_owner,to_owner,quantity) VALUES(?,?,?,?,?)',[saved.insertId,row.id,row.ownerId,toOwner,qty]);
    needed-=qty;if(!needed)break;
  }
  return {id:saved.insertId,targetKey};
}
async function transferHistory(db,page=1){
  page=/^[1-9]\d*$/.test(String(page))?Math.min(Number(page),1000000):1;
  const [[count]]=await db.execute('SELECT COUNT(*) total FROM unit1_material_party_transfers');
  const [items]=await db.execute(`SELECT t.id,t.source_key sourceKey,t.target_key targetKey,t.source_snapshot snapshot,t.target_party targetParty,t.quantity,t.created_at createdAt,u.name transferredBy FROM unit1_material_party_transfers t LEFT JOIN users u ON u.id=t.actor_user_id ORDER BY t.id DESC LIMIT 30 OFFSET ${(page-1)*30}`);
  return {items:items.map(({snapshot,...row})=>({...row,...JSON.parse(snapshot)})),total:Number(count.total),page,pageSize:30};
}
module.exports={validate,saveTransfer,transferHistory};
