const { randomInt } = require('node:crypto');
// O/0 and I/1 are omitted so printed IDs are easier to enter by hand.
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const validPartyCode=value=>typeof value==='string'&&/^[A-Z0-9]{10}$/.test(value)&&/[A-Z]/.test(value)&&/[0-9]/.test(value);
const query=(db,sql,args=[])=>db.execute?db.execute(sql,args):db.query(sql,args);
function generatePartyCode(){
 let code;do{code=Array.from({length:10},()=>alphabet[randomInt(alphabet.length)]).join('');}while(!validPartyCode(code));
 return code;
}
async function ensurePartyCode(db,key,{generate=generatePartyCode}={}){
 if(!/^[a-f0-9]{64}$/.test(String(key)))throw Object.assign(new Error('Invalid party identity.'),{status:400});
 const find=async()=>{const [[row]]=await query(db,'SELECT party_code AS partyCode FROM unit1_material_party_codes WHERE party_key=?',[key]);return row?.partyCode;};
 const existing=await find();if(existing)return existing;
 for(let attempt=0;attempt<30;attempt++){
  const code=generate();if(!validPartyCode(code))throw new Error('Invalid generated material party ID.');
  try{await query(db,'INSERT INTO unit1_material_party_codes (party_key,party_code) VALUES (?,?)',[key,code]);return code;}
  catch(error){if(error.code!=='ER_DUP_ENTRY')throw error;const assigned=await find();if(assigned)return assigned;}
 }
 throw Object.assign(new Error('Could not assign a unique party ID. Retry.'),{status:503});
}
async function resolvePartyCode(db,input){
 const code=String(input||'').trim().toUpperCase();
 if(!validPartyCode(code))throw Object.assign(new Error('Enter the 10-character party ID printed beside the QR (letters and numbers).'),{status:400});
 const [[row]]=await query(db,'SELECT party_key AS partyKey FROM unit1_material_party_codes WHERE party_code=?',[code]);
 if(!row)throw Object.assign(new Error('Party ID not found. Check the ID printed beside the QR.'),{status:404});
 return row.partyKey;
}
async function backfillPartyCodes(db){
 const [rows]=await query(db,"SELECT DISTINCT SHA2(LOWER(TRIM(COALESCE(i.customer_name,''))),256) AS partyKey FROM unit1_material_stock_movements m JOIN unit1_material_stock_items i ON i.id=m.item_id WHERE m.movement_type='production' AND m.quantity>0");
 for(const row of rows)await ensurePartyCode(db,row.partyKey);
}
module.exports={generatePartyCode,validPartyCode,ensurePartyCode,resolvePartyCode,backfillPartyCodes};
