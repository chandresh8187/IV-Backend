const fail=message=>Object.assign(new Error(message),{status:400});
function allowedCoilSizes(value={}) {
 let sizes=value.allowedCoilSizes ?? value.allowed_coil_sizes;
 if(typeof sizes==='string') {try{sizes=JSON.parse(sizes);}catch{throw fail('Invalid saved coil sizes.');}}
 if(sizes==null)return [{widthMm:Number(value.coilWidthMm??value.coil_width_mm),thicknessMm:Number(value.coilThicknessMm??value.coil_thickness_mm)}];
 return sizes;
}
function normalizeAllowedCoilSizes(input) {
 const sizes=allowedCoilSizes(input);
 if(!Array.isArray(sizes)||!sizes.length||sizes.length>100)throw fail('Add 1 to 100 allowed coil sizes.');
 const seen=new Set();return sizes.map(row=>{
  const widthMm=Number(row?.widthMm),thicknessMm=Number(row?.thicknessMm);
  if(![row?.widthMm,row?.thicknessMm].every(v=>/^\d+(?:\.\d{1,3})?$/.test(String(v)))||![widthMm,thicknessMm].every(v=>v>0&&v<1000000))throw fail('Every coil size needs a positive width and thickness in mm, with up to three decimals.');
  const key=widthMm+':'+thicknessMm;if(seen.has(key))throw fail('Remove duplicate allowed coil sizes.');seen.add(key);return {widthMm,thicknessMm};
 });
}
function matchesAllowedCoilSize(coil,job) {return allowedCoilSizes(job).some(size=>Number(size.widthMm)===Number(coil.widthMm)&&Number(size.thicknessMm)===Number(coil.thicknessMm));}
function jobThicknessForCoil(coil, job) {
 const size = allowedCoilSizes(job).find(row => Number(row.widthMm) === Number(coil.widthMm) && Number(row.thicknessMm) === Number(coil.thicknessMm));
 return size?.thicknessMm ?? job.coilThicknessMm;
}
module.exports={allowedCoilSizes,normalizeAllowedCoilSizes,matchesAllowedCoilSize,jobThicknessForCoil};
