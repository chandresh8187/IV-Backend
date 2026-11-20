const test=require('node:test'),assert=require('node:assert/strict');
const {withPunchNames}=require('../services/unit1PunchNames');
const {groupPunchRequirements,parsePunchRequirements}=require('../services/unit1PunchRequirements');
const {snapshotInspection}=require('../services/unit1HoleReports');
const {correctedInspection}=require('../services/unit1JobCorrection');
const {holeScrapKg}=require('../services/unit1MaterialWeight');
const rows=[{punchName:'E',punchSize:'10x20',profile:'web',dimensions:'100-200'},{punchName:'A',punchSize:'10x20',profile:'web',dimensions:'300'},{punchName:'B',punchSize:'10x20',profile:'web',dimensions:'400'}];
test('selected E survives identical-size A/B groups, inspection and scrap calculation',()=>{
 const holes=parsePunchRequirements(rows,1000).map((h,i)=>({...h,id:i+1}));
 assert.deepEqual(holes.map(h=>h.punchName),['E','E','A','B']);
 assert.deepEqual(groupPunchRequirements({holes}).map(r=>r.punchName),['E','A','B']);
 const snapshot=snapshotInspection({},holes,new Map(holes.map(h=>[h.id,h.targetMm+.1])),{},'Supervisor');
 assert.deepEqual(snapshot.measurements.map(h=>h.punchLetter),['E','E','A','B']);
 const weight=h=>holeScrapKg({holes:h,thicknessMm:3,pieces:64,densityGcm3:7.85});
 assert.equal(weight(holes),weight(holes.map(({punchName,...h})=>h)));
});
test('only A-E accepted; one name has one size across faces; blank selection rejected',()=>{
 for(const name of ['F','G','H','', 'AA'])assert.throws(()=>parsePunchRequirements([{...rows[0],punchName:name}],1000),{status:400});
 assert.throws(()=>withPunchNames([{punchName:'A',punchSize:'10'},{punchName:'A',punchSize:'20'}]),/same size/);
 assert.deepEqual(withPunchNames([{punchName:'A',punchSize:'10 x 20',profile:'web'},{punchName:'A',punchSize:'10*20',profile:'lip'}]).map(h=>h.punchName),['A','A']);
});
test('renaming or reordering same-size punches preserves actual readings and original labels',()=>{
 const old=[{id:1,punchName:'A',punchSize:'10',profile:'web',targetMm:100},{id:2,punchName:'B',punchSize:'10',profile:'web',targetMm:100}];
 const current=[{...old[1],id:3},{...old[0],id:4}];
 const snapshot={measurements:old.map((h,i)=>({...h,holeId:h.id,punchLetter:h.punchName,measuredMm:100+i*.1}))};
 const result=correctedInspection(snapshot,{},old,current);
 assert.deepEqual(result.measurements.map(h=>h.currentDefinitionHoleId),[4,3]);
 const renamed=correctedInspection({measurements:[snapshot.measurements[0]]},{},[old[0]],[{...old[0],id:5,punchName:'E'}]);
 assert.equal(renamed.measurements[0].punchLetter,'E');assert.equal(renamed.measurements[0].originalPunchName,'A');assert.equal(renamed.measurements[0].measuredMm,100);
});
test('job-card PDF prints selected E without silently relabelling it A',async()=>{
 const {PDFParse}=require('pdf-parse'),{generateJobCardPdf}=require('../services/pdf/unit1ProductionPdfGenerator');
 const bytes=await generateJobCardPdf({id:1,isTemplate:true,memberName:'Test',structureType:'solar_mounting_structure',sectionSize:'100x50',cutLengthMm:1000,holes:parsePunchRequirements(rows,1000)});
 const p=new PDFParse({data:bytes});try{assert.doesNotMatch((await p.getText()).text,/PUNCH - E/);}finally{await p.destroy();}
});
test('legacy backfill is audited and idempotent, retaining raw positions and plan quantities', {skip:process.env.UNIT1_PLANNING_DB_TEST!=='1'},async()=>{
 const {db,close}=await require('./fixtures/unit1FlowDatabase').unit1FlowDatabase();
 try{
  const service=require('../services/unit1Planning');
  const spec={structureType:'solar_mounting_structure',memberName:'Test',sectionSize:'100',cutLengthMm:1000,materialType:'MS',coilWidthMm:254,coilThicknessMm:3,punchSize:'10',holes:[{punchSize:'10',profile:'web',targetMm:123.456}]};
  const template=await service.saveTemplate(db,null,spec,1);
  const plan=await service.savePlan(db,null,{partyName:'Test',projectName:'',planDate:'2026-10-31',shift:'day',requestKey:'punch_names_migration_01',lines:[{templateId:template.id,machineId:1,quantity:77,selectedCoils:[]}]},1);
  const jobId=(await service.plans(db)).find(p=>p.id===plan.id).lines[0].id;
  await db.execute('UPDATE unit1_material_templates SET specification=? WHERE id=?',[JSON.stringify(spec),template.id]);
  await db.execute('UPDATE unit1_job_card_holes SET punch_name=NULL WHERE job_card_id=?',[jobId]);
  const beforeTarget=(await service.job(db,jobId)).holes[0].targetMm;
  const migrate=require('../scripts/migrateUnit1PunchNames').migrateUnit1PunchNames;
  await migrate(db);await migrate(db);
  assert.equal((await service.job(db,jobId)).holes[0].punchName,'A');
  assert.equal((await service.job(db,jobId)).holes[0].targetMm,beforeTarget);
  assert.equal((await service.plans(db))[0].lines[0].quantity,77);
  const [audit]=await db.query('SELECT entity_type,before_data,after_data FROM unit1_punch_name_revisions ORDER BY entity_type');
  assert.equal(audit.length,2);const original=JSON.parse(audit.find(a=>a.entity_type==='template').before_data);assert.deepEqual(original,spec);
  assert.equal((await service.templates(db))[0].version,2);
 }finally{await close();}
});

test('unnamed template holes support more than five sizes without fabricating punch letters',()=>{const holes=parsePunchRequirements(Array.from({length:6},(_,i)=>({punchName:null,punchSize:String(10+i),profile:'web',dimensions:String(100+i*20)})),1000);assert.equal(holes.length,6);assert.ok(holes.every(h=>h.punchName===null));assert.deepEqual(withPunchNames(holes),holes);});
