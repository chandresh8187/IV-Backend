const {randomUUID}=require('node:crypto');
const {assignCoilCode}=require('./unit1CoilCode');
const {ensurePhysicalCoils}=require('./unit1PhysicalCoils');
const fail=message=>Object.assign(new Error(message),{status:400});
function validateQrRecord(body={}) {
 const v={materialType:String(body.materialType||''),grade:String(body.grade||'').trim(),widthMm:Number(body.widthMm),thicknessMm:Number(body.thicknessMm),coilQty:Number(body.coilQty),ratePerKg:Number(body.ratePerKg),requestId:String(body.requestId||'')};
 if(!['MS','GL','GP','Posmac'].includes(v.materialType)||!v.grade||v.grade.length>100)throw fail('Enter material type and grade.');
 if(v.materialType==='GP'&&!/^GSM - (?:8[0-9]|9[0-9]|1[0-3][0-9]|140)$/.test(v.grade))throw fail('GP GSM must be a whole number from 80 to 140.');
 if(![body.widthMm,body.thicknessMm].every(x=>/^\d+(?:\.\d{1,3})?$/.test(String(x)))||![v.widthMm,v.thicknessMm].every(x=>x>0&&x<1000000))throw fail('Enter positive coil width and thickness in mm.');
 if(!/^[1-9]\d*$/.test(String(body.coilQty))||v.coilQty>1000)throw fail('Enter 1 to 1000 coils.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(String(body.ratePerKg))||!(v.ratePerKg>0&&v.ratePerKg<=99999999.99))throw fail('Enter a positive rate per kg with up to two decimals.');
 if(!/^[A-Za-z0-9_-]{10,100}$/.test(v.requestId))throw fail('Reopen the QR generation form.');
 if(body.totalWeightKg!=null&&body.totalWeightKg!==''){
  if(!/^\d+(?:\.\d{1,3})?$/.test(String(body.totalWeightKg))||!(Number(body.totalWeightKg)>0&&Number(body.totalWeightKg)<=999999999))throw fail('Enter positive total inward weight in kg with up to three decimals.');
  v.totalWeightKg=Number(body.totalWeightKg);
 }
 for(const key of ['vendorCode','invoice','tcNumber']){v[key]=String(body[key]||'').trim();if(v[key].length>100)throw fail('Vendor code, invoice and TC number must be at most 100 characters.');}
 if(['vendorCode','invoice','tcNumber'].some(key=>body[key]!=null)&&(!v.vendorCode||!v.invoice))throw fail('Enter vendor code and invoice number.');
 return v;
}
async function createQrRecord(c,body){
 const v=validateQrRecord(body);
 const [[prior]]=await c.execute('SELECT id,material_type materialType,grade,width_mm widthMm,thickness_mm thicknessMm,coil_qty coilQty,rate_per_kg ratePerKg,actual_net_kg totalWeightKg,weight_recorded weightRecorded,vendor_code vendorCode,invoice,tc_number tcNumber FROM coils WHERE qr_request_key=? FOR UPDATE',[v.requestId]);
 if(prior){if(['vendorCode','invoice','tcNumber'].some(k=>String(prior[k]||'')!==v[k]))throw Object.assign(new Error('This inward request was already used with different vendor or invoice details.'),{status:409});if(['materialType','grade','widthMm','thicknessMm','coilQty','ratePerKg'].some(k=>String(prior[k])!==String(v[k])))throw Object.assign(new Error('This QR request was already used with different details.'),{status:409});if((v.totalWeightKg!=null)!==(Number(prior.weightRecorded)===1)||(v.totalWeightKg!=null&&Number(prior.totalWeightKg)!==v.totalWeightKg))throw Object.assign(new Error('This QR request was already used with a different inward weight.'),{status:409});return prior.id;}
 const internalId='QR-'+randomUUID();
 const [row]=await c.execute(`INSERT INTO coils(internal_id,supplier,supplier_coil_id,invoice,grade,material_type,coil_qty,width_mm,thickness_mm,rate_per_kg,estimated_kg,gross_kg,tare_kg,actual_net_kg,quality_status,received_at,qr_generated_at,weight_recorded,qr_request_key)
 VALUES(?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?,?)`,[internalId,'',internalId,v.grade,v.materialType,v.coilQty,v.widthMm,v.thicknessMm,v.ratePerKg,v.totalWeightKg??null,v.totalWeightKg??null,v.totalWeightKg==null?null:0,v.totalWeightKg??null,v.totalWeightKg==null?0:1,v.requestId]);
 if(v.vendorCode||v.invoice||v.tcNumber)await c.execute('UPDATE coils SET vendor_code=?,supplier=?,invoice=?,tc_number=? WHERE id=?',[v.vendorCode,v.vendorCode,v.invoice,v.tcNumber||null,row.insertId]);
 await assignCoilCode(c,row.insertId);await ensurePhysicalCoils(c,row.insertId,v.coilQty);return row.insertId;
}
module.exports={validateQrRecord,createQrRecord};
