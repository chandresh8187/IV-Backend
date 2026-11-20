const {FIELDS,MATERIAL_FIELDS,DEFAULT_SCAN_FIELDS,parseFields}=require('./unit1CoilQr');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function parseQr(value){
  if(typeof value!=='string'||!value.trim()||value.length>2048)throw fail('Scan a valid Unit 1 coil or material QR.');
  const input=value.trim();
  if(input.startsWith('{')){
    let data;try{data=JSON.parse(input);}catch{throw fail('This QR is not a valid Unit 1 QR.');}
    if(data?.type==='unit1-material-stock'&&data.version===1&&/^[a-f0-9]{64}$/.test(data.key))return {type:'material',key:data.key};
    throw fail('This QR type is not supported. Scan a Unit 1 coil or material QR.');
  }
  if(/^(?:CQ\d{8}|\d{6})$/i.test(input))return {type:'coil',reference:input.toUpperCase()};
  const match=input.match(/(?:^|\/)scan\/coil\/([^/?#]+)\/(\d+)(?:[?#]|$)/i);
  if(match){let reference;try{reference=decodeURIComponent(match[1]);}catch{throw fail('Invalid coil QR.');}
    const number=Number(match[2]);if(reference&&reference.length<=80&&!/[\x00-\x1f]/.test(reference)&&Number.isSafeInteger(number)&&number>0)return {type:'coil',reference,number};
  }
  throw fail('This is not a Unit 1 coil or material QR.');
}
async function roleFields(db,role){const [rows]=await db.execute('SELECT fields_json fields FROM unit1_qr_scan_role_fields WHERE role=?',[role]);return rows.length?parseFields(rows[0].fields):DEFAULT_SCAN_FIELDS;}
const projectFields=(catalog,selected,values,prefix='')=>catalog.filter(field=>selected.includes(field.key)).map(field=>({...field,value:values[field.key.slice(prefix.length)]??null}));
function materialDetails(trace,bundles,selected){
  const values={...trace.stock,originalParties:trace.originalParties};
  const fields=projectFields(MATERIAL_FIELDS.filter(f=>!['material.sourceCoils','material.bundles','material.coilUsage','material.jobCards','material.jobCardPreview'].includes(f.key)),selected,values,'material.');
  const result={type:'material',reference:trace.stock.key,fields};
  if(selected.includes('material.sourceCoils')||selected.includes('material.coilUsage'))result.sourceCoils=trace.sourceCoils.map(coil=>({...(selected.includes('material.sourceCoils')?{reference:coil.reference}:{}),fields:selected.includes('material.sourceCoils')?coil.fields.filter(field=>selected.includes(field.key)):[],...(selected.includes('material.coilUsage')?{quantity:coil.producedNos,usedKg:coil.usedKg,holeScrapKg:coil.holeScrapKg,cutBladeScrapKg:coil.cutBladeScrapKg}:{})}));
  if(selected.includes('material.bundles'))result.bundles=bundles.bundles.map(bundle=>({bundleNo:bundle.bundleNo,quantity:bundle.quantity,dispatchedNos:bundle.dispatchedNos,availableNos:bundle.availableNos,createdAt:bundle.createdAt}));
  return result;
}
async function scanMaterial(db,target,selected){
  // Use one snapshot so a transfer/correction cannot mix parties and bundle counts.
  const c=await db.getConnection();try{
    await c.beginTransaction();
    const {sourceRows,traceRows,materialKey}=require('./unit1MaterialRegister');
    const rows=await sourceRows(c),trace=traceRows(rows,target.key,selected);
    const groups=new Map();for(const row of rows.filter(row=>materialKey(row)===target.key)){
      if(!groups.has(row.id))groups.set(row.id,{bundleNo:row.bundleNo,quantity:0,dispatchedNos:0,availableNos:0,createdAt:row.createdAt});
      const bundle=groups.get(row.id);bundle.quantity+=Number(row.producedNos);bundle.dispatchedNos+=Number(row.dispatchedNos||0);bundle.availableNos=bundle.quantity-bundle.dispatchedNos;
    }
    const result=materialDetails(trace,{bundles:[...groups.values()].filter(bundle=>bundle.quantity>0)},selected);
    if(selected.includes('material.jobCards')||selected.includes('material.jobCardPreview'))result.jobCards=await require('./unit1QrJobCards').linkedJobCards(c,rows.filter(row=>materialKey(row)===target.key).map(row=>row.id),selected);
    await c.commit();return result;
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}
function coilDetails(data){return {type:'coil',reference:data.reference,fields:(data.fields||[]).filter(field=>FIELDS.some(f=>f.key===field.key))};}
module.exports={parseQr,roleFields,materialDetails,scanMaterial,coilDetails,projectFields};
