const test = require('node:test'), assert = require('node:assert/strict');
const { correctedInspection } = require('../services/unit1JobCorrection');
const job={id:1,punchSize:'12x20',memberName:'Updated',sectionSize:'150x70',cutLengthMm:2500,structureType:'purlin_c_lip',customerName:'Corrected party',projectNameCapacity:'Project'};
test('corrected targets retain actual measurements and their original targets', () => {
  const old=[{id:11,profile:'web',punchSize:'12x20',targetMm:100}];
  const current=[{id:22,profile:'web',punchSize:'18x20',targetMm:200}];
  const original={measurements:[{holeId:11,sequenceNo:1,profile:'web',punchSize:'12x20',targetMm:100,measuredMm:100.1}],coilInternalId:'Physical coil',checkedByName:'Supervisor'};
  const corrected=correctedInspection(original,job,old,current);
  assert.equal(corrected.measurements[0].measuredMm,100.1);
  assert.equal(corrected.measurements[0].originalTargetMm,100);
  assert.equal(corrected.measurements[0].targetMm,200);
  assert.equal(corrected.measurements[0].currentDefinitionHoleId,22);
  assert.equal(corrected.customerName,'Corrected party');
  assert.equal(original.measurements[0].targetMm,100);
  assert.equal(corrected.coilInternalId,'Physical coil');
});
test('adding or removing holes does not invent targets or measured values for ambiguous matches', () => {
  const old=[{id:11,profile:'web',punchSize:'12x20',targetMm:100}];
  const current=[{id:22,profile:'web',punchSize:'12x20',targetMm:200},{id:23,profile:'web',punchSize:'12x20',targetMm:300}];
  const result=correctedInspection({measurements:[{holeId:11,profile:'web',punchSize:'12x20',targetMm:100,measuredMm:100.1}]},job,old,current);
  assert.equal(result.measurements.length,1);
  assert.equal(result.measurements[0].targetMm,null);
  assert.equal(result.measurements[0].measuredMm,100.1);
  assert.match(result.correctionNote,/2 revised holes have no recorded reading/);
});
