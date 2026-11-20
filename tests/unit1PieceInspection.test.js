const test=require('node:test'),assert=require('node:assert/strict');
const {validatePieceInspection}=require('../services/unit1PieceInspection');
const {validateInspection}=require('../services/unit1HoleReports');
const {correctedInspection}=require('../services/unit1JobCorrection');
test('measured first-piece geometry is positive, complete and independently recorded',()=>{
  const input={measuredCutLengthMm:'2300.25',measuredSectionSize:'149.9 × 65.1 × 20'};
  assert.deepEqual(validatePieceInspection(input,'150x65x20'),{measuredCutLengthMm:2300.25,measuredSectionSize:'149.9 x 65.1 x 20'});
  for(const measuredCutLengthMm of ['',null,0,-1,'1e3','1.001',true,Infinity]) assert.throws(()=>validatePieceInspection({...input,measuredCutLengthMm}),{status:400});
  for(const measuredSectionSize of ['',null,'150x0x20','150x65','150x65x20.001','150xNaNx20']) assert.throws(()=>validatePieceInspection({...input,measuredSectionSize},'150x65x20'),{status:400});
});
test('idempotency includes cut and section readings; plain members can have zero holes',()=>{
  const body={approved:true,measurements:[],measuredCutLengthMm:2300,measuredSectionSize:'150x65x20'};
  const checked=validateInspection(body);assert.equal(checked.measurements.length,0);
  assert.notEqual(checked.requestHash,validateInspection({...body,measuredCutLengthMm:2301}).requestHash);
  assert.notEqual(checked.requestHash,validateInspection({...body,measuredSectionSize:'150x66x20'}).requestHash);
});
test('Hat Purlin inspection records a return lip when the job card specifies it', () => {
  const target = '100 mm × 40 mm × 20 mm × 6 mm';
  const input = { measuredCutLengthMm: 800, measuredSectionSize: '99.9 x 40 x 20 x 5.9' };
  assert.equal(validatePieceInspection(input, target).measuredSectionSize, '99.9 x 40 x 20 x 5.9');
  assert.throws(() => validatePieceInspection({ ...input, measuredSectionSize: '99.9 x 40 x 20' }, target), /Record all 4 section dimensions/);
  assert.equal(validatePieceInspection({ ...input, measuredSectionSize: '99.9 x 40 x 20' }, '100x40x20').measuredSectionSize, '99.9 x 40 x 20');
});
test('job corrections update nominal geometry without changing actual measurements or original targets',()=>{
  const old={sectionSize:'150x65x20',cutLengthMm:2300,measuredCutLengthMm:2300.1,measuredSectionSize:'149.9 x 65 x 20',measurements:[]};
  const result=correctedInspection(old,{id:1,sectionSize:'150x70x20',cutLengthMm:2400},[],[]);
  assert.equal(result.measuredCutLengthMm,2300.1);assert.equal(result.measuredSectionSize,old.measuredSectionSize);
  assert.equal(result.originalCutLengthMm,2300);assert.equal(result.originalSectionSize,'150x65x20');
  assert.equal(result.cutLengthMm,2400);assert.equal(result.sectionSize,'150x70x20');
});
