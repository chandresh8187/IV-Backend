const {stockPositions}=require('./unit1CoilStock');
const {roundKg}=require('./unit1MaterialWeight');
function summarize(rows,positions){
 const groups=new Map(),byId=new Map(positions.map(p=>[Number(p.coilId),p]));
 for(const r of rows){const key=JSON.stringify([Number(r.widthMm),Number(r.thicknessMm),String(r.materialType).trim().toUpperCase(),String(r.grade).trim().toUpperCase()]);
 if(!groups.has(key))groups.set(key,{key,widthMm:Number(r.widthMm),thicknessMm:Number(r.thicknessMm),materialType:r.materialType,grade:r.grade,receivedKg:0,usedKg:0,availableKg:0,pendingWeights:0,receiptCount:0,lastReceivedAt:null});
 const g=groups.get(key),p=byId.get(Number(r.id));g.receiptCount++;g.receivedKg+=Number(r.weightRecorded)===0?0:Number(r.totalWeightKg||0);g.usedKg+=Number(p?.usedKg||0);g.availableKg+=Number(p?.remainingKg||0);if(p?.remainingKg==null)g.pendingWeights++;
 if(!g.lastReceivedAt||new Date(r.receivedAt)>new Date(g.lastReceivedAt))g.lastReceivedAt=r.receivedAt;
 }
 return [...groups.values()].map(g=>({...g,receivedKg:roundKg(g.receivedKg),usedKg:roundKg(g.usedKg),availableKg:roundKg(g.availableKg)})).sort((a,b)=>a.widthMm-b.widthMm||a.thicknessMm-b.thicknessMm||a.key.localeCompare(b.key));
}
async function listStock(c){const [rows]=await c.execute('SELECT id,material_type materialType,grade,width_mm widthMm,thickness_mm thicknessMm,actual_net_kg totalWeightKg,weight_recorded weightRecorded,received_at receivedAt FROM coils WHERE stock_archived_at IS NULL ORDER BY id');return summarize(rows,await stockPositions(c,rows.map(r=>r.id)));}
function invoiceBody(body){
 if(!body)throw Object.assign(new Error('Enter invoice details.'),{status:400});
 const lines=Array.isArray(body.lines)?body.lines:[{materialType:body.materialType,grade:body.grade,widthMm:body.widthMm,thicknessMm:body.thicknessMm,coilQty:body.coilQty,ratePerKg:body.ratePerKg,totalWeightKg:body.totalWeightKg}];
 if(!lines.length||lines.length>50||lines.some(l=>!/^\d+(?:\.\d{1,3})?$/.test(String(l.totalWeightKg))||Number(l.totalWeightKg)<=0))throw Object.assign(new Error('Add 1 to 50 coil lines with actual weight for every line.'),{status:400});
 const totalWeightKg=lines.reduce((n,l)=>n+Math.round(Number(l.totalWeightKg)*1000),0)/1000;
 if(totalWeightKg>999999999)throw Object.assign(new Error('Invoice total weight is too large.'),{status:400});
 return {requestId:body.requestId,vendorCode:body.vendorCode,...(body.vendorId == null ? {} : {vendorId:body.vendorId}),invoice:body.invoice,tcNumber:body.tcNumber,totalWeightKg,lines};
}
async function addStock(c,body,actor){return require('./unit1CoilInvoices').createInvoice(c,invoiceBody(body),actor);}
async function listSizes(c){// Read the two legacy schemas separately: their text columns may have different collations.
 const [catalog]=await c.execute('SELECT material_type materialType,grade,width_mm widthMm,thickness_mm thicknessMm FROM unit1_coil_stock_cards WHERE archived_at IS NULL');
 const [inwards]=await c.execute('SELECT material_type materialType,grade,width_mm widthMm,thickness_mm thicknessMm FROM coils WHERE stock_archived_at IS NULL');
 const rows=[...catalog,...inwards];const unique=new Map();for(const r of rows){const v={...r,widthMm:Number(r.widthMm),thicknessMm:Number(r.thicknessMm)};unique.set(require('./unit1StockCards').specKey(v),v);}return [...unique.values()].sort((a,b)=>a.widthMm-b.widthMm||a.thicknessMm-b.thicknessMm);}
module.exports={summarize,listStock,addStock,invoiceBody,listSizes};

async function listInvoices(c,spec){
 if(!spec||![spec.widthMm,spec.thicknessMm].every(v=>/^\d+(?:\.\d{1,3})?$/.test(String(v))&&Number(v)>0)||!String(spec.materialType||'').trim()||!String(spec.grade||'').trim())throw Object.assign(new Error('Select a coil stock size, material and grade.'),{status:400});
 const [rows]=await c.execute(`SELECT id,invoice_group_id invoiceGroupId,COALESCE(public_code,internal_id) inwardReference,invoice,DATE_FORMAT(invoice_date,'%Y-%m-%d') invoiceDate,vendor_code vendorCode,tc_number tcNumber,material_type materialType,grade,width_mm widthMm,thickness_mm thicknessMm,coil_qty coilQty,rate_per_kg ratePerKg,CASE WHEN weight_recorded=0 THEN NULL ELSE actual_net_kg END totalWeightKg,received_at receivedAt,stock_archived_at archivedAt FROM coils WHERE width_mm=? AND thickness_mm=? ORDER BY received_at DESC,id DESC`,[Number(spec.widthMm),Number(spec.thicknessMm)]);
 const key=require('./unit1StockCards').specKey,own=rows.filter(r=>key(r)===key(spec)),positions=await stockPositions(c,own.map(r=>r.id));
 return own.map(r=>{const p=positions.find(x=>Number(x.coilId)===Number(r.id));return {...r,usedKg:roundKg(Number(p?.usedKg||0)),availableKg:p?.remainingKg==null?null:roundKg(p.remainingKg)};});
}
module.exports.listInvoices=listInvoices;
