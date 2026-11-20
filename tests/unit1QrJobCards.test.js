const test=require('node:test'),assert=require('node:assert/strict');
const {projectJobCards,linkedJobCards}=require('../services/unit1QrJobCards');
const {normalizeFields}=require('../services/unit1CoilQr');
const row={id:1,jobCardId:12,templateId:4,templateName:'Roof member',templateSpecification:JSON.stringify({sectionProfile:'z_lip',customerName:'PRIVATE PARTY'}),structureType:'solar_mounting_structure',memberName:'PURLIN',sectionSize:'150X65X20X3MM',cutLengthMm:2300,materialType:'GL',coilWidthMm:298,coilThicknessMm:2,allowedCoilSizes:'[{"widthMm":298,"thicknessMm":2}]',punchSize:'12x20',customerName:'PRIVATE PARTY',projectName:'PRIVATE PROJECT',productionQty:100};
const holes=[{jobCardId:12,profile:'web',punchSize:'12x20',targetMm:500,centerOffsetMm:-20,measuredMm:499},{jobCardId:12,profile:'web',punchSize:'12x20',targetMm:500,centerOffsetMm:20}];
test('linked Job Card specifications and 3D geometry are independently permission-filtered',async()=>{
 assert.deepEqual(normalizeFields(['material.jobCards','material.jobCardPreview']),['material.jobCards','material.jobCardPreview']);
 const [both]=projectJobCards([row],holes,['material.jobCards','material.jobCardPreview']);assert.equal(both.reference,'U1-JC-4');assert.equal(both.details.name,'Roof member');assert.equal(both.preview.sectionProfile,'z_lip');assert.deepEqual(both.preview.holes.map(h=>[h.targetMm,h.centerOffsetMm]),[[500,-20],[500,20]]);
 assert.doesNotMatch(JSON.stringify(both),/PRIVATE|measuredMm|productionQty|customerName|projectName/);
 const [preview]=projectJobCards([row],holes,['material.jobCardPreview']);assert.equal(Object.hasOwn(preview,'details'),false);assert.equal(Object.hasOwn(preview.preview,'name'),false);assert.equal(Object.hasOwn(preview.preview,'memberName'),false);
 const [details]=projectJobCards([row],holes,['material.jobCards']);assert.equal(Object.hasOwn(details,'preview'),false);
 assert.deepEqual(projectJobCards([row],holes,[]),[]);assert.deepEqual(await linkedJobCards({execute(){throw Error('Must not read hidden job cards');}},[1],[]),[]);
});
test('production snapshots retain recorded hole definitions instead of substituting current targets',()=>{
 const saved={...row,sectionProfile:'c_lip',holes:holes.map(h=>({...h,targetMm:100})),customerName:'PRIVATE OLD PARTY'};
 const [record]=projectJobCards([{...row,snapshot:JSON.stringify(saved)}],holes,['material.jobCards','material.jobCardPreview']);
 assert.deepEqual(record.preview.holes.map(h=>h.targetMm),[100,100]);assert.equal(record.preview.sectionProfile,'c_lip');assert.doesNotMatch(JSON.stringify(record),/PRIVATE OLD PARTY/);
 const [incomplete]=projectJobCards([{...row,snapshot:JSON.stringify({...row,holes:undefined})}],holes,['material.jobCards','material.jobCardPreview']);
 assert.equal(Object.hasOwn(incomplete,'preview'),false);assert.match(incomplete.previewUnavailable,/no recorded hole definitions/);assert.equal(Object.hasOwn(incomplete.details,'holes'),false);
});
test('same material may link multiple Job Cards and saved revisions without duplicate source bundles',()=>{
 const different={...row,templateId:5,jobCardId:13};
 const revision={...row,id:2,snapshot:JSON.stringify({...row,sectionProfile:'z_lip',holes:[{...holes[0],targetMm:700}]})};
 const records=projectJobCards([row,{...row,id:3},different,revision],holes,['material.jobCards','material.jobCardPreview']);assert.equal(records.length,3);assert.equal(new Set(records.map(r=>r.key)).size,3);assert.deepEqual(records.map(r=>r.reference),['U1-JC-4','U1-JC-5','U1-JC-4']);
});
