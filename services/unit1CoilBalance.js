// QR identifies the source inward/rate. Available kg belongs to the material, grade and size pool.
async function coilBalance(connection,coilId,coilNumber){
 const [[source]]=await connection.execute('SELECT id,invoice_group_id invoiceGroupId,weight_recorded weightRecorded,width_mm widthMm,thickness_mm thicknessMm,material_type materialType,grade,stock_archived_at archivedAt FROM coils WHERE id=?',[coilId]);
 if(!source)throw Object.assign(new Error('Coil not found.'),{status:404});
 let invoiceRemainingKg=null;
 if(source.invoiceGroupId&&Number(source.weightRecorded)===0){
  const [[invoice]]=await connection.execute('SELECT total_weight_kg totalKg FROM unit1_coil_invoices WHERE id=? FOR UPDATE',[source.invoiceGroupId]);
  const [members]=await connection.execute('SELECT id FROM coils WHERE invoice_group_id=? ORDER BY id FOR UPDATE',[source.invoiceGroupId]);
  const positions=await require('./unit1CoilStock').stockPositions(connection,members.map(row=>row.id),true);
  invoiceRemainingKg=Number(invoice.totalKg)-positions.reduce((n,r)=>n+Number(r.usedKg||0),0);
 }
 const [batches]=await connection.execute('SELECT id FROM coils WHERE width_mm=? AND thickness_mm=? AND UPPER(TRIM(material_type))=UPPER(TRIM(?)) AND UPPER(TRIM(grade))=UPPER(TRIM(?)) AND stock_archived_at IS NULL ORDER BY id FOR UPDATE',[source.widthMm,source.thicknessMm,source.materialType,source.grade]);
 const {stockPositions}=require('./unit1CoilStock');
 const positions=await stockPositions(connection,batches.map(row=>row.id),true);
 const [[physical]]=await connection.execute('SELECT EXISTS(SELECT 1 FROM unit1_coil_weight_members WHERE coil_id=? AND coil_number=?) weightFinished,EXISTS(SELECT 1 FROM unit1_production_runs WHERE coil_id=? AND coil_number=? AND stock_qr_id IS NOT NULL) selectedInwardRate',[coilId,coilNumber,coilId,coilNumber]);
 let groupRemainingKg=positions.some(row=>!row.known)?null:positions.reduce((n,row)=>n+Number(row.remainingKg||0),0);
 if(Number(physical?.selectedInwardRate)){const selected=positions.find(r=>Number(r.coilId)===Number(coilId));if(selected?.remainingKg!=null)groupRemainingKg=Number(selected.remainingKg);}
 return {startingKg:null,usedKg:Number(positions.find(row=>Number(row.coilId)===Number(coilId))?.usedKg||0),weightFinished:Boolean(source.archivedAt||Number(physical?.weightFinished)),remainingKg:source.archivedAt?0:invoiceRemainingKg==null?groupRemainingKg:groupRemainingKg==null?invoiceRemainingKg:Math.min(groupRemainingKg,invoiceRemainingKg)};
}
module.exports={coilBalance};
