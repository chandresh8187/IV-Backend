const {createHash}=require('node:crypto');
const {validateQrRecord,createQrRecord}=require('./unit1CoilQrGenerator');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const grams=v=>{if(!/^\d+(?:\.\d{1,3})?$/.test(String(v))||Number(v)<=0||Number(v)>999999999)throw fail('Enter positive invoice weight with up to three decimals.');return Math.round(Number(v)*1000);};
function requireLineTc(lines) {
 lines.forEach((line,index) => {
  if (!line.tcNumber || line.tcNumber.length > 100 || /[\x00-\x1f\x7f]/.test(line.tcNumber)) {
   throw fail(`Line ${index+1}: enter a TC number with at most 100 characters.`);
  }
 });
}
function validateInvoice(body,{requireTc=true}={}){
 if(!Array.isArray(body.lines)||body.lines.length<1||body.lines.length>50)throw fail('Add 1 to 50 material lines.');
 const lines=body.lines.map(line=>{const v=validateQrRecord({...line,vendorCode:body.vendorCode,invoice:body.invoice,tcNumber:line.tcNumber??body.tcNumber??'',requestId:body.requestId});delete v.requestId;return v;});
 if(requireTc)requireLineTc(lines);
 if(lines.length===1&&lines[0].totalWeightKg==null)throw fail('Enter the inward weight.');
 const knownGrams=lines.reduce((n,l)=>n+(l.totalWeightKg==null?0:grams(l.totalWeightKg)),0),allKnown=lines.every(l=>l.totalWeightKg!=null);
 const totalGrams=body.totalWeightKg==null||body.totalWeightKg===''?(allKnown?knownGrams:0):grams(body.totalWeightKg);
 if(totalGrams<=0)throw fail('Enter total invoice weight when separate line weights are pending.');
 if(allKnown&&knownGrams!==totalGrams)throw fail('Line weights must exactly match the total invoice weight.');
 if(!allKnown&&knownGrams>=totalGrams)throw fail('Known line weights must leave some invoice weight for the pending lines.');
 if(lines.reduce((n,l)=>n+l.coilQty,0)>1000)throw fail('One invoice supports up to 1,000 physical coils.');
 return {vendorCode:lines[0].vendorCode,invoice:lines[0].invoice,tcNumber:lines.every(line=>line.tcNumber===lines[0].tcNumber)?lines[0].tcNumber:'',totalWeightKg:totalGrams/1000,requestId:body.requestId,lines};
}

