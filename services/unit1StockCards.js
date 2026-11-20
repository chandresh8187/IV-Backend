const {createHash}=require('node:crypto');
const {validateQrRecord}=require('./unit1CoilQrGenerator');
function specKey(v){return createHash('sha256').update(JSON.stringify([String(v.materialType).trim().toUpperCase(),String(v.grade).trim().toUpperCase(),Number(v.widthMm),Number(v.thicknessMm)])).digest('hex');}
async function listCards(c){const [rows]=await c.execute('SELECT id stockCardId,material_type materialType,grade,width_mm widthMm,thickness_mm thicknessMm FROM unit1_coil_stock_cards WHERE archived_at IS NULL');return rows.map(r=>({...r,stockCardOnly:true}));}
async function createCard(c,body,actor){
 // Reuse the material/grade/dimension rules; no inward, quantity or weight is inserted.
 const v=validateQrRecord({...body,coilQty:1,ratePerKg:1,requestId:'stock_card_validation'});
 await c.execute('INSERT INTO unit1_coil_stock_cards(spec_key,material_type,grade,width_mm,thickness_mm,created_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE archived_at=NULL',[specKey(v),v.materialType,v.grade,v.widthMm,v.thicknessMm,actor]);
 return {materialType:v.materialType,grade:v.grade,widthMm:v.widthMm,thicknessMm:v.thicknessMm};
}
module.exports={specKey,listCards,createCard};
