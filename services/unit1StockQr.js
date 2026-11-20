const {createHash}=require('node:crypto');
const {validateQrRecord}=require('./unit1CoilQrGenerator');
const {coilMatchesJob}=require('./unit1CoilMatch');
const {stockPositions}=require('./unit1CoilStock');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const columns='id,inward_id inwardId,code,material_type materialType,grade,width_mm widthMm,thickness_mm thicknessMm,created_at createdAt';
async function listQrs(c){const [rows]=await c.execute('SELECT '+columns+' FROM unit1_stock_qrs ORDER BY created_at DESC,id DESC');return rows;}
async function getQr(c,id){const [[row]]=await c.execute('SELECT '+columns+' FROM unit1_stock_qrs WHERE id=?',[id]);if(!row)throw fail('Coil stock QR not found.',404);return row;}
async function createQr(c,body,actorId){
 const v=validateQrRecord({materialType:body.materialType,grade:body.grade,widthMm:body.widthMm,thicknessMm:body.thicknessMm,coilQty:1,ratePerKg:1,requestId:body.requestId});
 const key=createHash('sha256').update(JSON.stringify([v.materialType.toUpperCase(),v.grade.toUpperCase(),v.widthMm,v.thicknessMm])).digest('hex');
 const [result]=await c.execute('INSERT INTO unit1_stock_qrs(spec_key,material_type,grade,width_mm,thickness_mm,created_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[key,v.materialType,v.grade,v.widthMm,v.thicknessMm,actorId]);
 if(result.insertId>99999999)throw fail('Shared coil QR code range exhausted.');
 await c.execute("UPDATE unit1_stock_qrs SET code=CONCAT('CQ',LPAD(id,8,'0')) WHERE id=? AND code IS NULL",[result.insertId]);return getQr(c,result.insertId);
}
async function matchingInwards(c,qrId,jobCardId,lock=false){
 const qr=await getQr(c,qrId);
 const [[job]]=await c.execute('SELECT id,status,material_type materialType,allowed_coil_sizes allowedCoilSizes,coil_width_mm coilWidthMm,coil_thickness_mm coilThicknessMm FROM unit1_job_cards WHERE id=?',[jobCardId]);
 if(!job||job.status!=='open')throw fail('Choose an open job card.');if(!coilMatchesJob(qr,job))throw fail('QR width and thickness do not match an allowed job card size.');
 const [rows]=await c.execute(`SELECT id,invoice,vendor_code vendorCode,rate_per_kg ratePerKg,coil_qty coilQty,weight_recorded weightRecorded,received_at receivedAt FROM coils WHERE stock_archived_at IS NULL AND status IN ('in_stock','allocated') AND width_mm=? AND thickness_mm=? AND UPPER(TRIM(material_type))=UPPER(TRIM(?)) AND UPPER(TRIM(grade))=UPPER(TRIM(?)) AND (? IS NULL OR id=?) ORDER BY received_at,id ${lock?'FOR UPDATE':''}`,[qr.widthMm,qr.thicknessMm,qr.materialType,qr.grade,qr.inwardId??null,qr.inwardId??null]);
 const positions=await stockPositions(c,rows.map(r=>r.id),lock);
 const available=[];
 for(const row of rows){const position=positions.find(p=>Number(p.coilId)===Number(row.id));if(position?.remainingKg!=null&&position.remainingKg<=0)continue;if(row.ratePerKg==null||!(Number(row.ratePerKg)>0))continue;
 const [used]=await c.execute("SELECT DISTINCT coil_number coilNumber FROM unit1_production_runs WHERE coil_id=? AND status<>'returned'",[row.id]);const numbers=new Set(used.map(r=>Number(r.coilNumber)));const number=Array.from({length:Number(row.coilQty)},(_,i)=>i+1).find(n=>!numbers.has(n));if(!number)continue;
 available.push({...row,remainingKg:position?.remainingKg??null,coilNumber:number});}
 if(!available.length)throw fail('No available inward stock matches this QR material, grade and size. Add matching stock first.');
 return {qr,available};
}
async function selectInward(c,qrId,jobCardId,inwardId,lock=false){
 const {qr,available}=await matchingInwards(c,qrId,jobCardId,lock);
 if(qr.inwardId){if(inwardId!=null&&Number(inwardId)!==Number(qr.inwardId))throw fail('This QR belongs to another invoice inward.');inwardId=qr.inwardId;}
 if(!inwardId)return {stockQrId:qr.id,reference:qr.code,requiresInward:true,inwards:available.map(({coilNumber,...row})=>row)};
 const selected=available.find(r=>Number(r.id)===Number(inwardId));if(!selected)throw fail('Selected inward is no longer available for this QR. Scan again and choose matching stock.');
 const balance=await require('./unit1CoilBalance').coilBalance(c,selected.id,selected.coilNumber);if(balance.remainingKg!=null&&balance.remainingKg<=0)throw fail('Selected stock has no available weight.');
 return {stockQrId:qr.id,reference:qr.code,jobCardId:Number(jobCardId),coilId:selected.id,coilNumber:selected.coilNumber,ratePerKg:selected.ratePerKg,invoice:selected.invoice,compatible:true};
}
module.exports={listQrs,getQr,createQr,matchingInwards,selectInward};

async function invoiceQr(c,inwardId,actorId){
 if(!/^[1-9]\d*$/.test(String(inwardId)))throw fail('Invalid invoice inward.',400);
 const [[r]]=await c.execute('SELECT id,invoice,tc_number tcNumber,vendor_code vendorCode,material_type materialType,grade,width_mm widthMm,thickness_mm thicknessMm,stock_archived_at archivedAt FROM coils WHERE id=? FOR UPDATE',[inwardId]);if(!r)throw fail('Invoice inward not found.',404);if(r.archivedAt)throw fail('Archived inward QR cannot be printed.');
 const key=createHash('sha256').update('invoice-inward:'+r.id).digest('hex');
 const [result]=await c.execute('INSERT INTO unit1_stock_qrs(spec_key,material_type,grade,width_mm,thickness_mm,created_by,inward_id) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[key,r.materialType,r.grade,r.widthMm,r.thicknessMm,actorId,r.id]);
 if(result.insertId>99999999)throw fail('Coil QR range exhausted.');
 await c.execute("UPDATE unit1_stock_qrs SET code=CONCAT('CQ',LPAD(id,8,'0')) WHERE id=? AND code IS NULL",[result.insertId]);
 return {...await getQr(c,result.insertId),invoice:r.invoice,vendorCode:r.vendorCode,tcNumber:r.tcNumber};
}
module.exports.invoiceQr=invoiceQr;
