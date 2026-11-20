const { faceLabels: profileLabels, punchFaceLabel } = require('./unit1SectionPunchFaces');
const {punchNameFor,withPunchNames}=require('./unit1PunchNames');
const sizeKey=value=>String(value||'').trim().replace(/\s+/g,'').replace(/[×*X]/g,'x');
const displaySize=value=>sizeKey(value).replace(/x/g,'*');
function groupPunchRequirements(job) {
  const groups=new Map();
  for(const hole of job.holes||[]) {
    const punchSize=hole.punchSize||job.punchSize||'';
    const punchName=punchNameFor(hole,job.holes,job.punchSize);
    const centerOffsetMm=hole.centerOffsetMm == null ? null : Number(hole.centerOffsetMm);
    const key=JSON.stringify([punchName,sizeKey(punchSize),hole.profile,centerOffsetMm]);
    if(!groups.has(key)) groups.set(key,{punchName,punchSize,centerOffsetMm,profile:hole.profile,profileLabel:punchFaceLabel(hole.profile, job.sectionProfile || job.structureType),positions:[]});
    groups.get(key).positions.push(Number(hole.targetMm));
  }
  return [...groups.values()].map(row=>({...row,dimensions:row.positions.join('-'),requirement:`${displaySize(row.punchSize)} - ${row.profileLabel} - ${row.positions.join('-')} mm${row.centerOffsetMm == null ? '' : ` · Centre offset ${row.centerOffsetMm > 0 ? '+' : ''}${row.centerOffsetMm} mm`}`}));
}
function parsePunchRequirements(lines,cutLengthMm) {
  if(!Array.isArray(lines)||!lines.length) throw new Error('Add at least one punch requirement.');
  const holes=[];
  for(const [index,line] of lines.entries()) {
    const punchSize=sizeKey(line.punchSize),raw=String(line.dimensions||'').trim();
    if(!punchSize||punchSize.length>100||!Object.hasOwn(profileLabels, line.profile)||!/^\d+(?:\.\d{1,3})?(?:\s*(?:[-,;]|\s)\s*\d+(?:\.\d{1,3})?)*$/.test(raw)) throw new Error(`Requirement ${index+1}: enter punch size, profile and positions such as 56-187-259-398-448.`);
    const values=raw.split(/[\s,;-]+/).filter(Boolean).map(Number);
    if(values.some(value=>!Number.isFinite(value)||value<0||value>Number(cutLengthMm))) throw new Error(`Requirement ${index+1}: every position must be within the cut length.`);
    const offset = String(line.centerOffsetMm ?? '').trim();
    if (line.profile === 'web' && offset && (!/^[+-]?\d+(?:\.\d{1,3})?$/.test(offset) || Math.abs(Number(offset)) > 2500)) throw new Error('Requirement '+(index+1)+': enter a signed centre offset within ±2500 mm (up to three decimals).');
    const centerOffsetMm = line.profile === 'web' && offset ? Number(offset) : null;
    const faces = line.profile === 'lr_flange' ? ['l_flange', 'r_flange'] : [line.profile];
    for (const profile of faces) {
      holes.push(...values.map(targetMm=>({punchName:line.punchName,punchSize,profile,targetMm,...(centerOffsetMm == null ? {} : {centerOffsetMm})})));
    }
  }
  if(!holes.length||holes.length>100) throw new Error('Enter 1 to 100 hole positions in total.');
  return withPunchNames(holes);
}
module.exports={groupPunchRequirements,parsePunchRequirements,displaySize};