async function getInvoice(c,id){
 const [[invoice]]=await c.execute('SELECT ci.id,ci.vendor_id vendorId,v.name vendorName,ci.vendor_code vendorCode,ci.invoice,ci.tc_number tcNumber,ci.total_weight_kg totalWeightKg FROM unit1_coil_invoices ci LEFT JOIN unit1_vendors v ON v.id=ci.vendor_id WHERE ci.id=?',[id]);
 if(!invoice)throw fail('Invoice not found.',404);
 const [lines]=await c.execute('SELECT id,COALESCE(public_code,internal_id) internalId,tc_number tcNumber,(SELECT sq.code FROM unit1_stock_qrs sq WHERE sq.inward_id=coils.id LIMIT 1) qrCode,material_type materialType,grade,width_mm widthMm,thickness_mm thicknessMm,coil_qty coilQty,rate_per_kg ratePerKg,CASE WHEN weight_recorded=0 THEN NULL ELSE actual_net_kg END totalWeightKg,stock_archived_at archivedAt FROM coils WHERE invoice_group_id=? ORDER BY id',[id]);
 return {...invoice,lines,weightPending:lines.some(l=>l.totalWeightKg==null)};
}
async function createInvoice(c,body,actorId){
 const vendor=body?.vendorId == null ? null : await require('./unit1Vendors').getVendor(c,body.vendorId);
 const v=validateInvoice(vendor ? {...body,vendorCode:vendor.code} : body,{requireTc:false}),hash=createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const [[prior]]=await c.execute('SELECT id,request_hash hash FROM unit1_coil_invoices WHERE request_key=? FOR UPDATE',[v.requestId]);
 if(prior){if(prior.hash!==hash)throw fail('This invoice request was already saved with different details.',409);return getInvoice(c,prior.id);}
 requireLineTc(v.lines);
 const [r]=await c.execute('INSERT INTO unit1_coil_invoices(vendor_id,vendor_code,invoice,tc_number,total_weight_kg,request_key,request_hash,actor_user_id) VALUES (?,?,?,?,?,?,?,?)',[vendor?.id??null,v.vendorCode,v.invoice,v.tcNumber||null,v.totalWeightKg,v.requestId,hash,actorId]);
 for(let index=0;index<v.lines.length;index++){const id=await createQrRecord(c,{...v.lines[index],requestId:('invoice_'+r.insertId+'_'+index+'_'+v.requestId).slice(0,100)});await c.execute('UPDATE coils SET invoice_group_id=?,qr_generated_at=NULL WHERE id=?',[r.insertId,id]);await require('./unit1StockQr').invoiceQr(c,id,actorId);}
 return getInvoice(c,r.insertId);
}
async function recordWeights(c,id,body,actorId){
 await c.execute('SELECT id FROM unit1_coil_invoices WHERE id=? FOR UPDATE',[id]);
 await c.execute('SELECT id FROM coils WHERE invoice_group_id=? ORDER BY id FOR UPDATE',[id]);
 const before=await getInvoice(c,id);
 if(!Array.isArray(body.lines)||body.lines.length!==before.lines.length)throw fail('Enter actual weight for every invoice line.');
 const rows=before.lines.map(line=>{const matches=body.lines.filter(x=>Number(x.id)===Number(line.id));if(matches.length!==1)throw fail('Invoice lines changed. Reopen the invoice.');return {id:line.id,grams:grams(matches[0].totalWeightKg)};});
 if(rows.reduce((n,r)=>n+r.grams,0)!==grams(before.totalWeightKg))throw fail('Line weights must exactly match the total invoice weight.');
 if(!before.weightPending){if(rows.every(r=>Math.round(Number(before.lines.find(l=>l.id===r.id).totalWeightKg)*1000)===r.grams))return before;throw fail('Actual line weights are already recorded. Use inward correction to revise them.',409);}
 const positions=await require('./unit1CoilStock').stockPositions(c,rows.map(r=>r.id),true);
 for(const row of rows){const used=Number(positions.find(p=>Number(p.coilId)===Number(row.id))?.usedKg||0);if(row.grams/1000+0.00005<used)throw fail('An actual line weight is below its recorded production usage. Review production or weight before saving.',409);}
 for(const row of rows){const old=before.lines.find(l=>l.id===row.id);if(old.totalWeightKg!=null){if(grams(old.totalWeightKg)!==row.grams)throw fail('Keep the previously recorded line weight unchanged.',409);continue;}
 await c.execute('INSERT INTO unit1_coil_revisions(coil_id,actor_user_id,before_data,after_data) VALUES (?,?,?,?)',[row.id,actorId,JSON.stringify({...old,stockPosition:positions.find(p=>Number(p.coilId)===Number(row.id))}),JSON.stringify({totalWeightKg:row.grams/1000,invoiceId:id})]);
 // A previously confirmed stock count remains a count; recording original weight must not add that weight twice.
 const [balances]=await c.execute('SELECT coil_number,adjustment_kg,confirmed FROM unit1_coil_stock_balances WHERE coil_id=? FOR UPDATE',[row.id]);
 if(balances.some(b=>Number(b.confirmed)))await c.execute('INSERT INTO unit1_coil_stock_balances(coil_id,coil_number,adjustment_kg,confirmed) VALUES (?,0,?,1) ON DUPLICATE KEY UPDATE adjustment_kg=adjustment_kg+VALUES(adjustment_kg)',[row.id,-row.grams/1000]);
 await c.execute('UPDATE coils SET actual_net_kg=?,gross_kg=?,estimated_kg=?,tare_kg=0,weight_recorded=1 WHERE id=?',[row.grams/1000,row.grams/1000,row.grams/1000,row.id]);
 }
 const after=await getInvoice(c,id);await c.execute('INSERT INTO unit1_coil_invoice_revisions(invoice_id,actor_user_id,before_data,after_data) VALUES (?,?,?,?)',[id,actorId,JSON.stringify({...before,stockPositions:positions}),JSON.stringify(after)]);return after;
}
module.exports={validateInvoice,createInvoice,getInvoice,recordWeights};
