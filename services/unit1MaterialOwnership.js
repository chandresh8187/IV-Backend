const {createHash}=require('node:crypto');
const partyName=value=>String(value??'').trim().toUpperCase();
const ownerKey=name=>createHash('sha256').update(partyName(name)).digest('hex');
const sourceIdentity=row=>`${row.id}:${row.ownerId||'origin'}`;

// Ownership is a separate ledger. Actual production, planning and recorded weights
// remain on the original physical bundle, even after multiple party transfers.
function projectOwnership(base,transfers,dispatches) {
  const byBundle=new Map(base.map(row=>[Number(row.id),{row,owners:new Map([['origin',{name:row.customerName,quantity:Number(row.producedNos),received:0,sent:0}]])}]));
  for(const transfer of transfers){
    const item=byBundle.get(Number(transfer.bundleId));if(!item)continue;
    const from=item.owners.get(transfer.fromOwner);
    if(!from)throw Object.assign(new Error('Material transfer source is inconsistent.'),{status:409});
    if(!item.owners.has(transfer.toOwner))item.owners.set(transfer.toOwner,{name:transfer.targetParty,quantity:0,received:0,sent:0});
    const to=item.owners.get(transfer.toOwner),qty=Number(transfer.quantity);
    from.quantity-=qty;from.sent+=qty;to.quantity+=qty;to.received+=qty;
  }
  const dispatched=new Map();for(const row of dispatches){const key=sourceIdentity(row);dispatched.set(key,(dispatched.get(key)||0)+Number(row.quantity));}
  const result=[];
  for(const {row,owners} of byBundle.values())for(const [ownerId,owner] of owners){
    const origin=ownerId==='origin',sent=(origin?Number(row.legacyDispatchedNos||0):0)+(dispatched.get(`${row.id}:${ownerId}`)||0);
    const reserved=origin?Number(row.reservedNos||0):0;
    if(owner.quantity<sent+reserved)throw Object.assign(new Error('Quantity cannot be less than material already transferred, dispatched or packed.'),{status:409});
    const share=Number(row.producedNos)?owner.quantity/Number(row.producedNos):0;
    const weight=value=>value==null?null:Number(value)*share;
    result.push({...row,ownerId,customerName:owner.name,originalPartyName:row.customerName,
      originalProducedNos:origin?Number(row.producedNos):0,producedNos:owner.quantity,
      transferredInNos:owner.received,transferredOutNos:owner.sent,dispatchedNos:sent,reservedNos:reserved,
      usedKg:weight(row.usedKg),holeScrapKg:weight(row.holeScrapKg),cutBladeScrapKg:weight(row.cutBladeScrapKg)});
  }
  return result;
}
async function ownershipRows(db,base){
  const [transfers]=await db.execute('SELECT a.bundle_id bundleId,a.from_owner fromOwner,a.to_owner toOwner,a.quantity,t.target_party targetParty FROM unit1_material_party_transfer_allocations a JOIN unit1_material_party_transfers t ON t.id=a.transfer_id ORDER BY t.id,a.bundle_id,a.from_owner');
  const [dispatches]=await db.execute('SELECT bundle_id id,stock_owner ownerId,SUM(quantity) quantity FROM unit1_dispatch_note_allocations GROUP BY bundle_id,stock_owner');
  return projectOwnership(base,transfers,dispatches);
}
module.exports={partyName,ownerKey,sourceIdentity,projectOwnership,ownershipRows};
