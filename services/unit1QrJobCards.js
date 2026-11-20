const {createHash}=require('node:crypto');
const parse=value=>{if(value==null)return null;if(typeof value==='object')return value;try{return JSON.parse(value);}catch{return null;}};
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!=null).map(key=>[key,value[key]]));
const geometryKeys=['structureType','sectionProfile','sectionSize','cutLengthMm','coilThicknessMm','punchSize'];
const holeKeys=['profile','punchSize','punchName','targetMm','centerOffsetMm'];

function projectJobCards(rows,holes,selected){
  const detailsAllowed=selected.includes('material.jobCards'),previewAllowed=selected.includes('material.jobCardPreview');
  if(!detailsAllowed&&!previewAllowed)return [];
  const groups=new Map();
  for(const row of rows){
    const snapshot=parse(row.snapshot),template=parse(row.templateSpecification);
    const saved=snapshot||{...row,sectionProfile:template?.sectionProfile,holes:holes.filter(hole=>Number(hole.jobCardId)===Number(row.jobCardId))};
    const geometry=pick(saved,geometryKeys);
    // Historical targets must come from their saved snapshot. If that snapshot
    // lacks hole definitions, do not fill it with a newer template's holes.
    if(Array.isArray(saved.holes))geometry.holes=saved.holes.map(hole=>pick(hole,holeKeys));
    const details={...geometry,...pick(saved,['memberName','materialType','coilWidthMm'])};
    const sizes=parse(saved.allowedCoilSizes);if(Array.isArray(sizes))details.allowedCoilSizes=sizes.map(size=>pick(size,['widthMm','thicknessMm']));
    const reference=`U1-JC-${row.templateId||row.jobCardId}`;
    const key=createHash('sha256').update(JSON.stringify([reference,details])).digest('hex');
    if(groups.has(key))continue;
    const item={key,reference};
    if(detailsAllowed)item.details={...details,...(row.templateName?{name:row.templateName}:{})};
    if(previewAllowed){
      if(Array.isArray(geometry.holes))item.preview=geometry;
      else item.previewUnavailable='The saved production record has no recorded hole definitions for an accurate 3D preview.';
    }
    groups.set(key,item);
  }
  return [...groups.values()];
}
async function linkedJobCards(db,bundleIds,selected){
  if(!selected.includes('material.jobCards')&&!selected.includes('material.jobCardPreview'))return [];
  const ids=[...new Set(bundleIds.map(Number))];if(!ids.length)return [];
  const [rows]=await db.execute(`SELECT b.id,b.job_snapshot snapshot,j.id jobCardId,j.structure_type structureType,j.member_name memberName,j.section_size sectionSize,j.cut_length_mm cutLengthMm,j.material_type materialType,j.coil_width_mm coilWidthMm,j.coil_thickness_mm coilThicknessMm,j.allowed_coil_sizes allowedCoilSizes,j.punch_size punchSize,l.template_id templateId,t.name templateName,t.specification templateSpecification
    FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id JOIN unit1_job_cards j ON j.id=r.job_card_id
    LEFT JOIN unit1_production_plan_lines l ON l.job_card_id=j.id LEFT JOIN unit1_material_templates t ON t.id=l.template_id
    WHERE b.id IN (${ids.map(()=>'?').join(',')}) ORDER BY b.id`,ids);
  const jobs=[...new Set(rows.filter(row=>row.snapshot==null).map(row=>Number(row.jobCardId)))];
  const [holes]=jobs.length?await db.execute(`SELECT job_card_id jobCardId,profile,punch_size punchSize,punch_name punchName,target_mm targetMm,center_offset_mm centerOffsetMm FROM unit1_job_card_holes WHERE job_card_id IN (${jobs.map(()=>'?').join(',')}) AND is_active=1 ORDER BY job_card_id,sequence_no`,jobs):[[]];
  return projectJobCards(rows,holes,selected);
}
module.exports={projectJobCards,linkedJobCards};
