const {createHash}=require('node:crypto');
const {DateTime}=require('luxon');
const {sourceRows,materialKey}=require('./unit1MaterialRegister');
const {sourceIdentity}=require('./unit1MaterialOwnership');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function validate(body={}){
 const dcNumber=String(body.dcNumber||'').trim(),dcDate=String(body.dcDate||''),requestId=String(body.requestId||''),destination=String(body.destination||'');
 if(!['unit2','other'].includes(destination))throw fail('Select Dispatch to: UNIT 2 or Other.');
 if(!dcNumber||dcNumber.length>100||/[\x00-\x1f]/.test(dcNumber))throw fail('Enter a DC number up to 100 characters.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dcDate)||!DateTime.fromISO(dcDate).isValid)throw fail('Select a valid DC date.');
 if(!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))throw fail('Reopen the dispatch form.');
 if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>50)throw fail('Add 1 to 50 materials.');
 const keys=new Set(),lines=body.lines.map(r=>{const key=String(r.key||''),quantity=Number(r.dispatchQty),weightKg=Number(r.weightKg);if(!/^[a-f0-9]{64}$/.test(key)||keys.has(key))throw fail('Select each material only once.');keys.add(key);if(!/^[1-9]\d*$/.test(String(r.dispatchQty))||!Number.isSafeInteger(quantity)||quantity>1000000)throw fail('Dispatch quantity must be a positive whole number up to 1,000,000.');if(!/^\d+(?:\.\d{1,3})?$/.test(String(r.weightKg))||!Number.isFinite(weightKg)||weightKg<=0||weightKg>999999999)throw fail('Enter actual weight in kg, up to three decimals.');return {key,quantity,weightKg};});
 return {dcNumber,dcDate,destination,requestId,lines};
}
function allocate(rows,lines){const remaining=new Map(rows.map(r=>[sourceIdentity(r),Number(r.producedNos)-Number(r.dispatchedNos||0)-Number(r.reservedNos||0)]));return lines.map(line=>{const sources=rows.filter(r=>materialKey(r)===line.key),available=sources.reduce((n,r)=>n+remaining.get(sourceIdentity(r)),0);if(line.quantity>available)throw fail('Stock changed or dispatch quantity exceeds available stock. Refresh the selected material.',409);let needed=line.quantity;const allocations=[];for(const r of sources){const qty=Math.min(needed,Math.max(0,remaining.get(sourceIdentity(r))));if(qty){allocations.push({bundleId:Number(r.id),quantity:qty,...(r.ownerId?{ownerId:r.ownerId}:{})});remaining.set(sourceIdentity(r),remaining.get(sourceIdentity(r))-qty);needed-=qty;}if(!needed)break;}const r=sources[0];return {...line,snapshot:{customerName:r.customerName,memberName:r.memberName,sectionSize:r.sectionSize,lengthMm:r.lengthMm,materialType:r.materialType,grade:r.grade,thicknessMm:r.thicknessMm},allocations};});}
async function saveDispatch(c,body,actor){const v=validate(body),hash=createHash('sha256').update(JSON.stringify({...v,actor})).digest('hex');
 await c.execute('SELECT id FROM unit1_dispatch_note_lock WHERE id=1 FOR UPDATE');
 const [[prior]]=await c.execute('SELECT id,request_hash hash FROM unit1_dispatch_notes WHERE request_key=? FOR UPDATE',[v.requestId]);if(prior){if(prior.hash!==hash)throw fail('This dispatch request was already saved with different details.',409);return {id:prior.id,retried:true};}
 // Lock physical production sources before establishing a read snapshot. This serializes dispatches and source corrections.
 await c.execute('SELECT id FROM unit1_production_bundles ORDER BY id FOR UPDATE');
 const allocations=allocate(await sourceRows(c),v.lines);
 const [note]=await c.execute('INSERT INTO unit1_dispatch_notes(dc_number,dc_date,destination,actor_user_id,request_key,request_hash,created_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))',[v.dcNumber,v.dcDate,v.destination,actor,v.requestId,hash]);
 for(const l of allocations){const [line]=await c.execute('INSERT INTO unit1_dispatch_note_lines(note_id,stock_key,material_snapshot,quantity,weight_kg) VALUES (?,?,?,?,?)',[note.insertId,l.key,JSON.stringify(l.snapshot),l.quantity,l.weightKg]);for(const a of l.allocations)await c.execute('INSERT INTO unit1_dispatch_note_allocations(line_id,bundle_id,quantity,stock_owner) VALUES (?,?,?,?)',[line.insertId,a.bundleId,a.quantity,a.ownerId||'origin']);}
 return {id:note.insertId};
}
async function report(c,q='',page=1){q=String(q).trim().slice(0,120);page=/^[1-9]\d*$/.test(String(page))?Math.min(Number(page),1000000):1;const size=30,args=[],filter=q?"WHERE CONVERT(CONCAT_WS(' ',n.dc_number,JSON_UNQUOTE(JSON_EXTRACT(l.material_snapshot,'$.customerName')),JSON_UNQUOTE(JSON_EXTRACT(l.material_snapshot,'$.memberName'))) USING utf8mb4) COLLATE utf8mb4_general_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_general_ci ESCAPE '!'":'';if(q)args.push('%'+q.replace(/[!%_]/g,v=>'!'+v)+'%');const from='FROM unit1_dispatch_notes n JOIN unit1_dispatch_note_lines l ON l.note_id=n.id LEFT JOIN users u ON u.id=n.actor_user_id '+filter;const [[count]]=await c.execute('SELECT COUNT(*) total '+from,args);const [rows]=await c.execute(`SELECT l.id,n.id dispatchId,n.dc_number dcNumber,n.destination,DATE_FORMAT(n.dc_date,'%Y-%m-%d') dcDate,n.created_at createdAt,u.name dispatchedBy,l.quantity dispatchQty,l.weight_kg weightKg,l.material_snapshot snapshot ${from} ORDER BY n.created_at DESC,l.id DESC LIMIT ${size} OFFSET ${(page-1)*size}`,args);return {items:rows.map(({snapshot,...r})=>({...r,...JSON.parse(snapshot)})),total:Number(count.total),page,pageSize:size};}
module.exports={validate,allocate,saveDispatch,report};
