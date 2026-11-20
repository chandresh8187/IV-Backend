const fail = message => Object.assign(new Error(message), { status: 400 });
const sectionParts = value => {
  const parts = String(value ?? '').trim().split(/\s*[x×*]\s*/i)
    .map(part => part.replace(/\s*mm$/i, '').trim());
  return parts.length<=6 && parts.every(part=>/^\d+(?:\.\d{1,3})?$/.test(part) && Number(part)>0) ? parts.map(Number) : null;
};
function validatePieceInspection(body, targetSection) {
  const raw=String(body?.measuredCutLengthMm ?? '').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw) || Number(raw)<=0 || Number(raw)>1000000) throw fail('Enter the actual measured cut length in mm, above zero, with up to two decimals.');
  const section=String(body?.measuredSectionSize ?? '').trim().replace(/\s*mm$/i,'').split(/\s*[x×*]\s*/i);
  if(!section.length || section.length>6 || section.some(value=>!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value)<=0 || Number(value)>1000000)) throw fail('Enter the actual measured section dimensions in mm, for example 150 x 65 x 20, with up to two decimals.');
  const target=sectionParts(targetSection);
  if(target && section.length!==target.length) throw fail(`Record all ${target.length} section dimensions in the same order as the job card.`);
  return {measuredCutLengthMm:Number(raw),measuredSectionSize:section.map(Number).join(' x ')};
}
function validateRejectedPieces(value) {
  if (value == null || value === '') return null;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 100000) throw fail('Rejected pieces must be a whole number from 0 to 100000.');
  return Number(value);
}
module.exports={validatePieceInspection,sectionParts,validateRejectedPieces};
