const { validateInward } = require('./unit1CoilValidation');
const { editCoil, correctEditedCoil } = require('./unit1EditCoil');
const { assignCoilCode } = require('./unit1CoilCode');
const { ensurePhysicalCoils } = require('./unit1PhysicalCoils');
const fail = (status,message) => Object.assign(new Error(message), {status});

function validateInvoiceEdit(body) {
  if (!body || !Array.isArray(body.lines) || !body.lines.length || body.lines.length>200 || !Array.isArray(body.batchIds) || !body.batchIds.length) throw fail(400,'Include every coil size in this inward.');
  const batchIds = body.batchIds.map(Number);
  if (batchIds.some(id=>!Number.isSafeInteger(id) || id<1) || new Set(batchIds).size!==batchIds.length) throw fail(400,'Invalid inward coil size references.');
  const seen = new Set();
  const lines = body.lines.map((line,index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) throw fail(400,`Line ${index+1}: Enter valid coil details.`);
    const id = line.id == null ? null : Number(line.id);
    if (id !== null && (!Number.isSafeInteger(id) || !batchIds.includes(id) || seen.has(id))) throw fail(400,`Line ${index+1}: Invalid or duplicate coil size reference.`);
    if (id !== null) seen.add(id);
    const result = validateInward({...line,invoice:body.invoice,invoiceDate:body.invoiceDate,tcNumber:line.tcNumber??body.tcNumber,vendorCode:body.vendorCode});
    if (result.error) throw fail(400,`Line ${index+1}: ${result.error}`);
    if (!result.value.materialType) throw fail(400,`Line ${index+1}: Select a material type.`);
    if (!id && result.value.ratePerKg === null) throw fail(400,`Line ${index+1}: Enter a rate per kg for the new coil size.`);
    return {id,value:result.value,rateProvided:Object.prototype.hasOwnProperty.call(line,'ratePerKg')};
  });
  if (seen.size!==batchIds.length) throw fail(400,'Include every existing coil size in this inward.');
  return {batchIds,lines};
}

async function insertCoilBatch(connection,value) {
  const [insert] = await connection.execute(`INSERT INTO coils (internal_id,supplier,supplier_coil_id,invoice,invoice_date,tc_number,vendor_code,grade,material_type,coil_qty,
    thickness_mm,width_mm,estimated_kg,gross_kg,tare_kg,actual_net_kg,quality_status,quality_note,received_at,rate_per_kg) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [value.internalId,value.supplier,value.supplierCoilId,value.invoice,value.invoiceDate,value.tcNumber,value.vendorCode,value.grade,value.materialType,value.coilQty,
      value.thicknessMm,value.widthMm,value.estimatedKg,value.grossKg,value.tareKg,value.actualNetKg,value.qualityStatus,value.qualityNote,value.receivedAt,value.ratePerKg]);
  await assignCoilCode(connection,insert.insertId);
  await ensurePhysicalCoils(connection,insert.insertId,value.coilQty);
  return insert.insertId;
}

async function editInward(connection,anchorId,input,actorId) {
  const {batchIds,lines} = validateInvoiceEdit(input);
  const [[anchor]] = await connection.execute("SELECT id,invoice_group_id AS invoiceGroupId,invoice,DATE_FORMAT(invoice_date,'%Y-%m-%d') AS invoiceDate,vendor_code AS vendorCode FROM coils WHERE id=? FOR UPDATE",[anchorId]);
  if (!anchor) throw fail(404,'Inward not found.');
  if(anchor.invoiceGroupId)throw fail(409,'Open this shared-weight invoice from Coil stock to record its actual line weights.');
  const [members] = anchor.invoice ? await connection.execute(`SELECT id FROM coils WHERE UPPER(TRIM(invoice))=UPPER(TRIM(?)) AND invoice_date<=>? AND UPPER(TRIM(COALESCE(vendor_code,'')))=UPPER(TRIM(?)) ORDER BY id FOR UPDATE`,[anchor.invoice,anchor.invoiceDate,anchor.vendorCode || '']) : [[{id:anchor.id}]];
  const expected = members.map(row=>Number(row.id)).sort((first,second)=>first-second);
  if (!batchIds.includes(Number(anchorId)) || JSON.stringify([...batchIds].sort((first,second)=>first-second))!==JSON.stringify(expected)) throw fail(409,'This inward has changed. Refresh and open Edit inward again to include all coil sizes.');
  for (const [index,line] of lines.entries()) {
    if (line.value.materialType==='GP') continue;
    const [grades] = await connection.execute('SELECT grade_value FROM unit1_material_grades WHERE material_type=? AND grade_value=? LIMIT 1',[line.value.materialType,line.value.grade]);
    if (!grades.length) throw fail(400,`Line ${index+1}: Grade is not available for the selected material.`);
  }
  const updates = new Map(lines.filter(line=>line.id).map(line=>[line.id,line.value]));
  const deferred = [];
  const ids = [];
  for (const line of [...lines].sort((first,second)=>(first.id ?? Infinity)-(second.id ?? Infinity))) {
    if (line.id) { await editCoil(connection,line.id,line.value,actorId,line.rateProvided,{updates,deferred}); ids.push(line.id); }
    else ids.push(await insertCoilBatch(connection,line.value));
  }
  for (const correction of deferred) await correctEditedCoil(connection,correction,actorId);
  return ids;
}

module.exports = { editInward, validateInvoiceEdit };
